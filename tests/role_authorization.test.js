import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { config } from '../src/config/env.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { requireRole, requireAnyRole } from '../src/middleware/roleGuard.js';

let server;
let baseUrl;
let studentToken;
let teacherToken;
let adminToken;
let studentUser;
let teacherUser;
let adminUser;

describe('Issue #5: Server-Side Role Authorization and Access Control Suite', () => {
  before(async () => {
    await initDb();

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Authenticate Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    assert.strictEqual(studentRes.status, 200, 'Student should login successfully');
    const studentBody = await studentRes.json();
    studentToken = studentBody.data.token;
    studentUser = studentBody.data.user;
    assert.strictEqual(studentUser.role, 'STUDENT');

    // 2. Authenticate Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    assert.strictEqual(teacherRes.status, 200, 'Teacher should login successfully');
    const teacherBody = await teacherRes.json();
    teacherToken = teacherBody.data.token;
    teacherUser = teacherBody.data.user;
    assert.strictEqual(teacherUser.role, 'TEACHER');

    // 3. Authenticate Admin
    let adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@linktest.io',
        password: process.env.ADMIN_PASSWORD || 'LinkTest#ProdAdmin2026!'
      })
    });
    if (adminRes.status !== 200) {
      adminRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@linktest.io', password: 'Admin123!' })
      });
    }
    assert.strictEqual(adminRes.status, 200, 'Admin should login successfully');
    const adminBody = await adminRes.json();
    adminToken = adminBody.data.token;
    adminUser = adminBody.data.user;
    assert.strictEqual(adminUser.role, 'ADMIN');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // =========================================================================
  // Requirement A: Missing Authorization Header
  // =========================================================================
  test('A. Missing Authorization header returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
    assert.strictEqual(body.error.message, 'Unauthorized');
  });

  // =========================================================================
  // Requirement B: Malformed Bearer Token
  // =========================================================================
  test('B1. Empty Authorization header returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: '' }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  test('B2. Authorization header without Bearer scheme returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  test('B3. Bearer header with empty token returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: 'Bearer ' }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  test('B4. Bearer header with non-JWT garbage returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: 'Bearer not_a_jwt_token' }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  // =========================================================================
  // Requirement C: Invalid JWT
  // =========================================================================
  test('C1. JWT signed with incorrect secret returns 401 UNAUTHORIZED', async () => {
    const tamperedToken = jwt.sign(
      { id: adminUser.id, email: adminUser.email, role: 'ADMIN' },
      'wrong_secret_tampered_key',
      { expiresIn: '1h' }
    );

    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${tamperedToken}` }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
    assert.strictEqual(body.error.message, 'Unauthorized');
  });

  test('C2. JWT referencing non-existent user returns 401 UNAUTHORIZED', async () => {
    const fakeUserToken = jwt.sign(
      { id: 'user-does-not-exist-99999', email: 'ghost@linktest.io', role: 'ADMIN' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${fakeUserToken}` }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  // =========================================================================
  // Requirement D: Expired JWT
  // =========================================================================
  test('D. Expired JWT returns 401 UNAUTHORIZED', async () => {
    const expiredToken = jwt.sign(
      { id: adminUser.id, email: adminUser.email, role: 'ADMIN' },
      config.jwtSecret,
      { expiresIn: -10 } // Expired 10 seconds ago
    );

    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
    assert.strictEqual(body.error.message, 'Unauthorized');
  });

  // =========================================================================
  // Requirement E: STUDENT accessing ADMIN endpoint
  // =========================================================================
  test('E. STUDENT accessing ADMIN endpoint returns 403 FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.strictEqual(body.error.message, 'Forbidden');
  });

  // =========================================================================
  // Requirement F: STUDENT accessing TEACHER endpoint
  // =========================================================================
  test('F. STUDENT accessing TEACHER endpoint returns 403 FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.strictEqual(body.error.message, 'Forbidden');
  });

  // =========================================================================
  // Requirement G: TEACHER accessing TEACHER endpoint
  // =========================================================================
  test('G. TEACHER accessing TEACHER endpoint is allowed (HTTP 200)', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));
  });

  // =========================================================================
  // Requirement H: TEACHER accessing ADMIN-only endpoint
  // =========================================================================
  test('H. TEACHER accessing ADMIN-only endpoint returns 403 FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.strictEqual(body.error.message, 'Forbidden');
  });

  // =========================================================================
  // Requirement I: ADMIN accessing ADMIN endpoint
  // =========================================================================
  test('I. ADMIN accessing ADMIN endpoint is allowed (HTTP 200)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.stats);
  });

  // =========================================================================
  // Requirement J: ADMIN accessing appropriate TEACHER/management endpoints
  // =========================================================================
  test('J1. ADMIN accessing batches endpoint (requireAnyRole ADMIN, TEACHER) is allowed', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
  });

  test('J2. ADMIN accessing question bank endpoint (requireAnyRole ADMIN, TEACHER) is allowed', async () => {
    const res = await fetch(`${baseUrl}/api/questions/bank`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
  });

  test('J3. ADMIN accessing student search endpoint (requireAnyRole ADMIN, TEACHER) is allowed', async () => {
    const res = await fetch(`${baseUrl}/api/students/search?q=test`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
  });

  // =========================================================================
  // Requirement K: Client attempts role spoofing
  // =========================================================================
  test('K1. Student role spoofing via request body fails (403 FORBIDDEN)', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        role: 'ADMIN',
        name: 'Spoofed Cohort',
        code: `SPOOF_${Date.now()}`
      })
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('K2. Student role spoofing via query parameters fails (403 FORBIDDEN)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard?role=ADMIN&userRole=ADMIN`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('K3. Student role spoofing via custom headers fails (403 FORBIDDEN)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'X-Role': 'ADMIN',
        'X-User-Role': 'ADMIN',
        Role: 'ADMIN'
      }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('K4. Teacher role spoofing as ADMIN fails on ADMIN-only batch creation', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`,
        'X-Role': 'ADMIN'
      },
      body: JSON.stringify({
        role: 'ADMIN',
        name: 'Teacher Attempting Admin Batch',
        code: `T_FAIL_${Date.now()}`
      })
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('K5. Admin authority is NOT downgraded by client-supplied STUDENT parameters', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard?role=STUDENT`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Role': 'STUDENT',
        Role: 'STUDENT'
      }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
  });

  // =========================================================================
  // Requirement L: Backward Compatibility & Core Auth Flows
  // =========================================================================
  test('L1. GET /api/auth/me returns authenticated user profile with verified role', async () => {
    // Student
    const sRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(sRes.status, 200);
    const sBody = await sRes.json();
    assert.strictEqual(sBody.data.user.role, 'STUDENT');

    // Teacher
    const tRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(tRes.status, 200);
    const tBody = await tRes.json();
    assert.strictEqual(tBody.data.user.role, 'TEACHER');

    // Admin
    const aRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(aRes.status, 200);
    const aBody = await aRes.json();
    assert.strictEqual(aBody.data.user.role, 'ADMIN');
  });

  // =========================================================================
  // Exact Role Guard & Multi-Role Guard direct middleware unit verification
  // =========================================================================
  test('M1. requireRole directly enforces exact single role matching', async () => {
    const adminGuard = requireRole('ADMIN');
    const teacherGuard = requireRole('TEACHER');
    const studentGuard = requireRole('STUDENT');

    let adminNextCalled = false;
    let mockAdminRes = {
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    adminGuard({ user: { id: 'a1', role: 'ADMIN' } }, mockAdminRes, () => { adminNextCalled = true; });
    assert.strictEqual(adminNextCalled, true);

    // Mismatch check
    let mockRejectRes = {
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    adminGuard({ user: { id: 't1', role: 'TEACHER' } }, mockRejectRes, () => {});
    assert.strictEqual(mockRejectRes.statusCode, 403);
    assert.strictEqual(mockRejectRes.body.error.code, 'FORBIDDEN');

    // Teacher exact check
    let teacherNextCalled = false;
    teacherGuard({ user: { id: 't1', role: 'TEACHER' } }, mockAdminRes, () => { teacherNextCalled = true; });
    assert.strictEqual(teacherNextCalled, true);

    // Student exact check
    let studentNextCalled = false;
    studentGuard({ user: { id: 's1', role: 'STUDENT' } }, mockAdminRes, () => { studentNextCalled = true; });
    assert.strictEqual(studentNextCalled, true);
  });

  test('M2. requireAnyRole directly enforces multi-role authorization', async () => {
    const staffGuard = requireAnyRole('TEACHER', 'ADMIN');

    let teacherNext = false;
    staffGuard({ user: { id: 't1', role: 'TEACHER' } }, {}, () => { teacherNext = true; });
    assert.strictEqual(teacherNext, true);

    let adminNext = false;
    staffGuard({ user: { id: 'a1', role: 'ADMIN' } }, {}, () => { adminNext = true; });
    assert.strictEqual(adminNext, true);

    let mockRejectRes = {
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    staffGuard({ user: { id: 's1', role: 'STUDENT' } }, mockRejectRes, () => {});
    assert.strictEqual(mockRejectRes.statusCode, 403);
    assert.strictEqual(mockRejectRes.body.error.code, 'FORBIDDEN');
  });
});
