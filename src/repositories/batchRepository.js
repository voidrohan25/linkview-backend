import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';
import { sanitizeOptionalString } from '../utils/sanitize.js';

export const batchRepository = {
  async getAllBatches(filters = {}) {
    const {
      search,
      status,
      courseId,
      classId,
      limit = 100,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = filters;

    if (isPostgresConnected && pool) {
      let query = `
        SELECT
          b.*,
          c.title as course_title,
          cls.name as class_name,
          COALESCE(be.student_count, 0)::int as enrolled_count,
          COALESCE(be.student_count, 0)::int as students_count,
          COALESCE(bt.teacher_count, 0)::int as teacher_count,
          COALESCE(bt.teacher_count, 0)::int as teachers_count,
          bt.teacher_names,
          GREATEST(0, (b.capacity - COALESCE(be.student_count, 0)))::int as available_capacity
        FROM batches b
        LEFT JOIN courses c ON b.course_id = c.id
        LEFT JOIN classes cls ON b.class_id = cls.id
        LEFT JOIN (
          SELECT batch_id, COUNT(DISTINCT student_id)::int as student_count
          FROM (
            SELECT batch_id, student_id FROM batch_enrollments WHERE status = 'active' OR status IS NULL
            UNION
            SELECT batch_id, student_id FROM student_class_enrollments WHERE batch_id IS NOT NULL
          ) all_s
          GROUP BY batch_id
        ) be ON b.id = be.batch_id
        LEFT JOIN (
          SELECT batch_id,
                 COUNT(DISTINCT teacher_id)::int as teacher_count,
                 STRING_AGG(DISTINCT u.full_name, ', ') as teacher_names
          FROM (
            SELECT batch_id, teacher_id FROM batch_teachers
            UNION
            SELECT batch_id, teacher_id FROM teacher_assignments WHERE batch_id IS NOT NULL
          ) all_t
          JOIN users u ON all_t.teacher_id = u.id
          GROUP BY batch_id
        ) bt ON b.id = bt.batch_id
        WHERE 1=1
      `;
      const params = [];

      if (status && status !== 'ALL') {
        params.push(status);
        query += ` AND b.status = $${params.length}`;
      }

      if (courseId && courseId !== 'ALL') {
        params.push(courseId);
        query += ` AND b.course_id = $${params.length}`;
      }

      if (classId && classId !== 'ALL') {
        params.push(classId);
        query += ` AND b.class_id = $${params.length}`;
      }

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        query += ` AND (LOWER(b.name) LIKE $${params.length} OR LOWER(COALESCE(b.code, '')) LIKE $${params.length} OR LOWER(COALESCE(b.description, '')) LIKE $${params.length})`;
      }

      const validSorts = ['name', 'code', 'created_at', 'start_date', 'capacity', 'status'];
      const actualSort = validSorts.includes(sortBy) ? `b.${sortBy}` : 'b.created_at';
      const actualOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      query += ` ORDER BY ${actualSort} ${actualOrder}`;

      params.push(limit);
      query += ` LIMIT $${params.length}`;
      params.push(offset);
      query += ` OFFSET $${params.length}`;

      const res = await pool.query(query, params);
      return res.rows;
    }

    // Memory Store fallback
    let list = [...(memoryStore.batches || [])];

    if (status && status !== 'ALL') {
      list = list.filter(b => b.status === status);
    }
    if (courseId && courseId !== 'ALL') {
      list = list.filter(b => b.course_id === courseId);
    }
    if (classId && classId !== 'ALL') {
      list = list.filter(b => b.class_id === classId);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(b =>
        b.name?.toLowerCase().includes(q) ||
        b.code?.toLowerCase().includes(q) ||
        b.description?.toLowerCase().includes(q)
      );
    }

    return list.slice(offset, offset + limit).map(b => {
      const course = (memoryStore.courses || []).find(c => c.id === b.course_id);
      const cls = (memoryStore.classes || []).find(c => c.id === b.class_id);
      const enrolled = new Set([
        ...(memoryStore.batch_enrollments || []).filter(e => e.batch_id === b.id && (e.status === 'active' || !e.status)).map(e => e.student_id),
        ...(memoryStore.student_class_enrollments || []).filter(e => e.batch_id === b.id).map(e => e.student_id)
      ]).size;

      const teacherIds = new Set([
        ...(memoryStore.batch_teachers || []).filter(t => t.batch_id === b.id).map(t => t.teacher_id),
        ...(memoryStore.teacher_assignments || []).filter(t => t.batch_id === b.id).map(t => t.teacher_id)
      ]);
      const teachers = teacherIds.size;
      const teacherNames = Array.from(teacherIds)
        .map(tId => (memoryStore.users || []).find(u => u.id === tId)?.full_name)
        .filter(Boolean)
        .join(', ');

      return {
        ...b,
        course_title: course?.title || null,
        class_name: cls?.name || null,
        enrolled_count: enrolled,
        students_count: enrolled,
        teacher_count: teachers,
        teachers_count: teachers,
        teacher_names: teacherNames || null,
        available_capacity: Math.max(0, (b.capacity || 50) - enrolled)
      };
    });
  },

  async getBatchesForTeacher(teacherId) {
    if (isPostgresConnected && pool) {
      const query = `
        SELECT DISTINCT
          b.*,
          c.title as course_title,
          cls.name as class_name,
          COALESCE(be.student_count, 0)::int as enrolled_count,
          COALESCE(bt_all.teacher_count, 0)::int as teachers_count,
          (b.capacity - COALESCE(be.student_count, 0))::int as available_capacity
        FROM batches b
        LEFT JOIN courses c ON b.course_id = c.id
        LEFT JOIN classes cls ON b.class_id = cls.id
        LEFT JOIN (
          SELECT batch_id, COUNT(*)::int as student_count
          FROM batch_enrollments
          WHERE status = 'active'
          GROUP BY batch_id
        ) be ON b.id = be.batch_id
        LEFT JOIN (
          SELECT batch_id, COUNT(*)::int as teacher_count
          FROM batch_teachers
          GROUP BY batch_id
        ) bt_all ON b.id = bt_all.batch_id
        WHERE b.id IN (
          SELECT batch_id FROM batch_teachers WHERE teacher_id = $1
          UNION
          SELECT batch_id FROM teacher_assignments WHERE teacher_id = $1 AND batch_id IS NOT NULL
          UNION
          SELECT id FROM batches WHERE class_teacher_id = $1
        )
        ORDER BY b.created_at DESC
      `;
      const res = await pool.query(query, [teacherId]);
      return res.rows;
    }

    const assignedBatchIds = new Set([
      ...(memoryStore.batch_teachers || []).filter(bt => bt.teacher_id === teacherId).map(bt => bt.batch_id),
      ...(memoryStore.teacher_assignments || []).filter(ta => ta.teacher_id === teacherId && ta.batch_id).map(ta => ta.batch_id),
      ...(memoryStore.batches || []).filter(b => b.class_teacher_id === teacherId).map(b => b.id)
    ]);

    return (memoryStore.batches || [])
      .filter(b => assignedBatchIds.has(b.id))
      .map(b => {
        const course = (memoryStore.courses || []).find(c => c.id === b.course_id);
        const cls = (memoryStore.classes || []).find(c => c.id === b.class_id);
        const enrolled = (memoryStore.batch_enrollments || []).filter(e => e.batch_id === b.id && e.status === 'active').length;
        const teachers = (memoryStore.batch_teachers || []).filter(t => t.batch_id === b.id).length;
        return {
          ...b,
          course_title: course?.title || null,
          class_name: cls?.name || null,
          enrolled_count: enrolled,
          teachers_count: teachers,
          available_capacity: (b.capacity || 50) - enrolled
        };
      });
  },

  async getBatchById(id) {
    if (isPostgresConnected && pool) {
      const query = `
        SELECT
          b.*,
          c.title as course_title,
          cls.name as class_name,
          COALESCE(be.student_count, 0)::int as enrolled_count,
          COALESCE(bt.teacher_count, 0)::int as teachers_count,
          (b.capacity - COALESCE(be.student_count, 0))::int as available_capacity
        FROM batches b
        LEFT JOIN courses c ON b.course_id = c.id
        LEFT JOIN classes cls ON b.class_id = cls.id
        LEFT JOIN (
          SELECT batch_id, COUNT(*)::int as student_count
          FROM batch_enrollments
          WHERE status = 'active'
          GROUP BY batch_id
        ) be ON b.id = be.batch_id
        LEFT JOIN (
          SELECT batch_id, COUNT(*)::int as teacher_count
          FROM batch_teachers
          GROUP BY batch_id
        ) bt ON b.id = bt.batch_id
        WHERE b.id = $1
      `;
      const res = await pool.query(query, [id]);
      return res.rows[0] || null;
    }

    const b = (memoryStore.batches || []).find(batch => batch.id === id);
    if (!b) return null;
    const course = memoryStore.courses.find(c => c.id === b.course_id);
    const cls = memoryStore.classes.find(c => c.id === b.class_id);
    const enrolled = (memoryStore.batch_enrollments || []).filter(e => e.batch_id === b.id && e.status === 'active').length;
    const teachers = (memoryStore.batch_teachers || []).filter(t => t.batch_id === b.id).length;
    return {
      ...b,
      course_title: course?.title || null,
      class_name: cls?.name || null,
      enrolled_count: enrolled,
      teachers_count: teachers,
      available_capacity: (b.capacity || 50) - enrolled
    };
  },

  async findByCode(code) {
    if (!code) return null;
    const normalized = code.trim().toUpperCase();
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM batches WHERE UPPER(code) = $1', [normalized]);
      return res.rows[0] || null;
    }
    return (memoryStore.batches || []).find(b => b.code?.toUpperCase() === normalized) || null;
  },

  async createBatch(data) {
    const id = data.id || `batch-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const {
      name,
      code,
      course_id = null,
      class_id = null,
      description = '',
      start_date = null,
      end_date = null,
      capacity = 40,
      status = 'Active',
      class_teacher_id = null
    } = data;

    const normalizedCode = (code || `BATCH-${id.toUpperCase()}`).trim().toUpperCase();
    const normalizedCourseId = sanitizeOptionalString(course_id);
    const normalizedClassId = sanitizeOptionalString(class_id);
    const normalizedTeacherId = sanitizeOptionalString(class_teacher_id);
    const normalizedStartDate = sanitizeOptionalString(start_date);
    const normalizedEndDate = sanitizeOptionalString(end_date);

    if (isPostgresConnected && pool) {
      const query = `
        INSERT INTO batches (id, name, code, course_id, class_id, description, start_date, end_date, capacity, status, class_teacher_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
        RETURNING *
      `;
      const res = await pool.query(query, [
        id,
        name.trim(),
        normalizedCode,
        normalizedCourseId,
        normalizedClassId,
        description,
        normalizedStartDate,
        normalizedEndDate,
        capacity,
        status,
        normalizedTeacherId,
        now
      ]);
      return res.rows[0];
    }

    const newBatch = {
      id,
      name: name.trim(),
      code: normalizedCode,
      course_id: normalizedCourseId,
      class_id: normalizedClassId,
      description,
      start_date: normalizedStartDate,
      end_date: normalizedEndDate,
      capacity,
      status,
      class_teacher_id: normalizedTeacherId,
      created_at: now,
      updated_at: now
    };
    if (!memoryStore.batches) memoryStore.batches = [];
    memoryStore.batches.push(newBatch);
    return newBatch;
  },

  async updateBatch(id, updates) {
    const existing = await this.getBatchById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const normalizedUpdates = { ...updates };
    for (const key of ['course_id', 'class_id', 'class_teacher_id', 'start_date', 'end_date']) {
      if (normalizedUpdates[key] !== undefined) {
        normalizedUpdates[key] = sanitizeOptionalString(normalizedUpdates[key]);
      }
    }

    if (isPostgresConnected && pool) {
      const fields = [];
      const values = [];

      const allowed = ['name', 'code', 'course_id', 'class_id', 'description', 'start_date', 'end_date', 'capacity', 'status', 'class_teacher_id'];
      allowed.forEach(key => {
        if (normalizedUpdates[key] !== undefined) {
          let val = normalizedUpdates[key];
          if (key === 'code' && val) val = val.trim().toUpperCase();
          values.push(val);
          fields.push(`${key} = $${values.length}`);
        }
      });

      if (fields.length === 0) return existing;

      values.push(now);
      fields.push(`updated_at = $${values.length}`);

      values.push(id);
      const query = `UPDATE batches SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`;
      const res = await pool.query(query, values);
      return res.rows[0];
    }

    const b = (memoryStore.batches || []).find(batch => batch.id === id);
    if (!b) return null;
    Object.assign(b, normalizedUpdates, { updated_at: now });
    if (b.code) b.code = b.code.trim().toUpperCase();
    return b;
  },

  async archiveBatch(id) {
    return this.updateBatch(id, { status: 'Archived' });
  },

  async deleteBatch(id) {
    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const batch = await client.query('SELECT id FROM batches WHERE id = $1 FOR UPDATE', [id]);
        if (batch.rows.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, code: 'NOT_FOUND', message: 'Batch not found.' };
        }
        await client.query('DELETE FROM batch_enrollments WHERE batch_id = $1', [id]);
        await client.query('DELETE FROM batch_teachers WHERE batch_id = $1', [id]);
        await client.query('DELETE FROM student_class_enrollments WHERE batch_id = $1', [id]);
        await client.query('DELETE FROM batches WHERE id = $1', [id]);
        await client.query('COMMIT');
        return { success: true };
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('[BatchRepository] Failed to roll back batch deletion:', rollbackErr.message);
        }
        throw err;
      } finally {
        client.release();
      }
    }

    const idx = (memoryStore.batches || []).findIndex(b => b.id === id);
    if (idx === -1) return { success: false, code: 'NOT_FOUND', message: 'Batch not found.' };
    memoryStore.batch_enrollments = (memoryStore.batch_enrollments || []).filter(enrollment => enrollment.batch_id !== id);
    memoryStore.batch_teachers = (memoryStore.batch_teachers || []).filter(teacher => teacher.batch_id !== id);
    memoryStore.student_class_enrollments = (memoryStore.student_class_enrollments || []).filter(enrollment => enrollment.batch_id !== id);
    for (const collection of [
      'teacher_assignments',
      'timetable_entries',
      'attendance_records',
      'assignments',
      'live_class_sessions',
      'mock_tests'
    ]) {
      for (const record of memoryStore[collection] || []) {
        if (record.batch_id === id) record.batch_id = null;
      }
    }
    memoryStore.batches.splice(idx, 1);
    return { success: true };
  },

  // ── Teacher Allocations ──────────────────────────────────────────────────
  async getBatchTeachers(batchId) {
    if (isPostgresConnected && pool) {
      const query = `
        SELECT
          bt.id as allocation_id,
          bt.batch_id,
          bt.teacher_id,
          bt.assigned_at,
          u.full_name,
          u.email,
          u.avatar_url,
          u.status,
          assigner.full_name as assigned_by_name
        FROM batch_teachers bt
        JOIN users u ON bt.teacher_id = u.id
        LEFT JOIN users assigner ON bt.assigned_by = assigner.id
        WHERE bt.batch_id = $1
        ORDER BY bt.assigned_at DESC
      `;
      const res = await pool.query(query, [batchId]);
      return res.rows;
    }

    const allocs = (memoryStore.batch_teachers || []).filter(bt => bt.batch_id === batchId);
    return allocs.map(bt => {
      const u = memoryStore.users.find(user => user.id === bt.teacher_id);
      const assigner = memoryStore.users.find(user => user.id === bt.assigned_by);
      return {
        allocation_id: bt.id,
        batch_id: bt.batch_id,
        teacher_id: bt.teacher_id,
        assigned_at: bt.assigned_at,
        full_name: u?.full_name || 'Teacher',
        email: u?.email || '',
        avatar_url: u?.avatar_url || null,
        status: u?.status || 'active',
        assigned_by_name: assigner?.full_name || 'Administrator'
      };
    });
  },

  async assignTeacherToBatch({ batchId, teacherId, assignedBy }) {
    const id = `bt-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const query = `
        INSERT INTO batch_teachers (id, batch_id, teacher_id, assigned_by, assigned_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (batch_id, teacher_id) DO NOTHING
        RETURNING *
      `;
      const res = await pool.query(query, [id, batchId, teacherId, assignedBy, now]);
      if (res.rows.length === 0) {
        const err = new Error('Teacher is already assigned to this batch.');
        err.statusCode = 409;
        err.code = 'ALREADY_ASSIGNED';
        throw err;
      }
      return res.rows[0];
    }

    if (!memoryStore.batch_teachers) memoryStore.batch_teachers = [];
    const exists = memoryStore.batch_teachers.some(bt => bt.batch_id === batchId && bt.teacher_id === teacherId);
    if (exists) {
      const err = new Error('Teacher is already assigned to this batch.');
      err.statusCode = 409;
      err.code = 'ALREADY_ASSIGNED';
      throw err;
    }

    const record = { id, batch_id: batchId, teacher_id: teacherId, assigned_by: assignedBy, assigned_at: now };
    memoryStore.batch_teachers.push(record);
    return record;
  },

  async removeTeacherFromBatch(batchId, teacherId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('DELETE FROM batch_teachers WHERE batch_id = $1 AND teacher_id = $2 RETURNING *', [batchId, teacherId]);
      return res.rowCount > 0;
    }

    const idx = (memoryStore.batch_teachers || []).findIndex(bt => bt.batch_id === batchId && bt.teacher_id === teacherId);
    if (idx !== -1) {
      memoryStore.batch_teachers.splice(idx, 1);
      return true;
    }
    return false;
  },

  async isTeacherAssignedToBatch(batchId, teacherId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT 1 FROM batch_teachers WHERE batch_id = $1 AND teacher_id = $2
         UNION
         SELECT 1 FROM teacher_assignments WHERE batch_id = $1 AND teacher_id = $2
         LIMIT 1`,
        [batchId, teacherId]
      );
      return res.rows.length > 0;
    }

    const inBt = (memoryStore.batch_teachers || []).some(bt => bt.batch_id === batchId && bt.teacher_id === teacherId);
    if (inBt) return true;
    return (memoryStore.teacher_assignments || []).some(ta => ta.batch_id === batchId && ta.teacher_id === teacherId);
  },


  // ── Student Enrollments ──────────────────────────────────────────────────
  async getBatchStudents(batchId) {
    if (isPostgresConnected && pool) {
      const query = `
        SELECT DISTINCT ON (student_id)
          enrollment_id, batch_id, student_id, status, enrolled_at,
          full_name, email, avatar_url, phone, enrollment_number, enrolled_by_name
        FROM (
          SELECT
            be.id as enrollment_id,
            be.batch_id,
            be.student_id,
            COALESCE(be.status, 'active') as status,
            be.enrolled_at,
            u.full_name,
            u.email,
            u.avatar_url,
            u.phone,
            sp.enrollment_number,
            enroll_user.full_name as enrolled_by_name
          FROM batch_enrollments be
          JOIN users u ON be.student_id = u.id
          LEFT JOIN student_profiles sp ON u.id = sp.user_id
          LEFT JOIN users enroll_user ON be.enrolled_by = enroll_user.id
          WHERE be.batch_id = $1 AND (be.status = 'active' OR be.status IS NULL)
          UNION ALL
          SELECT
            sce.id as enrollment_id,
            sce.batch_id,
            sce.student_id,
            'active' as status,
            sce.enrolled_at,
            u.full_name,
            u.email,
            u.avatar_url,
            u.phone,
            sp.enrollment_number,
            'System' as enrolled_by_name
          FROM student_class_enrollments sce
          JOIN users u ON sce.student_id = u.id
          LEFT JOIN student_profiles sp ON u.id = sp.user_id
          WHERE sce.batch_id = $1
        ) combined
        ORDER BY student_id, enrolled_at DESC
      `;
      const res = await pool.query(query, [batchId]);
      return res.rows;
    }

    const bEnrolls = (memoryStore.batch_enrollments || []).filter(be => be.batch_id === batchId && (be.status === 'active' || !be.status));
    const cEnrolls = (memoryStore.student_class_enrollments || []).filter(ce => ce.batch_id === batchId);
    const seenStudentIds = new Set();
    const result = [];

    for (const be of bEnrolls) {
      if (seenStudentIds.has(be.student_id)) continue;
      seenStudentIds.add(be.student_id);
      const u = (memoryStore.users || []).find(user => user.id === be.student_id);
      const sp = (memoryStore.student_profiles || []).find(p => p.user_id === be.student_id);
      const enroller = (memoryStore.users || []).find(user => user.id === be.enrolled_by);
      result.push({
        enrollment_id: be.id,
        batch_id: be.batch_id,
        student_id: be.student_id,
        status: be.status || 'active',
        enrolled_at: be.enrolled_at,
        full_name: u?.full_name || 'Student',
        email: u?.email || '',
        avatar_url: u?.avatar_url || null,
        phone: u?.phone || null,
        enrollment_number: sp?.enrollment_number || null,
        roll_number: sp?.roll_number || null,
        enrolled_by_name: enroller?.full_name || 'Staff'
      });
    }

    for (const ce of cEnrolls) {
      if (seenStudentIds.has(ce.student_id)) continue;
      seenStudentIds.add(ce.student_id);
      const u = (memoryStore.users || []).find(user => user.id === ce.student_id);
      const sp = (memoryStore.student_profiles || []).find(p => p.user_id === ce.student_id);
      result.push({
        enrollment_id: ce.id,
        batch_id: ce.batch_id,
        student_id: ce.student_id,
        status: 'active',
        enrolled_at: ce.enrolled_at,
        full_name: u?.full_name || 'Student',
        email: u?.email || '',
        avatar_url: u?.avatar_url || null,
        phone: u?.phone || null,
        enrollment_number: sp?.enrollment_number || null,
        roll_number: sp?.roll_number || null,
        enrolled_by_name: 'System'
      });
    }

    return result;
  },

  async enrollStudentsBulkInBatch({ batchId, studentIds, enrolledBy }) {
    const enrolled = [];
    const failed = [];
    const capacityError = capacity => {
      const err = new Error(`Enrollment would exceed batch capacity (${capacity}). No students were enrolled.`);
      err.statusCode = 400;
      err.code = 'BATCH_CAPACITY_EXCEEDED';
      return err;
    };

    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const batchRes = await client.query(
          'SELECT id, capacity, status FROM batches WHERE id = $1 FOR UPDATE',
          [batchId]
        );
        const batch = batchRes.rows[0];
        if (!batch) {
          const err = new Error('Batch not found.');
          err.statusCode = 404;
          err.code = 'NOT_FOUND';
          throw err;
        }
        if (batch.status === 'Archived' || batch.status === 'Completed') {
          const err = new Error(`Cannot enroll students into ${batch.status.toLowerCase()} batch.`);
          err.statusCode = 400;
          err.code = 'BATCH_NOT_OPEN';
          throw err;
        }

        const capacity = Number(batch.capacity) || 40;
        const [countRes, usersRes, activeRes] = await Promise.all([
          client.query(
            "SELECT COUNT(*)::int as count FROM batch_enrollments WHERE batch_id = $1 AND status = 'active'",
            [batchId]
          ),
          client.query(
            "SELECT id FROM users WHERE id = ANY($1::varchar[]) AND role = 'STUDENT'",
            [[...new Set(studentIds)]]
          ),
          client.query(
            "SELECT student_id FROM batch_enrollments WHERE batch_id = $1 AND status = 'active'",
            [batchId]
          )
        ]);
        const currentEnrolledCount = countRes.rows[0].count;
        const validStudentIds = new Set(usersRes.rows.map(user => user.id));
        const activeStudentIds = new Set(activeRes.rows.map(enrollment => enrollment.student_id));
        const additionalStudents = new Set(studentIds.filter(studentId =>
          validStudentIds.has(studentId) && !activeStudentIds.has(studentId)
        ));
        if (currentEnrolledCount + additionalStudents.size > capacity) throw capacityError(capacity);

        for (const studentId of studentIds) {
          const studentRes = await client.query(
            "SELECT id, full_name FROM users WHERE id = $1 AND role = 'STUDENT'",
            [studentId]
          );
          const student = studentRes.rows[0];
          if (!student) {
            failed.push({ student_id: studentId, reason: 'Eligible student account not found.' });
            continue;
          }

          const existingRes = await client.query(
            "SELECT id FROM batch_enrollments WHERE batch_id = $1 AND student_id = $2 AND status = 'active'",
            [batchId, studentId]
          );
          if (existingRes.rows.length > 0) {
            failed.push({ student_id: studentId, reason: 'Student is already enrolled in this batch.' });
            continue;
          }

          const now = new Date().toISOString();
          const insertRes = await client.query(
            `INSERT INTO batch_enrollments (id, batch_id, student_id, enrolled_by, status, enrolled_at)
             VALUES ($1, $2, $3, $4, 'active', $5)
             ON CONFLICT (batch_id, student_id) DO UPDATE SET status = 'active'
             RETURNING *`,
            [`be-${crypto.randomUUID().slice(0, 8)}`, batchId, studentId, enrolledBy, now]
          );
          enrolled.push({
            enrollment: insertRes.rows[0],
            student_id: studentId,
            full_name: student.full_name
          });
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      const batch = memoryStore.batches.find(item => item.id === batchId);
      if (!batch) {
        const err = new Error('Batch not found.');
        err.statusCode = 404;
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (batch.status === 'Archived' || batch.status === 'Completed') {
        const err = new Error(`Cannot enroll students into ${batch.status.toLowerCase()} batch.`);
        err.statusCode = 400;
        err.code = 'BATCH_NOT_OPEN';
        throw err;
      }

      if (!memoryStore.batch_enrollments) memoryStore.batch_enrollments = [];
      const capacity = Number(batch.capacity) || 40;
      const activeEnrollments = memoryStore.batch_enrollments.filter(enrollment =>
        enrollment.batch_id === batchId && enrollment.status === 'active'
      );
      const activeStudentIds = new Set(activeEnrollments.map(enrollment => enrollment.student_id));
      const additionalStudents = new Set(studentIds.filter(studentId =>
        memoryStore.users.some(user => user.id === studentId && user.role === 'STUDENT') &&
        !activeStudentIds.has(studentId)
      ));
      if (activeEnrollments.length + additionalStudents.size > capacity) throw capacityError(capacity);

      for (const studentId of studentIds) {
        const student = memoryStore.users.find(user => user.id === studentId && user.role === 'STUDENT');
        if (!student) {
          failed.push({ student_id: studentId, reason: 'Eligible student account not found.' });
          continue;
        }

        const existing = memoryStore.batch_enrollments.find(enrollment =>
          enrollment.batch_id === batchId &&
          enrollment.student_id === studentId &&
          enrollment.status === 'active'
        );
        if (existing) {
          failed.push({ student_id: studentId, reason: 'Student is already enrolled in this batch.' });
          continue;
        }

        const now = new Date().toISOString();
        const existingIdx = memoryStore.batch_enrollments.findIndex(enrollment =>
          enrollment.batch_id === batchId && enrollment.student_id === studentId
        );
        if (existingIdx !== -1) {
          memoryStore.batch_enrollments[existingIdx].status = 'active';
          enrolled.push({
            enrollment: memoryStore.batch_enrollments[existingIdx],
            student_id: studentId,
            full_name: student.full_name
          });
        } else {
          const record = {
            id: `be-${crypto.randomUUID().slice(0, 8)}`,
            batch_id: batchId,
            student_id: studentId,
            enrolled_by: enrolledBy,
            status: 'active',
            enrolled_at: now
          };
          memoryStore.batch_enrollments.push(record);
          enrolled.push({ enrollment: record, student_id: studentId, full_name: student.full_name });
        }
      }
    }

    return {
      enrolled,
      failed,
      total_requested: studentIds.length,
      total_enrolled: enrolled.length,
      enrolled_count: enrolled.length
    };
  },

  async removeStudentFromBatch(batchId, studentId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        'DELETE FROM batch_enrollments WHERE batch_id = $1 AND student_id = $2 RETURNING *',
        [batchId, studentId]
      );
      return res.rowCount > 0;
    }

    const idx = (memoryStore.batch_enrollments || []).findIndex(be => be.batch_id === batchId && be.student_id === studentId);
    if (idx !== -1) {
      memoryStore.batch_enrollments.splice(idx, 1);
      return true;
    }
    return false;
  },

  async isStudentInBatch(studentId, batchId) {
    if (!studentId || !batchId) return false;
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT 1 FROM batch_enrollments WHERE student_id = $1 AND batch_id = $2 AND status = 'active'
         UNION
         SELECT 1 FROM student_class_enrollments WHERE student_id = $1 AND batch_id = $2
         LIMIT 1`,
        [studentId, batchId]
      );
      return res.rows.length > 0;
    }
    return (
      (memoryStore.batch_enrollments || []).some(
        be => be.student_id === studentId && be.batch_id === batchId && be.status === 'active'
      ) ||
      (memoryStore.student_class_enrollments || []).some(
        sce => sce.student_id === studentId && sce.batch_id === batchId
      )
    );
  },

  async getStudentBatchIds(studentId) {
    if (!studentId) return [];
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT batch_id FROM batch_enrollments WHERE student_id = $1 AND status = 'active'
         UNION
         SELECT batch_id FROM student_class_enrollments WHERE student_id = $1 AND batch_id IS NOT NULL`,
        [studentId]
      );
      return res.rows.map(r => r.batch_id);
    }
    const set = new Set();
    (memoryStore.batch_enrollments || [])
      .filter(be => be.student_id === studentId && be.status === 'active')
      .forEach(be => set.add(be.batch_id));
    (memoryStore.student_class_enrollments || [])
      .filter(sce => sce.student_id === studentId && sce.batch_id)
      .forEach(sce => set.add(sce.batch_id));
    return Array.from(set);
  }
};
