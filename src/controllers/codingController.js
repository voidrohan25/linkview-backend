// Coding Controller
// LinkTest Enterprise Examination System
// Handles safe candidate execution, public test case verification, and final submission scoring

import { codeExecutionService } from '../services/codeExecutionService.js';
import { codingRepository } from '../repositories/codingRepository.js';

export const codingController = {
  /**
   * POST /api/coding/execute
   * Standalone sandbox runner endpoint with timeout, memory safeguards, and language support
   */
  async execute(req, res, next) {
    try {
      const { code, language = 'javascript', testCases = [], timeLimitSeconds = 5.0, memoryLimitMb = 128 } = req.body;

      if (!code || typeof code !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Submitted code string is required.' }
        });
      }

      const executionSummary = await codeExecutionService.executeCode({
        code,
        language,
        testCases,
        timeLimitSeconds,
        memoryLimitMb
      });

      return res.status(200).json({
        success: true,
        data: executionSummary
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Run code against public test cases (Candidate [Run Code] during test)
   * Hidden test cases are strictly excluded!
   */
  async runPublicTestCases(req, res, next) {
    try {
      const { questionId, code, language = 'javascript', customTestCases } = req.body;

      if (!code || typeof code !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Submitted code string is required.' }
        });
      }

      let testCasesToRun = [];

      if (Array.isArray(customTestCases) && customTestCases.length > 0) {
        testCasesToRun = customTestCases.map((tc, idx) => ({
          id: tc.id || `custom_${idx}`,
          input: String(tc.input ?? ''),
          expected_output: String(tc.expected_output ?? ''),
          is_hidden: false
        }));
      } else if (questionId) {
        // Fetch ONLY public test cases for this question
        const allCases = await codingRepository.getTestCasesForQuestion(questionId, { includeHidden: false });
        testCasesToRun = allCases.map(tc => ({
          id: tc.id,
          input: String(tc.input ?? ''),
          expected_output: String(tc.expected_output ?? ''),
          is_hidden: false
        }));
      }

      const qDetails = questionId ? await codingRepository.getQuestionDetails(questionId) : null;
      const timeLimitSeconds = qDetails?.time_limit || 2.0;
      const memoryLimitMb = qDetails?.memory_limit || 128;

      const executionSummary = await codeExecutionService.executeCode({
        code,
        testCases: testCasesToRun,
        timeLimitSeconds,
        memoryLimitMb
      });

      return res.status(200).json({
        success: true,
        data: executionSummary
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Submit code solution (evaluates against both public and hidden test cases)
   * Stores in coding_submissions table.
   * If caller is student, results are sanitized (hidden test inputs/outputs omitted).
   */
  async submitSolution(req, res, next) {
    try {
      const studentId = req.user.id;
      const {
        questionId,
        attemptId,
        code,
        language = 'javascript'
      } = req.body;

      if (!questionId || !code) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'questionId and code are required.' }
        });
      }

      const qDetails = await codingRepository.getQuestionDetails(questionId);
      const allTestCases = await codingRepository.getTestCasesForQuestion(questionId, { includeHidden: true });
      const timeLimitSeconds = qDetails?.time_limit || 2.0;
      const memoryLimitMb = qDetails?.memory_limit || 128;
      const maxMarks = parseFloat(qDetails?.marks || 10);

      // Execute code against all test cases in isolated sandbox
      const executionSummary = await codeExecutionService.executeCode({
        code,
        testCases: allTestCases,
        timeLimitSeconds,
        memoryLimitMb
      });

      // Calculate score based on passed tests proportion
      const totalCount = allTestCases.length;
      const passedCount = executionSummary.test_cases_passed || 0;
      let calculatedScore = 0;
      if (totalCount > 0) {
        calculatedScore = parseFloat(((passedCount / totalCount) * maxMarks).toFixed(2));
      } else if (executionSummary.status === 'success') {
        calculatedScore = maxMarks;
      }

      // Persist to database
      const submission = await codingRepository.createSubmission({
        studentId,
        questionId,
        attemptId: attemptId || null,
        programmingLanguage: language,
        submittedCode: code,
        executionStatus: executionSummary.status,
        score: calculatedScore,
        testCasesPassed: passedCount,
        totalTestCases: totalCount,
        executionTimeMs: executionSummary.execution_time_ms,
        memoryUsageMb: executionSummary.memory_usage_mb,
        errorMessage: executionSummary.error,
        testResults: executionSummary.results
      });

      // Sanitize response for student
      const isStudent = req.user.role === 'STUDENT';
      const sanitizedExecution = isStudent
        ? codeExecutionService.sanitizeResultsForCandidate(executionSummary)
        : executionSummary;

      return res.status(201).json({
        success: true,
        data: {
          submission: {
            ...submission,
            test_results: sanitizedExecution.results
          },
          execution: sanitizedExecution,
          score: calculatedScore,
          max_score: maxMarks
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Get submission by ID with strict authorization
   * Student can only access their own; teachers/admins can access any.
   */
  async getSubmissionById(req, res, next) {
    try {
      const { id } = req.params;
      const submission = await codingRepository.getSubmissionById(id);

      if (!submission) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Coding submission not found.' }
        });
      }

      // Strict ownership check
      if (req.user.role === 'STUDENT' && submission.student_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not authorized to view another student\'s submission.' }
        });
      }

      // Sanitize hidden test cases for students
      if (req.user.role === 'STUDENT') {
        let results = submission.test_results;
        if (typeof results === 'string') {
          try { results = JSON.parse(results); } catch (_) { results = []; }
        }
        const sanitized = codeExecutionService.sanitizeResultsForCandidate({ results });
        submission.test_results = sanitized.results;
      }

      return res.status(200).json({
        success: true,
        data: { submission }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Run code on an existing submission
   */
  async runExistingSubmission(req, res, next) {
    try {
      const { id } = req.params;
      const submission = await codingRepository.getSubmissionById(id);

      if (!submission) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Coding submission not found.' }
        });
      }

      if (req.user.role === 'STUDENT' && submission.student_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not authorized to run another student\'s submission.' }
        });
      }

      // Run against public test cases only
      const publicCases = await codingRepository.getTestCasesForQuestion(submission.question_id, { includeHidden: false });
      const qDetails = await codingRepository.getQuestionDetails(submission.question_id);

      const executionSummary = await codeExecutionService.executeCode({
        code: submission.submitted_code,
        testCases: publicCases,
        timeLimitSeconds: qDetails?.time_limit || 2.0,
        memoryLimitMb: qDetails?.memory_limit || 128
      });

      return res.status(200).json({
        success: true,
        data: executionSummary
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * List coding submissions
   */
  async listSubmissions(req, res, next) {
    try {
      const { questionId, attemptId } = req.query;
      let studentId = req.query.studentId;

      // Student can only see their own
      if (req.user.role === 'STUDENT') {
        studentId = req.user.id;
      }

      const submissions = await codingRepository.getSubmissions({ studentId, questionId, attemptId });

      // Sanitize hidden tests for students
      if (req.user.role === 'STUDENT') {
        submissions.forEach(sub => {
          let results = sub.test_results;
          if (typeof results === 'string') {
            try { results = JSON.parse(results); } catch (_) { results = []; }
          }
          const sanitized = codeExecutionService.sanitizeResultsForCandidate({ results });
          sub.test_results = sanitized.results;
        });
      }

      return res.status(200).json({
        success: true,
        data: { submissions }
      });
    } catch (err) {
      next(err);
    }
  }
};
