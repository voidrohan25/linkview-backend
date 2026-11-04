import { questionBankService } from '../services/questionBankService.js';
import { questionBankRepository } from '../repositories/questionBankRepository.js';
import { notificationService } from '../services/notificationService.js';
import { recordAuditLog } from '../repositories/auditRepository.js';

export const questionBankController = {
  /**
   * GET /api/questions/csv/template
   * Download sample CSV template with instructions and sample rows
   */
  async downloadTemplate(req, res, next) {
    try {
      const csvString = questionBankService.getSampleTemplate();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="linktest_question_template.csv"');
      return res.status(200).send(csvString);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/questions/csv/preview
   * Upload CSV file or text payload to preview and validate without modifying database
   */
  async previewCSV(req, res, next) {
    try {
      let csvContent = '';

      if (req.file && req.file.buffer) {
        csvContent = req.file.buffer.toString('utf-8');
      } else if (req.body && req.body.csvContent !== undefined) {
        csvContent = req.body.csvContent;
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_CSV_PROVIDED',
            message: 'No CSV file or csvContent data was received in the request.'
          }
        });
      }

      const result = await questionBankService.previewCSV(csvContent, req.user);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CSV_VALIDATION_ERROR',
            message: result.error
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: result,
        message: 'CSV preview generated successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/questions/csv/import
   * Upload CSV file or text and commit valid rows to database
   */
  async importCSV(req, res, next) {
    try {
      let csvContent = '';
      const duplicateStrategy = (req.body?.duplicateStrategy || 'skip').toLowerCase();

      if (req.file && req.file.buffer) {
        csvContent = req.file.buffer.toString('utf-8');
      } else if (req.body && req.body.csvContent !== undefined) {
        csvContent = req.body.csvContent;
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_CSV_PROVIDED',
            message: 'No CSV file or csvContent data was received in the request.'
          }
        });
      }

      const result = await questionBankService.importCSV(
        csvContent,
        req.user,
        { duplicateStrategy },
        { ip: req.ip || req.headers['x-forwarded-for'] }
      );

      if (!result.success) {
        notificationService.createNotification({
          userId: req.user.id,
          title: 'Question Bank Import Failed',
          message: result.error || 'Failed to import questions from CSV file.',
          type: 'ERROR',
          priority: 'HIGH',
          actionUrl: req.user.role === 'ADMIN' ? '/admin/questions' : '/teacher/question-bank',
          actionLabel: 'View Question Bank',
          relatedEntityType: 'QUESTION_IMPORT'
        }).catch(() => {});

        return res.status(400).json({
          success: false,
          error: {
            code: 'IMPORT_FAILED',
            message: result.error
          }
        });
      }

      const importedCount = result.result?.importedCount || 0;
      const failedCount = result.result?.failedCount || 0;

      notificationService.createNotification({
        userId: req.user.id,
        title: 'Question Import Completed',
        message: `${importedCount} questions were successfully imported into the Question Bank${failedCount > 0 ? ` (${failedCount} rows skipped)` : ''}.`,
        type: 'TASK_COMPLETED',
        priority: 'NORMAL',
        actionUrl: req.user.role === 'ADMIN' ? '/admin/questions' : '/teacher/question-bank',
        actionLabel: 'View Question Bank',
        relatedEntityType: 'QUESTION_IMPORT'
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: result.result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/questions/csv/error-report
   * Download CSV file containing failed rows and reasons
   */
  async downloadErrorReport(req, res, next) {
    try {
      const failedRows = req.body.failedRows || [];
      const csvString = questionBankService.generateErrorReport(failedRows);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="linktest_import_errors.csv"');
      return res.status(200).send(csvString);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/questions/bank
   * Get paginated questions with filtering
   */
  async getQuestions(req, res, next) {
    try {
      const {
        search = '',
        subject = '',
        topic = '',
        difficulty = '',
        createdBy = '',
        question_type = '',
        type = '',
        limit = 50,
        offset = 0
      } = req.query;

      // If user is teacher, they can view all bank questions or restrict by their assignments
      const data = await questionBankRepository.getQuestions({
        search,
        subject,
        topic,
        difficulty,
        createdBy,
        question_type: question_type || type,
        limit,
        offset
      });

      return res.status(200).json({
        success: true,
        data: data.questions,
        pagination: {
          total: data.total,
          limit: data.limit,
          offset: data.offset
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/questions/bank/filters
   * Get distinct subjects and topics for filtering
   */
  async getFilterOptions(req, res, next) {
    try {
      const options = await questionBankRepository.getFilterOptions();
      return res.status(200).json({
        success: true,
        data: options
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/questions/bank
   * Create a single question manually in the question bank
   */
  async createQuestion(req, res, next) {
    try {
      const {
        question_text,
        options,
        correct_option_index,
        correct_answer,
        subject,
        topic,
        difficulty,
        explanation,
        marks,
        negative_marks,
        question_type,
        questionType,
        expected_answer,
        expectedAnswer,
        evaluation_criteria,
        evaluationCriteria,
        programming_language,
        programmingLanguage,
        starter_code,
        starterCode,
        time_limit,
        timeLimit,
        memory_limit,
        memoryLimit,
        test_cases,
        testCases
      } = req.body;

      if (!question_text || !subject || !topic) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_DATA', message: 'question_text, subject, and topic are required.' }
        });
      }

      // Note: In accordance with Mock Exam System requirements, teachers are authorized to create questions for any subject.

      const created = await questionBankRepository.createQuestion({
        question_text,
        options,
        correct_option_index,
        correct_answer,
        subject,
        topic,
        difficulty,
        explanation,
        marks,
        negative_marks,
        question_type: question_type || questionType || 'mcq_single',
        expected_answer: expected_answer || expectedAnswer || null,
        evaluation_criteria: evaluation_criteria || evaluationCriteria || null,
        programming_language: programming_language || programmingLanguage || 'javascript',
        starter_code: starter_code || starterCode || null,
        time_limit: time_limit || timeLimit || 2.0,
        memory_limit: memory_limit || memoryLimit || 128,
        test_cases: test_cases || testCases || [],
        created_by: req.user.id
      });

      await recordAuditLog({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'QUESTION_CREATED',
        resourceType: 'question_bank',
        resourceId: created.id,
        targetResource: `question_bank:${created.id}`,
        summary: `Question '${created.subject} - ${created.topic}' created in question bank`,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent']
      });

      return res.status(201).json({
        success: true,
        data: created,
        message: 'Question added to Question Bank.'
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/questions/bank/:id
   * Delete a question from question bank
   */
  async deleteQuestion(req, res, next) {
    try {
      const { id } = req.params;
      const question = await questionBankRepository.findById(id);

      if (!question) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Question not found in Question Bank.' }
        });
      }

      // Role check: Only ADMIN or the teacher who created it can delete
      if (req.user.role !== 'ADMIN' && question.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only delete questions created by your account.' }
        });
      }

      await questionBankRepository.deleteQuestion(id);

      await recordAuditLog({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: 'QUESTION_DELETED',
        resourceType: 'question_bank',
        resourceId: id,
        targetResource: `question_bank:${id}`,
        summary: `Question ${id} deleted from question bank`,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent']
      });

      return res.status(200).json({
        success: true,
        message: 'Question deleted successfully from Question Bank.'
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/questions/:id or /api/questions/bank/:id
   */
  async getQuestionById(req, res, next) {
    try {
      const { id } = req.params;
      const question = await questionBankRepository.findById(id);

      if (!question) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Question not found.' }
        });
      }

      return res.status(200).json({
        success: true,
        data: { question }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /api/questions/:id or /api/questions/bank/:id
   */
  async updateQuestion(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await questionBankRepository.findById(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Question not found.' }
        });
      }

      // Role check: Only ADMIN or the teacher who created it can update
      if (req.user.role !== 'ADMIN' && existing.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only update questions created by your account.' }
        });
      }

      const updated = await questionBankRepository.updateQuestion(id, req.body);

      return res.status(200).json({
        success: true,
        data: { question: updated },
        message: 'Question updated successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
};
