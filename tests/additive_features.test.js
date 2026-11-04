import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, pool, isPostgresConnected, memoryStore } from '../src/db/index.js';
import { lmsRepository } from '../src/repositories/lmsRepository.js';
import { batchRepository } from '../src/repositories/batchRepository.js';
import { mockTestRepository } from '../src/repositories/mockTestRepository.js';
import crypto from 'crypto';

let server;
let baseUrl;

describe('LinkTest Additive Features & Integration Test Suite', () => {
  const rand = crypto.randomUUID().slice(0, 6);
  const adminEmail = `admin_af_${rand}@test.com`;
  const teacherEmail = `teacher_af_${rand}@test.com`;
  const student1Email = `student1_af_${rand}@test.com`;
  const student2Email = `student2_af_${rand}@test.com`;

  let adminToken = '';
  let teacherToken = '';
  let student1Token = '';
  let student2Token = '';
  let adminId = '';
  let teacherId = '';
  let student1Id = '';
  let student2Id = '';
  let cls = null;
  let batch = null;

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

    const createAndLogin = async (email, name, role) => {
      await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name, email, password: 'Password123!' })
      });
      if (isPostgresConnected && pool) {
        await pool.query("UPDATE users SET role = $1, email_verified = true WHERE email = $2", [role, email]);
      } else {
        const u = (memoryStore.users || []).find(user => user.email === email);
        if (u) { u.role = role; u.email_verified = true; }
      }
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password123!' })
      });
      const data = await loginRes.json();
      return {
        token: data.data?.token || data.token,
        userId: data.data?.user?.id || data.user?.id
      };
    };

    const admin = await createAndLogin(adminEmail, 'Admin AF', 'ADMIN');
    adminToken = admin.token;
    adminId = admin.userId;

    const teacher = await createAndLogin(teacherEmail, 'Teacher AF', 'TEACHER');
    teacherToken = teacher.token;
    teacherId = teacher.userId;

    const s1 = await createAndLogin(student1Email, 'Student AF1', 'STUDENT');
    student1Token = s1.token;
    student1Id = s1.userId;

    const s2 = await createAndLogin(student2Email, 'Student AF2', 'STUDENT');
    student2Token = s2.token;
    student2Id = s2.userId;

    // Create class & batch
    cls = await lmsRepository.createClass({ name: 'Computer Science 2026', code: `CS${rand}` });
    batch = await batchRepository.createBatch({
      name: 'CS Alpha Batch',
      code: `CS-A-${rand}`,
      class_id: cls.id,
      capacity: 40,
      created_by: adminId
    });

    // Assign teacher & enroll student 1
    await batchRepository.assignTeacherToBatch({ batchId: batch.id, teacherId, role: 'primary' });
    await batchRepository.enrollStudentsBulkInBatch({ batchId: batch.id, studentIds: [student1Id], enrolledBy: adminId });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('1. Batch Counts: returns enrolled_count and teacher_count correctly', async () => {
    const batches = await batchRepository.getAllBatches();
    const found = batches.find(b => b.id === batch.id);
    assert.ok(found, 'Batch should be returned in list');
    assert.equal(found.enrolled_count, 1, 'Should have 1 enrolled student');
    assert.equal(found.teacher_count, 1, 'Should have 1 assigned teacher');
    assert.equal(found.teachers_count, 1, 'teachers_count should match teacher_count');
  });

  test('2. Admin Students Roster: Enriched with batch membership, batch code, and teacher', async () => {
    const res = await fetch(`${baseUrl}/api/admin/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const list = body.data?.students || body.data;
    const student1 = list.find(s => s.id === student1Id);
    assert.ok(student1, 'Student 1 should be returned');
    assert.equal(student1.batch_name, 'CS Alpha Batch');
    assert.ok(student1.batches && student1.batches.length > 0);
  });

  test('3. Material Visibility: Teacher uploaded material is published=true and visible to enrolled student', async () => {
    const uploadRes = await fetch(`${baseUrl}/api/teacher/materials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Data Structures Handout',
        description: 'Lecture 1 notes',
        type: 'pdf',
        class_id: cls.id,
        external_url: 'https://linktest.io/handouts/ds.pdf'
      })
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 201);
    assert.equal(uploadBody.success, true);
    assert.equal(uploadBody.data.published, true, 'Material should default to published: true');

    // Student 1 (enrolled in batch of class) fetches materials
    const s1Res = await fetch(`${baseUrl}/api/student/materials`, {
      headers: { Authorization: `Bearer ${student1Token}` }
    });
    const s1Body = await s1Res.json();

    assert.equal(s1Res.status, 200);
    assert.equal(s1Body.success, true);
    const hasMaterial = s1Body.data.some(m => m.id === uploadBody.data.id);
    assert.ok(hasMaterial, 'Enrolled student should see the uploaded study material');

    // Student 2 (not enrolled in class or batch) fetches materials
    const s2Res = await fetch(`${baseUrl}/api/student/materials`, {
      headers: { Authorization: `Bearer ${student2Token}` }
    });
    const s2Body = await s2Res.json();

    assert.equal(s2Res.status, 200);
    const s2HasMaterial = s2Body.data.some(m => m.id === uploadBody.data.id);
    assert.equal(s2HasMaterial, false, 'Unenrolled student must NOT see class material');
  });

  test('4. Student Progress API: Returns overall metrics, trend, accuracy breakdown, and attempts', async () => {
    // Create test & attempt for student 1
    const testRecord = await mockTestRepository.createTest({
      title: 'Full Stack Integration Mock Exam',
      subject: 'Computer Science',
      duration_minutes: 45,
      total_marks: 50,
      pass_percentage: 40,
      created_by: teacherId,
      batch_id: batch.id,
      status: 'published'
    });

    const attempt = await mockTestRepository.createAttempt({
      test_id: testRecord.id,
      student_id: student1Id,
      max_score: 50
    });

    // Submit attempt with score
    await mockTestRepository.updateAttempt(attempt.id, {
      status: 'evaluated',
      result_status: 'RELEASED',
      total_score: 42,
      percentage: 84,
      passed: true,
      correct_count: 8,
      incorrect_count: 2,
      unanswered_count: 0,
      time_spent_seconds: 1500,
      submitted_at: new Date().toISOString()
    });

    const progRes = await fetch(`${baseUrl}/api/student/progress`, {
      headers: { Authorization: `Bearer ${student1Token}` }
    });
    const progBody = await progRes.json();

    assert.equal(progRes.status, 200);
    assert.equal(progBody.success, true);
    const data = progBody.data;
    assert.ok(data.overall);
    assert.equal(data.overall.total_mock_tests_attempted, 1);
    assert.equal(data.overall.average_score, 42);
    assert.equal(data.overall.highest_score, 42);
    assert.equal(data.overall.average_percentage, 84);
    assert.equal(data.overall.average_accuracy, 80); // 8 / (8 + 2) = 80%
    assert.equal(data.overall.total_correct, 8);
    assert.equal(data.overall.total_wrong, 2);
    assert.equal(data.overall.total_time_spent_seconds, 1500);

    assert.ok(Array.isArray(data.trend));
    assert.equal(data.trend.length, 1);
    assert.ok(data.accuracy_breakdown);
    assert.equal(data.accuracy_breakdown.correct_count, 8);
    assert.equal(data.accuracy_breakdown.wrong_count, 2);
    assert.ok(Array.isArray(data.attempts));
    assert.equal(data.attempts.length, 1);
    assert.equal(data.attempts[0].test_name, 'Full Stack Integration Mock Exam');
    assert.equal(data.attempts[0].marks_obtained, 42);
    assert.equal(data.attempts[0].total_marks, 50);
    assert.equal(data.attempts[0].percentage, 84);
    assert.equal(data.attempts[0].passed, true);
  });

  test('5. Admin Mock Test Analytics: Admin can access analytics with question analysis', async () => {
    const tests = await mockTestRepository.getAllTests();
    const testItem = tests[0];

    const res = await fetch(`${baseUrl}/api/mock-tests/${testItem.id}/analytics`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const data = body.data;
    assert.ok(data.title);
    assert.ok(data.score_distribution);
    assert.ok(Array.isArray(data.candidates));
    assert.ok(Array.isArray(data.question_analysis));
  });
});
