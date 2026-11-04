import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const progressRepository = {
  async setProgress(userId, lessonId, completed) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      await pool.query(
        `INSERT INTO lesson_progress (id, user_id, lesson_id, completed, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, lesson_id)
         DO UPDATE SET completed = $4, updated_at = $5`,
        [id, userId, lessonId, completed, now]
      );

      // Fetch lesson's course_id
      const lessonRes = await pool.query('SELECT course_id FROM lessons WHERE id = $1', [lessonId]);
      if (lessonRes.rows.length === 0) {
        return { lesson_id: lessonId, completed, course_id: null, course_progress_percentage: 0 };
      }
      const courseId = lessonRes.rows[0].course_id;

      // Calculate progress percentage
      const statsRes = await pool.query(
        `SELECT COUNT(DISTINCT l.id)::int as total,
                COUNT(DISTINCT CASE WHEN lp.completed = true THEN lp.lesson_id END)::int as completed
         FROM lessons l
         LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $2
         WHERE l.course_id = $1`,
        [courseId, userId]
      );

      const total = statsRes.rows[0]?.total || 0;
      const completedCount = statsRes.rows[0]?.completed || 0;
      const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

      return {
        lesson_id: lessonId,
        completed,
        course_id: courseId,
        course_progress_percentage: pct
      };
    }

    const existingIdx = memoryStore.lesson_progress.findIndex(lp => lp.user_id === userId && lp.lesson_id === lessonId);
    if (existingIdx !== -1) {
      memoryStore.lesson_progress[existingIdx].completed = completed;
      memoryStore.lesson_progress[existingIdx].updated_at = now;
    } else {
      memoryStore.lesson_progress.push({
        id,
        user_id: userId,
        lesson_id: lessonId,
        completed,
        updated_at: now
      });
    }

    const lesson = memoryStore.lessons.find(l => l.id === lessonId);
    const courseId = lesson ? lesson.course_id : null;
    let pct = 0;

    if (courseId) {
      const courseLessons = memoryStore.lessons.filter(l => l.course_id === courseId);
      const done = courseLessons.filter(l =>
        memoryStore.lesson_progress.some(lp => lp.user_id === userId && lp.lesson_id === l.id && lp.completed)
      ).length;
      pct = courseLessons.length > 0 ? Math.round((done / courseLessons.length) * 100) : 0;
    }

    return {
      lesson_id: lessonId,
      completed,
      course_id: courseId,
      course_progress_percentage: pct
    };
  },

  async getUserProgressSummary(userId) {
    if (isPostgresConnected && pool) {
      const coursesRes = await pool.query(
        `SELECT COUNT(DISTINCT e.course_id)::int as enrolled_courses,
                COUNT(DISTINCT CASE WHEN lp.completed = true THEN lp.lesson_id END)::int as completed_lessons
         FROM enrollments e
         LEFT JOIN lessons l ON e.course_id = l.course_id
         LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = $1
         WHERE e.user_id = $1`,
        [userId]
      );

      const quizzesRes = await pool.query(
        `SELECT COUNT(*)::int as attempts_count,
                COALESCE(AVG(score::float / NULLIF(total_questions, 0) * 100), 0)::int as avg_score_pct
         FROM quiz_attempts
         WHERE user_id = $1`,
        [userId]
      );

      return {
        enrolled_courses: coursesRes.rows[0]?.enrolled_courses || 0,
        completed_lessons: coursesRes.rows[0]?.completed_lessons || 0,
        quiz_attempts: quizzesRes.rows[0]?.attempts_count || 0,
        avg_quiz_score: quizzesRes.rows[0]?.avg_score_pct || 0
      };
    }

    const enrolled = memoryStore.enrollments.filter(e => e.user_id === userId).length;
    const completedLessons = memoryStore.lesson_progress.filter(lp => lp.user_id === userId && lp.completed).length;
    const userAttempts = memoryStore.quiz_attempts.filter(qa => qa.user_id === userId);
    const avgScore = userAttempts.length > 0
      ? Math.round(userAttempts.reduce((acc, curr) => acc + (curr.score / curr.total_questions) * 100, 0) / userAttempts.length)
      : 0;

    return {
      enrolled_courses: enrolled,
      completed_lessons: completedLessons,
      quiz_attempts: userAttempts.length,
      avg_quiz_score: avgScore
    };
  },

  async getOverallProgress(userId) {
    return this.getUserProgressSummary(userId);
  }
};
