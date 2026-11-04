import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { memoryStore } from '../src/db/index.js';

let server;
let baseUrl;
let studentToken;
let teacherToken;
let adminToken;
let createdTestId;
let createdAttemptId;
let q2Id;

describe('Mock Test Result Release & Unreleased Privacy Test Suite', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Authenticate Teacher
    const tLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const tData = await tLogin.json();
    teacherToken = tData.data.token;

    // 2. Authenticate Student
    const sLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const sData = await sLogin.json();
    studentToken = sData.data.token;

    // 3. Authenticate Admin
    const aLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const aData = await aLogin.json();
    adminToken = aData.data.token;

    // 4. Create a Mock Test with manual release (assigned to batch-001)
    const createRes = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Release Privacy Verification Exam',
        subject: 'Computer Science',
        batch_id: 'batch-cs-a1',
        category: 'mock_exam',
        duration_minutes: 30,
        total_marks: 20,
        pass_percentage: 50,
        status: 'published',
        results_published: false,
        questions: [
          {
            question_text: 'What is the complexity of binary search?',
            question_type: 'mcq_single',
            marks: 10,
            negative_marks: 0,
            options: ['O(n)', 'O(log n)', 'O(1)', 'O(n^2)'],
            answer_key: { correct_index: 1 },
            explanation: 'Binary search divides the search space in half each iteration.'
          },
          {
            question_text: 'Explain QuickSort partitioning principle.',
            question_type: 'long_answer',
            marks: 10,
            negative_marks: 0,
            expected_answer: 'Pick pivot and place smaller elements left and greater right.',
            evaluation_criteria: 'Pivot selection, partition algorithm, complexity'
          }
        ]
      })
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    createdTestId = createData.data.test?.id || createData.data.id;
    assert.ok(createdTestId, 'Mock test ID must exist');

    // Ensure student is in batch-001
    const student = memoryStore.users.find(u => u.email === 'student@linktest.io');
    if (!memoryStore.batch_enrollments.some(e => e.batch_id === 'batch-001' && e.student_id === student.id)) {
      memoryStore.batch_enrollments.push({
        id: `be-${Date.now()}`,
        batch_id: 'batch-cs-a1',
        student_id: student.id,
        enrolled_at: new Date().toISOString()
      });
    }

    // 5. Student starts the test
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    const startData = await startRes.json();
    assert.ok([200, 201].includes(startRes.status), `Failed to start: ${JSON.stringify(startData)}`);
    createdAttemptId = startData.data.attempt?.id || startData.data.id;

    // 6. Student answers Question 1 (MCQ) and Question 2 (Subjective)
    const q1 = startData.data.questions[0];
    q2Id = startData.data.questions[1].id;
    await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        question_id: q1.id,
        selected_option_index: 1
      })
    });

    await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        question_id: q2Id,
        response_data: { text: 'QuickSort selects a pivot element and partitions array into smaller and larger elements.' }
      })
    });

    // 7. Student submits the test
    const submitRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ submission_status: 'NORMAL' })
    });
    assert.equal(submitRes.status, 200);
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('1. Unreleased attempt: Student GET /result returns 403 RESULT_NOT_RELEASED', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    assert.equal(res.status, 403, 'Must return HTTP 403 when result is unreleased');
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error?.code, 'RESULT_NOT_RELEASED');
    assert.equal(body.error?.message, 'Result has not been released yet.');
  });

  test('2. Unreleased attempt: Response contains ZERO sensitive score, marks, percentage, or answer data', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    const body = await res.json();
    assert.equal(body.data, undefined, 'No data payload must be returned');
    assert.equal(body.score, undefined, 'No score property must be present in response');
    assert.equal(body.total_score, undefined, 'No total_score property must be present');
    assert.equal(body.percentage, undefined, 'No percentage property must be present');
    assert.equal(body.passed, undefined, 'No passed status must be present');
    assert.equal(body.questions, undefined, 'No question review or correct answers must be present');
  });

  test('3. Unreleased attempt: Faculty/Teacher CAN view attempt for grading and evaluation', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });

    assert.equal(res.status, 200, 'Teacher must be able to inspect attempt for grading');
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data);
    assert.equal(body.data.attempt_id, createdAttemptId);
  });

  test('4. Unreleased attempt: Cannot be released before subjective questions are evaluated', async () => {
    const releaseRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });

    assert.equal(releaseRes.status, 400, 'Releasing un-evaluated attempt must fail');
    const body = await releaseRes.json();
    assert.match(body.error?.message || '', /manual evaluation.*must be completed/i);
  });

  test('5. Teacher grades subjective question and releases result', async () => {
    // Grade Q2
    const evalRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/questions/${q2Id}/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ score: 8, comment: 'Good explanation of partition step.' })
    });
    assert.equal(evalRes.status, 200);

    // Release Result
    const releaseRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.equal(releaseRes.status, 200);
    const releaseBody = await releaseRes.json();
    assert.equal(releaseBody.success, true);
  });

  test('6. Released attempt: Student GET /result now returns HTTP 200 with full scorecard', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    assert.equal(res.status, 200, 'Student must receive 200 after release');
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.result_status, 'RELEASED');
    assert.equal(body.data.results_released, true);
    // Score should be 10 (Q1) + 8 (Q2) = 18
    assert.equal(body.data.total_score, 18);
    assert.equal(body.data.percentage, 90);
    assert.equal(body.data.passed, true);
    assert.ok(Array.isArray(body.data.questions));
    assert.equal(body.data.questions.length, 2);

    // Explanations are now visible
    const q1Review = body.data.questions[0];
    assert.ok(q1Review.explanation);
    assert.ok(q1Review.answer_key);
  });

  test('7. Admin has authorization to view results according to institutional permissions', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.attempt_id, createdAttemptId);
  });
});
