import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { lmsRepository } from '../src/repositories/lmsRepository.js';
import { emailService } from '../src/services/emailService.js';

let server;
let baseUrl;
let teacherToken;

describe('Teacher Attendance Roster & OTP Email Resiliency Tests', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    assert.strictEqual(loginRes.status, 200);
    teacherToken = (await loginRes.json()).data.token;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('1. lmsRepository.getStudentsInClass returns students enrolled in batch via batch_enrollments', async () => {
    // In seedData: user-student-001 is enrolled in batch-cs-a1
    const students = await lmsRepository.getStudentsInClass('class-cs-a', 'batch-cs-a1');
    assert.ok(Array.isArray(students), 'Should return an array');
    assert.ok(students.length >= 1, 'Should find at least 1 student');
    const s1 = students.find(s => s.id === 'user-student-001' || s.student_id === 'user-student-001');
    assert.ok(s1, 'user-student-001 must be returned');
    assert.strictEqual(s1.full_name, 'Aarav Sharma');
  });

  test('2. GET /api/teacher/students with batchId returns enrolled roster', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/students?classId=class-cs-a&batchId=batch-cs-a1`, {
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 1);
    const s1 = body.data.find(s => s.id === 'user-student-001');
    assert.ok(s1, 'Should include user-student-001 in student list');
  });

  test('3. POST /api/teacher/attendance allows null subject_id for general batch roll call', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/attendance`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        batch_id: 'batch-cs-a1',
        date: '2027-01-16',
        records: [
          { student_id: 'user-student-001', status: 'present', remarks: 'Roll call' }
        ]
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.strictEqual(body.data.length, 1);
    assert.strictEqual(body.data[0].student_id, 'user-student-001');
    assert.strictEqual(body.data[0].status, 'present');
  });

  test('4. emailService initializes with resilient timeouts and handles mock delivery', async () => {
    const res = await emailService.sendVerificationOtp(
      'test-student@example.com',
      '482910',
      'Alex Student',
      15000
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sent, true);
    assert.strictEqual(res.mocked, true);
  });
});
