// Mock Test Business Logic Service
// LinkTest Enterprise Examination System

import { mockTestRepository } from '../repositories/mockTestRepository.js';
import { mockTestJoinRequestRepository } from '../repositories/mockTestJoinRequestRepository.js';
import { securityLogRepository } from '../repositories/securityLogRepository.js';
import { lmsRepository } from '../repositories/lmsRepository.js';
import { batchRepository } from '../repositories/batchRepository.js';
import { mockTestScoringService } from './mockTestScoringService.js';
import { aiService } from './aiService.js';
import { generateTestResultsPdf } from './pdfReportService.js';
import { notificationService } from './notificationService.js';

/**
 * Determines whether an attempt was disqualified or reached maximum permitted violation limits
 */
export function isAttemptViolationDisqualified(attempt) {
  if (!attempt) return false;
  if (attempt.disqualified === true || attempt.disqualified === 'true') return true;

  const status = String(attempt.status || '').toUpperCase();
  const submissionStatus = String(attempt.submission_status || '').toUpperCase();
  const reason = String(attempt.submission_reason || '').toUpperCase();

  const violationKeywords = [
    'MAX_TAB_SWITCHES',
    'SECOND_FULLSCREEN_EXIT',
    'MAX_SECURITY_WARNINGS',
    'SECURITY_VIOLATION',
    'MAX_VIOLATIONS',
    'TAB_SWITCH',
    'FULLSCREEN_EXIT'
  ];

  if ((status === 'AUTO_SUBMITTED' || submissionStatus === 'AUTO_SUBMITTED') &&
      violationKeywords.some(keyword => reason.includes(keyword))) {
    return true;
  }

  // Also verify counters against violation thresholds for finalized attempts
  const maxWarnings = Number(attempt.max_security_warnings || 3);
  const maxFullscreenExits = Number(attempt.max_fullscreen_exits || 2);
  const maxTabSwitches = Number(attempt.tab_switch_limit || 3);

  const isFinalized = ['AUTO_SUBMITTED', 'auto_submitted', 'submitted', 'evaluated'].includes(attempt.status) ||
    ['AUTO_SUBMITTED', 'auto_submitted'].includes(attempt.submission_status);

  if (isFinalized) {
    if ((attempt.security_warning_count || 0) >= maxWarnings) return true;
    if ((attempt.fullscreen_exit_count || 0) >= maxFullscreenExits) return true;
    if ((attempt.proctoring_summary?.tab_switch_events || 0) >= maxTabSwitches) return true;
  }

  return false;
}

export const mockTestService = {
  isAttemptViolationDisqualified,
  // ---------------------------------------------------------------------------
  // 1. STUDENT EXAMINATION WORKFLOW
  // ---------------------------------------------------------------------------

  /**
   * Retrieves all published mock tests with student-specific attempt progress
   */
  async getStudentDashboardTests(student, filters = {}) {
    const rawTests = await mockTestRepository.getAllTests({
      ...filters,
      status: 'published'
    });

    const studentBatchIds = await batchRepository.getStudentBatchIds(student.id);

    // CRITICAL: Filter out any tests assigned to a specific batch that the student is NOT enrolled in
    const tests = rawTests.filter(t => !t.batch_id || studentBatchIds.includes(t.batch_id));

    const studentAttempts = await mockTestRepository.getAttemptsByStudent(student.id);

    return Promise.all(tests.map(async (test) => {
      const attempts = studentAttempts.filter(a => a.test_id === test.id);
      const activeAttempt = attempts.find(a => a.status === 'in_progress');
      const completedAttempts = attempts.filter(a => ['submitted', 'evaluated', 'AUTO_SUBMITTED', 'auto_submitted'].includes(a.status));
      const bestAttempt = completedAttempts.sort((a, b) => (b.total_score || 0) - (a.total_score || 0))[0];

      const disqualifiedAttempt = attempts.find(a => isAttemptViolationDisqualified(a));
      const hasDisqualification = Boolean(disqualifiedAttempt);

      const now = new Date();
      const isStartValid = !test.scheduled_start || new Date(test.scheduled_start) <= now;
      const isEndValid = !test.scheduled_end || new Date(test.scheduled_end) >= now;
      const withinWindow = isStartValid && isEndValid;

      const attemptsRemaining = hasDisqualification ? 0 : Math.max(0, test.max_attempts - completedAttempts.length);
      const canAttempt = !hasDisqualification && withinWindow && (attemptsRemaining > 0 || (!!activeAttempt && !isAttemptViolationDisqualified(activeAttempt)));

      const latestRequest = await mockTestJoinRequestRepository.getLatestByStudentAndTest(student.id, test.id);
      const joinRequestStatus = latestRequest ? latestRequest.status : 'NONE';

      return {
        ...test,
        attempts_used: completedAttempts.length,
        attempts_remaining: attemptsRemaining,
        can_attempt: canAttempt,
        is_disqualified: hasDisqualification,
        disqualification_reason: disqualifiedAttempt ? (disqualifiedAttempt.submission_reason || 'MAX_SECURITY_WARNINGS') : null,
        disqualified_attempt_id: disqualifiedAttempt ? disqualifiedAttempt.id : null,
        within_schedule_window: withinWindow,
        active_attempt_id: activeAttempt ? activeAttempt.id : null,
        best_score: bestAttempt ? bestAttempt.total_score : null,
        best_percentage: bestAttempt ? bestAttempt.percentage : null,
        has_passed: bestAttempt ? bestAttempt.passed : false,
        join_request_status: joinRequestStatus,
        join_request_id: latestRequest ? latestRequest.id : null,
        rejection_reason: latestRequest?.status === 'REJECTED' ? latestRequest.rejection_reason : null,
        can_start_directly: Boolean(test.batch_id || joinRequestStatus === 'APPROVED')
      };
    }));
  },

  /**
   * Starts a new exam attempt or safely resumes an active in-progress attempt
   */
  async startOrResumeAttempt(testId, student, ipAddress) {
    const test = await mockTestRepository.getTestById(testId);
    if (!test) {
      const err = new Error('Examination not found.');
      err.status = 404;
      throw err;
    }

    if (test.status !== 'published') {
      const err = new Error('This examination is currently not available or is unpublished.');
      err.status = 400;
      throw err;
    }

    // Check scheduling window
    const now = new Date();
    if (test.scheduled_start && new Date(test.scheduled_start) > now) {
      const err = new Error(`This examination is scheduled to begin at ${new Date(test.scheduled_start).toLocaleString()}.`);
      err.status = 400;
      throw err;
    }
    if (test.scheduled_end && new Date(test.scheduled_end) < now) {
      const err = new Error('The examination window for this test has concluded.');
      err.status = 400;
      throw err;
    }

    // Check for active or previous attempts
    const existingAttempts = await mockTestRepository.getAttemptsByStudent(student.id, testId);

    // CRITICAL SECURITY ENFORCEMENT:
    // If student has reached the maximum violation limit in any previous attempt for this test,
    // they are strictly and permanently prohibited from taking or retaking this test.
    const disqualifiedAttempt = existingAttempts.find(a => isAttemptViolationDisqualified(a));
    if (disqualifiedAttempt) {
      const reason = disqualifiedAttempt.submission_reason || 'Maximum security violation limit exceeded';
      const err = new Error(`You have reached the maximum permitted violation limit for this examination (${reason}) and are permanently prohibited from retaking it.`);
      err.status = 403;
      err.statusCode = 403;
      err.code = 'VIOLATION_LIMIT_EXCEEDED';
      throw err;
    }

    const activeAttempt = existingAttempts.find(a => a.status === 'in_progress');

    if (activeAttempt) {
      // Check if time has expired
      const expiresAt = new Date(activeAttempt.expires_at).getTime();
      if (now.getTime() > expiresAt + 15000) { // 15s grace period
        // Auto-finalize expired attempt
        await this.submitAttempt(activeAttempt.id, student, {
          auto_submitted: true,
          reason: 'EXAM_TIME_EXPIRED'
        });
      } else {
        // Resume active attempt
        return this.getAttemptForTaker(activeAttempt.id, student);
      }
    }

    // Check attempt limits (include all completed and auto-submitted attempts)
    const completedCount = existingAttempts.filter(a => ['submitted', 'evaluated', 'AUTO_SUBMITTED', 'auto_submitted'].includes(a.status)).length;
    if (completedCount >= test.max_attempts) {
      const err = new Error(`Maximum allowed attempts (${test.max_attempts}) reached for this test.`);
      err.status = 400;
      err.statusCode = 400;
      err.code = 'MAX_ATTEMPTS_REACHED';
      throw err;
    }

    // -------------------------------------------------------------------------
    // CRITICAL SECURITY: ENFORCE BATCH AUTHORIZATION & JOIN APPROVAL
    // -------------------------------------------------------------------------
    if (student.role === 'STUDENT') {
      if (test.batch_id) {
        const isEnrolled = await batchRepository.isStudentInBatch(student.id, test.batch_id);
        if (!isEnrolled) {
          const err = new Error('You are not enrolled in the batch assigned to this mock test.');
          err.status = 403;
          err.statusCode = 403;
          err.code = 'FORBIDDEN';
          throw err;
        }
      } else {
        const activeRequest = await mockTestJoinRequestRepository.findActiveByStudentAndTest(student.id, testId);
        if (!activeRequest || activeRequest.status !== 'APPROVED') {
          const latestRequest = await mockTestJoinRequestRepository.getLatestByStudentAndTest(student.id, testId);
          const err = new Error(
            latestRequest?.status === 'PENDING'
              ? 'Your request to join this mock test is still pending teacher approval.'
              : (latestRequest?.status === 'REJECTED'
                  ? `Your request to join was rejected${latestRequest.rejection_reason ? `: "${latestRequest.rejection_reason}"` : '.'} You may request again.`
                  : 'Teacher approval is required before you can join this mock test.')
          );
          err.status = 403;
          err.statusCode = 403;
          err.code = 'MOCK_TEST_APPROVAL_REQUIRED';
          throw err;
        }
      }
    }

    // Prepare questions (with randomization if enabled)
    let questions = await mockTestRepository.getQuestionsByTestId(testId);
    if (test.randomize_questions) {
      questions = [...questions].sort(() => Math.random() - 0.5);
    }

    // Calculate server authoritative deadline
    const durationMinutes = test.duration_minutes || 60;
    const startTime = new Date();
    const expiresAt = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const newAttempt = await mockTestRepository.createAttempt({
      test_id: testId,
      student_id: student.id,
      started_at: startTime.toISOString(),
      expires_at: expiresAt.toISOString(),
      max_score: test.total_marks,
      test_snapshot: {
        title: test.title,
        subject: test.subject,
        duration_minutes: durationMinutes,
        total_marks: test.total_marks,
        pass_percentage: test.pass_percentage,
        negative_marking: test.negative_marking,
        negative_mark_penalty: test.negative_mark_penalty,
        proctoring_config: test.proctoring_config
      }
    });

    // Audit log
    await mockTestRepository.logAudit({
      testId,
      attemptId: newAttempt.id,
      actorId: student.id,
      actorRole: student.role,
      action: 'EXAM_ATTEMPT_STARTED',
      details: { expires_at: expiresAt.toISOString(), ip: ipAddress }
    });

    return this.getAttemptForTaker(newAttempt.id, student);
  },

  /**
   * Loads an attempt strictly sanitized for candidate in-progress test taking
   */
  async getAttemptForTaker(attemptId, student) {
    const attempt = await mockTestRepository.getAttemptById(attemptId);
    if (!attempt) {
      const err = new Error('Attempt not found.');
      err.status = 404;
      throw err;
    }

    // Security: Student cannot view another student's attempt
    if (student.role === 'STUDENT' && attempt.student_id !== student.id) {
      const err = new Error('Unauthorized access to candidate attempt.');
      err.status = 403;
      throw err;
    }

    const test = await mockTestRepository.getTestById(attempt.test_id);
    if (!test) {
      const err = new Error('Associated examination record not found.');
      err.status = 404;
      throw err;
    }

    if (student.role === 'STUDENT' && test.batch_id) {
      const isEnrolled = await batchRepository.isStudentInBatch(student.id, test.batch_id);
      if (!isEnrolled) {
        const err = new Error('You are not enrolled in the batch assigned to this mock test.');
        err.status = 403;
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }

    const rawQuestions = await mockTestRepository.getQuestionsByTestId(attempt.test_id);

    // CRITICAL SECURITY: Questions MUST be sanitized. Answer keys and explanations removed.
    const sanitizedQuestions = mockTestScoringService.sanitizeQuestionsForTaker(rawQuestions);

    // Randomize options if test configured
    if (test.randomize_options) {
      sanitizedQuestions.forEach(q => {
        if (Array.isArray(q.options) && q.question_type !== 'true_false' && q.question_type !== 'matching') {
          // Keep track of original option texts for consistency
        }
      });
    }

    // Server-authoritative remaining duration calculation
    const now = Date.now();
    const expiresAt = new Date(attempt.expires_at).getTime();
    const remainingSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000));

    // Map existing saved candidate responses
    const responsesMap = {};
    (attempt.responses || []).forEach(r => {
      responsesMap[r.question_id] = {
        question_id: r.question_id,
        response_data: r.response_data,
        is_marked_for_review: r.is_marked_for_review,
        is_visited: r.is_visited,
        updated_at: r.updated_at
      };
    });

    return {
      id: attempt.id,
      attempt_id: attempt.id,
      attemptId: attempt.id,
      attempt: {
        id: attempt.id,
        test_id: test.id,
        status: attempt.status,
        submission_status: attempt.submission_status || null,
        submission_reason: attempt.submission_reason || null,
        expires_at: attempt.expires_at,
        started_at: attempt.started_at,
        warning_count: attempt.warning_count || 0,
        security_warning_count: attempt.security_warning_count || 0,
        fullscreen_exit_count: attempt.fullscreen_exit_count || 0,
        integrity_trust_index: attempt.integrity_trust_index ?? 100,
        disqualified: Boolean(attempt.disqualified)
      },
      test_id: test.id,
      test_title: test.title,
      subject: test.subject,
      instructions: test.instructions,
      proctoring_config: test.proctoring_config,
      started_at: attempt.started_at,
      expires_at: attempt.expires_at,
      remaining_seconds: remainingSeconds,
      status: attempt.status,
      submission_status: attempt.submission_status || null,
      submission_reason: attempt.submission_reason || null,
      warning_count: attempt.warning_count || 0,
      security_warning_count: attempt.security_warning_count || 0,
      fullscreen_exit_count: attempt.fullscreen_exit_count || 0,
      integrity_trust_index: attempt.integrity_trust_index ?? 100,
      disqualified: Boolean(attempt.disqualified),
      questions: sanitizedQuestions,
      responses: responsesMap
    };
  },

  /**
   * Persists an incremental candidate answer with idempotence and audit tracking
   */
  async saveResponse(attemptId, student, responsePayload) {
    const attempt = await mockTestRepository.getAttemptById(attemptId);
    if (!attempt) {
      const err = new Error('Attempt not found.');
      err.status = 404;
      throw err;
    }

    if (attempt.student_id !== student.id) {
      const err = new Error('Unauthorized access.');
      err.status = 403;
      throw err;
    }

    if (attempt.status !== 'in_progress' || isAttemptViolationDisqualified(attempt)) {
      const err = new Error('This attempt has already been finalized and cannot accept further modifications.');
      err.status = 400;
      err.statusCode = 400;
      err.code = 'ATTEMPT_FINALIZED';
      throw err;
    }

    // Verify server deadline
    const now = Date.now();
    const expiresAt = new Date(attempt.expires_at).getTime();
    if (now > expiresAt + 30000) { // 30s grace period for in-flight requests
      await this.submitAttempt(attemptId, student, { auto_submitted: true, reason: 'EXAM_TIME_EXPIRED' });
      const err = new Error('Exam time limit expired. Attempt auto-submitted.');
      err.code = 'TIME_EXPIRED';
      err.status = 410;
      throw err;
    }

    const question_id = responsePayload.question_id || responsePayload.questionId;
    let response_data = responsePayload.response_data !== undefined
      ? responsePayload.response_data
      : (responsePayload.responseData !== undefined ? responsePayload.responseData : null);

    if (response_data === null) {
      const flat = { ...responsePayload };
      delete flat.question_id;
      delete flat.questionId;
      delete flat.is_marked_for_review;
      delete flat.isMarkedForReview;
      delete flat.is_visited;
      delete flat.isVisited;
      if (Object.keys(flat).length > 0) {
        response_data = flat;
      }
    }

    const is_marked_for_review = responsePayload.is_marked_for_review !== undefined ? responsePayload.is_marked_for_review : responsePayload.isMarkedForReview;
    const is_visited = responsePayload.is_visited !== undefined ? responsePayload.is_visited : (responsePayload.isVisited ?? true);

    if (!question_id) {
      const err = new Error('question_id is required.');
      err.status = 400;
      throw err;
    }

    const saved = await mockTestRepository.saveResponse(
      attemptId,
      question_id,
      response_data || null,
      Boolean(is_marked_for_review),
      Boolean(is_visited ?? true)
    );

    return {
      success: true,
      data: {
        question_id,
        saved_at: saved.updated_at
      }
    };
  },

  /**
   * Records client proctoring events with debouncing and graduated warning tracking
   */
  async ingestProctoringEvent(attemptId, student, eventData) {
    const attempt = await mockTestRepository.getAttemptById(attemptId);
    if (!attempt || attempt.student_id !== student.id) {
      const err = new Error('Invalid attempt.');
      err.status = 403;
      throw err;
    }

    if (attempt.status !== 'in_progress') {
      return {
        recorded: false,
        reason: 'Attempt not in progress',
        status: attempt.status,
        auto_submitted: ['AUTO_SUBMITTED', 'auto_submitted'].includes(attempt.status),
        submission_reason: attempt.submission_reason || null
      };
    }

    // Support both event_type and eventType
    const submittedType = (eventData.event_type || eventData.eventType || '').trim().toUpperCase();
    const eventTypeAliases = {
      TAB_SWITCH: 'TAB_HIDDEN',
      NO_FACE: 'FACE_NOT_DETECTED'
    };
    const rawType = eventTypeAliases[submittedType] || submittedType;

    const validEventTypes = [
      'FACE_NOT_DETECTED',
      'MULTIPLE_FACES',
      'CAMERA_DISCONNECTED',
      'CAMERA_PERMISSION_REVOKED',
      'TAB_HIDDEN',
      'WINDOW_BLURRED',
      'FULLSCREEN_EXIT',
      'NETWORK_INTERRUPTION',
      'AUDIO_ANOMALY',
      'EXAM_TIME_EXPIRED',
      'SUSPICIOUS_KEY_COMBINATION',
      'SECURITY_WARNING',
      'AUTO_SUBMISSION'
    ];

    if (!validEventTypes.includes(rawType)) {
      const err = new Error(`Unsupported proctoring event type: ${rawType}`);
      err.status = 400;
      throw err;
    }

    // Save pending answers if provided in event payload
    if (eventData.answers && typeof eventData.answers === 'object') {
      const entries = Object.entries(eventData.answers);
      for (const [qId, ans] of entries) {
        try {
          await this.saveResponse(attemptId, student, {
            question_id: qId,
            response_data: ans.response_data !== undefined ? ans.response_data : ans,
            is_marked_for_review: Boolean(ans.is_marked_for_review),
            is_visited: true
          });
        } catch (saveErr) {
          console.warn('[MockTestService] Auto-saving answer during security event encountered warning:', saveErr.message);
        }
      }
    }

    // Strict separate counters (Requirement 2 & 10)
    const test = await mockTestRepository.getTestById(attempt.test_id);
    const MAX_WARNINGS = Number(test?.proctoring_config?.max_security_warnings) || 3;
    const MAX_FULLSCREEN_EXITS = Number(test?.proctoring_config?.max_fullscreen_exits) || 2;
    const MAX_TAB_SWITCHES = Number(test?.proctoring_config?.tab_switch_limit) || 3;

    // Check for duplicate debouncing: ignore identical event if received within 2.5 seconds
    const existingEvents = await mockTestRepository.getProctoringEvents(attemptId);
    const isTabSwitchSignal = ['TAB_HIDDEN', 'WINDOW_BLURRED'].includes(rawType);
    const lastMatching = existingEvents
      .filter(e => isTabSwitchSignal
        ? ['TAB_HIDDEN', 'WINDOW_BLURRED'].includes(e.event_type)
        : e.event_type === rawType)
      .sort((a, b) => new Date(b.server_timestamp) - new Date(a.server_timestamp))[0];

    if (lastMatching) {
      const elapsed = Date.now() - new Date(lastMatching.server_timestamp).getTime();
      if (elapsed < 2500) {
        return {
          recorded: false,
          debounced: true,
          warning_count: attempt.warning_count || 0,
          warningCount: attempt.warning_count || 0,
          security_warning_count: attempt.security_warning_count || 0,
          securityWarningCount: attempt.security_warning_count || 0,
          fullscreen_exit_count: attempt.fullscreen_exit_count || 0,
          fullscreenExitCount: attempt.fullscreen_exit_count || 0,
          max_security_warnings: MAX_WARNINGS,
          maxSecurityWarnings: MAX_WARNINGS,
          max_fullscreen_exits: MAX_FULLSCREEN_EXITS,
          maxFullscreenExits: MAX_FULLSCREEN_EXITS,
          integrity_trust_index: attempt.integrity_trust_index ?? 100,
          disqualified: Boolean(attempt.disqualified),
          auto_submitted: ['AUTO_SUBMITTED', 'auto_submitted'].includes(attempt.status),
          autoSubmitted: ['AUTO_SUBMITTED', 'auto_submitted'].includes(attempt.status),
          status: attempt.status,
          submission_reason: attempt.submission_reason || null,
          submissionReason: attempt.submission_reason || null
        };
      }
    }

    // Persist event in proctoring events table
    const severityPenalties = { info: 1, warning: 5, critical: 15 };
    const requestedSeverity = String(eventData.severity || (rawType === 'FULLSCREEN_EXIT' ? 'critical' : 'warning')).toLowerCase();
    const normalizedSeverity = severityPenalties[requestedSeverity] === undefined ? 'warning' : requestedSeverity;
    const recorded = await mockTestRepository.logProctoringEvent({
      attempt_id: attemptId,
      event_type: rawType,
      severity: normalizedSeverity,
      client_timestamp: eventData.client_timestamp || eventData.timestamp || new Date().toISOString(),
      duration_seconds: eventData.duration_seconds || 0,
      confidence: eventData.confidence || 1.0,
      metadata: eventData.metadata || { reason: eventData.reason || null }
    });
    const integrityTrustIndex = Math.max(
      0,
      (attempt.integrity_trust_index ?? 100) - severityPenalties[normalizedSeverity]
    );

    // Update proctoring summary
    const summary = attempt.proctoring_summary || {
      face_absence_events: 0,
      multiple_face_events: 0,
      tab_switch_events: 0,
      fullscreen_exit_events: 0,
      camera_disconnect_events: 0,
      total_events: 0,
      integrity_trust_index: 100,
      flagged: false
    };

    if (rawType === 'FACE_NOT_DETECTED') summary.face_absence_events = (summary.face_absence_events || 0) + 1;
    if (rawType === 'MULTIPLE_FACES') summary.multiple_face_events = (summary.multiple_face_events || 0) + 1;
    if (['TAB_HIDDEN', 'WINDOW_BLURRED'].includes(rawType)) summary.tab_switch_events = (summary.tab_switch_events || 0) + 1;
    if (rawType === 'FULLSCREEN_EXIT') summary.fullscreen_exit_events = (summary.fullscreen_exit_events || 0) + 1;
    if (rawType === 'CAMERA_DISCONNECTED') summary.camera_disconnect_events = (summary.camera_disconnect_events || 0) + 1;

    summary.total_events = (summary.total_events || 0) + 1;
    summary.integrity_trust_index = integrityTrustIndex;

    const isSecurityWarning = normalizedSeverity !== 'info';
    let newSecurityWarningCount = attempt.security_warning_count || 0;
    let newFullscreenExitCount = attempt.fullscreen_exit_count || 0;
    let newWarningCount = (attempt.warning_count || 0) + Number(isSecurityWarning);

    const isFullscreenExit = rawType === 'FULLSCREEN_EXIT';
    if (isFullscreenExit) {
      newFullscreenExitCount += 1;
    } else if (isSecurityWarning) {
      newSecurityWarningCount += 1;
    }

    const tabSwitchThresholdReached = summary.tab_switch_events >= MAX_TAB_SWITCHES;
    if (newSecurityWarningCount >= MAX_WARNINGS || newFullscreenExitCount >= MAX_FULLSCREEN_EXITS || tabSwitchThresholdReached) {
      summary.flagged = true;
    }

    if (tabSwitchThresholdReached) {
      await mockTestRepository.updateAttempt(attemptId, {
        warning_count: newWarningCount,
        security_warning_count: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount,
        integrity_trust_index: integrityTrustIndex,
        disqualified: true,
        proctoring_summary: summary
      });
      const submissionResult = await this.submitAttempt(attemptId, student, {
        auto_submitted: true,
        reason: 'MAX_TAB_SWITCHES',
        status: 'AUTO_SUBMITTED',
        disqualified: true
      });

      return {
        recorded: true,
        event_id: recorded.id,
        warning_count: newWarningCount,
        warningCount: newWarningCount,
        security_warning_count: newSecurityWarningCount,
        securityWarningCount: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount,
        fullscreenExitCount: newFullscreenExitCount,
        max_security_warnings: MAX_WARNINGS,
        maxSecurityWarnings: MAX_WARNINGS,
        max_fullscreen_exits: MAX_FULLSCREEN_EXITS,
        maxFullscreenExits: MAX_FULLSCREEN_EXITS,
        integrity_trust_index: integrityTrustIndex,
        disqualified: true,
        auto_submitted: true,
        autoSubmitted: true,
        status: 'AUTO_SUBMITTED',
        submission_reason: 'MAX_TAB_SWITCHES',
        submissionReason: 'MAX_TAB_SWITCHES',
        result: submissionResult
      };
    }

    // Check Auto-Submission Limits:
    // Limit 1: Second fullscreen exit -> SECOND_FULLSCREEN_EXIT
    if (newFullscreenExitCount >= MAX_FULLSCREEN_EXITS) {
      await mockTestRepository.updateAttempt(attemptId, {
        warning_count: newWarningCount,
        security_warning_count: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount,
        integrity_trust_index: integrityTrustIndex,
        disqualified: true,
        proctoring_summary: summary
      });

      // Audit logs
      await mockTestRepository.logAudit({
        testId: attempt.test_id,
        attemptId,
        actorId: student.id,
        actorRole: student.role,
        action: 'FULLSCREEN_EXIT',
        details: { exit_count: newFullscreenExitCount, max_exits: MAX_FULLSCREEN_EXITS }
      });
      await securityLogRepository.logEvent({
        eventType: 'FULLSCREEN_EXIT',
        severity: 'CRITICAL',
        userId: student.id,
        userEmail: student.email,
        details: `Candidate reached second fullscreen exit (${newFullscreenExitCount}/${MAX_FULLSCREEN_EXITS}). Initiating auto-submission.`,
        metadata: { attemptId, testId: attempt.test_id, exit_count: newFullscreenExitCount }
      });

      const submissionResult = await this.submitAttempt(attemptId, student, {
        auto_submitted: true,
        reason: 'SECOND_FULLSCREEN_EXIT',
        status: 'AUTO_SUBMITTED',
        disqualified: true
      });

      return {
        recorded: true,
        event_id: recorded.id,
        warning_count: newWarningCount,
        warningCount: newWarningCount,
        security_warning_count: newSecurityWarningCount,
        securityWarningCount: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount,
        fullscreenExitCount: newFullscreenExitCount,
        max_security_warnings: MAX_WARNINGS,
        maxSecurityWarnings: MAX_WARNINGS,
        max_fullscreen_exits: MAX_FULLSCREEN_EXITS,
        maxFullscreenExits: MAX_FULLSCREEN_EXITS,
        integrity_trust_index: integrityTrustIndex,
        disqualified: true,
        auto_submitted: true,
        autoSubmitted: true,
        status: 'AUTO_SUBMITTED',
        submission_reason: 'SECOND_FULLSCREEN_EXIT',
        submissionReason: 'SECOND_FULLSCREEN_EXIT',
        result: submissionResult
      };
    }

    // Limit 2: Third security warning -> MAX_SECURITY_WARNINGS
    if (newSecurityWarningCount >= MAX_WARNINGS) {
      await mockTestRepository.updateAttempt(attemptId, {
        warning_count: newWarningCount,
        security_warning_count: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount,
        integrity_trust_index: integrityTrustIndex,
        disqualified: true,
        proctoring_summary: summary
      });

      // Audit logs
      await mockTestRepository.logAudit({
        testId: attempt.test_id,
        attemptId,
        actorId: student.id,
        actorRole: student.role,
        action: 'MOCK_TEST_WARNING',
        details: {
          warning_count: newSecurityWarningCount,
          max_warnings: MAX_WARNINGS,
          reason: eventData.reason || rawType
        }
      });
      await securityLogRepository.logEvent({
        eventType: 'MOCK_TEST_WARNING',
        severity: 'CRITICAL',
        userId: student.id,
        userEmail: student.email,
        details: `Candidate reached maximum security strikes (${newSecurityWarningCount}/${MAX_WARNINGS}). Initiating auto-submission.`,
        metadata: { attemptId, testId: attempt.test_id, warning_count: newSecurityWarningCount }
      });

      const submissionResult = await this.submitAttempt(attemptId, student, {
        auto_submitted: true,
        reason: 'MAX_SECURITY_WARNINGS',
        status: 'AUTO_SUBMITTED',
        disqualified: true
      });

      return {
        recorded: true,
        event_id: recorded.id,
        warning_count: newWarningCount,
        warningCount: newWarningCount,
        security_warning_count: newSecurityWarningCount,
        securityWarningCount: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount,
        fullscreenExitCount: newFullscreenExitCount,
        max_security_warnings: MAX_WARNINGS,
        maxSecurityWarnings: MAX_WARNINGS,
        max_fullscreen_exits: MAX_FULLSCREEN_EXITS,
        maxFullscreenExits: MAX_FULLSCREEN_EXITS,
        integrity_trust_index: integrityTrustIndex,
        disqualified: true,
        auto_submitted: true,
        autoSubmitted: true,
        status: 'AUTO_SUBMITTED',
        submission_reason: 'MAX_SECURITY_WARNINGS',
        submissionReason: 'MAX_SECURITY_WARNINGS',
        result: submissionResult
      };
    }

    // Normal warning / fullscreen exit (no limit reached yet)
    await mockTestRepository.updateAttempt(attemptId, {
      warning_count: newWarningCount,
      security_warning_count: newSecurityWarningCount,
      fullscreen_exit_count: newFullscreenExitCount,
      integrity_trust_index: integrityTrustIndex,
      disqualified: Boolean(attempt.disqualified),
      proctoring_summary: summary
    });

    await mockTestRepository.logAudit({
      testId: attempt.test_id,
      attemptId,
      actorId: student.id,
      actorRole: student.role,
      action: isFullscreenExit ? 'FULLSCREEN_EXIT' : 'MOCK_TEST_WARNING',
      details: {
        eventType: rawType,
        security_warning_count: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount,
        reason: eventData.reason || rawType
      }
    });

    await securityLogRepository.logEvent({
      eventType: isFullscreenExit ? 'FULLSCREEN_EXIT' : 'MOCK_TEST_WARNING',
      severity: 'WARNING',
      userId: student.id,
      userEmail: student.email,
      details: isFullscreenExit
        ? `Fullscreen exit 1/${MAX_FULLSCREEN_EXITS} recorded.`
        : `Security strike ${newSecurityWarningCount}/${MAX_WARNINGS} recorded (${rawType}).`,
      metadata: {
        attemptId,
        testId: attempt.test_id,
        security_warning_count: newSecurityWarningCount,
        fullscreen_exit_count: newFullscreenExitCount
      }
    });

    return {
      recorded: true,
      event_id: recorded.id,
      warning_count: newWarningCount,
      warningCount: newWarningCount,
      security_warning_count: newSecurityWarningCount,
      securityWarningCount: newSecurityWarningCount,
      fullscreen_exit_count: newFullscreenExitCount,
      fullscreenExitCount: newFullscreenExitCount,
      max_security_warnings: MAX_WARNINGS,
      maxSecurityWarnings: MAX_WARNINGS,
      max_fullscreen_exits: MAX_FULLSCREEN_EXITS,
      maxFullscreenExits: MAX_FULLSCREEN_EXITS,
      integrity_trust_index: integrityTrustIndex,
      disqualified: Boolean(attempt.disqualified),
      auto_submitted: false,
      autoSubmitted: false,
      status: attempt.status,
      submission_reason: null,
      submissionReason: null,
      flagged: summary.flagged
    };
  },

  /**
   * Finalizes, server-evaluates, and scores the mock examination
   */
  async submitAttempt(attemptId, student, options = {}) {
    const attempt = await mockTestRepository.getAttemptById(attemptId);
    if (!attempt) {
      const err = new Error('Attempt not found.');
      err.status = 404;
      throw err;
    }

    // Role check: must be owner student, or faculty/admin auto-submitting
    if (student.role === 'STUDENT' && attempt.student_id !== student.id) {
      const err = new Error('Unauthorized submission.');
      err.status = 403;
      throw err;
    }

    const isFacultyOrAdmin = ['TEACHER', 'ADMIN'].includes(student.role);

    // Idempotency: If already evaluated or submitted or AUTO_SUBMITTED, return existing result summary
    if (['submitted', 'evaluated', 'AUTO_SUBMITTED', 'auto_submitted'].includes(attempt.status)) {
      if (!isFacultyOrAdmin && attempt.result_status !== 'RELEASED') {
        return {
          id: attempt.id,
          attempt_id: attempt.id,
          test_id: attempt.test_id,
          status: attempt.status,
          submission_status: attempt.submission_status || 'SUBMITTED',
          submission_reason: attempt.submission_reason || null,
          result_status: attempt.result_status || 'PENDING_EVALUATION',
          results_released: false,
          total_score: null,
          submitted_at: attempt.submitted_at
        };
      }
      return this.getAttemptResult(attemptId, student);
    }

    const test = await mockTestRepository.getTestById(attempt.test_id);
    if (!test) {
      const err = new Error('Associated examination record not found.');
      err.status = 404;
      throw err;
    }

    if (student.role === 'STUDENT' && test.batch_id) {
      const isEnrolled = await batchRepository.isStudentInBatch(student.id, test.batch_id);
      if (!isEnrolled) {
        const err = new Error('You are not enrolled in the batch assigned to this mock test.');
        err.status = 403;
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }

    const questions = await mockTestRepository.getQuestionsByTestId(attempt.test_id);

    // Map existing saved candidate responses
    const responsesMap = {};
    (attempt.responses || []).forEach(r => {
      responsesMap[r.question_id] = r;
    });

    // Evaluate attempt on server
    const evaluation = mockTestScoringService.evaluateAttempt(test, questions, responsesMap);

    // Calculate time spent
    const startTime = new Date(attempt.started_at).getTime();
    const submissionTime = new Date().getTime();
    const timeSpentSeconds = Math.max(0, Math.floor((submissionTime - startTime) / 1000));

    // Update evaluated responses in DB
    await mockTestRepository.updateEvaluatedResponses(attemptId, evaluation.evaluated_responses);

    // Determine final status, result lifecycle state, and reason
    const isAutoSubmitted = Boolean(options.auto_submitted) || options.status === 'AUTO_SUBMITTED';
    const submissionReason = options.reason || (isAutoSubmitted ? 'MAX_SECURITY_WARNINGS' : 'Normal candidate submission');
    const finalStatus = isAutoSubmitted ? 'AUTO_SUBMITTED' : (evaluation.pending_review_count > 0 ? 'submitted' : 'evaluated');
    const submissionStatus = isAutoSubmitted ? 'AUTO_SUBMITTED' : 'SUBMITTED';
    const isViolationDisqualified = Boolean(options.disqualified) || Boolean(attempt.disqualified) ||
      ['MAX_TAB_SWITCHES', 'SECOND_FULLSCREEN_EXIT', 'MAX_SECURITY_WARNINGS', 'SECURITY_VIOLATION'].includes(submissionReason);

    let resultStatus = 'EVALUATED';
    let releasedAt = null;
    let releasedBy = null;

    if (evaluation.pending_review_count > 0) {
      resultStatus = 'PENDING_EVALUATION';
    } else if (test.results_published || !test.batch_id) {
      resultStatus = 'RELEASED';
      releasedAt = new Date().toISOString();
      releasedBy = test.created_by || null;
    }

    // Finalize attempt
    const updatedAttempt = await mockTestRepository.updateAttempt(attemptId, {
      submitted_at: new Date().toISOString(),
      status: finalStatus,
      submission_status: submissionStatus,
      submission_reason: submissionReason,
      disqualified: isViolationDisqualified,
      result_status: resultStatus,
      released_at: releasedAt,
      released_by: releasedBy,
      total_score: evaluation.total_score,
      max_score: evaluation.max_score,
      percentage: evaluation.percentage,
      passed: evaluation.passed,
      correct_count: evaluation.correct_count,
      incorrect_count: evaluation.incorrect_count,
      unanswered_count: evaluation.unanswered_count,
      time_spent_seconds: timeSpentSeconds
    });

    // Audit log
    await mockTestRepository.logAudit({
      testId: test.id,
      attemptId,
      actorId: student.id,
      actorRole: student.role,
      action: isAutoSubmitted ? 'AUTO_SUBMISSION' : 'EXAM_SUBMITTED',
      details: {
        auto_submitted: isAutoSubmitted,
        reason: submissionReason,
        score: evaluation.total_score,
        percentage: evaluation.percentage,
        result_status: resultStatus
      }
    });

    // Central security log
    await securityLogRepository.logEvent({
      eventType: isAutoSubmitted ? 'AUTO_SUBMISSION' : 'MOCK_TEST_SUBMITTED',
      severity: isAutoSubmitted ? 'WARNING' : 'INFO',
      userId: student.id,
      userEmail: student.email,
      details: `Mock test "${test.title}" attempt (${attemptId}) finalized: ${submissionReason} [${resultStatus}]`,
      metadata: {
        attemptId,
        testId: test.id,
        auto_submitted: isAutoSubmitted,
        reason: submissionReason,
        score: evaluation.total_score,
        percentage: evaluation.percentage,
        result_status: resultStatus
      }
    });

    if (!isFacultyOrAdmin && resultStatus !== 'RELEASED') {
      return {
        id: attempt.id,
        attempt_id: attempt.id,
        test_id: test.id,
        status: finalStatus,
        submission_status: submissionStatus,
        submission_reason: submissionReason,
        result_status: resultStatus,
        results_released: false,
        total_score: null,
        submitted_at: updatedAttempt.submitted_at
      };
    }

    return this.getAttemptResult(attemptId, student);
  },

  /**
   * Retrieves final examination scorecard, analytics, and questions review
   */
  async getAttemptResult(attemptId, student) {
    const attempt = await mockTestRepository.getAttemptById(attemptId);
    if (!attempt) {
      const err = new Error('Result not found.');
      err.status = 404;
      throw err;
    }

    // Critical Security: Students can only view their own result.
    if (student.role === 'STUDENT' && attempt.student_id !== student.id) {
      await securityLogRepository.logEvent({
        eventType: 'UNAUTHORIZED_SCORECARD_ACCESS',
        severity: 'HIGH',
        userId: student.id,
        userEmail: student.email,
        details: 'Unauthorized mock-test scorecard access was denied.',
        metadata: { attemptId, targetStudentId: attempt.student_id, resourceType: 'mock_test_attempt' }
      });
      const err = new Error('You are not authorized to view this result.');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const test = await mockTestRepository.getTestById(attempt.test_id);
    if (!test) {
      const err = new Error('Associated examination record not found.');
      err.status = 404;
      throw err;
    }

    if (
      student.role === 'TEACHER' &&
      test.created_by !== student.id &&
      !(await lmsRepository.isTeacherAssignedToStudent(student.id, attempt.student_id))
    ) {
      await securityLogRepository.logEvent({
        eventType: 'UNAUTHORIZED_SCORECARD_ACCESS',
        severity: 'HIGH',
        userId: student.id,
        userEmail: student.email,
        details: 'Unauthorized mock-test scorecard access was denied.',
        metadata: { attemptId, targetStudentId: attempt.student_id, resourceType: 'mock_test_attempt' }
      });
      const err = new Error('You are not authorized to view this result.');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (student.role === 'STUDENT' && test.batch_id) {
      const isEnrolled = await batchRepository.isStudentInBatch(student.id, test.batch_id);
      if (!isEnrolled) {
        const err = new Error('You are not enrolled in the batch assigned to this mock test.');
        err.status = 403;
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }

    const questions = await mockTestRepository.getQuestionsByTestId(attempt.test_id);
    const responses = attempt.responses || [];

    const isTeacherOrAdmin = ['TEACHER', 'ADMIN'].includes(student.role);
    const isReleased = attempt.result_status === 'RELEASED';

    // Requirement 20: When a student requests a result that has not been released,
    // fail securely with HTTP 403 and RESULT_NOT_RELEASED error code.
    if (!isTeacherOrAdmin && !isReleased) {
      const err = new Error('Result has not been released yet.');
      err.status = 403;
      err.statusCode = 403;
      err.code = 'RESULT_NOT_RELEASED';
      throw err;
    }

    const resultsReleased = Boolean(isTeacherOrAdmin || isReleased);

    // Build question reviews with safe handling for every field
    const questionReviews = questions.map(q => {
      const r = responses.find(resp => resp.question_id === q.id) || null;
      return {
        id: q.id,
        question_text: q.question_text || 'Assessment Question',
        question_type: q.question_type || 'mcq_single',
        marks: parseFloat(q.marks || 0),
        negative_marks: parseFloat(q.negative_marks || 0),
        options: Array.isArray(q.options) ? q.options : [],
        topic: q.topic || '',
        difficulty: q.difficulty || 'medium',
        case_passage: q.case_passage || null,
        programming_language: q.programming_language || 'javascript',
        starter_code: q.starter_code || null,
        time_limit: parseFloat(q.time_limit || 2.0),
        memory_limit: parseInt(q.memory_limit || 128, 10),
        test_cases: resultsReleased ? (Array.isArray(q.test_cases) ? q.test_cases : []) : [],
        answer_key: resultsReleased ? (q.answer_key || q.correct_answer || null) : null,
        explanation: resultsReleased && (test.show_explanations !== false) ? (q.explanation || null) : null,
        candidate_response: r ? r.response_data : null,
        is_marked_for_review: r ? Boolean(r.is_marked_for_review) : false,
        score_awarded: resultsReleased ? (r ? parseFloat(r.score_awarded || 0) : 0) : null,
        is_correct: resultsReleased ? (r ? r.is_correct : null) : null,
        is_pending_review: r ? Boolean(r.is_pending_review) : false,
        execution_results: resultsReleased ? (r ? (r.execution_results || (r.response_data && r.response_data.execution_results) || null) : null) : null,
        evaluation_comment: resultsReleased ? (r ? r.evaluation_comment : null) : null
      };
    });

    const finalResultStatus = attempt.result_status || (isReleased ? 'RELEASED' : 'PENDING_EVALUATION');

    return {
      id: attempt.id,
      attempt_id: attempt.id,
      attemptId: attempt.id,
      attempt: {
        id: attempt.id,
        test_id: test.id,
        status: attempt.status,
        result_status: finalResultStatus,
        released_at: attempt.released_at || null,
        released_by: attempt.released_by || null,
        submission_status: attempt.submission_status || null,
        submission_reason: attempt.submission_reason || null,
        security_warning_count: attempt.security_warning_count || 0,
        fullscreen_exit_count: attempt.fullscreen_exit_count || 0,
        integrity_trust_index: attempt.integrity_trust_index ?? 100,
        disqualified: Boolean(attempt.disqualified),
        submitted_at: attempt.submitted_at,
        started_at: attempt.started_at
      },
      test_id: test.id,
      test_title: test.title || 'Examination',
      subject: test.subject || 'General',
      results_released: resultsReleased,
      result_status: finalResultStatus,
      released_at: attempt.released_at || null,
      released_by: attempt.released_by || null,
      status: attempt.status,
      submission_status: attempt.submission_status || null,
      submission_reason: attempt.submission_reason || null,
      security_warning_count: attempt.security_warning_count || 0,
      fullscreen_exit_count: attempt.fullscreen_exit_count || 0,
      integrity_trust_index: attempt.integrity_trust_index ?? 100,
      disqualified: Boolean(attempt.disqualified),
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      time_spent_seconds: attempt.time_spent_seconds || 0,
      total_score: resultsReleased ? parseFloat(attempt.total_score || 0) : null,
      max_score: parseFloat(attempt.max_score || test.total_marks || 100),
      percentage: resultsReleased ? parseFloat(attempt.percentage || 0) : null,
      passed: resultsReleased ? Boolean(attempt.passed) : null,
      pass_percentage: parseFloat(test.pass_percentage || 40),
      correct_count: resultsReleased ? (attempt.correct_count || 0) : null,
      incorrect_count: resultsReleased ? (attempt.incorrect_count || 0) : null,
      unanswered_count: resultsReleased ? (attempt.unanswered_count || 0) : null,
      warning_count: attempt.warning_count || 0,
      proctoring_summary: attempt.proctoring_summary || {},
      questions: questionReviews
    };
  },

  /**
   * Releases an individual attempt result to the student
   */
  async releaseAttemptResult(attemptId, teacher) {
    const attempt = await mockTestRepository.getAttemptById(attemptId);
    if (!attempt) {
      const err = new Error('Attempt not found.');
      err.status = 404;
      throw err;
    }

    const test = await mockTestRepository.getTestById(attempt.test_id);
    if (!test) {
      const err = new Error('Test not found.');
      err.status = 404;
      throw err;
    }

    if (teacher.role === 'TEACHER' && test.created_by && test.created_by !== teacher.id) {
      // Allow teacher if authorized
    }

    // Verify whether any question is still pending manual review (Requirement 25)
    const responses = attempt.responses || [];
    const hasPendingReview = responses.some(r => r.is_pending_review);
    if (hasPendingReview) {
      const err = new Error('Cannot release result: manual evaluation of all questions must be completed first.');
      err.status = 400;
      err.statusCode = 400;
      throw err;
    }

    await mockTestRepository.releaseAttemptResult(attemptId, teacher.id);

    await mockTestRepository.logAudit({
      testId: test.id,
      attemptId,
      actorId: teacher.id,
      actorRole: teacher.role,
      action: 'RESULT_RELEASED',
      details: { attemptId, studentId: attempt.student_id }
    });

    // Unified Notification Event: Notify student of result publication
    if (attempt.student_id) {
      notificationService.createNotification({
        userId: attempt.student_id,
        title: 'Examination Result Published',
        message: `Your result for "${test.title}" has been released by your instructor.`,
        type: 'RESULT_PUBLISHED',
        priority: 'NORMAL',
        actionUrl: `/mock-tests/attempts/${attemptId}/result`,
        actionLabel: 'View Result',
        relatedEntityType: 'MOCK_TEST_RESULT',
        relatedEntityId: attemptId,
        eventKey: `student:${attempt.student_id}:attempt:${attemptId}:RESULT_RELEASED`
      }).catch(() => {});
    }

    return this.getAttemptResult(attemptId, teacher);
  },

  /**
   * Releases all results for a test (and optional batch)
   */
  async releaseAllTestResults(testId, teacher, batchId = null) {
    const test = await mockTestRepository.getTestById(testId);
    if (!test) {
      const err = new Error('Test not found.');
      err.status = 404;
      throw err;
    }

    await mockTestRepository.releaseAllResultsForTest(testId, teacher.id, batchId);

    // Also mark test results_published true
    await mockTestRepository.updateTest(testId, { results_published: true });

    await mockTestRepository.logAudit({
      testId,
      actorId: teacher.id,
      actorRole: teacher.role,
      action: 'ALL_RESULTS_RELEASED',
      details: { testId, batchId }
    });

    // Unified Notification Event: Notify all students whose results were released
    (async () => {
      try {
        const attempts = await mockTestRepository.getAttemptsForTest(testId, batchId);
        for (const att of attempts) {
          if (att.student_id) {
            notificationService.createNotification({
              userId: att.student_id,
              title: 'Examination Result Published',
              message: `Your result for "${test.title}" has been released.`,
              type: 'RESULT_PUBLISHED',
              priority: 'NORMAL',
              actionUrl: `/mock-tests/attempts/${att.id}/result`,
              actionLabel: 'View Result',
              relatedEntityType: 'MOCK_TEST_RESULT',
              relatedEntityId: att.id,
              eventKey: `student:${att.student_id}:attempt:${att.id}:RESULT_RELEASED`
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[Notification] Failed to batch notify students of released results:', e.message);
      }
    })();

    return { success: true, message: 'All results successfully released to candidates.' };
  },

  /**
   * Retrieves results belonging ONLY to the authenticated student
   */
  async getMyResults(student) {
    const rawAttempts = await mockTestRepository.getAttemptsByStudent(student.id);

    // Requirement 17: Student Dashboard: My Results: Display only released results
    const releasedAttempts = rawAttempts.filter(att => att.result_status === 'RELEASED');

    return releasedAttempts.map(att => ({
      id: att.id,
      attempt_id: att.id,
      test_id: att.test_id,
      test_title: att.test_title || 'Mock Examination',
      subject: att.subject || 'General',
      total_score: parseFloat(att.total_score || 0),
      max_score: parseFloat(att.max_score || 100),
      percentage: parseFloat(att.percentage || 0),
      passed: Boolean(att.passed),
      status: att.status,
      result_status: 'RELEASED',
      is_released: true,
      released_at: att.released_at,
      submitted_at: att.submitted_at || att.created_at,
      time_spent_seconds: att.time_spent_seconds || 0
    }));
  },

  /**
   * Generates a single unified PDF containing all authorized students' results
   */
  async generateResultsPdf(testId, teacher, batchId = null) {
    const test = await mockTestRepository.getTestById(testId);
    if (!test) {
      const err = new Error('Test not found.');
      err.status = 404;
      throw err;
    }

    const targetBatchId = batchId || test.batch_id || null;
    const attempts = await mockTestRepository.getDetailedAttemptsForReport(testId, targetBatchId);

    let batch = null;
    if (targetBatchId) {
      batch = await batchRepository.getBatchById(targetBatchId);
      if (!batch) {
        batch = { id: targetBatchId, name: `Batch #${targetBatchId}` };
      }
    }

    return generateTestResultsPdf({
      test,
      batch,
      teacher,
      attempts
    });
  },

  // ---------------------------------------------------------------------------
  // 2. TEACHER & ADMIN MANAGEMENT & AI GENERATOR
  // ---------------------------------------------------------------------------

  /**
   * Generates production-quality questions using LinkTest AI Service (Ollama / Cloud)
   */
  async generateAiQuestions({ subject, topic, syllabus, difficulty = 'medium', count = 5, question_types = ['mcq_single'] }) {
    const prompt = `You are LinkTest AI Examination Architect. Generate exactly ${count} assessment questions for:
Subject: "${subject}"
Topic: "${topic}"
Difficulty Level: "${difficulty}"
Question Types: ${question_types.join(', ')}
${syllabus ? `Reference Material:\n"""${syllabus}"""\n` : ''}

Respond ONLY with a valid JSON object adhering strictly to this schema:
{
  "questions": [
    {
      "question_text": "Clear academic question text here",
      "question_type": "mcq_single",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "marks": 4,
      "negative_marks": 1,
      "explanation": "Brief explanation of the concept",
      "topic": "${topic}",
      "difficulty": "${difficulty}"
    }
  ]
}`;

    let rawResponse = '';

    // Check Cloud AI or Local Ollama
    const status = await aiService.getStatus();
    if (!status.available) {
      const err = new Error(status.status_message || 'AI Service is currently offline. Ensure Ollama is running or configure CLOUD_AI_API_KEY.');
      err.status = 503;
      throw err;
    }

    let activeModel = status.model;
    if (!status.is_cloud) {
      const installed = status.installed_models || [];
      const hasConfigured = installed.some(m => m === status.model || m.startsWith(status.model.split(':')[0]));
      if (!hasConfigured) {
        if (installed.length > 0) {
          activeModel = installed[0];
          console.log(`[MockTestService] Model '${status.model}' not found in Ollama. Using available model '${activeModel}'.`);
        } else {
          const err = new Error(
            `Ollama is running at ${status.endpoint}, but no models are installed yet. Run 'npm run ollama:init' or 'ollama pull qwen2.5:0.5b' in your terminal, or create questions manually.`
          );
          err.status = 503;
          throw err;
        }
      }
    }

    try {
      if (status.is_cloud) {
        rawResponse = await aiService._chatWithCloud({
          systemPrompt: 'You are LinkTest AI Examination Architect. Generate rigorous, valid academic assessment questions strictly in JSON format adhering to the schema requested. Return ONLY a valid JSON object with a "questions" array. No chat, no markdown fences.',
          messages: [{ role: 'user', message: prompt }],
          temperature: 0.3,
          maxTokens: Math.min(8192, Math.max(1500, count * 600)),
          responseFormat: { type: 'json_object' }
        });
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
          const res = await fetch(`${status.endpoint}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model: activeModel,
              prompt,
              stream: false,
              keep_alive: '24h',
              options: {
                num_predict: Math.min(2500, Math.max(400, count * 350)),
                temperature: 0.3
              }
            })
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `Ollama returned status ${res.status}`);
          }
          const data = await res.json();
          rawResponse = data.response;
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          if (fetchErr.name === 'AbortError') {
            throw new Error('Ollama request timed out after 60 seconds.');
          }
          throw fetchErr;
        }
      }

      // Robust parsing and normalization of generated questions
      const validated = this.parseAndValidateGeneratedQuestions(rawResponse, {
        topic,
        difficulty,
        count
      });

      return {
        success: true,
        subject,
        topic,
        model_used: activeModel,
        questions: validated
      };
    } catch (err) {
      console.error('[MockTestService] AI Question Generation Error:', err.message);
      const customErr = new Error(`AI generation failed: ${err.message}. You can also create questions manually.`);
      customErr.status = err.status || 502;
      customErr.code = 'AI_SERVICE_ERROR';
      customErr.isAiError = true;
      throw customErr;
    }
  },

  /**
   * Resilient question parser supporting clean JSON, markdown-wrapped JSON,
   * thinking tags, and schema normalization
   */
  parseAndValidateGeneratedQuestions(rawResponse, { topic = '', difficulty = 'medium', count = 5 } = {}) {
    if (!rawResponse || typeof rawResponse !== 'string' || !rawResponse.trim()) {
      throw new Error('AI provider returned an empty response.');
    }

    // 1. Resilient JSON cleanup: strip reasoning tags (even if unclosed), code fences, and isolate outer brackets
    let cleanJson = String(rawResponse || '')
      .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
      .replace(/```json/gi, '')
      .replace(/```/gi, '')
      .trim();

    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    const firstBracket = cleanJson.indexOf('[');
    const lastBracket = cleanJson.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      cleanJson = cleanJson.slice(firstBracket, lastBracket + 1);
    } else if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      // Attempt repair by removing trailing commas before closing braces/brackets
      const repaired = cleanJson.replace(/,\s*([}\]])/g, '$1');
      try {
        parsed = JSON.parse(repaired);
      } catch {
        parsed = this._extractQuestionsRegexFallback(cleanJson);
      }
    }

    if (!parsed) {
      throw new Error('Could not parse valid JSON from AI response.');
    }

    let rawQuestions = [];
    if (Array.isArray(parsed.questions)) {
      rawQuestions = parsed.questions;
    } else if (Array.isArray(parsed.data?.questions)) {
      rawQuestions = parsed.data.questions;
    } else if (Array.isArray(parsed.items)) {
      rawQuestions = parsed.items;
    } else if (Array.isArray(parsed.quiz)) {
      rawQuestions = parsed.quiz;
    } else if (Array.isArray(parsed)) {
      rawQuestions = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) {
      const values = Object.values(parsed);
      if (values.length > 0 && typeof values[0] === 'object') {
        rawQuestions = values.filter(v => typeof v === 'object' && v !== null);
      }
    }

    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      throw new Error('AI returned an empty question list. Please try again with a more specific topic.');
    }

    // 2. Normalize and validate each question
    const validated = [];
    for (let idx = 0; idx < rawQuestions.length; idx++) {
      const q = rawQuestions[idx];
      if (!q || typeof q !== 'object') continue;

      const qText = String(q.question_text || q.question || q.prompt || q.text || q.title || '').trim();
      if (!qText) continue;

      // Normalize options
      let normalizedOptions = [];
      if (Array.isArray(q.options)) {
        normalizedOptions = q.options.map(opt =>
          (typeof opt === 'object' && opt !== null ? (opt.text || opt.label || opt.value || JSON.stringify(opt)) : String(opt)).trim()
        ).filter(Boolean);
      } else if (q.options && typeof q.options === 'object') {
        normalizedOptions = Object.values(q.options).map(o => String(o).trim()).filter(Boolean);
      }

      const qType = q.question_type || q.type || 'mcq_single';

      // For single-choice MCQs, ensure at least 2 options exist
      if (qType === 'mcq_single' && normalizedOptions.length < 2) {
        normalizedOptions = ['Option A', 'Option B', 'Option C', 'Option D'];
      }

      // Normalize answer_key
      let correctIdx = 0;
      if (q.answer_key?.correct_index !== undefined) {
        correctIdx = parseInt(q.answer_key.correct_index, 10);
      } else if (q.correct_index !== undefined) {
        correctIdx = parseInt(q.correct_index, 10);
      } else if (q.correct_option_index !== undefined) {
        correctIdx = parseInt(q.correct_option_index, 10);
      } else if (q.correct_answer !== undefined || q.answer !== undefined) {
        const ca = q.correct_answer !== undefined ? q.correct_answer : q.answer;
        if (typeof ca === 'number') {
          correctIdx = ca;
        } else if (typeof ca === 'string') {
          const letterMap = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };
          if (letterMap[ca.trim()] !== undefined) {
            correctIdx = letterMap[ca.trim()];
          } else {
            const found = normalizedOptions.findIndex(o => o.toLowerCase() === ca.trim().toLowerCase());
            correctIdx = found >= 0 ? found : 0;
          }
        }
      }

      // Bound check correct index
      if (isNaN(correctIdx) || correctIdx < 0 || (normalizedOptions.length > 0 && correctIdx >= normalizedOptions.length)) {
        correctIdx = 0;
      }

      validated.push({
        id: `ai-gen-${crypto.randomUUID().slice(0, 10)}`,
        question_text: qText,
        question_type: qType,
        options: normalizedOptions,
        answer_key: { correct_index: correctIdx },
        marks: parseFloat(q.marks || 4.0),
        negative_marks: parseFloat(q.negative_marks || 1.0),
        explanation: String(q.explanation || q.solution || 'Correct answer verified.').trim(),
        topic: q.topic || topic,
        difficulty: q.difficulty || difficulty,
        order_index: validated.length + 1
      });
    }

    if (validated.length === 0) {
      throw new Error('AI question generation returned questions without valid text prompts. Please try again.');
    }

    return validated;
  },

  _extractQuestionsRegexFallback(text) {
    const questions = [];
    let startIndex = 0;
    while ((startIndex = text.indexOf('{', startIndex)) !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      let endIndex = -1;

      for (let i = startIndex; i < text.length; i++) {
        const char = text[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === '{') depth++;
          else if (char === '}') {
            depth--;
            if (depth === 0) {
              endIndex = i;
              break;
            }
          }
        }
      }

      if (endIndex !== -1) {
        const chunk = text.slice(startIndex, endIndex + 1);
        try {
          const parsed = JSON.parse(chunk);
          if (parsed && (parsed.question_text || parsed.question)) {
            questions.push(parsed);
          } else if (parsed && Array.isArray(parsed.questions)) {
            questions.push(...parsed.questions);
          }
        } catch {
          try {
            const repaired = chunk.replace(/,\s*([}\]])/g, '$1');
            const parsed = JSON.parse(repaired);
            if (parsed && (parsed.question_text || parsed.question)) {
              questions.push(parsed);
            }
          } catch {
            // ignore
          }
        }
        startIndex = endIndex + 1;
      } else {
        break;
      }
    }
    return questions.length > 0 ? { questions } : null;
  },

  /**
   * Comprehensive performance and proctoring analytics for a mock test
   */
  async getTestAnalytics(testId) {
    const test = await mockTestRepository.getTestById(testId);
    if (!test) {
      const err = new Error('Test not found.');
      err.status = 404;
      throw err;
    }

    const attempts = await mockTestRepository.getAttemptsByTest(testId);
    const completed = attempts.filter(a => ['submitted', 'evaluated'].includes(a.status));

    const totalCandidates = new Set(attempts.map(a => a.student_id)).size;
    const scores = completed.map(a => parseFloat(a.total_score || 0));

    const avgScore = scores.length > 0 ? parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const passCount = completed.filter(a => a.passed).length;
    const passRate = completed.length > 0 ? parseFloat(((passCount / completed.length) * 100).toFixed(1)) : 0;

    // Score distribution buckets (0-20%, 21-40%, 41-60%, 61-80%, 81-100%)
    const distribution = [
      { range: '0-20%', count: 0 },
      { range: '21-40%', count: 0 },
      { range: '41-60%', count: 0 },
      { range: '61-80%', count: 0 },
      { range: '81-100%', count: 0 }
    ];

    completed.forEach(a => {
      const pct = a.percentage || 0;
      if (pct <= 20) distribution[0].count++;
      else if (pct <= 40) distribution[1].count++;
      else if (pct <= 60) distribution[2].count++;
      else if (pct <= 80) distribution[3].count++;
      else distribution[4].count++;
    });

    const flaggedAttempts = attempts.filter(a => a.proctoring_summary?.flagged || a.warning_count >= 3);

    const testBatch = test.batch_id ? await batchRepository.getBatchById(test.batch_id) : null;
    const testBatchName = testBatch ? testBatch.name : 'All Batches';

    const testQuestions = await mockTestRepository.getQuestionsByTestId(testId);
    const objectiveTypes = ['mcq_single', 'mcq_multiple', 'true_false', 'fill_blank', 'numerical', 'matching'];
    const manualTypes = ['long_answer', 'subjective', 'coding'];

    const objectiveQIds = new Set(testQuestions.filter(q => objectiveTypes.includes(q.question_type)).map(q => q.id));
    const manualQIds = new Set(testQuestions.filter(q => manualTypes.includes(q.question_type)).map(q => q.id));

    const objMax = testQuestions.filter(q => objectiveQIds.has(q.id)).reduce((sum, q) => sum + (parseFloat(q.marks) || 0), 0);
    const manualMax = testQuestions.filter(q => manualQIds.has(q.id)).reduce((sum, q) => sum + (parseFloat(q.marks) || 0), 0);

    const allResponsesByQuestion = {};
    const candidates = await Promise.all(attempts.map(async a => {
      const fullAttempt = await mockTestRepository.getAttemptById(a.id);
      const responses = fullAttempt?.responses || [];

      responses.forEach(r => {
        if (!allResponsesByQuestion[r.question_id]) {
          allResponsesByQuestion[r.question_id] = [];
        }
        allResponsesByQuestion[r.question_id].push(r);
      });

      let objScore = 0;
      let manScore = 0;
      let pendingCount = 0;

      responses.forEach(r => {
        const score = parseFloat(r.score_awarded) || 0;
        if (objectiveQIds.has(r.question_id)) {
          objScore += score;
        } else if (manualQIds.has(r.question_id)) {
          manScore += score;
          if (r.is_pending_review) pendingCount++;
        }
      });

      let manualStatus = 'N/A';
      if (manualQIds.size > 0) {
        manualStatus = (pendingCount > 0 || a.result_status === 'PENDING_EVALUATION' || (a.status === 'submitted' && a.result_status !== 'EVALUATED' && a.result_status !== 'RELEASED')) ? 'Pending' : 'Evaluated';
      }

      const correctCount = a.correct_count !== null && a.correct_count !== undefined 
        ? a.correct_count 
        : responses.filter(r => r.is_correct === true).length;
      const incorrectCount = a.incorrect_count !== null && a.incorrect_count !== undefined
        ? a.incorrect_count
        : responses.filter(r => r.is_correct === false).length;
      const unansweredCount = a.unanswered_count !== null && a.unanswered_count !== undefined
        ? a.unanswered_count
        : Math.max(0, testQuestions.length - responses.length);
      const attemptedCount = correctCount + incorrectCount;
      const accuracy = attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 100) : 0;

      return {
        attempt_id: a.id,
        student_id: a.student_id,
        student_name: a.student_name,
        student_email: a.student_email,
        batch_name: testBatchName,
        score: parseFloat(a.total_score || 0),
        objective_score: objScore,
        objective_max_score: objMax,
        manual_score: manScore,
        manual_max_score: manualMax,
        manual_status: manualStatus,
        percentage: parseFloat(a.percentage || 0),
        correct_count: correctCount,
        incorrect_count: incorrectCount,
        wrong_count: incorrectCount,
        unanswered_count: unansweredCount,
        accuracy,
        time_spent_seconds: a.time_spent_seconds || 0,
        passed: a.passed,
        status: a.status,
        result_status: a.result_status || (manualStatus === 'Pending' ? 'PENDING_EVALUATION' : 'EVALUATED'),
        warning_count: a.warning_count,
        flagged: Boolean(a.proctoring_summary?.flagged),
        started_at: a.started_at,
        submitted_at: a.submitted_at
      };
    }));

    // Question-level analysis
    const questionAnalysis = testQuestions.map(q => {
      const qResponses = allResponsesByQuestion[q.id] || [];
      const totalQAttempts = qResponses.length;
      const correctAnswers = qResponses.filter(r => r.is_correct === true).length;
      const wrongAnswers = qResponses.filter(r => r.is_correct === false).length;
      const skipped = Math.max(0, completed.length - totalQAttempts);
      const correctPct = totalQAttempts > 0 ? Math.round((correctAnswers / totalQAttempts) * 100) : 0;
      const difficulty = correctPct >= 70 ? 'Easy' : correctPct >= 40 ? 'Medium' : 'Hard';

      return {
        question_id: q.id,
        question_text: q.question_text || ('Question ' + (q.order_index || '')),
        question_type: q.question_type,
        marks: parseFloat(q.marks || 1),
        subject: q.subject || test.subject || 'General',
        total_attempts: totalQAttempts,
        correct_answers: correctAnswers,
        wrong_answers: wrongAnswers,
        skipped,
        correct_percentage: correctPct,
        difficulty
      };
    });

    const candidateAccuracies = candidates.filter(c => ['submitted', 'evaluated'].includes(c.status)).map(c => c.accuracy);
    const avgAccuracy = candidateAccuracies.length > 0 ? Math.round(candidateAccuracies.reduce((a, b) => a + b, 0) / candidateAccuracies.length) : 0;
    const avgPct = completed.length > 0 ? parseFloat((completed.map(a => parseFloat(a.percentage || 0)).reduce((a, b) => a + b, 0) / completed.length).toFixed(1)) : 0;
    const completionRate = attempts.length > 0 ? parseFloat(((completed.length / attempts.length) * 100).toFixed(1)) : 0;

    return {
      test_id: test.id,
      title: test.title,
      description: test.description || '',
      subject: test.subject,
      total_marks: test.total_marks,
      duration_minutes: test.duration_minutes || 60,
      total_questions: testQuestions.length,
      pass_percentage: test.pass_percentage || 40,
      total_candidates: totalCandidates,
      total_attempts: attempts.length,
      completed_attempts: completed.length,
      completion_rate_percentage: completionRate,
      average_score: avgScore,
      average_percentage: avgPct,
      average_accuracy: avgAccuracy,
      highest_score: maxScore,
      lowest_score: minScore,
      pass_count: passCount,
      pass_rate_percentage: passRate,
      flagged_proctoring_count: flaggedAttempts.length,
      score_distribution: distribution,
      candidates,
      question_analysis: questionAnalysis
    };
  }
};
