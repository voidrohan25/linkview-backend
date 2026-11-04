import 'dotenv/config';
import http from 'http';

const BASE_URL = 'http://localhost:8081';

function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        let parsed = null;
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            parsed = JSON.parse(rawBody.toString('utf8'));
          } catch (e) {
            parsed = rawBody.toString('utf8');
          }
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          buffer: rawBody
        });
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runVerification() {
  console.log('===============================================================');
  console.log('   LINKTEST: RESULT LIFECYCLE & PDF VERIFICATION TEST SUITE   ');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // --- Step 0: Ensure Test Users Exist ---
  console.log('--- Step 0: Provisioning & Authenticating Test Users ---');
  const pgModule = await import('pg');
  const bcryptModule = await import('bcryptjs');
  const pool = new pgModule.default.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/linktest',
    ssl: { rejectUnauthorized: false }
  });

  const teacherHash = await bcryptModule.default.hash('Teacher123!', 10);
  const studentHash = await bcryptModule.default.hash('Student123!', 10);

  await pool.query(`
    INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, auth_provider)
    VALUES ('user-teacher-test', 'Faculty Rajesh Kulkarni', 'teacher@linktest.io', $1, 'TEACHER', 'active', true, 'local')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'TEACHER', status = 'active', email_verified = true
  `, [teacherHash]);

  await pool.query(`
    INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, auth_provider)
    VALUES ('user-student-001', 'Student Atharva Patil', 'student@linktest.io', $1, 'STUDENT', 'active', true, 'local')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'STUDENT', status = 'active', email_verified = true
  `, [studentHash]);

  await pool.query(`
    INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, auth_provider)
    VALUES ('user-student-002', 'Priya Deshmukh', 'priya@linktest.io', $1, 'STUDENT', 'active', true, 'local')
    ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'STUDENT', status = 'active', email_verified = true
  `, [studentHash]);

  const loginStudent1 = await makeRequest('POST', '/api/auth/login', {
    email: 'student@linktest.io',
    password: 'Student123!'
  });
  const tokenStudent1 = loginStudent1.data?.data?.token;
  assert(Boolean(tokenStudent1), 'Student 1 Login');

  const loginStudent2 = await makeRequest('POST', '/api/auth/login', {
    email: 'priya@linktest.io',
    password: 'Student123!'
  });
  const tokenStudent2 = loginStudent2.data?.data?.token;
  assert(Boolean(tokenStudent2), 'Student 2 Login');

  const loginTeacher = await makeRequest('POST', '/api/auth/login', {
    email: 'teacher@linktest.io',
    password: 'Teacher123!'
  });
  const tokenTeacher = loginTeacher.data?.data?.token;
  assert(Boolean(tokenTeacher), 'Teacher Login');

  // --- Step 1: Create a Mixed Mock Test ---
  console.log('\n--- Step 1: Creating Assessment with MCQ, True/False, Long Answer, and Coding ---');
  const createTestRes = await makeRequest('POST', '/api/mock-tests', {
    title: `Comprehensive Full-Stack Examination ${Date.now()}`,
    subject: 'Computer Science',
    duration_minutes: 60,
    total_marks: 35,
    pass_percentage: 50,
    status: 'published',
    results_published: false,
    questions: [
      {
        question_text: 'What does CSS stand for?',
        question_type: 'mcq_single',
        options: ['Cascading Style Sheets', 'Computer Style System', 'Creative Sheet Style', 'Coded Style Sheets'],
        answer_key: { correct_index: 0 },
        marks: 5,
        negative_marks: 1
      },
      {
        question_text: 'JavaScript is a statically typed programming language.',
        question_type: 'true_false',
        options: ['True', 'False'],
        answer_key: { correct_value: false },
        marks: 5,
        negative_marks: 1
      },
      {
        question_text: 'Explain the difference between optimistic locking and pessimistic locking in relational databases.',
        question_type: 'long_answer',
        marks: 15,
        negative_marks: 0,
        expected_answer: 'Optimistic locking assumes low conflict using version numbers; pessimistic locking uses row/table locks.'
      },
      {
        question_text: 'Write a function sumArray(arr) that returns the sum of numbers in an array.',
        question_type: 'coding',
        marks: 10,
        programming_language: 'javascript',
        starter_code: 'function sumArray(arr) {\n  return arr.reduce((a, b) => a + b, 0);\n}',
        test_cases: [
          { input: '[1, 2, 3]', expected_output: '6', is_hidden: false },
          { input: '[10, -5, 5]', expected_output: '10', is_hidden: true }
        ]
      }
    ]
  }, tokenTeacher);

  const testId = createTestRes.data?.data?.test?.id;
  assert(testId, `Created Test with 4 Question Types (ID: ${testId})`);

  // Auto-approve join requests for test to allow attempt start
  await makeRequest('POST', `/api/mock-tests/${testId}/join-request`, {}, tokenStudent1);
  const joinReqs = await makeRequest('GET', `/api/mock-tests/${testId}/join-requests`, null, tokenTeacher);
  const req1 = joinReqs.data?.data?.requests?.[0];
  if (req1) {
    await makeRequest('POST', `/api/mock-tests/join-requests/${req1.id}/approve`, {}, tokenTeacher);
  }

  // --- Scenario A & B: Student 1 Takes Test and Submits ---
  console.log('\n--- Scenario A: Student 1 Completes Mixed Test ---');
  const startRes = await makeRequest('POST', `/api/mock-tests/${testId}/attempts`, {}, tokenStudent1);
  const attemptId1 = startRes.data?.data?.attempt?.id;
  assert(attemptId1, `Student 1 Started Attempt (ID: ${attemptId1})`);

  const questions = startRes.data?.data?.questions || [];
  const qMcq = questions.find(q => q.question_type === 'mcq_single');
  const qTf = questions.find(q => q.question_type === 'true_false');
  const qLa = questions.find(q => q.question_type === 'long_answer');
  const qCode = questions.find(q => q.question_type === 'coding');

  // Answer MCQ (correct: 5 marks)
  await makeRequest('PUT', `/api/mock-tests/attempts/${attemptId1}/answers`, {
    questionId: qMcq.id,
    responseData: { selected_index: 0 },
    isMarkedForReview: false
  }, tokenStudent1);

  // Answer True/False (correct: 5 marks)
  await makeRequest('PUT', `/api/mock-tests/attempts/${attemptId1}/answers`, {
    questionId: qTf.id,
    responseData: { selected_value: false },
    isMarkedForReview: false
  }, tokenStudent1);

  // Answer Long Answer (subjective: pending evaluation)
  await makeRequest('PUT', `/api/mock-tests/attempts/${attemptId1}/answers`, {
    questionId: qLa.id,
    responseData: { text: 'Optimistic locking checks record version timestamp at write time, while pessimistic locking holds exclusive row locks.' },
    isMarkedForReview: false
  }, tokenStudent1);

  // Answer Coding Question
  await makeRequest('PUT', `/api/mock-tests/attempts/${attemptId1}/answers`, {
    questionId: qCode.id,
    responseData: {
      code: 'function sumArray(arr) { return arr.reduce((a, b) => a + b, 0); }',
      test_cases_passed: 2,
      total_test_cases: 2
    },
    isMarkedForReview: false
  }, tokenStudent1);

  // Submit attempt
  const submitRes = await makeRequest('POST', `/api/mock-tests/attempts/${attemptId1}/submit`, {}, tokenStudent1);
  assert(submitRes.status === 200, 'Student 1 Submitted Test');

  // Check Result State Immediately After Submission (Should be PENDING_EVALUATION)
  console.log('\n--- Scenario B: Pre-Release Verification (PENDING_EVALUATION) ---');
  const preReleaseResult = await makeRequest('GET', `/api/mock-tests/attempts/${attemptId1}/result`, null, tokenStudent1);
  assert(preReleaseResult.status === 200, 'Student 1 Retrieves Pre-Release Result API');
  assert(preReleaseResult.data?.data?.result_status === 'PENDING_EVALUATION', 'Result Status is PENDING_EVALUATION');
  assert(preReleaseResult.data?.data?.results_released === false, 'Results Released is FALSE for Student Before Release');

  // Verify answer keys and teacher explanations are NOT leaked before release
  const laQuestionPre = preReleaseResult.data?.data?.questions?.find(q => q.id === qLa.id);
  assert(laQuestionPre?.is_pending_review === true, 'Long Answer is marked is_pending_review = true');
  assert(laQuestionPre?.evaluation_comment === null, 'No teacher evaluation comments leaked to student');
  const mcqQuestionPre = preReleaseResult.data?.data?.questions?.find(q => q.id === qMcq.id);
  assert(mcqQuestionPre?.answer_key === null, 'MCQ answer key hidden before release');

  // --- Scenario C: Teacher Result Review and Evaluation ---
  console.log('\n--- Scenario C: Teacher Manual Evaluation of Long Answer ---');
  // Teacher accesses attempt result
  const teacherViewResult = await makeRequest('GET', `/api/mock-tests/attempts/${attemptId1}/result`, null, tokenTeacher);
  assert(teacherViewResult.status === 200, 'Teacher Accesses Attempt Evaluation View');
  assert(teacherViewResult.data?.data?.results_released === true, 'Teacher has full review access');

  // Teacher evaluates Long Answer: assigns 12 / 15 marks with comment
  const evalRes = await makeRequest('POST', `/api/mock-tests/attempts/${attemptId1}/responses/${qLa.id}/evaluate`, {
    score: 12,
    comment: 'Accurate distinction between optimistic and pessimistic concurrency strategies.'
  }, tokenTeacher);
  assert(evalRes.status === 200, 'Teacher Successfully Evaluated Long Answer Question');

  // Verify updated score calculation (MCQ: 5 + TF: 5 + LA: 12 + Coding: 10 = 32 / 35)
  const afterEvalRes = await makeRequest('GET', `/api/mock-tests/attempts/${attemptId1}/result`, null, tokenTeacher);
  const totalScoreAfterEval = afterEvalRes.data?.data?.total_score;
  assert(totalScoreAfterEval === 32, `Total Score Accurately Calculated (Score: ${totalScoreAfterEval} / 35)`);
  assert(afterEvalRes.data?.data?.result_status === 'READY', 'Result Status transitioned to READY after all questions evaluated');

  // --- Scenario D: Teacher Releases Result ---
  console.log('\n--- Scenario D: Teacher Releases Result to Student ---');
  const releaseRes = await makeRequest('POST', `/api/mock-tests/attempts/${attemptId1}/release`, {}, tokenTeacher);
  assert(releaseRes.status === 200, 'Teacher Releases Result Endpoint');
  assert(releaseRes.data?.data?.result_status === 'RELEASED', 'Attempt Result Status is RELEASED');

  // Student re-fetches result now that it is RELEASED
  const studentReleasedResult = await makeRequest('GET', `/api/mock-tests/attempts/${attemptId1}/result`, null, tokenStudent1);
  assert(studentReleasedResult.data?.data?.result_status === 'RELEASED', 'Student Sees RELEASED Status');
  assert(studentReleasedResult.data?.data?.results_released === true, 'Student Has results_released = TRUE');
  assert(studentReleasedResult.data?.data?.total_score === 32, 'Student Sees Final Score (32 / 35)');

  const laQuestionReleased = studentReleasedResult.data?.data?.questions?.find(q => q.id === qLa.id);
  assert(laQuestionReleased?.score_awarded === 12, 'Student Sees Long Answer Score Awarded (12)');
  assert(laQuestionReleased?.evaluation_comment === 'Accurate distinction between optimistic and pessimistic concurrency strategies.', 'Student Sees Teacher Feedback');

  // --- Scenario E: Critical Security & Result Privacy ---
  console.log('\n--- Scenario E: Critical Privacy & Result Ownership Verification ---');
  // Student 2 tries to access Student 1's attempt result
  const s2TriesS1 = await makeRequest('GET', `/api/mock-tests/attempts/${attemptId1}/result`, null, tokenStudent2);
  assert(s2TriesS1.status === 403, `Cross-Student Access Blocked with HTTP 403 Forbidden (Got: ${s2TriesS1.status})`);

  // Verify Student 1's results API returns only Student 1's results
  const s1MyResults = await makeRequest('GET', `/api/mock-tests/my-results`, null, tokenStudent1);
  assert(s1MyResults.status === 200, 'Student 1 My-Results API OK');
  const s1ResultsList = s1MyResults.data?.data?.results || [];
  assert(s1ResultsList.some(r => r.id === attemptId1), 'Student 1 My-Results includes attempt');

  // Verify Student 2's results API does NOT include Student 1's attempt
  const s2MyResults = await makeRequest('GET', `/api/mock-tests/my-results`, null, tokenStudent2);
  assert(s2MyResults.status === 200, 'Student 2 My-Results API OK');
  const s2ResultsList = s2MyResults.data?.data?.results || [];
  assert(!s2ResultsList.some(r => r.id === attemptId1), "Student 2 My-Results DOES NOT include Student 1's attempt");

  // --- Scenario F: Bulk PDF Generation ---
  console.log('\n--- Scenario F: Bulk Test Results PDF Generation ---');
  // Teacher requests PDF via /api/reports/tests/:testId/results/pdf
  const pdfRes = await makeRequest('GET', `/api/reports/tests/${testId}/results/pdf`, null, tokenTeacher);
  assert(pdfRes.status === 200, 'Teacher Generates Bulk PDF Report (HTTP 200)');
  assert(pdfRes.headers['content-type'] === 'application/pdf', 'Content-Type is application/pdf');
  assert(pdfRes.headers['content-disposition']?.includes('.pdf'), 'Content-Disposition includes .pdf filename');
  const pdfMagic = pdfRes.buffer.slice(0, 4).toString('utf8');
  assert(pdfMagic === '%PDF', `PDF Buffer contains valid '%PDF' signature (Size: ${pdfRes.buffer.length} bytes)`);

  // Student attempts to download teacher's bulk PDF report -> Must be 403 Forbidden!
  const studentPdfRes = await makeRequest('GET', `/api/reports/tests/${testId}/results/pdf`, null, tokenStudent1);
  assert(studentPdfRes.status === 403, `Student Blocked from Bulk PDF with HTTP 403 Forbidden (Got: ${studentPdfRes.status})`);

  // --- Scenario G: Black Screen & Undefined Fallback Safety ---
  console.log('\n--- Scenario G: Null/Undefined Fallback & Resilience Testing ---');
  // Attempt with zero answers (unanswered questions)
  await makeRequest('POST', `/api/mock-tests/${testId}/join-request`, {}, tokenStudent2);
  const joinReqs2 = await makeRequest('GET', `/api/mock-tests/${testId}/join-requests`, null, tokenTeacher);
  const req2 = joinReqs2.data?.data?.requests?.find(r => r.student_id === 'user-student-002');
  if (req2) {
    await makeRequest('POST', `/api/mock-tests/join-requests/${req2.id}/approve`, {}, tokenTeacher);
  }

  const startRes2 = await makeRequest('POST', `/api/mock-tests/${testId}/attempts`, {}, tokenStudent2);
  const attemptId2 = startRes2.data?.data?.attempt?.id;
  // Student 2 submits immediately with zero answers
  await makeRequest('POST', `/api/mock-tests/attempts/${attemptId2}/submit`, {}, tokenStudent2);

  const emptyResult = await makeRequest('GET', `/api/mock-tests/attempts/${attemptId2}/result`, null, tokenStudent2);
  assert(emptyResult.status === 200, 'Unanswered Test Result API Succeeded');
  assert(emptyResult.data?.data?.total_score === 0, 'Unanswered Test Total Score is 0 (not NaN or null)');
  assert(emptyResult.data?.data?.correct_count === 0, 'Correct Count is 0');
  assert(emptyResult.data?.data?.unanswered_count === 4, 'Unanswered Count is 4');
  assert(Array.isArray(emptyResult.data?.data?.questions), 'Questions is valid Array');

  // Verify each question response is safe
  const allSafe = emptyResult.data?.data?.questions?.every(q =>
    q.marks !== undefined &&
    q.score_awarded !== undefined &&
    Array.isArray(q.options) &&
    typeof q.question_text === 'string'
  );
  assert(allSafe, 'All question fields adhere strictly to non-null safe schema');

  console.log('\n===============================================================');
  console.log(`TOTAL ASSERTIONS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVerification().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
