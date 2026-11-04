// Coding Submissions & Test Case Repository
// LinkTest Enterprise Examination System

import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const codingRepository = {
  /**
   * Fetch all test cases for a question from coding_test_cases or question JSONB
   */
  async getTestCasesForQuestion(questionId, { includeHidden = true } = {}) {
    let testCases = [];

    if (isPostgresConnected && pool) {
      // 1. Try coding_test_cases table
      const res = await pool.query(
        `SELECT id, question_id, input, expected_output, is_hidden, created_at
         FROM coding_test_cases
         WHERE question_id = $1
         ${includeHidden ? '' : 'AND is_hidden = false'}
         ORDER BY is_hidden ASC, created_at ASC`,
        [questionId]
      );
      if (res.rows && res.rows.length > 0) {
        testCases = res.rows;
      } else {
        // 2. Check mock_test_questions, questions, and question_bank for test_cases JSONB
        const qRes = await pool.query(
          `SELECT test_cases FROM mock_test_questions WHERE id = $1
           UNION ALL
           SELECT test_cases FROM questions WHERE id = $1
           UNION ALL
           SELECT test_cases FROM question_bank WHERE id = $1`,
          [questionId]
        );
        if (qRes.rows && qRes.rows.length > 0 && qRes.rows[0].test_cases) {
          let rawCases = qRes.rows[0].test_cases;
          if (typeof rawCases === 'string') {
            try { rawCases = JSON.parse(rawCases); } catch (_) { rawCases = []; }
          }
          if (Array.isArray(rawCases)) {
            testCases = includeHidden ? rawCases : rawCases.filter(tc => !tc.is_hidden);
          }
        }
      }
    } else {
      // Memory store fallback
      const inMemoryCases = (memoryStore.coding_test_cases || []).filter(
        tc => tc.question_id === questionId && (includeHidden || !tc.is_hidden)
      );
      if (inMemoryCases.length > 0) {
        testCases = inMemoryCases;
      } else {
        const q = (memoryStore.mock_test_questions || []).find(x => x.id === questionId) ||
                  (memoryStore.questions || []).find(x => x.id === questionId) ||
                  (memoryStore.question_bank || []).find(x => x.id === questionId);
        if (q && q.test_cases) {
          const rawCases = typeof q.test_cases === 'string' ? JSON.parse(q.test_cases) : q.test_cases;
          testCases = includeHidden ? rawCases : rawCases.filter(tc => !tc.is_hidden);
        }
      }
    }

    return testCases;
  },

  /**
   * Retrieve question metadata (limits, language, starter code)
   */
  async getQuestionDetails(questionId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT id, question_text, question_type, marks, programming_language, starter_code, time_limit, memory_limit, test_cases
         FROM mock_test_questions WHERE id = $1
         UNION ALL
         SELECT id, question_text, question_type, marks, programming_language, starter_code, time_limit, memory_limit, test_cases
         FROM questions WHERE id = $1
         UNION ALL
         SELECT id, question_text, question_type, marks, programming_language, starter_code, time_limit, memory_limit, test_cases
         FROM question_bank WHERE id = $1`,
        [questionId]
      );
      if (res.rows && res.rows.length > 0) {
        return res.rows[0];
      }
      return null;
    }

    const q = (memoryStore.mock_test_questions || []).find(x => x.id === questionId) ||
              (memoryStore.questions || []).find(x => x.id === questionId) ||
              (memoryStore.question_bank || []).find(x => x.id === questionId);
    return q || null;
  },

  /**
   * Save a student coding submission
   */
  async createSubmission({
    id,
    studentId,
    questionId,
    attemptId,
    programmingLanguage = 'javascript',
    submittedCode,
    executionStatus = 'pending',
    score = 0,
    testCasesPassed = 0,
    totalTestCases = 0,
    executionTimeMs = 0,
    memoryUsageMb = 0,
    errorMessage = null,
    testResults = []
  }) {
    const subId = id || `csub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO coding_submissions (
          id, student_id, question_id, attempt_id, programming_language,
          submitted_code, execution_status, score, test_cases_passed,
          total_test_cases, execution_time_ms, memory_usage_mb,
          error_message, test_results, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
        RETURNING *`,
        [
          subId,
          studentId,
          questionId,
          attemptId || null,
          programmingLanguage,
          submittedCode,
          executionStatus,
          score,
          testCasesPassed,
          totalTestCases,
          executionTimeMs,
          memoryUsageMb,
          errorMessage,
          JSON.stringify(testResults),
          now
        ]
      );
      return res.rows[0];
    }

    const record = {
      id: subId,
      student_id: studentId,
      question_id: questionId,
      attempt_id: attemptId || null,
      programming_language: programmingLanguage,
      submitted_code: submittedCode,
      execution_status: executionStatus,
      score,
      test_cases_passed: testCasesPassed,
      total_test_cases: totalTestCases,
      execution_time_ms: executionTimeMs,
      memory_usage_mb: memoryUsageMb,
      error_message: errorMessage,
      test_results: testResults,
      created_at: now,
      updated_at: now
    };

    memoryStore.coding_submissions = memoryStore.coding_submissions || [];
    memoryStore.coding_submissions.push(record);
    return record;
  },

  /**
   * Get a submission by ID
   */
  async getSubmissionById(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT cs.*, u.full_name as student_name, u.email as student_email
         FROM coding_submissions cs
         LEFT JOIN users u ON cs.student_id = u.id
         WHERE cs.id = $1`,
        [id]
      );
      return res.rows[0] || null;
    }

    return (memoryStore.coding_submissions || []).find(s => s.id === id) || null;
  },

  /**
   * List submissions for a specific question or attempt
   */
  async getSubmissions({ studentId, questionId, attemptId } = {}) {
    if (isPostgresConnected && pool) {
      const conditions = [];
      const values = [];

      if (studentId) {
        values.push(studentId);
        conditions.push(`student_id = $${values.length}`);
      }
      if (questionId) {
        values.push(questionId);
        conditions.push(`question_id = $${values.length}`);
      }
      if (attemptId) {
        values.push(attemptId);
        conditions.push(`attempt_id = $${values.length}`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await pool.query(
        `SELECT cs.*, u.full_name as student_name
         FROM coding_submissions cs
         LEFT JOIN users u ON cs.student_id = u.id
         ${whereClause}
         ORDER BY cs.created_at DESC`,
        values
      );
      return res.rows;
    }

    return (memoryStore.coding_submissions || []).filter(s => {
      if (studentId && s.student_id !== studentId) return false;
      if (questionId && s.question_id !== questionId) return false;
      if (attemptId && s.attempt_id !== attemptId) return false;
      return true;
    });
  }
};
