import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { livekitService } from '../services/livekitService.js';
import { lmsRepository } from '../repositories/lmsRepository.js';
import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import { logAudit } from '../repositories/auditRepository.js';

const router = Router();

/**
 * GET /api/livekit/status
 * Check video integration health and configuration
 */
router.get('/status', (req, res) => {
  res.status(200).json({
    success: true,
    data: livekitService.getStatus()
  });
});

/**
 * POST /api/livekit/token
 * Generate WebRTC participant token for an authorized session
 * Accepts { sessionId } or { roomName }
 */
router.post('/token', requireAuth, async (req, res, next) => {
  try {
    const { sessionId, roomName: requestedRoomName } = req.body;
    let targetRoomName = requestedRoomName;
    let liveSession = null;

    if (sessionId) {
      liveSession = await lmsRepository.getLiveClassById(sessionId);
      if (!liveSession) {
        return res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Live class lecture not found.' }
        });
      }

      if (liveSession.status === 'completed' || liveSession.status === 'cancelled' || liveSession.status === 'ended') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'LECTURE_ENDED',
            message: 'This lecture has ended.'
          }
        });
      }

      // Check role authorization
      if (req.user.role === 'TEACHER') {
        const isOwner = liveSession.teacher_id === req.user.id || req.user.role === 'ADMIN';
        if (!isOwner) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You are not the designated instructor for this session.' }
          });
        }
        // Auto-transition from scheduled to ongoing when teacher joins
        if (liveSession.status === 'scheduled') {
          const nowIso = new Date().toISOString();
          await lmsRepository.updateLiveClass(liveSession.id, { status: 'ongoing', started_at: nowIso });
          liveSession.status = 'ongoing';
          liveSession.started_at = nowIso;
        }
      } else if (req.user.role === 'STUDENT') {
        // Attendance recording for student joining live class
        const today = new Date().toISOString().split('T')[0];
        try {
          if (isPostgresConnected && pool) {
            let classIdForAtt = liveSession.class_id;
            if (!classIdForAtt && liveSession.batch_id) {
              const bRes = await pool.query('SELECT class_id FROM batches WHERE id = $1', [liveSession.batch_id]);
              classIdForAtt = bRes.rows[0]?.class_id;
            }
            if (!classIdForAtt) {
              const anyClass = await pool.query('SELECT id FROM classes LIMIT 1');
              classIdForAtt = anyClass.rows[0]?.id;
            }

            if (classIdForAtt) {
              const existing = await pool.query(
                `SELECT id FROM attendance_records WHERE student_id = $1 AND class_id = $2 AND date = $3`,
                [req.user.id, classIdForAtt, today]
              );
              if (existing.rows.length === 0) {
                const attId = `att-${crypto.randomUUID().slice(0, 8)}`;
                await pool.query(
                  `INSERT INTO attendance_records (id, student_id, class_id, batch_id, subject_id, date, status, remarks, marked_by, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, 'present', $7, $8, NOW())`,
                  [
                    attId,
                    req.user.id,
                    classIdForAtt,
                    liveSession.batch_id || null,
                    liveSession.subject_id || null,
                    today,
                    `LiveKit Live Lecture: ${liveSession.title}`,
                    liveSession.teacher_id
                  ]
                );
              }
            }
          }
        } catch (attErr) {
          console.warn('LiveKit attendance recording notice:', attErr.message);
        }
      }

      targetRoomName = `lecture-${liveSession.id}`;
    }

    if (!targetRoomName) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_ROOM', message: 'Either sessionId or roomName is required.' }
      });
    }

    // Respect client publisher request (for interactive classroom participation) or default to role-based check
    const isPublisher = req.body.isPublisher !== undefined
      ? Boolean(req.body.isPublisher)
      : (req.user.role === 'TEACHER' || req.user.role === 'ADMIN');
    const result = livekitService.generateToken({
      roomName: targetRoomName,
      participantIdentity: req.user.id,
      participantName: req.user.full_name || req.user.email,
      isPublisher
    });

    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: {
          code: result.error,
          message: result.message
        },
        data: {
          configured: false,
          fallback: 'external'
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...result,
        session: liveSession
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/livekit/sessions/:id/end
 * End an active lecture for all participants (Teacher or Admin only)
 */
router.post('/sessions/:id/end', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const session = await lmsRepository.getLiveClassById(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Lecture session not found.' }
      });
    }

    if (req.user.role !== 'ADMIN' && session.teacher_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only the host instructor or administrator can end this lecture.' }
      });
    }

    const roomName = `lecture-${id}`;
    const nowIso = new Date().toISOString();
    const updated = await lmsRepository.updateLiveClass(id, { status: 'completed', ended_at: nowIso });

    // Broadcast LECTURE_ENDED data to all room participants via server
    try {
      await livekitService.sendData(roomName, {
        type: 'LECTURE_ENDED',
        lectureId: id,
        message: 'This live lecture has been ended by the instructor.'
      });
    } catch (sendErr) {
      console.warn('[LiveKit] Broadcast end error:', sendErr.message);
    }

    // Forcibly close and delete room on LiveKit server
    try {
      await livekitService.deleteRoom(roomName);
    } catch (delErr) {
      console.warn('[LiveKit] Delete room error:', delErr.message);
    }

    await logAudit(req.user, 'END_LIVEKIT_LECTURE', 'live_class_sessions', id, `Ended LiveKit lecture "${session.title}"`);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Live lecture ended successfully.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/livekit/sessions/:id/control-participant
 * Teacher moderates student participant media / state
 * Protected: TEACHER (host instructor) or ADMIN only. STUDENTS get 403.
 */
router.post('/sessions/:id/control-participant', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { participantIdentity, action, trackSid } = req.body;

    if (req.user.role !== 'TEACHER' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only teachers and administrators can control classroom participants.' }
      });
    }

    const session = await lmsRepository.getLiveClassById(id);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Lecture session not found.' }
      });
    }

    if (req.user.role !== 'ADMIN' && session.teacher_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You are not the designated instructor for this session.' }
      });
    }

    if (!participantIdentity || typeof participantIdentity !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'participantIdentity is required.' }
      });
    }

    const allowedActions = [
      'mute_mic',
      'unmute_mic',
      'disable_camera',
      'enable_camera',
      'stop_screen_share',
      'remove_participant'
    ];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ACTION', message: `Action must be one of: ${allowedActions.join(', ')}` }
      });
    }

    const roomName = `lecture-${id}`;

    // 1. Send data packet to participant
    try {
      await livekitService.sendData(roomName, {
        type: 'TEACHER_CONTROL',
        action: action.toUpperCase(),
        targetIdentity: participantIdentity,
        lectureId: id
      }, [participantIdentity]);
    } catch (dataErr) {
      console.warn('[LiveKit] Control sendData notice:', dataErr.message);
    }

    // 2. Execute server-side Twirp controls where available
    if (action === 'mute_mic' && trackSid) {
      try {
        await livekitService.muteTrack(roomName, participantIdentity, trackSid, true);
      } catch (muteErr) {
        console.warn('[LiveKit] muteTrack notice:', muteErr.message);
      }
    } else if (action === 'remove_participant') {
      try {
        await livekitService.removeParticipant(roomName, participantIdentity);
      } catch (remErr) {
        console.warn('[LiveKit] removeParticipant notice:', remErr.message);
      }
    }

    await logAudit(
      req.user,
      'MODERATE_LIVEKIT_PARTICIPANT',
      'live_class_sessions',
      id,
      `Action ${action} executed on participant ${participantIdentity} in session ${session.title}`
    );

    res.status(200).json({
      success: true,
      data: {
        sessionId: id,
        participantIdentity,
        action,
        timestamp: new Date().toISOString()
      },
      message: `Participant action ${action} applied successfully.`
    });
  } catch (err) {
    next(err);
  }
});

export default router;
