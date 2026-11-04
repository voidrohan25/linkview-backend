// Coding Submissions & Execution Routes
// LinkTest Enterprise Examination System

import { Router } from 'express';
import { codingController } from '../controllers/codingController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// All coding routes require authentication
router.use(authenticateToken);

// Standalone sandbox execution runner
router.post('/execute', codingController.execute);

// Candidate [Run Code] during test (public test cases only)
router.post('/run', codingController.runPublicTestCases);

// Submit coding question
router.post('/', codingController.submitSolution);
router.post('/submit', codingController.submitSolution);

// Specific submission operations
router.get('/:id', codingController.getSubmissionById);
router.post('/:id/run', codingController.runExistingSubmission);
router.post('/:id/submit', codingController.submitSolution);

// Query submissions (students see own; teachers/admins see all)
router.get('/', codingController.listSubmissions);

export default router;
