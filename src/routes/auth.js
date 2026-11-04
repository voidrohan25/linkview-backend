import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/register', authLimiter, authController.register);
router.post('/verify-email', authLimiter, authController.verifyEmail);
router.post('/resend-verification', authLimiter, authController.resendVerification);
router.post('/login', authLimiter, authController.login);
router.post('/google', authLimiter, authController.googleAuth);
router.post('/google/unlink', authenticateToken, authController.unlinkGoogle);
router.get('/me', authenticateToken, authController.getMe);

// Teacher invitation acceptance
router.post('/accept-invite', authLimiter, authController.acceptTeacherInvite);
router.post('/teacher-accept-invite', authLimiter, authController.acceptTeacherInvite);

// Password reset
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);

// Change password (authenticated)
router.post('/change-password', authenticateToken, authController.changePassword);

// Logout
router.post('/logout', authController.logout);

export default router;
