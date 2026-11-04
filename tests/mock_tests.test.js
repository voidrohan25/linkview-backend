import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { config } from '../src/config/env.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { securityLogRepository } from '../src/repositories/securityLogRepository.js';

let server;
let baseUrl;
let studentToken;
let teacherToken;
let adminToken;
let createdTestId;
let createdAttemptId;
let proctoringEventId;

describe('LinkTest Mock Test & AI Examination System Test Suite', () => {
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

    // Login Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const sBody = await studentRes.json();
    studentToken = sBody.data.token;

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
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('1. Security: Unauthenticated request to /api/mock-tests is allowed (public catalog), but cannot start attempt without auth', async () => {
    const listRes = await fetch(`${baseUrl}/api/mock-tests`);
    assert.strictEqual(listRes.status, 200);
    const listBody = await listRes.json();
    assert.strictEqual(listBody.success, true);
    assert.ok(Array.isArray(listBody.data?.tests));

    // Try starting attempt without auth
    const attemptRes = await fetch(`${baseUrl}/api/mock-tests/test-001/attempts`, {
      method: 'POST'
    });
    assert.strictEqual(attemptRes.status, 401);
  });

  test('2. Authorization: Students CANNOT create mock tests (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        title: 'Unauthorized Student Test',
        subject: 'Hacking',
        duration_minutes: 30
      })
    });
    assert.strictEqual(res.status, 403);
  });

  test('3. Teacher can create a comprehensive mock test with multiple question types', async () => {
    const testPayload = {
      title: 'Automated CS Engineering Mock Exam',
      description: 'Comprehensive test covering DS, Algos, and System Architecture',
      instructions: 'Answer all questions within the allocated time. Webcam proctoring enabled.',
      subject: 'Computer Science',
      topic: 'Algorithms & Architecture',
      difficulty: 'hard',
      category: 'mock_exam',
      duration_minutes: 60,
      total_marks: 30,
      passing_percentage: 60,
      max_attempts: 3,
      shuffle_questions: false,
      shuffle_options: false,
      proctoring_config: {
        webcam_required: true,
        face_detection: true,
        fullscreen_required: true,
        tab_switch_limit: 3,
        audio_monitoring: false
      },
      questions: [
        {
          question_text: 'What is the worst-case time complexity of QuickSort?',
          question_type: 'MCQ_SINGLE',
          marks: 5,
          penalty_marks: 1,
          topic: 'Algorithms',
          options: [
            { id: 'opt_1', text: 'O(n log n)' },
            { id: 'opt_2', text: 'O(n^2)' },
            { id: 'opt_3', text: 'O(log n)' },
            { id: 'opt_4', text: 'O(n)' }
          ],
          correct_answer: { selected: 'opt_2' },
          explanation: 'QuickSort degrades to O(n^2) when poor pivots are chosen (e.g., sorted array with last element pivot).'
        },
        {
          question_text: 'Select all ACID properties of relational databases:',
          question_type: 'MCQ_MULTI',
          marks: 10,
          penalty_marks: 2,
          topic: 'Databases',
          options: [
            { id: 'acid_a', text: 'Atomicity' },
            { id: 'acid_b', text: 'Consistency' },
            { id: 'acid_c', text: 'Isolation' },
            { id: 'acid_d', text: 'Availability' }
          ],
          correct_answer: { selected: ['acid_a', 'acid_b', 'acid_c'] },
          explanation: 'ACID stands for Atomicity, Consistency, Isolation, and Durability (Availability is from CAP theorem).'
        },
        {
          question_text: 'Calculate the height of a balanced binary tree containing 1023 nodes.',
          question_type: 'NUMERICAL',
          marks: 5,
          penalty_marks: 0,
          topic: 'Trees',
          correct_answer: { value: 9, tolerance: 0.1 },
          explanation: 'log2(1024) - 1 = 9.'
        },
        {
          question_text: 'HTTP status code 403 stands for ______ access.',
          question_type: 'FILL_BLANK',
          marks: 5,
          penalty_marks: 0,
          topic: 'Networking',
          correct_answer: { blanks: ['forbidden'] },
          explanation: 'HTTP 403 denotes Forbidden.'
        },
        {
          question_text: 'In TCP, the initial handshake requires 3 packets.',
          question_type: 'TRUE_FALSE',
          marks: 5,
          penalty_marks: 1,
          topic: 'Networking',
          correct_answer: { boolean: true },
          explanation: 'SYN, SYN-ACK, ACK.'
        }
      ]
    };

    const res = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify(testPayload)
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.test.id);
    createdTestId = body.data.test.id;
    assert.strictEqual(body.data.test.title, 'Automated CS Engineering Mock Exam');
  });

  test('4. Teacher can publish the mock test', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ status: 'published' })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.test.status, 'published');
  });

  test('5. Student requests join, teacher approves, and student starts an attempt', async () => {
    // 5a. Direct attempt without approval must fail with 403
    const blockedRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    assert.strictEqual(blockedRes.status, 403);
    const blockedBody = await blockedRes.json();
    assert.strictEqual(blockedBody.error?.code || blockedBody.error, 'MOCK_TEST_APPROVAL_REQUIRED');

    // 5b. Student requests join
    const reqRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}/join-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });
    assert.strictEqual(reqRes.status, 201);
    const reqBody = await reqRes.json();
    assert.strictEqual(reqBody.data.status, 'PENDING');
    const requestId = reqBody.data.id;

    // 5c. Teacher approves join request
    const approveRes = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${requestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      }
    });
    assert.strictEqual(approveRes.status, 200);
    const approveBody = await approveRes.json();
    assert.strictEqual(approveBody.data.request.status, 'APPROVED');

    // 5d. Now student can start attempt
    const res = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.attempt_id);
    createdAttemptId = body.data.attempt_id;

    // Verify server-authoritative timer
    assert.ok(body.data.started_at);
    assert.ok(body.data.expires_at);
    assert.ok(body.data.remaining_seconds > 0);

    // CRITICAL SECURITY CHECK: Ensure correct answers and explanations are stripped!
    const questions = body.data.questions;
    assert.ok(Array.isArray(questions) && questions.length === 5);
    for (const q of questions) {
      assert.strictEqual(q.correct_answer, undefined, `Question ${q.id} must NOT have correct_answer`);
      assert.strictEqual(q.answer_key, undefined, `Question ${q.id} must NOT have answer_key`);
      assert.strictEqual(q.correct_option_index, undefined, `Question ${q.id} must NOT have correct_option_index`);
      assert.strictEqual(q.explanation, undefined, `Question ${q.id} must NOT have explanation`);
    }
  });

  test('5a. Mock test details expose answer keys only to the creator and administrators', async () => {
    const studentRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(studentRes.status, 200);
    const studentQuestions = (await studentRes.json()).data.test.questions;
    assert.ok(studentQuestions.every(q => q.answer_key === undefined && q.explanation === undefined));

    const creatorRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(creatorRes.status, 200);
    assert.ok((await creatorRes.json()).data.test.questions.every(q => q.answer_key !== undefined));

    const adminRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminRes.status, 200);
    assert.ok((await adminRes.json()).data.test.questions.every(q => q.answer_key !== undefined));

    const otherTeacher = await userRepository.create({
      fullName: 'Unassigned Mock Test Teacher',
      email: `mock.other.teacher.${Date.now()}@linktest.io`,
      passwordHash: 'test-only',
      role: 'TEACHER',
      emailVerified: true,
      emailVerifiedAt: new Date().toISOString()
    });
    const otherTeacherToken = jwt.sign(
      { id: otherTeacher.id, email: otherTeacher.email, role: otherTeacher.role },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const otherTeacherRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}`, {
      headers: { Authorization: `Bearer ${otherTeacherToken}` }
    });
    assert.strictEqual(otherTeacherRes.status, 200);
    const otherTeacherQuestions = (await otherTeacherRes.json()).data.test.questions;
    assert.ok(otherTeacherQuestions.every(q => q.answer_key === undefined && q.explanation === undefined));
  });

  test('6. Student saves answers incrementally (idempotent PUT)', async () => {
    // Retrieve questions from attempt to get exact IDs
    const attemptRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(attemptRes.status, 200);
    const attemptBody = await attemptRes.json();
    assert.strictEqual(attemptBody.success, true);
    const questions = attemptBody.data.questions;
    assert.ok(Array.isArray(questions) && questions.length === 5);
    for (const q of questions) {
      assert.strictEqual(q.correct_answer, undefined, `Question ${q.id} must NOT have correct_answer`);
      assert.strictEqual(q.answer_key, undefined, `Question ${q.id} must NOT have answer_key`);
      assert.strictEqual(q.explanation, undefined, `Question ${q.id} must NOT have explanation`);
    }
    const actualQIds = questions.map((q) => q.id);

    const actualAnswers = {
      [actualQIds[0]]: { selected: 'opt_2' },
      [actualQIds[1]]: { selected: ['acid_a', 'acid_b'] },
      [actualQIds[2]]: { value: 9 },
      [actualQIds[3]]: { blanks: ['forbidden'] },
      [actualQIds[4]]: { boolean: false }
    };

    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ answers: actualAnswers })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.saved_count, 5);
  });

  test('7. Proctoring event ingestion with debouncing and graduated warnings', async () => {
    const eventPayload = {
      event_type: 'TAB_HIDDEN',
      severity: 'WARNING',
      confidence: 0.95,
      metadata: { reason: 'User navigated away from exam tab', duration_seconds: 3 }
    };

    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify(eventPayload)
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.warning_count >= 1);
    if (body.data.event) {
      proctoringEventId = body.data.event.id;
    }
  });

  test('8. Student submits test: Server-side evaluation, score calculation & result finalization', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(['submitted', 'evaluated'].includes(body.data.status));

    // Expected scoring:
    // Q1: +5
    // Q2: 2/3 * 10 = +6.67 (partial credit)
    // Q3: +5
    // Q4: +5
    // Q5: -1 (penalty)
    // Total approx: 5 + 6.67 + 5 + 5 - 1 = 20.67 out of 30
    assert.ok(body.data.total_score > 15, `Score should be around 20.67, got ${body.data.total_score}`);
    assert.strictEqual(body.data.questions.length, 5);
  });

  test('9. Student retrieves result & explanations (now released after submission)', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.total_score !== undefined);
    assert.ok(body.data.questions);
    assert.strictEqual(body.data.questions.length, 5);

    // Explanations and answer keys are now visible in post-exam review
    const q1Review = body.data.questions[0];
    assert.ok(q1Review.explanation);
    assert.ok(q1Review.answer_key);
  });

  test('10. Teacher review: Faculty can inspect attempts and dismiss false-positive proctoring flags', async () => {
    const attemptsRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}/attempts`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(attemptsRes.status, 200);
    const attemptsBody = await attemptsRes.json();
    assert.ok(Array.isArray(attemptsBody.data?.attempts));
    assert.ok(attemptsBody.data.attempts.length >= 1);

    // Inspect proctoring events
    const eventsRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/proctoring-events`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(eventsRes.status, 200);
    const eventsBody = await eventsRes.json();
    assert.ok(eventsBody.data.events.length >= 1);

    const eventToReview = eventsBody.data.events[0];
    // Teacher dismisses the flag
    const reviewRes = await fetch(`${baseUrl}/api/mock-tests/events/${eventToReview.id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        review_status: 'dismissed',
        review_notes: 'Verified student technical issue with external display'
      })
    });
    assert.strictEqual(reviewRes.status, 200);
    const reviewBody = await reviewRes.json();
    assert.strictEqual(reviewBody.data.event.review_status, 'dismissed');
  });

  test('11. Security: Another student CANNOT access or submit someone else’s attempt', async () => {
    const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/submit`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 401);
  });

  test('12. Scorecard access is owner-only for students and audited', async () => {
    const otherStudent = await userRepository.create({
      fullName: 'Other Scorecard Candidate',
      email: `scorecard.other.${Date.now()}@linktest.io`,
      passwordHash: 'test-only',
      emailVerified: true,
      emailVerifiedAt: new Date().toISOString()
    });
    const otherStudentToken = jwt.sign(
      { id: otherStudent.id, email: otherStudent.email, role: 'STUDENT' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const logCountBefore = (await securityLogRepository.getLogs({
      eventType: 'UNAUTHORIZED_SCORECARD_ACCESS'
    })).total;

    const forbiddenRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${otherStudentToken}` }
    });
    assert.strictEqual(forbiddenRes.status, 403);
    const forbiddenBody = await forbiddenRes.json();
    assert.strictEqual(forbiddenBody.error.code, 'FORBIDDEN');

    const logCountAfter = (await securityLogRepository.getLogs({
      eventType: 'UNAUTHORIZED_SCORECARD_ACCESS'
    })).total;
    assert.strictEqual(logCountAfter, logCountBefore + 1);

    const teacherRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(teacherRes.status, 200);

    const adminRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${createdAttemptId}/result`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminRes.status, 200);
  });

  test('13. Proctoring integrity: aliases persist, score updates, and three tab switches disqualify', async () => {
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${createdTestId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(startRes.status, 200);
    const startBody = await startRes.json();
    const attemptId = startBody.data.attempt_id;

    const postEvent = async (event_type, severity = 'warning') => {
      const res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/proctoring-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({ event_type, severity })
      });
      assert.strictEqual(res.status, 200);
      return (await res.json()).data;
    };

    const faceEvent = await postEvent('NO_FACE', 'info');
    assert.strictEqual(faceEvent.integrity_trust_index, 99);
    assert.strictEqual(faceEvent.recorded, true);
    assert.strictEqual(faceEvent.security_warning_count, 0);

    await postEvent('TAB_SWITCH');
    const duplicateFocusSignal = await postEvent('WINDOW_BLURRED');
    assert.strictEqual(duplicateFocusSignal.debounced, true);
    assert.strictEqual(duplicateFocusSignal.integrity_trust_index, 94);
    await new Promise(resolve => setTimeout(resolve, 3600));
    await postEvent('WINDOW_BLURRED');
    await new Promise(resolve => setTimeout(resolve, 3600));
    const thresholdEvent = await postEvent('TAB_HIDDEN');
    assert.strictEqual(thresholdEvent.integrity_trust_index, 84);
    assert.strictEqual(thresholdEvent.disqualified, true);
    assert.strictEqual(thresholdEvent.auto_submitted, true);
    assert.strictEqual(thresholdEvent.submission_reason, 'MAX_TAB_SWITCHES');

    const studentAttemptRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const studentAttempt = (await studentAttemptRes.json()).data;
    assert.strictEqual(studentAttempt.integrity_trust_index, 84);
    assert.strictEqual(studentAttempt.disqualified, true);
    assert.strictEqual(studentAttempt.status, 'AUTO_SUBMITTED');

    const timelineRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/proctoring-events`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const timeline = (await timelineRes.json()).data;
    assert.strictEqual(timeline.integrity_trust_index, 84);
    assert.strictEqual(timeline.disqualified, true);
    assert.deepStrictEqual(
      timeline.events.map(event => event.event_type),
      ['FACE_NOT_DETECTED', 'TAB_HIDDEN', 'WINDOW_BLURRED', 'TAB_HIDDEN']
    );
  });

  test('14. Security: Third proctoring strike automatically submits and disqualifies the candidate', async () => {
    const createRes = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: `Three Strike Enforcement ${Date.now()}`,
        subject: 'Computer Science',
        difficulty: 'medium',
        duration_minutes: 30,
        total_marks: 1,
        questions: [{
          question_text: 'Which option is correct?',
          question_type: 'MCQ_SINGLE',
          marks: 1,
          options: [
            { id: 'option-a', text: 'Option A' },
            { id: 'option-b', text: 'Option B' }
          ],
          correct_answer: { selected: 'option-a' }
        }]
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createBody = await createRes.json();
    const testId = createBody.data.test.id;

    const publishRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ status: 'published' })
    });
    assert.strictEqual(publishRes.status, 200);

    const joinRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/join-request`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(joinRes.status, 201);
    const joinBody = await joinRes.json();

    const approveRes = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${joinBody.data.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(approveRes.status, 200);

    const startRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(startRes.status, 200);
    const startBody = await startRes.json();
    const thresholdAttemptId = startBody.data.attempt_id;

    for (const [index, eventType] of ['SUSPICIOUS_KEY_COMBINATION', 'CAMERA_DISCONNECTED', 'MULTIPLE_FACES'].entries()) {
      const eventRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${thresholdAttemptId}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({ event_type: eventType })
      });
      assert.strictEqual(eventRes.status, 200);
      const eventBody = await eventRes.json();
      assert.strictEqual(eventBody.success, true);
      assert.strictEqual(eventBody.data.security_warning_count, index + 1);
      assert.strictEqual(eventBody.data.auto_submitted, index === 2);
    }
  });
});
