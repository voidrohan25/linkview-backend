import { Router } from 'express';
import { aiController } from '../controllers/aiController.js';
import { authenticateToken } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/status', aiController.getStatus);
router.get('/health', aiController.getStatus);
router.post('/init', aiController.initOllama);
router.post('/chat', authenticateToken, aiLimiter, aiController.chat);
router.post('/generate-quiz', authenticateToken, aiLimiter, aiController.generateQuiz);

export default router;
