// Mock Test Database Repository (Dual-Mode: PostgreSQL & InMemoryStore)
// LinkTest Enterprise Examination System

import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import { mockTestScoringService } from '../services/mockTestScoringService.js';
import { recordAuditLog } from './auditRepository.js';
import crypto from 'crypto';

export const mockTestRepository = {
  // ---------------------------------------------------------------------------
  // 1. MOCK TEST CRUD & DISCOVERY
  // ---------------------------------------------------------------------------

  async getAllTests(filters = {}) {
    const { status, subject, category, difficulty, search, created_by } = filters;

    if (isPostgresConnected && pool) {
      let query = 'SELECT * FROM mock_tests WHERE 1=1';
      const params = [];

      if (status) {
        params.push(status);
        query += ` AND status = $${params.length}`;
      }
      if (subject) {
        params.push(subject);
        query += ` AND subject = $${params.length}`;
      }
      if (category) {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      if (difficulty) {
        params.push(difficulty);
        query += ` AND difficulty = $${params.length}`;
      }
      if (created_by) {
        params.push(created_by);
        query += ` AND created_by = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length} OR subject ILIKE $${params.length})`;
      }

      query += ' ORDER BY created_at DESC';
      const res = await pool.query(query, params);
      return res.rows;
    }

    // In-memory fallback
    let tests = [...(memoryStore.mock_tests || [])];
    if (status) tests = tests.filter(t => t.status === status);
    if (subject) tests = tests.filter(t => t.subject === subject);
    if (category) tests = tests.filter(t => t.category === category);
    if (difficulty) tests = tests.filter(t => t.difficulty === difficulty);
    if (created_by) tests = tests.filter(t => t.created_by === created_by);
    if (search) {
      const q = search.toLowerCase();
      tests = tests.filter(t =>
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.subject && t.subject.toLowerCase().includes(q))
      );
    }
    return tests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async getTestById(id) {
    if (isPostgresConnected && pool) {
      const testRes = await pool.query('SELECT * FROM mock_tests WHERE id = $1', [id]);
      if (testRes.rows.length === 0) return null;

      const test = testRes.rows[0];
      const questionsRes = await pool.query(
        'SELECT * FROM mock_test_questions WHERE test_id = $1 ORDER BY order_index ASC',
        [id]
      );
      const sectionsRes = await pool.query(
        'SELECT * FROM mock_test_sections WHERE test_id = $1 ORDER BY order_index ASC',
        [id]
      );

      return {
        ...test,
        sections: sectionsRes.rows,
        questions: questionsRes.rows
      };
    }

    // In-memory fallback
    const test = (memoryStore.mock_tests || []).find(t => t.id === id);
    if (!test) return null;

    const sections = (memoryStore.mock_test_sections || []).filter(s => s.test_id === id);
    const questions = (memoryStore.mock_test_questions || [])
      .filter(q => q.test_id === id)
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    return {
      ...test,
      sections,
      questions
    };
  },

  async getQuestionById(questionId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM mock_test_questions WHERE id = $1', [questionId]);
      return res.rows[0] || null;
    }
    return (memoryStore.mock_test_questions || []).find(q => q.id === questionId) || null;
  },

  async createTest(testData, questions = [], sections = []) {
    const testId = testData.id || `mock-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    const validDiffs = ['beginner', 'easy', 'medium', 'hard', 'advanced'];
    const rawDiff = String(testData.difficulty || 'medium').toLowerCase();
    const cleanDiff = validDiffs.includes(rawDiff) ? rawDiff : 'medium';

    const validCats = ['mock_exam', 'practice', 'ai_generated', 'interview_prep', 'subject_test', 'certification'];
    const rawCat = String(testData.category || 'mock_exam').toLowerCase();
    const cleanCat = validCats.includes(rawCat) ? rawCat : 'mock_exam';

    const fullTestData = {
      id: testId,
      title: testData.title,
      description: testData.description || '',
      instructions: testData.instructions || '',
      subject: testData.subject || 'General Studies',
      topic: testData.topic || null,
      difficulty: cleanDiff,
      category: cleanCat,
      tags: testData.tags || [],
      created_by: testData.created_by || null,
      class_id: testData.class_id || null,
      batch_id: testData.batch_id || null,
      course_id: testData.course_id || null,
      scheduled_start: testData.scheduled_start || null,
      scheduled_end: testData.scheduled_end || null,
      duration_minutes: parseInt(testData.duration_minutes || 60, 10),
      total_marks: parseFloat(testData.total_marks || (questions.length * 4)),
      pass_percentage: parseFloat(testData.pass_percentage || 40),
      max_attempts: parseInt(testData.max_attempts || 1, 10),
      randomize_questions: testData.randomize_questions !== false,
      randomize_options: testData.randomize_options !== false,
      negative_marking: testData.negative_marking !== false,
      negative_mark_penalty: parseFloat(testData.negative_mark_penalty || 0.25),
      proctoring_config: testData.proctoring_config || {
        webcam_required: true,
        face_detection: true,
        multi_face_warning: true,
        face_absence_warning: true,
        fullscreen_required: true,
        tab_switch_warning: true,
        audio_check_required: false,
        max_warnings: 5
      },
      status: testData.status || 'draft',
      results_published: Boolean(testData.results_published),
      allow_instant_result: testData.allow_instant_result !== false,
      show_explanations: testData.show_explanations !== false,
      created_at: now,
      updated_at: now
    };

    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO mock_tests (
            id, title, description, instructions, subject, topic, difficulty, category, tags,
            created_by, class_id, batch_id, course_id, scheduled_start, scheduled_end,
            duration_minutes, total_marks, pass_percentage, max_attempts, randomize_questions,
            randomize_options, negative_marking, negative_mark_penalty, proctoring_config,
            status, results_published, allow_instant_result, show_explanations, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
          [
            fullTestData.id, fullTestData.title, fullTestData.description, fullTestData.instructions,
            fullTestData.subject, fullTestData.topic, fullTestData.difficulty, fullTestData.category,
            JSON.stringify(fullTestData.tags), fullTestData.created_by, fullTestData.class_id,
            fullTestData.batch_id, fullTestData.course_id, fullTestData.scheduled_start, fullTestData.scheduled_end,
            fullTestData.duration_minutes, fullTestData.total_marks, fullTestData.pass_percentage,
            fullTestData.max_attempts, fullTestData.randomize_questions, fullTestData.randomize_options,
            fullTestData.negative_marking, fullTestData.negative_mark_penalty,
            JSON.stringify(fullTestData.proctoring_config), fullTestData.status, fullTestData.results_published,
            fullTestData.allow_instant_result, fullTestData.show_explanations, fullTestData.created_at, fullTestData.updated_at
          ]
        );

        // Insert questions
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          const qId = q.id || `q-${crypto.randomUUID().slice(0, 12)}`;

          const rawQType = String(q.question_type || 'mcq_single').toLowerCase().trim();
          const cleanQType = rawQType === 'mcq_multi' ? 'mcq_multiple' : rawQType;
          const cleanAnswerKey = q.answer_key
            || (typeof q.correct_answer === 'object' && q.correct_answer !== null ? q.correct_answer : (q.correct_answer !== undefined ? { correct_answer: q.correct_answer, selected: q.correct_answer } : (q.correct_option_index !== undefined ? { correct_index: q.correct_option_index } : {})));
          const cleanNegMarks = parseFloat(q.negative_marks !== undefined ? q.negative_marks : (q.penalty_marks !== undefined ? q.penalty_marks : 0));

          const qExpected = q.expected_answer || q.expectedAnswer || null;
          const qCriteria = q.evaluation_criteria || q.evaluationCriteria || null;
          const qLang = (q.programming_language || q.programmingLanguage || 'javascript').toLowerCase().trim();
          const qStarter = q.starter_code || q.starterCode || null;
          const qTimeLimit = parseFloat(q.time_limit || q.timeLimit || 2.0);
          const qMemLimit = parseInt(q.memory_limit || q.memoryLimit || 128, 10);
          const qTestCases = Array.isArray(q.test_cases || q.testCases) ? (q.test_cases || q.testCases) : [];

          await client.query(
            `INSERT INTO mock_test_questions (
              id, test_id, section_id, question_text, question_type, options, answer_key,
              marks, negative_marks, explanation, topic, difficulty, order_index, case_passage,
              image_url, metadata, created_at,
              expected_answer, evaluation_criteria, programming_language, starter_code,
              time_limit, memory_limit, test_cases
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
            [
              qId, testId, q.section_id || null, q.question_text, cleanQType,
              JSON.stringify(q.options || []), JSON.stringify(cleanAnswerKey),
              parseFloat(q.marks || 4.0), cleanNegMarks,
              q.explanation || '', q.topic || fullTestData.topic || '', q.difficulty || fullTestData.difficulty || 'medium',
              q.order_index || (i + 1), q.case_passage || null, q.image_url || null,
              JSON.stringify(q.metadata || {}), now,
              qExpected, qCriteria, qLang, qStarter, qTimeLimit, qMemLimit, JSON.stringify(qTestCases)
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
        return this.getTestById(testId);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // In-memory fallback
    memoryStore.mock_tests = memoryStore.mock_tests || [];
    memoryStore.mock_test_questions = memoryStore.mock_test_questions || [];

    memoryStore.mock_tests.push(fullTestData);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qId = q.id || `q-${crypto.randomUUID().slice(0, 12)}`;
      const rawQType = String(q.question_type || 'mcq_single').toLowerCase().trim();
      const cleanQType = rawQType === 'mcq_multi' ? 'mcq_multiple' : rawQType;
      const cleanAnswerKey = q.answer_key
        || (typeof q.correct_answer === 'object' && q.correct_answer !== null ? q.correct_answer : (q.correct_answer !== undefined ? { correct_answer: q.correct_answer, selected: q.correct_answer } : (q.correct_option_index !== undefined ? { correct_index: q.correct_option_index } : {})));
      const cleanNegMarks = parseFloat(q.negative_marks !== undefined ? q.negative_marks : (q.penalty_marks !== undefined ? q.penalty_marks : 0));
      const qTestCases = Array.isArray(q.test_cases || q.testCases) ? (q.test_cases || q.testCases) : [];

      memoryStore.mock_test_questions.push({
        ...q,
        id: qId,
        test_id: testId,
        question_type: cleanQType,
        answer_key: cleanAnswerKey,
        negative_marks: cleanNegMarks,
        order_index: q.order_index || (i + 1),
        expected_answer: q.expected_answer || q.expectedAnswer || null,
        evaluation_criteria: q.evaluation_criteria || q.evaluationCriteria || null,
        programming_language: q.programming_language || q.programmingLanguage || 'javascript',
        starter_code: q.starter_code || q.starterCode || null,
        time_limit: parseFloat(q.time_limit || q.timeLimit || 2.0),
        memory_limit: parseInt(q.memory_limit || q.memoryLimit || 128, 10),
        test_cases: qTestCases,
        created_at: now
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
    }

    return this.getTestById(testId);
  },

  async updateTest(id, updateData) {
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const current = await pool.query('SELECT * FROM mock_tests WHERE id = $1', [id]);
      if (current.rows.length === 0) return null;

      const fields = [];
      const values = [];

      const allowedFields = [
        'title', 'description', 'instructions', 'subject', 'topic', 'difficulty',
        'category', 'tags', 'scheduled_start', 'scheduled_end', 'duration_minutes',
        'total_marks', 'pass_percentage', 'max_attempts', 'randomize_questions',
        'randomize_options', 'negative_marking', 'negative_mark_penalty',
        'proctoring_config', 'status', 'results_published', 'allow_instant_result',
        'show_explanations', 'class_id', 'batch_id', 'course_id'
      ];

      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          values.push(
            ['tags', 'proctoring_config'].includes(field)
              ? JSON.stringify(updateData[field])
              : updateData[field]
          );
          fields.push(`${field} = $${values.length}`);
        }
      }

      values.push(now);
      fields.push(`updated_at = $${values.length}`);
      values.push(id);

      const q = `UPDATE mock_tests SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`;
      const res = await pool.query(q, values);
      return res.rows[0];
    }

    // In-memory fallback
    const idx = (memoryStore.mock_tests || []).findIndex(t => t.id === id);
    if (idx === -1) return null;

    memoryStore.mock_tests[idx] = {
      ...memoryStore.mock_tests[idx],
      ...updateData,
      updated_at: now
    };
    return memoryStore.mock_tests[idx];
  },

  async deleteTest(id) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('DELETE FROM mock_tests WHERE id = $1 RETURNING id', [id]);
      return res.rows.length > 0;
    }

    const idx = (memoryStore.mock_tests || []).findIndex(t => t.id === id);
    if (idx !== -1) {
      memoryStore.mock_tests.splice(idx, 1);
      memoryStore.mock_test_questions = (memoryStore.mock_test_questions || []).filter(q => q.test_id !== id);
      memoryStore.mock_test_attempts = (memoryStore.mock_test_attempts || []).filter(a => a.test_id !== id);
      return true;
    }
    return false;
  },

  async duplicateTest(id, newTeacherId) {
    const existing = await this.getTestById(id);
    if (!existing) return null;

    const clonedTestData = {
      ...existing,
      id: `mock-${crypto.randomUUID().slice(0, 12)}`,
      title: `${existing.title} (Copy)`,
      created_by: newTeacherId || existing.created_by,
      status: 'draft',
      results_published: false
    };

    delete clonedTestData.created_at;
    delete clonedTestData.updated_at;

    const clonedQuestions = (existing.questions || []).map(q => {
      const qCopy = { ...q };
      delete qCopy.id;
      delete qCopy.test_id;
      return qCopy;
    });

    return this.createTest(clonedTestData, clonedQuestions, existing.sections);
  },

  // ---------------------------------------------------------------------------
  // 2. QUESTIONS MANAGEMENT
  // ---------------------------------------------------------------------------

  async getQuestionsByTestId(testId, options = { sanitize: false }) {
    let rawQuestions = [];

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        'SELECT * FROM mock_test_questions WHERE test_id = $1 ORDER BY order_index ASC',
        [testId]
      );
      rawQuestions = res.rows;
    } else {
      rawQuestions = (memoryStore.mock_test_questions || [])
        .filter(q => q.test_id === testId)
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    }

    const questions = rawQuestions.map(q => {
      let opts = q.options;
      if (typeof opts === 'string') {
        try { opts = JSON.parse(opts); } catch { }
      }
      let ansKey = q.answer_key;
      if (typeof ansKey === 'string') {
        try { ansKey = JSON.parse(ansKey); } catch { }
      }
      let testCases = q.test_cases;
      if (typeof testCases === 'string') {
        try { testCases = JSON.parse(testCases); } catch { }
      }
      return {
        ...q,
        options: opts,
        answer_key: ansKey,
        test_cases: testCases
      };
    });

    if (options.sanitize) {
      return mockTestScoringService.sanitizeQuestionsForTaker(questions);
    }
    return questions;
  },

  async addQuestionsToTest(testId, questions) {
    const now = new Date().toISOString();
    const created = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qId = q.id || `q-${crypto.randomUUID().slice(0, 12)}`;
      const qType = String(q.question_type || q.questionType || 'mcq_single').toLowerCase().trim();
      const qExpected = q.expected_answer || q.expectedAnswer || null;
      const qCriteria = q.evaluation_criteria || q.evaluationCriteria || null;
      const qLang = (q.programming_language || q.programmingLanguage || 'javascript').toLowerCase().trim();
      const qStarter = q.starter_code || q.starterCode || null;
      const qTimeLimit = parseFloat(q.time_limit || q.timeLimit || 2.0);
      const qMemLimit = parseInt(q.memory_limit || q.memoryLimit || 128, 10);
      const cleanAnswerKey = q.answer_key
        || (typeof q.correct_answer === 'object' && q.correct_answer !== null ? q.correct_answer : (q.correct_answer !== undefined ? { correct_answer: q.correct_answer, selected: q.correct_answer } : (q.correct_option_index !== undefined ? { correct_index: q.correct_option_index } : {})));

      if (isPostgresConnected && pool) {
        const res = await pool.query(
          `INSERT INTO mock_test_questions (
            id, test_id, section_id, question_text, question_type, options, answer_key,
            marks, negative_marks, explanation, topic, difficulty, order_index, case_passage,
            image_url, metadata, created_at,
            expected_answer, evaluation_criteria, programming_language, starter_code,
            time_limit, memory_limit, test_cases
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
          RETURNING *`,
          [
            qId, testId, q.section_id || null, q.question_text, qType,
            JSON.stringify(q.options || []), JSON.stringify(cleanAnswerKey),
            parseFloat(q.marks || 4.0), parseFloat(q.negative_marks || 1.0),
            q.explanation || '', q.topic || '', q.difficulty || 'medium',
            q.order_index || (i + 1), q.case_passage || null, q.image_url || null,
            JSON.stringify(q.metadata || {}), now,
            qExpected, qCriteria, qLang, qStarter, qTimeLimit, qMemLimit, JSON.stringify(qTestCases)
          ]
        );

        if (qTestCases.length > 0) {
          for (const tc of qTestCases) {
            const tcId = tc.id || `tc-${crypto.randomUUID()}`;
            await pool.query(
              `INSERT INTO coding_test_cases (id, question_id, input, expected_output, is_hidden, created_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (id) DO NOTHING`,
              [tcId, qId, tc.input || '', tc.expected_output || '', Boolean(tc.is_hidden), now]
            );
          }
        }

        created.push(res.rows[0]);
      } else {
        const record = {
          ...q,
          id: qId,
          test_id: testId,
          question_type: qType,
          answer_key: cleanAnswerKey,
          order_index: q.order_index || (i + 1),
          expected_answer: qExpected,
          evaluation_criteria: qCriteria,
          programming_language: qLang,
          starter_code: qStarter,
          time_limit: qTimeLimit,
          memory_limit: qMemLimit,
          test_cases: qTestCases,
          created_at: now
        };
        memoryStore.mock_test_questions.push(record);

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

        created.push(record);
      }
    }
    return created;
  },

  // ---------------------------------------------------------------------------
  // 3. ATTEMPTS & RESPONSES
  // ---------------------------------------------------------------------------

  async getAttemptById(attemptId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT * FROM mock_test_attempts WHERE id = $1', [attemptId]);
      if (res.rows.length === 0) return null;

      const attempt = res.rows[0];
      const respRes = await pool.query(
        'SELECT * FROM mock_test_responses WHERE attempt_id = $1',
        [attemptId]
      );
      return {
        ...attempt,
        responses: respRes.rows
      };
    }

    const attempt = (memoryStore.mock_test_attempts || []).find(a => a.id === attemptId);
    if (!attempt) return null;

    const responses = (memoryStore.mock_test_responses || []).filter(r => r.attempt_id === attemptId);
    return {
      ...attempt,
      responses
    };
  },

  async getAttemptsByStudent(studentId, testId = null) {
    if (isPostgresConnected && pool) {
      let q = `
        SELECT a.*, t.title as test_title, t.subject, t.duration_minutes, t.pass_percentage, t.results_published
        FROM mock_test_attempts a
        JOIN mock_tests t ON a.test_id = t.id
        WHERE a.student_id = $1
      `;
      const params = [studentId];
      if (testId) {
        params.push(testId);
        q += ` AND a.test_id = $2`;
      }
      q += ' ORDER BY a.started_at DESC';
      const res = await pool.query(q, params);
      return res.rows;
    }

    let attempts = (memoryStore.mock_test_attempts || []).filter(a => a.student_id === studentId);
    if (testId) attempts = attempts.filter(a => a.test_id === testId);

    return attempts.map(a => {
      const t = (memoryStore.mock_tests || []).find(test => test.id === a.test_id) || {};
      return {
        ...a,
        test_title: t.title,
        subject: t.subject,
        duration_minutes: t.duration_minutes,
        pass_percentage: t.pass_percentage,
        results_published: t.results_published
      };
    }).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  },

  async getAttemptsByTest(testId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `SELECT a.*, u.full_name as student_name, u.email as student_email
         FROM mock_test_attempts a
         JOIN users u ON a.student_id = u.id
         WHERE a.test_id = $1
         ORDER BY a.started_at DESC`,
        [testId]
      );
      return res.rows;
    }

    const attempts = (memoryStore.mock_test_attempts || []).filter(a => a.test_id === testId);
    return attempts.map(a => {
      const u = (memoryStore.users || []).find(user => user.id === a.student_id) || {};
      return {
        ...a,
        student_name: u.full_name || 'Student',
        student_email: u.email || ''
      };
    }).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  },

  async createAttempt(attemptData) {
    const attemptId = attemptData.id || `att-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    const record = {
      id: attemptId,
      test_id: attemptData.test_id,
      student_id: attemptData.student_id,
      started_at: attemptData.started_at || now,
      expires_at: attemptData.expires_at,
      submitted_at: null,
      status: 'in_progress',
      total_score: 0.00,
      max_score: parseFloat(attemptData.max_score || 0),
      percentage: 0.00,
      passed: false,
      correct_count: 0,
      incorrect_count: 0,
      unanswered_count: 0,
      time_spent_seconds: 0,
      warning_count: 0,
      security_warning_count: 0,
      fullscreen_exit_count: 0,
      integrity_trust_index: 100,
      disqualified: false,
      submission_status: null,
      submission_reason: null,
      test_snapshot: attemptData.test_snapshot || {},
      proctoring_summary: {
        face_absence_events: 0,
        multiple_face_events: 0,
        tab_switch_events: 0,
        fullscreen_exit_events: 0,
        camera_disconnect_events: 0,
        total_events: 0,
        integrity_trust_index: 100,
        flagged: false
      },
      evaluator_remarks: null,
      evaluated_by: null,
      evaluated_at: null,
      result_status: attemptData.result_status || 'PENDING_EVALUATION',
      released_at: attemptData.released_at || null,
      released_by: attemptData.released_by || null,
      created_at: now,
      updated_at: now
    };

    if (isPostgresConnected && pool) {
      await pool.query(
        `INSERT INTO mock_test_attempts (
          id, test_id, student_id, started_at, expires_at, status, total_score, max_score,
          percentage, passed, correct_count, incorrect_count, unanswered_count, time_spent_seconds,
          warning_count, security_warning_count, fullscreen_exit_count, submission_status, submission_reason,
          result_status, released_at, released_by,
          test_snapshot, proctoring_summary, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
          record.id, record.test_id, record.student_id, record.started_at, record.expires_at,
          record.status, record.total_score, record.max_score, record.percentage, record.passed,
          record.correct_count, record.incorrect_count, record.unanswered_count, record.time_spent_seconds,
          record.warning_count, record.security_warning_count, record.fullscreen_exit_count,
          record.submission_status, record.submission_reason,
          record.result_status, record.released_at, record.released_by,
          JSON.stringify(record.test_snapshot), JSON.stringify(record.proctoring_summary),
          record.created_at, record.updated_at
        ]
      );
      return this.getAttemptById(attemptId);
    }

    memoryStore.mock_test_attempts = memoryStore.mock_test_attempts || [];
    memoryStore.mock_test_attempts.push(record);
    return record;
  },

  async updateAttempt(attemptId, updateData) {
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const allowed = [
        'submitted_at', 'status', 'total_score', 'max_score', 'percentage', 'passed',
        'correct_count', 'incorrect_count', 'unanswered_count', 'time_spent_seconds',
        'warning_count', 'security_warning_count', 'fullscreen_exit_count',
        'integrity_trust_index', 'disqualified',
        'submission_status', 'submission_reason',
        'result_status', 'released_at', 'released_by',
        'proctoring_summary', 'evaluator_remarks', 'evaluated_by', 'evaluated_at'
      ];
      const fields = [];
      const values = [];

      for (const key of allowed) {
        if (updateData[key] !== undefined) {
          values.push(key === 'proctoring_summary' ? JSON.stringify(updateData[key]) : updateData[key]);
          fields.push(`${key} = $${values.length}`);
        }
      }
      values.push(now);
      fields.push(`updated_at = $${values.length}`);
      values.push(attemptId);

      const q = `UPDATE mock_test_attempts SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`;
      const res = await pool.query(q, values);
      return res.rows[0];
    }

    const idx = (memoryStore.mock_test_attempts || []).findIndex(a => a.id === attemptId);
    if (idx === -1) return null;

    memoryStore.mock_test_attempts[idx] = {
      ...memoryStore.mock_test_attempts[idx],
      ...updateData,
      updated_at: now
    };
    return memoryStore.mock_test_attempts[idx];
  },

  async saveResponse(attemptId, questionId, responseData, isMarkedForReview = false, isVisited = true) {
    const now = new Date().toISOString();
    const respId = `resp-${crypto.randomUUID().slice(0, 12)}`;

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `INSERT INTO mock_test_responses (
          id, attempt_id, question_id, response_data, is_marked_for_review, is_visited, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (attempt_id, question_id) DO UPDATE
        SET response_data = EXCLUDED.response_data,
            is_marked_for_review = EXCLUDED.is_marked_for_review,
            is_visited = EXCLUDED.is_visited,
            updated_at = EXCLUDED.updated_at
        RETURNING *`,
        [respId, attemptId, questionId, JSON.stringify(responseData), isMarkedForReview, isVisited, now]
      );
      return res.rows[0];
    }

    memoryStore.mock_test_responses = memoryStore.mock_test_responses || [];
    const idx = memoryStore.mock_test_responses.findIndex(
      r => r.attempt_id === attemptId && r.question_id === questionId
    );

    if (idx !== -1) {
      memoryStore.mock_test_responses[idx] = {
        ...memoryStore.mock_test_responses[idx],
        response_data: responseData,
        is_marked_for_review: isMarkedForReview,
        is_visited: isVisited,
        updated_at: now
      };
      return memoryStore.mock_test_responses[idx];
    } else {
      const record = {
        id: respId,
        attempt_id: attemptId,
        question_id: questionId,
        response_data: responseData,
        is_marked_for_review: isMarkedForReview,
        is_visited: isVisited,
        score_awarded: 0.00,
        is_correct: null,
        evaluation_comment: null,
        evaluated_by: null,
        evaluated_at: null,
        updated_at: now
      };
      memoryStore.mock_test_responses.push(record);
      return record;
    }
  },

  async updateEvaluatedResponses(attemptId, evaluatedList) {
    const now = new Date().toISOString();

    for (const item of evaluatedList) {
      if (isPostgresConnected && pool) {
        await pool.query(
          `INSERT INTO mock_test_responses (
            id, attempt_id, question_id, response_data, is_marked_for_review, is_visited,
            score_awarded, is_correct, evaluation_comment, is_pending_review, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (attempt_id, question_id) DO UPDATE
          SET score_awarded = EXCLUDED.score_awarded,
              is_correct = EXCLUDED.is_correct,
              evaluation_comment = EXCLUDED.evaluation_comment,
              is_pending_review = EXCLUDED.is_pending_review,
              updated_at = EXCLUDED.updated_at`,
          [
            `resp-${crypto.randomUUID().slice(0, 10)}`, attemptId, item.question_id,
            JSON.stringify(item.response_data), item.is_marked_for_review, item.is_visited,
            item.score_awarded, item.is_correct, item.evaluation_comment, Boolean(item.is_pending_review), now
          ]
        );
      } else {
        const idx = (memoryStore.mock_test_responses || []).findIndex(
          r => r.attempt_id === attemptId && r.question_id === item.question_id
        );
        if (idx !== -1) {
          memoryStore.mock_test_responses[idx] = {
            ...memoryStore.mock_test_responses[idx],
            score_awarded: item.score_awarded,
            is_correct: item.is_correct,
            evaluation_comment: item.evaluation_comment,
            is_pending_review: Boolean(item.is_pending_review),
            updated_at: now
          };
        } else {
          memoryStore.mock_test_responses.push({
            id: `resp-${crypto.randomUUID().slice(0, 10)}`,
            attempt_id: attemptId,
            question_id: item.question_id,
            response_data: item.response_data,
            is_marked_for_review: item.is_marked_for_review,
            is_visited: item.is_visited,
            score_awarded: item.score_awarded,
            is_correct: item.is_correct,
            evaluation_comment: item.evaluation_comment,
            is_pending_review: Boolean(item.is_pending_review),
            evaluated_by: null,
            evaluated_at: null,
            updated_at: now
          });
        }
      }
    }
  },

  async manuallyEvaluateResponse(attemptId, questionId, { score, comment, evaluatorId }) {
    const now = new Date().toISOString();
    const finalScore = Math.max(0, parseFloat(score) || 0);

    if (isPostgresConnected && pool) {
      const isCorrect = finalScore > 0;
      await pool.query(
        `UPDATE mock_test_responses
         SET score_awarded = $1,
             evaluation_comment = $2,
             evaluated_by = $3,
             evaluated_at = $4,
             is_pending_review = false,
             is_correct = $5,
             updated_at = $4
         WHERE attempt_id = $6 AND question_id = $7`,
        [finalScore, comment || null, evaluatorId || null, now, isCorrect, attemptId, questionId]
      );

      // Recalculate attempt totals
      const totalsRes = await pool.query(
        `SELECT
           COALESCE(SUM(score_awarded), 0)::numeric as total_score,
           COUNT(CASE WHEN is_correct = true THEN 1 END)::int as correct_count,
           COUNT(CASE WHEN is_correct = false THEN 1 END)::int as incorrect_count,
           COUNT(CASE WHEN is_pending_review = true THEN 1 END)::int as pending_count
         FROM mock_test_responses
         WHERE attempt_id = $1`,
        [attemptId]
      );

      const totals = totalsRes.rows[0];
      const attempt = await this.getAttemptById(attemptId);
      const maxScore = parseFloat(attempt?.max_score || 100);
      const passPercentage = parseFloat(attempt?.pass_percentage || 40);
      const totalScoreNum = Math.max(0, parseFloat(totals.total_score));
      const percentage = maxScore > 0 ? parseFloat(((totalScoreNum / maxScore) * 100).toFixed(2)) : 0;
      const passed = percentage >= passPercentage;

      const newStatus = totals.pending_count === 0 ? 'evaluated' : attempt.status;
      const newResultStatus = attempt.result_status === 'RELEASED'
        ? 'RELEASED'
        : (totals.pending_count === 0 ? 'EVALUATED' : 'PENDING_EVALUATION');

      await pool.query(
        `UPDATE mock_test_attempts
         SET total_score = $1,
             percentage = $2,
             passed = $3,
             correct_count = $4,
             incorrect_count = $5,
             status = $6,
             result_status = $7,
             evaluated_by = $8,
             evaluated_at = $9,
             updated_at = $9
         WHERE id = $10`,
        [
          totalScoreNum,
          percentage,
          passed,
          totals.correct_count,
          totals.incorrect_count,
          newStatus,
          newResultStatus,
          evaluatorId || null,
          now,
          attemptId
        ]
      );

      return this.getAttemptById(attemptId);
    }

    const resp = (memoryStore.mock_test_responses || []).find(
      r => r.attempt_id === attemptId && r.question_id === questionId
    );
    if (resp) {
      resp.score_awarded = finalScore;
      resp.evaluation_comment = comment || null;
      resp.evaluated_by = evaluatorId || null;
      resp.evaluated_at = now;
      resp.is_pending_review = false;
      resp.is_correct = finalScore > 0;
      resp.updated_at = now;
    }

    const attempt = (memoryStore.mock_test_attempts || []).find(a => a.id === attemptId);
    if (attempt) {
      const allResponses = (memoryStore.mock_test_responses || []).filter(r => r.attempt_id === attemptId);
      const totalScore = allResponses.reduce((sum, r) => sum + (parseFloat(r.score_awarded) || 0), 0);
      const correctCount = allResponses.filter(r => r.is_correct === true).length;
      const incorrectCount = allResponses.filter(r => r.is_correct === false).length;
      const pendingCount = allResponses.filter(r => r.is_pending_review === true).length;

      attempt.total_score = Math.max(0, parseFloat(totalScore.toFixed(2)));
      attempt.correct_count = correctCount;
      attempt.incorrect_count = incorrectCount;
      attempt.percentage = attempt.max_score > 0 ? parseFloat(((attempt.total_score / attempt.max_score) * 100).toFixed(2)) : 0;
      attempt.passed = attempt.percentage >= parseFloat(attempt.pass_percentage || 40);
      if (pendingCount === 0) {
        attempt.status = 'evaluated';
        if (attempt.result_status !== 'RELEASED') {
          attempt.result_status = 'EVALUATED';
        }
      }
      attempt.evaluated_by = evaluatorId || null;
      attempt.evaluated_at = now;
      attempt.updated_at = now;
    }

    return this.getAttemptById(attemptId);
  },

  /**
   * Releases an individual attempt result to the candidate
   */
  async releaseAttemptResult(attemptId, teacherId) {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      await pool.query(
        `UPDATE mock_test_attempts
         SET result_status = 'RELEASED',
             released_at = $1,
             released_by = $2,
             updated_at = $1
         WHERE id = $3`,
        [now, teacherId, attemptId]
      );
      return this.getAttemptById(attemptId);
    }

    const attempt = (memoryStore.mock_test_attempts || []).find(a => a.id === attemptId);
    if (attempt) {
      attempt.result_status = 'RELEASED';
      attempt.released_at = now;
      attempt.released_by = teacherId;
      attempt.updated_at = now;
    }
    return this.getAttemptById(attemptId);
  },

  /**
   * Releases all completed results for a test (and optional batch)
   */
  async releaseAllResultsForTest(testId, teacherId, batchId = null) {
    const now = new Date().toISOString();
    if (isPostgresConnected && pool) {
      let q = `
        UPDATE mock_test_attempts a
        SET result_status = 'RELEASED',
            released_at = $1,
            released_by = $2,
            updated_at = $1
        WHERE a.test_id = $3
          AND a.status IN ('submitted', 'evaluated', 'AUTO_SUBMITTED', 'auto_submitted')
      `;
      const params = [now, teacherId, testId];
      if (batchId) {
        q += ` AND a.student_id IN (SELECT student_id FROM batch_enrollments WHERE batch_id = $4 AND status = 'active')`;
        params.push(batchId);
      }
      await pool.query(q, params);
      return true;
    }

    (memoryStore.mock_test_attempts || [])
      .filter(a => a.test_id === testId && ['submitted', 'evaluated', 'AUTO_SUBMITTED'].includes(a.status))
      .forEach(a => {
        a.result_status = 'RELEASED';
        a.released_at = now;
        a.released_by = teacherId;
        a.updated_at = now;
      });
    return true;
  },

  /**
   * Retrieves comprehensive attempts with student info and question details for reports and PDF generation
   */
  async getDetailedAttemptsForReport(testId, batchId = null) {
    if (isPostgresConnected && pool) {
      let q = `
        SELECT a.*,
               u.full_name as student_name,
               u.email as student_email,
               u.id as student_user_id
        FROM mock_test_attempts a
        JOIN users u ON a.student_id = u.id
        WHERE a.test_id = $1
          AND a.status IN ('submitted', 'evaluated', 'AUTO_SUBMITTED', 'auto_submitted')
      `;
      const params = [testId];
      if (batchId) {
        params.push(batchId);
        q += ` AND a.student_id IN (SELECT student_id FROM batch_enrollments WHERE batch_id = $2 AND status = 'active')`;
      }
      q += ` ORDER BY a.total_score DESC, u.full_name ASC`;
      const res = await pool.query(q, params);

      // Fetch questions for each attempt to include breakdown in PDF
      const questionsRes = await pool.query(
        `SELECT id, question_text, question_type, marks, programming_language
         FROM mock_test_questions
         WHERE test_id = $1
         ORDER BY order_index ASC`,
        [testId]
      );
      const questions = questionsRes.rows;

      const attemptsWithQuestions = await Promise.all(res.rows.map(async att => {
        const respRes = await pool.query(
          `SELECT question_id, score_awarded, is_correct, evaluation_comment, is_pending_review, response_data, execution_results
           FROM mock_test_responses
           WHERE attempt_id = $1`,
          [att.id]
        );
        const respMap = {};
        respRes.rows.forEach(r => { respMap[r.question_id] = r; });

        const qReviews = questions.map(q => {
          const r = respMap[q.id];
          return {
            id: q.id,
            question_text: q.question_text,
            question_type: q.question_type,
            marks: parseFloat(q.marks || 0),
            score_awarded: r ? parseFloat(r.score_awarded || 0) : 0,
            is_correct: r ? r.is_correct : null,
            is_pending_review: r ? Boolean(r.is_pending_review) : false,
            evaluation_comment: r ? r.evaluation_comment : null,
            execution_results: r ? r.execution_results : null
          };
        });

        return {
          ...att,
          questions: qReviews
        };
      }));

      return attemptsWithQuestions;
    }

    let attempts = (memoryStore.mock_test_attempts || []).filter(
      a => a.test_id === testId && ['submitted', 'evaluated', 'AUTO_SUBMITTED'].includes(a.status)
    );

    const questions = (memoryStore.mock_test_questions || []).filter(q => q.test_id === testId);

    return attempts.map(a => {
      const u = (memoryStore.users || []).find(user => user.id === a.student_id) || {};
      const responses = (memoryStore.mock_test_responses || []).filter(r => r.attempt_id === a.id);
      const respMap = {};
      responses.forEach(r => { respMap[r.question_id] = r; });

      const qReviews = questions.map(q => {
        const r = respMap[q.id];
        return {
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          marks: parseFloat(q.marks || 0),
          score_awarded: r ? parseFloat(r.score_awarded || 0) : 0,
          is_correct: r ? r.is_correct : null,
          is_pending_review: r ? Boolean(r.is_pending_review) : false,
          evaluation_comment: r ? r.evaluation_comment : null
        };
      });

      return {
        ...a,
        student_name: u.full_name || 'Student',
        student_email: u.email || '',
        questions: qReviews
      };
    }).sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
  },

  // ---------------------------------------------------------------------------
  // 4. PROCTORING EVENTS
  // ---------------------------------------------------------------------------

  async logProctoringEvent(eventData) {
    const eventId = `evt-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    const validSeverities = ['info', 'warning', 'critical'];
    const rawSev = String(eventData.severity || 'warning').toLowerCase();
    const cleanSev = validSeverities.includes(rawSev) ? rawSev : 'warning';

    const record = {
      id: eventId,
      attempt_id: eventData.attempt_id,
      event_type: eventData.event_type,
      severity: cleanSev,
      client_timestamp: eventData.client_timestamp || now,
      server_timestamp: now,
      duration_seconds: parseInt(eventData.duration_seconds || 0, 10),
      confidence: parseFloat(eventData.confidence || 1.00),
      metadata: eventData.metadata || {},
      review_status: 'pending',
      review_notes: null,
      reviewed_by: null,
      reviewed_at: null
    };

    if (isPostgresConnected && pool) {
      await pool.query(
        `INSERT INTO mock_test_proctoring_events (
          id, attempt_id, event_type, severity, client_timestamp, server_timestamp,
          duration_seconds, confidence, metadata, review_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          record.id, record.attempt_id, record.event_type, record.severity,
          record.client_timestamp, record.server_timestamp, record.duration_seconds,
          record.confidence, JSON.stringify(record.metadata), record.review_status
        ]
      );
    } else {
      memoryStore.mock_test_proctoring_events = memoryStore.mock_test_proctoring_events || [];
      memoryStore.mock_test_proctoring_events.push(record);
    }

    return record;
  },

  async getProctoringEvents(attemptId) {
    if (isPostgresConnected && pool) {
      const res = await pool.query(
        'SELECT * FROM mock_test_proctoring_events WHERE attempt_id = $1 ORDER BY server_timestamp ASC',
        [attemptId]
      );
      return res.rows;
    }

    return (memoryStore.mock_test_proctoring_events || [])
      .filter(e => e.attempt_id === attemptId)
      .sort((a, b) => new Date(a.server_timestamp) - new Date(b.server_timestamp));
  },

  async updateProctoringEventReview(eventId, reviewStatus, reviewNotes, reviewedBy) {
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      const res = await pool.query(
        `UPDATE mock_test_proctoring_events
         SET review_status = $1, review_notes = $2, reviewed_by = $3, reviewed_at = $4
         WHERE id = $5 RETURNING *`,
        [reviewStatus, reviewNotes, reviewedBy, now, eventId]
      );
      return res.rows[0];
    }

    const idx = (memoryStore.mock_test_proctoring_events || []).findIndex(e => e.id === eventId);
    if (idx === -1) return null;

    memoryStore.mock_test_proctoring_events[idx] = {
      ...memoryStore.mock_test_proctoring_events[idx],
      review_status: reviewStatus,
      review_notes: reviewNotes,
      reviewed_by: reviewedBy,
      reviewed_at: now
    };
    return memoryStore.mock_test_proctoring_events[idx];
  },

  // ---------------------------------------------------------------------------
  // 5. AUDIT LOGGING
  // ---------------------------------------------------------------------------

  async logAudit({ testId, attemptId, actorId, actorRole, action, details, ipAddress }) {
    const id = `audit-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    if (isPostgresConnected && pool) {
      try {
        let validTestId = testId;
        if (validTestId) {
          const tExists = await pool.query('SELECT 1 FROM mock_tests WHERE id = $1 LIMIT 1', [validTestId]);
          if (tExists.rows.length === 0) validTestId = null;
        }
        let validAttemptId = attemptId;
        if (validAttemptId) {
          const aExists = await pool.query('SELECT 1 FROM mock_test_attempts WHERE id = $1 LIMIT 1', [validAttemptId]);
          if (aExists.rows.length === 0) validAttemptId = null;
        }

        await pool.query(
          `INSERT INTO mock_test_audit_logs (id, test_id, attempt_id, actor_id, actor_role, action, details, ip_address, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, validTestId || null, validAttemptId || null, actorId || null, actorRole || 'USER', action, JSON.stringify(details || {}), ipAddress || null, now]
        );
      } catch (err) {
        console.warn('[MockTestRepo] Audit logging failed:', err.message);
      }
    } else {
      memoryStore.mock_test_audit_logs = memoryStore.mock_test_audit_logs || [];
      memoryStore.mock_test_audit_logs.push({
        id, test_id: testId, attempt_id: attemptId, actor_id: actorId, actor_role: actorRole,
        action, details, ip_address: ipAddress, created_at: now
      });
    }

    // Automatically append canonical audit log record
    try {
      await recordAuditLog({
        actorId: actorId || null,
        action: action || 'MOCK_TEST_ACTION',
        targetResource: testId ? `mock_test:${testId}` : (attemptId ? `mock_test_attempt:${attemptId}` : null),
        resourceType: testId ? 'mock_test' : (attemptId ? 'mock_test_attempt' : null),
        resourceId: testId || attemptId || null,
        summary: typeof details === 'string' ? details : (details ? JSON.stringify(details) : ''),
        ipAddress: ipAddress || null,
        createdAt: now
      });
    } catch (err) {
      // Non-breaking
    }
  }
};
