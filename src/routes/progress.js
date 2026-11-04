import { Router } from 'express';
import { lessonController } from '../controllers/lessonController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/', authenticateToken, lessonController.setProgress);

export default router;
