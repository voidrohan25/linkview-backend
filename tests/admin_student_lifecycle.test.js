import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import { initDb, memoryStore } from '../src/db/index.js';
import { auditRepository } from '../src/repositories/auditRepository.js';
import { lmsRepository } from '../src/repositories/lmsRepository.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { emailService } from '../src/services/emailService.js';

let server;
let baseUrl;
let adminToken;
let adminUser;

before(async () => {
  process.env.MOCK_EMAIL = 'true';
  await initDb();
  adminUser = await userRepository.findByEmail('admin@linktest.io');
  if (!adminUser) {
    adminUser = await userRepository.create({
      fullName: 'Lifecycle Test Admin',
      email: 'admin@linktest.io',
      passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
      role: 'ADMIN',
      emailVerified: true
    });
  }
  adminToken = jwt.sign({ id: adminUser.id, email: adminUser.email, role: 'ADMIN' }, config.jwtSecret);
  await new Promise(resolve => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('admin can create, suspend, reset, and reactivate a student account', async () => {
  const email = `lifecycle.${Date.now()}@linktest.io`;
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  };
  const createResponse = await fetch(`${baseUrl}/api/admin/students`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ full_name: 'Lifecycle Student', email })
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).data;
  assert.equal(created.student.role, 'STUDENT');
  assert.equal(created.student.email_verified, true);
  assert.match(created.temporary_password, /^[A-Za-z0-9_-]{32}$/);
  assert.match(created.enrollment_id, /^LT-\d{8}-[A-F0-9]{8}$/);
  assert.equal(created.student.password_hash, undefined);

  const persistedStudent = await userRepository.findByEmail(email);
  assert.ok(await bcrypt.compare(created.temporary_password, persistedStudent.password_hash));
  const profile = await lmsRepository.getStudentProfile(persistedStudent.id);
  assert.equal(profile.enrollment_number, created.enrollment_id);

  const duplicateResponse = await fetch(`${baseUrl}/api/admin/students`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ full_name: 'Duplicate Student', email: email.toUpperCase() })
  });
  assert.equal(duplicateResponse.status, 409);

  const invalidResponse = await fetch(`${baseUrl}/api/admin/students`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ full_name: 'No', email: 'not-an-email' })
  });
  assert.equal(invalidResponse.status, 400);

  const suspendResponse = await fetch(`${baseUrl}/api/admin/students/${persistedStudent.id}/status`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ status: 'Suspended' })
  });
  assert.equal(suspendResponse.status, 200);

  const suspendedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: created.temporary_password })
  });
  assert.equal(suspendedLogin.status, 403);
  assert.equal((await suspendedLogin.json()).error.code, 'ACCOUNT_SUSPENDED');

  const resetResponse = await fetch(`${baseUrl}/api/admin/students/${persistedStudent.id}/reset-password`, {
    method: 'POST',
    headers
  });
  assert.equal(resetResponse.status, 200);
  const resetBody = await resetResponse.json();
  assert.equal(JSON.stringify(resetBody).includes('token='), false);
  const resetEmail = emailService.getLastSentEmail();
  assert.equal(resetEmail.to, email);
  const resetToken = new URL(resetEmail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  assert.ok(resetToken);
  const tokenRecord = memoryStore.password_reset_tokens.find(record => record.user_id === persistedStudent.id);
  assert.equal(tokenRecord.token_hash, crypto.createHash('sha256').update(resetToken).digest('hex'));

  const completeResetResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: resetToken, new_password: 'ReplacementPass123!' })
  });
  assert.equal(completeResetResponse.status, 200);

  const activateResponse = await fetch(`${baseUrl}/api/admin/students/${persistedStudent.id}/status`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ status: 'Active' })
  });
  assert.equal(activateResponse.status, 200);

  const activatedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ReplacementPass123!' })
  });
  assert.equal(activatedLogin.status, 200);

  const auditLogs = await auditRepository.getLogs({ actorId: adminUser.id, limit: 100 });
  const lifecycleLogs = auditLogs.logs.filter(log => log.resource_id === persistedStudent.id);
  assert.ok(lifecycleLogs.some(log => log.action === 'STUDENT_CREATED' && log.created_at));
  assert.ok(lifecycleLogs.some(log => log.action === 'STUDENT_STATUS_CHANGED' && log.created_at));
  assert.ok(lifecycleLogs.some(log => log.action === 'STUDENT_CREDENTIAL_RESET_REQUESTED' && log.created_at));
});

test('admin can supply an initial password and enrollment ID', async () => {
  const email = `supplied.${Date.now()}@linktest.io`;
  const response = await fetch(`${baseUrl}/api/admin/students`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'Supplied Credentials Student',
      email,
      password: 'SuppliedPass123!',
      enrollment_id: 'ORG-2026-0001'
    })
  });
  assert.equal(response.status, 201);
  const data = (await response.json()).data;
  assert.equal(data.temporary_password, undefined);
  assert.equal(data.enrollment_id, 'ORG-2026-0001');
  const profile = await lmsRepository.getStudentProfile(data.student.id);
  assert.equal(profile.enrollment_number, 'ORG-2026-0001');

  const duplicateEnrollmentResponse = await fetch(`${baseUrl}/api/admin/students`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'Duplicate Enrollment Student',
      email: `duplicate.enrollment.${Date.now()}@linktest.io`,
      password: 'SuppliedPass123!',
      enrollment_id: 'ORG-2026-0001'
    })
  });
  assert.equal(duplicateEnrollmentResponse.status, 409);

  const invalidPasswordResponse = await fetch(`${baseUrl}/api/admin/students`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      full_name: 'Weak Password Student',
      email: `weak.${Date.now()}@linktest.io`,
      password: 'short'
    })
  });
  assert.equal(invalidPasswordResponse.status, 400);
});
