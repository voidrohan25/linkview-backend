import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { lmsRepository } from '../src/repositories/lmsRepository.js';

let server;
let baseUrl;
let studentToken;
let teacherToken;

describe('Teacher assigned class rosters', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const [teacherRes, studentRes] = await Promise.all([
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
      }),
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
      })
    ]);
    assert.strictEqual(teacherRes.status, 200);
    assert.strictEqual(studentRes.status, 200);
    teacherToken = (await teacherRes.json()).data.token;
    studentToken = (await studentRes.json()).data.token;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('teacher receives assigned batches with active student details and counts', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));

    const batch = body.data.find(item => item.batch_id === 'batch-cs-a1');
    assert.ok(batch);
    assert.strictEqual(batch.class_id, 'class-cs-a');
    assert.ok(batch.class_name);
    assert.strictEqual(batch.batch_name, 'Section A1');
    assert.strictEqual(batch.student_count, batch.students.length);
    assert.deepStrictEqual(batch.students[0], {
      student_id: 'user-student-001',
      full_name: 'Aarav Sharma',
      enrollment_number: 'LT-2026-001',
      email: 'student@linktest.io'
    });
    assert.ok(batch.subject_id);
  });

  test('student is forbidden from viewing teacher class rosters', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('teachers without batch assignments receive no classes', async () => {
    assert.deepStrictEqual(await lmsRepository.getAssignedClassesWithStudents('teacher-without-assignments'), []);
  });
});
