import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, pool, isPostgresConnected, memoryStore } from '../src/db/index.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { invitationRepository } from '../src/repositories/invitationRepository.js';
import { authService, setGoogleOAuthClient, getGoogleOAuthClient } from '../src/services/authService.js';
import { config } from '../src/config/env.js';

let server;
let baseUrl;
let originalClient;
let adminToken;

describe('Step 16: End-to-End Verification Matrix', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    originalClient = getGoogleOAuthClient();
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Obtain Admin Token for admin API requests
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
    assert.strictEqual(adminRes.status, 200);
    const adminBody = await adminRes.json();
    adminToken = adminBody.data.token;
    assert.ok(adminToken, 'Admin token should be acquired');
  });

  after(async () => {
    setGoogleOAuthClient(originalClient);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // =========================================================================
  // TEST 1 — Normal Student
  // =========================================================================
  test('Test 1 — Normal Student: Login, role verification, admin appearance, audit/security logging', async () => {
    // 1. Login as normal student
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'student@linktest.io',
        password: 'Student123!'
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.user.role, 'STUDENT', 'Normal student must have role STUDENT');
    assert.ok(body.data.token, 'Session token must be returned');
    const studentId = body.data.user.id;

    // 2. Appears in Admin Users API with role STUDENT
    const adminUsersRes = await fetch(`${baseUrl}/api/admin/users?search=student@linktest.io`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminUsersRes.status, 200);
    const usersBody = await adminUsersRes.json();
    const foundUser = usersBody.data.users.find(u => u.email === 'student@linktest.io');
    assert.ok(foundUser, 'Normal student must appear in Admin Users');
    assert.strictEqual(foundUser.role, 'STUDENT', 'Admin panel must display role STUDENT');
    assert.strictEqual(foundUser.id, studentId, 'Admin panel user ID must match database ID');

    // 3. Security log recorded
    const secRes = await fetch(`${baseUrl}/api/admin/security-logs?search=student@linktest.io`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(secRes.status, 200);
    const secBody = await secRes.json();
    assert.ok(secBody.data.logs.length > 0, 'Login security log must exist for student');
    assert.strictEqual(secBody.data.logs[0].user_id, studentId, 'Security log must reference canonical DB user ID');
  });

  // =========================================================================
  // TEST 2 — Google Student
  // =========================================================================
  test('Test 2 — Google Student: Registration/login, role verification, admin visibility, audit/security tracking', async () => {
    const timestamp = Date.now();
    const googleSub = `google-sub-student-${timestamp}`;
    const googleEmail = `google.student.${timestamp}@example.com`;
    const googleName = `Google Student ${timestamp}`;

    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: googleSub,
          email: googleEmail,
          email_verified: true,
          name: googleName
        })
      })
    });

    // 1. Login with Google student account
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'valid.google.student.token' })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.user.role, 'STUDENT', 'Google student must have role STUDENT');
    assert.strictEqual(body.data.user.email, googleEmail);
    assert.strictEqual(body.data.is_new_user, true);
    const dbUserId = body.data.user.id;
    assert.ok(dbUserId, 'Database user ID must be returned');

    // 2. Verify appears in Admin Users API with role STUDENT and Google auth provider
    const adminUsersRes = await fetch(`${baseUrl}/api/admin/users?search=${googleEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminUsersRes.status, 200);
    const usersBody = await adminUsersRes.json();
    const foundUser = usersBody.data.users.find(u => u.email === googleEmail);
    assert.ok(foundUser, 'Google student must appear in Admin Users');
    assert.strictEqual(foundUser.id, dbUserId, 'Admin user record must match canonical DB ID');
    assert.strictEqual(foundUser.role, 'STUDENT', 'Admin user record must display STUDENT role');
    assert.strictEqual(foundUser.auth_provider, 'google', 'Google auth provider must be preserved and displayed');
    assert.strictEqual(foundUser.google_id, googleSub, 'Google subject ID must be stored');

    // 3. Login audit event recorded with canonical DB user ID
    const auditRes = await fetch(`${baseUrl}/api/admin/audit-logs?search=${googleEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(auditRes.status, 200);
    const auditBody = await auditRes.json();
    assert.ok(auditBody.data.logs.length > 0, 'Audit record must be created for Google registration');
    const auditLog = auditBody.data.logs.find(l => l.actor_email === googleEmail);
    assert.ok(auditLog, 'Audit record with actor_email must exist');
    assert.strictEqual(auditLog.actor_id, dbUserId, 'Audit record must reference canonical DB user ID');
    assert.strictEqual(auditLog.action, 'AUTH_GOOGLE_REGISTER');

    // 4. Security log recorded with canonical DB user ID
    const secRes = await fetch(`${baseUrl}/api/admin/security-logs?search=${googleEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(secRes.status, 200);
    const secBody = await secRes.json();
    const secLog = secBody.data.logs.find(l => l.user_email === googleEmail);
    assert.ok(secLog, 'Security event must exist for Google authentication');
    assert.strictEqual(secLog.user_id, dbUserId, 'Security event must reference canonical DB user ID');
    assert.strictEqual(secLog.event_type, 'OAUTH_REGISTER_SUCCESS');
  });

  // =========================================================================
  // TEST 3 — Normal Teacher
  // =========================================================================
  test('Test 3 — Normal Teacher: Login, role verification, admin appearance, audit/security logging', async () => {
    // 1. Login as teacher
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'teacher@linktest.io',
        password: 'Teacher123!'
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.user.role, 'TEACHER', 'Normal teacher must have role TEACHER');
    const teacherId = body.data.user.id;

    // 2. Appears in Admin Users API with role TEACHER
    const adminUsersRes = await fetch(`${baseUrl}/api/admin/users?search=teacher@linktest.io`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminUsersRes.status, 200);
    const usersBody = await adminUsersRes.json();
    const foundUser = usersBody.data.users.find(u => u.email === 'teacher@linktest.io');
    assert.ok(foundUser, 'Normal teacher must appear in Admin Users');
    assert.strictEqual(foundUser.role, 'TEACHER', 'Admin panel must display role TEACHER');
    assert.strictEqual(foundUser.id, teacherId);

    // 3. Security log recorded
    const secRes = await fetch(`${baseUrl}/api/admin/security-logs?search=teacher@linktest.io`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(secRes.status, 200);
    const secBody = await secRes.json();
    assert.ok(secBody.data.logs.length > 0, 'Login security log must exist for teacher');
    assert.strictEqual(secBody.data.logs[0].user_id, teacherId, 'Security log must reference canonical DB user ID');
  });

  // =========================================================================
  // TEST 4 — Google Teacher
  // =========================================================================
  test('Test 4 — Google Teacher: Invitation acceptance via Google, role TEACHER preservation, admin panel synchronization', async () => {
    const timestamp = Date.now();
    const teacherEmail = `google.teacher.${timestamp}@example.com`;
    const teacherSub = `google-sub-teacher-${timestamp}`;
    const teacherName = `Google Teacher ${timestamp}`;

    // 1. Admin invites teacher
    const inviteRes = await fetch(`${baseUrl}/api/admin/teachers/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        email: teacherEmail,
        full_name: teacherName,
        department: 'Science & Engineering',
        subjects: ['Computer Science']
      })
    });
    assert.strictEqual(inviteRes.status, 201, 'Teacher invitation must be created successfully');

    // Verify invitation exists in DB
    const invitation = await invitationRepository.findByEmail(teacherEmail);
    assert.ok(invitation, 'Teacher invitation must exist in DB');
    assert.strictEqual(invitation.accepted_at, null, 'Invitation should initially be pending');

    // 2. Teacher signs in with Google using the invited email
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: teacherSub,
          email: teacherEmail,
          email_verified: true,
          name: teacherName
        })
      })
    });

    const googleRes = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'valid.google.teacher.token' })
    });
    assert.strictEqual(googleRes.status, 200);
    const googleBody = await googleRes.json();

    // Verify role is TEACHER (NOT downgraded to STUDENT)
    assert.strictEqual(googleBody.data.user.role, 'TEACHER', 'Invited teacher MUST be assigned TEACHER role');
    assert.strictEqual(googleBody.data.user.email, teacherEmail);
    assert.strictEqual(googleBody.data.is_new_user, true);
    const teacherUserId = googleBody.data.user.id;
    assert.ok(teacherUserId, 'Database teacher ID must be present');

    // 3. Verify invitation is marked accepted
    const updatedInv = await invitationRepository.findByEmail(teacherEmail);
    assert.ok(updatedInv.accepted_at, 'Teacher invitation must be marked accepted upon Google sign-in');

    // 4. Verify teacher appears in Admin Users API with TEACHER role and Google badge
    const adminUsersRes = await fetch(`${baseUrl}/api/admin/users?search=${teacherEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminUsersRes.status, 200);
    const usersBody = await adminUsersRes.json();
    const foundTeacher = usersBody.data.users.find(u => u.email === teacherEmail);
    assert.ok(foundTeacher, 'Google teacher must appear in Admin Users');
    assert.strictEqual(foundTeacher.id, teacherUserId);
    assert.strictEqual(foundTeacher.role, 'TEACHER', 'Admin Users must display role TEACHER');
    assert.strictEqual(foundTeacher.auth_provider, 'google');

    // 5. Verify audit log has actor_id and mentions TEACHER
    const auditRes = await fetch(`${baseUrl}/api/admin/audit-logs?search=${teacherEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(auditRes.status, 200);
    const auditBody = await auditRes.json();
    const auditRecord = auditBody.data.logs.find(l => l.actor_email === teacherEmail);
    assert.ok(auditRecord, 'Audit log must exist for Google teacher registration');
    assert.strictEqual(auditRecord.actor_id, teacherUserId, 'Audit log must record canonical teacher DB user ID');
    assert.ok(auditRecord.summary.includes('TEACHER'), 'Audit log summary must reflect TEACHER role');

    // 6. Verify security log records canonical DB user ID
    const secRes = await fetch(`${baseUrl}/api/admin/security-logs?search=${teacherEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(secRes.status, 200);
    const secBody = await secRes.json();
    const secLog = secBody.data.logs.find(l => l.user_email === teacherEmail);
    assert.ok(secLog, 'Security log must exist for Google teacher');
    assert.strictEqual(secLog.user_id, teacherUserId, 'Security log must reference canonical teacher DB user ID');
  });

  // =========================================================================
  // TEST 5 — Admin
  // =========================================================================
  test('Test 5 — Admin: Login as admin, verify dashboard, Users/Roles API, Audit Logs, and Security Logs', async () => {
    // 1. Verify admin role on current user /me endpoint
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(meRes.status, 200);
    const meBody = await meRes.json();
    assert.strictEqual(meBody.data.user.role, 'ADMIN', 'Admin user must have role ADMIN');

    // 2. Admin Users API works
    const usersRes = await fetch(`${baseUrl}/api/admin/users?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(usersRes.status, 200);
    const usersData = await usersRes.json();
    assert.ok(Array.isArray(usersData.data.users));
    assert.ok(usersData.data.count >= usersData.data.users.length);

    // 3. Admin Audit Logs API works
    const auditRes = await fetch(`${baseUrl}/api/admin/audit-logs?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(auditRes.status, 200);
    const auditData = await auditRes.json();
    assert.ok(Array.isArray(auditData.data.logs));

    // 4. Admin Security Logs API works
    const secRes = await fetch(`${baseUrl}/api/admin/security-logs?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(secRes.status, 200);
    const secData = await secRes.json();
    assert.ok(Array.isArray(secData.data.logs));
  });

  // =========================================================================
  // TEST 6 — Duplicate Google Login
  // =========================================================================
  test('Test 6 — Duplicate Google Login: Idempotent account preservation, zero duplicates, single canonical user record', async () => {
    const timestamp = Date.now();
    const dupSub = `google-sub-dup-${timestamp}`;
    const dupEmail = `google.dup.${timestamp}@example.com`;
    const dupName = `Duplicate Test User ${timestamp}`;

    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: dupSub,
          email: dupEmail,
          email_verified: true,
          name: dupName
        })
      })
    });

    // Login 1st time
    const res1 = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'token.first.login' })
    });
    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json();
    const firstUserId = body1.data.user.id;
    const firstRole = body1.data.user.role;
    assert.strictEqual(body1.data.is_new_user, true);

    // Login 2nd time with identical Google identity
    const res2 = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'token.second.login' })
    });
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    const secondUserId = body2.data.user.id;
    const secondRole = body2.data.user.role;

    // Verify 1: Exactly the same canonical user ID
    assert.strictEqual(secondUserId, firstUserId, 'Second login must return the EXACT SAME database user ID');

    // Verify 2: Preserved existing role
    assert.strictEqual(secondRole, firstRole, 'Second login must preserve the user role');

    // Verify 3: Flagged as returning user
    assert.strictEqual(body2.data.is_new_user, false, 'is_new_user must be false on subsequent logins');

    // Verify 4: Database query confirms NO duplicate record was created
    if (isPostgresConnected && pool) {
      const dbCheck = await pool.query('SELECT count(*)::int as count FROM users WHERE email = $1', [dupEmail]);
      assert.strictEqual(dbCheck.rows[0].count, 1, 'Database must have exactly 1 record for this Google email');
    } else {
      const memMatches = (memoryStore.users || []).filter(u => u.email === dupEmail);
      assert.strictEqual(memMatches.length, 1, 'In-memory store must have exactly 1 record for this Google email');
    }

    // Verify 5: Both login events generated audit & security entries
    const secLogsRes = await fetch(`${baseUrl}/api/admin/security-logs?search=${dupEmail}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(secLogsRes.status, 200);
    const secLogsData = await secLogsRes.json();
    assert.ok(secLogsData.data.logs.length >= 2, 'Security events should be generated for each authentication attempt');
    assert.ok(secLogsData.data.logs.every(l => l.user_id === firstUserId), 'All security events must reference the same canonical user ID');
  });
});
