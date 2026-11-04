// LinkTest Mock Test Proctoring Pipeline & Security Enforcement Test Suite
// Verifies Section 19: Fullscreen, Visibility, Blur, Face, Camera, and Anti-Tampering

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { userRepository } from '../src/repositories/userRepository.js';

let server;
let baseUrl;
let studentToken;
let studentUser;
let student2Token;
let student2User;
let teacherToken;
let testId;
let laQuestionId;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function putJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getJson(url, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${url}`, {
    method: 'GET',
    headers
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('Proctoring Pipeline & Security Enforcement Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api`;
        resolve();
      });
    });

    const passwordHash = await bcrypt.hash('Student123!', 10);
    const suffix = Date.now();

    // 1. Authenticate Teacher
    const tEmail = `teacher.proctor.${suffix}@linktest.io`;
    await userRepository.create({
      fullName: 'Prof. Proctor Tester',
      email: tEmail,
      passwordHash,
      role: 'TEACHER',
      subject: 'Computer Science',
      emailVerified: true,
      status: 'active'
    });
    const tLogin = await postJson('/auth/login', { email: tEmail, password: 'Student123!' });
    teacherToken = tLogin.data.data.token;

    // 2. Authenticate Student 1
    const s1Email = `student1.proctor.${suffix}@linktest.io`;
    studentUser = await userRepository.create({
      fullName: 'Aarav Student',
      email: s1Email,
      passwordHash,
      role: 'STUDENT',
      emailVerified: true,
      status: 'active'
    });
    const s1Login = await postJson('/auth/login', { email: s1Email, password: 'Student123!' });
    studentToken = s1Login.data.data.token;

    // 3. Authenticate Student 2 (for cross-student tampering tests)
    const s2Email = `student2.proctor.${suffix}@linktest.io`;
    student2User = await userRepository.create({
      fullName: 'Priya Student',
      email: s2Email,
      passwordHash,
      role: 'STUDENT',
      emailVerified: true,
      status: 'active'
    });
    const s2Login = await postJson('/auth/login', { email: s2Email, password: 'Student123!' });
    student2Token = s2Login.data.data.token;

    // 4. Create a published mock test with proctoring enabled
    const createTestRes = await postJson('/mock-tests', {
      title: `Secure Proctoring Verification Test ${suffix}`,
      subject: 'Computer Science',
      duration_minutes: 60,
      total_marks: 20,
      max_attempts: 10,
      pass_percentage: 50,
      status: 'published',
      proctoring_config: {
        webcam_required: true,
        face_detection: true,
        max_tab_switches: 3,
        max_fullscreen_exits: 2
      },
      questions: [
        {
          question_text: 'What protocol does secure HTTP use for encryption?',
          question_type: 'mcq_single',
          options: ['TLS', 'FTP', 'SSH', 'Telnet'],
          answer_key: { correct_index: 0 },
          marks: 10
        },
        {
          question_text: 'Define proctoring integrity in distributed computer-based exams.',
          question_type: 'long_answer',
          marks: 10
        }
      ]
    }, teacherToken);

    testId = createTestRes.data.data.test.id;
    laQuestionId = (createTestRes.data.data.test.questions || []).find(q => q.question_type === 'long_answer')?.id;
    assert.ok(testId, 'Mock test created successfully');

    // 5. Join request and Teacher approval for Student 1
    const s1Req = await postJson(`/mock-tests/${testId}/join-request`, {}, studentToken);
    const s1ReqId = s1Req.data.data.id;
    await postJson(`/mock-tests/join-requests/${s1ReqId}/approve`, {}, teacherToken);

    // 6. Join request and Teacher approval for Student 2
    const s2Req = await postJson(`/mock-tests/${testId}/join-request`, {}, student2Token);
    const s2ReqId = s2Req.data.data.id;
    await postJson(`/mock-tests/join-requests/${s2ReqId}/approve`, {}, teacherToken);
  });

  async function createTestForSuite(titleSuffix) {
    const createTestRes = await postJson('/mock-tests', {
      title: `Secure Proctoring Verification Test ${titleSuffix}`,
      subject: 'Computer Science',
      duration_minutes: 60,
      total_marks: 20,
      max_attempts: 10,
      pass_percentage: 50,
      status: 'published',
      proctoring_config: {
        webcam_required: true,
        face_detection: true,
        max_tab_switches: 3,
        max_fullscreen_exits: 2
      },
      questions: [
        {
          question_text: 'What protocol does secure HTTP use for encryption?',
          question_type: 'mcq_single',
          options: ['TLS', 'FTP', 'SSH', 'Telnet'],
          answer_key: { correct_index: 0 },
          marks: 10
        },
        {
          question_text: 'Define proctoring integrity in distributed computer-based exams.',
          question_type: 'long_answer',
          marks: 10
        }
      ]
    }, teacherToken);

    const tId = createTestRes.data.data.test.id;
    const lId = (createTestRes.data.data.test.questions || []).find(q => q.question_type === 'long_answer')?.id;

    const s1Req = await postJson(`/mock-tests/${tId}/join-request`, {}, studentToken);
    const s1ReqId = s1Req.data.data.id;
    await postJson(`/mock-tests/join-requests/${s1ReqId}/approve`, {}, teacherToken);

    const s2Req = await postJson(`/mock-tests/${tId}/join-request`, {}, student2Token);
    const s2ReqId = s2Req.data.data.id;
    await postJson(`/mock-tests/join-requests/${s2ReqId}/approve`, {}, teacherToken);

    return { testId: tId, laQuestionId: lId };
  }

  after(() => {
    if (server) server.close();
  });

  // ---------------------------------------------------------------------------
  // FULLSCREEN DETECTION & TWO-STRIKE AUTO-SUBMISSION
  // ---------------------------------------------------------------------------
  test('Fullscreen: First exit records warning; duplicate is debounced; second exit auto-submits', async () => {
    // Start fresh attempt
    const startRes = await postJson(`/mock-tests/${testId}/attempts`, {}, studentToken);
    const attemptId = startRes.data.data.attempt_id || startRes.data.data.id;
    assert.ok(attemptId, 'Attempt started');

    // 1. First Fullscreen Exit
    const exit1 = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'FULLSCREEN_EXIT'
    }, studentToken);

    assert.equal(exit1.status, 200);
    assert.equal(exit1.data.data.fullscreen_exit_count, 1, 'First exit count is 1');
    assert.equal(exit1.data.data.auto_submitted, false, 'Should not auto-submit on first exit');

    // 2. Rapid duplicate exit within debounce window (< 3.5s)
    const duplicateExit = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'FULLSCREEN_EXIT'
    }, studentToken);
    assert.equal(duplicateExit.status, 200);
    assert.equal(duplicateExit.data.data.debounced, true, 'Rapid duplicate exit must be debounced');
    assert.equal(duplicateExit.data.data.fullscreen_exit_count, 1, 'Count remains 1 after duplicate');

    // 3. Refresh simulation: fetching attempt confirms count is server authoritative
    const refreshed = await getJson(`/mock-tests/attempts/${attemptId}`, studentToken);
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.data.data.fullscreen_exit_count, 1, 'Count persists across page refresh');
    assert.equal(refreshed.data.data.status, 'in_progress', 'Attempt still in progress');

    // Wait for server debounce window (3.6s)
    await delay(3600);

    // 4. Second Fullscreen Exit -> Server-Authoritative Auto-Submit
    const exit2 = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'FULLSCREEN_EXIT'
    }, studentToken);

    assert.equal(exit2.status, 200);
    assert.equal(exit2.data.data.fullscreen_exit_count, 2, 'Second exit count is 2');
    assert.equal(exit2.data.data.auto_submitted, true, 'Auto-submitted on second exit');
    assert.equal(exit2.data.data.status, 'AUTO_SUBMITTED', 'Status is AUTO_SUBMITTED');
    assert.equal(exit2.data.data.submission_reason, 'SECOND_FULLSCREEN_EXIT', 'Reason is SECOND_FULLSCREEN_EXIT');

    // 5. Subsequent attempts to answer must be rejected with HTTP 400
    const saveAttempt = await putJson(`/mock-tests/attempts/${attemptId}/answers`, {
      question_id: 'some-q',
      response_data: { answer: 'attempt after submit' }
    }, studentToken);
    assert.equal(saveAttempt.status, 400, 'Saving answers after auto-submit must fail with 400');

    // 6. Refreshing after auto-submit preserves AUTO_SUBMITTED state
    const afterSubmit = await getJson(`/mock-tests/attempts/${attemptId}`, studentToken);
    assert.equal(afterSubmit.data.data.status, 'AUTO_SUBMITTED');
    assert.equal(afterSubmit.data.data.submission_reason, 'SECOND_FULLSCREEN_EXIT');
  });

  // ---------------------------------------------------------------------------
  // TAB SWITCH & WINDOW BLUR CORRELATION & 3-STRIKE LIMIT
  // ---------------------------------------------------------------------------
  test('Tab/Window: Tab switch and blur within debounce window do not double count; 3 strikes auto-submits', async () => {
    // Start fresh attempt
    const { testId: tabTestId } = await createTestForSuite(`Tab_${Date.now()}`);
    const startRes = await postJson(`/mock-tests/${tabTestId}/attempts`, {}, studentToken);
    const attemptId = startRes.data.data.attempt_id || startRes.data.data.id;
    assert.ok(attemptId, 'Attempt started');

    // 1. Strike 1: TAB_HIDDEN
    const tab1 = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'TAB_HIDDEN'
    }, studentToken);
    assert.equal(tab1.status, 200);
    assert.equal(tab1.data.data.security_warning_count, 1, 'Strike 1 recorded');
    assert.equal(tab1.data.data.auto_submitted, false);

    // 2. Immediate WINDOW_BLURRED (simulating simultaneous browser blur on tab switch)
    const blurImmediately = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'WINDOW_BLURRED'
    }, studentToken);
    assert.equal(blurImmediately.data.data.debounced, true, 'Immediate blur after tab hidden must be debounced');
    assert.equal(blurImmediately.data.data.security_warning_count, 1, 'Count remains 1 (no double strike)');

    // Wait for debounce window
    await delay(3600);

    // 3. Strike 2: WINDOW_BLURRED (e.g. user clicked to another app while on test tab)
    const blur2 = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'WINDOW_BLURRED'
    }, studentToken);
    assert.equal(blur2.data.data.security_warning_count, 2, 'Strike 2 recorded');
    assert.equal(blur2.data.data.auto_submitted, false);

    // Wait for debounce window
    await delay(3600);

    // 4. Strike 3: TAB_HIDDEN -> Reaching 3 strikes triggers MAX_TAB_SWITCHES auto-submit
    const tab3 = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'TAB_HIDDEN'
    }, studentToken);
    assert.equal(tab3.data.data.auto_submitted, true, 'Auto-submitted at 3rd strike');
    assert.equal(tab3.data.data.status, 'AUTO_SUBMITTED');
    assert.ok(['MAX_TAB_SWITCHES', 'MAX_SECURITY_WARNINGS'].includes(tab3.data.data.submission_reason),
      `Valid submission reason: ${tab3.data.data.submission_reason}`);
  });

  // ---------------------------------------------------------------------------
  // FACE DETECTION & CAMERA INTEGRITY EVENTS
  // ---------------------------------------------------------------------------
  test('Face & Camera Events: FACE_NOT_DETECTED, MULTIPLE_FACES, CAMERA_DISCONNECTED are recorded', async () => {
    // Start fresh attempt
    const { testId: faceTestId } = await createTestForSuite(`Face_${Date.now()}`);
    const startRes = await postJson(`/mock-tests/${faceTestId}/attempts`, {}, studentToken);
    const attemptId = startRes.data.data.attempt_id || startRes.data.data.id;
    assert.ok(attemptId, 'Attempt started');

    // 1. FACE_NOT_DETECTED event
    const faceRes = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'FACE_NOT_DETECTED',
      duration_seconds: 5
    }, studentToken);
    assert.equal(faceRes.status, 200);
    assert.equal(faceRes.data.data.recorded, true, 'FACE_NOT_DETECTED recorded');

    // Wait for debounce window
    await delay(3600);

    // 2. MULTIPLE_FACES event
    const multiFaceRes = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'MULTIPLE_FACES',
      face_count: 2
    }, studentToken);
    assert.equal(multiFaceRes.status, 200);
    assert.equal(multiFaceRes.data.data.recorded, true, 'MULTIPLE_FACES recorded');

    // Wait for debounce window
    await delay(3600);

    // 3. CAMERA_DISCONNECTED event
    const camRes = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'CAMERA_DISCONNECTED',
      severity: 'critical'
    }, studentToken);
    assert.equal(camRes.status, 200);
    assert.equal(camRes.data.data.recorded, true, 'CAMERA_DISCONNECTED recorded');

    // Verify events appear in teacher proctoring review
    const teacherReview = await getJson(`/mock-tests/attempts/${attemptId}/proctoring-events`, teacherToken);
    assert.equal(teacherReview.status, 200);
    const eventTypes = teacherReview.data.data.events.map(e => e.event_type);
    assert.ok(eventTypes.includes('FACE_NOT_DETECTED'), 'Teacher sees FACE_NOT_DETECTED');
    assert.ok(eventTypes.includes('MULTIPLE_FACES'), 'Teacher sees MULTIPLE_FACES');
    assert.ok(eventTypes.includes('CAMERA_DISCONNECTED'), 'Teacher sees CAMERA_DISCONNECTED');
  });

  // ---------------------------------------------------------------------------
  // SECURITY & ANTI-TAMPERING VALIDATION
  // ---------------------------------------------------------------------------
  test('Security & Anti-Tampering: Student cannot manipulate strikes or forge events for others', async () => {
    // Start fresh attempt for Student 1
    const { testId: tamperTestId, laQuestionId: tamperLaId } = await createTestForSuite(`Tamper_${Date.now()}`);
    const startRes = await postJson(`/mock-tests/${tamperTestId}/attempts`, {}, studentToken);
    const attemptId = startRes.data.data.attempt_id || startRes.data.data.id;
    assert.ok(attemptId, 'Attempt started');

    // 1. Student 2 tries to send a security event for Student 1's attempt -> HTTP 403
    const crossStudent = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'FULLSCREEN_EXIT'
    }, student2Token);
    assert.equal(crossStudent.status, 403, 'Cross-student event must return 403 Forbidden');

    // 2. Student 1 tries to send client-manipulated counts in payload -> Ignored
    const tamperRes = await postJson(`/mock-tests/attempts/${attemptId}/security-event`, {
      eventType: 'TAB_HIDDEN',
      security_warning_count: 99,
      fullscreen_exit_count: 99,
      warning_count: 99
    }, studentToken);
    assert.equal(tamperRes.status, 200);
    assert.equal(tamperRes.data.data.security_warning_count, 1, 'Client-supplied warning counts are ignored');
    // 3. Unreleased results privacy check: Student 1 submits long answer response needing manual evaluation
    if (tamperLaId) {
      await putJson(`/mock-tests/attempts/${attemptId}/answers`, {
        question_id: tamperLaId,
        text_response: 'Proctoring integrity ensures computer-based tests are conducted fairly without unauthorized aids.'
      }, studentToken);
    }

    await postJson(`/mock-tests/attempts/${attemptId}/submit`, { submission_status: 'NORMAL' }, studentToken);
    const resultRes = await getJson(`/mock-tests/attempts/${attemptId}/result`, studentToken);
    assert.equal(resultRes.status, 403, 'Unreleased result must return 403');
    assert.equal(resultRes.data.error?.code, 'RESULT_NOT_RELEASED');
    assert.equal(resultRes.data.data, undefined, 'Score withheld');
  });
});
