import rateLimit from 'express-rate-limit';
import { securityLogRepository } from '../repositories/securityLogRepository.js';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per window
  skip: () => process.env.NODE_ENV === 'test' || process.env.MOCK_EMAIL === 'true',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for'];
    securityLogRepository.logEvent({
      eventType: 'RATE_LIMIT_EXCEEDED',
      severity: 'HIGH',
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
      details: `Authentication rate limit exceeded for IP: ${ip} on ${req.method} ${req.originalUrl}`,
      metadata: { endpoint: req.originalUrl, method: req.method }
    }).catch(() => {});

    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.'
      }
    });
  }
});

export const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for'];
    securityLogRepository.logEvent({
      eventType: 'RATE_LIMIT_EXCEEDED',
      severity: 'WARNING',
      userId: req.user?.id,
      userEmail: req.user?.email,
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
      details: `AI endpoint rate limit exceeded for IP: ${ip}`,
      metadata: { endpoint: req.originalUrl }
    }).catch(() => {});

    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many AI requests. Please slow down and try again shortly.'
      }
    });
  }
});
