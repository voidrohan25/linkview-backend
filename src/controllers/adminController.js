import { userRepository } from '../repositories/userRepository.js';
import { lmsRepository } from '../repositories/lmsRepository.js';
import { batchRepository } from '../repositories/batchRepository.js';
import { auditRepository, logAudit } from '../repositories/auditRepository.js';
import { securityLogRepository } from '../repositories/securityLogRepository.js';
import { invitationRepository } from '../repositories/invitationRepository.js';
import { courseRepository } from '../repositories/courseRepository.js';
import { quizRepository } from '../repositories/quizRepository.js';
import { authService } from '../services/authService.js';
import { getDbStatus, pool, isPostgresConnected, memoryStore } from '../db/index.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'node:crypto';
import { sanitizeOptionalString } from '../utils/sanitize.js';

const inviteTeacherSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2).max(150),
  department: z.string().trim().min(2).max(150).optional().default('General')
});

const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'deactivated'])
});

const createStudentSchema = z.object({
  full_name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128).optional(),
  enrollment_id: z.string().trim().min(1).max(64).optional(),
  phone: z.string().trim().max(32).optional()
});

const studentStatusSchema = z.object({
  status: z.preprocess(
    value => typeof value === 'string' ? value.toLowerCase() : value,
    z.enum(['active', 'suspended'])
  )
});

const assignTeacherSchema = z.object({
  teacher_id: z.string().trim().min(1, 'teacher_id is required').optional(),
  class_id: z.string().optional().nullable().transform(sanitizeOptionalString),
  batch_id: z.string().optional().nullable().transform(sanitizeOptionalString),
  subject_id: z.string().optional().nullable().transform(sanitizeOptionalString)
});

const subjectQuerySchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  department: z.string().trim().min(1).max(150).optional()
});

const createSubjectSchema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z.string().trim().toUpperCase().min(2).max(50).regex(/^[A-Z0-9]+$/, 'Subject code must contain only letters and numbers'),
  description: z.string().trim().max(2000).optional().nullable(),
  department: z.string().trim().min(1).max(150).optional().nullable(),
  status: z.enum(['active', 'inactive']).default('active')
});

const createClassSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(2000).optional().default(''),
  academic_session_id: z.string().optional().nullable().transform(value =>
    typeof value === 'string' && value.trim() ? value.trim() : null
  )
});

const timetableQuerySchema = z.object({
  class_id: z.string().optional(),
  batch_id: z.string().optional(),
  teacher_id: z.string().optional(),
  day_of_week: z.coerce.number().int().min(1).max(7).optional()
});

const createTimetableEntrySchema = z.object({
  class_id: z.string().trim().min(1),
  batch_id: z.string().optional().nullable().transform(sanitizeOptionalString),
  subject_id: z.string().trim().min(1),
  teacher_id: z.string().trim().min(1),
  day_of_week: z.coerce.number().int().min(1).max(7),
  start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'start_time must use HH:MM 24-hour format'),
  end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'end_time must use HH:MM 24-hour format'),
  room: z.string().trim().max(50).nullable().optional(),
  academic_session_id: z.string().optional().nullable().transform(sanitizeOptionalString)
}).refine(entry => entry.start_time < entry.end_time, {
  message: 'end_time must be later than start_time',
  path: ['end_time']
});

export const adminController = {
  // ── Dashboard ──────────────────────────────────────────────
  async getDashboardStats(req, res, next) {
    try {
      let counts;
      let recentActivity;
      if (isPostgresConnected && pool) {
        const countResult = await pool.query(`
          WITH user_metrics AS (
            SELECT
              COUNT(*) FILTER (WHERE role = 'STUDENT')::int AS total_students,
              COUNT(*) FILTER (WHERE role = 'STUDENT' AND status = 'active')::int AS active_students,
              COUNT(*) FILTER (WHERE role = 'TEACHER')::int AS total_teachers,
              COUNT(*) FILTER (WHERE role = 'TEACHER' AND status = 'active')::int AS active_teachers,
              COUNT(*)::int AS user_count
            FROM users
          ),
          course_metrics AS (
            SELECT COUNT(*)::int AS course_count,
                   COUNT(*) FILTER (WHERE published = true)::int AS active_courses
            FROM courses
          ),
          quiz_metrics AS (SELECT COUNT(*)::int AS quiz_count FROM quizzes),
          quiz_attempt_metrics AS (SELECT COUNT(*)::int AS attempt_count FROM quiz_attempts),
          class_metrics AS (SELECT COUNT(*)::int AS class_count FROM classes),
          batch_metrics AS (
            SELECT COUNT(*) FILTER (WHERE LOWER(status) = 'active')::int AS batch_count
            FROM batches
          ),
          lesson_metrics AS (SELECT COUNT(*)::int AS lesson_count FROM lessons),
          live_class_metrics AS (
            SELECT COUNT(*)::int AS upcoming_live_classes
            FROM live_class_sessions
            WHERE status = 'scheduled' AND scheduled_at > NOW()
          ),
          assignment_metrics AS (
            SELECT COUNT(*)::int AS pending_assignments
            FROM assignments
            WHERE status = 'published' AND due_date >= CURRENT_DATE
          ),
          mock_test_metrics AS (SELECT COUNT(*)::int AS mock_test_count FROM mock_tests),
          mock_attempt_metrics AS (
            SELECT COUNT(*)::int AS mock_test_attempt_count,
                   COUNT(*) FILTER (WHERE status IN ('submitted', 'evaluated'))::int AS conducted_exams
            FROM mock_test_attempts
          )
          SELECT * FROM user_metrics
          CROSS JOIN course_metrics
          CROSS JOIN quiz_metrics
          CROSS JOIN quiz_attempt_metrics
          CROSS JOIN class_metrics
          CROSS JOIN batch_metrics
          CROSS JOIN lesson_metrics
          CROSS JOIN live_class_metrics
          CROSS JOIN assignment_metrics
          CROSS JOIN mock_test_metrics
          CROSS JOIN mock_attempt_metrics
        `);
        counts = countResult.rows[0];
        const recentAttempts = await pool.query(
          `SELECT qa.id, qa.score, qa.total_questions, qa.submitted_at, u.full_name as student_name, q.title as quiz_title
           FROM quiz_attempts qa JOIN users u ON qa.user_id = u.id JOIN quizzes q ON qa.quiz_id = q.id
           ORDER BY qa.submitted_at DESC LIMIT 5`
        );
        recentActivity = recentAttempts.rows;
      } else {
        const users = memoryStore.users || [];
        const courses = memoryStore.courses || [];
        const quizzes = memoryStore.quizzes || [];
        const quizAttempts = memoryStore.quiz_attempts || [];
        const mockTests = memoryStore.mock_tests || [];
        const mockTestAttempts = memoryStore.mock_test_attempts || [];
        const now = new Date();
        const upcoming = (memoryStore.live_class_sessions || []).filter(
          s => s.status === 'scheduled' && new Date(s.scheduled_at) > now
        ).length;
        const pendingAssign = (memoryStore.assignments || []).filter(
          a => a.status === 'published' && new Date(a.due_date) >= now
        ).length;
        recentActivity = [...quizAttempts].reverse().slice(0, 5).map(qa => {
          const u = users.find(user => user.id === qa.user_id);
          const q = quizzes.find(quiz => quiz.id === qa.quiz_id);
          return { id: qa.id, score: qa.score, total_questions: qa.total_questions, submitted_at: qa.submitted_at, student_name: u?.full_name || 'Student', quiz_title: q?.title || 'Assessment' };
        });
        counts = {
          total_students: users.filter(user => user.role === 'STUDENT').length,
          active_students: users.filter(user => user.role === 'STUDENT' && user.status === 'active').length,
          total_teachers: users.filter(user => user.role === 'TEACHER').length,
          active_teachers: users.filter(user => user.role === 'TEACHER' && user.status === 'active').length,
          user_count: users.length,
          course_count: courses.length,
          active_courses: courses.filter(course => course.published).length,
          quiz_count: quizzes.length,
          attempt_count: quizAttempts.length,
          class_count: (memoryStore.classes || []).length,
          batch_count: (memoryStore.batches || []).filter(batch => String(batch.status).toLowerCase() === 'active').length,
          lesson_count: (memoryStore.lessons || []).length,
          upcoming_live_classes: upcoming,
          pending_assignments: pendingAssign,
          mock_test_count: mockTests.length,
          mock_test_attempt_count: mockTestAttempts.length,
          conducted_exams: mockTestAttempts.filter(attempt => ['submitted', 'evaluated'].includes(attempt.status)).length
        };
      }

      const stats = {
        total_students: counts.total_students,
        active_students: counts.active_students,
        total_teachers: counts.total_teachers,
        active_teachers: counts.active_teachers,
        active_courses: counts.active_courses,
        course_count: counts.course_count,
        user_count: counts.user_count,
        lesson_count: counts.lesson_count,
        quiz_count: counts.quiz_count,
        attempt_count: counts.attempt_count,
        class_count: counts.class_count,
        batch_count: counts.batch_count,
        upcoming_live_classes: counts.upcoming_live_classes,
        pending_assignments: counts.pending_assignments,
        mock_test_count: counts.mock_test_count,
        mock_test_attempt_count: counts.mock_test_attempt_count,
        totalStudents: counts.total_students,
        totalTeachers: counts.total_teachers,
        activeTeachers: counts.active_teachers,
        activeBatches: counts.batch_count,
        totalCourses: counts.course_count,
        totalExams: counts.mock_test_count,
        conductedExams: counts.conducted_exams,
        totalExamAttempts: counts.mock_test_attempt_count,
        student_count: counts.total_students,
        teacher_count: counts.total_teachers,
        systemUptime: Math.floor(process.uptime()),
        recent_activity: recentActivity,
        database: getDbStatus()
      };
      return res.status(200).json({ success: true, data: { stats }, message: 'Admin dashboard statistics.' });
    } catch (err) { next(err); }
  },

  // ── User Management ────────────────────────────────────────
  async getUsers(req, res, next) {
    try {
      const { role, status, search, limit, offset, page } = req.query;
      const parsedLimit = limit === 'all' ? 1000 : (parseInt(limit, 10) || 500);
      const parsedOffset = offset !== undefined ? parseInt(offset, 10) : ((parseInt(page, 10) || 1) - 1) * parsedLimit;
      const users = await userRepository.getAllUsers({
        role,
        status,
        search,
        limit: parsedLimit,
        offset: parsedOffset
      });
      return res.status(200).json({ success: true, data: { users, count: users.length }, message: 'User list retrieved.' });
    } catch (err) { next(err); }
  },

  async getStudents(req, res, next) {
    try {
      const { status, search, limit, offset } = req.query;
      const students = await userRepository.getStudents({ status, search, limit: parseInt(limit) || 100, offset: parseInt(offset) || 0 });
      return res.status(200).json({ success: true, data: { students }, message: 'Student list retrieved.' });
    } catch (err) { next(err); }
  },

  async createStudent(req, res, next) {
    try {
      const { email, full_name, password: providedPassword, enrollment_id, phone } = createStudentSchema.parse(req.body);
      const existing = await userRepository.findByEmail(email);
      if (existing) {
        return res.status(409).json({ success: false, error: { code: 'EMAIL_ALREADY_EXISTS', message: 'A user with this email already exists.' } });
      }
      const password = providedPassword || crypto.randomBytes(24).toString('base64url');
      const generatedEnrollmentId = enrollment_id || `LT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const existingEnrollment = await lmsRepository.getStudentProfileByEnrollmentNumber(generatedEnrollmentId);
      if (existingEnrollment) {
        return res.status(409).json({
          success: false,
          error: { code: 'ENROLLMENT_ID_ALREADY_EXISTS', message: 'A student with this enrollment ID already exists.' }
        });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const student = await userRepository.create({
        fullName: full_name,
        email,
        passwordHash,
        role: 'STUDENT',
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
        status: 'active'
      });
      await lmsRepository.upsertStudentProfile(student.id, { enrollmentNumber: generatedEnrollmentId });
      if (phone) {
        await userRepository.updateProfile(student.id, { phone });
      }
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'STUDENT_CREATED',
        resourceType: 'user',
        resourceId: student.id,
        summary: `Admin created student account with enrollment ID ${generatedEnrollmentId}`
      });
      return res.status(201).json({
        success: true,
        data: {
          student,
          enrollment_id: generatedEnrollmentId,
          ...(providedPassword ? {} : { temporary_password: password })
        },
        message: 'Student created successfully.'
      });
    } catch (err) { next(err); }
  },

  async getStudentDetail(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userRepository.findById(id);
      if (!user || user.role !== 'STUDENT') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found.' } });
      const profile = await lmsRepository.getStudentProfile(id);
      const classes = await lmsRepository.getClassesForStudent(id);
      return res.status(200).json({ success: true, data: { student: { ...user, profile, classes } }, message: 'Student details.' });
    } catch (err) { next(err); }
  },

  async updateStudent(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userRepository.findById(id);
      if (!user || user.role !== 'STUDENT') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found.' } });
      const { full_name, phone, avatar_url } = req.body;
      const updated = await userRepository.updateProfile(id, { fullName: full_name, phone, avatarUrl: avatar_url });
      return res.status(200).json({ success: true, data: { user: updated }, message: 'Student updated.' });
    } catch (err) { next(err); }
  },

  async updateUserStatus(req, res, next) {
    try {
      const id = req.params.id || req.params.userId;
      const { status } = updateStatusSchema.parse(req.body);
      const updated = await userRepository.updateStatus(id, status);
      if (!updated) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      await logAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'USER_STATUS_CHANGED', resourceType: 'user', resourceId: id, summary: `User ${updated.email} status changed to ${status}` });
      return res.status(200).json({ success: true, data: { user: updated }, message: `User status updated to ${status}.` });
    } catch (err) { next(err); }
  },

  async updateStudentStatus(req, res, next) {
    try {
      const { status } = studentStatusSchema.parse(req.body);
      const student = await userRepository.findById(req.params.id);
      if (!student || student.role !== 'STUDENT') {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found.' } });
      }
      const updated = await userRepository.updateStatus(student.id, status);
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'STUDENT_STATUS_CHANGED',
        resourceType: 'user',
        resourceId: student.id,
        summary: `Student status changed to ${status}`,
        ipAddress: req.ip
      });
      return res.status(200).json({ success: true, data: { student: updated }, message: `Student status updated to ${status}.` });
    } catch (err) { next(err); }
  },

  async resetStudentPassword(req, res, next) {
    try {
      const student = await userRepository.findById(req.params.id);
      if (!student || student.role !== 'STUDENT') {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Student not found.' } });
      }
      const result = await authService.sendAdminPasswordReset({ user: student });
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'STUDENT_CREDENTIAL_RESET_REQUESTED',
        resourceType: 'user',
        resourceId: student.id,
        summary: 'Admin requested a secure password reset link for student',
        ipAddress: req.ip
      });
      return res.status(200).json({ success: true, data: result, message: result.message });
    } catch (err) { next(err); }
  },

  async updateUser(req, res, next) {
    try {
      const userId = req.params.userId || req.params.id;
      const { role, status, full_name } = req.body;

      const user = await userRepository.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      }

      if (role && !['ADMIN', 'TEACHER', 'STUDENT'].includes(role)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid role.' } });
      }

      if (status && !['active', 'suspended', 'deactivated'].includes(status)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid status.' } });
      }

      const updated = await userRepository.updateUserRoleAndStatus(userId, {
        role,
        status,
        fullName: full_name
      });

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'USER_ROLE_OR_STATUS_UPDATED',
        resourceType: 'user',
        resourceId: userId,
        summary: `Admin updated user ${user.email} (Role: ${role || user.role}, Status: ${status || user.status})`,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent']
      });

      if (role && role !== user.role) {
        await securityLogRepository.recordSecurityLog({
          eventType: 'USER_ROLE_UPDATED',
          severity: 'HIGH',
          userId: user.id,
          userEmail: user.email,
          actorId: req.user.id,
          actorEmail: req.user.email,
          targetResource: `user:${userId}`,
          ipAddress: req.ip || req.headers['x-forwarded-for'],
          userAgent: req.headers['user-agent'],
          details: `Role for user ${user.email} updated from ${user.role} to ${role} by admin ${req.user.email}`,
          metadata: { previousRole: user.role, newRole: role, updatedBy: req.user.id }
        });
      }

      return res.status(200).json({
        success: true,
        data: { user: updated },
        message: 'User updated successfully.'
      });
    } catch (err) { next(err); }
  },

  // ── Teacher Management ─────────────────────────────────────
  async getTeachers(req, res, next) {
    try {
      const { status, search, limit, offset } = req.query;
      const teachers = await userRepository.getTeachers({ status, search, limit: parseInt(limit) || 100, offset: parseInt(offset) || 0 });
      return res.status(200).json({ success: true, data: { teachers }, message: 'Teacher list retrieved.' });
    } catch (err) { next(err); }
  },

  async getTeacherDetail(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userRepository.findById(id);
      if (!user || user.role !== 'TEACHER') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found.' } });
      const profile = await lmsRepository.getTeacherProfile(id);
      const assignments = await lmsRepository.getTeacherAssignments(id);
      return res.status(200).json({ success: true, data: { teacher: { ...user, profile, assignments } }, message: 'Teacher details.' });
    } catch (err) { next(err); }
  },

  async inviteTeacher(req, res, next) {
    try {
      const { email, full_name, department } = inviteTeacherSchema.parse(req.body);
      const result = await authService.inviteTeacher({
        email,
        fullName: full_name,
        department,
        invitedBy: req.user.id,
        inviterName: req.user.full_name
      });
      return res.status(201).json({ success: true, data: result, message: `Teacher invitation sent to ${email}.` });
    } catch (err) { next(err); }
  },

  async getInvitations(req, res, next) {
    try {
      const invitations = await invitationRepository.getAll();
      // Never expose token_hash
      const safe = invitations.map(({ token_hash, ...inv }) => inv);
      return res.status(200).json({ success: true, data: { invitations: safe }, message: 'Invitations retrieved.' });
    } catch (err) { next(err); }
  },

  async updateTeacher(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userRepository.findById(id);
      if (!user || user.role !== 'TEACHER') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Teacher not found.' } });
      const { full_name, phone, avatar_url, department, qualification, specialization } = req.body;
      const updated = await userRepository.updateProfile(id, { fullName: full_name, phone, avatarUrl: avatar_url });
      if (department || qualification || specialization) {
        await lmsRepository.upsertTeacherProfile(id, { department, qualification, specialization });
      }
      return res.status(200).json({ success: true, data: { teacher: updated }, message: 'Teacher updated.' });
    } catch (err) { next(err); }
  },

  async assignTeacher(req, res, next) {
    try {
      const validated = assignTeacherSchema.parse({
        teacher_id: req.params.teacherId || req.params.id || req.body.teacher_id || req.body.teacherId,
        class_id: req.body.class_id || req.body.classId,
        batch_id: req.body.batch_id || req.body.batchId,
        subject_id: req.body.subject_id || req.body.subjectId || req.body.subject || req.body.subject_code || req.body.code
      });
      const { teacher_id: teacherId, class_id: rawClass, batch_id: rawBatch, subject_id: rawSubject } = validated;
      if (!teacherId) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'teacher_id is required.' } });
      }

      // 1. Validate Teacher
      const teacher = await userRepository.findById(teacherId);
      if (!teacher || !['TEACHER', 'ADMIN'].includes(teacher.role)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_TEACHER', message: 'Selected faculty member does not exist or is not a teacher.' } });
      }

      // 2. Resolve Batch & Class
      let classId = rawClass || null;
      let batch = null;

      if (rawBatch) {
        batch = await batchRepository.getBatchById(rawBatch);
        if (!batch) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_BATCH', message: `Selected batch (${rawBatch}) does not exist.` } });
        }
        if (!classId) {
          classId = batch.class_id;
        }
      }

      // If classId is still not resolved, attempt to use the first class in the system
      if (!classId) {
        if (isPostgresConnected && pool) {
          const clsRes = await pool.query('SELECT id FROM classes ORDER BY created_at ASC LIMIT 1');
          if (clsRes.rows.length > 0) {
            classId = clsRes.rows[0].id;
            if (rawBatch) {
              await pool.query('UPDATE batches SET class_id = $1 WHERE id = $2', [classId, rawBatch]);
            }
          }
        } else {
          classId = memoryStore.classes?.[0]?.id || null;
        }
      }

      // If classId is still null, create a fallback class if DB connected
      if (!classId && isPostgresConnected && pool) {
        const newClassId = crypto.randomUUID();
        await pool.query("INSERT INTO classes (id, name) VALUES ($1, 'General Cohort')", [newClassId]);
        classId = newClassId;
        if (rawBatch) {
          await pool.query('UPDATE batches SET class_id = $1 WHERE id = $2', [classId, rawBatch]);
        }
      }

      // 3. Resolve Subject
      let subject = null;
      if (rawSubject) {
        if (isPostgresConnected && pool) {
          const sRes = await pool.query(
            'SELECT * FROM subjects WHERE id = $1 OR code = $1 OR LOWER(name) = LOWER($1)',
            [rawSubject]
          );
          subject = sRes.rows[0];
        } else {
          subject = (memoryStore.subjects || []).find(
            s => s.id === rawSubject || s.code === rawSubject || s.name?.toLowerCase() === String(rawSubject).toLowerCase()
          );
        }
        if (!subject) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_SUBJECT', message: `Selected subject (${rawSubject}) does not exist.` } });
        }
      } else {
        // If subject is omitted, default to the first available subject
        if (isPostgresConnected && pool) {
          const sRes = await pool.query('SELECT * FROM subjects ORDER BY created_at ASC LIMIT 1');
          subject = sRes.rows[0] || null;
        } else {
          subject = memoryStore.subjects?.[0] || null;
        }
      }

      // 4. Create Subject-Teacher Assignment if subject & class are available
      let assignment = null;
      if (subject && classId) {
        try {
          assignment = await lmsRepository.assignTeacher({
            teacherId,
            classId,
            batchId: rawBatch || null,
            subjectId: subject.id
          });
        } catch (assignErr) {
          if (assignErr.code === 'ALREADY_ASSIGNED' || assignErr.statusCode === 409) {
            // Already assigned - fetch existing assignment
            if (isPostgresConnected && pool) {
              const exRes = await pool.query(
                `SELECT id FROM teacher_assignments WHERE teacher_id=$1 AND class_id=$2 AND subject_id=$3 AND (batch_id=$4 OR (batch_id IS NULL AND $4 IS NULL))`,
                [teacherId, classId, subject.id, rawBatch || null]
              );
              if (exRes.rows.length > 0) {
                assignment = await lmsRepository.getAssignmentById(exRes.rows[0].id);
              }
            }
            if (!assignment) {
              return res.status(409).json({
                success: false,
                error: {
                  code: 'ALREADY_ASSIGNED',
                  message: 'This subject is already assigned to this teacher for the specified cohort.'
                }
              });
            }
          } else {
            throw assignErr;
          }
        }
      }

      // 5. Synchronize with batch_teachers table if batch provided
      if (rawBatch) {
        await batchRepository.assignTeacherToBatch({
          batchId: rawBatch,
          teacherId,
          assignedBy: req.user.id
        }).catch(() => {});
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'TEACHER_ASSIGNED',
        resourceType: 'teacher_assignment',
        resourceId: assignment?.id || teacherId,
        summary: `Admin assigned teacher ${teacher.full_name} (${teacher.email}) ${subject ? `to subject '${subject.name}'` : ''} ${batch ? `(Batch: ${batch.name})` : ''}`
      });

      return res.status(201).json({
        success: true,
        data: { assignment },
        message: `Subject '${subject?.name || 'General'}' assigned to ${teacher.full_name} successfully.`
      });
    } catch (err) {
      next(err);
    }
  },

  async updateTeacherAssignment(req, res, next) {
    try {
      const assignmentId = req.params.id || req.params.assignmentId;
      const { teacher_id } = z.object({
        teacher_id: z.string().min(1, 'teacher_id is required')
      }).parse(req.body);

      const existing = await lmsRepository.getAssignmentById(assignmentId);
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subject assignment not found.' } });
      }

      const newTeacher = await userRepository.findById(teacher_id);
      if (!newTeacher || !['TEACHER', 'ADMIN'].includes(newTeacher.role)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_TEACHER', message: 'Selected replacement faculty member does not exist or is not a teacher.' } });
      }

      const updated = await lmsRepository.updateTeacherAssignment(assignmentId, { teacherId: teacher_id });

      // Synchronize batch_teachers
      if (existing.batch_id) {
        await batchRepository.assignTeacherToBatch({
          batchId: existing.batch_id,
          teacherId: teacher_id,
          assignedBy: req.user.id
        }).catch(() => {});
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'TEACHER_ASSIGNMENT_UPDATED',
        resourceType: 'teacher_assignment',
        resourceId: assignmentId,
        summary: `Admin changed teacher for assignment '${existing.subject_name}' from ${existing.teacher_name} to ${newTeacher.full_name}`
      });

      return res.status(200).json({
        success: true,
        data: { assignment: updated },
        message: `Assigned teacher updated to ${newTeacher.full_name} successfully.`
      });
    } catch (err) {
      next(err);
    }
  },

  async removeTeacherAssignment(req, res, next) {
    try {
      const assignmentId = req.params.id || req.params.assignmentId;
      const removed = await lmsRepository.removeTeacherAssignment(assignmentId);
      if (!removed) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subject assignment not found.' } });
      }

      // Check if teacher has other assignments for this batch; if none, clean up batch_teachers
      if (removed.batch_id && removed.teacher_id) {
        const remaining = (await lmsRepository.getTeacherAssignments(removed.teacher_id))
          .filter(a => a.batch_id === removed.batch_id);
        if (remaining.length === 0) {
          await batchRepository.removeTeacherFromBatch(removed.batch_id, removed.teacher_id).catch(() => {});
        }
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'TEACHER_ASSIGNMENT_REMOVED',
        resourceType: 'teacher_assignment',
        resourceId: assignmentId,
        summary: `Admin removed subject assignment (${assignmentId})`
      });

      return res.status(200).json({
        success: true,
        message: 'Subject assignment removed successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getBatchAssignments(req, res, next) {
    try {
      const batchId = req.params.batchId || req.params.id;
      const assignments = await lmsRepository.getBatchAssignments(batchId);
      return res.status(200).json({
        success: true,
        data: { assignments },
        message: 'Batch subject assignments retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getTeacherAssignments(req, res, next) {
    try {
      const assignments = await lmsRepository.getTeacherAssignments(req.params.id);
      return res.status(200).json({ success: true, data: { assignments }, message: 'Teacher assignments retrieved.' });
    } catch (err) { next(err); }
  },

  // ── Classes & Batches ──────────────────────────────────────
  async getClasses(req, res, next) {
    try {
      const classes = await lmsRepository.getClasses();
      return res.status(200).json({ success: true, data: { classes }, message: 'Classes retrieved.' });
    } catch (err) { next(err); }
  },

  async createClass(req, res, next) {
    try {
      const { name, description, academic_session_id: academicSessionId } = createClassSchema.parse(req.body);
      if (academicSessionId) {
        const sessions = await lmsRepository.getAcademicSessions();
        if (!sessions.some(session => session.id === academicSessionId)) {
          const err = new Error(`Academic session '${academicSessionId}' does not exist.`);
          err.statusCode = 400;
          err.code = 'INVALID_ACADEMIC_SESSION';
          throw err;
        }
      }
      const cls = await lmsRepository.createClass({ name, description, academicSessionId });
      await logAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'CLASS_CREATED', resourceType: 'class', resourceId: cls.id, summary: `Class '${name}' created` });
      return res.status(201).json({ success: true, data: { class: cls }, message: 'Class created.' });
    } catch (err) { next(err); }
  },

  async updateClass(req, res, next) {
    try {
      const { name, description, academic_session_id } = req.body;
      const cls = await lmsRepository.updateClass(req.params.id, { name, description, academicSessionId: academic_session_id });
      if (!cls) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Class not found.' } });
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'CLASS_UPDATED',
        resourceType: 'class',
        resourceId: cls.id,
        summary: `Class '${cls.name || name}' updated`,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent']
      });
      return res.status(200).json({ success: true, data: { class: cls }, message: 'Class updated.' });
    } catch (err) { next(err); }
  },

  async getClassStudents(req, res, next) {
    try {
      const students = await lmsRepository.getStudentsInClass(req.params.id, req.query.batch_id);
      return res.status(200).json({ success: true, data: { students }, message: 'Class students retrieved.' });
    } catch (err) { next(err); }
  },

  async enrollStudent(req, res, next) {
    try {
      const classId = req.params.id || req.body.class_id;
      const { student_id, batch_id } = req.body;
      if (!student_id) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'student_id is required.' } });
      if (!classId) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'class_id is required.' } });
      const enrollment = await lmsRepository.enrollStudentInClass({ studentId: student_id, classId, batchId: batch_id });
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'STUDENT_ENROLLED',
        resourceType: 'student',
        resourceId: student_id,
        summary: `Student ${student_id} enrolled in class ${classId}${batch_id ? ` (Batch: ${batch_id})` : ''}`
      });
      return res.status(201).json({ success: true, data: { enrollment }, message: 'Student enrolled.' });
    } catch (err) { next(err); }
  },

  async getBatches(req, res, next) {
    try {
      const batches = await batchRepository.getAllBatches({ classId: req.params.classId });
      return res.status(200).json({ success: true, data: { batches }, message: 'Batches retrieved.' });
    } catch (err) { next(err); }
  },

  async createBatch(req, res, next) {
    try {
      const { name, code, capacity, class_teacher_id, course_id, description, start_date, end_date } = req.body;
      if (!name) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Batch name is required.' } });
      const batch = await batchRepository.createBatch({
        name,
        code,
        class_id: req.params.classId,
        course_id,
        capacity,
        description,
        start_date,
        end_date,
        class_teacher_id
      });
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_CREATED',
        resourceType: 'batch',
        resourceId: batch.id,
        summary: `Batch '${name}' created in class ${req.params.classId}`
      });
      return res.status(201).json({ success: true, data: { batch }, message: 'Batch created.' });
    } catch (err) { next(err); }
  },

  // ── Subjects ───────────────────────────────────────────────
  async getSubjects(req, res, next) {
    try {
      const { status, department } = subjectQuerySchema.parse(req.query);
      const subjects = await lmsRepository.getSubjects({ status, department });
      return res.status(200).json({ success: true, data: { subjects }, message: 'Subjects retrieved.' });
    } catch (err) { next(err); }
  },

  async createSubject(req, res, next) {
    try {
      const { name, code, description, department, status } = createSubjectSchema.parse(req.body);
      const subject = await lmsRepository.createSubject({ name, code, description, department, status });
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'SUBJECT_CREATED',
        resourceType: 'subject',
        resourceId: subject.id,
        summary: `Subject '${name}' (${code || 'N/A'}) created`
      });
      return res.status(201).json({ success: true, data: { subject }, message: 'Subject created.' });
    } catch (err) { next(err); }
  },

  // ── Timetable ──────────────────────────────────────────────
  async getTimetable(req, res, next) {
    try {
      const { class_id: classId, batch_id: batchId, teacher_id: teacherId, day_of_week: dayOfWeek } = timetableQuerySchema.parse(req.query);
      const entries = await lmsRepository.getTimetable({ classId, batchId, teacherId, dayOfWeek });
      return res.status(200).json({ success: true, data: { entries }, message: 'Timetable retrieved.' });
    } catch (err) { next(err); }
  },

  async createTimetableEntry(req, res, next) {
    try {
      const { class_id: classId, batch_id: batchId, subject_id: subjectId, teacher_id: teacherId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime, room, academic_session_id: academicSessionId } = createTimetableEntrySchema.parse(req.body);
      const entry = await lmsRepository.createTimetableEntry({ classId, batchId, subjectId, teacherId, dayOfWeek, startTime, endTime, room, academicSessionId });
      return res.status(201).json({ success: true, data: { entry }, message: 'Timetable entry created.' });
    } catch (err) { next(err); }
  },

  async deleteTimetableEntry(req, res, next) {
    try {
      await lmsRepository.deleteTimetableEntry(req.params.id);
      return res.status(200).json({ success: true, data: {}, message: 'Timetable entry deleted.' });
    } catch (err) { next(err); }
  },

  // ── Attendance ─────────────────────────────────────────────
  async getAttendance(req, res, next) {
    try {
      const { student_id, class_id, subject_id, date, from_date, to_date } = req.query;
      const records = await lmsRepository.getAttendance({ studentId: student_id, classId: class_id, subjectId: subject_id, date, fromDate: from_date, toDate: to_date });
      return res.status(200).json({ success: true, data: { records }, message: 'Attendance records retrieved.' });
    } catch (err) { next(err); }
  },

  // ── Assignments ────────────────────────────────────────────
  async getAssignments(req, res, next) {
    try {
      const { class_id, teacher_id, status } = req.query;
      const assignments = await lmsRepository.getAssignments({ classId: class_id, teacherId: teacher_id, status });
      return res.status(200).json({ success: true, data: { assignments }, message: 'Assignments retrieved.' });
    } catch (err) { next(err); }
  },

  // ── Announcements ──────────────────────────────────────────
  async getAnnouncements(req, res, next) {
    try {
      const { target_type, target_id, status } = req.query;
      const announcements = await lmsRepository.getAnnouncements({ targetType: target_type, targetId: target_id, status });
      return res.status(200).json({ success: true, data: { announcements }, message: 'Announcements retrieved.' });
    } catch (err) { next(err); }
  },

  async createAnnouncement(req, res, next) {
    try {
      const { title, content, target_type, target_id, status, publish_at } = req.body;
      if (!title || !content) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'title and content are required.' } });
      const ann = await lmsRepository.createAnnouncement({ title, content, authorId: req.user.id, targetType: target_type, targetId: target_id, status, publishAt: publish_at });
      return res.status(201).json({ success: true, data: { announcement: ann }, message: 'Announcement created.' });
    } catch (err) { next(err); }
  },

  async updateAnnouncement(req, res, next) {
    try {
      const { title, content, status, publish_at } = req.body;
      const updates = {};
      if (title) updates.title = title;
      if (content) updates.content = content;
      if (status) updates.status = status;
      if (publish_at !== undefined) updates.publish_at = publish_at;
      const ann = await lmsRepository.updateAnnouncement(req.params.id, updates);
      if (!ann) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Announcement not found.' } });
      return res.status(200).json({ success: true, data: { announcement: ann }, message: 'Announcement updated.' });
    } catch (err) { next(err); }
  },

  // ── Live Classes ───────────────────────────────────────────
  async getLiveClasses(req, res, next) {
    try {
      const { teacher_id, class_id, status } = req.query;
      const sessions = await lmsRepository.getLiveClasses({ teacherId: teacher_id, classId: class_id, status });
      return res.status(200).json({ success: true, data: { sessions }, message: 'Live classes retrieved.' });
    } catch (err) { next(err); }
  },

  async createLiveClass(req, res, next) {
    try {
      const { title, description, class_id, batch_id, subject_id, course_id, scheduled_at, meeting_url, teacher_id } = req.body;
      if (!title || !scheduled_at) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'title and scheduled_at are required.' } });
      }
      const session = await lmsRepository.createLiveClass({
        title,
        description: description || '',
        teacherId: sanitizeOptionalString(teacher_id) || req.user.id,
        classId: sanitizeOptionalString(class_id),
        batchId: sanitizeOptionalString(batch_id),
        subjectId: sanitizeOptionalString(subject_id),
        courseId: sanitizeOptionalString(course_id),
        scheduledAt: scheduled_at,
        meetingUrl: meeting_url || null,
        meetingProvider: 'livekit'
      });
      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'SCHEDULE_LIVE_CLASS',
        resourceType: 'live_class_sessions',
        resourceId: session.id,
        summary: `Admin scheduled live session "${title}"`
      });
      return res.status(201).json({
        success: true,
        data: { session },
        message: 'Live lecture broadcast scheduled successfully.'
      });
    } catch (err) { next(err); }
  },

  // ── Leave Requests ─────────────────────────────────────────
  async getLeaveRequests(req, res, next) {
    try {
      const { teacher_id, status } = req.query;
      const requests = await lmsRepository.getLeaveRequests({ teacherId: teacher_id, status });
      return res.status(200).json({ success: true, data: { requests }, message: 'Leave requests retrieved.' });
    } catch (err) { next(err); }
  },

  async reviewLeaveRequest(req, res, next) {
    try {
      const { status, review_note } = req.body;
      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Status must be approved or rejected.' } });
      }
      const updated = await lmsRepository.reviewLeaveRequest(req.params.id, { status, reviewedBy: req.user.id, reviewNote: review_note });
      if (!updated) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave request not found.' } });
      await logAudit({ actorId: req.user.id, actorEmail: req.user.email, action: 'LEAVE_REQUEST_REVIEWED', resourceType: 'leave_request', resourceId: req.params.id, summary: `Leave request ${req.params.id} ${status}` });
      return res.status(200).json({ success: true, data: { request: updated }, message: `Leave request ${status}.` });
    } catch (err) { next(err); }
  },

  // ── Support Tickets ────────────────────────────────────────
  async getTickets(req, res, next) {
    try {
      const { status } = req.query;
      const tickets = await lmsRepository.getTickets({ status });
      return res.status(200).json({ success: true, data: { tickets }, message: 'Support tickets retrieved.' });
    } catch (err) { next(err); }
  },

  async updateTicket(req, res, next) {
    try {
      const { status, admin_response, assigned_to } = req.body;
      const updates = {};
      if (status) updates.status = status;
      if (admin_response !== undefined) updates.admin_response = admin_response;
      if (assigned_to !== undefined) updates.assigned_to = assigned_to;
      if (status === 'resolved') updates.resolved_at = new Date().toISOString();
      const ticket = await lmsRepository.updateTicket(req.params.id, updates);
      if (!ticket) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found.' } });
      return res.status(200).json({ success: true, data: { ticket }, message: 'Ticket updated.' });
    } catch (err) { next(err); }
  },

  // ── Audit Logs ─────────────────────────────────────────────
  async getAuditLogs(req, res, next) {
    try {
      const {
        action,
        category,
        action_type,
        actionType,
        resource_type,
        resourceType,
        target_resource,
        targetResource,
        actor_id,
        actorId,
        search,
        q,
        start_date,
        startDate,
        end_date,
        endDate,
        limit,
        page,
        offset
      } = req.query;

      const sDate = start_date || startDate;
      const eDate = end_date || endDate;

      if (sDate && isNaN(Date.parse(sDate))) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid start_date format.' }
        });
      }
      if (eDate && isNaN(Date.parse(eDate))) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid end_date format.' }
        });
      }

      const parsedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
      const parsedOffset = offset !== undefined && offset !== null
        ? Math.max(0, parseInt(offset, 10) || 0)
        : (Math.max(1, parseInt(page, 10) || 1) - 1) * parsedLimit;

      const result = await auditRepository.getLogs({
        action: action || category || action_type || actionType,
        resourceType: resource_type || resourceType,
        targetResource: target_resource || targetResource,
        actorId: actor_id || actorId,
        search: search || q,
        startDate: sDate,
        endDate: eDate,
        limit: parsedLimit,
        offset: parsedOffset,
        page
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Audit logs retrieved.'
      });
    } catch (err) { next(err); }
  },

  // ── Security Logs ──────────────────────────────────────────
  async getSecurityLogs(req, res, next) {
    try {
      const {
        event_type,
        eventType,
        action,
        category,
        severity,
        user_id,
        userId,
        actor_id,
        actorId,
        target_resource,
        targetResource,
        search,
        q,
        start_date,
        startDate,
        end_date,
        endDate,
        limit,
        page,
        offset
      } = req.query;

      const sDate = start_date || startDate;
      const eDate = end_date || endDate;

      if (sDate && isNaN(Date.parse(sDate))) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid start_date format.' }
        });
      }
      if (eDate && isNaN(Date.parse(eDate))) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid end_date format.' }
        });
      }

      const parsedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
      const parsedOffset = offset !== undefined && offset !== null
        ? Math.max(0, parseInt(offset, 10) || 0)
        : (Math.max(1, parseInt(page, 10) || 1) - 1) * parsedLimit;

      const result = await securityLogRepository.getLogs({
        eventType: event_type || eventType || action || category,
        severity,
        userId: user_id || userId || actor_id || actorId,
        targetResource: target_resource || targetResource,
        search: search || q,
        startDate: sDate,
        endDate: eDate,
        limit: parsedLimit,
        offset: parsedOffset,
        page
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Security logs retrieved.'
      });
    } catch (err) { next(err); }
  },

  // ── Reports ────────────────────────────────────────────────
  async getReportsOverview(req, res, next) {
    try {
      const reportData = await calculateAcademicReports(req.query);

      return res.status(200).json({
        success: true,
        data: {
          report: reportData,
          ...reportData
        },
        message: 'Academic reports analysis retrieved.'
      });
    } catch (err) { next(err); }
  },

  async exportReportsCSV(req, res, next) {
    try {
      const reportData = await calculateAcademicReports(req.query);
      const rows = reportData.recent_submissions || [];

      let csv = 'Attempt ID,Student Name,Student Email,Assessment Title,Assessment Type,Score,Max Score,Percentage (%),Status,Result,Submitted At\r\n';
      rows.forEach(r => {
        const attemptId = `"${(r.id || '').replace(/"/g, '""')}"`;
        const name = `"${(r.student_name || '').replace(/"/g, '""')}"`;
        const email = `"${(r.student_email || '').replace(/"/g, '""')}"`;
        const title = `"${(r.title || '').replace(/"/g, '""')}"`;
        const type = `"${(r.type || '').replace(/"/g, '""')}"`;
        const score = r.score ?? '';
        const maxScore = r.max_score ?? '';
        const pct = r.percentage ?? '';
        const status = `"${(r.status || '').replace(/"/g, '""')}"`;
        const result = r.passed ? 'PASSED' : 'FAILED';
        const date = `"${r.submitted_at ? new Date(r.submitted_at).toISOString() : ''}"`;
        csv += `${attemptId},${name},${email},${title},${type},${score},${maxScore},${pct},${status},${result},${date}\r\n`;
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="linktest-academic-report-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send(csv);
    } catch (err) { next(err); }
  },

  // ── Academic Sessions ──────────────────────────────────────
  async getAcademicSessions(req, res, next) {
    try {
      const sessions = await lmsRepository.getAcademicSessions();
      return res.status(200).json({ success: true, data: { sessions }, message: 'Academic sessions retrieved.' });
    } catch (err) { next(err); }
  }
};

/**
 * Robust Academic Reports Computation Engine
 */
export async function calculateAcademicReports({ course_id, batch_id, start_date, end_date } = {}) {
  if (isPostgresConnected && pool) {
    const [coursesRes, batchesRes, roleCountsRes] = await Promise.all([
      pool.query(`SELECT id, title, category FROM courses ORDER BY title ASC`),
      pool.query(`SELECT id, name, code, class_id FROM batches ORDER BY name ASC`),
      pool.query(`SELECT role, COUNT(*)::int as count FROM users GROUP BY role`)
    ]);

    const roleMap = {};
    roleCountsRes.rows.forEach(r => { roleMap[r.role] = r.count; });

    let qaWhere = 'WHERE 1=1';
    const qaParams = [];
    if (course_id && course_id !== 'ALL') {
      qaParams.push(course_id);
      qaWhere += ` AND q.course_id = $${qaParams.length}`;
    }
    if (start_date) {
      qaParams.push(start_date);
      qaWhere += ` AND qa.submitted_at >= $${qaParams.length}`;
    }
    if (end_date) {
      qaParams.push(end_date);
      qaWhere += ` AND qa.submitted_at <= $${qaParams.length}`;
    }
    if (batch_id && batch_id !== 'ALL') {
      qaParams.push(batch_id);
      qaWhere += ` AND qa.user_id IN (
        SELECT student_id FROM batch_enrollments WHERE batch_id = $${qaParams.length}
        UNION
        SELECT student_id FROM student_class_enrollments WHERE batch_id = $${qaParams.length}
      )`;
    }

    const qaRes = await pool.query(`
      SELECT
        qa.id,
        qa.user_id,
        qa.quiz_id,
        qa.score,
        qa.total_questions,
        qa.submitted_at,
        q.title as quiz_title,
        q.course_id,
        q.pass_percentage,
        u.full_name as student_name,
        u.email as student_email,
        c.title as course_title,
        ROUND((qa.score::numeric / NULLIF(qa.total_questions, 0)) * 100, 1) as percentage,
        CASE WHEN (qa.score::numeric / NULLIF(qa.total_questions, 0)) * 100 >= COALESCE(q.pass_percentage, 50) THEN true ELSE false END as passed
      FROM quiz_attempts qa
      JOIN quizzes q ON qa.quiz_id = q.id
      LEFT JOIN courses c ON q.course_id = c.id
      LEFT JOIN users u ON qa.user_id = u.id
      ${qaWhere}
      ORDER BY qa.submitted_at DESC
    `, qaParams);

    let mtaWhere = 'WHERE 1=1';
    const mtaParams = [];
    if (start_date) {
      mtaParams.push(start_date);
      mtaWhere += ` AND COALESCE(mta.submitted_at, mta.created_at) >= $${mtaParams.length}`;
    }
    if (end_date) {
      mtaParams.push(end_date);
      mtaWhere += ` AND COALESCE(mta.submitted_at, mta.created_at) <= $${mtaParams.length}`;
    }
    if (batch_id && batch_id !== 'ALL') {
      mtaParams.push(batch_id);
      mtaWhere += ` AND mta.student_id IN (
        SELECT student_id FROM batch_enrollments WHERE batch_id = $${mtaParams.length}
        UNION
        SELECT student_id FROM student_class_enrollments WHERE batch_id = $${mtaParams.length}
      )`;
    }

    let mtaRes = { rows: [] };
    if (!course_id || course_id === 'ALL') {
      mtaRes = await pool.query(`
        SELECT
          mta.id,
          mta.test_id,
          mta.student_id,
          mta.total_score,
          mta.max_score,
          mta.percentage,
          mta.passed,
          mta.status,
          mta.submitted_at,
          mta.created_at,
          u.full_name as student_name,
          u.email as student_email,
          mt.title as test_title
        FROM mock_test_attempts mta
        LEFT JOIN mock_tests mt ON mta.test_id = mt.id
        LEFT JOIN users u ON mta.student_id = u.id
        ${mtaWhere}
        ORDER BY COALESCE(mta.submitted_at, mta.created_at) DESC
      `, mtaParams);
    }

    let attWhere = 'WHERE 1=1';
    const attParams = [];
    if (batch_id && batch_id !== 'ALL') {
      attParams.push(batch_id);
      attWhere += ` AND batch_id = $${attParams.length}`;
    }
    if (start_date) {
      attParams.push(start_date);
      attWhere += ` AND date >= $${attParams.length}::date`;
    }
    if (end_date) {
      attParams.push(end_date);
      attWhere += ` AND date <= $${attParams.length}::date`;
    }

    const attRes = await pool.query(`
      SELECT date, status, COUNT(*)::int as count
      FROM attendance_records
      ${attWhere}
      GROUP BY date, status
      ORDER BY date ASC
    `, attParams);

    const allAttempts = [
      ...qaRes.rows.map(q => ({
        id: q.id,
        student_id: q.user_id,
        student_name: q.student_name || 'Student',
        student_email: q.student_email || '',
        title: q.quiz_title || 'Assessment Quiz',
        course_id: q.course_id,
        course_title: q.course_title || 'Curriculum Course',
        type: 'Quiz',
        score: Number(q.score) || 0,
        max_score: Number(q.total_questions) || 0,
        percentage: Number(q.percentage) || 0,
        passed: Boolean(q.passed),
        status: 'evaluated',
        submitted_at: q.submitted_at
      })),
      ...mtaRes.rows.map(m => ({
        id: m.id,
        student_id: m.student_id,
        student_name: m.student_name || 'Student',
        student_email: m.student_email || '',
        title: m.test_title || 'Mock Examination',
        course_id: null,
        course_title: 'Mock Examination',
        type: 'Mock Test',
        score: Number(m.total_score) || 0,
        max_score: Number(m.max_score) || 0,
        percentage: Number(m.percentage) || 0,
        passed: Boolean(m.passed),
        status: m.status || 'evaluated',
        submitted_at: m.submitted_at || m.created_at
      }))
    ].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

    const totalAttempts = allAttempts.length;
    const passedAttempts = allAttempts.filter(a => a.passed).length;
    const passRate = totalAttempts > 0 ? Math.round((passedAttempts / totalAttempts) * 100) : 0;
    const avgScore = totalAttempts > 0
      ? Math.round((allAttempts.reduce((sum, a) => sum + a.percentage, 0) / totalAttempts) * 10) / 10
      : 0;
    const completedAttempts = allAttempts.filter(a => a.status === 'evaluated' || a.status === 'submitted').length;
    const completionRate = totalAttempts > 0 ? Math.round((completedAttempts / totalAttempts) * 100) : 0;

    const scoreDistribution = [
      { range: '0-40%', count: allAttempts.filter(a => a.percentage < 40).length },
      { range: '41-60%', count: allAttempts.filter(a => a.percentage >= 40 && a.percentage < 60).length },
      { range: '61-80%', count: allAttempts.filter(a => a.percentage >= 60 && a.percentage < 80).length },
      { range: '81-100%', count: allAttempts.filter(a => a.percentage >= 80).length }
    ];

    let totalAttRecords = 0;
    let presentAttRecords = 0;
    const dailyMap = {};
    attRes.rows.forEach(r => {
      const d = r.date ? new Date(r.date).toISOString().slice(0, 10) : 'Recent';
      if (!dailyMap[d]) dailyMap[d] = { total: 0, present: 0 };
      dailyMap[d].total += r.count;
      totalAttRecords += r.count;
      if (r.status === 'present') {
        dailyMap[d].present += r.count;
        presentAttRecords += r.count;
      }
    });

    const dailyTrend = Object.keys(dailyMap).map(d => {
      const dayObj = dailyMap[d];
      return {
        date: d,
        name: new Date(d).toLocaleDateString('en-US', { weekday: 'short' }),
        rate: dayObj.total > 0 ? Math.round((dayObj.present / dayObj.total) * 100) : 0,
        total: dayObj.total,
        present: dayObj.present
      };
    });

    const overallAttendanceRate = totalAttRecords > 0
      ? Math.round((presentAttRecords / totalAttRecords) * 100)
      : 100;

    const batchBreakdown = await pool.query(`
      SELECT
        b.id,
        b.name,
        b.code,
        COUNT(DISTINCT be.student_id)::int as student_count
      FROM batches b
      LEFT JOIN batch_enrollments be ON b.id = be.batch_id
      GROUP BY b.id, b.name, b.code
      ORDER BY student_count DESC
    `);

    const courseBreakdown = coursesRes.rows.map(c => {
      const courseAttempts = allAttempts.filter(a => a.course_id === c.id);
      const cTotal = courseAttempts.length;
      const cPassed = courseAttempts.filter(a => a.passed).length;
      const cAvg = cTotal > 0
        ? Math.round((courseAttempts.reduce((s, a) => s + a.percentage, 0) / cTotal) * 10) / 10
        : 0;
      return {
        id: c.id,
        title: c.title,
        category: c.category,
        attempts_count: cTotal,
        avg_score: cAvg,
        pass_rate: cTotal > 0 ? Math.round((cPassed / cTotal) * 100) : 0
      };
    });

    return {
      filters: {
        course_id: course_id || 'ALL',
        batch_id: batch_id || 'ALL',
        start_date: start_date || '',
        end_date: end_date || ''
      },
      available_courses: coursesRes.rows,
      available_batches: batchesRes.rows,
      summary: {
        total_attempts: totalAttempts,
        passed_attempts: passedAttempts,
        pass_rate: passRate,
        avg_score: avgScore,
        completion_rate: completionRate,
        total_students: roleMap.STUDENT || 0,
        total_teachers: roleMap.TEACHER || 0,
        active_courses_count: coursesRes.rows.length,
        attendance_percentage: overallAttendanceRate
      },
      score_distribution: scoreDistribution,
      attendance: {
        overall_percentage: overallAttendanceRate,
        total_records: totalAttRecords,
        present_records: presentAttRecords,
        daily_trend: dailyTrend
      },
      course_breakdown: courseBreakdown,
      batch_breakdown: batchBreakdown.rows,
      recent_submissions: allAttempts.slice(0, 100)
    };
  }

  // Memory Store fallback
  const users = memoryStore.users || [];
  const courses = memoryStore.courses || [];
  const batches = memoryStore.batches || [];
  const quizzes = memoryStore.quizzes || [];
  const quizAttempts = memoryStore.quiz_attempts || [];
  const mockAttempts = memoryStore.mock_test_attempts || [];
  const attendance = memoryStore.attendance_records || [];

  const studentCount = users.filter(u => u.role === 'STUDENT').length;
  const teacherCount = users.filter(u => u.role === 'TEACHER').length;

  let allAttempts = [
    ...quizAttempts.map(qa => {
      const q = quizzes.find(x => x.id === qa.quiz_id);
      const u = users.find(x => x.id === qa.user_id);
      const c = courses.find(x => x.id === q?.course_id);
      const totalQ = qa.total_questions || 5;
      const pct = Math.round(((qa.score || 0) / totalQ) * 100);
      return {
        id: qa.id,
        student_id: qa.user_id,
        student_name: u?.full_name || 'Student',
        student_email: u?.email || '',
        title: q?.title || 'Quiz',
        course_id: q?.course_id || null,
        course_title: c?.title || 'Course',
        type: 'Quiz',
        score: qa.score || 0,
        max_score: totalQ,
        percentage: pct,
        passed: pct >= (q?.pass_percentage || 50),
        status: 'evaluated',
        submitted_at: qa.submitted_at || new Date().toISOString()
      };
    }),
    ...mockAttempts.map(ma => {
      const u = users.find(x => x.id === ma.student_id);
      return {
        id: ma.id,
        student_id: ma.student_id,
        student_name: u?.full_name || 'Student',
        student_email: u?.email || '',
        title: 'Mock Examination',
        course_id: null,
        course_title: 'Mock Examination',
        type: 'Mock Test',
        score: Number(ma.total_score) || 0,
        max_score: Number(ma.max_score) || 0,
        percentage: Number(ma.percentage) || 0,
        passed: Boolean(ma.passed),
        status: ma.status || 'evaluated',
        submitted_at: ma.submitted_at || ma.created_at || new Date().toISOString()
      };
    })
  ].filter(attempt => {
    if (course_id && course_id !== 'ALL' && attempt.course_id !== course_id) return false;

    if (batch_id && batch_id !== 'ALL') {
      const isEnrolled = [
        ...(memoryStore.batch_enrollments || []),
        ...(memoryStore.student_class_enrollments || [])
      ].some(enrollment => enrollment.batch_id === batch_id && enrollment.student_id === attempt.student_id);
      if (!isEnrolled) return false;
    }

    const submittedAt = new Date(attempt.submitted_at).getTime();
    if (start_date && submittedAt < new Date(start_date).getTime()) return false;
    if (end_date && submittedAt > new Date(end_date).getTime()) return false;
    return true;
  }).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

  if (start_date) {
    const startObj = new Date(start_date);
    allAttempts = allAttempts.filter(a => new Date(a.submitted_at) >= startObj);
  }
  if (end_date) {
    const endObj = new Date(end_date);
    allAttempts = allAttempts.filter(a => new Date(a.submitted_at) <= endObj);
  }
  if (course_id && course_id !== 'ALL') {
    allAttempts = allAttempts.filter(a => a.course_id === course_id);
  }

  if (course_id && course_id !== 'ALL') {
    allAttempts = allAttempts.filter(a => a.course_id === course_id);
  }
  if (start_date) {
    allAttempts = allAttempts.filter(a => new Date(a.submitted_at) >= new Date(start_date));
  }
  if (end_date) {
    allAttempts = allAttempts.filter(a => new Date(a.submitted_at) <= new Date(end_date));
  }

  const totalAttempts = allAttempts.length;
  const passedAttempts = allAttempts.filter(a => a.passed).length;
  const passRate = totalAttempts > 0 ? Math.round((passedAttempts / totalAttempts) * 100) : 0;
  const avgScore = totalAttempts > 0
    ? Math.round((allAttempts.reduce((s, a) => s + a.percentage, 0) / totalAttempts) * 10) / 10
    : 0;

  return {
    filters: {
      course_id: course_id || 'ALL',
      batch_id: batch_id || 'ALL',
      start_date: start_date || '',
      end_date: end_date || ''
    },
    available_courses: courses,
    available_batches: batches,
    summary: {
      total_attempts: totalAttempts,
      passed_attempts: passedAttempts,
      pass_rate: passRate,
      avg_score: avgScore,
      completion_rate: totalAttempts > 0 ? 100 : 0,
      total_students: studentCount,
      total_teachers: teacherCount,
      active_courses_count: courses.length,
      attendance_percentage: 90
    },
    score_distribution: [
      { range: '0-40%', count: allAttempts.filter(a => a.percentage < 40).length },
      { range: '41-60%', count: allAttempts.filter(a => a.percentage >= 40 && a.percentage < 60).length },
      { range: '61-80%', count: allAttempts.filter(a => a.percentage >= 60 && a.percentage < 80).length },
      { range: '81-100%', count: allAttempts.filter(a => a.percentage >= 80).length }
    ],
    attendance: {
      overall_percentage: 90,
      total_records: attendance.length,
      present_records: attendance.filter(a => a.status === 'present').length,
      daily_trend: []
    },
    course_breakdown: courses.map(c => ({
      id: c.id,
      title: c.title,
      attempts_count: 0,
      avg_score: 0,
      pass_rate: 0
    })),
    batch_breakdown: batches.map(b => ({
      id: b.id,
      name: b.name,
      code: b.code,
      student_count: 0
    })),
    recent_submissions: allAttempts.slice(0, 100)
  };
}
