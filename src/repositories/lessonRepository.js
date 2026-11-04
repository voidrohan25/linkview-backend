import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const lessonRepository = {
  async getByCourseId(courseId, userId = null) {
    if (isPostgresConnected && pool) {
      if (userId) {
        const res = await pool.query(
          `SELECT l.*, COALESCE(lp.completed, false) as completed
           FROM lessons l
           LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $2
           WHERE l.course_id = $1
           ORDER BY l.position ASC, l.created_at ASC`,
          [courseId, userId]
        );
        return res.rows;
      }

      const res = await pool.query(
        `SELECT l.*, false as completed
         FROM lessons l
         WHERE l.course_id = $1
         ORDER BY l.position ASC, l.created_at ASC`,
        [courseId]
      );
      return res.rows;
    }

    return memoryStore.lessons
      .filter(l => l.course_id === courseId)
      .sort((a, b) => a.position - b.position)
      .map(l => {
        let completed = false;
        if (userId) {
          const p = memoryStore.lesson_progress.find(lp => lp.user_id === userId && lp.lesson_id === l.id);
          completed = p ? p.completed : false;
        }
        return { ...l, completed };
      });
  },

  async getById(id, userId = null) {
    if (isPostgresConnected && pool) {
      if (userId) {
        const res = await pool.query(
          `SELECT l.*, COALESCE(lp.completed, false) as completed
           FROM lessons l
           LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $2
           WHERE l.id = $1`,
          [id, userId]
        );
        return res.rows[0] || null;
      }
      const res = await pool.query('SELECT l.*, false as completed FROM lessons l WHERE l.id = $1', [id]);
      return res.rows[0] || null;
    }

    const lesson = memoryStore.lessons.find(l => l.id === id);
    if (!lesson) return null;
    let completed = false;
    if (userId) {
      const p = memoryStore.lesson_progress.find(lp => lp.user_id === userId && lp.lesson_id === id);
      completed = p ? p.completed : false;
    }
    return { ...lesson, completed };
  },

  async create({ courseId, title, content, videoUrl, position = 1 }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO lessons (id, course_id, title, content, video_url, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, courseId, title, content, videoUrl || '', position, now]
      );
      return res.rows[0];
    }

    const newLesson = {
      id,
      course_id: courseId,
      title,
      content,
      video_url: videoUrl || '',
      position,
      created_at: now
    };
    memoryStore.lessons.push(newLesson);
    return newLesson;
  },

  async update(id, updates) {
    if (isPostgresConnected && pool) {
      const fields = [];
      const values = [];
      let idx = 1;
      for (const [key, val] of Object.entries(updates)) {
        fields.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
      values.push(id);
      const res = await pool.query(
        `UPDATE lessons SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      return res.rows[0] || null;
    }

    const idx = memoryStore.lessons.findIndex(l => l.id === id);
    if (idx === -1) return null;
    memoryStore.lessons[idx] = { ...memoryStore.lessons[idx], ...updates };
    return memoryStore.lessons[idx];
  },

  async delete(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('DELETE FROM lessons WHERE id = $1 RETURNING id', [id]);
      return res.rowCount > 0;
    }
    const idx = memoryStore.lessons.findIndex(l => l.id === id);
    if (idx === -1) return false;
    memoryStore.lessons.splice(idx, 1);
    return true;
  }
};
