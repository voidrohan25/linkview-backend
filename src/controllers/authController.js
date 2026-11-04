import { authService } from '../services/authService.js';
import { securityLogRepository } from '../repositories/securityLogRepository.js';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  googleAuthSchema
} from '../validators/index.js';
import { z } from 'zod';

const acceptInviteSchema = z.object({
  token: z.string().min(60, 'Invalid invitation token'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128)
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').max(255)
});

const resetPasswordSchema = z.object({
  token: z.string().min(60, 'Invalid reset token'),
  new_password: z.string().min(8, 'Password must be at least 8 characters').max(128)
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'Password must be at least 8 characters').max(128)
});

export const authController = {
  async register(req, res, next) {
    try {
      const validatedData = registerSchema.parse(req.body);
      const ipAddress = req.ip || req.headers['x-forwarded-for'];
      const userAgent = req.headers['user-agent'];
      const result = await authService.register({ ...validatedData, ipAddress, userAgent });
      await securityLogRepository.logEvent({
        eventType: 'REGISTER_SUCCESS',
        severity: 'INFO',
        userId: result.user?.id,
        userEmail: result.user?.email,
        ipAddress,
        userAgent,
        details: `New account registered for ${result.user?.email} (${result.user?.role || 'STUDENT'})`
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  async verifyEmail(req, res, next) {
    try {
      const validatedData = verifyEmailSchema.parse(req.body);
      const ipAddress = req.ip || req.headers['x-forwarded-for'];
      const userAgent = req.headers['user-agent'];
      const result = await authService.verifyEmail({ ...validatedData, ipAddress, userAgent });
      await securityLogRepository.logEvent({
        eventType: 'EMAIL_VERIFIED',
        severity: 'INFO',
        userId: result.user?.id,
        userEmail: result.user?.email,
        ipAddress,
        userAgent,
        details: `Email verified successfully for ${result.user?.email}`
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  async resendVerification(req, res, next) {
    try {
      const validatedData = resendVerificationSchema.parse(req.body);
      const ipAddress = req.ip || req.headers['x-forwarded-for'];
      const userAgent = req.headers['user-agent'];
      const result = await authService.resendVerification({ ...validatedData, ipAddress, userAgent });
      return res.status(200).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    let attemptedEmail = null;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    try {
      const validatedData = loginSchema.parse(req.body);
      attemptedEmail = validatedData.email;
      const result = await authService.login(validatedData);

      await securityLogRepository.logEvent({
        eventType: 'LOGIN_SUCCESS',
        severity: 'INFO',
        userId: result.user?.id,
        userEmail: result.user?.email,
        ipAddress,
        userAgent,
        details: `User ${result.user?.email} (${result.user?.role}) logged in successfully`
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Login successful.'
      });
    } catch (err) {
      if (attemptedEmail) {
        await securityLogRepository.logEvent({
          eventType: 'LOGIN_FAILED',
          severity: 'WARNING',
          userEmail: attemptedEmail,
          ipAddress,
          userAgent,
          details: `Failed login attempt for ${attemptedEmail}: ${err.message || 'Invalid credentials'}`,
          metadata: { errorCode: err.code || 'UNAUTHORIZED' }
        }).catch(() => {});
      }
      next(err);
    }
  },

  async getMe(req, res) {
    return res.status(200).json({
      success: true,
      data: { user: req.user },
      message: 'User profile retrieved.'
    });
  },

  async acceptTeacherInvite(req, res, next) {
    try {
      const { token, password } = acceptInviteSchema.parse(req.body);
      const result = await authService.acceptTeacherInvite({ token, password });
      return res.status(201).json({
        success: true,
        data: result,
        message: 'Teacher account activated successfully. Welcome to LinkTest!'
      });
    } catch (err) {
      next(err);
    }
  },

  async forgotPassword(req, res, next) {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const result = await authService.forgotPassword({ email });
      return res.status(200).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req, res, next) {
    try {
      const { token, new_password } = resetPasswordSchema.parse(req.body);
      const result = await authService.resetPassword({ token, newPassword: new_password });
      await securityLogRepository.logEvent({
        eventType: 'PASSWORD_RESET_SUCCESS',
        severity: 'INFO',
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        details: 'Password successfully reset via secure token'
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req, res, next) {
    try {
      const { current_password, new_password } = changePasswordSchema.parse(req.body);
      const result = await authService.changePassword({
        userId: req.user.id,
        currentPassword: current_password,
        newPassword: new_password
      });
      await securityLogRepository.logEvent({
        eventType: 'PASSWORD_CHANGED',
        severity: 'INFO',
        userId: req.user.id,
        userEmail: req.user.email,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        details: `Password changed for user ${req.user.email}`
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      await securityLogRepository.logEvent({
        eventType: 'PASSWORD_CHANGE_FAILED',
        severity: 'WARNING',
        userId: req.user?.id,
        userEmail: req.user?.email,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        details: `Failed password change attempt: ${err.message}`
      }).catch(() => {});
      next(err);
    }
  },

  async googleAuth(req, res, next) {
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    try {
      const { credential } = googleAuthSchema.parse(req.body);

      const result = await authService.loginWithGoogle({ credential });

      await securityLogRepository.logEvent({
        eventType: result.is_new_user ? 'OAUTH_REGISTER_SUCCESS' : 'OAUTH_LOGIN_SUCCESS',
        severity: 'INFO',
        userId: result.user?.id,
        userEmail: result.user?.email,
        ipAddress,
        userAgent,
        details: `Google authentication successful for ${result.user?.email} (${result.user?.role})`,
        metadata: {
          authMethod: 'GOOGLE',
          role: result.user?.role,
          userId: result.user?.id,
          action: result.is_new_user ? 'GOOGLE_REGISTER' : (result.account_linked ? 'GOOGLE_ACCOUNT_LINKED' : 'GOOGLE_SIGN_IN'),
          isNewUser: Boolean(result.is_new_user),
          accountLinked: Boolean(result.account_linked)
        }
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        data: result,
        message: result.is_new_user
          ? 'Account created and verified with Google! Welcome to LinkTest.'
          : (result.account_linked
              ? 'Your existing LinkTest account has been linked to your Google identity.'
              : 'Google sign-in successful.')
      });
    } catch (err) {
      await securityLogRepository.logEvent({
        eventType: 'OAUTH_LOGIN_FAILED',
        severity: 'WARNING',
        ipAddress,
        userAgent,
        details: `Google OAuth verification failed: ${err.message}`,
        metadata: {
          authMethod: 'GOOGLE',
          action: 'GOOGLE_SIGN_IN_FAILED',
          errorCode: err.code || 'UNAUTHORIZED'
        }
      }).catch(() => {});
      next(err);
    }
  },

  async unlinkGoogle(req, res, next) {
    try {
      const { password } = z.object({
        password: z.string().optional()
      }).parse(req.body);

      const result = await authService.unlinkGoogle(req.user.id, { password });
      return res.status(200).json({
        success: true,
        data: result,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  },

  async logout(req, res, next) {
    try {
      if (req.user) {
        await securityLogRepository.logEvent({
          eventType: 'LOGOUT',
          severity: 'INFO',
          userId: req.user.id,
          userEmail: req.user.email,
          ipAddress: req.ip || req.headers['x-forwarded-for'],
          userAgent: req.headers['user-agent'],
          details: `User ${req.user.email} logged out successfully`
        }).catch(() => {});
      }
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
};
