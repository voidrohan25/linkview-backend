import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const courseRepository = {
  async getAll({ search, category, publishedOnly = true } = {}) {
    if (isPostgresConnected && pool) {
      let queryText = `
        SELECT c.*, 
               COUNT(DISTINCT l.id)::int as lessons_count,
               COUNT(DISTINCT e.user_id)::int as students_count
        FROM courses c
        LEFT JOIN lessons l ON c.id = l.course_id
        LEFT JOIN enrollments e ON c.id = e.course_id
        WHERE 1=1
      `;
      const params = [];

      if (publishedOnly) {
        queryText += ' AND c.published = true';
      }
      if (category && category !== 'All') {
        params.push(category);
        queryText += ` AND c.category = $${params.length}`;
      }
      if (search) {
        params.push(`%${search.trim()}%`);
        queryText += ` AND (c.title ILIKE $${params.length} OR c.description ILIKE $${params.length})`;
      }

      queryText += ' GROUP BY c.id ORDER BY c.created_at DESC';
      const res = await pool.query(queryText, params);
      return res.rows;
    }

    return memoryStore.courses
      .filter(c => {
        if (publishedOnly && !c.published) return false;
        if (category && category !== 'All' && c.category.toLowerCase() !== category.toLowerCase()) return false;
        if (search) {
          const q = search.toLowerCase();
          return c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
        }
        return true;
      })
      .map(c => {
        const lessons_count = memoryStore.lessons.filter(l => l.course_id === c.id).length;
        const students_count = memoryStore.enrollments.filter(e => e.course_id === c.id).length;
        return {
          ...c,
          lessons_count,
          students_count
        };
      });
  },

  async getById(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT c.*,
                COUNT(DISTINCT l.id)::int as lessons_count,
                COUNT(DISTINCT e.user_id)::int as students_count
         FROM courses c
         LEFT JOIN lessons l ON c.id = l.course_id
         LEFT JOIN enrollments e ON c.id = e.course_id
         WHERE c.id = $1
         GROUP BY c.id`,
        [id]
      );
      return res.rows[0] || null;
    }

    const c = memoryStore.courses.find(item => item.id === id);
    if (!c) return null;
    const lessons_count = memoryStore.lessons.filter(l => l.course_id === c.id).length;
    const students_count = memoryStore.enrollments.filter(e => e.course_id === c.id).length;
    return {
      ...c,
      lessons_count,
      students_count
    };
  },

  async create(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const title = data.title;
    const description = data.description;
    const category = data.category;
    const thumbnailUrl = data.thumbnailUrl || data.thumbnail_url || null;
    const instructorName = data.instructorName || data.instructor_name || 'LinkTest Faculty';
    const published = data.published !== undefined ? data.published : true;

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO courses (id, title, description, category, thumbnail_url, instructor_name, published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [id, title, description, category, thumbnailUrl, instructorName, published, now, now]
      );
      return res.rows[0];
    }

    const newCourse = {
      id,
      title,
      description,
      category,
      thumbnail_url: thumbnailUrl,
      instructor_name: instructorName,
      published,
      created_at: now,
      updated_at: now,
      lessons_count: 0,
      students_count: 0
    };
    memoryStore.courses.unshift(newCourse);
    return newCourse;
  },

  async update(id, updates) {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      const fields = [];
      const values = [];
      let idx = 1;

      for (const [key, val] of Object.entries(updates)) {
        fields.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
      fields.push(`updated_at = $${idx}`);
      values.push(now);
      idx++;

      values.push(id);
      const res = await pool.query(
        `UPDATE courses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      return res.rows[0] || null;
    }

    const courseIndex = memoryStore.courses.findIndex(c => c.id === id);
    if (courseIndex === -1) return null;
    memoryStore.courses[courseIndex] = {
      ...memoryStore.courses[courseIndex],
      ...updates,
      updated_at: now
    };
    return memoryStore.courses[courseIndex];
  },

  async delete(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING id', [id]);
      return res.rowCount > 0;
    }

    const idx = memoryStore.courses.findIndex(c => c.id === id);
    if (idx === -1) return false;
    memoryStore.courses.splice(idx, 1);
    memoryStore.lessons = memoryStore.lessons.filter(l => l.course_id !== id);
    return true;
  },

  async enroll(userId, courseId) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO enrollments (id, user_id, course_id, enrolled_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, course_id) DO NOTHING
         RETURNING *`,
        [id, userId, courseId, now]
      );
      return res.rows[0] || null;
    }

    const exists = memoryStore.enrollments.some(e => e.user_id === userId && e.course_id === courseId);
    if (!exists) {
      const enrollment = { id, user_id: userId, course_id: courseId, enrolled_at: now };
      memoryStore.enrollments.push(enrollment);
      return enrollment;
    }
    return null;
  },

  async isEnrolled(userId, courseId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        'SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [userId, courseId]
      );
      return res.rowCount > 0;
    }
    return memoryStore.enrollments.some(e => e.user_id === userId && e.course_id === courseId);
  },

  async getEnrolledCoursesForUser(userId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT c.*,
                e.enrolled_at,
                COUNT(DISTINCT l.id)::int as total_lessons,
                COUNT(DISTINCT CASE WHEN lp.completed = true THEN lp.lesson_id END)::int as completed_lessons
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         LEFT JOIN lessons l ON c.id = l.course_id
         LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $1
         WHERE e.user_id = $1
         GROUP BY c.id, e.enrolled_at
         ORDER BY e.enrolled_at DESC`,
        [userId]
      );
      return res.rows.map(row => ({
        ...row,
        progress_percentage: row.total_lessons > 0 
          ? Math.round((row.completed_lessons / row.total_lessons) * 100) 
          : 0
      }));
    }

    const userEnrollments = memoryStore.enrollments.filter(e => e.user_id === userId);
    return userEnrollments.map(e => {
      const course = memoryStore.courses.find(c => c.id === e.course_id);
      const courseLessons = memoryStore.lessons.filter(l => l.course_id === e.course_id);
      const completedCount = courseLessons.filter(l => 
        memoryStore.lesson_progress.some(lp => lp.user_id === userId && lp.lesson_id === l.id && lp.completed)
      ).length;
      const progress_percentage = courseLessons.length > 0
        ? Math.round((completedCount / courseLessons.length) * 100)
        : 0;

      return {
        ...course,
        enrolled_at: e.enrolled_at,
        total_lessons: courseLessons.length,
        completed_lessons: completedCount,
        progress_percentage
      };
    });
  }
};
