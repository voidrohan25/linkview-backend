import { Router } from 'express';
import { batchController } from '../controllers/batchController.js';
import { authenticateToken, requireAnyRole } from '../middleware/auth.js';

const router = Router();

// Student search requires authentication (Admin or Teacher only)
router.use(authenticateToken, requireAnyRole('ADMIN', 'TEACHER'));

router.get('/search', batchController.searchStudents);

export default router;
