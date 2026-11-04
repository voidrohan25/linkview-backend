import { lmsRepository } from '../repositories/lmsRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { logAudit } from '../repositories/auditRepository.js';
import { notificationService } from '../services/notificationService.js';
import { livekitService } from '../services/livekitService.js';
import { z } from 'zod';

const createAssignmentSchema = z.object({
  title: z.string().min(2).max(255),
  instructions: z.string().optional().default(''),
  subject_id: z.string().uuid().or(z.string().min(1)),
  class_id: z.string().uuid().or(z.string().min(1)),
  batch_id: z.string().uuid().or(z.string().min(1)).optional().nullable(),
  issue_date: z.string().optional(),
  due_date: z.string(),
  max_marks: z.number().int().min(1).default(100),
  status: z.enum(['draft', 'published']).default('published')
});

const gradeSubmissionSchema = z.object({
  marks_obtained: z.number().min(0),
  feedback: z.string().optional().default('')
});

const createMaterialSchema = z.object({
  title: z.string().min(2).max(255),
  description: z.string().optional().default(''),
  type: z.enum(['pdf', 'video', 'link', 'doc', 'slides']).default('link'),
  file_path: z.string().optional().nullable(),
  file_name: z.string().optional().nullable(),
  file_size: z.number().optional().nullable(),
  external_url: z.string().url().optional().nullable(),
  subject_id: z.string().uuid().or(z.string().min(1)).optional().nullable(),
  class_id: z.string().uuid().or(z.string().min(1)).optional().nullable(),
  batch_id: z.string().uuid().or(z.string().min(1)).optional().nullable(),
  course_id: z.string().uuid().or(z.string().min(1)).optional().nullable(),
  lesson_id: z.string().uuid().or(z.string().min(1)).optional().nullable()
});

const optionalId = z.string().trim().optional().nullable().transform(val => (val && val.length > 0 ? val : null));

const createLiveClassSchema = z.object({
  title: z.string().min(2).max(255),
  description: z.string().optional().default(''),
  class_id: optionalId,
  batch_id: optionalId,
  subject_id: optionalId,
  course_id: optionalId,
  scheduled_at: z.string().refine(val => !isNaN(Date.parse(val)), 'Invalid date format'),
  meeting_url: z.string().optional().nullable()
});

const createLeaveRequestSchema = z.object({
  from_date: z.string(),
  to_date: z.string(),
  reason: z.string().min(5).max(1000)
});

const markAttendanceSchema = z.object({
  batch_id: z.string().min(1),
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must use YYYY-MM-DD format')
    .refine(value => {
      const parsedDate = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
    }, 'date must be a valid calendar date'),
  subject_id: z.string().optional().nullable(),
  records: z.array(z.object({
    student_id: z.string().min(1),
    status: z.enum(['present', 'absent', 'late', 'excused']),
    remarks: z.string().max(1000).optional().default('')
  })).min(1).max(500).refine(
    records => new Set(records.map(record => record.student_id)).size === records.length,
    'Each student can only appear once'
  )
});

export const teacherController = {
  // ── Dashboard Overview ──────────────────────────────────────────────
  async getDashboard(req, res, next) {
    try {
      const teacherId = req.user.id;
      const todayDayOfWeek = new Date().getDay(); // 0 is Sunday, 1 is Monday...

      const [assignmentsList, classesAssigned, todayTimetable, pendingSubmissions, upcomingLive, announcements] = await Promise.all([
        lmsRepository.getAssignments({ teacherId }),
        lmsRepository.getTeacherAssignments(teacherId),
        lmsRepository.getTimetable({ teacherId, dayOfWeek: todayDayOfWeek }),
        (async () => {
          // Count submissions awaiting grading across teacher's assignments
          const asgns = await lmsRepository.getAssignments({ teacherId });
          let pendingCount = 0;
          for (const a of asgns) {
            const subs = await lmsRepository.getSubmissionsForAssignment(a.id);
            pendingCount += subs.filter(s => s.status === 'submitted').length;
          }
          return pendingCount;
        })(),
        lmsRepository.getLiveClasses({ teacherId, status: 'scheduled' }),
        lmsRepository.getAnnouncements({ limit: 5 })
      ]);

      res.status(200).json({
        success: true,
        data: {
          summary: {
            assigned_classes_count: classesAssigned.length,
            total_assignments: assignmentsList.length,
            pending_grading_count: pendingSubmissions,
            today_classes_count: todayTimetable.length,
            upcoming_live_sessions: upcomingLive.length
          },
          today_schedule: todayTimetable,
          assigned_classes: classesAssigned,
          upcoming_live_classes: upcomingLive.slice(0, 3),
          recent_announcements: announcements
        }
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Assigned Classes & Students ──────────────────────────────────────
  async getClasses(req, res, next) {
    try {
      const classes = await lmsRepository.getAssignedClassesWithStudents(req.user.id);
      res.status(200).json({ success: true, data: classes });
    } catch (err) {
      next(err);
    }
  },

  async getStudents(req, res, next) {
    try {
      const { classId, batchId } = req.query;
      let students = [];
      if (classId || batchId) {
        students = await lmsRepository.getStudentsInClass(classId || null, batchId || null);
      } else {
        // Fetch students from all assigned classes
        const teacherClasses = await lmsRepository.getTeacherAssignments(req.user.id);
        const classIds = [...new Set(teacherClasses.map(tc => tc.class_id))];
        const studentMap = new Map();
        for (const cid of classIds) {
          const list = await lmsRepository.getStudentsInClass(cid);
          list.forEach(s => studentMap.set(s.id, s));
        }
        students = Array.from(studentMap.values());
      }
      res.status(200).json({ success: true, data: students });
    } catch (err) {
      next(err);
    }
  },

  // ── Timetable ────────────────────────────────────────────────────────
  async getTimetable(req, res, next) {
    try {
      const { dayOfWeek } = req.query;
      const entries = await lmsRepository.getTimetable({
        teacherId: req.user.id,
        dayOfWeek: dayOfWeek !== undefined ? parseInt(dayOfWeek, 10) : undefined
      });
      res.status(200).json({ success: true, data: entries });
    } catch (err) {
      next(err);
    }
  },

  // ── Attendance ───────────────────────────────────────────────────────
  async getAttendance(req, res, next) {
    try {
      const { classId, batchId, subjectId, date } = req.query;
      const records = await lmsRepository.getAttendance({
        classId,
        batchId,
        subjectId,
        date: date || new Date().toISOString().split('T')[0]
      });
      res.status(200).json({ success: true, data: records });
    } catch (err) {
      next(err);
    }
  },

  async markAttendance(req, res, next) {
    try {
      const { batch_id: batchId, date, subject_id: subjectId, records } = markAttendanceSchema.parse(req.body);
      const batch = await lmsRepository.getAttendanceBatch(batchId, req.user.id, subjectId || null);
      if (!batch) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Batch not found' }
        });
      }

      if (!batch.is_assigned) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not assigned to this batch and subject' }
        });
      }

      const enrolledStudents = await lmsRepository.getStudentsInClass(batch.class_id, batchId);
      const enrolledStudentIds = new Set(enrolledStudents.map(student => student.id));
      const unassignedStudent = records.find(record => !enrolledStudentIds.has(record.student_id));
      if (unassignedStudent) {
        return res.status(400).json({
          success: false,
          error: { code: 'STUDENT_NOT_ENROLLED', message: `Student ${unassignedStudent.student_id} is not enrolled in this batch` }
        });
      }

      const formattedRecords = records.map(record => ({
        studentId: record.student_id,
        classId: batch.class_id,
        batchId,
        subjectId,
        date,
        status: record.status,
        remarks: record.remarks,
        markedBy: req.user.id
      }));

      const saved = await lmsRepository.markAttendance(formattedRecords);
      await logAudit(req.user, 'MARK_ATTENDANCE', 'attendance', null, `Teacher marked attendance for ${records.length} students`);
      res.status(200).json({
        success: true,
        data: saved,
        message: 'Attendance saved successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Assignments ──────────────────────────────────────────────────────
  async getAssignments(req, res, next) {
    try {
      const assignments = await lmsRepository.getAssignments({ teacherId: req.user.id });
      // Attach submission statistics to each assignment
      const enriched = await Promise.all(
        assignments.map(async (a) => {
          const subs = await lmsRepository.getSubmissionsForAssignment(a.id);
          const gradedCount = subs.filter(s => s.status === 'graded').length;
          return {
            ...a,
            total_submissions: subs.length,
            graded_submissions: gradedCount,
            pending_submissions: subs.length - gradedCount
          };
        })
      );
      res.status(200).json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  },

  async createAssignment(req, res, next) {
    try {
      const parsed = createAssignmentSchema.parse(req.body);
      const assignment = await lmsRepository.createAssignment({
        title: parsed.title,
        instructions: parsed.instructions,
        subjectId: parsed.subject_id,
        classId: parsed.class_id,
        batchId: parsed.batch_id,
        teacherId: req.user.id,
        issueDate: parsed.issue_date || new Date().toISOString().split('T')[0],
        dueDate: parsed.due_date,
        maxMarks: parsed.max_marks,
        status: parsed.status
      });

      await logAudit(req.user, 'CREATE_ASSIGNMENT', 'assignments', assignment.id, `Created assignment "${parsed.title}"`);

      // Unified Notification Event: Notify students in class/batch
      (async () => {
        try {
          const students = await lmsRepository.getStudentsInClass(parsed.class_id, parsed.batch_id || null);
          const studentIds = students.map(s => s.id || s.user_id).filter(Boolean);
          for (const sId of studentIds) {
            notificationService.createNotification({
              userId: sId,
              title: 'Assignment Added',
              message: `New assignment "${parsed.title}" has been assigned. Due date: ${parsed.due_date}.`,
              type: 'INFO',
              priority: 'NORMAL',
              actionUrl: '/assignments',
              actionLabel: 'View Assignment',
              relatedEntityType: 'ASSIGNMENT',
              relatedEntityId: assignment.id,
              eventKey: `student:${sId}:assignment:${assignment.id}:CREATED`
            }).catch(() => {});
          }
        } catch (e) {
          console.warn('[Notification] Failed to notify students for assignment:', e.message);
        }
      })();

      res.status(201).json({
        success: true,
        data: assignment,
        message: 'Assignment created successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getSubmissions(req, res, next) {
    try {
      const { id } = req.params;
      const submissions = await lmsRepository.getSubmissionsForAssignment(id);
      res.status(200).json({ success: true, data: submissions });
    } catch (err) {
      next(err);
    }
  },

  async gradeSubmission(req, res, next) {
    try {
      const { submissionId } = req.params;
      const parsed = gradeSubmissionSchema.parse(req.body);

      const graded = await lmsRepository.gradeSubmission(submissionId, {
        marksObtained: parsed.marks_obtained,
        feedback: parsed.feedback,
        gradedBy: req.user.id
      });

      await logAudit(req.user, 'GRADE_SUBMISSION', 'assignment_submissions', submissionId, `Graded submission: ${parsed.marks_obtained} marks`);

      // Unified Notification Event: Notify student of graded assignment
      if (graded && (graded.student_id || graded.studentId)) {
        const studentId = graded.student_id || graded.studentId;
        notificationService.createNotification({
          userId: studentId,
          title: 'Assignment Graded',
          message: `Your assignment submission has been evaluated: ${parsed.marks_obtained} marks awarded.`,
          type: 'SUCCESS',
          priority: 'NORMAL',
          actionUrl: '/assignments',
          actionLabel: 'View Result',
          relatedEntityType: 'ASSIGNMENT',
          relatedEntityId: graded.assignment_id || submissionId,
          eventKey: `student:${studentId}:submission:${submissionId}:GRADED`
        }).catch(() => {});
      }

      res.status(200).json({
        success: true,
        data: graded,
        message: 'Submission graded successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Study Materials ──────────────────────────────────────────────────
  async getMaterials(req, res, next) {
    try {
      const { subjectId, classId } = req.query;
      const materials = await lmsRepository.getMaterials({
        subjectId,
        classId,
        uploadedBy: req.user.id
      });
      res.status(200).json({ success: true, data: materials });
    } catch (err) {
      next(err);
    }
  },

  async createMaterial(req, res, next) {
    try {
      const parsed = createMaterialSchema.parse(req.body);
      const material = await lmsRepository.createMaterial({
        title: parsed.title,
        description: parsed.description,
        type: parsed.type,
        filePath: parsed.file_path,
        fileName: parsed.file_name,
        fileSize: parsed.file_size,
        externalUrl: parsed.external_url,
        subjectId: parsed.subject_id,
        classId: parsed.class_id,
        batchId: parsed.batch_id,
        courseId: parsed.course_id,
        lessonId: parsed.lesson_id,
        uploadedBy: req.user.id
      });

      await logAudit(req.user, 'UPLOAD_MATERIAL', 'study_materials', material.id, `Uploaded study material "${parsed.title}"`);

      // Unified Notification Event: Notify students in class
      if (parsed.class_id) {
        (async () => {
          try {
            const students = await lmsRepository.getStudentsInClass(parsed.class_id, null);
            const studentIds = students.map(s => s.id || s.user_id).filter(Boolean);
            for (const sId of studentIds) {
              notificationService.createNotification({
                userId: sId,
                title: 'New Study Material Available',
                message: `Instructor uploaded new study resource: "${parsed.title}".`,
                type: 'INFO',
                priority: 'LOW',
                actionUrl: '/materials',
                actionLabel: 'Open Material',
                relatedEntityType: 'MATERIAL',
                relatedEntityId: material.id,
                eventKey: `student:${sId}:material:${material.id}:CREATED`
              }).catch(() => {});
            }
          } catch (e) {
            console.warn('[Notification] Failed to notify students for material:', e.message);
          }
        })();
      }

      res.status(201).json({
        success: true,
        data: material,
        message: 'Material added successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Live Classes ─────────────────────────────────────────────────────
  async getLiveClasses(req, res, next) {
    try {
      const { status } = req.query;
      const sessions = await lmsRepository.getLiveClasses({
        teacherId: req.user.id,
        status
      });
      res.status(200).json({ success: true, data: sessions });
    } catch (err) {
      next(err);
    }
  },

  async createLiveClass(req, res, next) {
    try {
      const parsed = createLiveClassSchema.parse(req.body);
      const session = await lmsRepository.createLiveClass({
        title: parsed.title,
        description: parsed.description,
        teacherId: req.user.id,
        classId: parsed.class_id,
        batchId: parsed.batch_id,
        subjectId: parsed.subject_id,
        courseId: parsed.course_id,
        scheduledAt: new Date(parsed.scheduled_at).toISOString(),
        meetingUrl: parsed.meeting_url || null,
        meetingProvider: 'livekit'
      });

      await logAudit(req.user, 'SCHEDULE_LIVE_CLASS', 'live_class_sessions', session.id, `Scheduled LiveKit lecture "${parsed.title}"`);

      // Unified Notification Event: Notify students in class/batch
      if (parsed.class_id) {
        (async () => {
          try {
            const students = await lmsRepository.getStudentsInClass(parsed.class_id, parsed.batch_id || null);
            const studentIds = students.map(s => s.id || s.user_id).filter(Boolean);
            for (const sId of studentIds) {
              notificationService.createNotification({
                userId: sId,
                title: 'Live Class Starting Soon',
                message: `Live lecture "${parsed.title}" is scheduled for ${new Date(parsed.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
                type: 'ACTION_REQUIRED',
                priority: 'HIGH',
                actionUrl: '/live-classes',
                actionLabel: 'Join Class',
                relatedEntityType: 'LIVE_CLASS',
                relatedEntityId: session.id,
                eventKey: `student:${sId}:live_class:${session.id}:SCHEDULED`
              }).catch(() => {});
            }
          } catch (e) {
            console.warn('[Notification] Failed to notify students for live class:', e.message);
          }
        })();
      }

      res.status(201).json({
        success: true,
        data: session,
        message: 'Live lecture broadcast scheduled successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async endLiveClass(req, res, next) {
    try {
      const { id } = req.params;
      const session = await lmsRepository.getLiveClassById(id);
      if (!session) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lecture session not found' } });
      }
      if (req.user.role !== 'ADMIN' && session.teacher_id !== req.user.id) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Unauthorized to end this lecture' } });
      }
      const nowIso = new Date().toISOString();
      const updated = await lmsRepository.updateLiveClass(id, { status: 'completed', ended_at: nowIso });

      // Signal LiveKit students and tear down room
      const roomName = `lecture-${id}`;
      try {
        await livekitService.sendData(roomName, {
          type: 'LECTURE_ENDED',
          lectureId: id,
          message: 'This live lecture has been ended by the instructor.'
        });
      } catch (sendErr) {
        console.warn('[TeacherController] LiveKit sendData notice:', sendErr.message);
      }

      try {
        await livekitService.deleteRoom(roomName);
      } catch (delErr) {
        console.warn('[TeacherController] LiveKit deleteRoom notice:', delErr.message);
      }

      await logAudit(req.user, 'END_LIVE_CLASS', 'live_class_sessions', id, `Ended live class "${session.title}"`);
      res.status(200).json({ success: true, data: updated, message: 'Live lecture concluded successfully.' });
    } catch (err) {
      next(err);
    }
  },

  async updateLiveClassStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!['scheduled', 'ongoing', 'completed', 'cancelled', 'ended'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: 'Status must be scheduled, ongoing, completed, cancelled, or ended' }
        });
      }

      const updates = { status };
      const nowIso = new Date().toISOString();
      if (status === 'ongoing') updates.started_at = nowIso;
      if (status === 'completed' || status === 'ended') updates.ended_at = nowIso;

      const updated = await lmsRepository.updateLiveClass(id, updates);
      await logAudit(req.user, 'UPDATE_LIVE_CLASS_STATUS', 'live_class_sessions', id, `Updated live class status to ${status}`);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },

  // ── Announcements ────────────────────────────────────────────────────
  async getAnnouncements(req, res, next) {
    try {
      const announcements = await lmsRepository.getAnnouncements({ limit: 50 });
      res.status(200).json({ success: true, data: announcements });
    } catch (err) {
      next(err);
    }
  },

  async createAnnouncement(req, res, next) {
    try {
      const { title, content, target_type = 'class', target_id = null } = req.body;
      if (!title || !content) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Title and content are required' }
        });
      }

      const announcement = await lmsRepository.createAnnouncement({
        title,
        content,
        authorId: req.user.id,
        targetType: target_type,
        targetId: target_id,
        status: 'published'
      });

      await logAudit(req.user, 'CREATE_ANNOUNCEMENT', 'announcements', announcement.id, `Created announcement "${title}"`);
      res.status(201).json({
        success: true,
        data: announcement,
        message: 'Announcement published successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Leave Requests ───────────────────────────────────────────────────
  async getLeaveRequests(req, res, next) {
    try {
      const requests = await lmsRepository.getLeaveRequests({ teacherId: req.user.id });
      res.status(200).json({ success: true, data: requests });
    } catch (err) {
      next(err);
    }
  },

  async createLeaveRequest(req, res, next) {
    try {
      const parsed = createLeaveRequestSchema.parse(req.body);
      const leave = await lmsRepository.createLeaveRequest({
        teacherId: req.user.id,
        fromDate: parsed.from_date,
        toDate: parsed.to_date,
        reason: parsed.reason
      });

      await logAudit(req.user, 'APPLY_LEAVE', 'leave_requests', leave.id, `Applied for leave from ${parsed.from_date} to ${parsed.to_date}`);
      res.status(201).json({
        success: true,
        data: leave,
        message: 'Leave application submitted.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Syllabus Tracking ────────────────────────────────────────────────
  async getSyllabus(req, res, next) {
    try {
      const { subjectId, classId } = req.query;
      const syllabus = await lmsRepository.getSyllabus({
        subjectId,
        classId,
        teacherId: req.user.id
      });
      res.status(200).json({ success: true, data: syllabus });
    } catch (err) {
      next(err);
    }
  },

  async updateSyllabusTopic(req, res, next) {
    try {
      const { id } = req.params;
      const updated = await lmsRepository.updateSyllabusTopic(id, req.body);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },

  // ── Teacher Profile ──────────────────────────────────────────────────
  async getProfile(req, res, next) {
    try {
      const profile = await lmsRepository.getTeacherProfile(req.user.id);
      res.status(200).json({
        success: true,
        data: {
          user: req.user,
          teacher_profile: profile
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async updateProfile(req, res, next) {
    try {
      const { employee_id, department, qualification, specialization } = req.body;
      const updated = await lmsRepository.upsertTeacherProfile(req.user.id, {
        employeeId: employee_id,
        department,
        qualification,
        specialization
      });
      res.status(200).json({
        success: true,
        data: updated,
        message: 'Profile updated successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
};
