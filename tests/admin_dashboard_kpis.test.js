import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import { initDb, memoryStore } from '../src/db/index.js';
import { userRepository } from '../src/repositories/userRepository.js';

let server;
let baseUrl;
let adminUser;
let adminToken;
let studentToken;

before(async () => {
  await initDb();
  adminUser = await userRepository.findByEmail('admin@linktest.io');
  const student = await userRepository.findByEmail('student@linktest.io');
  adminToken = jwt.sign({ id: adminUser.id, role: adminUser.role }, config.jwtSecret);
  studentToken = jwt.sign({ id: student.id, role: student.role }, config.jwtSecret);
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

test('admin dashboard returns KPI fields consistent with stored data', async () => {
  const response = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(response.status, 200);
  const { stats } = (await response.json()).data;

  assert.equal(stats.totalStudents, memoryStore.users.filter(user => user.role === 'STUDENT').length);
  assert.equal(stats.totalTeachers, memoryStore.users.filter(user => user.role === 'TEACHER').length);
  assert.equal(stats.activeBatches, memoryStore.batches.filter(batch => batch.status.toLowerCase() === 'active').length);
  assert.equal(stats.totalCourses, memoryStore.courses.length);
  assert.equal(stats.totalExams, memoryStore.mock_tests.length);
  assert.equal(stats.totalExamAttempts, memoryStore.mock_test_attempts.length);
  assert.equal(stats.conductedExams, memoryStore.mock_test_attempts.filter(
    attempt => ['submitted', 'evaluated'].includes(attempt.status)
  ).length);
  assert.ok(Number.isInteger(stats.systemUptime) && stats.systemUptime >= 0);
  assert.ok(Array.isArray(stats.recent_activity));
  assert.equal(stats.course_count, memoryStore.courses.length);
});

test('non-admin cannot read dashboard KPIs', async () => {
  const response = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FORBIDDEN');
});

test('empty KPI tables return zero counts', async () => {
  const tableNames = [
    'users', 'courses', 'quizzes', 'quiz_attempts', 'classes', 'batches',
    'lessons', 'live_class_sessions', 'assignments', 'mock_tests', 'mock_test_attempts'
  ];
  const savedTables = Object.fromEntries(tableNames.map(name => [name, memoryStore[name]]));
  try {
    for (const name of tableNames) memoryStore[name] = [];
    memoryStore.users = [adminUser];

    const response = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(response.status, 200);
    const { stats } = (await response.json()).data;
    for (const key of [
      'totalStudents', 'totalTeachers', 'activeBatches', 'totalCourses',
      'totalExams', 'totalExamAttempts', 'conductedExams', 'student_count',
      'teacher_count', 'course_count', 'batch_count', 'class_count',
      'quiz_count', 'attempt_count', 'mock_test_count', 'mock_test_attempt_count'
    ]) {
      assert.equal(stats[key], 0, `${key} should be zero when its table is empty`);
    }
    assert.deepEqual(stats.recent_activity, []);
  } finally {
    for (const [name, rows] of Object.entries(savedTables)) memoryStore[name] = rows;
  }
});
