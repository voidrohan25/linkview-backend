import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

let server;
let baseUrl;
let studentToken;
let teacherToken;
let adminToken;

describe('LinkTest LMS Modules & Integration Suite', () => {
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

    // Login Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const sBody = await studentRes.json();
    studentToken = sBody.data.token;

    // Login Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const tBody = await teacherRes.json();
    teacherToken = tBody.data.token;

    // Login Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const aBody = await adminRes.json();
    adminToken = aBody.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('1. LiveKit Status endpoint reports provider status and fallback mode', async () => {
    const res = await fetch(`${baseUrl}/api/livekit/status`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.provider);
  });

  test('2. Teacher can access /api/teacher/classes', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  test('3. Student is forbidden from accessing /api/teacher/classes', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('4. Student can fetch /api/student/timetable', async () => {
    const res = await fetch(`${baseUrl}/api/student/timetable`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  test('5. Student can fetch /api/student/attendance', async () => {
    const res = await fetch(`${baseUrl}/api/student/attendance`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.records));
    assert.ok(body.data.summary !== undefined);
  });

  test('6. Unauthenticated request to /api/upload is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 401);
  });

  test('7. Admin can view comprehensive audit logs /api/admin/audit-logs', async () => {
    const res = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
  });
});
