import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const mockTestJoinRequestRepository = {
  /**
   * Find active join request (PENDING or APPROVED) for student and test
   */
  async findActiveByStudentAndTest(studentId, mockTestId) {
    if (isPostgresConnected && pool) {
      const query = `
        SELECT * FROM mock_test_join_requests
        WHERE student_id = $1 AND mock_test_id = $2 AND status IN ('PENDING', 'APPROVED')
        ORDER BY requested_at DESC
        LIMIT 1
      `;
      const res = await pool.query(query, [studentId, mockTestId]);
      return res.rows[0] || null;
    }

    const list = memoryStore.mock_test_join_requests || [];
    return list
      .filter(r => r.student_id === studentId && r.mock_test_id === mockTestId && ['PENDING', 'APPROVED'].includes(r.status))
      .sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at))[0] || null;
  },

  /**
   * Get latest join request for student and test (any status)
   */
  async getLatestByStudentAndTest(studentId, mockTestId) {
    if (isPostgresConnected && pool) {
      const query = `
        SELECT * FROM mock_test_join_requests
        WHERE student_id = $1 AND mock_test_id = $2
        ORDER BY requested_at DESC
        LIMIT 1
      `;
      const res = await pool.query(query, [studentId, mockTestId]);
      return res.rows[0] || null;
    }

    const list = memoryStore.mock_test_join_requests || [];
    return list
      .filter(r => r.student_id === studentId && r.mock_test_id === mockTestId)
      .sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at))[0] || null;
  },

  /**
   * Find request by ID
   */
  async getById(id) {
    if (isPostgresConnected && pool) {
      const query = `
        SELECT r.*, mt.title as mock_test_title, mt.created_by as test_owner_id,
               u.full_name as student_name, u.email as student_email
        FROM mock_test_join_requests r
        JOIN mock_tests mt ON r.mock_test_id = mt.id
        JOIN users u ON r.student_id = u.id
        WHERE r.id = $1
      `;
      const res = await pool.query(query, [id]);
      return res.rows[0] || null;
    }

    const list = memoryStore.mock_test_join_requests || [];
    const r = list.find(req => req.id === id);
    if (!r) return null;
    const mt = (memoryStore.mock_tests || []).find(t => t.id === r.mock_test_id);
    const u = (memoryStore.users || []).find(user => user.id === r.student_id);
    return {
      ...r,
      mock_test_title: mt?.title || 'Mock Test',
      test_owner_id: mt?.created_by || null,
      student_name: u?.full_name || 'Student',
      student_email: u?.email || ''
    };
  },

  /**
   * Create or return existing pending/approved request
   */
  async createRequest({ mockTestId, studentId, teacherId = null }) {
    // 1. Check for existing active request
    const existing = await this.findActiveByStudentAndTest(studentId, mockTestId);
    if (existing) {
      return { isNew: false, request: existing };
    }

    const id = `req-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const query = `
        INSERT INTO mock_test_join_requests (
          id, mock_test_id, student_id, teacher_id, status, requested_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $5, $5)
        RETURNING *
      `;
      const res = await pool.query(query, [id, mockTestId, studentId, teacherId, now]);
      return { isNew: true, request: res.rows[0] };
    }

    const newReq = {
      id,
      mock_test_id: mockTestId,
      student_id: studentId,
      teacher_id: teacherId,
      status: 'PENDING',
      requested_at: now,
      reviewed_at: null,
      reviewed_by: null,
      rejection_reason: null,
      created_at: now,
      updated_at: now
    };
    if (!memoryStore.mock_test_join_requests) memoryStore.mock_test_join_requests = [];
    memoryStore.mock_test_join_requests.push(newReq);
    return { isNew: true, request: newReq };
  },

  /**
   * Get requests for teacher (or admin if teacherId is null/'ALL')
   */
  async getRequestsForTeacher(teacherId, { status = 'PENDING', mockTestId = null, limit = 100, offset = 0 } = {}) {
    const normStatus = status ? String(status).toUpperCase() : null;

    if (isPostgresConnected && pool) {
      let query = `
        SELECT 
          r.*,
          mt.title as mock_test_title,
          mt.subject as mock_test_subject,
          mt.created_by as test_owner_id,
          u.full_name as student_name,
          u.email as student_email,
          u.avatar_url as student_avatar_url
        FROM mock_test_join_requests r
        JOIN mock_tests mt ON r.mock_test_id = mt.id
        JOIN users u ON r.student_id = u.id
        WHERE 1=1
      `;
      const params = [];

      if (teacherId && teacherId !== 'ALL') {
        params.push(teacherId);
        query += ` AND (mt.created_by = $${params.length} OR r.teacher_id = $${params.length})`;
      }

      if (normStatus && normStatus !== 'ALL') {
        params.push(normStatus);
        query += ` AND r.status = $${params.length}`;
      }

      if (mockTestId) {
        params.push(mockTestId);
        query += ` AND r.mock_test_id = $${params.length}`;
      }

      query += ` ORDER BY r.requested_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const res = await pool.query(query, params);
      return res.rows;
    }

    let list = [...(memoryStore.mock_test_join_requests || [])];

    if (normStatus && normStatus !== 'ALL') {
      list = list.filter(r => r.status === normStatus);
    }
    if (mockTestId) {
      list = list.filter(r => r.mock_test_id === mockTestId);
    }

    const decorated = list.map(r => {
      const mt = (memoryStore.mock_tests || []).find(t => t.id === r.mock_test_id);
      const u = (memoryStore.users || []).find(user => user.id === r.student_id);
      return {
        ...r,
        mock_test_title: mt?.title || 'Mock Test',
        mock_test_subject: mt?.subject || 'General',
        test_owner_id: mt?.created_by || null,
        student_name: u?.full_name || 'Student',
        student_email: u?.email || '',
        student_avatar_url: u?.avatar_url || null
      };
    });

    if (teacherId && teacherId !== 'ALL') {
      return decorated
        .filter(r => r.test_owner_id === teacherId || r.teacher_id === teacherId)
        .sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at))
        .slice(offset, offset + limit);
    }

    return decorated
      .sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at))
      .slice(offset, offset + limit);
  },

  /**
   * Approve a join request atomically
   */
  async approveRequest(id, reviewerId) {
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const query = `
        UPDATE mock_test_join_requests
        SET status = 'APPROVED',
            reviewed_at = $1,
            reviewed_by = $2,
            rejection_reason = NULL,
            updated_at = $1
        WHERE id = $3 AND status = 'PENDING'
        RETURNING *
      `;
      const res = await pool.query(query, [now, reviewerId, id]);
      return res.rows[0] || null;
    }

    const list = memoryStore.mock_test_join_requests || [];
    const r = list.find(req => req.id === id && req.status === 'PENDING');
    if (!r) return null;

    r.status = 'APPROVED';
    r.reviewed_at = now;
    r.reviewed_by = reviewerId;
    r.rejection_reason = null;
    r.updated_at = now;
    return r;
  },

  /**
   * Reject a join request atomically
   */
  async rejectRequest(id, reviewerId, reason = null) {
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const query = `
        UPDATE mock_test_join_requests
        SET status = 'REJECTED',
            reviewed_at = $1,
            reviewed_by = $2,
            rejection_reason = $3,
            updated_at = $1
        WHERE id = $4 AND status = 'PENDING'
        RETURNING *
      `;
      const res = await pool.query(query, [now, reviewerId, reason, id]);
      return res.rows[0] || null;
    }

    const list = memoryStore.mock_test_join_requests || [];
    const r = list.find(req => req.id === id && req.status === 'PENDING');
    if (!r) return null;

    r.status = 'REJECTED';
    r.reviewed_at = now;
    r.reviewed_by = reviewerId;
    r.rejection_reason = reason;
    r.updated_at = now;
    return r;
  }
};
