import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { memoryStore } from '../src/db/index.js';

let server;
let baseUrl;
let studentToken;
let studentId;
let teacherToken;
let teacherId;
let adminToken;

describe('Production Audit Bug Fixes Regression Suite', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Authenticate Teacher
    const tLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const tData = await tLogin.json();
    teacherToken = tData.data.token;
    teacherId = tData.data.user.id;

    // Authenticate Student
    const sLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const sData = await sLogin.json();
    studentToken = sData.data.token;
    studentId = sData.data.user.id;

    // Authenticate Admin
    const aLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const aData = await aLogin.json();
    adminToken = aData.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Student Search: Support query, q, and search parameter names
  // ---------------------------------------------------------------------------
  test('Student Search API accepts query parameter sent by frontend and returns matching students', async () => {
    const res = await fetch(`${baseUrl}/api/students/search?query=student`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.students));
    assert.ok(body.data.students.length > 0, 'Should find at least one student matching "student"');
    const match = body.data.students.find(s => s.email === 'student@linktest.io');
    assert.ok(match, 'student@linktest.io should be in the search results');
  });

  test('Student Search API ranks exact email match first', async () => {
    const res = await fetch(`${baseUrl}/api/students/search?query=student@linktest.io`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.students.length > 0);
    assert.equal(body.data.students[0].email, 'student@linktest.io', 'Exact match should appear as first result');
  });

  // ---------------------------------------------------------------------------
  // 2. Mock Test Result Privacy: getMyAttempts redacts unreleased score & answers
  // ---------------------------------------------------------------------------
  test('getMyAttempts redacts total_score, score, percentage, and passed for unreleased attempts', async () => {
    // 1. Create a test with manual release
    const createRes = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Unreleased Leakage Verification Test',
        subject: 'Computer Science',
        batch_id: 'batch-cs-a1',
        category: 'mock_exam',
        duration_minutes: 30,
        total_marks: 20,
        pass_percentage: 50,
        status: 'published',
        result_release_mode: 'manual',
        questions: [
          {
            question_text: 'What is the time complexity of binary search?',
            question_type: 'mcq_single',
            marks: 10,
            negative_marks: 0,
            options: ['O(n)', 'O(log n)', 'O(1)', 'O(n^2)'],
            answer_key: { correct_index: 1 }
          }
        ]
      })
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    const testId = createData.data.test?.id || createData.data.id;

    // 2. Start attempt as student
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    assert.ok([200, 201].includes(startRes.status), `Expected 200 or 201 but got ${startRes.status}`);
    const startData = await startRes.json();
    const attemptId = startData.data.attempt_id || startData.data.id;

    // 3. Submit attempt as student
    const submitRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ auto_submitted: false })
    });
    assert.equal(submitRes.status, 200);

    // 4. Query student's attempts list via /api/mock-tests/my-attempts
    const myAttemptsRes = await fetch(`${baseUrl}/api/mock-tests/my-attempts?test_id=${testId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(myAttemptsRes.status, 200);
    const myAttemptsData = await myAttemptsRes.json();
    const targetAttempt = myAttemptsData.data.attempts.find(a => a.id === attemptId);
    assert.ok(targetAttempt, 'Attempt should be in student attempts list');

    // 5. Verify zero leakage of unreleased score data
    assert.equal(targetAttempt.result_status !== 'RELEASED', true);
    assert.equal(targetAttempt.results_released, false);
    assert.equal(targetAttempt.total_score, null, 'total_score must be null for unreleased attempt');
    assert.equal(targetAttempt.percentage, null, 'percentage must be null for unreleased attempt');
    assert.equal(targetAttempt.passed, null, 'passed must be null for unreleased attempt');
    assert.deepEqual(targetAttempt.responses, [], 'responses must be redacted for unreleased attempt');
  });

  // ---------------------------------------------------------------------------
  // 3. Single Assignment Submission: Rejects resubmissions with HTTP 409
  // ---------------------------------------------------------------------------
  test('Submitting an assignment a second time is rejected with HTTP 409 ALREADY_SUBMITTED', async () => {
    // 1. Create an assignment
    const assignRes = await fetch(`${baseUrl}/api/teacher/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Single Submission Verification Assignment',
        instructions: 'Verify resubmission prevention policy.',
        subject_id: 'sub-cs-01',
        class_id: 'class-001',
        due_date: new Date(Date.now() + 86400000).toISOString(),
        max_marks: 25
      })
    });
    assert.equal(assignRes.status, 201);
    const assignData = await assignRes.json();
    const assignmentId = assignData.data.id;

    // 2. First submission by student -> Success 200
    const firstSub = await fetch(`${baseUrl}/api/student/assignments/${assignmentId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        content: 'Initial assignment submission response'
      })
    });
    assert.equal(firstSub.status, 200);
    const firstBody = await firstSub.json();
    assert.equal(firstBody.success, true);

    // 3. Second submission attempt by the same student -> HTTP 409 Conflict
    const secondSub = await fetch(`${baseUrl}/api/student/assignments/${assignmentId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        content: 'Attempted duplicate overwrite submission'
      })
    });
    assert.equal(secondSub.status, 409);
    const secondBody = await secondSub.json();
    assert.equal(secondBody.success, false);
    assert.equal(secondBody.error?.code, 'ALREADY_SUBMITTED');
  });

  // ---------------------------------------------------------------------------
  // 4. LiveKit Token Permissions for Students
  // ---------------------------------------------------------------------------
  test('LiveKit token request for live lecture grants publishing rights to student', async () => {
    // 1. Create a live lecture as teacher
    const sessionRes = await fetch(`${baseUrl}/api/teacher/live-classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Interactive WebRTC Lecture',
        class_id: 'class-001',
        scheduled_at: new Date().toISOString(),
        duration_minutes: 45
      })
    });
    const sessionData = await sessionRes.json();
    const sessionId = sessionData.data.id;

    // 2. Request token as student
    const tokenRes = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        sessionId,
        isPublisher: true
      })
    });

    if (tokenRes.status === 200) {
      const tokenBody = await tokenRes.json();
      assert.ok(tokenBody.data.token);
      const payloadPart = tokenBody.data.token.split('.')[1];
      const decoded = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8'));
      assert.equal(decoded.video?.canPublish, true, 'Student must have canPublish: true for microphone & camera');
    } else {
      assert.equal(tokenRes.status, 503);
      const fallbackBody = await tokenRes.json();
      assert.equal(fallbackBody.error?.code, 'LIVEKIT_NOT_CONFIGURED');
    }
  });
});
