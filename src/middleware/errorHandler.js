import { ZodError } from 'zod';
import { config } from '../config/env.js';

export function errorHandler(err, req, res, next) {
  // Structured error logging with request ID
  console.error(`[LinkTest Error][Req: ${req.id || 'N/A'}]`, err.message || err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      request_id: req.id,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        details: err.errors
      }
    });
  }

  // PostgreSQL database error handling
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      request_id: req.id,
      error: {
        code: 'FOREIGN_KEY_VIOLATION',
        message: 'A referenced resource (such as course, class, or faculty member) does not exist.'
      }
    });
  }

  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      request_id: req.id,
      error: {
        code: 'CONFLICT',
        message: 'A record with this unique identifier or code already exists.'
      }
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');

  // Operational errors (like AI service failures) provide safe, actionable error messages without leaking secrets
  const isOperationalError = Boolean(err.isAiError || err.code === 'AI_SERVICE_ERROR' || err.isOperational);

  // In production, mask unhandled internal crashes, but allow sanitized operational error messages
  const message = (config.nodeEnv === 'production' && statusCode >= 500 && !isOperationalError)
    ? 'An internal server error occurred. Please try again later.'
    : (err.message || 'An unexpected error occurred.');

  return res.status(statusCode).json({
    success: false,
    request_id: req.id,
    error: {
      code: errorCode,
      message,
      ...(err.details ? { details: err.details } : {})
    }
  });
}
