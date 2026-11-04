import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const tokenRepository = {
  async createOrUpdateToken({ userId, tokenHash, expiresAt }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, attempts, last_sent_at, created_at)
         VALUES ($1, $2, $3, $4, 0, $5, $5)
         ON CONFLICT (user_id) DO UPDATE
         SET token_hash = EXCLUDED.token_hash,
             expires_at = EXCLUDED.expires_at,
             attempts = 0,
             last_sent_at = EXCLUDED.last_sent_at
         RETURNING *`,
        [id, userId, tokenHash, expiresAt, now]
      );
      return res.rows[0];
    }

    const existingIdx = memoryStore.email_verification_tokens.findIndex(t => t.user_id === userId);
    const tokenRecord = {
      id: existingIdx !== -1 ? memoryStore.email_verification_tokens[existingIdx].id : id,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      attempts: 0,
      last_sent_at: now,
      created_at: existingIdx !== -1 ? memoryStore.email_verification_tokens[existingIdx].created_at : now
    };

    if (existingIdx !== -1) {
      memoryStore.email_verification_tokens[existingIdx] = tokenRecord;
    } else {
      memoryStore.email_verification_tokens.push(tokenRecord);
    }

    return tokenRecord;
  },

  async createOrUpdateTokenWithCooldown({ userId, tokenHash, expiresAt, cooldownMs = 60000 }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const checkRes = await client.query(
          `SELECT * FROM email_verification_tokens WHERE user_id = $1 FOR UPDATE`,
          [userId]
        );
        const existing = checkRes.rows[0];
        if (existing && existing.last_sent_at) {
          const elapsedMs = Date.now() - new Date(existing.last_sent_at).getTime();
          if (elapsedMs < cooldownMs) {
            await client.query('ROLLBACK');
            const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
            const err = new Error(`Please wait ${remainingSeconds} seconds before requesting a new code.`);
            err.statusCode = 429;
            err.code = 'RESEND_COOLDOWN';
            err.details = { cooldown_seconds: remainingSeconds };
            throw err;
          }
        }

        const insertRes = await client.query(
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, attempts, last_sent_at, created_at)
           VALUES ($1, $2, $3, $4, 0, $5, $5)
           ON CONFLICT (user_id) DO UPDATE
           SET token_hash = EXCLUDED.token_hash,
               expires_at = EXCLUDED.expires_at,
               attempts = 0,
               last_sent_at = EXCLUDED.last_sent_at
           RETURNING *`,
          [id, userId, tokenHash, expiresAt, now]
        );
        await client.query('COMMIT');
        return insertRes.rows[0];
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
        throw err;
      } finally {
        client.release();
      }
    }

    const existingIdx = memoryStore.email_verification_tokens.findIndex(t => t.user_id === userId);
    if (existingIdx !== -1) {
      const existing = memoryStore.email_verification_tokens[existingIdx];
      if (existing.last_sent_at) {
        const elapsedMs = Date.now() - new Date(existing.last_sent_at).getTime();
        if (elapsedMs < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
          const err = new Error(`Please wait ${remainingSeconds} seconds before requesting a new code.`);
          err.statusCode = 429;
          err.code = 'RESEND_COOLDOWN';
          err.details = { cooldown_seconds: remainingSeconds };
          throw err;
        }
      }
    }

    const tokenRecord = {
      id: existingIdx !== -1 ? memoryStore.email_verification_tokens[existingIdx].id : id,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      attempts: 0,
      last_sent_at: now,
      created_at: existingIdx !== -1 ? memoryStore.email_verification_tokens[existingIdx].created_at : now
    };

    if (existingIdx !== -1) {
      memoryStore.email_verification_tokens[existingIdx] = tokenRecord;
    } else {
      memoryStore.email_verification_tokens.push(tokenRecord);
    }

    return tokenRecord;
  },

  async findByUserId(userId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT * FROM email_verification_tokens WHERE user_id = $1`,
        [userId]
      );
      return res.rows[0] || null;
    }

    return memoryStore.email_verification_tokens.find(t => t.user_id === userId) || null;
  },

  async incrementAttempts(userId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE email_verification_tokens 
         SET attempts = attempts + 1,
             token_hash = CASE WHEN attempts + 1 >= 5 THEN 'INVALIDATED' ELSE token_hash END
         WHERE user_id = $1 
         RETURNING attempts`,
        [userId]
      );
      return res.rows[0]?.attempts || 1;
    }

    const token = memoryStore.email_verification_tokens.find(t => t.user_id === userId);
    if (token) {
      token.attempts = (token.attempts || 0) + 1;
      if (token.attempts >= 5) {
        token.token_hash = 'INVALIDATED';
      }
      return token.attempts;
    }
    return 1;
  },

  async invalidateToken(userId) {
    if (isPostgresConnected && pool) {
      await pool.query(
        `UPDATE email_verification_tokens 
         SET token_hash = 'INVALIDATED', attempts = GREATEST(attempts, 5) 
         WHERE user_id = $1`,
        [userId]
      );
      return true;
    }

    const token = memoryStore.email_verification_tokens.find(t => t.user_id === userId);
    if (token) {
      token.token_hash = 'INVALIDATED';
      token.attempts = Math.max(token.attempts || 0, 5);
      return true;
    }
    return false;
  },

  async deleteByUserId(userId) {
    if (isPostgresConnected && pool) {
      await pool.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
      return true;
    }

    const idx = memoryStore.email_verification_tokens.findIndex(t => t.user_id === userId);
    if (idx !== -1) {
      memoryStore.email_verification_tokens.splice(idx, 1);
      return true;
    }
    return false;
  },

  async consumeTokenAndVerifyUser(userId) {
    const verifiedAt = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tokenRes = await client.query(
          `DELETE FROM email_verification_tokens WHERE user_id = $1 RETURNING *`,
          [userId]
        );
        if (tokenRes.rowCount === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        const userRes = await client.query(
          `UPDATE users 
           SET email_verified = true, email_verified_at = $2
           WHERE id = $1
           RETURNING id, full_name, email, role, email_verified, email_verified_at, created_at`,
          [userId, verifiedAt]
        );
        await client.query('COMMIT');
        return userRes.rows[0] || null;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const idx = memoryStore.email_verification_tokens.findIndex(t => t.user_id === userId);
    if (idx === -1) {
      return null;
    }
    memoryStore.email_verification_tokens.splice(idx, 1);
    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return null;
    user.email_verified = true;
    user.email_verified_at = verifiedAt;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  },

  async cleanExpiredTokens() {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      await pool.query(`DELETE FROM email_verification_tokens WHERE expires_at < $1`, [now]);
    } else {
      memoryStore.email_verification_tokens = memoryStore.email_verification_tokens.filter(
        t => new Date(t.expires_at) >= new Date(now)
      );
    }
  },

  async setTokenExpiredForTest(userId) {
    const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
    if (isPostgresConnected && pool) {
      await pool.query(`UPDATE email_verification_tokens SET expires_at = $1 WHERE user_id = $2`, [expiredAt, userId]);
      return;
    }
    const token = memoryStore.email_verification_tokens.find(t => t.user_id === userId);
    if (token) token.expires_at = expiredAt;
  },

  async setTokenLastSentAtForTest(userId, lastSentAt) {
    if (isPostgresConnected && pool) {
      await pool.query(`UPDATE email_verification_tokens SET last_sent_at = $1 WHERE user_id = $2`, [lastSentAt, userId]);
      return;
    }
    const token = memoryStore.email_verification_tokens.find(t => t.user_id === userId);
    if (token) token.last_sent_at = lastSentAt;
  },

  async clearTokenCooldown(userId) {
    if (isPostgresConnected && pool) {
      await pool.query(`UPDATE email_verification_tokens SET last_sent_at = NULL WHERE user_id = $1`, [userId]);
      return;
    }
    const token = memoryStore.email_verification_tokens.find(t => t.user_id === userId);
    if (token) token.last_sent_at = null;
  },

  async setTokenAttemptsForTest(userId, attempts) {
    if (isPostgresConnected && pool) {
      await pool.query(`UPDATE email_verification_tokens SET attempts = $1 WHERE user_id = $2`, [attempts, userId]);
      return;
    }
    const token = memoryStore.email_verification_tokens.find(t => t.user_id === userId);
    if (token) token.attempts = attempts;
  }
};
