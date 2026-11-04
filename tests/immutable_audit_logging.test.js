import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, isPostgresConnected, pool } from '../src/db/index.js';
import {
  securityLogRepository,
  recordSecurityLog,
  logEvent,
  sanitizeSecurityData,
  computeSecurityIntegrityHash
} from '../src/repositories/securityLogRepository.js';
import {
  auditRepository,
  recordAuditLog,
  logAudit,
  computeAuditIntegrityHash
} from '../src/repositories/auditRepository.js';

let server;
let baseUrl;
let adminToken = null;
let adminId = 'user-admin-001';
let studentToken = null;
let teacherToken = null;

describe('Immutable Audit Logging & Security Logging Test Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Authenticate Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const adminData = await adminRes.json();
    assert.equal(adminRes.status, 200);
    adminToken = adminData.data.token;
    if (adminData.data.user?.id) {
      adminId = adminData.data.user.id;
    }

    // Authenticate Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const studentData = await studentRes.json();
    assert.equal(studentRes.status, 200);
    studentToken = studentData.data.token;

    // Authenticate Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const teacherData = await teacherRes.json();
    assert.equal(teacherRes.status, 200);
    teacherToken = teacherData.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 1. Admin can GET /api/admin/audit-logs -> 200
  test('1. Admin can GET /api/admin/audit-logs -> 200 with standard structure', async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.logs));
    assert.ok(typeof body.data.total === 'number');
    assert.ok(typeof body.data.page === 'number');
    assert.ok(typeof body.data.limit === 'number');
  });

  // 2. Admin can GET /api/admin/security-logs -> 200
  test('2. Admin can GET /api/admin/security-logs -> 200 with standard structure', async () => {
    const res = await fetch(`${baseUrl}/api/admin/security-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.logs));
    assert.ok(typeof body.data.total === 'number');
  });

  // 3. Non-admin access returns 403 Forbidden
  test('3. Non-admin access returns 403 Forbidden', async () => {
    // Student to audit-logs
    const studentAuditRes = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(studentAuditRes.status, 403);
    const studentAuditBody = await studentAuditRes.json();
    assert.equal(studentAuditBody.success, false);
    assert.equal(studentAuditBody.error.code, 'FORBIDDEN');

    // Teacher to audit-logs
    const teacherAuditRes = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.equal(teacherAuditRes.status, 403);

    // Student to security-logs
    const studentSecRes = await fetch(`${baseUrl}/api/admin/security-logs`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(studentSecRes.status, 403);

    // Teacher to security-logs
    const teacherSecRes = await fetch(`${baseUrl}/api/admin/security-logs`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.equal(teacherSecRes.status, 403);
  });

  // 4. Unauthenticated behavior returns 401 Unauthorized
  test('4. Unauthenticated access returns 401 Unauthorized', async () => {
    const unauthAudit = await fetch(`${baseUrl}/api/admin/audit-logs`);
    assert.equal(unauthAudit.status, 401);
    const auditBody = await unauthAudit.json();
    assert.equal(auditBody.error.code, 'UNAUTHORIZED');

    const unauthSec = await fetch(`${baseUrl}/api/admin/security-logs`);
    assert.equal(unauthSec.status, 401);
    const secBody = await unauthSec.json();
    assert.equal(secBody.error.code, 'UNAUTHORIZED');
  });

  // 5. Pagination works with limits, offsets, and clamping
  test('5. Pagination works with limits, pages, offsets, and clamping', async () => {
    const pageAction = `PAGINATION_TEST_${Date.now()}`;
    // Write 3 records to ensure enough pagination test data
    for (let i = 1; i <= 3; i++) {
      await recordAuditLog({
        actorId: adminId,
        actorEmail: 'admin@linktest.io',
        action: pageAction,
        resourceType: 'pagination_test',
        resourceId: `page-res-${i}`,
        summary: `Pagination item ${i}`
      });
    }

    // Page 1 with limit 2
    const resPage1 = await fetch(`${baseUrl}/api/admin/audit-logs?action=${pageAction}&limit=2&page=1`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(resPage1.status, 200);
    const bodyPage1 = await resPage1.json();
    assert.equal(bodyPage1.data.logs.length, 2);
    assert.equal(bodyPage1.data.page, 1);
    assert.equal(bodyPage1.data.limit, 2);

    // Page 2 with limit 2
    const resPage2 = await fetch(`${baseUrl}/api/admin/audit-logs?action=${pageAction}&limit=2&page=2`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(resPage2.status, 200);
    const bodyPage2 = await resPage2.json();
    assert.equal(bodyPage2.data.logs.length, 1);
    assert.equal(bodyPage2.data.page, 2);

    // Page 1 and Page 2 records must be distinct
    const idsPage1 = bodyPage1.data.logs.map(l => l.id);
    const idsPage2 = bodyPage2.data.logs.map(l => l.id);
    assert.equal(idsPage1.includes(idsPage2[0]), false);

    // Limit clamping: requested 500 is clamped to 100
    const resClamped = await fetch(`${baseUrl}/api/admin/audit-logs?limit=500`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(resClamped.status, 200);
    const bodyClamped = await resClamped.json();
    assert.equal(bodyClamped.data.limit, 100);
  });

  // 6. Date filtering works and validates invalid dates
  test('6. Date filtering works and rejects invalid date inputs', async () => {
    const today = new Date().toISOString();
    const futureDate = '2099-01-01T00:00:00.000Z';
    const futureDateEnd = '2099-01-02T00:00:00.000Z';

    // Far future range should return 0 logs
    const futureRes = await fetch(`${baseUrl}/api/admin/audit-logs?start_date=${futureDate}&end_date=${futureDateEnd}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(futureRes.status, 200);
    const futureBody = await futureRes.json();
    assert.equal(futureBody.data.logs.length, 0);

    // Invalid start_date should return 400 Bad Request
    const invalidDateRes = await fetch(`${baseUrl}/api/admin/audit-logs?start_date=not-a-valid-date`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(invalidDateRes.status, 400);
    const invalidBody = await invalidDateRes.json();
    assert.equal(invalidBody.success, false);
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');

    // Invalid end_date in security-logs should also return 400
    const invalidSecDateRes = await fetch(`${baseUrl}/api/admin/security-logs?end_date=bad-date`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(invalidSecDateRes.status, 400);
  });

  // 7. Action and event type filtering works
  test('7. Action and event type filtering works', async () => {
    const uniqueAction = `UNIQUE_ACTION_${Date.now()}`;
    await recordAuditLog({
      actorId: adminId,
      actorEmail: 'admin@linktest.io',
      action: uniqueAction,
      resourceType: 'filter_test',
      resourceId: 'filter-1',
      summary: 'Action filtering test record'
    });

    const res = await fetch(`${baseUrl}/api/admin/audit-logs?action=${uniqueAction}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.logs.length >= 1);
    assert.ok(body.data.logs.every(l => l.action === uniqueAction));

    // Security logs event_type filter
    const uniqueEventType = `UNIQUE_SEC_EVENT_${Date.now()}`;
    await recordSecurityLog({
      eventType: uniqueEventType,
      severity: 'WARNING',
      userEmail: 'filter_sec@linktest.io',
      details: 'Security filter verification'
    });

    const secRes = await fetch(`${baseUrl}/api/admin/security-logs?event_type=${uniqueEventType}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(secRes.status, 200);
    const secBody = await secRes.json();
    assert.ok(secBody.data.logs.length >= 1);
    assert.ok(secBody.data.logs.every(l => l.event_type === uniqueEventType));
  });

  // 8. Search works across summary, details, and identifiers
  test('8. Search query works across keywords and text', async () => {
    const searchToken = `keyword_search_${Date.now()}`;
    await recordAuditLog({
      actorId: adminId,
      actorEmail: 'admin@linktest.io',
      action: 'SEARCHABLE_EVENT',
      resourceType: 'system_doc',
      resourceId: 'doc-42',
      summary: `Contains secret marker ${searchToken} in summary`
    });

    const res = await fetch(`${baseUrl}/api/admin/audit-logs?search=${searchToken}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.logs.length >= 1);
    assert.ok(body.data.logs[0].summary.includes(searchToken));
  });

  // 9. Key platform actions automatically append records
  test('9. Key platform actions automatically append records to audit and security logs', async () => {
    // 9a. Authentication failure logs LOGIN_FAILED
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe_failure_999@linktest.io', password: 'WrongPassword123!' })
    });
    assert.equal(badLoginRes.status, 401);

    const secCheck = await fetch(`${baseUrl}/api/admin/security-logs?event_type=LOGIN_FAILED&search=probe_failure_999`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(secCheck.status, 200);
    const secData = await secCheck.json();
    assert.ok(secData.data.logs.length >= 1);
    assert.equal(secData.data.logs[0].event_type, 'LOGIN_FAILED');

    // 9b. Class creation and modification records audit logs
    const className = `TestClass_Audit_${Date.now()}`;
    const createClassRes = await fetch(`${baseUrl}/api/admin/classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ name: className, description: 'Created for audit test' })
    });
    assert.equal(createClassRes.status, 201);
    const classData = await createClassRes.json();
    const createdClassId = classData.data.class.id;

    // Check CLASS_CREATED in audit logs
    const classAudit = await fetch(`${baseUrl}/api/admin/audit-logs?action=CLASS_CREATED&search=${className}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(classAudit.status, 200);
    const classAuditData = await classAudit.json();
    assert.ok(classAuditData.data.logs.length >= 1);

    // Update class
    const updateClassRes = await fetch(`${baseUrl}/api/admin/classes/${createdClassId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ name: `${className}_Updated`, description: 'Updated for audit test' })
    });
    assert.equal(updateClassRes.status, 200);

    // Check CLASS_UPDATED in audit logs
    const updateAudit = await fetch(`${baseUrl}/api/admin/audit-logs?action=CLASS_UPDATED&search=${createdClassId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(updateAudit.status, 200);
    const updateAuditData = await updateAudit.json();
    assert.ok(updateAuditData.data.logs.length >= 1);

    // 9c. Question Bank creation records audit logs
    const createQRes = await fetch(`${baseUrl}/api/questions/bank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        question_text: `Audit Verification Question ${Date.now()}`,
        subject: 'General Science',
        topic: 'Physics',
        difficulty: 'EASY',
        marks: 1
      })
    });
    assert.equal(createQRes.status, 201);
    const qData = await createQRes.json();

    const qAudit = await fetch(`${baseUrl}/api/admin/audit-logs?action=QUESTION_CREATED&search=${qData.data.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(qAudit.status, 200);
    const qAuditData = await qAudit.json();
    assert.ok(qAuditData.data.logs.length >= 1);
  });

  // 10. Passwords/tokens/secrets are redacted
  test('10. Secrets, bearer tokens, passwords, and API keys are strictly redacted', async () => {
    // Test the sanitizer directly
    const dirty = {
      password: 'PlainSecretPassword123!',
      token: 'jwt.bearer.secret_token',
      apiKey: 'sk-1234567890abcdef',
      safeKey: 'clean_data',
      nested: {
        refreshToken: 'refresh-999-secret',
        authorization: 'Bearer secret_value'
      }
    };
    const cleaned = sanitizeSecurityData(dirty);
    assert.equal(cleaned.password, '[REDACTED]');
    assert.equal(cleaned.token, '[REDACTED]');
    assert.equal(cleaned.apiKey, '[REDACTED]');
    assert.equal(cleaned.safeKey, 'clean_data');
    assert.equal(cleaned.nested.refreshToken, '[REDACTED]');
    assert.equal(cleaned.nested.authorization, '[REDACTED]');

    // Test string redaction
    const dirtyStr = 'Connecting with password=SuperSecret456 and api_key=key_xyz';
    const cleanedStr = sanitizeSecurityData(dirtyStr);
    assert.equal(cleanedStr.includes('SuperSecret456'), false);
    assert.ok(cleanedStr.includes('password=[REDACTED]'));

    // Test recordSecurityLog auto-redaction
    const secRecord = await recordSecurityLog({
      eventType: 'SECRET_REDACTION_VERIFY',
      severity: 'WARNING',
      details: 'Failed login with password=SuperSecret456',
      metadata: { password: 'SuperSecret456', token: 'token123' }
    });
    assert.equal(JSON.stringify(secRecord).includes('SuperSecret456'), false);
    assert.equal(JSON.stringify(secRecord).includes('token123'), false);
  });

  // 11. Tamper-evident metadata & cryptographic hash chaining
  test('11. Tamper-evident metadata: previous_hash and integrity_hash SHA-256 chain', async () => {
    // Record two consecutive events
    const event1 = await recordAuditLog({
      actorId: adminId,
      actorEmail: 'admin@linktest.io',
      action: 'HASH_CHAIN_EVENT_1',
      resourceType: 'integrity_test',
      resourceId: 'int-1',
      summary: 'Chain node 1',
      ipAddress: '127.0.0.1',
      userAgent: 'Node-Test-Agent'
    });

    assert.ok(event1);
    assert.ok(event1.integrity_hash, 'Event 1 must have an integrity_hash');
    assert.equal(event1.integrity_hash.length, 64, 'SHA-256 must be 64 hex chars');
    assert.ok(event1.previous_hash, 'Event 1 must have a previous_hash');

    const event2 = await recordAuditLog({
      actorId: adminId,
      actorEmail: 'admin@linktest.io',
      action: 'HASH_CHAIN_EVENT_2',
      resourceType: 'integrity_test',
      resourceId: 'int-2',
      summary: 'Chain node 2',
      ipAddress: '127.0.0.1',
      userAgent: 'Node-Test-Agent',
      previousHash: event1.integrity_hash
    });

    assert.ok(event2);
    assert.ok(event2.integrity_hash, 'Event 2 must have an integrity_hash');
    assert.equal(event2.integrity_hash.length, 64);
    // Previous hash of event2 must equal integrity_hash of event1
    assert.equal(event2.previous_hash, event1.integrity_hash, 'event2.previous_hash must match event1.integrity_hash');

    // Verify hash calculation formula
    const recomputedHash = computeAuditIntegrityHash(event2, event1.integrity_hash);
    assert.equal(event2.integrity_hash, recomputedHash, 'Integrity hash must match canonical SHA-256 calculation');

    // Query via API and ensure hashes are returned in payload
    const apiRes = await fetch(`${baseUrl}/api/admin/audit-logs?action=HASH_CHAIN_EVENT_2`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(apiRes.status, 200);
    const apiBody = await apiRes.json();
    assert.ok(apiBody.data.logs.length >= 1);
    assert.ok(apiBody.data.logs[0].integrity_hash);
    assert.ok(apiBody.data.logs[0].previous_hash);
  });

  // 12. No UPDATE or DELETE API exposure for audit/security logs
  test('12. Audit logs and security logs have NO UPDATE or DELETE API endpoints', async () => {
    // PUT /api/admin/audit-logs -> 404
    const putAudit = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'MUTATE' })
    });
    assert.equal(putAudit.status, 404);

    // PATCH /api/admin/audit-logs -> 404
    const patchAudit = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'MUTATE' })
    });
    assert.equal(patchAudit.status, 404);

    // DELETE /api/admin/audit-logs -> 404
    const delAudit = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delAudit.status, 404);

    // DELETE /api/admin/audit-logs/:id -> 404
    const delAuditId = await fetch(`${baseUrl}/api/admin/audit-logs/some-log-id`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delAuditId.status, 404);

    // PUT /api/admin/security-logs -> 404
    const putSec = await fetch(`${baseUrl}/api/admin/security-logs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ event_type: 'MUTATE' })
    });
    assert.equal(putSec.status, 404);

    // PATCH /api/admin/security-logs -> 404
    const patchSec = await fetch(`${baseUrl}/api/admin/security-logs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ event_type: 'MUTATE' })
    });
    assert.equal(patchSec.status, 404);

    // DELETE /api/admin/security-logs -> 404
    const delSec = await fetch(`${baseUrl}/api/admin/security-logs`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delSec.status, 404);

    // DELETE /api/admin/security-logs/:id -> 404
    const delSecId = await fetch(`${baseUrl}/api/admin/security-logs/some-sec-id`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delSecId.status, 404);
  });

  // 13. Method delegation and backward compatibility
  test('13. Backward compatibility: logAudit and logEvent delegate seamlessly to canonical record methods', async () => {
    // Calling legacy logAudit
    await logAudit({
      actorId: adminId,
      actorEmail: 'admin@linktest.io',
      action: 'LEGACY_LOG_AUDIT_CALL',
      resourceType: 'compat_test',
      resourceId: 'compat-1',
      summary: 'Legacy logAudit verification'
    });

    const resAudit = await auditRepository.getLogs({ action: 'LEGACY_LOG_AUDIT_CALL' });
    assert.ok(resAudit.logs.length >= 1);
    assert.equal(resAudit.logs[0].action, 'LEGACY_LOG_AUDIT_CALL');
    assert.ok(resAudit.logs[0].integrity_hash, 'Legacy call must still compute integrity_hash');

    // Calling legacy logEvent
    await logEvent({
      eventType: 'LEGACY_LOG_EVENT_CALL',
      severity: 'INFO',
      userEmail: 'compat@linktest.io',
      details: 'Legacy logEvent verification'
    });

    const resSec = await securityLogRepository.getLogs({ eventType: 'LEGACY_LOG_EVENT_CALL' });
    assert.ok(resSec.logs.length >= 1);
    assert.equal(resSec.logs[0].event_type, 'LEGACY_LOG_EVENT_CALL');
    assert.ok(resSec.logs[0].integrity_hash, 'Legacy call must still compute integrity_hash');
  });
});
