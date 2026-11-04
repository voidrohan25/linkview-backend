import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { initDb, pool } from '../src/db/index.js';
import { userRepository } from '../src/repositories/userRepository.js';

let server;
let baseUrl;

let adminToken;
let teacherToken;
let teacherUser;
let studentAToken;
let studentAUser;
let studentBToken;
let studentBUser;

let classId;
let batchAId;
let batchBId;
let mockTestId;
let studentAAttemptId;
let mcqQuestionId;
let laQuestionId;
let codingQuestionId;

describe('Mock Exam Complete System End-to-End Verification Suite', () => {
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

    const passwordHash = await bcrypt.hash('Password123!', 10);
    const suffix = Date.now();

    // 1. Authenticate Admin
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
        body: JSON.stringify({
          email: 'admin@linktest.io',
          password: 'Admin123!'
        })
      });
    }
    const adminBody = await adminRes.json();
    assert.equal(adminRes.status, 200);
    adminToken = adminBody.data.token;

    // 2. Create Teacher A (Assigned subject: Mechanical Engineering to test subject removal)
    const teacherEmail = `teacher.mech.${suffix}@linktest.io`;
    teacherUser = await userRepository.create({
      fullName: 'Prof. Ramesh Sharma (Mech)',
      email: teacherEmail,
      passwordHash,
      role: 'TEACHER',
      subject: 'Mechanical Engineering',
      emailVerified: true,
      status: 'active'
    });

    const teacherLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: teacherEmail, password: 'Password123!' })
    });
    const tBody = await teacherLogin.json();
    assert.equal(teacherLogin.status, 200);
    teacherToken = tBody.data.token;

    // 3. Create Class & Batches (Batch A and Batch B)
    const classRes = await fetch(`${baseUrl}/api/admin/classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Computer Science Dept ${suffix}`,
        code: `CS-${suffix}`
      })
    });
    const cData = await classRes.json();
    assert.equal(classRes.status, 201);
    classId = cData.data.class.id;

    const batchARes = await fetch(`${baseUrl}/api/admin/classes/${classId}/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `CS101 Batch A`,
        code: `CS101-A-${suffix}`,
        max_students: 50
      })
    });
    const bAData = await batchARes.json();
    assert.equal(batchARes.status, 201);
    batchAId = bAData.data.batch.id;

    const batchBRes = await fetch(`${baseUrl}/api/admin/classes/${classId}/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `CS101 Batch B`,
        code: `CS101-B-${suffix}`,
        max_students: 50
      })
    });
    const bBData = await batchBRes.json();
    assert.equal(batchBRes.status, 201);
    batchBId = bBData.data.batch.id;

    // 4. Create Student A and enroll in Batch A
    const sAEmail = `student.a.${suffix}@linktest.io`;
    studentAUser = await userRepository.create({
      fullName: 'Rahul Verma',
      email: sAEmail,
      passwordHash,
      role: 'STUDENT',
      emailVerified: true,
      status: 'active'
    });

    const sALogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sAEmail, password: 'Password123!' })
    });
    const sABody = await sALogin.json();
    studentAToken = sABody.data.token;

    const enrARes = await fetch(`${baseUrl}/api/admin/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_id: studentAUser.id,
        class_id: classId,
        batch_id: batchAId
      })
    });
    assert.equal(enrARes.status, 201);

    await fetch(`${baseUrl}/api/batches/${batchAId}/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_ids: [studentAUser.id]
      })
    });

    // 5. Create Student B and enroll in Batch B
    const sBEmail = `student.b.${suffix}@linktest.io`;
    studentBUser = await userRepository.create({
      fullName: 'Amit Kumar',
      email: sBEmail,
      passwordHash,
      role: 'STUDENT',
      emailVerified: true,
      status: 'active'
    });

    const sBLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sBEmail, password: 'Password123!' })
    });
    const sBBody = await sBLogin.json();
    studentBToken = sBBody.data.token;

    const enrBRes = await fetch(`${baseUrl}/api/admin/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_id: studentBUser.id,
        class_id: classId,
        batch_id: batchBId
      })
    });
    assert.equal(enrBRes.status, 201);

    await fetch(`${baseUrl}/api/batches/${batchBId}/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_ids: [studentBUser.id]
      })
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Step 1-4: Teacher A creates CS101 Mock for Batch A (Subject restriction removed & Duration configurable)', async () => {
    // Teacher A (assigned Mechanical Engineering) creates CS101 test with 45m duration for Batch A
    const res = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'CS101 Midterm Mock',
        description: 'Midterm assessment covering CS fundamentals and programming.',
        subject: 'Computer Science Fundamentals, CS101',
        topic: 'Core CS & Programming',
        difficulty: 'medium',
        duration_minutes: 45,
        batch_id: batchAId,
        status: 'published',
        questions: [
          {
            question_text: 'What is the primary protocol used to securely browse web pages?',
            question_type: 'mcq_single',
            options: ['HTTP', 'FTP', 'HTTPS', 'SMTP'],
            answer_key: { correct_index: 2 },
            marks: 2,
            negative_marks: 0,
            explanation: 'HTTPS provides encrypted transport via TLS.'
          },
          {
            question_text: 'Explain the difference between TCP and UDP transport protocols.',
            question_type: 'long_answer',
            marks: 5,
            expected_answer: 'TCP is connection-oriented and reliable. UDP is connectionless and lightweight.',
            evaluation_criteria: 'TCP connection vs UDP\nReliability & ordering\nUse-case examples'
          },
          {
            question_text: 'Write a function sum(a, b) that returns the addition of two numbers.',
            question_type: 'coding',
            programming_language: 'javascript',
            starter_code: 'function sum(a, b) {\n  return 0;\n}',
            marks: 10,
            test_cases: [
              { input: '2 3', expected_output: '5', is_hidden: false }
            ]
          }
        ]
      })
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Failed to create mock: ${JSON.stringify(body)}`);
    assert.ok(body.data.test.id);
    mockTestId = body.data.test.id;

    assert.equal(body.data.test.duration_minutes, 45);
    assert.equal(body.data.test.batch_id, batchAId);
    assert.equal(body.data.test.subject, 'Computer Science Fundamentals, CS101');
    assert.equal(body.data.test.questions.length, 3);

    const questions = body.data.test.questions;
    mcqQuestionId = questions.find(q => q.question_type.includes('mcq')).id;
    laQuestionId = questions.find(q => q.question_type === 'long_answer').id;
    codingQuestionId = questions.find(q => q.question_type === 'coding').id;
    assert.ok(mcqQuestionId);
    assert.ok(laQuestionId);
    assert.ok(codingQuestionId);
  });

  test('Step 5-7: Batch Isolation on Mock Listing & Direct Access', async () => {
    // Student A (Batch A) lists mocks -> must see CS101 Midterm Mock
    const sAListRes = await fetch(`${baseUrl}/api/mock-tests`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    const sAListBody = await sAListRes.json();
    assert.equal(sAListRes.status, 200);
    const sAFound = (sAListBody.data.tests || []).some(t => t.id === mockTestId);
    assert.equal(sAFound, true, 'Student A from Batch A must see the mock');

    // Student B (Batch B) lists mocks -> must NOT see CS101 Midterm Mock
    const sBListRes = await fetch(`${baseUrl}/api/mock-tests`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    const sBListBody = await sBListRes.json();
    assert.equal(sBListRes.status, 200);
    const sBFound = (sBListBody.data.tests || []).some(t => t.id === mockTestId);
    assert.equal(sBFound, false, 'Student B from Batch B must NOT see Batch A mock');

    // Student B attempts direct GET /api/mock-tests/:id -> must be 403 Forbidden
    const sBDirectRes = await fetch(`${baseUrl}/api/mock-tests/${mockTestId}`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    assert.equal(sBDirectRes.status, 403, 'Direct access to batch mock must return 403 Forbidden');

    // Student B attempts to start an attempt on Batch A mock -> must be 403 Forbidden
    const sBStartRes = await fetch(`${baseUrl}/api/mock-tests/${mockTestId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    assert.equal(sBStartRes.status, 403, 'Starting attempt on unauthorized batch mock must return 403');
  });

  test('Step 8-10: Student A starts 45-minute Exam attempt and validates timer', async () => {
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${mockTestId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    const startBody = await startRes.json();
    assert.ok([200, 201].includes(startRes.status), `Failed to start attempt: ${JSON.stringify(startBody)}`);
    studentAAttemptId = startBody.data.attempt?.id || startBody.data.id;
    assert.ok(studentAAttemptId);

    // Verify duration and timer calculation
    const startedAt = new Date(startBody.data.attempt.started_at).getTime();
    const expiresAt = new Date(startBody.data.attempt.expires_at).getTime();
    const diffMinutes = Math.round((expiresAt - startedAt) / (60 * 1000));
    assert.equal(diffMinutes, 45, 'Attempt expiration must match the configured 45 minutes');
  });

  test('Step 11-13: Student A submits mixed answers (MCQ auto-evaluation & Long Answer / Coding pending review)', async () => {
    // 1. Save MCQ answer (correct choice: 2 -> 'HTTPS')
    await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`
      },
      body: JSON.stringify({
        question_id: mcqQuestionId,
        selected_option_index: 2
      })
    });

    // 2. Save Long Answer response
    await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`
      },
      body: JSON.stringify({
        question_id: laQuestionId,
        text_response: 'TCP provides reliable connection-oriented delivery with flow control, while UDP is connectionless and used for streaming.'
      })
    });

    // 3. Save Coding answer
    await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`
      },
      body: JSON.stringify({
        question_id: codingQuestionId,
        code: 'function sum(a, b) { return a + b; }'
      })
    });

    // Submit attempt
    const submitRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`
      },
      body: JSON.stringify({ submission_status: 'NORMAL' })
    });

    const submitBody = await submitRes.json();
    assert.equal(submitRes.status, 200, `Submission failed: ${JSON.stringify(submitBody)}`);
    const att = submitBody.data;

    // Student receives confirmation that attempt is submitted and manual evaluation is pending
    assert.equal(att.result_status, 'PENDING_EVALUATION');
    assert.equal(att.status, 'submitted');
    assert.equal(att.results_released, false);
    assert.equal(att.total_score, null, 'Score must be withheld from student until teacher release');
  });

  test('Step 14: Privacy check - Unreleased result hides details from Student A and blocks Student B', async () => {
    // Student A requests unreleased result -> HTTP 403 RESULT_NOT_RELEASED
    const sAResult = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    const sABody = await sAResult.json();
    assert.equal(sAResult.status, 403);
    assert.equal(sABody.error?.code, 'RESULT_NOT_RELEASED');
    assert.equal(sABody.data, undefined, 'Score and evaluation details must be completely withheld');

    // Unreleased test must not appear in Student A's My Results
    const myResultsRes = await fetch(`${baseUrl}/api/mock-tests/my-results`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    const myResultsBody = await myResultsRes.json();
    assert.equal(myResultsRes.status, 200);
    const inReleasedResults = (myResultsBody.data.results || []).some(r => r.attempt_id === studentAAttemptId);
    assert.equal(inReleasedResults, false, 'Unreleased results must not appear in My Results list');

    // Student B attempts direct access to Student A result -> 403 Forbidden
    const sBResult = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    assert.equal(sBResult.status, 403, 'Student B must not access Student A result');
  });

  test('Step 15-17: Teacher Evaluation Dashboard & Bounds Validation', async () => {
    // Teacher views test analytics
    const anRes = await fetch(`${baseUrl}/api/mock-tests/${mockTestId}/analytics`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const anBody = await anRes.json();
    assert.equal(anRes.status, 200);

    const candidates = anBody.data.candidates || [];
    const cand = candidates.find(c => c.student_email === studentAUser.email);
    assert.ok(cand, 'Teacher must see Student A in candidate roster');
    assert.equal(cand.objective_score, 2);
    assert.equal(cand.manual_status, 'Pending');
    assert.equal(cand.result_status, 'PENDING_EVALUATION');

    // Attempting to release before manual evaluation completes must fail with 400
    const earlyReleaseRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.equal(earlyReleaseRes.status, 400, 'Releasing un-evaluated attempt must return 400');

    // Score validation: Negative score must fail
    const negScoreRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/questions/${laQuestionId}/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ score: -2, comment: 'Negative score test' })
    });
    assert.equal(negScoreRes.status, 400, 'Negative score must be rejected');

    // Score validation: Score exceeding max marks (5) must fail
    const overScoreRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/questions/${laQuestionId}/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ score: 12, comment: 'Over score test' })
    });
    assert.equal(overScoreRes.status, 400, 'Score exceeding max marks must be rejected');

    // Valid evaluation for Long Answer: 4 / 5 marks
    const validLaRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/questions/${laQuestionId}/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ score: 4, comment: 'Clear explanation of TCP and UDP differences.' })
    });
    assert.equal(validLaRes.status, 200);

    // Valid evaluation for Coding: 9 / 10 marks
    const validCodingRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/questions/${codingQuestionId}/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ score: 9, comment: 'Clean solution, passes test cases.' })
    });
    assert.equal(validCodingRes.status, 200);

    // After evaluating all questions, check attempt totals: 2 (MCQ) + 4 (LA) + 9 (Coding) = 15 / 17
    const anRes2 = await fetch(`${baseUrl}/api/mock-tests/${mockTestId}/analytics`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const anBody2 = await anRes2.json();
    const cand2 = (anBody2.data.candidates || []).find(c => c.student_email === studentAUser.email);
    assert.equal(cand2.score, 15);
    assert.equal(cand2.manual_status, 'Evaluated');
    assert.equal(cand2.result_status, 'EVALUATED');
  });

  test('Step 18-20: Individual Result Release & Student Result Verification', async () => {
    // Teacher releases Student A result individually
    const releaseRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const releaseBody = await releaseRes.json();
    assert.equal(releaseRes.status, 200);
    assert.equal(releaseBody.data.attempt.result_status, 'RELEASED');

    // Student A requests released result -> now sees full score, breakdown, and feedback
    const sAResult = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    const sABody = await sAResult.json();
    assert.equal(sAResult.status, 200);
    assert.equal(sABody.data.results_released, true);
    assert.equal(sABody.data.result_status, 'RELEASED');
    assert.equal(parseFloat(sABody.data.total_score), 15);
    assert.equal(parseFloat(sABody.data.max_score), 17);
    assert.equal(sABody.data.percentage, 88.24);

    // Student A's My Results now displays this test
    const myResults = await fetch(`${baseUrl}/api/mock-tests/my-results`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    const myResultsBody = await myResults.json();
    assert.equal(myResults.status, 200);
    const inReleased = (myResultsBody.data.results || []).some(r => r.attempt_id === studentAAttemptId);
    assert.equal(inReleased, true, 'Released test must now appear in Student A My Results');

    // Student B is still 403 Forbidden from accessing Student A's released result
    const sBResult = await fetch(`${baseUrl}/api/mock-tests/attempts/${studentAAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    assert.equal(sBResult.status, 403, 'Student B cannot access Student A result even after release');
  });

  test('Step 21-24: Teacher PDF Report Generation & Security', async () => {
    // Student A attempts to access teacher PDF report -> 403 Forbidden
    const sAPdf = await fetch(`${baseUrl}/api/reports/tests/${mockTestId}/results/pdf`, {
      headers: { Authorization: `Bearer ${studentAToken}` }
    });
    assert.equal(sAPdf.status, 403, 'Student A must not access Teacher PDF report');

    // Student B attempts to access teacher PDF report -> 403 Forbidden
    const sBPdf = await fetch(`${baseUrl}/api/reports/tests/${mockTestId}/results/pdf`, {
      headers: { Authorization: `Bearer ${studentBToken}` }
    });
    assert.equal(sBPdf.status, 403, 'Student B must not access Teacher PDF report');

    // Teacher generates PDF report -> 200 OK with application/pdf
    const teacherPdf = await fetch(`${baseUrl}/api/reports/tests/${mockTestId}/results/pdf`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.equal(teacherPdf.status, 200, 'Teacher must be able to generate results PDF');
    assert.ok(teacherPdf.headers.get('content-type').includes('application/pdf'));

    const pdfBuffer = Buffer.from(await teacherPdf.arrayBuffer());
    assert.ok(pdfBuffer.length > 500, 'PDF buffer must contain content');
    // PDF magic bytes check
    const magic = pdfBuffer.slice(0, 4).toString('utf-8');
    assert.equal(magic, '%PDF', 'PDF buffer must start with %PDF magic header');
  });
});
