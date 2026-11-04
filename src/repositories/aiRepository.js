import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const aiRepository = {
  async saveMessage({ userId, conversationId, role, message }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      await pool.query(
        `INSERT INTO ai_chat_messages (id, user_id, conversation_id, role, message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, userId, conversationId, role, message, now]
      );
      return { id, user_id: userId, conversation_id: conversationId, role, message, created_at: now };
    }

    const record = { id, user_id: userId, conversation_id: conversationId, role, message, created_at: now };
    memoryStore.ai_chat_messages.push(record);
    return record;
  },

  async getMessagesByConversation(userId, conversationId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT role, message, created_at
         FROM ai_chat_messages
         WHERE user_id = $1 AND conversation_id = $2
         ORDER BY created_at ASC`,
        [userId, conversationId]
      );
      return res.rows;
    }

    return memoryStore.ai_chat_messages
      .filter(m => m.user_id === userId && m.conversation_id === conversationId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(m => ({ role: m.role, message: m.message, created_at: m.created_at }));
  }
};
