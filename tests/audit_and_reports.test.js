import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { securityLogRepository } from '../src/repositories/securityLogRepository.js';
import { auditRepository, logAudit } from '../src/repositories/auditRepository.js';

let server;
let baseUrl;
let adminToken = null;
let studentToken = null;

describe('Audit, Security Logs & Reports Analysis Suite', () => {
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

    // Authenticate Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const studentData = await studentRes.json();
    assert.equal(studentRes.status, 200);
    studentToken = studentData.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── AUDIT LOGS TESTS ──
  test('Audit Logs: Permissions enforcement', async () => {
    // 1. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/audit-logs`);
    assert.equal(unauthRes.status, 401);

    // 2. Student (non-admin) -> 403
    const studentRes = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(studentRes.status, 403);

    // 3. Admin -> 200
    const adminRes = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminRes.status, 200);
    const data = await adminRes.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data.logs));
    assert.ok(data.data.total >= 0);
  });

  test('Audit Logs: Pagination, Filtering, and Secret Redaction', async () => {
    // Write a test audit record
    await logAudit({
      actorId: 'user-admin-001',
      actorEmail: 'admin@linktest.io',
      action: 'TEST_AUDIT_ACTION_VERIFY',
      resourceType: 'system_test',
      resourceId: 'test-res-1',
      summary: 'Verified audit recording and search capability'
    });

    const res = await fetch(`${baseUrl}/api/admin/audit-logs?search=TEST_AUDIT_ACTION_VERIFY&limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.logs.length >= 1);
    assert.equal(body.data.logs[0].action, 'TEST_AUDIT_ACTION_VERIFY');
    assert.equal(body.data.limit, 5);

    // Ensure no passwords or hashes in audit payload
    const serialized = JSON.stringify(body.data.logs);
    assert.equal(serialized.includes('password_hash'), false);
    assert.equal(serialized.includes('AdminPassword123!'), false);
  });

  // ── SECURITY LOGS TESTS ──
  test('Security Logs: Permissions enforcement', async () => {
    // 1. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/security-logs`);
    assert.equal(unauthRes.status, 401);

    // 2. Student -> 403
    const studentRes = await fetch(`${baseUrl}/api/admin/security-logs`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(studentRes.status, 403);

    // 3. Admin -> 200
    const adminRes = await fetch(`${baseUrl}/api/admin/security-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminRes.status, 200);
    const data = await adminRes.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data.logs));
  });

  test('Security Logs: Record failed login and forbidden access', async () => {
    // Trigger a failed login
    await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent-user@linktest.io', password: 'SecretPassword999!' })
    });

    // Fetch security logs
    const res = await fetch(`${baseUrl}/api/admin/security-logs?event_type=LOGIN_FAILED&limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.logs.length >= 1);
    const failedLog = body.data.logs.find((l) => l.user_email === 'nonexistent-user@linktest.io');
    assert.ok(failedLog);
    assert.equal(failedLog.severity, 'WARNING');
    assert.equal(failedLog.event_type, 'LOGIN_FAILED');

    // Never log raw password
    const logStr = JSON.stringify(body.data);
    assert.equal(logStr.includes('SecretPassword999!'), false);
  });

  test('Security Logs: Sanitization verifies secret keys are redacted', async () => {
    await securityLogRepository.logEvent({
      eventType: 'SUSPICIOUS_PROBE_TEST',
      severity: 'HIGH',
      userEmail: 'probe@linktest.io',
      details: 'Probe with token=secret_jwt_xyz and password=plain_pass_123',
      metadata: {
        password: 'should_be_redacted_pass',
        token: 'should_be_redacted_token',
        safeKey: 'normal_data'
      }
    });

    const res = await fetch(`${baseUrl}/api/admin/security-logs?search=SUSPICIOUS_PROBE_TEST`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const probeLog = body.data.logs.find((l) => l.event_type === 'SUSPICIOUS_PROBE_TEST');
    assert.ok(probeLog);

    const jsonLog = JSON.stringify(probeLog);
    assert.equal(jsonLog.includes('should_be_redacted_pass'), false);
    assert.equal(jsonLog.includes('should_be_redacted_token'), false);
    assert.ok(jsonLog.includes('[REDACTED]'));
  });

  // ── REPORTS ANALYSIS TESTS ──
  test('Reports: Permissions enforcement', async () => {
    // 1. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/reports/overview`);
    assert.equal(unauthRes.status, 401);

    // 2. Student -> 403
    const studentRes = await fetch(`${baseUrl}/api/admin/reports/overview`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(studentRes.status, 403);

    // 3. Admin -> 200
    const adminRes = await fetch(`${baseUrl}/api/admin/reports/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminRes.status, 200);
    const body = await adminRes.json();
    assert.equal(body.success, true);
  });

  test('Reports: Correct calculations and real database records', async () => {
    const res = await fetch(`${baseUrl}/api/admin/reports/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const report = body.data.report;

    assert.ok(report);
    assert.ok(report.summary);
    assert.ok(report.summary.total_attempts >= 0);
    assert.ok(report.summary.pass_rate >= 0 && report.summary.pass_rate <= 100);
    assert.ok(report.summary.avg_score >= 0 && report.summary.avg_score <= 100);
    assert.ok(report.summary.completion_rate >= 0 && report.summary.completion_rate <= 100);

    // Score distribution integrity
    assert.ok(Array.isArray(report.score_distribution));
    const distTotal = report.score_distribution.reduce((acc, band) => acc + band.count, 0);
    // Score distribution sum must equal total attempts without double counting
    assert.equal(distTotal, report.summary.total_attempts);

    // Available courses and batches
    assert.ok(Array.isArray(report.available_courses));
    assert.ok(Array.isArray(report.available_batches));
    assert.ok(Array.isArray(report.recent_submissions));
  });

  test('Reports: Filtering by course and date', async () => {
    // Fetch with an empty date range in the far future to test empty state
    const futureRes = await fetch(`${baseUrl}/api/admin/reports/overview?start_date=2099-01-01&end_date=2099-01-02`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(futureRes.status, 200);
    const body = await futureRes.json();
    const futureReport = body.data.report;
    assert.equal(futureReport.summary.total_attempts, 0);
    assert.equal(futureReport.summary.pass_rate, 0);
    assert.equal(futureReport.recent_submissions.length, 0);
  });

  test('Reports: CSV Export endpoint', async () => {
    const csvRes = await fetch(`${baseUrl}/api/admin/reports/export`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.headers.get('content-type').includes('text/csv'));
    assert.ok(csvRes.headers.get('content-disposition').includes('attachment'));
    const text = await csvRes.text();
    assert.ok(text.includes('Student Name,Student Email,Assessment Title'));
  });
});
