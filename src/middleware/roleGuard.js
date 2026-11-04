import { authenticateToken } from './auth.js';
import { securityLogRepository } from '../repositories/securityLogRepository.js';

/**
 * Standard unauthorized (401) JSON response
 */
function sendUnauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message
    }
  });
}

/**
 * Standard forbidden (403) JSON response
 */
function sendForbidden(res, message = 'Forbidden') {
  return res.status(403).json({
    success: false,
    error: {
      code: 'FORBIDDEN',
      message
    }
  });
}

/**
 * Require an exact role (single role check)
 * Usage: requireRole('ADMIN')
 *
 * Allows only the exact requested role:
 * - requireRole('ADMIN') allows ADMIN only.
 * - requireRole('TEACHER') allows TEACHER only.
 * - requireRole('STUDENT') allows STUDENT only.
 *
 * Rejects unauthenticated/invalid requests with 401 UNAUTHORIZED.
 * Rejects authenticated requests with insufficient role with 403 FORBIDDEN.
 * Prevents client role spoofing via body, params, query, or headers.
 */
export function requireRole(requiredRole) {
  if (!requiredRole || typeof requiredRole !== 'string') {
    throw new Error('requireRole requires a valid role string.');
  }

  return (req, res, next) => {
    // If authenticateToken was not yet executed or req.user is missing, authenticate first
    if (!req.user) {
      return authenticateToken(req, res, () => {
        executeExactRoleCheck(req, res, next, requiredRole);
      });
    }

    executeExactRoleCheck(req, res, next, requiredRole);
  };
}

function executeExactRoleCheck(req, res, next, requiredRole) {
  if (!req.user) {
    return sendUnauthorized(res);
  }

  // Never trust client-supplied roles (req.body.role, req.params.role, req.query.role, headers)
  // Strictly use the server-verified role attached to req.user
  const authenticatedRole = req.user.role;

  if (authenticatedRole !== requiredRole) {
    securityLogRepository.logEvent({
      eventType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      severity: 'WARNING',
      userId: req.user.id,
      userEmail: req.user.email,
      ipAddress: req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1',
      userAgent: (req.headers && req.headers['user-agent']) || 'unknown',
      details: `User with role ${authenticatedRole} attempted to access route requiring exact role ${requiredRole}: ${req.method || 'UNKNOWN'} ${req.originalUrl || req.url || ''}`,
      metadata: { path: req.originalUrl || req.url, method: req.method, requiredRole, userRole: authenticatedRole }
    }).catch(() => {});

    return sendForbidden(res);
  }

  next();
}

/**
 * Require any of the specified roles (multi-role check)
 * Usage: requireAnyRole('TEACHER', 'ADMIN')
 *
 * Allows access when the authenticated user's role matches any of the supplied roles.
 * Example: requireAnyRole('TEACHER', 'ADMIN') allows both TEACHER and ADMIN but rejects STUDENT.
 *
 * Rejects unauthenticated/invalid requests with 401 UNAUTHORIZED.
 * Rejects authenticated requests with insufficient role with 403 FORBIDDEN.
 * Prevents client role spoofing via body, params, query, or headers.
 */
export function requireAnyRole(...roles) {
  const allowedRoles = roles.flat().filter(r => typeof r === 'string' && r.length > 0);

  if (allowedRoles.length === 0) {
    throw new Error('requireAnyRole requires at least one role argument.');
  }

  return (req, res, next) => {
    // If authenticateToken was not yet executed or req.user is missing, authenticate first
    if (!req.user) {
      return authenticateToken(req, res, () => {
        executeAnyRoleCheck(req, res, next, allowedRoles);
      });
    }

    executeAnyRoleCheck(req, res, next, allowedRoles);
  };
}

function executeAnyRoleCheck(req, res, next, allowedRoles) {
  if (!req.user) {
    return sendUnauthorized(res);
  }

  // Strictly use server-verified role from req.user
  const authenticatedRole = req.user.role;

  if (!authenticatedRole || !allowedRoles.includes(authenticatedRole)) {
    securityLogRepository.logEvent({
      eventType: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      severity: 'WARNING',
      userId: req.user.id,
      userEmail: req.user.email,
      ipAddress: req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1',
      userAgent: (req.headers && req.headers['user-agent']) || 'unknown',
      details: `User with role ${authenticatedRole} attempted to access route requiring one of [${allowedRoles.join(', ')}]: ${req.method || 'UNKNOWN'} ${req.originalUrl || req.url || ''}`,
      metadata: { path: req.originalUrl || req.url, method: req.method, requiredRoles: allowedRoles, userRole: authenticatedRole }
    }).catch(() => {});

    return sendForbidden(res);
  }

  next();
}

export default {
  requireRole,
  requireAnyRole
};
