import { batchRepository } from '../repositories/batchRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { courseRepository } from '../repositories/courseRepository.js';
import { lmsRepository } from '../repositories/lmsRepository.js';
import { logAudit } from '../repositories/auditRepository.js';
import { notificationService } from '../services/notificationService.js';
import { z } from 'zod';
import { sanitizeOptionalString } from '../utils/sanitize.js';

const normalizeStatus = (val) => {
  if (!val) return 'Active';
  const lower = String(val).toLowerCase().trim();
  if (lower === 'active') return 'Active';
  if (lower === 'upcoming') return 'Upcoming';
  if (lower === 'completed') return 'Completed';
  if (lower === 'archived') return 'Archived';
  return val;
};

const preprocessBatchInput = (val) => {
  if (typeof val === 'object' && val !== null) {
    const copy = { ...val };
    if (copy.max_capacity !== undefined && copy.capacity === undefined) {
      copy.capacity = copy.max_capacity;
    }
    if (copy.status !== undefined) {
      copy.status = normalizeStatus(copy.status);
    }
    return copy;
  }
  return val;
};

const createBatchSchema = z.preprocess(
  preprocessBatchInput,
  z.object({
    name: z.string().min(2, 'Batch name must be at least 2 characters').max(100),
    code: z.string().min(2, 'Batch code must be at least 2 characters').max(50).optional().nullable(),
    course_id: z.string().optional().nullable().transform(sanitizeOptionalString),
    class_id: z.string().optional().nullable().transform(sanitizeOptionalString),
    description: z.string().optional().default(''),
    start_date: z.string().optional().nullable().transform(sanitizeOptionalString),
    end_date: z.string().optional().nullable().transform(sanitizeOptionalString),
    capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1').max(1000).default(40),
    status: z.enum(['Upcoming', 'Active', 'Completed', 'Archived']).default('Active'),
    class_teacher_id: z.string().optional().nullable().transform(sanitizeOptionalString)
  })
);

const updateBatchSchema = z.preprocess(
  preprocessBatchInput,
  z.object({
    name: z.string().min(2, 'Batch name must be at least 2 characters').max(100).optional(),
    code: z.string().min(2, 'Batch code must be at least 2 characters').max(50).optional().nullable(),
    course_id: z.string().optional().nullable().transform(sanitizeOptionalString),
    class_id: z.string().optional().nullable().transform(sanitizeOptionalString),
    description: z.string().optional(),
    start_date: z.string().optional().nullable().transform(sanitizeOptionalString),
    end_date: z.string().optional().nullable().transform(sanitizeOptionalString),
    capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1').max(1000).optional(),
    status: z.enum(['Upcoming', 'Active', 'Completed', 'Archived']).optional(),
    class_teacher_id: z.string().optional().nullable().transform(sanitizeOptionalString)
  })
);

const assignTeacherSchema = z.object({
  teacher_id: z.string().min(1, 'teacher_id is required')
});

const enrollStudentsSchema = z.object({
  student_ids: z.array(z.string().min(1)).min(1, 'At least one student ID is required').optional(),
  student_id: z.string().min(1).optional()
}).refine(data => data.student_ids || data.student_id, {
  message: 'Either student_id or student_ids must be provided'
});

export const batchController = {
  // ── Batch Listing ────────────────────────────────────────────────────────
  async getBatches(req, res, next) {
    try {
      const { search, status, course_id, limit, offset, sort_by, sort_order } = req.query;

      // If requester is a TEACHER, return assigned batches by default unless all/scope=all is requested
      if (req.user.role === 'TEACHER' && req.query.all !== 'true' && req.query.scope !== 'all') {
        const teacherBatches = await batchRepository.getBatchesForTeacher(req.user.id);
        return res.status(200).json({
          success: true,
          data: { batches: teacherBatches },
          message: 'Assigned batches retrieved.'
        });
      }

      // If ADMIN, return all with full filtering
      const batches = await batchRepository.getAllBatches({
        search,
        status,
        courseId: course_id,
        limit: parseInt(limit, 10) || 100,
        offset: parseInt(offset, 10) || 0,
        sortBy: sort_by || 'created_at',
        sortOrder: sort_order || 'DESC'
      });

      return res.status(200).json({
        success: true,
        data: { batches },
        message: 'Batches list retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Create Batch ─────────────────────────────────────────────────────────
  async createBatch(req, res, next) {
    try {
      const validated = createBatchSchema.parse({
        ...req.body,
        ...(req.params.classId ? { class_id: req.params.classId } : {})
      });

      // Validate referenced course exists
      if (validated.course_id) {
        const course = await courseRepository.getById(validated.course_id);
        if (!course) {
          const err = new Error(`Selected curriculum/course (ID: '${validated.course_id}') does not exist.`);
          err.statusCode = 400;
          err.code = 'INVALID_COURSE';
          throw err;
        }
      }

      // Validate referenced class exists
      if (validated.class_id) {
        const cls = await lmsRepository.getClassById(validated.class_id);
        if (!cls) {
          const err = new Error(`Selected class (ID: '${validated.class_id}') does not exist.`);
          err.statusCode = 400;
          err.code = 'INVALID_CLASS';
          throw err;
        }
      }

      // Validate referenced teacher exists
      if (validated.class_teacher_id) {
        const teacher = await userRepository.findById(validated.class_teacher_id);
        if (!teacher || !['TEACHER', 'ADMIN'].includes(teacher.role)) {
          const err = new Error(`Selected faculty member (ID: '${validated.class_teacher_id}') does not exist.`);
          err.statusCode = 400;
          err.code = 'INVALID_TEACHER';
          throw err;
        }
      }

      // Validate date order if both provided
      if (validated.start_date && validated.end_date) {
        if (new Date(validated.start_date) > new Date(validated.end_date)) {
          const err = new Error('Batch start date cannot be after end date.');
          err.statusCode = 400;
          err.code = 'INVALID_DATES';
          throw err;
        }
      }

      // Check code uniqueness if code provided
      if (validated.code) {
        const existing = await batchRepository.findByCode(validated.code);
        if (existing) {
          const err = new Error(`Batch code '${validated.code.toUpperCase()}' is already in use.`);
          err.statusCode = 409;
          err.code = 'CONFLICT';
          throw err;
        }
      }

      const batch = await batchRepository.createBatch(validated);

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_CREATED',
        resourceType: 'batch',
        resourceId: batch.id,
        summary: `Admin created batch '${batch.name}' (Code: ${batch.code})`
      });

      return res.status(201).json({
        success: true,
        data: { batch },
        message: `Batch '${batch.name}' created successfully.`
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Batch Details ────────────────────────────────────────────────────────
  async getBatchDetail(req, res, next) {
    try {
      const { batchId } = req.params;
      const batch = await batchRepository.getBatchById(batchId);

      if (!batch) {
        const err = new Error('Batch not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      // Authorization check for teachers
      if (req.user.role === 'TEACHER') {
        const isAssigned = await batchRepository.isTeacherAssignedToBatch(batchId, req.user.id);
        if (!isAssigned) {
          const err = new Error('Forbidden: You are not assigned to this batch.');
          err.statusCode = 403;
          err.code = 'FORBIDDEN';
          throw err;
        }
      }

      const teachers = await batchRepository.getBatchTeachers(batchId);
      const students = await batchRepository.getBatchStudents(batchId);

      return res.status(200).json({
        success: true,
        data: {
          batch: {
            ...batch,
            teachers,
            students
          }
        },
        message: 'Batch details retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Update Batch ─────────────────────────────────────────────────────────
  async updateBatch(req, res, next) {
    try {
      const { batchId } = req.params;
      const validated = updateBatchSchema.parse(req.body);

      // Validate referenced course exists if provided
      if (validated.course_id) {
        const course = await courseRepository.getById(validated.course_id);
        if (!course) {
          const err = new Error(`Selected curriculum/course (ID: '${validated.course_id}') does not exist.`);
          err.statusCode = 400;
          err.code = 'INVALID_COURSE';
          throw err;
        }
      }

      // Validate referenced class exists if provided
      if (validated.class_id) {
        const cls = await lmsRepository.getClassById(validated.class_id);
        if (!cls) {
          const err = new Error(`Selected class (ID: '${validated.class_id}') does not exist.`);
          err.statusCode = 400;
          err.code = 'INVALID_CLASS';
          throw err;
        }
      }

      // Validate referenced teacher exists if provided
      if (validated.class_teacher_id) {
        const teacher = await userRepository.findById(validated.class_teacher_id);
        if (!teacher || !['TEACHER', 'ADMIN'].includes(teacher.role)) {
          const err = new Error(`Selected faculty member (ID: '${validated.class_teacher_id}') does not exist.`);
          err.statusCode = 400;
          err.code = 'INVALID_TEACHER';
          throw err;
        }
      }

      // Validate date order if both provided
      if (validated.start_date && validated.end_date) {
        if (new Date(validated.start_date) > new Date(validated.end_date)) {
          const err = new Error('Batch start date cannot be after end date.');
          err.statusCode = 400;
          err.code = 'INVALID_DATES';
          throw err;
        }
      }

      // Check code uniqueness if changed
      if (validated.code) {
        const existing = await batchRepository.findByCode(validated.code);
        if (existing && existing.id !== batchId) {
          const err = new Error(`Batch code '${validated.code.toUpperCase()}' is already in use.`);
          err.statusCode = 409;
          err.code = 'CONFLICT';
          throw err;
        }
      }

      const updated = await batchRepository.updateBatch(batchId, validated);
      if (!updated) {
        const err = new Error('Batch not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_UPDATED',
        resourceType: 'batch',
        resourceId: batchId,
        summary: `Admin updated batch '${updated.name}'`
      });

      return res.status(200).json({
        success: true,
        data: { batch: updated },
        message: 'Batch updated successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Archive Batch ────────────────────────────────────────────────────────
  async archiveBatch(req, res, next) {
    try {
      const { batchId } = req.params;
      const archived = await batchRepository.archiveBatch(batchId);
      if (!archived) {
        const err = new Error('Batch not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_ARCHIVED',
        resourceType: 'batch',
        resourceId: batchId,
        summary: `Admin archived batch '${archived.name}'`
      });

      return res.status(200).json({
        success: true,
        data: { batch: archived },
        message: `Batch '${archived.name}' archived successfully.`
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Delete Batch ─────────────────────────────────────────────────────────
  async deleteBatch(req, res, next) {
    try {
      const { batchId } = req.params;
      const result = await batchRepository.deleteBatch(batchId);
      if (!result.success) {
        const err = new Error(result.message || 'Batch not found.');
        err.statusCode = 404;
        err.code = result.code || 'NOT_FOUND';
        throw err;
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_DELETED',
        resourceType: 'batch',
        resourceId: batchId,
        summary: `Admin deleted batch ${batchId}`
      });

      return res.status(200).json({
        success: true,
        message: 'Batch permanently deleted.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Teacher Allocation ───────────────────────────────────────────────────
  async getBatchTeachers(req, res, next) {
    try {
      const { batchId } = req.params;

      if (req.user.role === 'TEACHER') {
        const isAssigned = await batchRepository.isTeacherAssignedToBatch(batchId, req.user.id);
        if (!isAssigned) {
          const err = new Error('Forbidden: You are not assigned to this batch.');
          err.statusCode = 403;
          err.code = 'FORBIDDEN';
          throw err;
        }
      }

      const teachers = await batchRepository.getBatchTeachers(batchId);
      return res.status(200).json({
        success: true,
        data: { teachers },
        message: 'Assigned teachers retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  async assignTeacher(req, res, next) {
    try {
      const { batchId } = req.params;
      const { teacher_id } = assignTeacherSchema.parse(req.body);

      // Verify batch existence
      const batch = await batchRepository.getBatchById(batchId);
      if (!batch) {
        const err = new Error('Batch not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      // Verify teacher eligibility
      const teacher = await userRepository.findById(teacher_id);
      if (!teacher || teacher.role !== 'TEACHER') {
        const err = new Error('Selected account is not an active faculty teacher.');
        err.statusCode = 400;
        err.code = 'INVALID_TEACHER';
        throw err;
      }

      const allocation = await batchRepository.assignTeacherToBatch({
        batchId,
        teacherId: teacher_id,
        assignedBy: req.user.id
      });

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_TEACHER_ASSIGNED',
        resourceType: 'batch_teacher',
        resourceId: allocation.id,
        summary: `Admin assigned teacher ${teacher.full_name} (${teacher.email}) to batch '${batch.name}'`
      });

      // Unified Notification Event: Notify teacher of batch assignment
      notificationService.createNotification({
        userId: teacher_id,
        title: 'New Batch Assigned',
        message: `You have been allocated to teach academic batch "${batch.name}".`,
        type: 'INFO',
        priority: 'NORMAL',
        actionUrl: '/teacher/classes',
        actionLabel: 'View Batches',
        relatedEntityType: 'BATCH',
        relatedEntityId: batchId,
        eventKey: `teacher:${teacher_id}:batch:${batchId}:ASSIGNED`
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        data: { allocation },
        message: `Teacher ${teacher.full_name} assigned to batch '${batch.name}' successfully.`
      });
    } catch (err) {
      next(err);
    }
  },

  async removeTeacher(req, res, next) {
    try {
      const { batchId, teacherId } = req.params;

      const removed = await batchRepository.removeTeacherFromBatch(batchId, teacherId);
      if (!removed) {
        const err = new Error('Teacher assignment not found for this batch.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_TEACHER_REMOVED',
        resourceType: 'batch_teacher',
        resourceId: `${batchId}-${teacherId}`,
        summary: `Admin removed teacher ${teacherId} from batch ${batchId}`
      });

      return res.status(200).json({
        success: true,
        message: 'Teacher removed from batch.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Student Enrollment ───────────────────────────────────────────────────
  async getBatchStudents(req, res, next) {
    try {
      const { batchId } = req.params;

      if (req.user.role === 'TEACHER') {
        const isAssigned = await batchRepository.isTeacherAssignedToBatch(batchId, req.user.id);
        if (!isAssigned) {
          const err = new Error('Forbidden: You are not assigned to this batch.');
          err.statusCode = 403;
          err.code = 'FORBIDDEN';
          throw err;
        }
      }

      const students = await batchRepository.getBatchStudents(batchId);
      return res.status(200).json({
        success: true,
        data: { students },
        message: 'Enrolled students retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  async enrollStudents(req, res, next) {
    try {
      const { batchId } = req.params;
      const { student_ids, student_id } = enrollStudentsSchema.parse(req.body);

      // Verify batch existence
      const batch = await batchRepository.getBatchById(batchId);
      if (!batch) {
        const err = new Error('Batch not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      // If TEACHER, strictly enforce they are assigned to this batch!
      if (req.user.role === 'TEACHER') {
        const isAssigned = await batchRepository.isTeacherAssignedToBatch(batchId, req.user.id);
        if (!isAssigned) {
          const err = new Error('Forbidden: You cannot enroll students into a batch you are not assigned to.');
          err.statusCode = 403;
          err.code = 'FORBIDDEN';
          throw err;
        }
      }

      const targetStudentIds = student_ids || [student_id];
      const result = await batchRepository.enrollStudentsBulkInBatch({
        batchId,
        studentIds: targetStudentIds,
        enrolledBy: req.user.id
      });

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_STUDENTS_ENROLLED',
        resourceType: 'batch_enrollment',
        resourceId: batchId,
        summary: `${req.user.role} enrolled ${result.total_enrolled} student(s) into batch '${batch.name}'`
      });

      return res.status(201).json({
        success: true,
        data: result,
        message: `Successfully enrolled ${result.total_enrolled} student(s) into '${batch.name}'.`
      });
    } catch (err) {
      next(err);
    }
  },

  async removeStudent(req, res, next) {
    try {
      const { batchId, studentId } = req.params;

      if (req.user.role === 'TEACHER') {
        const isAssigned = await batchRepository.isTeacherAssignedToBatch(batchId, req.user.id);
        if (!isAssigned) {
          const err = new Error('Forbidden: You cannot modify enrollments for a batch you are not assigned to.');
          err.statusCode = 403;
          err.code = 'FORBIDDEN';
          throw err;
        }
      }

      const removed = await batchRepository.removeStudentFromBatch(batchId, studentId);
      if (!removed) {
        const err = new Error('Student enrollment record not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }

      await logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'BATCH_STUDENT_REMOVED',
        resourceType: 'batch_enrollment',
        resourceId: `${batchId}-${studentId}`,
        summary: `${req.user.role} removed student ${studentId} from batch ${batchId}`
      });

      return res.status(200).json({
        success: true,
        message: 'Student removed from batch.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Database Student Search (Core Requirement) ───────────────────────────
  async searchStudents(req, res, next) {
    try {
      const q = (req.query.query || req.query.q || req.query.search || '').trim();
      const { page = 1, limit = 20 } = req.query;

      const result = await userRepository.searchStudents({
        query: q,
        page: parseInt(page, 10) || 1,
        limit: Math.min(parseInt(limit, 10) || 20, 100)
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Eligible students retrieved.'
      });
    } catch (err) {
      next(err);
    }
  }
};
