import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { userRepository } from '../src/repositories/userRepository.js';

let server;
let baseUrl;
let studentToken;
let student2Token;
let teacherToken;
let otherTeacherToken;
let adminToken;
let studentUser;
let teacherUser;
let testId1;
let testId2;

describe('Mock Test Join Approval & Access Control Security Test Suite', () => {
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

    // 1. Login Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const aBody = await adminRes.json();
    adminToken = aBody.data.token;

    // 2. Login primary Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const sBody = await studentRes.json();
    studentToken = sBody.data.token;
    studentUser = sBody.data.user;

    // 3. Create & Login second Student
    const s2Email = `student2.${Date.now()}@linktest.io`;
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await userRepository.create({
      fullName: 'Priya Sharma',
      email: s2Email,
      passwordHash,
      role: 'STUDENT',
      emailVerified: true,
      status: 'active'
    });

    const s2Login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: s2Email, password: 'Password123!' })
    });
    const s2Body = await s2Login.json();
    student2Token = s2Body.data.token;

    // 4. Login primary Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const tBody = await teacherRes.json();
    teacherToken = tBody.data.token;
    teacherUser = tBody.data.user;

    // 5. Create & Login other Teacher
    const otEmail = `other.teacher.${Date.now()}@linktest.io`;
    await userRepository.create({
      fullName: 'Dr. Other Teacher',
      email: otEmail,
      passwordHash,
      role: 'TEACHER',
      emailVerified: true,
      status: 'active'
    });

    const otLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otEmail, password: 'Password123!' })
    });
    const otBody = await otLogin.json();
    otherTeacherToken = otBody.data.token;

    // 6. Create Test 1 by primary Teacher
    const createTestRes1 = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Algorithms Final Mock Examination',
        subject: 'Computer Science',
        topic: 'Graph Theory & Dynamic Programming',
        difficulty: 'medium',
        category: 'mock_exam',
        duration_minutes: 45,
        total_marks: 20,
        pass_percentage: 50,
        status: 'published',
        questions: [
          {
            question_text: 'What is the time complexity of Dijkstra with binary heap?',
            question_type: 'MCQ_SINGLE',
            marks: 10,
            penalty_marks: 0,
            topic: 'Graphs',
            options: [
              { id: 'opt_1', text: 'O(V^2)' },
              { id: 'opt_2', text: 'O((V + E) log V)' },
              { id: 'opt_3', text: 'O(E log E)' },
              { id: 'opt_4', text: 'O(V log V)' }
            ],
            correct_answer: { selected: 'opt_2' },
            explanation: 'Using binary heap priority queue, Dijkstra runs in O((V + E) log V).'
          },
          {
            question_text: 'Is Floyd-Warshall suitable for graphs with negative cycles?',
            question_type: 'TRUE_FALSE',
            marks: 10,
            penalty_marks: 2,
            topic: 'Graphs',
            correct_answer: { boolean: false },
            explanation: 'Floyd-Warshall cannot compute correct distances if negative cycles exist.'
          }
        ]
      })
    });
    const t1Body = await createTestRes1.json();
    testId1 = t1Body.data.test.id;

    // 7. Create Test 2 by primary Teacher (for Rejection & Re-request workflow)
    const createTestRes2 = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Database Internals Speed Test',
        subject: 'Database Systems',
        topic: 'Storage Engines & WAL',
        difficulty: 'hard',
        category: 'mock_exam',
        duration_minutes: 30,
        total_marks: 10,
        status: 'published',
        questions: [
          {
            question_text: 'WAL stands for Write Ahead Logging.',
            question_type: 'TRUE_FALSE',
            marks: 10,
            correct_answer: { boolean: true }
          }
        ]
      })
    });
    const t2Body = await createTestRes2.json();
    testId2 = t2Body.data.test.id;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ==========================================
  // SECTION 1: CRITICAL DIRECT ATTEMPT BLOCK
  // ==========================================
  test('Security Rule: Direct attempt creation without any join request is blocked with 403 MOCK_TEST_APPROVAL_REQUIRED', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 403, 'Must return HTTP 403');
    const body = await res.json();
    assert.strictEqual(body.error?.code || body.code || body.error, 'MOCK_TEST_APPROVAL_REQUIRED');
    assert.ok((body.error?.message || body.message).includes('approval is required'));
  });

  test('Check initial join status for student returns NONE', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/join-request`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'NONE');
  });

  // ==========================================
  // SECTION 2: STUDENT SUBMITS JOIN REQUEST
  // ==========================================
  let activeRequestId;

  test('Student can submit a join request -> status becomes PENDING', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/join-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.id);
    assert.strictEqual(body.data.status, 'PENDING');
    assert.strictEqual(body.data.mockTestId, testId1);
    activeRequestId = body.data.id;
  });

  test('Duplicate active join request is rejected (409 Conflict)', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/join-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.error?.code || body.code || body.error, 'DUPLICATE_ACTIVE_REQUEST');
  });

  test('Student checking status sees PENDING', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/join-request`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'PENDING');
    assert.strictEqual(body.data.id, activeRequestId);
  });

  test('Security Rule: Direct attempt creation while PENDING is blocked with 403', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error?.code || body.code || body.error, 'MOCK_TEST_APPROVAL_REQUIRED');
  });

  // ==========================================
  // SECTION 3: TEACHER VIEW & RBAC
  // ==========================================
  test('Teacher can view incoming join requests with student and test details', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests?status=PENDING`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data.requests));
    const target = body.data.requests.find(r => r.id === activeRequestId);
    assert.ok(target, 'Active request must be listed for teacher');
    assert.strictEqual(target.status, 'PENDING');
    assert.strictEqual(target.student_name, studentUser.full_name);
    assert.ok(target.mock_test_title);
    assert.ok(target.requested_at);
  });

  test('Student CANNOT approve join requests (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${activeRequestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    assert.strictEqual(res.status, 403);
  });

  test('Student CANNOT reject join requests (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${activeRequestId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ reason: 'Student trying to reject' })
    });
    assert.strictEqual(res.status, 403);
  });

  test('Unauthorized teacher cannot approve request for another teacher test', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${activeRequestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherTeacherToken}`
      }
    });
    assert.strictEqual(res.status, 403);
  });

  // ==========================================
  // SECTION 4: TEACHER APPROVE & ATTEMPT FLOW
  // ==========================================
  test('Authorized teacher approves request -> status becomes APPROVED', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${activeRequestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.request.status, 'APPROVED');
    assert.ok(body.data.request.reviewed_at);
    assert.ok(body.data.request.reviewed_by);
  });

  test('Race condition prevention: Cannot re-approve an already approved request (409 Conflict)', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${activeRequestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      }
    });
    assert.strictEqual(res.status, 409);
  });

  test('Student status immediately reflects APPROVED', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/join-request`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'APPROVED');
  });

  let createdAttemptId;

  test('Student with APPROVED request is permitted to start examination attempt', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.attempt_id, 'Valid attempt ID must be returned');
    assert.notStrictEqual(body.data.attempt_id, 'undefined');
    assert.notStrictEqual(body.data.attempt_id, 'null');
    createdAttemptId = body.data.attempt_id;
  });

  test('Student can save answers and complete approved exam normally', async () => {
    // 1. Fetch questions to answer
    const attemptRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(attemptRes.status, 200);
    const attemptBody = await attemptRes.json();
    const questions = attemptBody.data.questions;
    assert.ok(questions.length >= 2);

    // 2. Save answer
    const saveRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        question_id: questions[0].id,
        answer: { selected: 'opt_2' }
      })
    });
    assert.strictEqual(saveRes.status, 200);

    // 3. Submit attempt
    const submitRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ proctoring_summary: { fullscreens_lost: 0 } })
    });
    assert.strictEqual(submitRes.status, 200);
    const submitBody = await submitRes.json();
    assert.ok(submitBody.data.total_score !== undefined || submitBody.data.score !== undefined);
  });

  // ==========================================
  // SECTION 5: REJECTION & RE-REQUEST WORKFLOW
  // ==========================================
  let rejectRequestId;

  test('Rejection workflow: Student requests access to Test 2 -> PENDING', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId2}/join-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'PENDING');
    rejectRequestId = body.data.id;
  });

  test('Teacher rejects request with specific reason -> status becomes REJECTED', async () => {
    const reasonText = 'Please wait until the scheduled batch slot at 3:00 PM.';
    const res = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${rejectRequestId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ reason: reasonText })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.request.status, 'REJECTED');
    assert.strictEqual(body.data.request.rejection_reason, reasonText);
  });

  test('Student cannot start test when request is REJECTED (HTTP 403)', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId2}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error?.code || body.code || body.error, 'MOCK_TEST_APPROVAL_REQUIRED');
  });

  test('Student checks status and sees REJECTED with rejection reason', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId2}/join-request`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'REJECTED');
    assert.strictEqual(body.data.rejection_reason || body.data.request?.rejection_reason, 'Please wait until the scheduled batch slot at 3:00 PM.');
  });

  test('Student can request again after rejection -> new PENDING request is created', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId2}/join-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'PENDING');
    assert.notStrictEqual(body.data.id, rejectRequestId);

    // Check status is now PENDING
    const checkRes = await fetch(`${baseUrl}/api/mock-tests/${testId2}/join-request`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const checkBody = await checkRes.json();
    assert.strictEqual(checkBody.data.status, 'PENDING');
  });

  // ==========================================
  // SECTION 6: ISOLATION & PRIVACY (Student A vs B)
  // ==========================================
  test('Student A cannot view or inspect Student B join status for same test', async () => {
    // Student 2 checks Test 1 (which Student 1 attempted)
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId1}/join-request`, {
      headers: { Authorization: `Bearer ${student2Token}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    // Student 2 never requested Test 1, so their status is strictly NONE
    assert.strictEqual(body.data.status, 'NONE');
  });
});
