import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

const SAFE_USER_FIELDS = 'id, full_name, email, role, status, phone, avatar_url, email_verified, email_verified_at, google_id, auth_provider, account_linked_at, last_login_at, created_at';

export const userRepository = {
  async findByEmail(email, { client = null } = {}) {
    const normalizedEmail = email.trim().toLowerCase();
    if (isPostgresConnected && pool) {
      const db = client || pool;
      const res = await db.query('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
      return res.rows[0] || null;
    }
    return memoryStore.users.find(u => u.email.toLowerCase() === normalizedEmail) || null;
  },

  async findById(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT ${SAFE_USER_FIELDS} FROM users WHERE id = $1`,
        [id]
      );
      return res.rows[0] || null;
    }
    const user = memoryStore.users.find(u => u.id === id);
    if (!user) return null;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async findByGoogleId(googleId) {
    if (!googleId) return null;
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
      return res.rows[0] || null;
    }
    return memoryStore.users.find(u => u.google_id === googleId) || null;
  },

  async createGoogleUser({ fullName, email, googleId, avatarUrl = null, role = 'STUDENT' }) {
    const id = crypto.randomUUID();
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date().toISOString();
    // Safety check: Public OAuth never creates ADMIN accounts
    const safeRole = role === 'TEACHER' ? 'TEACHER' : 'STUDENT';

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, avatar_url, google_id, auth_provider, account_linked_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING ${SAFE_USER_FIELDS}`,
        [id, fullName.trim(), normalizedEmail, null, safeRole, 'active', true, now, avatarUrl, googleId, 'google', now, now]
      );
      return res.rows[0];
    }

    const newUser = {
      id,
      full_name: fullName.trim(),
      email: normalizedEmail,
      password_hash: null,
      role: safeRole,
      status: 'active',
      email_verified: true,
      email_verified_at: now,
      phone: null,
      avatar_url: avatarUrl,
      google_id: googleId,
      auth_provider: 'google',
      account_linked_at: now,
      last_login_at: null,
      created_at: now
    };
    memoryStore.users.push(newUser);
    const { password_hash, ...safeUser } = newUser;
    return safeUser;
  },

  async linkGoogleAccount(userId, { googleId, avatarUrl = null }) {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE users
         SET google_id = $1,
             auth_provider = CASE WHEN auth_provider = 'local' THEN 'google_linked' ELSE auth_provider END,
             avatar_url = COALESCE(avatar_url, $2),
             email_verified = true,
             email_verified_at = COALESCE(email_verified_at, $3),
             account_linked_at = $3
         WHERE id = $4
         RETURNING ${SAFE_USER_FIELDS}`,
        [googleId, avatarUrl, now, userId]
      );
      return res.rows[0] || null;
    }

    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return null;
    user.google_id = googleId;
    user.auth_provider = user.auth_provider === 'local' ? 'google_linked' : user.auth_provider;
    if (!user.avatar_url && avatarUrl) user.avatar_url = avatarUrl;
    user.email_verified = true;
    if (!user.email_verified_at) user.email_verified_at = now;
    user.account_linked_at = now;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async unlinkGoogleAccount(userId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE users
         SET google_id = NULL,
             auth_provider = 'local',
             account_linked_at = NULL
         WHERE id = $1
         RETURNING ${SAFE_USER_FIELDS}`,
        [userId]
      );
      return res.rows[0] || null;
    }

    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return null;
    user.google_id = null;
    user.auth_provider = 'local';
    user.account_linked_at = null;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async create({ fullName, email, passwordHash, role = 'STUDENT', emailVerified = false, emailVerifiedAt = null, status = 'active' }, { client = null } = {}) {
    const id = crypto.randomUUID();
    const normalizedEmail = email.trim().toLowerCase();
    const createdAt = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const db = client || pool;
      try {
        const res = await db.query(
          `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING ${SAFE_USER_FIELDS}`,
          [id, fullName.trim(), normalizedEmail, passwordHash, role, status, emailVerified, emailVerifiedAt, createdAt]
        );
        return res.rows[0];
      } catch (err) {
        if (err.code === '23505') {
          const conflictErr = new Error('An account with this email address already exists.');
          conflictErr.statusCode = 409;
          conflictErr.code = 'CONFLICT';
          throw conflictErr;
        }
        throw err;
      }
    }

    const existingInMem = memoryStore.users.find(u => u.email.toLowerCase() === normalizedEmail);
    if (existingInMem) {
      const conflictErr = new Error('An account with this email address already exists.');
      conflictErr.statusCode = 409;
      conflictErr.code = 'CONFLICT';
      throw conflictErr;
    }

    const newUser = {
      id,
      full_name: fullName.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role,
      status,
      email_verified: emailVerified,
      email_verified_at: emailVerifiedAt,
      last_login_at: null,
      phone: null,
      avatar_url: null,
      created_at: createdAt
    };
    memoryStore.users.push(newUser);
    const { password_hash, ...safeUser } = newUser;
    return safeUser;
  },

  async updateUnverifiedUser(id, { fullName, passwordHash }) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE users
         SET full_name = $1, password_hash = $2
         WHERE id = $3 AND email_verified = false
         RETURNING ${SAFE_USER_FIELDS}`,
        [fullName.trim(), passwordHash, id]
      );
      return res.rows[0] || null;
    }

    const user = memoryStore.users.find(u => u.id === id && !u.email_verified);
    if (!user) return null;
    user.full_name = fullName.trim();
    user.password_hash = passwordHash;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async markEmailVerified(userId) {
    const verifiedAt = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE users
         SET email_verified = true, email_verified_at = $2
         WHERE id = $1
         RETURNING ${SAFE_USER_FIELDS}`,
        [userId, verifiedAt]
      );
      return res.rows[0] || null;
    }

    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return null;
    user.email_verified = true;
    user.email_verified_at = verifiedAt;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async updateStatus(userId, status) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE users SET status = $1 WHERE id = $2 RETURNING ${SAFE_USER_FIELDS}`,
        [status, userId]
      );
      return res.rows[0] || null;
    }
    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return null;
    user.status = status;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async updateProfile(userId, { fullName, phone, avatarUrl }) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone), avatar_url = COALESCE($3, avatar_url)
         WHERE id = $4 RETURNING ${SAFE_USER_FIELDS}`,
        [fullName, phone, avatarUrl, userId]
      );
      return res.rows[0] || null;
    }
    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return null;
    if (fullName) user.full_name = fullName;
    if (phone !== undefined) user.phone = phone;
    if (avatarUrl !== undefined) user.avatar_url = avatarUrl;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async updatePassword(userId, passwordHash) {
    if (isPostgresConnected && pool) {
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
      return true;
    }
    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return false;
    user.password_hash = passwordHash;
    return true;
  },

  async recordLogin(userId) {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, userId]);
      return;
    }
    const user = memoryStore.users.find(u => u.id === userId);
    if (user) user.last_login_at = now;
  },

  async updateLastLogin(userId) {
    return this.recordLogin(userId);
  },

  async getAllUsers(filters = {}) {
    const { role, status, search, limit = 500, offset = 0 } = filters;

    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];
      if (role && role !== 'ALL') {
        params.push(role);
        where += ` AND u.role = $${params.length}`;
      }
      if (status && status !== 'ALL') {
        params.push(status);
        where += ` AND u.status = $${params.length}`;
      }
      if (search && search.trim()) {
        params.push(`%${search.trim()}%`);
        where += ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.id::text ILIKE $${params.length} OR COALESCE(u.auth_provider, '') ILIKE $${params.length})`;
      }
      params.push(limit, offset);
      const res = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.role, u.status, u.phone, u.avatar_url,
                u.email_verified, u.email_verified_at, u.google_id, u.auth_provider,
                u.account_linked_at, u.last_login_at, u.created_at,
                COUNT(DISTINCT e.course_id)::int as enrolled_courses_count,
                COUNT(DISTINCT qa.id)::int as quiz_attempts_count
         FROM users u
         LEFT JOIN enrollments e ON u.id = e.user_id
         LEFT JOIN quiz_attempts qa ON u.id = qa.user_id
         ${where}
         GROUP BY u.id ORDER BY u.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return res.rows;
    }

    let users = memoryStore.users;
    if (role && role !== 'ALL') users = users.filter(u => u.role === role);
    if (status && status !== 'ALL') users = users.filter(u => u.status === status);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      users = users.filter(u =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.id?.toLowerCase().includes(q) ||
        (u.auth_provider || '').toLowerCase().includes(q)
      );
    }

    return users.slice(offset, offset + limit).map(u => {
      const { password_hash, ...safe } = u;
      const enrolled_courses_count = memoryStore.enrollments.filter(e => e.user_id === u.id).length;
      const quiz_attempts_count = memoryStore.quiz_attempts.filter(qa => qa.user_id === u.id).length;
      return { ...safe, enrolled_courses_count, quiz_attempts_count };
    });
  },

  async getStudents(filters = {}) {
    const students = await this.getAllUsers({ ...filters, role: 'STUDENT' });
    if (!students || students.length === 0) return [];

    if (isPostgresConnected && pool) {
      const studentIds = students.map(s => s.id);
      try {
        const enrollmentsRes = await pool.query(
          `SELECT
             be.student_id,
             b.id as batch_id,
             b.name as batch_name,
             b.code as batch_code,
             c.id as class_id,
             c.name as class_name,
             (
               SELECT u.full_name
               FROM teacher_assignments ta
               JOIN users u ON ta.teacher_id = u.id
               WHERE ta.batch_id = b.id
               LIMIT 1
             ) as teacher_name
           FROM batch_enrollments be
           JOIN batches b ON be.batch_id = b.id
           LEFT JOIN classes c ON b.class_id = c.id
           WHERE be.student_id = ANY($1::varchar[]) AND (be.status = 'active' OR be.status IS NULL)
           UNION
           SELECT
             sce.student_id,
             b.id as batch_id,
             b.name as batch_name,
             b.code as batch_code,
             c.id as class_id,
             c.name as class_name,
             (
               SELECT u.full_name
               FROM teacher_assignments ta
               JOIN users u ON ta.teacher_id = u.id
               WHERE ta.batch_id = b.id
               LIMIT 1
             ) as teacher_name
           FROM student_class_enrollments sce
           JOIN classes c ON sce.class_id = c.id
           LEFT JOIN batches b ON sce.batch_id = b.id
           WHERE sce.student_id = ANY($1::varchar[])`,
          [studentIds]
        );

        const studentEnrollMap = {};
        for (const row of enrollmentsRes.rows) {
          if (!studentEnrollMap[row.student_id]) {
            studentEnrollMap[row.student_id] = [];
          }
          studentEnrollMap[row.student_id].push(row);
        }

        return students.map(s => {
          const enrolls = studentEnrollMap[s.id] || [];
          const batches = enrolls.filter(e => e.batch_id && e.batch_name).map(e => ({
            id: e.batch_id,
            name: e.batch_name,
            code: e.batch_code,
            class_name: e.class_name,
            teacher_name: e.teacher_name
          }));
          const uniqueBatches = [];
          const seenBatchIds = new Set();
          for (const b of batches) {
            if (!seenBatchIds.has(b.id)) {
              seenBatchIds.add(b.id);
              uniqueBatches.push(b);
            }
          }
          const batchNames = uniqueBatches.map(b => b.name).join(', ');
          const batchCodes = uniqueBatches.map(b => b.code).filter(Boolean).join(', ');
          const teacherNames = Array.from(new Set(uniqueBatches.map(b => b.teacher_name).filter(Boolean))).join(', ');
          const className = enrolls.map(e => e.class_name).filter(Boolean)[0] || s.class_name || null;
          const classId = enrolls.map(e => e.class_id).filter(Boolean)[0] || s.class_id || null;

          return {
            ...s,
            batches: uniqueBatches,
            batch_id: uniqueBatches[0]?.id || null,
            batch_name: batchNames || null,
            batch_code: batchCodes || null,
            teacher_name: teacherNames || null,
            class_name: className,
            class_id: classId
          };
        });
      } catch (err) {
        console.error('Error enriching students:', err);
        return students;
      }
    }

    // MemoryStore fallback
    return students.map(s => {
      const bEnrolls = (memoryStore.batch_enrollments || []).filter(be => be.student_id === s.id && (be.status === 'active' || !be.status));
      const cEnrolls = (memoryStore.student_class_enrollments || []).filter(ce => ce.student_id === s.id);
      const combinedBatches = [];
      const seenIds = new Set();

      for (const be of bEnrolls) {
        const b = (memoryStore.batches || []).find(x => x.id === be.batch_id);
        if (b && !seenIds.has(b.id)) {
          seenIds.add(b.id);
          const c = (memoryStore.classes || []).find(cls => cls.id === b.class_id);
          const ta = (memoryStore.teacher_assignments || []).find(t => t.batch_id === b.id);
          const teacher = ta ? (memoryStore.users || []).find(u => u.id === ta.teacher_id) : null;
          combinedBatches.push({
            id: b.id,
            name: b.name,
            code: b.code,
            class_name: c?.name || null,
            teacher_name: teacher?.full_name || null
          });
        }
      }

      for (const ce of cEnrolls) {
        if (ce.batch_id && !seenIds.has(ce.batch_id)) {
          seenIds.add(ce.batch_id);
          const b = (memoryStore.batches || []).find(x => x.id === ce.batch_id);
          const c = (memoryStore.classes || []).find(cls => cls.id === ce.class_id);
          const ta = (memoryStore.teacher_assignments || []).find(t => t.batch_id === ce.batch_id);
          const teacher = ta ? (memoryStore.users || []).find(u => u.id === ta.teacher_id) : null;
          if (b) {
            combinedBatches.push({
              id: b.id,
              name: b.name,
              code: b.code,
              class_name: c?.name || null,
              teacher_name: teacher?.full_name || null
            });
          }
        }
      }

      const batchNames = combinedBatches.map(b => b.name).join(', ');
      const batchCodes = combinedBatches.map(b => b.code).filter(Boolean).join(', ');
      const teacherNames = Array.from(new Set(combinedBatches.map(b => b.teacher_name).filter(Boolean))).join(', ');
      const cEnroll = cEnrolls[0];
      const cls = cEnroll ? (memoryStore.classes || []).find(c => c.id === cEnroll.class_id) : null;

      return {
        ...s,
        batches: combinedBatches,
        batch_id: combinedBatches[0]?.id || null,
        batch_name: batchNames || null,
        batch_code: batchCodes || null,
        teacher_name: teacherNames || null,
        class_name: cls?.name || s.class_name || null,
        class_id: cls?.id || s.class_id || null
      };
    });
  },

  async getTeachers(filters = {}) {
    const teachers = await this.getAllUsers({ ...filters, role: 'TEACHER' });
    if (!teachers || teachers.length === 0) return [];

    if (isPostgresConnected && pool) {
      const teacherIds = teachers.map(t => t.id);
      try {
        const [asgnsRes, profRes] = await Promise.all([
          pool.query(
            `SELECT ta.*, c.name as class_name, b.name as batch_name, s.name as subject_name, s.code as subject_code
             FROM teacher_assignments ta
             LEFT JOIN classes c ON ta.class_id = c.id
             LEFT JOIN batches b ON ta.batch_id = b.id
             JOIN subjects s ON ta.subject_id = s.id
             WHERE ta.teacher_id = ANY($1::varchar[])
             ORDER BY ta.assigned_at DESC`,
            [teacherIds]
          ),
          pool.query(
            `SELECT * FROM teacher_profiles WHERE user_id = ANY($1::varchar[])`,
            [teacherIds]
          )
        ]);

        const asgnsMap = {};
        for (const r of asgnsRes.rows) {
          if (!asgnsMap[r.teacher_id]) asgnsMap[r.teacher_id] = [];
          asgnsMap[r.teacher_id].push(r);
        }

        const profMap = {};
        for (const p of profRes.rows) {
          profMap[p.user_id] = p;
        }

        teachers.forEach(t => {
          t.assignments = asgnsMap[t.id] || [];
          const prof = profMap[t.id];
          if (prof) {
            t.department = prof.department || t.department;
            t.qualification = prof.qualification || t.qualification;
            t.specialization = prof.specialization || t.specialization;
          }
        });
      } catch (err) {
        // Fallback without assignments if table join errors
        teachers.forEach(t => { if (!t.assignments) t.assignments = []; });
      }
      return teachers;
    }

    teachers.forEach(t => {
      t.assignments = (memoryStore.teacher_assignments || [])
        .filter(ta => ta.teacher_id === t.id)
        .map(ta => {
          const cls = (memoryStore.classes || []).find(c => c.id === ta.class_id);
          const batch = (memoryStore.batches || []).find(b => b.id === ta.batch_id);
          const subject = (memoryStore.subjects || []).find(s => s.id === ta.subject_id);
          return {
            ...ta,
            class_name: cls?.name,
            batch_name: batch?.name,
            subject_name: subject?.name,
            subject_code: subject?.code
          };
        });
    });
    return teachers;
  },

  async countByRole() {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT role, COUNT(*)::int as count FROM users GROUP BY role`
      );
      const counts = { STUDENT: 0, TEACHER: 0, ADMIN: 0 };
      res.rows.forEach(r => { counts[r.role] = r.count; });
      return counts;
    }
    const counts = { STUDENT: 0, TEACHER: 0, ADMIN: 0 };
    memoryStore.users.forEach(u => { if (counts[u.role] !== undefined) counts[u.role]++; });
    return counts;
  },

  async searchStudents({ query = '', page = 1, limit = 20 } = {}) {
    const offset = (Math.max(1, page) - 1) * limit;
    const q = (query || '').trim().toLowerCase();

    if (isPostgresConnected && pool) {
      let sql = `
        SELECT u.id, u.full_name, u.email, u.role, u.status, u.avatar_url, u.created_at,
               sp.enrollment_number
        FROM users u
        LEFT JOIN student_profiles sp ON u.id = sp.user_id
        WHERE u.role = 'STUDENT'
      `;
      const params = [];

      if (q) {
        params.push(`%${q}%`);
        sql += ` AND (LOWER(u.full_name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(sp.enrollment_number, '')) LIKE $${params.length})`;
      }

      const countRes = await pool.query(`SELECT COUNT(*)::int as total FROM (${sql}) sub`, params);
      const total = countRes.rows[0]?.total || 0;

      if (q) {
        params.push(q);
        const exactParamIdx = params.length;
        params.push(`${q}%`);
        const prefixParamIdx = params.length;
        sql += ` ORDER BY 
          CASE 
            WHEN LOWER(u.email) = $${exactParamIdx} OR LOWER(u.full_name) = $${exactParamIdx} THEN 1
            WHEN LOWER(u.full_name) LIKE $${prefixParamIdx} OR LOWER(u.email) LIKE $${prefixParamIdx} OR LOWER(COALESCE(sp.enrollment_number, '')) LIKE $${prefixParamIdx} THEN 2
            ELSE 3
          END ASC,
          u.full_name ASC 
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const rowsRes = await pool.query(sql, [...params, limit, offset]);

        return {
          students: rowsRes.rows,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        };
      } else {
        sql += ` ORDER BY u.full_name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const rowsRes = await pool.query(sql, [...params, limit, offset]);

        return {
          students: rowsRes.rows,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        };
      }
    }

    let students = memoryStore.users.filter(u => u.role === 'STUDENT');
    if (q) {
      students = students.filter(u =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        (memoryStore.student_profiles || []).some(p => p.user_id === u.id && p.enrollment_number?.toLowerCase().includes(q))
      );
      students.sort((a, b) => {
        const aName = (a.full_name || '').toLowerCase();
        const bName = (b.full_name || '').toLowerCase();
        const aEmail = (a.email || '').toLowerCase();
        const bEmail = (b.email || '').toLowerCase();

        const aExact = aName === q || aEmail === q ? 1 : 0;
        const bExact = bName === q || bEmail === q ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aPrefix = aName.startsWith(q) || aEmail.startsWith(q) ? 1 : 0;
        const bPrefix = bName.startsWith(q) || bEmail.startsWith(q) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;

        return aName.localeCompare(bName);
      });
    } else {
      students.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    }
    const total = students.length;
    const paged = students.slice(offset, offset + limit).map(u => {
      const sp = (memoryStore.student_profiles || []).find(p => p.user_id === u.id);
      const { password_hash, ...safe } = u;
      return {
        ...safe,
        enrollment_number: sp?.enrollment_number || null,
        roll_number: sp?.roll_number || null
      };
    });

    return {
      students: paged,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  },

  async updateUserRoleAndStatus(userId, { role, status, fullName }) {
    if (isPostgresConnected && pool) {
      const fields = [];
      const params = [];

      if (role) {
        params.push(role);
        fields.push(`role = $${params.length}`);
      }
      if (status) {
        params.push(status);
        fields.push(`status = $${params.length}`);
      }
      if (fullName) {
        params.push(fullName.trim());
        fields.push(`full_name = $${params.length}`);
      }

      if (fields.length === 0) return this.findById(userId);

      params.push(userId);
      const res = await pool.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING ${SAFE_USER_FIELDS}`,
        params
      );
      return res.rows[0] || null;
    }

    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return null;
    if (role) user.role = role;
    if (status) user.status = status;
    if (fullName) user.full_name = fullName.trim();
    const { password_hash, ...safe } = user;
    return safe;
  }
};
