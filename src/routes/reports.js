// Reports and PDF Exports API Routes
// LinkTest Enterprise Academic Platform

import { Router } from 'express';
import { authenticateToken, requireAnyRole } from '../middleware/auth.js';
import { mockTestController } from '../controllers/mockTestController.js';

const router = Router();

// Teacher & Admin: Generate unified PDF containing results of all authorized students for a mock test
router.get('/tests/:testId/results/pdf', authenticateToken, requireAnyRole('TEACHER', 'ADMIN'), mockTestController.generateResultsPdf);

export default router;
