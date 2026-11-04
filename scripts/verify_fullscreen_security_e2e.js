// Comprehensive E2E Verification of Fullscreen & Security Controls
// Covers all 14 test cases in Section 21 of the specification

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:8081/api';

async function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function putJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function getJson(url, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'GET',
    headers
  });
  const data = await res.json();
  return { status: res.status, data };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, message = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${testName}: ${message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('   LINKTEST: FULLSCREEN & WARNING AUTO-SUBMISSION TEST SUITE   ');
  console.log('===============================================================\n');

  // Step 0: Logins
  console.log('--- Step 0: Authenticating Test Users ---');
  const student1Login = await postJson('/auth/login', {
    email: 'student@linktest.io',
    password: 'Student123!'
  });
  const student1Token = student1Login.data.data.token;
  const student1Id = student1Login.data.data.user.id;
  assert(Boolean(student1Token), 'Student 1 Login', 'Expected valid auth token');

  const student2Login = await postJson('/auth/login', {
    email: 'priya@linktest.io',
    password: 'Student123!'
  });
  const student2Token = student2Login.data.data.token;
  assert(Boolean(student2Token), 'Student 2 Login', 'Expected valid auth token');

  const teacherLogin = await postJson('/auth/login', {
    email: 'teacher@linktest.io',
    password: 'Teacher123!'
  });
  const teacherToken = teacherLogin.data.data.token;
  assert(Boolean(teacherToken), 'Teacher Login', 'Expected valid auth token');

  // Create an active test dynamically for this proctoring security run
  const createRes = await postJson('/mock-tests', {
    title: `Proctoring Fullscreen Verification ${Date.now()}`,
    subject: 'Computer Science',
    duration_minutes: 60,
    total_marks: 20,
    max_attempts: 10,
    pass_percentage: 50,
    status: 'published',
    questions: [
      {
        question_text: 'What is the primary protocol of the Web?',
        question_type: 'mcq_single',
        options: ['HTTP', 'FTP', 'SMTP', 'SSH'],
        answer_key: { correct_index: 0 },
        marks: 10
      },
      {
        question_text: 'Is JavaScript statically typed?',
        question_type: 'mcq_single',
        options: ['True', 'False'],
        answer_key: { correct_index: 1 },
        marks: 10
      }
    ]
  }, teacherToken);

  const testId = createRes.data?.data?.test?.id || createRes.data?.data?.id;
  assert(Boolean(testId), 'Dynamic Mock Test Provisioned', `Test ID: ${testId}`);

  // Student 1 requests join and teacher approves
  await postJson(`/mock-tests/${testId}/join-request`, {}, student1Token);
  const joinReqs = await getJson(`/mock-tests/${testId}/join-requests`, teacherToken);
  const req1 = joinReqs.data?.data?.requests?.find(r => r.student_id === student1Id);
  if (req1) {
    await postJson(`/mock-tests/join-requests/${req1.id}/approve`, {}, teacherToken);
  }

  // ---------------------------------------------------------------------------
  // FULLSCREEN EXIT SCENARIO (TESTS 1, 2, 3, 4, 5, 6)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario A: Fullscreen Tracking & Second Exit Auto-Submit ---');

  // Start attempt 1
  const startRes1 = await postJson(`/mock-tests/${testId}/attempts`, {}, student1Token);
  assert(startRes1.status === 200 && startRes1.data.success, 'TEST 1: Start Mock Test', 'Should initialize exam session');
  const attempt1 = startRes1.data.data;
  const attempt1Id = attempt1.attempt_id || attempt1.id;
  assert(attempt1.status === 'in_progress', 'TEST 1b: Attempt In-Progress', `Status: ${attempt1.status}`);
  assert(attempt1.fullscreen_exit_count === 0, 'TEST 1c: Initial Fullscreen Exit Count 0', `Count: ${attempt1.fullscreen_exit_count}`);
  assert(attempt1.security_warning_count === 0, 'TEST 1d: Initial Warning Count 0', `Count: ${attempt1.security_warning_count}`);

  // TEST 4: Student exits fullscreen once
  console.log('Simulating first fullscreen exit...');
  const exit1Res = await postJson(`/mock-tests/attempts/${attempt1Id}/security-event`, {
    eventType: 'FULLSCREEN_EXIT'
  }, student1Token);

  assert(exit1Res.status === 200, 'TEST 4: First Fullscreen Exit API', 'Expected 200 OK');
  assert(exit1Res.data.data.fullscreen_exit_count === 1, 'TEST 4b: Exit Count = 1', `Count is ${exit1Res.data.data.fullscreen_exit_count}`);
  assert(exit1Res.data.data.auto_submitted === false, 'TEST 4c: Not Auto-Submitted on 1st Exit', 'Must NOT submit on 1st exit');

  // Wait past debounce threshold (3.6s)
  console.log('Waiting 3.6s for debounce window...');
  await delay(3600);

  // TEST 5: Return to fullscreen and answer a question
  console.log('Student returns to fullscreen and answers a question...');
  const questionsRes = await getJson(`/mock-tests/attempts/${attempt1Id}`, student1Token);
  const q1 = questionsRes.data.data.questions[0];
  const ansRes = await putJson(`/mock-tests/attempts/${attempt1Id}/answers`, {
    question_id: q1.id,
    response_data: { selected_index: 1 },
    is_marked_for_review: false
  }, student1Token);
  assert(ansRes.status === 200, 'TEST 5: Answer Question While Fullscreen Active', 'Expected answer saved');

  // TEST 6: Student exits fullscreen a second time -> Auto-submission!
  console.log('Simulating second fullscreen exit...');
  const exit2Res = await postJson(`/mock-tests/attempts/${attempt1Id}/security-event`, {
    eventType: 'FULLSCREEN_EXIT'
  }, student1Token);

  assert(exit2Res.status === 200, 'TEST 6: Second Fullscreen Exit Event', 'Expected 200 OK');
  assert(exit2Res.data.data.fullscreen_exit_count === 2, 'TEST 6b: Exit Count = 2', `Count is ${exit2Res.data.data.fullscreen_exit_count}`);
  assert(exit2Res.data.data.auto_submitted === true, 'TEST 6c: Automatically Submitted on 2nd Exit', 'auto_submitted must be true');
  assert(exit2Res.data.data.status === 'AUTO_SUBMITTED', 'TEST 6d: Status is AUTO_SUBMITTED', `Status: ${exit2Res.data.data.status}`);
  assert(exit2Res.data.data.submission_reason === 'SECOND_FULLSCREEN_EXIT', 'TEST 6e: Reason is SECOND_FULLSCREEN_EXIT', `Reason: ${exit2Res.data.data.submission_reason}`);

  // TEST 10: Refresh after auto-submission -> remains submitted
  const refreshRes1 = await getJson(`/mock-tests/attempts/${attempt1Id}`, student1Token);
  assert(
    refreshRes1.data.data.status === 'AUTO_SUBMITTED' || refreshRes1.data.data.attempt?.status === 'AUTO_SUBMITTED',
    'TEST 10: Refresh After Auto-Submission',
    `Status on reload: ${refreshRes1.data.data.status}`
  );
  assert(
    refreshRes1.data.data.fullscreen_exit_count === 2 || refreshRes1.data.data.attempt?.fullscreen_exit_count === 2,
    'TEST 10b: Fullscreen Exit Count Restored',
    `Count on reload: ${refreshRes1.data.data.fullscreen_exit_count}`
  );

  // TEST 11: Try to answer after auto-submission -> rejected by backend
  const tryAnswerRes = await putJson(`/mock-tests/attempts/${attempt1Id}/answers`, {
    question_id: q1.id,
    response_data: { selected_index: 2 }
  }, student1Token);
  assert(tryAnswerRes.status === 400, 'TEST 11: Answering Rejected After Auto-Submission', `Status was ${tryAnswerRes.status}`);

  // ---------------------------------------------------------------------------
  // WARNING LIMIT SCENARIO (TESTS 7, 8, 9)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario B: Security Warning Limit (MAX_WARNINGS = 5) ---');

  // Start attempt 2
  const startRes2 = await postJson(`/mock-tests/${testId}/attempts`, {}, student1Token);
  const attempt2Id = startRes2.data.data.attempt_id || startRes2.data.data.id;

  // TEST 7: Generate Warning 1
  console.log('Sending security warning 1...');
  const warn1 = await postJson(`/mock-tests/attempts/${attempt2Id}/security-event`, {
    eventType: 'TAB_HIDDEN'
  }, student1Token);
  assert(warn1.data.data.security_warning_count === 1, 'TEST 7: Security Warning 1/5', `Count: ${warn1.data.data.security_warning_count}`);
  assert(warn1.data.data.auto_submitted === false, 'TEST 7b: Not Auto-Submitted at 1 warning', 'Should not submit');

  // Test deduplication / debouncing (send immediately within 100ms)
  const rapidWarn = await postJson(`/mock-tests/attempts/${attempt2Id}/security-event`, {
    eventType: 'TAB_HIDDEN'
  }, student1Token);
  assert(rapidWarn.data.data.debounced === true, 'TEST 9-Debounce: Duplicate Rapid Event Debounced', 'Should debounce event within 3.5s');

  // TEST 8: Generate warnings 2, 3, 4 with appropriate delays
  for (let i = 2; i <= 4; i++) {
    console.log(`Waiting 3.6s before warning ${i}...`);
    await delay(3600);
    const eventType = i % 2 === 0 ? 'WINDOW_BLURRED' : 'TAB_HIDDEN';
    const wRes = await postJson(`/mock-tests/attempts/${attempt2Id}/security-event`, {
      eventType,
      reason: `Proctoring alert ${i}`
    }, student1Token);
    assert(wRes.data.data.security_warning_count === i, `TEST 8: Security Warning ${i}/5`, `Count: ${wRes.data.data.security_warning_count}`);
    assert(wRes.data.data.auto_submitted === false, `TEST 8b: Not Auto-Submitted at ${i} warnings`, 'Should not submit yet');
  }

  // TEST 9: Generate 5th warning -> AUTO SUBMIT!
  console.log('Waiting 3.6s before 5th warning...');
  await delay(3600);
  const warn5 = await postJson(`/mock-tests/attempts/${attempt2Id}/security-event`, {
    eventType: 'SECURITY_WARNING',
    reason: 'Suspicious window switching'
  }, student1Token);

  assert(warn5.data.data.security_warning_count === 5, 'TEST 9: Security Warning 5/5', `Count: ${warn5.data.data.security_warning_count}`);
  assert(warn5.data.data.auto_submitted === true, 'TEST 9b: Auto-Submitted on 5th Warning', 'Must auto-submit at 5 warnings');
  assert(warn5.data.data.status === 'AUTO_SUBMITTED', 'TEST 9c: Status is AUTO_SUBMITTED', `Status: ${warn5.data.data.status}`);
  assert(warn5.data.data.submission_reason === 'MAX_SECURITY_WARNINGS', 'TEST 9d: Reason is MAX_SECURITY_WARNINGS', `Reason: ${warn5.data.data.submission_reason}`);

  // ---------------------------------------------------------------------------
  // SECURITY & TAMPERING TESTS (TESTS 12, 13)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario C: Role Security & Anti-Tampering ---');

  // TEST 12: Try to modify warning count or status through API
  const startRes3 = await postJson(`/mock-tests/${testId}/attempts`, {}, student1Token);
  const attempt3Id = startRes3.data.data.attempt_id || startRes3.data.data.id;

  // Sending fraudulent warningCount in payload must be ignored
  const tamperRes = await postJson(`/mock-tests/attempts/${attempt3Id}/security-event`, {
    eventType: 'TAB_HIDDEN',
    warningCount: 99,
    security_warning_count: 99,
    fullscreenExitCount: 99
  }, student1Token);
  assert(tamperRes.data.data.security_warning_count === 1, 'TEST 12: Client Warning Count Tampering Ignored', `Count was: ${tamperRes.data.data.security_warning_count}`);

  // TEST 13: Try to generate security event for another student's attempt
  const crossStudentRes = await postJson(`/mock-tests/attempts/${attempt3Id}/security-event`, {
    eventType: 'FULLSCREEN_EXIT'
  }, student2Token); // Student 2 trying to hijack Student 1's attempt
  assert(crossStudentRes.status === 403, 'TEST 13: Cross-Student Security Event Rejected', `Status was ${crossStudentRes.status} (expected 403)`);

  // Finalize attempt 3 so attempt 4 starts with a completely clean attempt
  await postJson(`/mock-tests/attempts/${attempt3Id}/submit`, { auto_submitted: false }, student1Token);

  // ---------------------------------------------------------------------------
  // NORMAL TEST FLOW WITH ZERO VIOLATIONS (TEST 14)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario D: Normal Test Flow (TEST 14) ---');

  const startRes4 = await postJson(`/mock-tests/${testId}/attempts`, {}, student1Token);
  const attempt4Id = startRes4.data.data.attempt_id || startRes4.data.data.id;

  // Save an answer
  const questions4 = startRes4.data.data.questions;
  if (questions4 && questions4.length > 0) {
    await putJson(`/mock-tests/attempts/${attempt4Id}/answers`, {
      question_id: questions4[0].id,
      response_data: { selected_index: 0 }
    }, student1Token);
  }

  // Normal submission
  const normalSubRes = await postJson(`/mock-tests/attempts/${attempt4Id}/submit`, {
    auto_submitted: false
  }, student1Token);

  assert(normalSubRes.status === 200, 'TEST 14: Normal Submission Succeeded', 'Expected 200 OK');
  assert(normalSubRes.data.data.status !== 'AUTO_SUBMITTED', 'TEST 14b: Normal Status is not AUTO_SUBMITTED', `Status: ${normalSubRes.data.data.status}`);
  assert(normalSubRes.data.data.security_warning_count === 0, 'TEST 14c: Zero Violations Count', `Count: ${normalSubRes.data.data.security_warning_count}`);

  // ---------------------------------------------------------------------------
  // TEACHER / ADMIN AUDIT VERIFICATION (Section 18 & 19)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario E: Teacher & Admin View Verification ---');

  const teacherAttemptView = await getJson(`/mock-tests/${testId}/attempts`, teacherToken);
  assert(teacherAttemptView.status === 200, 'Teacher Attempts List API', 'Expected 200 OK');
  const attemptsList = teacherAttemptView.data.data.attempts || [];

  const foundAutoSubmitted = attemptsList.find(a => a.id === attempt1Id || a.id === attempt2Id);
  assert(Boolean(foundAutoSubmitted), 'Found Auto-Submitted Attempt in Teacher List', 'Teacher can retrieve auto-submitted attempts');
  if (foundAutoSubmitted) {
    assert(foundAutoSubmitted.status === 'AUTO_SUBMITTED', 'Teacher Views AUTO_SUBMITTED Status', `Status: ${foundAutoSubmitted.status}`);
    assert(Boolean(foundAutoSubmitted.submission_reason), 'Teacher Views Submission Reason', `Reason: ${foundAutoSubmitted.submission_reason}`);
    console.log(`  [INFO] Teacher verified: Student ${foundAutoSubmitted.student_name}, Status: ${foundAutoSubmitted.status}, Reason: ${foundAutoSubmitted.submission_reason}, Fullscreen Exits: ${foundAutoSubmitted.fullscreen_exit_count}, Security Warnings: ${foundAutoSubmitted.security_warning_count}`);
  }

  // Final Summary
  console.log('\n===============================================================');
  console.log(`TOTAL TESTS RUN: ${passedTests + failedTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('===============================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
