import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const quizRepository = {
  // Public/Student method - SANITIZED: Strips correct_option_index, expected_answer, and hidden test inputs!
  async getQuizForTaker(quizId, { includeAnswerKey = false } = {}) {
    if (isPostgresConnected && pool) {
      const quizRes = await pool.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
      if (quizRes.rows.length === 0) return null;

      const qRes = await pool.query(
        includeAnswerKey
          ? 'SELECT * FROM questions WHERE quiz_id = $1 ORDER BY position ASC'
          : `SELECT id, quiz_id, question_text, options, position,
                    COALESCE(question_type, 'mcq_single') as question_type,
                    COALESCE(marks, 1.00) as marks,
                    starter_code, programming_language, time_limit, memory_limit, test_cases
             FROM questions
             WHERE quiz_id = $1
             ORDER BY position ASC`,
        [quizId]
      );

      const questions = qRes.rows.map(q => {
        if (includeAnswerKey) return q;

        let rawCases = [];
        try {
          rawCases = typeof q.test_cases === 'string' ? JSON.parse(q.test_cases) : (q.test_cases || []);
        } catch { rawCases = []; }

        const safeCases = rawCases.map(tc => {
          if (tc.is_hidden) {
            return { id: tc.id, is_hidden: true };
          }
          return { id: tc.id, input: tc.input, expected_output: tc.expected_output, is_hidden: false };
        });

        return {
          id: q.id,
          quiz_id: q.quiz_id,
          question_text: q.question_text,
          options: q.options,
          position: q.position,
          question_type: q.question_type,
          marks: parseFloat(q.marks || 1.0),
          starter_code: q.starter_code,
          programming_language: q.programming_language || 'javascript',
          time_limit: parseFloat(q.time_limit || 2.0),
          memory_limit: parseInt(q.memory_limit || 128, 10),
          test_cases: safeCases
        };
      });

      return {
        ...quizRes.rows[0],
        questions
      };
    }

    const quiz = memoryStore.quizzes.find(q => q.id === quizId);
    if (!quiz) return null;

    const questions = memoryStore.questions
      .filter(q => q.quiz_id === quizId)
      .sort((a, b) => a.position - b.position)
      .map(q => {
        if (includeAnswerKey) return q;

        const rawCases = Array.isArray(q.test_cases) ? q.test_cases : [];
        const safeCases = rawCases.map(tc => {
          if (tc.is_hidden) {
            return { id: tc.id, is_hidden: true };
          }
          return { id: tc.id, input: tc.input, expected_output: tc.expected_output, is_hidden: false };
        });

        return {
          id: q.id,
          quiz_id: q.quiz_id,
          question_text: q.question_text,
          options: q.options,
          position: q.position,
          question_type: q.question_type || 'mcq_single',
          marks: parseFloat(q.marks || 1.0),
          starter_code: q.starter_code,
          programming_language: q.programming_language || 'javascript',
          time_limit: parseFloat(q.time_limit || 2.0),
          memory_limit: parseInt(q.memory_limit || 128, 10),
          test_cases: safeCases
        };
      });

    return {
      ...quiz,
      questions
    };
  },

  // Internal server-only method - used strictly for scoring calculation
  async getQuizQuestionsInternal(quizId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM questions WHERE quiz_id = $1 ORDER BY position ASC', [quizId]);
      return res.rows;
    }
    return memoryStore.questions
      .filter(q => q.quiz_id === quizId)
      .sort((a, b) => a.position - b.position);
  },

  async getQuizzesByCourseId(courseId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT q.*, COUNT(qu.id)::int as question_count
         FROM quizzes q
         LEFT JOIN questions qu ON q.id = qu.quiz_id
         WHERE q.course_id = $1
         GROUP BY q.id
         ORDER BY q.created_at ASC`,
        [courseId]
      );
      return res.rows;
    }

    return memoryStore.quizzes
      .filter(q => q.course_id === courseId)
      .map(q => ({
        ...q,
        question_count: memoryStore.questions.filter(qu => qu.quiz_id === q.id).length
      }));
  },

  async getAllQuizzes() {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT q.*, c.title as course_title, COUNT(qu.id)::int as question_count
         FROM quizzes q
         JOIN courses c ON q.course_id = c.id
         LEFT JOIN questions qu ON q.id = qu.quiz_id
         GROUP BY q.id, c.title
         ORDER BY q.created_at DESC`
      );
      return res.rows;
    }

    return memoryStore.quizzes.map(q => {
      const c = memoryStore.courses.find(course => course.id === q.course_id);
      return {
        ...q,
        course_title: c ? c.title : 'General',
        question_count: memoryStore.questions.filter(qu => qu.quiz_id === q.id).length
      };
    });
  },

  // Atomic attempt persistence
  async saveAttemptAndAnswers({ userId, quizId, score, totalQuestions, results }) {
    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `INSERT INTO quiz_attempts (id, user_id, quiz_id, score, total_questions, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [attemptId, userId, quizId, score, totalQuestions, now]
        );

        for (const r of results) {
          const ansId = crypto.randomUUID();
          await client.query(
            `INSERT INTO quiz_attempt_answers (
              id, attempt_id, question_id, selected_option_index, is_correct,
              response_text, score_awarded, is_pending_review, evaluation_comment, execution_results
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              ansId,
              attemptId,
              r.question_id,
              r.selected_option_index !== undefined ? r.selected_option_index : -1,
              Boolean(r.is_correct),
              r.response_text || null,
              r.score_awarded !== undefined ? r.score_awarded : (r.is_correct ? 1.0 : 0.0),
              Boolean(r.is_pending_review),
              r.evaluation_comment || null,
              r.execution_results ? JSON.stringify(r.execution_results) : null
            ]
          );
        }

        await client.query('COMMIT');
        return attemptId;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const attempt = {
      id: attemptId,
      user_id: userId,
      quiz_id: quizId,
      score,
      total_questions: totalQuestions,
      submitted_at: now
    };
    memoryStore.quiz_attempts.push(attempt);

    for (const r of results) {
      memoryStore.quiz_attempt_answers.push({
        id: crypto.randomUUID(),
        attempt_id: attemptId,
        question_id: r.question_id,
        selected_option_index: r.selected_option_index !== undefined ? r.selected_option_index : -1,
        is_correct: Boolean(r.is_correct),
        response_text: r.response_text || null,
        score_awarded: r.score_awarded !== undefined ? r.score_awarded : (r.is_correct ? 1.0 : 0.0),
        is_pending_review: Boolean(r.is_pending_review),
        evaluation_comment: r.evaluation_comment || null,
        execution_results: r.execution_results || null
      });
    }

    return attemptId;
  },

  async getAttemptsByUser(userId) {
    return this.getUserAttempts(userId);
  },

  async getUserAttempts(userId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT qa.*, q.title as quiz_title, c.title as course_title
         FROM quiz_attempts qa
         JOIN quizzes q ON qa.quiz_id = q.id
         JOIN courses c ON q.course_id = c.id
         WHERE qa.user_id = $1
         ORDER BY qa.submitted_at DESC`,
        [userId]
      );
      return res.rows;
    }

    return memoryStore.quiz_attempts
      .filter(qa => qa.user_id === userId)
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
      .map(qa => {
        const quiz = memoryStore.quizzes.find(q => q.id === qa.quiz_id);
        const course = quiz ? memoryStore.courses.find(c => c.id === quiz.course_id) : null;
        return {
          ...qa,
          quiz_title: quiz ? quiz.title : 'Assessment',
          course_title: course ? course.title : 'Course'
        };
      });
  },

  async getAttemptDetails(attemptId, userId = null) {
    if (isPostgresConnected && pool) {
      const attParams = userId ? [attemptId, userId] : [attemptId];
      const userCondition = userId ? 'AND qa.user_id = $2' : '';
      const attRes = await pool.query(
        `SELECT qa.*, q.title as quiz_title, q.description as quiz_description
         FROM quiz_attempts qa
         JOIN quizzes q ON qa.quiz_id = q.id
         WHERE qa.id = $1 ${userCondition}`,
        attParams
      );
      if (attRes.rows.length === 0) return null;

      const answersRes = await pool.query(
        `SELECT qaa.id as answer_id, qaa.selected_option_index, qaa.is_correct,
                qaa.response_text, qaa.score_awarded, qaa.is_pending_review,
                qaa.evaluation_comment, qaa.execution_results,
                qu.id as question_id, qu.question_text, qu.options,
                qu.correct_option_index, qu.explanation,
                COALESCE(qu.question_type, 'mcq_single') as question_type,
                COALESCE(qu.marks, 1.00) as marks,
                qu.expected_answer, qu.evaluation_criteria,
                qu.programming_language, qu.starter_code
         FROM quiz_attempt_answers qaa
         JOIN questions qu ON qaa.question_id = qu.id
         WHERE qaa.attempt_id = $1
         ORDER BY qu.position ASC`,
        [attemptId]
      );

      return {
        ...attRes.rows[0],
        results: answersRes.rows
      };
    }

    const att = memoryStore.quiz_attempts.find(a => a.id === attemptId && (!userId || a.user_id === userId));
    if (!att) return null;

    const quiz = memoryStore.quizzes.find(q => q.id === att.quiz_id);
    const answers = memoryStore.quiz_attempt_answers.filter(qaa => qaa.attempt_id === attemptId);

    const results = answers.map(a => {
      const q = memoryStore.questions.find(question => question.id === a.question_id);
      return {
        answer_id: a.id,
        question_id: a.question_id,
        question_text: q ? q.question_text : '',
        options: q ? q.options : [],
        selected_option_index: a.selected_option_index,
        correct_option_index: q ? q.correct_option_index : 0,
        is_correct: a.is_correct,
        explanation: q ? q.explanation : '',
        response_text: a.response_text,
        score_awarded: a.score_awarded,
        is_pending_review: a.is_pending_review,
        evaluation_comment: a.evaluation_comment,
        execution_results: a.execution_results,
        question_type: q ? (q.question_type || 'mcq_single') : 'mcq_single',
        marks: q ? parseFloat(q.marks || 1.0) : 1.0,
        expected_answer: q ? q.expected_answer : null,
        evaluation_criteria: q ? q.evaluation_criteria : null,
        programming_language: q ? q.programming_language : 'javascript',
        starter_code: q ? q.starter_code : null
      };
    });

    return {
      ...att,
      quiz_title: quiz ? quiz.title : 'Assessment',
      quiz_description: quiz ? quiz.description : '',
      results
    };
  },

  async manuallyEvaluateAnswer({ attemptId, questionId, score, comment, evaluatorId }) {
    const now = new Date().toISOString();
    const finalScore = Math.max(0, parseFloat(score) || 0);

    if (isPostgresConnected && pool) {
      await pool.query(
        `UPDATE quiz_attempt_answers
         SET score_awarded = $1,
             evaluation_comment = $2,
             evaluated_by = $3,
             evaluated_at = $4,
             is_pending_review = false,
             is_correct = ($1 > 0)
         WHERE attempt_id = $5 AND question_id = $6`,
        [finalScore, comment || null, evaluatorId || null, now, attemptId, questionId]
      );

      // Recalculate total score
      const sumRes = await pool.query(
        `SELECT COALESCE(SUM(score_awarded), 0)::numeric as total_score
         FROM quiz_attempt_answers
         WHERE attempt_id = $1`,
        [attemptId]
      );
      const newScore = Math.round(parseFloat(sumRes.rows[0].total_score));

      await pool.query(
        `UPDATE quiz_attempts
         SET score = $1
         WHERE id = $2`,
        [newScore, attemptId]
      );

      return this.getAttemptDetails(attemptId);
    }

    const ans = (memoryStore.quiz_attempt_answers || []).find(
      a => a.attempt_id === attemptId && a.question_id === questionId
    );
    if (ans) {
      ans.score_awarded = finalScore;
      ans.evaluation_comment = comment || null;
      ans.evaluated_by = evaluatorId || null;
      ans.evaluated_at = now;
      ans.is_pending_review = false;
      ans.is_correct = finalScore > 0;
    }

    const attempt = (memoryStore.quiz_attempts || []).find(a => a.id === attemptId);
    if (attempt) {
      const allAnswers = (memoryStore.quiz_attempt_answers || []).filter(a => a.attempt_id === attemptId);
      const total = allAnswers.reduce((sum, a) => sum + (parseFloat(a.score_awarded) || 0), 0);
      attempt.score = Math.round(total);
    }

    return this.getAttemptDetails(attemptId);
  },

  async createQuiz({ courseId, title, description, questions = [], teacherId }) {
    const quizId = crypto.randomUUID();
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO quizzes (id, course_id, title, description, teacher_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [quizId, courseId, title, description, teacherId || null, now]
        );

        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          const qId = crypto.randomUUID();
          const qType = String(q.question_type || q.questionType || 'mcq_single').toLowerCase().trim();
          const qMarks = parseFloat(q.marks || 1.0);
          const qExpected = q.expected_answer || q.expectedAnswer || null;
          const qCriteria = q.evaluation_criteria || q.evaluationCriteria || null;
          const qLang = (q.programming_language || q.programmingLanguage || 'javascript').toLowerCase().trim();
          const qStarter = q.starter_code || q.starterCode || null;
          const qTimeLimit = parseFloat(q.time_limit || q.timeLimit || 2.0);
          const qMemLimit = parseInt(q.memory_limit || q.memoryLimit || 128, 10);
          const qTestCases = Array.isArray(q.test_cases || q.testCases) ? (q.test_cases || q.testCases) : [];

          await client.query(
            `INSERT INTO questions (
              id, quiz_id, question_text, options, correct_option_index, explanation, position,
              question_type, marks, expected_answer, evaluation_criteria,
              programming_language, starter_code, time_limit, memory_limit, test_cases
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              qId, quizId, q.question_text, JSON.stringify(q.options || []), q.correct_option_index || 0,
              q.explanation || '', i + 1, qType, qMarks, qExpected, qCriteria,
              qLang, qStarter, qTimeLimit, qMemLimit, JSON.stringify(qTestCases)
            ]
          );

          if (qTestCases.length > 0) {
            for (const tc of qTestCases) {
              const tcId = tc.id || `tc-${crypto.randomUUID()}`;
              await client.query(
                `INSERT INTO coding_test_cases (id, question_id, input, expected_output, is_hidden, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id) DO NOTHING`,
                [tcId, qId, tc.input || '', tc.expected_output || '', Boolean(tc.is_hidden), now]
              );
            }
          }
        }

        await client.query('COMMIT');
        return { id: quizId, course_id: courseId, title, description, teacher_id: teacherId || null };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const newQuiz = { id: quizId, course_id: courseId, title, description, teacher_id: teacherId || null, created_at: now };
    memoryStore.quizzes.push(newQuiz);

    questions.forEach((q, idx) => {
      const qId = crypto.randomUUID();
      const qType = String(q.question_type || q.questionType || 'mcq_single').toLowerCase().trim();
      const qTestCases = Array.isArray(q.test_cases || q.testCases) ? (q.test_cases || q.testCases) : [];

      memoryStore.questions.push({
        id: qId,
        quiz_id: quizId,
        question_text: q.question_text,
        options: q.options || [],
        correct_option_index: q.correct_option_index || 0,
        explanation: q.explanation || '',
        position: idx + 1,
        question_type: qType,
        marks: parseFloat(q.marks || 1.0),
        expected_answer: q.expected_answer || q.expectedAnswer || null,
        evaluation_criteria: q.evaluation_criteria || q.evaluationCriteria || null,
        programming_language: q.programming_language || q.programmingLanguage || 'javascript',
        starter_code: q.starter_code || q.starterCode || null,
        time_limit: parseFloat(q.time_limit || q.timeLimit || 2.0),
        memory_limit: parseInt(q.memory_limit || q.memoryLimit || 128, 10),
        test_cases: qTestCases
      });

      if (qTestCases.length > 0) {
        qTestCases.forEach(tc => {
          memoryStore.coding_test_cases.push({
            id: tc.id || `tc-${crypto.randomUUID()}`,
            question_id: qId,
            input: tc.input || '',
            expected_output: tc.expected_output || '',
            is_hidden: Boolean(tc.is_hidden),
            created_at: now
          });
        });
      }
    });

    return newQuiz;
  }
};
