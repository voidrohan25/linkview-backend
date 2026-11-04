import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';
import { sanitizeOptionalString } from '../utils/sanitize.js';

function timetableConflictsWith(existingEntry, requestedEntry) {
  const conflictTypes = [];
  if (existingEntry.teacher_id === requestedEntry.teacherId) conflictTypes.push('teacher');
  if (requestedEntry.room && existingEntry.room &&
      existingEntry.room.trim().toLowerCase() === requestedEntry.room.trim().toLowerCase()) {
    conflictTypes.push('room');
  }
  return conflictTypes.length > 0 ? {
    entry_id: existingEntry.id,
    teacher_id: existingEntry.teacher_id,
    room: existingEntry.room,
    day_of_week: existingEntry.day_of_week,
    start_time: existingEntry.start_time,
    end_time: existingEntry.end_time,
    conflict_types: conflictTypes
  } : null;
}

function createTimetableCollisionError(conflicts) {
  const conflictTypes = [...new Set(conflicts.flatMap(conflict => conflict.conflict_types))];
  const resources = conflictTypes.map(type => type === 'teacher' ? 'teacher' : 'room').join(' and ');
  const error = new Error(`The requested timetable period conflicts with an existing ${resources} booking.`);
  error.statusCode = 409;
  error.code = 'TIMETABLE_COLLISION';
  error.details = { conflicts };
  return error;
}

export const lmsRepository = {
  async isTeacherAssignedToStudent(teacherId, studentId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT
           EXISTS (
             SELECT 1
             FROM student_class_enrollments sce
             WHERE sce.student_id = $2
               AND (
                 EXISTS (
                   SELECT 1
                   FROM teacher_assignments ta
                   WHERE ta.teacher_id = $1
                     AND ta.class_id = sce.class_id
                     AND (ta.batch_id IS NULL OR ta.batch_id = sce.batch_id)
                 )
                 OR EXISTS (
                   SELECT 1
                   FROM batch_teachers bt
                   WHERE bt.teacher_id = $1
                     AND bt.batch_id = sce.batch_id
                 )
               )
           )
           OR EXISTS (
             SELECT 1
             FROM batch_enrollments be
             JOIN batch_teachers bt ON bt.batch_id = be.batch_id
             WHERE be.student_id = $2
               AND be.status = 'active'
               AND bt.teacher_id = $1
           ) AS authorized`,
        [teacherId, studentId]
      );
      return Boolean(res.rows[0]?.authorized);
    }

    const classEnrollments = (memoryStore.student_class_enrollments || [])
      .filter(enrollment => enrollment.student_id === studentId);
    const classAssignment = classEnrollments.some(enrollment =>
      (memoryStore.teacher_assignments || []).some(assignment =>
        assignment.teacher_id === teacherId &&
        assignment.class_id === enrollment.class_id &&
        (!assignment.batch_id || assignment.batch_id === enrollment.batch_id)
      )
    );
    const assignedBatches = new Set([
      ...classEnrollments.map(enrollment => enrollment.batch_id).filter(Boolean),
      ...(memoryStore.batch_enrollments || [])
        .filter(enrollment => enrollment.student_id === studentId && enrollment.status === 'active')
        .map(enrollment => enrollment.batch_id)
    ]);
    const batchAssignment = [...assignedBatches].some(batchId =>
      (memoryStore.batch_teachers || []).some(
        assignment => assignment.teacher_id === teacherId && assignment.batch_id === batchId
      )
    );

    return classAssignment || batchAssignment;
  },

  // ============================================================
  // CLASSES
  // ============================================================
  async getClasses() {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT c.*, s.name as session_name,
                COUNT(DISTINCT sce.student_id)::int as student_count,
                COUNT(DISTINCT b.id)::int as batch_count
         FROM classes c
         LEFT JOIN academic_sessions s ON c.academic_session_id = s.id
         LEFT JOIN batches b ON b.class_id = c.id
         LEFT JOIN student_class_enrollments sce ON sce.class_id = c.id
         GROUP BY c.id, s.name ORDER BY c.created_at DESC`
      );
      return res.rows;
    }
    return memoryStore.classes.map(cls => {
      const batches = memoryStore.batches.filter(b => b.class_id === cls.id);
      const students = memoryStore.student_class_enrollments.filter(e => e.class_id === cls.id);
      const session = memoryStore.academic_sessions.find(s => s.id === cls.academic_session_id);
      return { ...cls, session_name: session?.name, student_count: students.length, batch_count: batches.length };
    });
  },

  async getClassById(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM classes WHERE id = $1', [id]);
      return res.rows[0] || null;
    }
    return memoryStore.classes.find(c => c.id === id) || null;
  },

  async createClass({ name, description, academicSessionId }) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO classes (id, name, description, academic_session_id, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, name, description, academicSessionId, created_at]
      );
      return res.rows[0];
    }
    const cls = { id, name, description, academic_session_id: academicSessionId, created_at };
    memoryStore.classes.push(cls);
    return cls;
  },

  async updateClass(id, { name, description, academicSessionId }) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE classes SET name=COALESCE($1,name), description=COALESCE($2,description), academic_session_id=COALESCE($3,academic_session_id) WHERE id=$4 RETURNING *`,
        [name, description, academicSessionId, id]
      );
      return res.rows[0] || null;
    }
    const cls = memoryStore.classes.find(c => c.id === id);
    if (!cls) return null;
    if (name) cls.name = name;
    if (description !== undefined) cls.description = description;
    if (academicSessionId) cls.academic_session_id = academicSessionId;
    return cls;
  },

  // ============================================================
  // BATCHES
  // ============================================================
  async getBatchesByClass(classId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT b.*, u.full_name as class_teacher_name, COUNT(sce.student_id)::int as student_count
         FROM batches b
         LEFT JOIN users u ON b.class_teacher_id = u.id
         LEFT JOIN student_class_enrollments sce ON sce.batch_id = b.id
         WHERE b.class_id = $1 GROUP BY b.id, u.full_name ORDER BY b.name`,
        [classId]
      );
      return res.rows;
    }
    return memoryStore.batches
      .filter(b => b.class_id === classId)
      .map(b => {
        const teacher = memoryStore.users.find(u => u.id === b.class_teacher_id);
        const students = memoryStore.student_class_enrollments.filter(e => e.batch_id === b.id);
        return { ...b, class_teacher_name: teacher?.full_name, student_count: students.length };
      });
  },

  async createBatch({ classId, name, capacity, classTeacherId }) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    const normalizedClassTeacherId = sanitizeOptionalString(classTeacherId);
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO batches (id, class_id, name, capacity, class_teacher_id, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, classId, name, capacity || 50, normalizedClassTeacherId, created_at]
      );
      return res.rows[0];
    }
    const batch = { id, class_id: classId, name, capacity: capacity || 50, class_teacher_id: normalizedClassTeacherId, created_at };
    memoryStore.batches.push(batch);
    return batch;
  },

  // ============================================================
  // SUBJECTS
  // ============================================================
  async getSubjects({ status, department } = {}) {
    if (isPostgresConnected && pool) {
      const filters = [];
      const params = [];
      if (status) {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }
      if (department) {
        params.push(department.trim());
        filters.push(`LOWER(department) = LOWER($${params.length})`);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const res = await pool.query(`SELECT * FROM subjects ${where} ORDER BY name`, params);
      return res.rows;
    }
    return [...memoryStore.subjects]
      .filter(subject => !status || (subject.status || 'active') === status)
      .filter(subject => !department || subject.department?.trim().toLowerCase() === department.trim().toLowerCase())
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async createSubject({ name, code, description, department, status = 'active' }) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    const normalizedCode = code.trim().toUpperCase();
    const normalizedDepartment = department?.trim() || null;
    if (isPostgresConnected && pool) {
      try {
        const duplicate = await pool.query(
          'SELECT id FROM subjects WHERE UPPER(code) = $1 LIMIT 1',
          [normalizedCode]
        );
        if (duplicate.rows.length > 0) {
          const error = new Error(`Subject code ${normalizedCode} is already in use.`);
          error.statusCode = 409;
          error.code = 'SUBJECT_CODE_CONFLICT';
          throw error;
        }
        const res = await pool.query(
          `INSERT INTO subjects (id, name, code, description, department, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [id, name, normalizedCode, description || null, normalizedDepartment, status, created_at]
        );
        return res.rows[0];
      } catch (err) {
        if (err.code === '23505') {
          const conflict = new Error(`Subject code ${normalizedCode} is already in use.`);
          conflict.statusCode = 409;
          conflict.code = 'SUBJECT_CODE_CONFLICT';
          throw conflict;
        }
        throw err;
      }
    }
    if (memoryStore.subjects.some(subject => subject.code?.toUpperCase() === normalizedCode)) {
      const error = new Error(`Subject code ${normalizedCode} is already in use.`);
      error.statusCode = 409;
      error.code = 'SUBJECT_CODE_CONFLICT';
      throw error;
    }
    const subject = {
      id,
      name,
      code: normalizedCode,
      description: description || null,
      department: normalizedDepartment,
      status,
      created_at
    };
    memoryStore.subjects.push(subject);
    return subject;
  },

  // ============================================================
  // ACADEMIC SESSIONS
  // ============================================================
  async getAcademicSessions() {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM academic_sessions ORDER BY start_date DESC');
      return res.rows;
    }
    return [...memoryStore.academic_sessions].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  },

  // ============================================================
  // TEACHER ASSIGNMENTS
  // ============================================================
  async getTeacherAssignments(teacherId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT ta.*, c.name as class_name, b.name as batch_name, s.name as subject_name, s.code as subject_code
         FROM teacher_assignments ta
         LEFT JOIN classes c ON ta.class_id = c.id
         LEFT JOIN batches b ON ta.batch_id = b.id
         JOIN subjects s ON ta.subject_id = s.id
         WHERE ta.teacher_id = $1
         ORDER BY ta.assigned_at DESC`,
        [teacherId]
      );
      return res.rows;
    }
    return (memoryStore.teacher_assignments || [])
      .filter(ta => ta.teacher_id === teacherId)
      .map(ta => {
        const cls = (memoryStore.classes || []).find(c => c.id === ta.class_id);
        const batch = (memoryStore.batches || []).find(b => b.id === ta.batch_id);
        const subject = (memoryStore.subjects || []).find(s => s.id === ta.subject_id);
        return { ...ta, class_name: cls?.name, batch_name: batch?.name, subject_name: subject?.name, subject_code: subject?.code };
      });
  },

  async getAssignedClassesWithStudents(teacherId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
       `SELECT bt.id as batch_teacher_id, bt.assigned_at as batch_assigned_at,
               b.id as batch_id, b.name as batch_name, c.id as class_id, c.name as class_name,
               ta.id as assignment_id, ta.subject_id, ta.assigned_at as subject_assigned_at,
               s.name as subject_name, s.code as subject_code,
               u.id as student_id, u.full_name, u.email, sp.enrollment_number
        FROM batch_teachers bt
        JOIN batches b ON b.id = bt.batch_id
        JOIN classes c ON c.id = b.class_id
        LEFT JOIN teacher_assignments ta
          ON ta.teacher_id = bt.teacher_id AND ta.batch_id = bt.batch_id AND ta.class_id = b.class_id
        LEFT JOIN subjects s ON s.id = ta.subject_id
        LEFT JOIN batch_enrollments be ON be.batch_id = b.id AND be.status = 'active'
        LEFT JOIN users u ON u.id = be.student_id AND u.role = 'STUDENT'
        LEFT JOIN student_profiles sp ON sp.user_id = u.id
        WHERE bt.teacher_id = $1
        ORDER BY c.name, b.name, s.name, u.full_name`,
       [teacherId]
      );

      const classesByAssignment = new Map();
      for (const row of res.rows) {
       const key = `${row.batch_id}:${row.subject_id || ''}`;
       let assignment = classesByAssignment.get(key);
       if (!assignment) {
         assignment = {
           id: row.assignment_id || row.batch_teacher_id,
           teacher_id: teacherId,
           class_id: row.class_id,
           batch_id: row.batch_id,
           subject_id: row.subject_id,
           assigned_at: row.subject_assigned_at || row.batch_assigned_at,
           class_name: row.class_name,
           batch_name: row.batch_name,
           subject_name: row.subject_name,
           subject_code: row.subject_code,
           students: [],
           student_count: 0
         };
         classesByAssignment.set(key, assignment);
       }
       if (row.student_id) {
         assignment.students.push({
           student_id: row.student_id,
           full_name: row.full_name,
           enrollment_number: row.enrollment_number,
           email: row.email
         });
       }
      }

      const assignments = Array.from(classesByAssignment.values());
      for (const assignment of assignments) {
       assignment.student_count = assignment.students.length;
      }
      return assignments;
    }

    const assignedBatches = memoryStore.batch_teachers.filter(item => item.teacher_id === teacherId);
    const classesByAssignment = new Map();
    for (const batchTeacher of assignedBatches) {
      const batch = memoryStore.batches.find(item => item.id === batchTeacher.batch_id);
      if (!batch) continue;
      const cls = memoryStore.classes.find(item => item.id === batch.class_id);
      if (!cls) continue;
      const subjectAssignments = memoryStore.teacher_assignments.filter(assignment =>
       assignment.teacher_id === teacherId &&
       assignment.batch_id === batch.id &&
       assignment.class_id === batch.class_id
      );
      const assignments = subjectAssignments.length > 0 ? subjectAssignments : [null];
      for (const subjectAssignment of assignments) {
       const subject = subjectAssignment
         ? memoryStore.subjects.find(item => item.id === subjectAssignment.subject_id)
         : null;
       const students = memoryStore.batch_enrollments
         .filter(enrollment => enrollment.batch_id === batch.id && enrollment.status === 'active')
         .map(enrollment => {
           const user = memoryStore.users.find(item => item.id === enrollment.student_id && item.role === 'STUDENT');
           const profile = memoryStore.student_profiles.find(item => item.user_id === enrollment.student_id);
           return user ? {
             student_id: user.id,
             full_name: user.full_name,
             enrollment_number: profile?.enrollment_number || null,
             email: user.email
           } : null;
         })
         .filter(Boolean)
         .sort((left, right) => left.full_name.localeCompare(right.full_name));
       const assignmentId = subjectAssignment?.id || batchTeacher.id;
       classesByAssignment.set(`${batch.id}:${subjectAssignment?.subject_id || ''}`, {
         id: assignmentId,
         teacher_id: teacherId,
         class_id: cls.id,
         batch_id: batch.id,
         subject_id: subjectAssignment?.subject_id || null,
         assigned_at: subjectAssignment?.assigned_at || batchTeacher.assigned_at,
         class_name: cls.name,
         batch_name: batch.name,
         subject_name: subject?.name,
         subject_code: subject?.code,
         students,
         student_count: students.length
       });
      }
    }
    return Array.from(classesByAssignment.values());
  },

  async getAssignmentById(assignmentId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT ta.*, c.name as class_name, b.name as batch_name, s.name as subject_name, s.code as subject_code,
                u.full_name as teacher_name, u.email as teacher_email
         FROM teacher_assignments ta
         LEFT JOIN classes c ON ta.class_id = c.id
         LEFT JOIN batches b ON ta.batch_id = b.id
         JOIN subjects s ON ta.subject_id = s.id
         JOIN users u ON ta.teacher_id = u.id
         WHERE ta.id = $1`,
        [assignmentId]
      );
      return res.rows[0] || null;
    }
    const ta = (memoryStore.teacher_assignments || []).find(a => a.id === assignmentId);
    if (!ta) return null;
    const cls = (memoryStore.classes || []).find(c => c.id === ta.class_id);
    const batch = (memoryStore.batches || []).find(b => b.id === ta.batch_id);
    const subject = (memoryStore.subjects || []).find(s => s.id === ta.subject_id);
    const user = (memoryStore.users || []).find(u => u.id === ta.teacher_id);
    return { ...ta, class_name: cls?.name, batch_name: batch?.name, subject_name: subject?.name, subject_code: subject?.code, teacher_name: user?.full_name, teacher_email: user?.email };
  },

  async getBatchAssignments(batchId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT ta.*, c.name as class_name, b.name as batch_name, b.code as batch_code,
                s.name as subject_name, s.code as subject_code,
                u.full_name as teacher_name, u.email as teacher_email, u.avatar_url as teacher_avatar
         FROM teacher_assignments ta
         LEFT JOIN classes c ON ta.class_id = c.id
         LEFT JOIN batches b ON ta.batch_id = b.id
         JOIN subjects s ON ta.subject_id = s.id
         JOIN users u ON ta.teacher_id = u.id
         WHERE ta.batch_id = $1
         ORDER BY s.name ASC, ta.assigned_at DESC`,
        [batchId]
      );
      return res.rows;
    }
    return (memoryStore.teacher_assignments || [])
      .filter(ta => ta.batch_id === batchId)
      .map(ta => {
        const cls = (memoryStore.classes || []).find(c => c.id === ta.class_id);
        const batch = (memoryStore.batches || []).find(b => b.id === ta.batch_id);
        const subject = (memoryStore.subjects || []).find(s => s.id === ta.subject_id);
        const user = (memoryStore.users || []).find(u => u.id === ta.teacher_id);
        return {
          ...ta,
          class_name: cls?.name,
          batch_name: batch?.name,
          batch_code: batch?.code,
          subject_name: subject?.name,
          subject_code: subject?.code,
          teacher_name: user?.full_name,
          teacher_email: user?.email,
          teacher_avatar: user?.avatar_url
        };
      });
  },

  async getAllTeacherAssignments() {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT ta.*, c.name as class_name, b.name as batch_name, b.code as batch_code,
                s.name as subject_name, s.code as subject_code,
                u.full_name as teacher_name, u.email as teacher_email
         FROM teacher_assignments ta
         LEFT JOIN classes c ON ta.class_id = c.id
         LEFT JOIN batches b ON ta.batch_id = b.id
         JOIN subjects s ON ta.subject_id = s.id
         JOIN users u ON ta.teacher_id = u.id
         ORDER BY ta.assigned_at DESC`
      );
      return res.rows;
    }
    return (memoryStore.teacher_assignments || []).map(ta => {
      const cls = (memoryStore.classes || []).find(c => c.id === ta.class_id);
      const batch = (memoryStore.batches || []).find(b => b.id === ta.batch_id);
      const subject = (memoryStore.subjects || []).find(s => s.id === ta.subject_id);
      const user = (memoryStore.users || []).find(u => u.id === ta.teacher_id);
      return {
        ...ta,
        class_name: cls?.name,
        batch_name: batch?.name,
        batch_code: batch?.code,
        subject_name: subject?.name,
        subject_code: subject?.code,
        teacher_name: user?.full_name,
        teacher_email: user?.email
      };
    });
  },

  async assignTeacher({ teacherId, classId, batchId, subjectId }) {
    const normalizedBatchId = sanitizeOptionalString(batchId);
    if (isPostgresConnected && pool) {
      // Check if duplicate assignment exists
      const exists = await pool.query(
        `SELECT id FROM teacher_assignments WHERE teacher_id=$1 AND class_id=$2 AND subject_id=$3 AND (batch_id=$4 OR (batch_id IS NULL AND $4 IS NULL))`,
        [teacherId, classId, subjectId, normalizedBatchId]
      );
      if (exists.rows.length > 0) {
        const err = new Error('This subject is already assigned to this teacher for the specified class/batch.');
        err.statusCode = 409;
        err.code = 'ALREADY_ASSIGNED';
        throw err;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await pool.query(
        `INSERT INTO teacher_assignments (id, teacher_id, class_id, batch_id, subject_id, assigned_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, teacherId, classId, normalizedBatchId, subjectId, now]
      );
      return this.getAssignmentById(id);
    }
    if (!memoryStore.teacher_assignments) memoryStore.teacher_assignments = [];
    const existing = memoryStore.teacher_assignments.find(
      ta => ta.teacher_id === teacherId && ta.class_id === classId && ta.subject_id === subjectId && ta.batch_id === normalizedBatchId
    );
    if (existing) {
      const err = new Error('This subject is already assigned to this teacher for the specified class/batch.');
      err.statusCode = 409;
      err.code = 'ALREADY_ASSIGNED';
      throw err;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const ta = { id, teacher_id: teacherId, class_id: classId, batch_id: normalizedBatchId, subject_id: subjectId, assigned_at: now };
    memoryStore.teacher_assignments.push(ta);
    return this.getAssignmentById(id);
  },

  async updateTeacherAssignment(assignmentId, { teacherId }) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE teacher_assignments SET teacher_id = $1 WHERE id = $2 RETURNING *`,
        [teacherId, assignmentId]
      );
      if (res.rows.length === 0) return null;
      return this.getAssignmentById(assignmentId);
    }
    const ta = (memoryStore.teacher_assignments || []).find(a => a.id === assignmentId);
    if (!ta) return null;
    ta.teacher_id = teacherId;
    return this.getAssignmentById(assignmentId);
  },

  async removeTeacherAssignment(assignmentId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('DELETE FROM teacher_assignments WHERE id = $1 RETURNING *', [assignmentId]);
      return res.rows[0] || null;
    }
    const idx = (memoryStore.teacher_assignments || []).findIndex(ta => ta.id === assignmentId);
    if (idx === -1) return null;
    const deleted = memoryStore.teacher_assignments.splice(idx, 1)[0];
    return deleted;
  },

  // ============================================================
  // STUDENT CLASS ENROLLMENTS
  // ============================================================
  async enrollStudentInClass({ studentId, classId, batchId }) {
    if (isPostgresConnected && pool) {
      const exists = await pool.query(
        'SELECT id FROM student_class_enrollments WHERE student_id=$1 AND class_id=$2',
        [studentId, classId]
      );
      if (exists.rows.length > 0) return exists.rows[0];
      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO student_class_enrollments (id, student_id, class_id, batch_id, enrolled_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, studentId, classId, batchId || null, new Date().toISOString()]
      );
      return res.rows[0];
    }
    const existing = memoryStore.student_class_enrollments.find(e => e.student_id === studentId && e.class_id === classId);
    if (existing) return existing;
    const enrollment = { id: crypto.randomUUID(), student_id: studentId, class_id: classId, batch_id: batchId || null, enrolled_at: new Date().toISOString() };
    memoryStore.student_class_enrollments.push(enrollment);
    return enrollment;
  },

  async getStudentsInClass(classId, batchId = null) {
    if (isPostgresConnected && pool) {
      let query = `
        WITH combined_enrollments AS (
          SELECT sce.student_id, sce.class_id, sce.batch_id, sce.enrolled_at
          FROM student_class_enrollments sce
          UNION ALL
          SELECT be.student_id, b.class_id, be.batch_id, be.enrolled_at
          FROM batch_enrollments be
          JOIN batches b ON b.id = be.batch_id
          WHERE (be.status = 'active' OR be.status IS NULL)
        )
        SELECT DISTINCT ON (u.id)
               u.id,
               u.full_name,
               u.email,
               u.status,
               u.last_login_at,
               sp.enrollment_number,
               ce.batch_id,
               b.name as batch_name,
               ce.enrolled_at
        FROM combined_enrollments ce
        JOIN users u ON ce.student_id = u.id AND u.role = 'STUDENT'
        LEFT JOIN student_profiles sp ON sp.user_id = u.id
        LEFT JOIN batches b ON b.id = ce.batch_id
        WHERE 1=1`;
      const params = [];
      if (classId) {
        params.push(classId);
        query += ` AND ce.class_id = $${params.length}`;
      }
      if (batchId) {
        params.push(batchId);
        query += ` AND ce.batch_id = $${params.length}`;
      }
      query += ` ORDER BY u.id, ce.enrolled_at DESC`;
      const res = await pool.query(`SELECT * FROM (${query}) sub ORDER BY full_name ASC`, params);
      return res.rows;
    }

    const activeBatchEnrollments = (memoryStore.batch_enrollments || [])
      .filter(be => (be.status === 'active' || !be.status))
      .map(be => {
        const batch = (memoryStore.batches || []).find(b => b.id === be.batch_id);
        return {
          student_id: be.student_id,
          class_id: batch?.class_id || null,
          batch_id: be.batch_id,
          enrolled_at: be.enrolled_at
        };
      });

    const classEnrollments = (memoryStore.student_class_enrollments || [])
      .map(sce => ({
        student_id: sce.student_id,
        class_id: sce.class_id,
        batch_id: sce.batch_id || null,
        enrolled_at: sce.enrolled_at
      }));

    let allEnrollments = [...classEnrollments, ...activeBatchEnrollments];
    if (classId) {
      allEnrollments = allEnrollments.filter(e => e.class_id === classId);
    }
    if (batchId) {
      allEnrollments = allEnrollments.filter(e => e.batch_id === batchId);
    }

    const studentMap = new Map();
    for (const e of allEnrollments) {
      if (studentMap.has(e.student_id)) continue;
      const user = (memoryStore.users || []).find(u => u.id === e.student_id && u.role === 'STUDENT');
      if (!user) continue;
      const profile = (memoryStore.student_profiles || []).find(p => p.user_id === e.student_id);
      const batch = (memoryStore.batches || []).find(b => b.id === e.batch_id);
      const { password_hash, ...safeUser } = user;
      studentMap.set(e.student_id, {
        ...safeUser,
        enrollment_number: profile?.enrollment_number,
        batch_id: e.batch_id,
        enrolled_at: e.enrolled_at,
        batch_name: batch?.name
      });
    }

    return Array.from(studentMap.values()).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  },

  async getClassesForStudent(studentId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT DISTINCT c.*, b.name as batch_name, COALESCE(sce.batch_id, be.batch_id) as batch_id
         FROM classes c
         LEFT JOIN student_class_enrollments sce ON sce.class_id = c.id AND sce.student_id = $1
         LEFT JOIN batches b ON b.class_id = c.id
         LEFT JOIN batch_enrollments be ON be.batch_id = b.id AND be.student_id = $1 AND (be.status = 'active' OR be.status IS NULL)
         WHERE sce.student_id = $1 OR be.student_id = $1`,
        [studentId]
      );
      return res.rows;
    }
    const studentClassEnrollments = (memoryStore.student_class_enrollments || []).filter(e => e.student_id === studentId);
    const studentBatchEnrollments = (memoryStore.batch_enrollments || []).filter(e => e.student_id === studentId && (e.status === 'active' || !e.status));
    const batchClassIds = new Set(
      studentBatchEnrollments.map(be => (memoryStore.batches || []).find(b => b.id === be.batch_id)?.class_id).filter(Boolean)
    );
    const allClasses = (memoryStore.classes || []).filter(c =>
      studentClassEnrollments.some(e => e.class_id === c.id) || batchClassIds.has(c.id)
    );
    return allClasses.map(c => {
      const sce = studentClassEnrollments.find(e => e.class_id === c.id);
      const sbe = studentBatchEnrollments.find(be => {
        const b = (memoryStore.batches || []).find(x => x.id === be.batch_id);
        return b?.class_id === c.id;
      });
      const batchId = sce?.batch_id || sbe?.batch_id;
      const batch = (memoryStore.batches || []).find(b => b.id === batchId);
      return { ...c, batch_id: batchId, batch_name: batch?.name };
    });
  },

  // ============================================================
  // TIMETABLE
  // ============================================================
  async getTimetable({ classId, batchId, teacherId, dayOfWeek } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (classId) { params.push(classId); where += ` AND te.class_id = $${params.length}`; }
      if (batchId) { params.push(batchId); where += ` AND te.batch_id = $${params.length}`; }
      if (teacherId) { params.push(teacherId); where += ` AND te.teacher_id = $${params.length}`; }
      if (dayOfWeek !== undefined) { params.push(dayOfWeek); where += ` AND te.day_of_week = $${params.length}`; }
      const res = await pool.query(
        `SELECT te.*, c.name as class_name, b.name as batch_name, s.name as subject_name, u.full_name as teacher_name
         FROM timetable_entries te
         JOIN classes c ON te.class_id = c.id
         LEFT JOIN batches b ON te.batch_id = b.id
         JOIN subjects s ON te.subject_id = s.id
         JOIN users u ON te.teacher_id = u.id
         ${where} ORDER BY te.day_of_week, te.start_time`,
        params
      );
      return res.rows;
    }
    let entries = [...memoryStore.timetable_entries];
    if (classId) entries = entries.filter(e => e.class_id === classId);
    if (batchId) entries = entries.filter(e => e.batch_id === batchId);
    if (teacherId) entries = entries.filter(e => e.teacher_id === teacherId);
    if (dayOfWeek !== undefined) entries = entries.filter(e => e.day_of_week === dayOfWeek);
    return entries.map(te => {
      const cls = memoryStore.classes.find(c => c.id === te.class_id);
      const batch = memoryStore.batches.find(b => b.id === te.batch_id);
      const subject = memoryStore.subjects.find(s => s.id === te.subject_id);
      const teacher = memoryStore.users.find(u => u.id === te.teacher_id);
      return { ...te, class_name: cls?.name, batch_name: batch?.name, subject_name: subject?.name, teacher_name: teacher?.full_name };
    }).sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
  },

  async createTimetableEntry({ classId, batchId, subjectId, teacherId, dayOfWeek, startTime, endTime, room, academicSessionId }) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    const normalizedBatchId = sanitizeOptionalString(batchId);
    const normalizedAcademicSessionId = sanitizeOptionalString(academicSessionId);
    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE timetable_entries IN SHARE ROW EXCLUSIVE MODE');
        const collisionRes = await client.query(
          `SELECT id, teacher_id, room, day_of_week, start_time, end_time
           FROM timetable_entries
           WHERE day_of_week = $1
             AND start_time < $2
             AND end_time > $3
             AND (
               teacher_id = $4
               OR ($5::text IS NOT NULL AND room IS NOT NULL AND lower(btrim(room)) = lower(btrim($5)))
             )`,
          [dayOfWeek, endTime, startTime, teacherId, room || null]
        );
        const conflicts = collisionRes.rows
          .map(entry => timetableConflictsWith(entry, { teacherId, room }))
          .filter(Boolean);
        if (conflicts.length > 0) throw createTimetableCollisionError(conflicts);

        const res = await client.query(
          `INSERT INTO timetable_entries (id, class_id, batch_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, academic_session_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [id, classId, normalizedBatchId, subjectId, teacherId, dayOfWeek, startTime, endTime, room || null, normalizedAcademicSessionId, created_at]
        );
        await client.query('COMMIT');
        return res.rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    const conflicts = memoryStore.timetable_entries
      .filter(entry =>
        entry.day_of_week === dayOfWeek &&
        entry.start_time < endTime &&
        entry.end_time > startTime
      )
      .map(entry => timetableConflictsWith(entry, { teacherId, room }))
      .filter(Boolean);
    if (conflicts.length > 0) throw createTimetableCollisionError(conflicts);

    const entry = { id, class_id: classId, batch_id: normalizedBatchId, subject_id: subjectId, teacher_id: teacherId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime, room: room || null, academic_session_id: normalizedAcademicSessionId, created_at };
    memoryStore.timetable_entries.push(entry);
    return entry;
  },

  async deleteTimetableEntry(id) {
    if (isPostgresConnected && pool) {
      await pool.query('DELETE FROM timetable_entries WHERE id = $1', [id]);
      return true;
    }
    const idx = memoryStore.timetable_entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    memoryStore.timetable_entries.splice(idx, 1);
    return true;
  },

  // ============================================================
  // ATTENDANCE
  // ============================================================
  async getAttendanceBatch(batchId, teacherId, subjectId = null) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT b.id, b.class_id,
                (
                  EXISTS (
                    SELECT 1 FROM teacher_assignments ta
                    WHERE ta.teacher_id = $2
                      AND ta.class_id = b.class_id
                      AND (ta.batch_id = b.id OR ta.batch_id IS NULL)
                      AND (ta.subject_id = $3 OR $3 IS NULL)
                  )
                  OR (
                    $3 IS NULL AND EXISTS (
                      SELECT 1 FROM batch_teachers bt
                      WHERE bt.teacher_id = $2
                        AND bt.batch_id = b.id
                    )
                  )
                ) as is_assigned
         FROM batches b
         WHERE b.id = $1`,
        [batchId, teacherId, subjectId || null]
      );
      return res.rows[0] || null;
    }

    const batch = memoryStore.batches.find(item => item.id === batchId);
    if (!batch) return null;
    const isAssigned =
      memoryStore.teacher_assignments.some(assignment =>
        assignment.teacher_id === teacherId &&
        assignment.class_id === batch.class_id &&
        (assignment.batch_id === batch.id || !assignment.batch_id) &&
        (assignment.subject_id === subjectId || !subjectId)
      ) ||
      (!subjectId && (memoryStore.batch_teachers || []).some(bt =>
        bt.teacher_id === teacherId && bt.batch_id === batch.id
      ));
    return { id: batch.id, class_id: batch.class_id, is_assigned: isAssigned };
  },

  async markAttendance(records) {
    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const record of records) {
          const id = crypto.randomUUID();
          const createdAt = new Date().toISOString();
          const batchId = sanitizeOptionalString(record.batchId);
          const subjectId = sanitizeOptionalString(record.subjectId);
          const res = await client.query(
            `INSERT INTO attendance_records (id, student_id, class_id, batch_id, subject_id, date, status, remarks, marked_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (student_id, class_id, subject_id, date)
             DO UPDATE SET status = EXCLUDED.status, batch_id = EXCLUDED.batch_id, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by
             RETURNING *`,
            [id, record.studentId, record.classId, batchId, subjectId, record.date, record.status, record.remarks ?? null, record.markedBy, createdAt]
          );
          results.push(res.rows[0]);
        }
        await client.query('COMMIT');
        return results;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const updates = records.map(record => {
      const batchId = sanitizeOptionalString(record.batchId);
      const subjectId = sanitizeOptionalString(record.subjectId);
      const existing = memoryStore.attendance_records.find(
        attendance => attendance.student_id === record.studentId &&
          (attendance.batch_id === batchId || (!attendance.batch_id && !batchId)) &&
          attendance.class_id === record.classId &&
          attendance.date === record.date &&
          (attendance.subject_id === subjectId || (!attendance.subject_id && !subjectId))
      );
      const createdAt = new Date().toISOString();
      return existing
        ? { existing, values: { status: record.status, batch_id: batchId, subject_id: subjectId, remarks: record.remarks ?? null, marked_by: record.markedBy } }
        : {
            record: {
              id: crypto.randomUUID(),
              student_id: record.studentId,
              class_id: record.classId,
              batch_id: batchId,
              subject_id: subjectId,
              date: record.date,
              status: record.status,
              remarks: record.remarks ?? null,
              marked_by: record.markedBy,
              correction_reason: null,
              corrected_at: null,
              corrected_by: null,
              created_at: createdAt
            }
          };
    });
    return updates.map(update => {
      if (update.existing) {
        Object.assign(update.existing, update.values);
        return update.existing;
      }
      memoryStore.attendance_records.push(update.record);
      return update.record;
    });
  },

  async getAttendance({ studentId, classId, batchId, subjectId, date, fromDate, toDate } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (studentId) { params.push(studentId); where += ` AND ar.student_id = $${params.length}`; }
      if (classId) { params.push(classId); where += ` AND ar.class_id = $${params.length}`; }
      if (batchId) { params.push(batchId); where += ` AND ar.batch_id = $${params.length}`; }
      if (subjectId) { params.push(subjectId); where += ` AND ar.subject_id = $${params.length}`; }
      if (date) { params.push(date); where += ` AND ar.date = $${params.length}`; }
      if (fromDate) { params.push(fromDate); where += ` AND ar.date >= $${params.length}`; }
      if (toDate) { params.push(toDate); where += ` AND ar.date <= $${params.length}`; }
      const res = await pool.query(
        `SELECT ar.*, u.full_name as student_name, s.name as subject_name
         FROM attendance_records ar
         JOIN users u ON ar.student_id = u.id
         LEFT JOIN subjects s ON ar.subject_id = s.id
         ${where} ORDER BY ar.date DESC, u.full_name`,
        params
      );
      return res.rows;
    }
    let records = [...memoryStore.attendance_records];
    if (studentId) records = records.filter(r => r.student_id === studentId);
    if (classId) records = records.filter(r => r.class_id === classId);
    if (batchId) records = records.filter(r => r.batch_id === batchId);
    if (subjectId) records = records.filter(r => r.subject_id === subjectId);
    if (date) records = records.filter(r => r.date === date);
    if (fromDate) records = records.filter(r => r.date >= fromDate);
    if (toDate) records = records.filter(r => r.date <= toDate);
    return records.map(r => {
      const user = memoryStore.users.find(u => u.id === r.student_id);
      const subject = memoryStore.subjects.find(s => s.id === r.subject_id);
      return { ...r, student_name: user?.full_name, subject_name: subject?.name };
    }).sort((a, b) => b.date.localeCompare(a.date));
  },

  // ============================================================
  // ASSIGNMENTS
  // ============================================================
  async getAssignments({ classId, batchId, teacherId, status, studentId } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (classId) { params.push(classId); where += ` AND a.class_id = $${params.length}`; }
      if (batchId) { params.push(batchId); where += ` AND (a.batch_id = $${params.length} OR a.batch_id IS NULL)`; }
      if (teacherId) { params.push(teacherId); where += ` AND a.teacher_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND a.status = $${params.length}`; }

      let selectClause = `SELECT a.*, s.name as subject_name, c.name as class_name, u.full_name as teacher_name`;
      let joinClause = `LEFT JOIN subjects s ON a.subject_id = s.id
                        JOIN classes c ON a.class_id = c.id
                        JOIN users u ON a.teacher_id = u.id`;

      if (studentId) {
        params.push(studentId);
        const sParam = params.length;
        selectClause += `, sub.id as submission_id, sub.status as submission_status, sub.content as submission_content,
                           sub.file_path, sub.file_name, sub.submitted_at, sub.marks_obtained,
                           sub.marks_obtained as grade, sub.marks_obtained as score, sub.feedback, sub.graded_at`;
        joinClause += ` LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = $${sParam}`;
      }

      const res = await pool.query(
        `${selectClause} FROM assignments a ${joinClause} ${where} ORDER BY a.due_date ASC`,
        params
      );
      return res.rows;
    }
    let assignments = [...memoryStore.assignments];
    if (classId) assignments = assignments.filter(a => a.class_id === classId);
    if (batchId) assignments = assignments.filter(a => !a.batch_id || a.batch_id === batchId);
    if (teacherId) assignments = assignments.filter(a => a.teacher_id === teacherId);
    if (status) assignments = assignments.filter(a => a.status === status);

    // For students: only show published assignments in their enrolled classes or batches
    if (studentId) {
      const classEnrollments = (memoryStore.student_class_enrollments || []).filter(e => e.student_id === studentId);
      const batchEnrollments = (memoryStore.batch_enrollments || []).filter(e => e.student_id === studentId && (e.status === 'active' || !e.status));
      const batchClassIds = batchEnrollments.map(be => (memoryStore.batches || []).find(b => b.id === be.batch_id)?.class_id).filter(Boolean);
      const enrolledClassIds = new Set([...classEnrollments.map(e => e.class_id), ...batchClassIds]);
      const enrolledBatchIds = new Set(batchEnrollments.map(be => be.batch_id));

      assignments = assignments.filter(a => {
        if (a.status !== 'published') return false;
        if (enrolledClassIds.size > 0 && !enrolledClassIds.has(a.class_id)) return false;
        if (a.batch_id && enrolledBatchIds.size > 0 && !enrolledBatchIds.has(a.batch_id)) return false;
        return true;
      });
    }

    return assignments.map(a => {
      const subject = memoryStore.subjects.find(s => s.id === a.subject_id);
      const cls = memoryStore.classes.find(c => c.id === a.class_id);
      const teacher = memoryStore.users.find(u => u.id === a.teacher_id);
      const sub = studentId ? (memoryStore.assignment_submissions || []).find(s => s.assignment_id === a.id && s.student_id === studentId) : null;
      return {
        ...a,
        subject_name: subject?.name,
        class_name: cls?.name,
        teacher_name: teacher?.full_name,
        submission_id: sub?.id,
        submission_status: sub ? sub.status : 'pending',
        submission_content: sub?.content,
        file_path: sub?.file_path,
        file_name: sub?.file_name,
        submitted_at: sub?.submitted_at,
        marks_obtained: sub?.marks_obtained,
        grade: sub?.marks_obtained,
        score: sub?.marks_obtained,
        feedback: sub?.feedback,
        graded_at: sub?.graded_at
      };
    }).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  },

  async createAssignment({ title, instructions, subjectId, classId, batchId, teacherId, issueDate, dueDate, maxMarks, status }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const normalizedSubjectId = sanitizeOptionalString(subjectId);
    const normalizedBatchId = sanitizeOptionalString(batchId);
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO assignments (id, title, instructions, subject_id, class_id, batch_id, teacher_id, issue_date, due_date, max_marks, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
        [id, title, instructions, normalizedSubjectId, classId, normalizedBatchId, teacherId, issueDate, dueDate, maxMarks || 100, status || 'draft', now]
      );
      return res.rows[0];
    }
    const assignment = { id, title, instructions, subject_id: normalizedSubjectId, class_id: classId, batch_id: normalizedBatchId, teacher_id: teacherId, issue_date: issueDate, due_date: dueDate, max_marks: maxMarks || 100, status: status || 'draft', created_at: now, updated_at: now };
    memoryStore.assignments.push(assignment);
    return assignment;
  },

  async updateAssignment(id, updates) {
    if (isPostgresConnected && pool) {
      const fields = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), id];
      const res = await pool.query(`UPDATE assignments SET ${fields}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
      return res.rows[0] || null;
    }
    const assignment = memoryStore.assignments.find(a => a.id === id);
    if (!assignment) return null;
    Object.assign(assignment, updates, { updated_at: new Date().toISOString() });
    return assignment;
  },

  // ============================================================
  // ASSIGNMENT SUBMISSIONS
  // ============================================================
  async submitAssignment({ assignmentId, studentId, content, filePath, fileName }) {
    const existing = await this.getSubmission(assignmentId, studentId);
    const id = existing?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO assignment_submissions (id, assignment_id, student_id, content, file_path, file_name, submitted_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted')
         ON CONFLICT (assignment_id, student_id) DO UPDATE
         SET content = EXCLUDED.content, file_path = EXCLUDED.file_path, file_name = EXCLUDED.file_name, submitted_at = EXCLUDED.submitted_at
         RETURNING *`,
        [id, assignmentId, studentId, content || null, filePath || null, fileName || null, now]
      );
      return res.rows[0];
    }
    if (existing) {
      existing.content = content || null;
      existing.file_path = filePath || null;
      existing.file_name = fileName || null;
      existing.submitted_at = now;
      return existing;
    }
    const submission = { id, assignment_id: assignmentId, student_id: studentId, content: content || null, file_path: filePath || null, file_name: fileName || null, submitted_at: now, marks_obtained: null, feedback: null, graded_by: null, graded_at: null, status: 'submitted' };
    memoryStore.assignment_submissions.push(submission);
    return submission;
  },

  async getSubmission(assignmentId, studentId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2', [assignmentId, studentId]);
      return res.rows[0] || null;
    }
    return memoryStore.assignment_submissions.find(s => s.assignment_id === assignmentId && s.student_id === studentId) || null;
  },

  async getSubmissionsForAssignment(assignmentId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT s.*, u.full_name as student_name, u.email as student_email, sp.enrollment_number
         FROM assignment_submissions s
         JOIN users u ON s.student_id = u.id
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE s.assignment_id = $1 ORDER BY s.submitted_at DESC`,
        [assignmentId]
      );
      return res.rows;
    }
    return memoryStore.assignment_submissions
      .filter(s => s.assignment_id === assignmentId)
      .map(s => {
        const user = memoryStore.users.find(u => u.id === s.student_id);
        const profile = memoryStore.student_profiles.find(p => p.user_id === s.student_id);
        return { ...s, student_name: user?.full_name, student_email: user?.email, enrollment_number: profile?.enrollment_number };
      });
  },

  async gradeSubmission(submissionId, { marksObtained, feedback, gradedBy }) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE assignment_submissions SET marks_obtained=$1, feedback=$2, graded_by=$3, graded_at=NOW(), status='graded' WHERE id=$4 RETURNING *`,
        [marksObtained, feedback, gradedBy, submissionId]
      );
      return res.rows[0] || null;
    }
    const sub = memoryStore.assignment_submissions.find(s => s.id === submissionId);
    if (!sub) return null;
    sub.marks_obtained = marksObtained;
    sub.feedback = feedback;
    sub.graded_by = gradedBy;
    sub.graded_at = new Date().toISOString();
    sub.status = 'graded';
    return sub;
  },

  // ============================================================
  // STUDY MATERIALS
  // ============================================================
  async getMaterials({ subjectId, classId, classIds, courseId, courseIds, uploadedBy, published, studentAccess } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (subjectId) { params.push(subjectId); where += ` AND sm.subject_id = $${params.length}`; }
      if (classId) { params.push(classId); where += ` AND sm.class_id = $${params.length}`; }
      if (courseId) { params.push(courseId); where += ` AND sm.course_id = $${params.length}`; }
      if (uploadedBy) { params.push(uploadedBy); where += ` AND sm.uploaded_by = $${params.length}`; }
      if (published !== undefined) { params.push(published); where += ` AND sm.published = $${params.length}`; }

      if (studentAccess) {
        const cIds = Array.isArray(studentAccess.classIds) ? studentAccess.classIds.filter(Boolean) : [];
        const crsIds = Array.isArray(studentAccess.courseIds) ? studentAccess.courseIds.filter(Boolean) : [];
        params.push(cIds);
        const pClass = params.length;
        params.push(crsIds);
        const pCourse = params.length;
        where += ` AND (
          (sm.class_id IS NULL AND sm.course_id IS NULL)
          OR (cardinality($${pClass}::varchar[]) > 0 AND sm.class_id = ANY($${pClass}::varchar[]))
          OR (cardinality($${pCourse}::varchar[]) > 0 AND sm.course_id = ANY($${pCourse}::varchar[]))
        )`;
      } else {
        if (Array.isArray(classIds) && classIds.length > 0) {
          params.push(classIds);
          where += ` AND (sm.class_id = ANY($${params.length}::varchar[]) OR sm.class_id IS NULL)`;
        }
        if (Array.isArray(courseIds) && courseIds.length > 0) {
          params.push(courseIds);
          where += ` AND (sm.course_id = ANY($${params.length}::varchar[]) OR sm.course_id IS NULL)`;
        }
      }

      const res = await pool.query(
        `SELECT sm.*, u.full_name as uploader_name, s.name as subject_name, c.name as class_name
         FROM study_materials sm
         JOIN users u ON sm.uploaded_by = u.id
         LEFT JOIN subjects s ON sm.subject_id = s.id
         LEFT JOIN classes c ON sm.class_id = c.id
         ${where} ORDER BY sm.created_at DESC`,
        params
      );
      return res.rows;
    }
    let mats = [...(memoryStore.study_materials || [])];
    if (subjectId) mats = mats.filter(m => m.subject_id === subjectId);
    if (classId) mats = mats.filter(m => m.class_id === classId);
    if (courseId) mats = mats.filter(m => m.course_id === courseId);
    if (uploadedBy) mats = mats.filter(m => m.uploaded_by === uploadedBy);
    if (published !== undefined) mats = mats.filter(m => m.published === published);

    if (studentAccess) {
      const cSet = new Set(Array.isArray(studentAccess.classIds) ? studentAccess.classIds.filter(Boolean) : []);
      const crsSet = new Set(Array.isArray(studentAccess.courseIds) ? studentAccess.courseIds.filter(Boolean) : []);
      const bSet = new Set(Array.isArray(studentAccess.batchIds) ? studentAccess.batchIds.filter(Boolean) : []);
      mats = mats.filter(m => {
        if (!m.class_id && !m.course_id && !m.batch_id) return true;
        if (m.batch_id && bSet.has(m.batch_id)) return true;
        if (m.class_id && cSet.has(m.class_id)) return true;
        if (m.course_id && crsSet.has(m.course_id)) return true;
        return false;
      });
    } else {
      if (Array.isArray(classIds) && classIds.length > 0) {
        const cSet = new Set(classIds);
        mats = mats.filter(m => !m.class_id || cSet.has(m.class_id));
      }
      if (Array.isArray(courseIds) && courseIds.length > 0) {
        const coSet = new Set(courseIds);
        mats = mats.filter(m => !m.course_id || coSet.has(m.course_id));
      }
    }
    return mats.map(m => {
      const user = (memoryStore.users || []).find(u => u.id === m.uploaded_by);
      const subject = (memoryStore.subjects || []).find(s => s.id === m.subject_id);
      const cls = (memoryStore.classes || []).find(c => c.id === m.class_id);
      return { ...m, uploader_name: user?.full_name, subject_name: subject?.name, class_name: cls?.name };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async createMaterial({ title, description, type, filePath, fileName, fileSize, externalUrl, subjectId, classId, batchId, courseId, lessonId, uploadedBy, published = true }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const normalizedSubjectId = sanitizeOptionalString(subjectId);
    let normalizedClassId = sanitizeOptionalString(classId);
    const normalizedBatchId = sanitizeOptionalString(batchId);
    let normalizedCourseId = sanitizeOptionalString(courseId);
    const normalizedLessonId = sanitizeOptionalString(lessonId);
    const isPublished = published !== false;

    if (normalizedBatchId) {
      const b = (memoryStore.batches || []).find(batch => batch.id === normalizedBatchId);
      if (b) {
        if (!normalizedClassId) normalizedClassId = b.class_id;
        if (!normalizedCourseId && b.course_id) normalizedCourseId = b.course_id;
      }
    }

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO study_materials (id, title, description, type, file_path, file_name, file_size, external_url, subject_id, class_id, course_id, lesson_id, uploaded_by, published, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
        [id, title, description || null, type || 'document', filePath || null, fileName || null, fileSize || null, externalUrl || null, normalizedSubjectId, normalizedClassId, normalizedCourseId, normalizedLessonId, uploadedBy, isPublished, now]
      );
      return res.rows[0];
    }
    const mat = { id, title, description: description || null, type: type || 'document', file_path: filePath || null, file_name: fileName || null, file_size: fileSize || null, external_url: externalUrl || null, subject_id: normalizedSubjectId, class_id: normalizedClassId, batch_id: normalizedBatchId, course_id: normalizedCourseId, lesson_id: normalizedLessonId, uploaded_by: uploadedBy, published: isPublished, created_at: now, updated_at: now };
    if (!memoryStore.study_materials) memoryStore.study_materials = [];
    memoryStore.study_materials.push(mat);
    return mat;
  },

  async updateMaterial(id, updates) {
    if (isPostgresConnected && pool) {
      const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), id];
      const res = await pool.query(`UPDATE study_materials SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
      return res.rows[0] || null;
    }
    const mat = memoryStore.study_materials.find(m => m.id === id);
    if (!mat) return null;
    Object.assign(mat, updates, { updated_at: new Date().toISOString() });
    return mat;
  },

  // ============================================================
  // ANNOUNCEMENTS
  // ============================================================
  async getAnnouncements({ targetType, targetId, status, authorId, limit = 50 } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (targetType) { params.push(targetType); where += ` AND a.target_type = $${params.length}`; }
      if (targetId) { params.push(targetId); where += ` AND a.target_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND a.status = $${params.length}`; }
      if (authorId) { params.push(authorId); where += ` AND a.author_id = $${params.length}`; }
      params.push(limit);
      const res = await pool.query(
        `SELECT a.*, u.full_name as author_name FROM announcements a
         JOIN users u ON a.author_id = u.id
         ${where} ORDER BY a.created_at DESC LIMIT $${params.length}`,
        params
      );
      return res.rows;
    }
    let anns = [...memoryStore.announcements];
    if (targetType) anns = anns.filter(a => a.target_type === targetType);
    if (targetId) anns = anns.filter(a => a.target_id === targetId);
    if (status) anns = anns.filter(a => a.status === status);
    if (authorId) anns = anns.filter(a => a.author_id === authorId);
    return anns.slice(0, limit).map(a => {
      const author = memoryStore.users.find(u => u.id === a.author_id);
      return { ...a, author_name: author?.full_name };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async createAnnouncement({ title, content, authorId, targetType, targetId, status, publishAt }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO announcements (id, title, content, author_id, target_type, target_id, status, publish_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [id, title, content, authorId, targetType || 'global', targetId || null, status || 'draft', publishAt || null, now]
      );
      return res.rows[0];
    }
    const ann = { id, title, content, author_id: authorId, target_type: targetType || 'global', target_id: targetId || null, status: status || 'draft', publish_at: publishAt || null, created_at: now, updated_at: now };
    memoryStore.announcements.push(ann);
    return ann;
  },

  async updateAnnouncement(id, updates) {
    if (isPostgresConnected && pool) {
      const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), id];
      const res = await pool.query(`UPDATE announcements SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
      return res.rows[0] || null;
    }
    const ann = memoryStore.announcements.find(a => a.id === id);
    if (!ann) return null;
    Object.assign(ann, updates, { updated_at: new Date().toISOString() });
    return ann;
  },

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  async createNotification({ userId, title, message, type, link }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO notifications (id, user_id, title, message, type, link, read, created_at) VALUES ($1,$2,$3,$4,$5,$6,false,$7) RETURNING *`,
        [id, userId, title, message, type || 'info', link || null, now]
      );
      return res.rows[0];
    }
    const notif = { id, user_id: userId, title, message, type: type || 'info', link: link || null, read: false, created_at: now };
    memoryStore.notifications.push(notif);
    return notif;
  },

  async getNotifications(userId, unreadOnly = false) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT * FROM notifications WHERE user_id = $1 ${unreadOnly ? 'AND read = false' : ''} ORDER BY created_at DESC LIMIT 50`,
        [userId]
      );
      return res.rows;
    }
    let notifs = memoryStore.notifications.filter(n => n.user_id === userId);
    if (unreadOnly) notifs = notifs.filter(n => !n.read);
    return notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
  },

  async markNotificationsRead(userId, notificationIds = null) {
    if (isPostgresConnected && pool) {
      if (notificationIds) {
        await pool.query('UPDATE notifications SET read = true WHERE user_id = $1 AND id = ANY($2)', [userId, notificationIds]);
      } else {
        await pool.query('UPDATE notifications SET read = true WHERE user_id = $1', [userId]);
      }
      return true;
    }
    memoryStore.notifications.forEach(n => {
      if (n.user_id === userId && (!notificationIds || notificationIds.includes(n.id))) {
        n.read = true;
      }
    });
    return true;
  },

  // ============================================================
  // LEAVE REQUESTS
  // ============================================================
  async getLeaveRequests({ teacherId, status } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (teacherId) { params.push(teacherId); where += ` AND lr.teacher_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND lr.status = $${params.length}`; }
      const res = await pool.query(
        `SELECT lr.*, u.full_name as teacher_name, u.email as teacher_email
         FROM leave_requests lr JOIN users u ON lr.teacher_id = u.id
         ${where} ORDER BY lr.created_at DESC`,
        params
      );
      return res.rows;
    }
    let reqs = [...memoryStore.leave_requests];
    if (teacherId) reqs = reqs.filter(r => r.teacher_id === teacherId);
    if (status) reqs = reqs.filter(r => r.status === status);
    return reqs.map(r => {
      const user = memoryStore.users.find(u => u.id === r.teacher_id);
      return { ...r, teacher_name: user?.full_name, teacher_email: user?.email };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async createLeaveRequest({ teacherId, fromDate, toDate, reason }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO leave_requests (id, teacher_id, from_date, to_date, reason, status, created_at) VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING *`,
        [id, teacherId, fromDate, toDate, reason, now]
      );
      return res.rows[0];
    }
    const req = { id, teacher_id: teacherId, from_date: fromDate, to_date: toDate, reason, status: 'pending', reviewed_by: null, reviewed_at: null, review_note: null, created_at: now };
    memoryStore.leave_requests.push(req);
    return req;
  },

  async reviewLeaveRequest(id, { status, reviewedBy, reviewNote }) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE leave_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW(), review_note=$3 WHERE id=$4 RETURNING *`,
        [status, reviewedBy, reviewNote || null, id]
      );
      return res.rows[0] || null;
    }
    const req = memoryStore.leave_requests.find(r => r.id === id);
    if (!req) return null;
    req.status = status;
    req.reviewed_by = reviewedBy;
    req.reviewed_at = new Date().toISOString();
    req.review_note = reviewNote || null;
    return req;
  },

  // ============================================================
  // FEEDBACK TICKETS
  // ============================================================
  async createTicket({ submitterId, category, subject, description }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO feedback_tickets (id, submitter_id, category, subject, description, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'open',$6,$6) RETURNING *`,
        [id, submitterId, category || 'general', subject, description, now]
      );
      return res.rows[0];
    }
    const ticket = { id, submitter_id: submitterId, category: category || 'general', subject, description, status: 'open', assigned_to: null, admin_response: null, resolved_at: null, created_at: now, updated_at: now };
    memoryStore.feedback_tickets.push(ticket);
    return ticket;
  },

  async getTickets({ submitterId, status, assignedTo } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (submitterId) { params.push(submitterId); where += ` AND ft.submitter_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND ft.status = $${params.length}`; }
      const res = await pool.query(
        `SELECT ft.*, u.full_name as submitter_name FROM feedback_tickets ft JOIN users u ON ft.submitter_id = u.id ${where} ORDER BY ft.created_at DESC`,
        params
      );
      return res.rows;
    }
    let tickets = [...memoryStore.feedback_tickets];
    if (submitterId) tickets = tickets.filter(t => t.submitter_id === submitterId);
    if (status) tickets = tickets.filter(t => t.status === status);
    return tickets.map(t => {
      const user = memoryStore.users.find(u => u.id === t.submitter_id);
      return { ...t, submitter_name: user?.full_name };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async updateTicket(id, updates) {
    if (isPostgresConnected && pool) {
      const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), id];
      const res = await pool.query(`UPDATE feedback_tickets SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
      return res.rows[0] || null;
    }
    const ticket = memoryStore.feedback_tickets.find(t => t.id === id);
    if (!ticket) return null;
    Object.assign(ticket, updates, { updated_at: new Date().toISOString() });
    return ticket;
  },

  // ============================================================
  // LIVE CLASSES
  // ============================================================
  async getLiveClasses({ teacherId, classId, batchId, studentId, status } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (teacherId) {
        params.push(teacherId);
        where += ` AND (
          lc.teacher_id = $${params.length}
          OR lc.batch_id IN (SELECT batch_id FROM batch_teachers WHERE teacher_id = $${params.length})
          OR lc.batch_id IN (SELECT id FROM batches WHERE class_teacher_id = $${params.length})
          OR lc.class_id IN (SELECT class_id FROM teacher_assignments WHERE teacher_id = $${params.length})
          OR lc.batch_id IN (SELECT batch_id FROM teacher_assignments WHERE teacher_id = $${params.length})
          OR lc.class_id IN (SELECT b.class_id FROM batch_teachers bt JOIN batches b ON b.id = bt.batch_id WHERE bt.teacher_id = $${params.length})
        )`;
      }
      if (classId) { params.push(classId); where += ` AND lc.class_id = $${params.length}`; }
      if (batchId) { params.push(batchId); where += ` AND lc.batch_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND lc.status = $${params.length}`; }
      if (studentId) {
        params.push(studentId);
        where += ` AND (
          lc.class_id IN (SELECT class_id FROM student_class_enrollments WHERE student_id = $${params.length})
          OR lc.batch_id IN (SELECT batch_id FROM batch_enrollments WHERE student_id = $${params.length} AND status = 'active')
          OR (lc.class_id IS NULL AND lc.batch_id IS NULL)
          OR NOT EXISTS (SELECT 1 FROM student_class_enrollments WHERE student_id = $${params.length})
        )`;
      }
      const res = await pool.query(
        `SELECT lc.*, u.full_name as teacher_name, c.name as class_name, s.name as subject_name, b.name as batch_name
         FROM live_class_sessions lc
         LEFT JOIN users u ON lc.teacher_id = u.id
         LEFT JOIN classes c ON lc.class_id = c.id
         LEFT JOIN subjects s ON lc.subject_id = s.id
         LEFT JOIN batches b ON lc.batch_id = b.id
         ${where} ORDER BY COALESCE(lc.started_at, lc.scheduled_at, lc.created_at) DESC, lc.created_at DESC`,
        params
      );
      return res.rows;
    }
    let sessions = [...(memoryStore.live_class_sessions || [])];
    if (teacherId) {
      const teacherBatchIds = new Set([
        ...(memoryStore.batch_teachers || []).filter(bt => bt.teacher_id === teacherId).map(bt => bt.batch_id),
        ...(memoryStore.batches || []).filter(b => b.class_teacher_id === teacherId).map(b => b.id),
        ...(memoryStore.teacher_assignments || []).filter(ta => ta.teacher_id === teacherId && ta.batch_id).map(ta => ta.batch_id)
      ]);
      const teacherClassIds = new Set([
        ...(memoryStore.teacher_assignments || []).filter(ta => ta.teacher_id === teacherId && ta.class_id).map(ta => ta.class_id),
        ...(memoryStore.batches || []).filter(b => teacherBatchIds.has(b.id)).map(b => b.class_id).filter(Boolean)
      ]);
      sessions = sessions.filter(s =>
        s.teacher_id === teacherId ||
        (s.batch_id && teacherBatchIds.has(s.batch_id)) ||
        (s.class_id && teacherClassIds.has(s.class_id))
      );
    }
    if (classId) sessions = sessions.filter(s => s.class_id === classId);
    if (batchId) sessions = sessions.filter(s => s.batch_id === batchId);
    if (status) sessions = sessions.filter(s => s.status === status);
    if (studentId) {
      const studentEnrollments = (memoryStore.student_class_enrollments || []).filter(e => e.student_id === studentId);
      const studentClassIds = new Set(studentEnrollments.map(e => e.class_id));
      const studentBatchIds = new Set(
        (memoryStore.batch_enrollments || [])
          .filter(be => be.student_id === studentId && (be.status === 'active' || !be.status))
          .map(be => be.batch_id)
      );
      const hasEnrollments = studentEnrollments.length > 0 || studentBatchIds.size > 0;
      sessions = sessions.filter(s =>
        !hasEnrollments ||
        (!s.class_id && !s.batch_id) ||
        (s.class_id && studentClassIds.has(s.class_id)) ||
        (s.batch_id && studentBatchIds.has(s.batch_id))
      );
    }
    return sessions.map(lc => {
      const teacher = (memoryStore.users || []).find(u => u.id === lc.teacher_id);
      const cls = (memoryStore.classes || []).find(c => c.id === lc.class_id);
      const batch = (memoryStore.batches || []).find(b => b.id === lc.batch_id);
      const subject = (memoryStore.subjects || []).find(s => s.id === lc.subject_id);
      return {
        ...lc,
        teacher_name: teacher?.full_name,
        class_name: cls?.name,
        batch_name: batch?.name,
        subject_name: subject?.name
      };
    }).sort((a, b) => new Date(b.started_at || b.scheduled_at || b.created_at || 0) - new Date(a.started_at || a.scheduled_at || a.created_at || 0));
  },

  async getLiveClassById(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT lc.*, u.full_name as teacher_name, c.name as class_name, s.name as subject_name, b.name as batch_name
         FROM live_class_sessions lc
         LEFT JOIN users u ON lc.teacher_id = u.id
         LEFT JOIN classes c ON lc.class_id = c.id
         LEFT JOIN subjects s ON lc.subject_id = s.id
         LEFT JOIN batches b ON lc.batch_id = b.id
         WHERE lc.id = $1`,
        [id]
      );
      return res.rows[0] || null;
    }
    const lc = (memoryStore.live_class_sessions || []).find(s => s.id === id);
    if (!lc) return null;
    const teacher = (memoryStore.users || []).find(u => u.id === lc.teacher_id);
    const cls = (memoryStore.classes || []).find(c => c.id === lc.class_id);
    const batch = (memoryStore.batches || []).find(b => b.id === lc.batch_id);
    const subject = (memoryStore.subjects || []).find(s => s.id === lc.subject_id);
    return {
      ...lc,
      teacher_name: teacher?.full_name,
      class_name: cls?.name,
      batch_name: batch?.name,
      subject_name: subject?.name
    };
  },

  async createLiveClass({ title, description, teacherId, classId, batchId, subjectId, courseId, scheduledAt, meetingUrl, meetingProvider = 'livekit' }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const normalizedClassId = sanitizeOptionalString(classId);
    const normalizedBatchId = sanitizeOptionalString(batchId);
    const normalizedSubjectId = sanitizeOptionalString(subjectId);
    const normalizedCourseId = sanitizeOptionalString(courseId);
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO live_class_sessions (id, title, description, teacher_id, class_id, batch_id, subject_id, course_id, scheduled_at, meeting_url, meeting_provider, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scheduled',$12) RETURNING *`,
        [id, title, description || null, teacherId, normalizedClassId, normalizedBatchId, normalizedSubjectId, normalizedCourseId, scheduledAt, meetingUrl || null, meetingProvider || 'livekit', now]
      );
      const enriched = await this.getLiveClassById(id);
      return enriched || res.rows[0];
    }
    const session = { id, title, description: description || null, teacher_id: teacherId, class_id: normalizedClassId, batch_id: normalizedBatchId, subject_id: normalizedSubjectId, course_id: normalizedCourseId, scheduled_at: scheduledAt, started_at: null, ended_at: null, meeting_url: meetingUrl || null, meeting_provider: meetingProvider || 'livekit', status: 'scheduled', created_at: now };
    if (!memoryStore.live_class_sessions) memoryStore.live_class_sessions = [];
    memoryStore.live_class_sessions.push(session);
    const enriched = await this.getLiveClassById(id);
    return enriched || session;
  },

  async updateLiveClass(id, updates) {
    if (isPostgresConnected && pool) {
      const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), id];
      const res = await pool.query(`UPDATE live_class_sessions SET ${setClause} WHERE id = $${values.length} RETURNING *`, values);
      const enriched = await this.getLiveClassById(id);
      return enriched || res.rows[0] || null;
    }
    const session = (memoryStore.live_class_sessions || []).find(s => s.id === id);
    if (!session) return null;
    Object.assign(session, updates);
    const enriched = await this.getLiveClassById(id);
    return enriched || session;
  },

  // ============================================================
  // SYLLABUS
  // ============================================================
  async getSyllabus({ subjectId, classId, teacherId } = {}) {
    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (subjectId) { params.push(subjectId); where += ` AND st.subject_id = $${params.length}`; }
      if (classId) { params.push(classId); where += ` AND st.class_id = $${params.length}`; }
      if (teacherId) { params.push(teacherId); where += ` AND st.teacher_id = $${params.length}`; }
      const res = await pool.query(
        `SELECT st.*, s.name as subject_name FROM syllabus_topics st JOIN subjects s ON st.subject_id = s.id ${where} ORDER BY st.position`,
        params
      );
      return res.rows;
    }
    let topics = [...memoryStore.syllabus_topics];
    if (subjectId) topics = topics.filter(t => t.subject_id === subjectId);
    if (classId) topics = topics.filter(t => t.class_id === classId);
    if (teacherId) topics = topics.filter(t => t.teacher_id === teacherId);
    return topics.map(t => {
      const subject = memoryStore.subjects.find(s => s.id === t.subject_id);
      return { ...t, subject_name: subject?.name };
    }).sort((a, b) => a.position - b.position);
  },

  async updateSyllabusTopic(id, updates) {
    if (isPostgresConnected && pool) {
      const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = [...Object.values(updates), id];
      const res = await pool.query(`UPDATE syllabus_topics SET ${setClause} WHERE id = $${values.length} RETURNING *`, values);
      return res.rows[0] || null;
    }
    const topic = memoryStore.syllabus_topics.find(t => t.id === id);
    if (!topic) return null;
    Object.assign(topic, updates);
    return topic;
  },

  async createSyllabusTopic({ subjectId, classId, teacherId, chapter, topic, plannedDate, position }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO syllabus_topics (id, subject_id, class_id, teacher_id, chapter, topic, planned_date, completed, position, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9) RETURNING *`,
        [id, subjectId, classId, teacherId || null, chapter, topic, plannedDate || null, position || 1, now]
      );
      return res.rows[0];
    }
    const st = { id, subject_id: subjectId, class_id: classId, teacher_id: teacherId || null, chapter, topic, planned_date: plannedDate || null, completed: false, completed_date: null, notes: null, position: position || 1, created_at: now };
    memoryStore.syllabus_topics.push(st);
    return st;
  },

  // ============================================================
  // TEACHER PROFILES
  // ============================================================
  async getTeacherProfile(userId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM teacher_profiles WHERE user_id = $1', [userId]);
      return res.rows[0] || null;
    }
    return memoryStore.teacher_profiles.find(p => p.user_id === userId) || null;
  },

  async upsertTeacherProfile(userId, { employeeId, department, qualification, specialization, joiningDate }, client = null) {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const id = crypto.randomUUID();
      const db = client || pool;
      const res = await db.query(
        `INSERT INTO teacher_profiles (id, user_id, employee_id, department, qualification, specialization, joining_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
         ON CONFLICT (user_id) DO UPDATE SET employee_id=EXCLUDED.employee_id, department=EXCLUDED.department, qualification=EXCLUDED.qualification, specialization=EXCLUDED.specialization, joining_date=EXCLUDED.joining_date, updated_at=$8
         RETURNING *`,
        [id, userId, employeeId || null, department || null, qualification || null, specialization || null, joiningDate || null, now]
      );
      return res.rows[0];
    }
    const existing = memoryStore.teacher_profiles.find(p => p.user_id === userId);
    if (existing) {
      if (employeeId !== undefined) existing.employee_id = employeeId;
      if (department !== undefined) existing.department = department;
      if (qualification !== undefined) existing.qualification = qualification;
      if (specialization !== undefined) existing.specialization = specialization;
      if (joiningDate !== undefined) existing.joining_date = joiningDate;
      existing.updated_at = now;
      return existing;
    }
    const profile = { id: crypto.randomUUID(), user_id: userId, employee_id: employeeId || null, department: department || null, qualification: qualification || null, specialization: specialization || null, joining_date: joiningDate || null, created_at: now, updated_at: now };
    memoryStore.teacher_profiles.push(profile);
    return profile;
  },

  // ============================================================
  // STUDENT PROFILES
  // ============================================================
  async getStudentProfile(userId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM student_profiles WHERE user_id = $1', [userId]);
      return res.rows[0] || null;
    }
    return memoryStore.student_profiles.find(p => p.user_id === userId) || null;
  },

  async getStudentProfileByEnrollmentNumber(enrollmentNumber) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM student_profiles WHERE enrollment_number = $1', [enrollmentNumber]);
      return res.rows[0] || null;
    }
    return memoryStore.student_profiles.find(profile => profile.enrollment_number === enrollmentNumber) || null;
  },

  async upsertStudentProfile(userId, { enrollmentNumber, dateOfBirth, guardianName, guardianContact, address }) {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO student_profiles (id, user_id, enrollment_number, date_of_birth, guardian_name, guardian_contact, address, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
         ON CONFLICT (user_id) DO UPDATE SET enrollment_number=EXCLUDED.enrollment_number, date_of_birth=EXCLUDED.date_of_birth, guardian_name=EXCLUDED.guardian_name, guardian_contact=EXCLUDED.guardian_contact, address=EXCLUDED.address, updated_at=$8
         RETURNING *`,
        [id, userId, enrollmentNumber || null, dateOfBirth || null, guardianName || null, guardianContact || null, address || null, now]
      );
      return res.rows[0];
    }
    const duplicate = memoryStore.student_profiles.find(
      profile => profile.enrollment_number === enrollmentNumber && profile.user_id !== userId
    );
    if (duplicate) {
      const err = new Error('A student with this enrollment ID already exists.');
      err.code = '23505';
      throw err;
    }
    const existing = memoryStore.student_profiles.find(p => p.user_id === userId);
    if (existing) {
      Object.assign(existing, { enrollment_number: enrollmentNumber, date_of_birth: dateOfBirth, guardian_name: guardianName, guardian_contact: guardianContact, address, updated_at: now });
      return existing;
    }
    const profile = { id: crypto.randomUUID(), user_id: userId, enrollment_number: enrollmentNumber || null, date_of_birth: dateOfBirth || null, guardian_name: guardianName || null, guardian_contact: guardianContact || null, address: address || null, created_at: now, updated_at: now };
    memoryStore.student_profiles.push(profile);
    return profile;
  }
};
