import { quizRepository } from '../repositories/quizRepository.js';
import { lmsRepository } from '../repositories/lmsRepository.js';
import { securityLogRepository } from '../repositories/securityLogRepository.js';
import { quizService } from '../services/quizService.js';
import { submitQuizAttemptSchema } from '../validators/index.js';
import { recordAuditLog } from '../repositories/auditRepository.js';

export const quizController = {
  async getQuizzesByCourse(req, res, next) {
    try {
      const { courseId } = req.params;
      const quizzes = await quizRepository.getQuizzesByCourseId(courseId);
      return res.status(200).json({
        success: true,
        data: { quizzes },
        message: 'Course quizzes retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getQuizById(req, res, next) {
    try {
      const { id } = req.params;
      const quiz = await quizRepository.getQuizForTaker(id);
      if (!quiz) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Quiz not found.' }
        });
      }
      const canViewAnswerKeys = req.user.role === 'ADMIN' ||
        (req.user.role === 'TEACHER' && quiz.teacher_id === req.user.id);
      const quizDetails = canViewAnswerKeys
        ? await quizRepository.getQuizForTaker(id, { includeAnswerKey: true })
        : quiz;

      return res.status(200).json({
        success: true,
        data: { quiz: quizDetails },
        message: 'Quiz questions retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  async submitAttempt(req, res, next) {
    try {
      const { id } = req.params;
      const validated = submitQuizAttemptSchema.parse(req.body);
      const result = await quizService.submitAttempt({
        userId: req.user.id,
        quizId: id,
        answers: validated.answers
      });
      return res.status(200).json({
        success: true,
        data: result,
        message: 'Quiz attempt scored and recorded successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getMyAttempts(req, res, next) {
    try {
      const attempts = await quizRepository.getUserAttempts(req.user.id);
      return res.status(200).json({
        success: true,
        data: { attempts },
        message: 'User quiz attempt history retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getAttemptDetails(req, res, next) {
    try {
      const { attemptId } = req.params;
      const details = await quizRepository.getAttemptDetails(attemptId);
      if (!details) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Quiz attempt not found.' }
        });
      }

      const authorized = req.user.role === 'ADMIN' ||
        (req.user.role === 'STUDENT' && details.user_id === req.user.id) ||
        (req.user.role === 'TEACHER' &&
          await lmsRepository.isTeacherAssignedToStudent(req.user.id, details.user_id));

      if (!authorized) {
        await securityLogRepository.logEvent({
          eventType: 'UNAUTHORIZED_SCORECARD_ACCESS',
          severity: 'HIGH',
          userId: req.user.id,
          userEmail: req.user.email,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          details: 'Unauthorized quiz scorecard access was denied.',
          metadata: { attemptId, targetStudentId: details.user_id, resourceType: 'quiz_attempt' }
        });
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not authorized to view this quiz scorecard.' }
        });
      }

      return res.status(200).json({
        success: true,
        data: { attempt: details },
        message: 'Attempt review details retrieved.'
      });
    } catch (err) {
      next(err);
    }
  },

  async createQuiz(req, res, next) {
    try {
      const courseId = req.body.courseId || req.body.course_id;
      const { title, description, questions } = req.body;
      if (!title || !courseId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'courseId and title are required.' }
        });
      }
      const quiz = await quizRepository.createQuiz({
        courseId,
        title,
        description: description || '',
        questions: questions || [],
        teacherId: req.user.id
      });
      if (req.user) {
        await recordAuditLog({
          actorId: req.user.id,
          actorEmail: req.user.email,
          action: 'QUIZ_CREATED',
          resourceType: 'quiz',
          resourceId: quiz.id,
          targetResource: `quiz:${quiz.id}`,
          summary: `Quiz '${quiz.title}' created in course ${courseId}`,
          ipAddress: req.ip || req.headers['x-forwarded-for'],
          userAgent: req.headers['user-agent']
        });
      }
      return res.status(201).json({
        success: true,
        data: { quiz },
        message: 'Quiz created successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async evaluateAnswer(req, res, next) {
    try {
      const { attemptId, questionId } = req.params;
      const { score, comment } = req.body;

      if (score === undefined || isNaN(parseFloat(score))) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_SCORE', message: 'A numeric score must be provided.' }
        });
      }

      const updated = await quizRepository.manuallyEvaluateAnswer({
        attemptId,
        questionId,
        score: parseFloat(score),
        comment: comment || '',
        evaluatorId: req.user.id
      });

      return res.status(200).json({
        success: true,
        data: { attempt: updated },
        message: 'Quiz answer evaluated successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
};
