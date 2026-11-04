// Mock Test API Controller
// LinkTest Enterprise Examination System

import { mockTestService } from '../services/mockTestService.js';
import { mockTestRepository } from '../repositories/mockTestRepository.js';
import { mockTestJoinRequestRepository } from '../repositories/mockTestJoinRequestRepository.js';
import { batchRepository } from '../repositories/batchRepository.js';
import { notificationService } from '../services/notificationService.js';

export const mockTestController = {
  // ---------------------------------------------------------------------------
  // 1. DISCOVERY & RETRIEVAL
  // ---------------------------------------------------------------------------

  async getAllTests(req, res, next) {
    try {
      const filters = {
        category: req.query.category,
        subject: req.query.subject,
        difficulty: req.query.difficulty,
        search: req.query.search
      };

      if (req.user && req.user.role === 'STUDENT') {
        const tests = await mockTestService.getStudentDashboardTests(req.user, filters);
        return res.status(200).json({ success: true, data: { tests } });
      }

      // Teacher / Admin or Public
      if (req.user && req.user.role === 'TEACHER') {
        if (req.query.scope === 'mine') {
          filters.created_by = req.user.id;
        }
      }

      if (!req.user || req.user.role === 'STUDENT') {
        filters.status = 'published';
      } else if (req.query.status) {
        filters.status = req.query.status;
      }

      const tests = await mockTestRepository.getAllTests(filters);
      return res.status(200).json({ success: true, data: { tests } });
    } catch (err) {
      next(err);
    }
  },

  async getTestById(req, res, next) {
    try {
      const { id } = req.params;
      const test = await mockTestRepository.getTestById(id);

      if (!test) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Mock test not found.' }
        });
      }

      // CRITICAL SECURITY: Batch-restricted Mock Tests (Requirements 2 & 20)
      if (test.batch_id) {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Authentication required to access this batch-restricted mock test.' }
          });
        }
        if (req.user.role === 'STUDENT') {
          const isEnrolled = await batchRepository.isStudentInBatch(req.user.id, test.batch_id);
          if (!isEnrolled) {
            return res.status(403).json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'You are not enrolled in the batch assigned to this mock test.' }
            });
          }
        }
      }

      const canViewAnswerKeys = req.user && (
        req.user.role === 'ADMIN' ||
        (req.user.role === 'TEACHER' && test.created_by === req.user.id)
      );

      if (!canViewAnswerKeys) {
        test.questions = await mockTestRepository.getQuestionsByTestId(id, { sanitize: true });
      }

      if (req.user && req.user.role === 'STUDENT') {
        const studentAttempts = await mockTestRepository.getAttemptsByStudent(req.user.id, id);
        const disqualifiedAttempt = studentAttempts.find(a => mockTestService.isAttemptViolationDisqualified(a));
        if (disqualifiedAttempt) {
          test.is_disqualified = true;
          test.disqualification_reason = disqualifiedAttempt.submission_reason || 'MAX_SECURITY_WARNINGS';
          test.can_attempt = false;
        }
      }

      return res.status(200).json({ success: true, data: { test } });
    } catch (err) {
      next(err);
    }
  },

  // ---------------------------------------------------------------------------
  // 2. CANDIDATE ATTEMPTS & EXAM RUNNER
  // ---------------------------------------------------------------------------

  async startAttempt(req, res, next) {
    try {
      const { id } = req.params;
      const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
      const attemptData = await mockTestService.startOrResumeAttempt(id, req.user, ip);

      return res.status(200).json({
        success: true,
        data: attemptData,
        message: 'Exam session initialized successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getAttempt(req, res, next) {
    try {
      const { attemptId } = req.params;
      if (!attemptId || attemptId === 'undefined' || attemptId === 'null' || !String(attemptId).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ATTEMPT_ID', message: 'A valid examination attempt ID must be specified.' }
        });
      }
      const attemptData = await mockTestService.getAttemptForTaker(attemptId, req.user);

      return res.status(200).json({ success: true, data: attemptData });
    } catch (err) {
      next(err);
    }
  },

  async saveAnswer(req, res, next) {
    try {
      const { attemptId } = req.params;
      if (!attemptId || attemptId === 'undefined' || attemptId === 'null' || !String(attemptId).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ATTEMPT_ID', message: 'A valid examination attempt ID must be specified.' }
        });
      }

      if (req.body.answers && typeof req.body.answers === 'object') {
        const entries = Object.entries(req.body.answers);
        for (const [qId, ans] of entries) {
          await mockTestService.saveResponse(attemptId, req.user, {
            question_id: qId,
            response_data: ans.response_data !== undefined ? ans.response_data : ans,
            is_marked_for_review: Boolean(ans.is_marked_for_review),
            is_visited: true
          });
        }
        return res.status(200).json({ success: true, data: { saved_count: entries.length } });
      }

      const result = await mockTestService.saveResponse(attemptId, req.user, req.body);
      return res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  },

  async logProctoringEvent(req, res, next) {
    try {
      const { attemptId } = req.params;
      if (!attemptId || attemptId === 'undefined' || attemptId === 'null' || !String(attemptId).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ATTEMPT_ID', message: 'A valid examination attempt ID must be specified.' }
        });
      }
      const result = await mockTestService.ingestProctoringEvent(attemptId, req.user, req.body);

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async submitAttempt(req, res, next) {
    try {
      const { attemptId } = req.params;
      if (!attemptId || attemptId === 'undefined' || attemptId === 'null' || !String(attemptId).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ATTEMPT_ID', message: 'A valid examination attempt ID must be specified.' }
        });
      }
      const result = await mockTestService.submitAttempt(attemptId, req.user, {
        auto_submitted: Boolean(req.body.auto_submitted),
        reason: req.body.reason
      });

      // Unified Notification Event
      if (req.body.auto_submitted) {
        notificationService.createNotification({
          userId: req.user.id,
          title: 'Examination Automatically Submitted',
          message: `Your examination was automatically submitted due to an examination security violation${req.body.reason ? ` (${req.body.reason})` : ''}.`,
          type: 'ERROR',
          priority: 'CRITICAL',
          actionUrl: `/mock-tests/attempts/${attemptId}/result`,
          actionLabel: 'View Summary',
          relatedEntityType: 'MOCK_TEST',
          relatedEntityId: attemptId,
          eventKey: `student:${req.user.id}:attempt:${attemptId}:AUTO_SUBMIT`
        }).catch(() => {});
      } else {
        notificationService.createNotification({
          userId: req.user.id,
          title: 'Test Submission Successful',
          message: 'Your examination answers have been submitted and evaluated successfully.',
          type: 'SUCCESS',
          priority: 'NORMAL',
          actionUrl: `/mock-tests/attempts/${attemptId}/result`,
          actionLabel: 'View Result',
          relatedEntityType: 'MOCK_TEST',
          relatedEntityId: attemptId,
          eventKey: `student:${req.user.id}:attempt:${attemptId}:SUBMITTED`
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Examination submitted and evaluated successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getAttemptResult(req, res, next) {
    try {
      const { attemptId } = req.params;
      if (!attemptId || attemptId === 'undefined' || attemptId === 'null' || !String(attemptId).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ATTEMPT_ID', message: 'A valid examination attempt ID must be specified.' }
        });
      }
      const result = await mockTestService.getAttemptResult(attemptId, req.user);

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async getMyAttempts(req, res, next) {
    try {
      const testId = req.query.test_id || null;
      const rawAttempts = await mockTestRepository.getAttemptsByStudent(req.user.id, testId);

      const attempts = (rawAttempts || []).map(att => {
        const isReleased = att.result_status === 'RELEASED';
        if (req.user.role === 'STUDENT' && !isReleased) {
          return {
            ...att,
            total_score: null,
            score: null,
            percentage: null,
            passed: null,
            correct_count: null,
            incorrect_count: null,
            unanswered_count: null,
            responses: [],
            results_released: false
          };
        }
        return {
          ...att,
          results_released: isReleased
        };
      });

      return res.status(200).json({ success: true, data: { attempts } });
    } catch (err) {
      next(err);
    }
  },

  async getMyResults(req, res, next) {
    try {
      const results = await mockTestService.getMyResults(req.user);
      return res.status(200).json({ success: true, data: { results } });
    } catch (err) {
      next(err);
    }
  },

  // ---------------------------------------------------------------------------
  // 3. TEACHER & ADMIN CREATION STUDIO & MANAGEMENT
  // ---------------------------------------------------------------------------

  async createMockTest(req, res, next) {
    try {
      const { questions = [], sections = [], ...testData } = req.body;

      if (!testData.title || !testData.subject) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Test title and subject are required.' }
        });
      }

      testData.created_by = req.user.id;
      testData.batch_id = testData.batch_id || req.body.target_batch || req.body.targetBatch || req.body.batchId || null;
      if (req.body.duration || req.body.duration_minutes) {
        testData.duration_minutes = parseInt(req.body.duration_minutes || req.body.duration, 10);
      }

      const created = await mockTestRepository.createTest(testData, questions, sections);

      await mockTestRepository.logAudit({
        testId: created.id,
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'MOCK_TEST_CREATED',
        details: { title: created.title, questions_count: questions.length, batch_id: testData.batch_id }
      });

      return res.status(201).json({
        success: true,
        data: { test: created },
        message: 'Mock test created successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async updateMockTest(req, res, next) {
    try {
      const { id } = req.params;
      const { questions, ...testData } = req.body;

      const existing = await mockTestRepository.getTestById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Mock test not found.' }
        });
      }

      // Authorization: teacher must own test or be admin
      if (req.user.role === 'TEACHER' && existing.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to edit this test.' }
        });
      }

      if (req.body.target_batch !== undefined || req.body.targetBatch !== undefined || req.body.batch_id !== undefined || req.body.batchId !== undefined) {
        testData.batch_id = req.body.batch_id || req.body.target_batch || req.body.targetBatch || req.body.batchId || null;
      }
      if (req.body.duration !== undefined || req.body.duration_minutes !== undefined) {
        testData.duration_minutes = parseInt(req.body.duration_minutes || req.body.duration, 10);
      }

      const updated = await mockTestRepository.updateTest(id, testData);

      // If questions provided, replace or append
      if (Array.isArray(questions)) {
        await mockTestRepository.addQuestionsToTest(id, questions);
      }

      await mockTestRepository.logAudit({
        testId: id,
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'MOCK_TEST_UPDATED',
        details: testData
      });

      return res.status(200).json({
        success: true,
        data: { test: updated },
        message: 'Mock test updated successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async deleteMockTest(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await mockTestRepository.getTestById(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Mock test not found.' }
        });
      }

      if (req.user.role === 'TEACHER' && existing.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to delete this test.' }
        });
      }

      await mockTestRepository.deleteTest(id);

      await mockTestRepository.logAudit({
        testId: id,
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'MOCK_TEST_DELETED',
        details: { title: existing.title }
      });

      return res.status(200).json({
        success: true,
        message: 'Mock test deleted successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  async duplicateMockTest(req, res, next) {
    try {
      const { id } = req.params;
      const duplicated = await mockTestRepository.duplicateTest(id, req.user.id);

      if (!duplicated) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Original test not found.' }
        });
      }

      return res.status(201).json({
        success: true,
        data: { test: duplicated },
        message: 'Test duplicated successfully as draft.'
      });
    } catch (err) {
      next(err);
    }
  },

  async publishMockTest(req, res, next) {
    try {
      const { id } = req.params;
      const { status = 'published' } = req.body;

      const existing = await mockTestRepository.getTestById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Mock test not found.' }
        });
      }

      if (req.user.role === 'TEACHER' && existing.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Unauthorized.' }
        });
      }

      const updated = await mockTestRepository.updateTest(id, { status });

      return res.status(200).json({
        success: true,
        data: { test: updated },
        message: `Test status updated to '${status}'.`
      });
    } catch (err) {
      next(err);
    }
  },

  async releaseResults(req, res, next) {
    try {
      const { id } = req.params;
      const { batchId } = req.query;
      const result = await mockTestService.releaseAllTestResults(id, req.user, batchId || null);

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Examination results released to candidates.'
      });
    } catch (err) {
      next(err);
    }
  },

  async releaseAttemptResult(req, res, next) {
    try {
      const { attemptId } = req.params;
      const result = await mockTestService.releaseAttemptResult(attemptId, req.user);

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Examination result successfully released to candidate.'
      });
    } catch (err) {
      next(err);
    }
  },

  async generateResultsPdf(req, res, next) {
    try {
      const testId = req.params.testId || req.params.id;
      const { batchId } = req.query;

      const pdfBuffer = await mockTestService.generateResultsPdf(testId, req.user, batchId || null);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="linktest-results-${testId}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } catch (err) {
      next(err);
    }
  },

  async getTestAttempts(req, res, next) {
    try {
      const { id } = req.params;
      const attempts = await mockTestRepository.getAttemptsByTest(id);

      return res.status(200).json({ success: true, data: { attempts } });
    } catch (err) {
      next(err);
    }
  },

  async getProctoringEvents(req, res, next) {
    try {
      const { attemptId } = req.params;
      const events = await mockTestRepository.getProctoringEvents(attemptId);
      const attempt = await mockTestRepository.getAttemptById(attemptId);

      return res.status(200).json({
        success: true,
        data: {
          events,
          integrity_trust_index: attempt?.integrity_trust_index ?? 100,
          disqualified: Boolean(attempt?.disqualified),
          proctoring_summary: attempt?.proctoring_summary || {}
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async reviewProctoringEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const { review_status, review_notes } = req.body;
      const normalizedStatus = String(review_status || '').toLowerCase();

      if (!['dismissed', 'confirmed_violation', 'pending'].includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: 'review_status must be dismissed or confirmed_violation.' }
        });
      }

      const updated = await mockTestRepository.updateProctoringEventReview(
        eventId,
        normalizedStatus,
        review_notes || '',
        req.user.id
      );

      return res.status(200).json({
        success: true,
        data: { event: updated },
        message: 'Proctoring event review recorded.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getTestAnalytics(req, res, next) {
    try {
      const { id } = req.params;
      const analytics = await mockTestService.getTestAnalytics(id);

      return res.status(200).json({ success: true, data: analytics });
    } catch (err) {
      next(err);
    }
  },

  async generateAiQuestions(req, res, next) {
    try {
      const { subject, topic, syllabus, difficulty, count, question_types } = req.body;

      if (!subject || !topic) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Subject and Topic are required for AI generation.' }
        });
      }

      const result = await mockTestService.generateAiQuestions({
        subject,
        topic,
        syllabus,
        difficulty: difficulty || 'medium',
        count: parseInt(count || 5, 10),
        question_types: Array.isArray(question_types) ? question_types : ['mcq_single']
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Questions generated successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ---------------------------------------------------------------------------
  // 6. CANDIDATE JOIN APPROVAL WORKFLOW
  // ---------------------------------------------------------------------------

  async createJoinRequest(req, res, next) {
    try {
      const { id } = req.params;
      const test = await mockTestRepository.getTestById(id);
      if (!test) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Examination not found.' }
        });
      }

      if (test.status !== 'published') {
        return res.status(400).json({
          success: false,
          error: { code: 'TEST_UNAVAILABLE', message: 'This examination is currently unpublished or closed.' }
        });
      }

      const { isNew, request } = await mockTestJoinRequestRepository.createRequest({
        mockTestId: id,
        studentId: req.user.id,
        teacherId: test.created_by
      });

      await mockTestRepository.logAudit({
        testId: id,
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'MOCK_TEST_JOIN_REQUESTED',
        details: { requestId: request.id, status: request.status }
      });

      if (!isNew) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_ACTIVE_REQUEST',
            message: `You already have an active ${request.status.toLowerCase()} request for this mock test.`
          },
          code: 'DUPLICATE_ACTIVE_REQUEST',
          data: {
            id: request.id,
            mock_test_id: request.mock_test_id,
            mockTestId: request.mock_test_id,
            status: request.status
          }
        });
      }

      if (test.created_by) {
        notificationService.createNotification({
          userId: test.created_by,
          title: 'Student Requested Mock-Test Access',
          message: `${req.user.full_name || 'A student'} requested entry approval for "${test.title}".`,
          type: 'APPROVAL_REQUIRED',
          priority: 'HIGH',
          actionUrl: '/teacher',
          actionLabel: 'Review Request',
          relatedEntityType: 'MOCK_TEST_JOIN_REQUEST',
          relatedEntityId: request.id,
          eventKey: `teacher:${test.created_by}:request:${request.id}:APPROVAL_REQUIRED`
        }).catch(() => {});
      }

      return res.status(201).json({
        success: true,
        data: {
          id: request.id,
          mock_test_id: request.mock_test_id,
          mockTestId: request.mock_test_id,
          status: request.status,
          requested_at: request.requested_at,
          rejection_reason: request.rejection_reason
        },
        message: 'Join request sent to your teacher. Please wait for approval.'
      });
    } catch (err) {
      next(err);
    }
  },

  async getJoinRequestStatus(req, res, next) {
    try {
      const { id } = req.params;
      const request = await mockTestJoinRequestRepository.getLatestByStudentAndTest(req.user.id, id);

      return res.status(200).json({
        success: true,
        data: {
          status: request ? request.status : 'NONE',
          id: request ? request.id : null,
          mock_test_id: request ? request.mock_test_id : id,
          mockTestId: request ? request.mock_test_id : id,
          rejection_reason: request ? request.rejection_reason : null,
          requested_at: request ? request.requested_at : null,
          reviewed_at: request ? request.reviewed_at : null,
          request: request ? {
            id: request.id,
            status: request.status,
            requested_at: request.requested_at,
            reviewed_at: request.reviewed_at,
            rejection_reason: request.rejection_reason
          } : null
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async getTestJoinRequests(req, res, next) {
    try {
      const { id } = req.params;
      const test = await mockTestRepository.getTestById(id);
      if (!test) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Examination not found.' }
        });
      }

      // Authorization: teacher must own test or be admin
      if (req.user.role === 'TEACHER' && test.created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to view requests for this examination.' }
        });
      }

      const requests = await mockTestJoinRequestRepository.getRequestsForTeacher(
        req.user.role === 'ADMIN' ? 'ALL' : req.user.id,
        { mockTestId: id, status: req.query.status || 'ALL' }
      );

      return res.status(200).json({
        success: true,
        data: { requests }
      });
    } catch (err) {
      next(err);
    }
  },

  async getAllTeacherJoinRequests(req, res, next) {
    try {
      const teacherId = req.user.role === 'ADMIN' ? (req.query.teacher_id || 'ALL') : req.user.id;
      const requests = await mockTestJoinRequestRepository.getRequestsForTeacher(teacherId, {
        status: req.query.status || 'PENDING',
        mockTestId: req.query.mock_test_id || null,
        limit: parseInt(req.query.limit, 10) || 100,
        offset: parseInt(req.query.offset, 10) || 0
      });

      return res.status(200).json({
        success: true,
        data: { requests }
      });
    } catch (err) {
      next(err);
    }
  },

  async approveJoinRequest(req, res, next) {
    try {
      const { requestId } = req.params;
      const request = await mockTestJoinRequestRepository.getById(requestId);
      if (!request) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Join request not found.' }
        });
      }

      // Authorization: teacher must own test or be admin
      if (req.user.role === 'TEACHER' && request.test_owner_id !== req.user.id && request.teacher_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to approve this request.' }
        });
      }

      const updated = await mockTestJoinRequestRepository.approveRequest(requestId, req.user.id);
      if (!updated) {
        return res.status(409).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: 'Request is no longer pending or has already been reviewed.' }
        });
      }

      await mockTestRepository.logAudit({
        testId: request.mock_test_id,
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'MOCK_TEST_JOIN_APPROVED',
        details: { requestId, studentId: request.student_id }
      });

      // Unified Notification Event: notify student of approval
      notificationService.createNotification({
        userId: request.student_id,
        title: 'Teacher Approved Mock-Test Entry',
        message: `Your access request for "${request.mock_test_title || 'Mock Examination'}" has been approved. You can now start the test.`,
        type: 'SUCCESS',
        priority: 'HIGH',
        actionUrl: `/mock-tests/${request.mock_test_id}/check`,
        actionLabel: 'Join Mock Test',
        relatedEntityType: 'MOCK_TEST',
        relatedEntityId: request.mock_test_id,
        eventKey: `student:${request.student_id}:request:${request.id}:APPROVED`
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: { request: updated },
        message: `Approved join request for ${request.student_name || 'student'}.`
      });
    } catch (err) {
      next(err);
    }
  },

  async rejectJoinRequest(req, res, next) {
    try {
      const { requestId } = req.params;
      const { reason } = req.body || {};

      const request = await mockTestJoinRequestRepository.getById(requestId);
      if (!request) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Join request not found.' }
        });
      }

      // Authorization: teacher must own test or be admin
      if (req.user.role === 'TEACHER' && request.test_owner_id !== req.user.id && request.teacher_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to reject this request.' }
        });
      }

      const updated = await mockTestJoinRequestRepository.rejectRequest(requestId, req.user.id, reason || 'Request rejected by instructor');
      if (!updated) {
        return res.status(409).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: 'Request is no longer pending or has already been reviewed.' }
        });
      }

      await mockTestRepository.logAudit({
        testId: request.mock_test_id,
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'MOCK_TEST_JOIN_REJECTED',
        details: { requestId, studentId: request.student_id, reason }
      });

      // Unified Notification Event: notify student of rejection
      notificationService.createNotification({
        userId: request.student_id,
        title: 'Teacher Rejected Mock-Test Entry',
        message: `Your access request for "${request.mock_test_title || 'Mock Examination'}" was not approved${reason ? `: ${reason}` : '.'}`,
        type: 'WARNING',
        priority: 'NORMAL',
        actionUrl: '/mock-tests',
        actionLabel: 'View Examinations',
        relatedEntityType: 'MOCK_TEST',
        relatedEntityId: request.mock_test_id,
        eventKey: `student:${request.student_id}:request:${request.id}:REJECTED`
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: { request: updated },
        message: `Rejected join request for ${request.student_name || 'student'}.`
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Teacher manual evaluation of a student's answer (Long Answer or override)
   */
  async evaluateResponse(req, res, next) {
    try {
      const { attemptId, questionId } = req.params;
      const { score, comment } = req.body;

      if (score === undefined || isNaN(parseFloat(score))) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_SCORE', message: 'A numeric score must be provided.' }
        });
      }

      const numericScore = parseFloat(score);
      if (numericScore < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_SCORE', message: 'Awarded score cannot be negative.' }
        });
      }

      const question = await mockTestRepository.getQuestionById(questionId);
      if (question) {
        const maxMarks = parseFloat(question.marks || 0);
        if (maxMarks > 0 && numericScore > maxMarks) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'SCORE_EXCEEDS_MAX',
              message: `Awarded score (${numericScore}) cannot exceed maximum marks (${maxMarks}).`
            }
          });
        }
      }

      const updatedAttempt = await mockTestRepository.manuallyEvaluateResponse(
        attemptId,
        questionId,
        {
          score: numericScore,
          comment: comment || '',
          evaluatorId: req.user.id
        }
      );

      return res.status(200).json({
        success: true,
        data: { attempt: updatedAttempt },
        message: 'Response evaluation saved successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
};
