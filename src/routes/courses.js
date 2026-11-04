import { Router } from 'express';
import { courseController } from '../controllers/courseController.js';
import { authenticateToken, optionalAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Public / optional auth
router.get('/', optionalAuth, courseController.getAll);
router.get('/enrolled/me', authenticateToken, courseController.getMyCourses);
router.get('/:id', optionalAuth, courseController.getById);

// Student actions
router.post('/:id/enroll', authenticateToken, courseController.enroll);

// Admin actions
router.post('/', authenticateToken, requireRole('ADMIN'), courseController.create);
router.put('/:id', authenticateToken, requireRole('ADMIN'), courseController.update);
router.delete('/:id', authenticateToken, requireRole('ADMIN'), courseController.delete);

export default router;
