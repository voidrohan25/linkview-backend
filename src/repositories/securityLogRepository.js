import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import crypto from 'crypto';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Sanitize metadata to guarantee no passwords, secrets, bearer tokens, or API keys are ever recorded.
 */
export function sanitizeSecurityData(data) {
  if (!data) return data;
  if (typeof data === 'string') {
    let sanitized = data.replace(
      /(password|confirm_?password|new_?password|current_?password|token|refresh_?token|access_?token|secret|jwt|authorization|api_?key)=[^&\s]+/gi,
      '$1=[REDACTED]'
    );
    sanitized = sanitized.replace(
      /"(password|confirm_?password|new_?password|current_?password|token|refresh_?token|access_?token|secret|jwt|authorization|api_?key)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    );
    return sanitized;
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeSecurityData(item));
  }
  if (typeof data === 'object') {
    const copy = { ...data };
    const sensitiveKeys = [
      'password',
      'confirmpassword',
      'confirm_password',
      'newpassword',
      'new_password',
      'currentpassword',
      'current_password',
      'token',
      'refreshtoken',
      'refresh_token',
      'accesstoken',
      'access_token',
      'secret',
      'jwt',
      'authorization',
      'apikey',
      'api_key'
    ];
    for (const key of Object.keys(copy)) {
      if (sensitiveKeys.includes(key.toLowerCase().replace(/[-_]/g, ''))) {
        copy[key] = '[REDACTED]';
      } else if (typeof copy[key] === 'object' && copy[key] !== null) {
        copy[key] = sanitizeSecurityData(copy[key]);
      } else if (typeof copy[key] === 'string') {
        copy[key] = sanitizeSecurityData(copy[key]);
      }
    }
    return copy;
  }
  return data;
}

/**
 * Compute cryptographic SHA-256 tamper-evident integrity hash for a security log record
 */
export function computeSecurityIntegrityHash(record, previousHash = GENESIS_HASH) {
  const canonicalPayload = JSON.stringify({
    id: record.id,
    event_type: record.event_type,
    severity: record.severity,
    user_id: record.user_id || null,
    user_email: record.user_email || null,
    target_resource: record.target_resource || null,
    ip_address: record.ip_address || null,
    user_agent: record.user_agent || null,
    details: record.details || '',
    metadata: record.metadata || null,
    created_at: record.created_at,
    previous_hash: previousHash
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

/**
 * Canonical asynchronous method to record a security / authentication / authorization event
 */
export async function recordSecurityLog(firstArg = {}, ...rest) {
  let params = {};
  if (firstArg && typeof firstArg === 'object') {
    params = { ...firstArg };
  } else if (typeof firstArg === 'string') {
    // Positional fallback: (eventType, severity, userId, userEmail, ipAddress, userAgent, details, metadata)
    params = {
      eventType: firstArg,
      severity: rest[0],
      userId: rest[1],
      userEmail: rest[2],
      ipAddress: rest[3],
      userAgent: rest[4],
      details: rest[5],
      metadata: rest[6]
    };
  }

  const id = params.id || `sec-${crypto.randomUUID().slice(0, 12)}`;
  const eventType = params.eventType || params.event_type || params.action || params.actionType || 'SECURITY_EVENT';
  const severity = params.severity || 'INFO';
  const userId = params.userId || params.user_id || params.actorId || params.actor_id || null;
  const userEmail = params.userEmail || params.user_email || params.actorEmail || params.actor_email || null;
  const ipAddress = params.ipAddress || params.ip_address || null;
  const userAgent = params.userAgent || params.user_agent ? String(params.userAgent || params.user_agent).slice(0, 1000) : null;
  const targetResource = params.targetResource || params.target_resource || (
    params.resourceType && params.resourceId ? `${params.resourceType}:${params.resourceId}` : (params.resourceType || params.resourceId || null)
  );
  const now = params.createdAt || params.created_at || params.timestamp || new Date().toISOString();

  const cleanDetails = sanitizeSecurityData(params.details || params.summary || '') || '';
  const cleanMetadata = sanitizeSecurityData(params.metadata);

  try {
    let previousHash = GENESIS_HASH;

    if (isPostgresConnected && pool) {
      if (params.previousHash || params.previous_hash) {
        previousHash = params.previousHash || params.previous_hash;
      } else {
        try {
          const lastRow = await pool.query(
            'SELECT integrity_hash FROM security_logs WHERE integrity_hash IS NOT NULL ORDER BY sequence_no DESC NULLS LAST, created_at DESC, id DESC LIMIT 1'
          );
          if (lastRow.rows.length > 0 && lastRow.rows[0].integrity_hash) {
            previousHash = lastRow.rows[0].integrity_hash;
          }
        } catch (err) {
          // Fallback to genesis if query fails
        }
      }

      const tempRecord = {
        id,
        event_type: eventType,
        severity,
        user_id: userId,
        user_email: userEmail,
        target_resource: targetResource,
        ip_address: ipAddress,
        user_agent: userAgent,
        details: cleanDetails,
        metadata: cleanMetadata,
        created_at: now
      };
      const integrityHash = computeSecurityIntegrityHash(tempRecord, previousHash);

      await pool.query(
        `INSERT INTO security_logs (id, event_type, severity, user_id, user_email, ip_address, user_agent, details, metadata, target_resource, previous_hash, integrity_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          eventType,
          severity,
          userId,
          userEmail,
          ipAddress,
          userAgent,
          cleanDetails,
          cleanMetadata ? JSON.stringify(cleanMetadata) : null,
          targetResource,
          previousHash,
          integrityHash,
          now
        ]
      );

      return {
        ...tempRecord,
        previous_hash: previousHash,
        integrity_hash: integrityHash
      };
    }

    // Memory Store fallback
    if (!memoryStore.security_logs) memoryStore.security_logs = [];
    if (params.previousHash || params.previous_hash) {
      previousHash = params.previousHash || params.previous_hash;
    } else {
      const list = memoryStore.security_logs;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].integrity_hash) {
          previousHash = list[i].integrity_hash;
          break;
        }
      }
    }

    const record = {
      id,
      event_type: eventType,
      severity,
      user_id: userId,
      user_email: userEmail,
      ip_address: ipAddress,
      user_agent: userAgent,
      details: cleanDetails,
      metadata: cleanMetadata,
      target_resource: targetResource,
      previous_hash: previousHash,
      integrity_hash: computeSecurityIntegrityHash({
        id,
        event_type: eventType,
        severity,
        user_id: userId,
        user_email: userEmail,
        target_resource: targetResource,
        ip_address: ipAddress,
        user_agent: userAgent,
        details: cleanDetails,
        metadata: cleanMetadata,
        created_at: now
      }, previousHash),
      created_at: now
    };
    memoryStore.security_logs.push(record);
    return record;
  } catch (err) {
    console.error('[SecurityLog] Failed to record security event:', err.message);
  }
}

/**
 * Backward compatible alias for recordSecurityLog
 */
export async function logEvent(...args) {
  return recordSecurityLog(...args);
}

export const securityLogRepository = {
  recordSecurityLog,
  logEvent,
  sanitizeSecurityData,
  computeSecurityIntegrityHash,

  /**
   * Retrieve filtered & paginated security logs
   */
  async getLogs({
    eventType,
    event_type,
    action,
    category,
    severity,
    userId,
    user_id,
    actorId,
    actor_id,
    targetResource,
    target_resource,
    search,
    startDate,
    start_date,
    endDate,
    end_date,
    limit = 20,
    offset = 0,
    page
  } = {}) {
    const pageLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const pageOffset = offset !== undefined && offset !== null
      ? Math.max(0, parseInt(offset, 10) || 0)
      : (Math.max(1, parseInt(page, 10) || 1) - 1) * pageLimit;

    const filterEventType = eventType || event_type || action || category;
    const filterUserId = userId || user_id || actorId || actor_id;
    const filterTargetResource = targetResource || target_resource;
    const filterStartDate = startDate || start_date;
    const filterEndDate = endDate || end_date;

    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];

      if (filterEventType && filterEventType !== 'ALL') {
        params.push(filterEventType);
        where += ` AND event_type = $${params.length}`;
      }

      if (severity && severity !== 'ALL') {
        params.push(severity);
        where += ` AND severity = $${params.length}`;
      }

      if (filterUserId) {
        params.push(filterUserId);
        where += ` AND (user_id = $${params.length} OR user_email = $${params.length})`;
      }

      if (filterTargetResource && filterTargetResource !== 'ALL') {
        params.push(filterTargetResource);
        where += ` AND target_resource = $${params.length}`;
      }

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        where += ` AND (
          LOWER(event_type) LIKE $${params.length}
          OR LOWER(COALESCE(user_email, '')) LIKE $${params.length}
          OR LOWER(COALESCE(details, '')) LIKE $${params.length}
          OR LOWER(COALESCE(ip_address, '')) LIKE $${params.length}
          OR LOWER(COALESCE(user_id, '')) LIKE $${params.length}
          OR LOWER(COALESCE(target_resource, '')) LIKE $${params.length}
        )`;
      }

      if (filterStartDate) {
        params.push(filterStartDate);
        where += ` AND created_at >= $${params.length}`;
      }

      if (filterEndDate) {
        params.push(filterEndDate);
        where += ` AND created_at <= $${params.length}`;
      }

      const countRes = await pool.query(`SELECT COUNT(*)::int as count FROM security_logs ${where}`, params);
      const total = countRes.rows[0]?.count || 0;

      const dataQuery = `
        SELECT id, event_type, severity, user_id, user_email, ip_address, user_agent, details, metadata, target_resource, previous_hash, integrity_hash, created_at
        FROM security_logs
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
      const dataRes = await pool.query(dataQuery, [...params, pageLimit, pageOffset]);

      return {
        logs: dataRes.rows,
        total,
        page: Math.floor(pageOffset / pageLimit) + 1,
        totalPages: Math.ceil(total / pageLimit) || 1,
        limit: pageLimit
      };
    }

    // Memory Store fallback
    let list = [...(memoryStore.security_logs || [])];

    if (filterEventType && filterEventType !== 'ALL') list = list.filter(l => l.event_type === filterEventType);
    if (severity && severity !== 'ALL') list = list.filter(l => l.severity === severity);
    if (filterUserId) list = list.filter(l => l.user_id === filterUserId || l.user_email === filterUserId);
    if (filterTargetResource && filterTargetResource !== 'ALL') list = list.filter(l => l.target_resource === filterTargetResource);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(l =>
        l.event_type?.toLowerCase().includes(q) ||
        l.user_email?.toLowerCase().includes(q) ||
        l.details?.toLowerCase().includes(q) ||
        l.ip_address?.toLowerCase().includes(q) ||
        l.user_id?.toLowerCase().includes(q) ||
        l.target_resource?.toLowerCase().includes(q)
      );
    }
    if (filterStartDate) list = list.filter(l => new Date(l.created_at) >= new Date(filterStartDate));
    if (filterEndDate) list = list.filter(l => new Date(l.created_at) <= new Date(filterEndDate));

    const total = list.length;
    const sorted = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const paged = sorted.slice(pageOffset, pageOffset + pageLimit);

    return {
      logs: paged,
      total,
      page: Math.floor(pageOffset / pageLimit) + 1,
      totalPages: Math.ceil(total / pageLimit) || 1,
      limit: pageLimit
    };
  }
};
