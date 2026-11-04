import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { config } from '../src/config/env.js';

import { userRepository } from '../src/repositories/userRepository.js';

let server;
let baseUrl;
let studentToken;
let student2Token;
let teacherToken;
let adminToken;
let testId;
let attemptId;
let questionIds = [];

describe('Mock Test Question Visibility & Redaction Regression Suite', () => {
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

    // Login Primary Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const sBody = await studentRes.json();
    studentToken = sBody.data.token;

    const s2User = await userRepository.create({
      fullName: 'Student Two',
      email: `student2.${Date.now()}@linktest.io`,
      passwordHash: 'dummy',
      role: 'STUDENT',
      emailVerified: true,
      status: 'active'
    });

    student2Token = jwt.sign(
      { id: s2User.id, role: 'STUDENT', email: s2User.email },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    // Login Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const tBody = await teacherRes.json();
    teacherToken = tBody.data.token;

    // Login Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const aBody = await adminRes.json();
    adminToken = aBody.data.token;

    // Create a published test with randomized questions & randomized options
    const createTestRes = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: 'Question Visibility & Proctoring Test',
        subject: 'Computer Science',
        duration_minutes: 45,
        randomize_questions: true,
        randomize_options: true,
        proctoring_config: {
          fullscreen_required: false,
          webcam_required: true,
          face_detection: true,
          tab_switch_warning: true
        },
        questions: [
          {
            question_text: 'Which data structure follows FIFO order?',
            question_type: 'mcq_single',
            marks: 5,
            negative_marks: 1,
            options: [
              { id: 'opt_a', key: 'A', text: 'Queue' },
              { id: 'opt_b', key: 'B', text: 'Stack' },
              { id: 'opt_c', key: 'C', text: 'Tree' },
              { id: 'opt_d', key: 'D', text: 'Graph' }
            ],
            correct_answer: { selected: 'opt_a' },
            explanation: 'Queue follows First In First Out.'
          },
          {
            question_text: 'Select all linear data structures:',
            question_type: 'mcq_multiple',
            marks: 5,
            negative_marks: 1,
            options: [
              { id: 'lin_a', key: 'A', text: 'Array' },
              { id: 'lin_b', key: 'B', text: 'Linked List' },
              { id: 'lin_c', key: 'C', text: 'Queue' },
              { id: 'lin_d', key: 'D', text: 'Graph' }
            ],
            correct_answer: { selected: ['lin_a', 'lin_b', 'lin_c'] },
            explanation: 'Graph is a non-linear data structure.'
          },
          {
            question_text: 'Binary Search has O(log n) average time complexity.',
            question_type: 'true_false',
            marks: 5,
            negative_marks: 1,
            correct_answer: { boolean: true },
            explanation: 'Binary search halves the search space each iteration.'
          }
        ]
      })
    });

    assert.strictEqual(createTestRes.status, 201);
    const createBody = await createTestRes.json();
    testId = createBody.data.test.id;

    // Publish the test
    const pubRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ status: 'published' })
    });
    assert.strictEqual(pubRes.status, 200);

    // Student submits join request and Teacher approves
    const joinRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/join-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    const joinBody = await joinRes.json();
    const requestId = joinBody.data.id;

    await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${requestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      }
    });

    // Student starts an attempt
    const attemptRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    assert.ok([200, 201].includes(attemptRes.status));
    const attBody = await attemptRes.json();
    attemptId = attBody.data?.attempt?.id || attBody.data?.id;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Test 1: Published mock test with questions -> student receives questions', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.questions));
    assert.strictEqual(body.data.questions.length, 3);
    questionIds = body.data.questions.map(q => q.id);
  });

  test('Test 2: Student response contains question text', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const body = await res.json();
    const questions = body.data.questions;
    for (const q of questions) {
      assert.ok(typeof q.question_text === 'string' && q.question_text.trim().length > 0);
    }
  });

  test('Test 3: Student response contains MCQ options', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const body = await res.json();
    const mcqQuestions = body.data.questions.filter(q => ['mcq_single', 'mcq_multiple'].includes(q.question_type));
    assert.ok(mcqQuestions.length >= 2);
    for (const q of mcqQuestions) {
      assert.ok(Array.isArray(q.options));
      assert.strictEqual(q.options.length, 4);
      for (const opt of q.options) {
        assert.ok(opt.text || (typeof opt === 'string' && opt.length > 0));
      }
    }
  });

  test('Test 4: Student response does NOT contain correct answers or answer keys', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const body = await res.json();
    for (const q of body.data.questions) {
      assert.strictEqual(q.answer_key, undefined, 'answer_key must NOT be sent to student');
      assert.strictEqual(q.correct_answer, undefined, 'correct_answer must NOT be sent to student');
      assert.strictEqual(q.correct_answers, undefined, 'correct_answers must NOT be sent to student');
      assert.strictEqual(q.correct_option_index, undefined, 'correct_option_index must NOT be sent to student');
      assert.strictEqual(q.explanation, undefined, 'explanation must NOT be sent to student');
      assert.strictEqual(q.expected_answer, undefined, 'expected_answer must NOT be sent to student');
      assert.strictEqual(q.evaluation_criteria, undefined, 'evaluation_criteria must NOT be sent to student');
    }
  });

  test('Test 5: Unauthorized student cannot access another student attempt', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${student2Token}` }
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  test('Test 6: Teacher/admin can access appropriate question data including answer keys', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${testId}`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.test.questions.length > 0);
    const firstQ = body.data.test.questions[0];
    assert.ok(firstQ.answer_key !== undefined || firstQ.correct_answer !== undefined);
  });

  test('Test 7: Result unreleased -> result data hidden', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/result`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    // Active / unreleased attempt result endpoint must refuse to expose final scorecard
    assert.ok([403, 400].includes(res.status));
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.error?.code === 'RESULT_NOT_RELEASED' || body.error?.code === 'ATTEMPT_NOT_SUBMITTED');
  });

  test('Test 8: Questions remain visible when result is unreleased', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data.questions));
    assert.strictEqual(body.data.questions.length, 3);
  });

  test('Test 9: Answer submission works', async () => {
    const q1 = questionIds[0];
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        question_id: q1,
        response_data: { selected_index: 0, text: 'Queue' },
        is_visited: true,
        is_marked_for_review: false
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
  });

  test('Test 10: Question navigation works and response persists', async () => {
    // Save answer on Q2
    const q2 = questionIds[1];
    await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        question_id: q2,
        response_data: { selected_indices: [0, 1] },
        is_visited: true,
        is_marked_for_review: true
      })
    });

    // Reload attempt and verify responses are returned
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.responses[q2]);
    assert.strictEqual(body.data.responses[q2].is_marked_for_review, true);
    assert.deepStrictEqual(body.data.responses[q2].response_data.selected_indices, [0, 1]);
  });

  test('Test 11: Randomized questions still appear', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.questions.length, 3);
    const texts = body.data.questions.map(q => q.question_text);
    assert.ok(texts.includes('Which data structure follows FIFO order?'));
    assert.ok(texts.includes('Select all linear data structures:'));
  });

  test('Test 12: Randomized options still appear and have valid structure', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const body = await res.json();
    const q1 = body.data.questions.find(q => q.question_type === 'mcq_single');
    assert.ok(q1);
    assert.strictEqual(q1.options.length, 4);
    const texts = q1.options.map(o => o.text);
    assert.ok(texts.includes('Queue'));
    assert.ok(texts.includes('Stack'));
  });

  test('Test 13: Proctoring events continue working while questions are displayed', async () => {
    const eventRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        event_type: 'FACE_NOT_DETECTED',
        severity: 'WARNING',
        metadata: { face_count: 0 }
      })
    });
    assert.strictEqual(eventRes.status, 200);
    const eventBody = await eventRes.json();
    assert.strictEqual(eventBody.success, true);
    assert.ok(eventBody.data.security_warning_count >= 1 || eventBody.data.warning_count >= 1);

    // Questions are still accessible after proctoring event
    const attemptRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(attemptRes.status, 200);
    const attBody = await attemptRes.json();
    assert.strictEqual(attBody.data.questions.length, 3);
  });
});
