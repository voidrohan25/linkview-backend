// Mock Test & Secure AI Examination System API Routes
// LinkTest Enterprise LMS

import { Router } from 'express';
import { mockTestController } from '../controllers/mockTestController.js';
import { authenticateToken, optionalAuth, requireAnyRole, requireRole } from '../middleware/auth.js';

const router = Router();

// --- Student Discovery & History Routes ---
router.get('/', optionalAuth, mockTestController.getAllTests);
router.get('/my-attempts', authenticateToken, requireRole('STUDENT'), mockTestController.getMyAttempts);
router.get('/my-results', authenticateToken, requireRole('STUDENT'), mockTestController.getMyResults);

// --- Teacher/Admin Test Question Generation (AI) ---
router.post('/generate-questions', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.generateAiQuestions);

// --- Candidate Active Examination Session Routes ---
router.post('/:id/attempts', authenticateToken, requireRole('STUDENT'), mockTestController.startAttempt);
router.get('/attempts/:attemptId', authenticateToken, mockTestController.getAttempt);
router.put('/attempts/:attemptId/answers', authenticateToken, mockTestController.saveAnswer);
router.post('/attempts/:attemptId/events', authenticateToken, mockTestController.logProctoringEvent);
router.post('/attempts/:attemptId/proctoring-events', authenticateToken, mockTestController.logProctoringEvent);
router.post('/attempts/:attemptId/security-event', authenticateToken, mockTestController.logProctoringEvent);
router.post('/attempts/:attemptId/submit', authenticateToken, mockTestController.submitAttempt);
router.get('/attempts/:attemptId/result', authenticateToken, mockTestController.getAttemptResult);
router.post('/attempts/:attemptId/responses/:questionId/evaluate', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.evaluateResponse);
router.post('/attempts/:attemptId/questions/:questionId/evaluate', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.evaluateResponse);
router.post('/attempts/:attemptId/release', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.releaseAttemptResult);

// --- Teacher & Admin Proctoring Event Oversight ---
router.get('/attempts/:attemptId/proctoring-events', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.getProctoringEvents);
router.post('/events/:eventId/review', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.reviewProctoringEvent);

// --- Join Request & Teacher Approval Routes ---
router.get('/join-requests/all', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.getAllTeacherJoinRequests);
router.post('/join-requests/:requestId/approve', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.approveJoinRequest);
router.post('/join-requests/:requestId/reject', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.rejectJoinRequest);
router.post('/:id/join-request', authenticateToken, requireRole('STUDENT'), mockTestController.createJoinRequest);
router.get('/:id/join-request', authenticateToken, requireRole('STUDENT'), mockTestController.getJoinRequestStatus);
router.get('/:id/join-requests', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.getTestJoinRequests);

// --- Test Specific Routes ---
router.get('/:id', optionalAuth, mockTestController.getTestById);
router.get('/:id/attempts', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.getTestAttempts);
router.get('/:id/analytics', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.getTestAnalytics);

// --- Teacher & Admin Test Authoring & Management ---
router.post('/', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.createMockTest);
router.put('/:id', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.updateMockTest);
router.delete('/:id', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.deleteMockTest);
router.post('/:id/duplicate', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.duplicateMockTest);
router.post('/:id/publish', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.publishMockTest);
router.post('/:id/release-results', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.releaseResults);
router.get('/:id/results/pdf', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.generateResultsPdf);

export default router;
