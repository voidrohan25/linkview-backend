import { Router } from 'express';
import { adminController } from '../controllers/adminController.js';
import { authenticateToken, requireAnyRole, requireRole } from '../middleware/auth.js';

const router = Router();

// Administrators and teachers can retrieve the curriculum subjects catalog
router.get('/', authenticateToken, requireAnyRole('ADMIN', 'TEACHER'), adminController.getSubjects);

// Only Administrators can create new curriculum subjects
router.post('/', authenticateToken, requireRole('ADMIN'), adminController.createSubject);

export default router;
