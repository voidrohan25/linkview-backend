import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const invitationRepository = {
  async create({ email, fullName, department = null, invitedBy, tokenHash, expiresAt }) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO teacher_invitations (id, email, full_name, department, invited_by, token_hash, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id, email.toLowerCase().trim(), fullName, department, invitedBy, tokenHash, expiresAt, created_at]
      );
      return res.rows[0];
    }
    const inv = { id, email: email.toLowerCase().trim(), full_name: fullName, department, invited_by: invitedBy, token_hash: tokenHash, expires_at: expiresAt, accepted_at: null, created_at };
    memoryStore.teacher_invitations.push(inv);
    return inv;
  },

  async findByTokenHash(tokenHash, { client = null, forUpdate = false } = {}) {
    if (isPostgresConnected && pool) {
      const db = client || pool;
      const res = await db.query(
        `SELECT * FROM teacher_invitations WHERE token_hash = $1${forUpdate ? ' FOR UPDATE' : ''}`,
        [tokenHash]
      );
      return res.rows[0] || null;
    }
    return memoryStore.teacher_invitations.find(i => i.token_hash === tokenHash) || null;
  },

  async findByEmail(email) {
    const normalized = email.toLowerCase().trim();
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM teacher_invitations WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [normalized]);
      return res.rows[0] || null;
    }
    return memoryStore.teacher_invitations
      .filter(i => i.email === normalized)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  },

  async markAccepted(id, { client = null } = {}) {
    const acceptedAt = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const db = client || pool;
      const res = await db.query(
        `UPDATE teacher_invitations
         SET accepted_at = $1
         WHERE id = $2 AND accepted_at IS NULL AND expires_at > NOW()
         RETURNING *`,
        [acceptedAt, id]
      );
      return res.rows[0] || null;
    }
    const inv = memoryStore.teacher_invitations.find(i => i.id === id);
    if (!inv) return null;
    inv.accepted_at = acceptedAt;
    return inv;
  },

  async deletePending(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        'DELETE FROM teacher_invitations WHERE id = $1 AND accepted_at IS NULL RETURNING id',
        [id]
      );
      return res.rowCount > 0;
    }
    const idx = memoryStore.teacher_invitations.findIndex(invitation =>
      invitation.id === id && !invitation.accepted_at
    );
    if (idx === -1) return false;
    memoryStore.teacher_invitations.splice(idx, 1);
    return true;
  },

  async getAll() {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT ti.*, u.full_name as invited_by_name FROM teacher_invitations ti
         LEFT JOIN users u ON ti.invited_by = u.id ORDER BY ti.created_at DESC`
      );
      return res.rows;
    }
    return memoryStore.teacher_invitations.map(i => {
      const inviter = memoryStore.users.find(u => u.id === i.invited_by);
      return { ...i, invited_by_name: inviter?.full_name };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
};

export const passwordResetRepository = {
  async create({ userId, tokenHash, expiresAt }) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    // Invalidate any existing tokens for this user
    if (isPostgresConnected && pool) {
      await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
      const res = await pool.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at) VALUES ($1,$2,$3,$4,false,$5) RETURNING *`,
        [id, userId, tokenHash, expiresAt, created_at]
      );
      return res.rows[0];
    }
    memoryStore.password_reset_tokens = memoryStore.password_reset_tokens.filter(t => t.user_id !== userId);
    const token = { id, user_id: userId, token_hash: tokenHash, expires_at: expiresAt, used: false, created_at };
    memoryStore.password_reset_tokens.push(token);
    return token;
  },

  async findByTokenHash(tokenHash) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used = false', [tokenHash]);
      return res.rows[0] || null;
    }
    return memoryStore.password_reset_tokens.find(t => t.token_hash === tokenHash && !t.used) || null;
  },

  async markUsed(id) {
    if (isPostgresConnected && pool) {
      await pool.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [id]);
      return;
    }
    const token = memoryStore.password_reset_tokens.find(t => t.id === id);
    if (token) token.used = true;
  }
};
