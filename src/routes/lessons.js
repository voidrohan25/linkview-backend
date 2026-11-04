import { Router } from 'express';
import { lessonController } from '../controllers/lessonController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/course/:courseId', authenticateToken, lessonController.getLessonsByCourse);
router.get('/:id', authenticateToken, lessonController.getLessonById);

// Admin lesson administration
router.post('/course/:courseId', authenticateToken, requireRole('ADMIN'), lessonController.createLesson);
router.put('/:id', authenticateToken, requireRole('ADMIN'), lessonController.updateLesson);
router.delete('/:id', authenticateToken, requireRole('ADMIN'), lessonController.deleteLesson);

export default router;
