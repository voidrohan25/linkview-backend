// Audit log utility — records administrative and operational actions with tamper-evident metadata
import { pool, isPostgresConnected, memoryStore } from '../db/index.js';
import { sanitizeSecurityData } from './securityLogRepository.js';
import crypto from 'crypto';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Compute cryptographic SHA-256 tamper-evident integrity hash for an audit log record
 */
export function computeAuditIntegrityHash(record, previousHash = GENESIS_HASH) {
  const canonicalPayload = JSON.stringify({
    id: record.id,
    actor_id: record.actor_id || null,
    actor_email: record.actor_email || null,
    action: record.action || 'UNKNOWN_ACTION',
    resource_type: record.resource_type || null,
    resource_id: record.resource_id || null,
    target_resource: record.target_resource || null,
    summary: record.summary || '',
    ip_address: record.ip_address || null,
    user_agent: record.user_agent || null,
    created_at: record.created_at,
    previous_hash: previousHash
  });
  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

/**
 * Canonical asynchronous method to record an immutable audit event
 */
export async function recordAuditLog(firstArg, ...rest) {
  let actorId = null;
  let actorEmail = null;
  let action = 'UNKNOWN_ACTION';
  let resourceType = null;
  let resourceId = null;
  let targetResource = null;
  let summary = '';
  let ipAddress = null;
  let userAgent = null;
  let createdAt = null;

  if (firstArg && typeof firstArg === 'object' && (firstArg.id || firstArg.email) && typeof rest[0] === 'string') {
    // Legacy positional call: (user, action, resourceType, resourceId, summary, ipAddress, userAgent)
    actorId = firstArg.id || null;
    actorEmail = firstArg.email || null;
    action = rest[0] || 'UNKNOWN_ACTION';
    resourceType = rest[1] || null;
    resourceId = rest[2] || null;
    summary = rest[3] || '';
    ipAddress = rest[4] || null;
    userAgent = rest[5] || null;
  } else if (firstArg && typeof firstArg === 'object') {
    // Modern object call with camelCase, snake_case, and legacy aliases
    actorId = firstArg.actorId || firstArg.actor_id || firstArg.userId || firstArg.user_id || (firstArg.user && firstArg.user.id) || null;
    actorEmail = firstArg.actorEmail || firstArg.actor_email || firstArg.userEmail || firstArg.user_email || (firstArg.user && firstArg.user.email) || null;
    action = firstArg.action || firstArg.actionType || firstArg.action_type || firstArg.category || 'UNKNOWN_ACTION';
    resourceType = firstArg.resourceType || firstArg.resource_type || null;
    resourceId = firstArg.resourceId || firstArg.resource_id || null;
    targetResource = firstArg.targetResource || firstArg.target_resource || null;
    summary = firstArg.summary || (typeof firstArg.details === 'string' ? firstArg.details : (firstArg.details ? JSON.stringify(firstArg.details) : '')) || '';
    ipAddress = firstArg.ipAddress || firstArg.ip_address || firstArg.ip || null;
    userAgent = firstArg.userAgent || firstArg.user_agent || null;
    createdAt = firstArg.createdAt || firstArg.created_at || firstArg.timestamp || null;
  }

  if (!targetResource) {
    if (resourceType && resourceId) {
      targetResource = `${resourceType}:${resourceId}`;
    } else {
      targetResource = resourceType || resourceId || null;
    }
  }

  const id = crypto.randomUUID();
  const timestamp = createdAt || new Date().toISOString();
  const cleanSummary = sanitizeSecurityData(summary) || '';
  const cleanUserAgent = userAgent ? String(userAgent).slice(0, 1000) : null;

  try {
    let previousHash = GENESIS_HASH;

    if (isPostgresConnected && pool) {
      let validActorId = actorId;
      if (validActorId) {
        try {
          const uRes = await pool.query('SELECT 1 FROM users WHERE id = $1 LIMIT 1', [validActorId]);
          if (uRes.rows.length === 0) {
            validActorId = null;
          }
        } catch {
          validActorId = null;
        }
      }

      if (firstArg && typeof firstArg === 'object' && (firstArg.previousHash || firstArg.previous_hash)) {
        previousHash = firstArg.previousHash || firstArg.previous_hash;
      } else {
        try {
          const lastRow = await pool.query(
            'SELECT integrity_hash FROM audit_logs WHERE integrity_hash IS NOT NULL ORDER BY sequence_no DESC NULLS LAST, created_at DESC, id DESC LIMIT 1'
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
        actor_id: validActorId,
        actor_email: actorEmail,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        target_resource: targetResource,
        summary: cleanSummary,
        ip_address: ipAddress,
        user_agent: cleanUserAgent,
        created_at: timestamp
      };
      const integrityHash = computeAuditIntegrityHash(tempRecord, previousHash);

      await pool.query(
        `INSERT INTO audit_logs (id, actor_id, actor_email, action, resource_type, resource_id, target_resource, summary, ip_address, user_agent, previous_hash, integrity_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          validActorId,
          actorEmail,
          action,
          resourceType,
          resourceId,
          targetResource,
          cleanSummary,
          ipAddress,
          cleanUserAgent,
          previousHash,
          integrityHash,
          timestamp
        ]
      );

      return {
        ...tempRecord,
        previous_hash: previousHash,
        integrity_hash: integrityHash
      };
    }

    // Memory Store fallback
    if (!memoryStore.audit_logs) memoryStore.audit_logs = [];
    if (firstArg && typeof firstArg === 'object' && (firstArg.previousHash || firstArg.previous_hash)) {
      previousHash = firstArg.previousHash || firstArg.previous_hash;
    } else {
      const list = memoryStore.audit_logs;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].integrity_hash) {
          previousHash = list[i].integrity_hash;
          break;
        }
      }
    }

    const record = {
      id,
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      target_resource: targetResource,
      summary: cleanSummary,
      ip_address: ipAddress,
      user_agent: cleanUserAgent,
      previous_hash: previousHash,
      integrity_hash: computeAuditIntegrityHash({
        id,
        actor_id: actorId,
        actor_email: actorEmail,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        target_resource: targetResource,
        summary: cleanSummary,
        ip_address: ipAddress,
        user_agent: cleanUserAgent,
        created_at: timestamp
      }, previousHash),
      created_at: timestamp
    };
    memoryStore.audit_logs.push(record);
    return record;
  } catch (err) {
    // Audit logging failure should never crash the main request
    console.error('[Audit] Failed to write audit log:', err.message);
  }
}

/**
 * Backward-compatible alias for recordAuditLog
 */
export async function logAudit(...args) {
  return recordAuditLog(...args);
}

export const auditRepository = {
  recordAuditLog,
  logAudit,
  computeAuditIntegrityHash,

  /**
   * Retrieve filtered & paginated audit logs
   */
  async getLogs({
    limit = 20,
    offset = 0,
    page,
    action,
    category,
    actionType,
    action_type,
    resourceType,
    resource_type,
    targetResource,
    target_resource,
    search,
    startDate,
    start_date,
    endDate,
    end_date,
    actorId,
    actor_id
  } = {}) {
    const pageLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const pageOffset = offset !== undefined && offset !== null
      ? Math.max(0, parseInt(offset, 10) || 0)
      : (Math.max(1, parseInt(page, 10) || 1) - 1) * pageLimit;

    const filterAction = action || category || actionType || action_type;
    const filterResourceType = resourceType || resource_type;
    const filterTargetResource = targetResource || target_resource;
    const filterActorId = actorId || actor_id;
    const filterStartDate = startDate || start_date;
    const filterEndDate = endDate || end_date;

    if (isPostgresConnected && pool) {
      let where = 'WHERE 1=1';
      const params = [];

      if (filterAction && filterAction !== 'ALL') {
        params.push(filterAction);
        where += ` AND action = $${params.length}`;
      }

      if (filterResourceType && filterResourceType !== 'ALL') {
        params.push(filterResourceType);
        where += ` AND resource_type = $${params.length}`;
      }

      if (filterTargetResource && filterTargetResource !== 'ALL') {
        params.push(filterTargetResource);
        where += ` AND (target_resource = $${params.length} OR resource_id = $${params.length})`;
      }

      if (filterActorId) {
        params.push(filterActorId);
        where += ` AND (actor_id = $${params.length} OR actor_email = $${params.length})`;
      }

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        where += ` AND (
          LOWER(action) LIKE $${params.length}
          OR LOWER(COALESCE(actor_email, '')) LIKE $${params.length}
          OR LOWER(COALESCE(summary, '')) LIKE $${params.length}
          OR LOWER(COALESCE(resource_type, '')) LIKE $${params.length}
          OR LOWER(COALESCE(target_resource, '')) LIKE $${params.length}
          OR LOWER(COALESCE(actor_id, '')) LIKE $${params.length}
          OR LOWER(COALESCE(ip_address, '')) LIKE $${params.length}
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

      const countRes = await pool.query(`SELECT COUNT(*)::int as count FROM audit_logs ${where}`, params);
      const total = countRes.rows[0]?.count || 0;

      const dataQuery = `
        SELECT id, actor_id, actor_email, action, resource_type, resource_id, target_resource, summary, ip_address, user_agent, previous_hash, integrity_hash, created_at
        FROM audit_logs
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
    let list = [...(memoryStore.audit_logs || [])];

    if (filterAction && filterAction !== 'ALL') list = list.filter(l => l.action === filterAction);
    if (filterResourceType && filterResourceType !== 'ALL') list = list.filter(l => l.resource_type === filterResourceType);
    if (filterTargetResource && filterTargetResource !== 'ALL') {
      list = list.filter(l => l.target_resource === filterTargetResource || l.resource_id === filterTargetResource);
    }
    if (filterActorId) list = list.filter(l => l.actor_id === filterActorId || l.actor_email === filterActorId);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(l =>
        l.action?.toLowerCase().includes(q) ||
        l.actor_email?.toLowerCase().includes(q) ||
        l.summary?.toLowerCase().includes(q) ||
        l.resource_type?.toLowerCase().includes(q) ||
        l.target_resource?.toLowerCase().includes(q) ||
        l.actor_id?.toLowerCase().includes(q) ||
        l.ip_address?.toLowerCase().includes(q)
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
