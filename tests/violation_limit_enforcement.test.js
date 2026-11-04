import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

describe('Violation Limit Enforcement & Retake Prohibition Suite', () => {
  let server;
  let baseUrl;
  let studentToken;
  let student2Token;
  let teacherToken;

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

    // Login Student 1
    const s1Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const s1Body = await s1Res.json();
    studentToken = s1Body.data.token;

    // Login Student 2
    const s2Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student2@linktest.io', password: 'Student123!' })
    });
    const s2Body = await s2Res.json();
    student2Token = s2Body.data ? s2Body.data.token : studentToken;

    // Login Teacher
    const tRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const tBody = await tRes.json();
    teacherToken = tBody.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Helper to create and publish a mock test with custom max_attempts
  async function createPublishedTest(title, maxAttempts = 3) {
    const createRes = await fetch(`${baseUrl}/api/mock-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title,
        subject: 'Computer Science',
        difficulty: 'medium',
        duration_minutes: 30,
        total_marks: 10,
        max_attempts: maxAttempts,
        proctoring_config: {
          webcam_required: true,
          fullscreen_required: true,
          tab_switch_limit: 3,
          max_fullscreen_exits: 2,
          max_security_warnings: 3
        },
        questions: [{
          question_text: 'What is 2 + 2?',
          question_type: 'MCQ_SINGLE',
          marks: 10,
          options: [
            { id: 'opt-a', text: '4' },
            { id: 'opt-b', text: '5' }
          ],
          correct_answer: { selected: 'opt-a' }
        }]
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createBody = await createRes.json();
    const testId = createBody.data.test.id;

    const pubRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ status: 'published' })
    });
    assert.strictEqual(pubRes.status, 200);

    return testId;
  }

  // Helper to approve join request
  async function approveStudent(testId, token) {
    const joinRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/join-request`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(joinRes.status, 201);
    const joinBody = await joinRes.json();

    const approveRes = await fetch(`${baseUrl}/api/teacher/mock-tests/join-requests/${joinBody.data.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(approveRes.status, 200);
  }

  test('1. Fullscreen violation limit: 2nd exit auto-submits, disqualifies, and permanently blocks retakes', async () => {
    const testId = await createPublishedTest(`Fullscreen Violation Test ${Date.now()}`, 3);
    await approveStudent(testId, studentToken);

    // Attempt 1: Start test
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(startRes.status, 200);
    const startBody = await startRes.json();
    const attemptId = startBody.data.attempt_id;

    // First fullscreen exit: warning
    const fs1Res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ event_type: 'FULLSCREEN_EXIT' })
    });
    assert.strictEqual(fs1Res.status, 200);
    const fs1Body = await fs1Res.json();
    assert.strictEqual(fs1Body.data.fullscreen_exit_count, 1);
    assert.strictEqual(fs1Body.data.auto_submitted, false);

    // Wait past debounce
    await new Promise(r => setTimeout(r, 2600));

    // Second fullscreen exit: auto-submits with SECOND_FULLSCREEN_EXIT and disqualifies
    const fs2Res = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ event_type: 'FULLSCREEN_EXIT' })
    });
    assert.strictEqual(fs2Res.status, 200);
    const fs2Body = await fs2Res.json();
    assert.strictEqual(fs2Body.data.fullscreen_exit_count, 2);
    assert.strictEqual(fs2Body.data.auto_submitted, true);
    assert.strictEqual(fs2Body.data.disqualified, true);
    assert.strictEqual(fs2Body.data.submission_reason, 'SECOND_FULLSCREEN_EXIT');

    // Verification 1: Attempting to submit answers to this attempt is rejected
    const ansRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/answers`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        question_id: 'q1',
        response_data: { selected: 'opt-a' }
      })
    });
    assert.strictEqual(ansRes.status, 400);

    // Verification 2: Attempting to start attempt 2 is strictly blocked (even though max_attempts is 3!)
    const retakeRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(retakeRes.status, 403);
    const retakeBody = await retakeRes.json();
    assert.strictEqual(retakeBody.success, false);
    assert.strictEqual(retakeBody.error.code, 'VIOLATION_LIMIT_EXCEEDED');
    assert.ok(retakeBody.error.message.includes('violation limit'));

    // Verification 3: Student test catalog reflects is_disqualified: true and can_attempt: false
    const listRes = await fetch(`${baseUrl}/api/mock-tests`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(listRes.status, 200);
    const listBody = await listRes.json();
    const listedTest = listBody.data.tests.find(t => t.id === testId);
    assert.ok(listedTest, 'Test should be in student list');
    assert.strictEqual(listedTest.is_disqualified, true);
    assert.strictEqual(listedTest.can_attempt, false);
    assert.strictEqual(listedTest.attempts_remaining, 0);

    // Verification 4: Individual test details endpoint returns is_disqualified: true
    const detailRes = await fetch(`${baseUrl}/api/mock-tests/${testId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(detailRes.status, 200);
    const detailBody = await detailRes.json();
    assert.strictEqual(detailBody.data.test.is_disqualified, true);
    assert.strictEqual(detailBody.data.test.can_attempt, false);
  });

  test('2. Security warnings limit: 3 strikes auto-submits, disqualifies, and blocks retakes', async () => {
    const testId = await createPublishedTest(`Security Strikes Test ${Date.now()}`, 3);
    await approveStudent(testId, studentToken);

    // Attempt 1: Start test
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(startRes.status, 200);
    const startBody = await startRes.json();
    const attemptId = startBody.data.attempt_id;

    // Send 3 distinct proctoring security events (no debounce collision)
    const eventTypes = ['SUSPICIOUS_KEY_COMBINATION', 'CAMERA_DISCONNECTED', 'MULTIPLE_FACES'];
    for (let i = 0; i < eventTypes.length; i++) {
      const evRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({ event_type: eventTypes[i] })
      });
      assert.strictEqual(evRes.status, 200);
      const evBody = await evRes.json();
      assert.strictEqual(evBody.data.security_warning_count, i + 1);
      if (i === 2) {
        assert.strictEqual(evBody.data.auto_submitted, true);
        assert.strictEqual(evBody.data.disqualified, true);
        assert.strictEqual(evBody.data.submission_reason, 'MAX_SECURITY_WARNINGS');
      }
    }

    // Try starting attempt 2 -> 403 VIOLATION_LIMIT_EXCEEDED
    const retakeRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(retakeRes.status, 403);
    const retakeBody = await retakeRes.json();
    assert.strictEqual(retakeBody.error.code, 'VIOLATION_LIMIT_EXCEEDED');

    // Dashboard check
    const listRes = await fetch(`${baseUrl}/api/mock-tests`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const listBody = await listRes.json();
    const listedTest = listBody.data.tests.find(t => t.id === testId);
    assert.strictEqual(listedTest.is_disqualified, true);
    assert.strictEqual(listedTest.can_attempt, false);
  });

  test('3. Tab switches limit: 3 tab switches auto-submits, disqualifies, and blocks retakes', async () => {
    const testId = await createPublishedTest(`Tab Switch Disqualification Test ${Date.now()}`, 2);
    await approveStudent(testId, studentToken);

    // Attempt 1: Start test
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(startRes.status, 200);
    const startBody = await startRes.json();
    const attemptId = startBody.data.attempt_id;

    // Send 3 tab switch events with debounce gap
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await new Promise(r => setTimeout(r, 2600));
      }
      const evRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`
        },
        body: JSON.stringify({ event_type: 'TAB_HIDDEN' })
      });
      assert.strictEqual(evRes.status, 200);
      const evBody = await evRes.json();
      if (i === 2) {
        assert.strictEqual(evBody.data.auto_submitted, true);
        assert.strictEqual(evBody.data.disqualified, true);
        assert.strictEqual(evBody.data.submission_reason, 'MAX_TAB_SWITCHES');
      }
    }

    // Retake blocked
    const retakeRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(retakeRes.status, 403);
    const retakeBody = await retakeRes.json();
    assert.strictEqual(retakeBody.error.code, 'VIOLATION_LIMIT_EXCEEDED');
  });

  test('4. Normal candidate submission preserves valid retake eligibility', async () => {
    const testId = await createPublishedTest(`Normal Submission Retake Test ${Date.now()}`, 2);
    await approveStudent(testId, studentToken);

    // Attempt 1: Start test
    const startRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(startRes.status, 200);
    const startBody = await startRes.json();
    const attemptId = startBody.data.attempt_id;

    // Submit normally without violation disqualification
    const subRes = await fetch(`${baseUrl}/api/mock-tests/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(subRes.status, 200);

    // Candidate should NOT be disqualified
    const listRes = await fetch(`${baseUrl}/api/mock-tests`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const listBody = await listRes.json();
    const listedTest = listBody.data.tests.find(t => t.id === testId);
    assert.strictEqual(listedTest.is_disqualified, false);
    assert.strictEqual(listedTest.can_attempt, true);
    assert.strictEqual(listedTest.attempts_remaining, 1);

    // Attempt 2: Start retake is permitted
    const retakeRes = await fetch(`${baseUrl}/api/mock-tests/${testId}/attempts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(retakeRes.status, 200);
    const retakeBody = await retakeRes.json();
    assert.ok(retakeBody.data.attempt_id, 'Should receive valid second attempt ID');
  });
});
