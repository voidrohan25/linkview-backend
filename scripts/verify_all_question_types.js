import { codeExecutionService } from '../src/services/codeExecutionService.js';
import { questionBankRepository } from '../src/repositories/questionBankRepository.js';
import { mockTestRepository } from '../src/repositories/mockTestRepository.js';
import { mockTestService } from '../src/services/mockTestService.js';
import { codingRepository } from '../src/repositories/codingRepository.js';
import { isPostgresConnected, pool } from '../src/db/index.js';
import assert from 'node:assert/strict';

async function runVerification() {
  console.log('=== STARTING E2E VERIFICATION OF ALL QUESTION TYPES ===\n');

  // 1. VERIFY SANDBOX SECURITY & TIMEOUTS
  console.log('--- 1. Testing Code Execution Sandbox & Security ---');

  // 1.1 Normal JavaScript execution
  const normalCode = `
    function solution(input) {
      const n = Number(input);
      return n * 2;
    }
  `;
  const normalTestCases = [
    { id: 'tc-1', input: '5', expected_output: '10', is_hidden: false },
    { id: 'tc-2', input: '12', expected_output: '24', is_hidden: true }
  ];
  const normalExec = await codeExecutionService.executeCode({
    code: normalCode,
    testCases: normalTestCases,
    timeLimitSeconds: 2,
    memoryLimitMb: 128
  });
  console.log(`✓ Normal execution status: ${normalExec.status}, passed: ${normalExec.test_cases_passed}/${normalExec.total_test_cases}`);
  if (normalExec.error) console.log('normalExec error:', normalExec.error, normalExec.results);
  assert.equal(normalExec.status, 'passed');
  assert.equal(normalExec.test_cases_passed, 2);

  // 1.2 Candidate sanitization: Hidden test cases MUST NOT leak inputs/outputs
  const sanitized = codeExecutionService.sanitizeResultsForCandidate(normalExec);
  const hiddenCase = sanitized.results.find(r => r.is_hidden);
  assert.ok(hiddenCase, 'Hidden test case present in sanitized results');
  assert.equal(hiddenCase.input, undefined, 'Hidden input was not stripped!');
  assert.equal(hiddenCase.expected_output, undefined, 'Hidden expected output was not stripped!');
  assert.equal(hiddenCase.actual_output, undefined, 'Hidden actual output was not stripped!');
  console.log('✓ Hidden test cases sanitized properly for candidate-facing APIs');

  // 1.3 Infinite loop watchdog timeout kill
  console.log('Testing infinite loop timeout kill...');
  const infiniteLoopCode = `
    function solution(input) {
      while (true) {}
    }
  `;
  const loopExec = await codeExecutionService.executeCode({
    code: infiniteLoopCode,
    testCases: [{ id: 'tc-loop', input: '1', expected_output: '1', is_hidden: false }],
    timeLimitSeconds: 1,
    memoryLimitMb: 128
  });
  console.log(`✓ Infinite loop result status: ${loopExec.status}, error: ${loopExec.error || loopExec.results[0]?.error}`);
  assert.ok(loopExec.status === 'timeout' || loopExec.error?.includes('timed out') || loopExec.results[0]?.status === 'timeout');

  // 1.4 Security probe (process.env and sensitive modules)
  console.log('Testing security sandbox probe...');
  const probeCode = `
    function solution() {
      try {
        if (typeof process !== 'undefined' && process.env && Object.keys(process.env).length > 0) {
          return "LEAKED_ENV";
        }
        if (typeof require !== 'undefined') {
          const fs = require('fs');
          return "LEAKED_FS";
        }
      } catch (e) {
        return "SECURE";
      }
      return "SECURE";
    }
  `;
  const probeExec = await codeExecutionService.executeCode({
    code: probeCode,
    testCases: [{ id: 'tc-sec', input: '', expected_output: 'SECURE', is_hidden: false }],
    timeLimitSeconds: 2,
    memoryLimitMb: 128
  });
  console.log(`✓ Security probe execution output: ${probeExec.results[0]?.actual_output}`);
  assert.equal(probeExec.results[0]?.actual_output, 'SECURE');


  // 2. VERIFY QUESTION BANK REPOSITORY CRUD FOR ALL 4 TYPES
  console.log('\n--- 2. Testing Question Bank Storage for All Question Types ---');
  const dummyUserId = '00000000-0000-0000-0000-000000000001';

  // 2.1 Create MCQ
  const mcq = await questionBankRepository.createQuestion({
    subject: 'Computer Science',
    topic: 'Data Structures',
    difficulty: 'EASY',
    question_type: 'mcq_single',
    question_text: 'What is the time complexity of pushing to a stack?',
    options: ['O(1)', 'O(n)', 'O(log n)', 'O(n^2)'],
    correct_option_index: 0,
    marks: 2,
    explanation: 'Stack push is constant time O(1).'
  }, dummyUserId);
  console.log(`✓ Created MCQ in Question Bank (ID: ${mcq.id})`);

  // 2.2 Create True/False
  const tf = await questionBankRepository.createQuestion({
    subject: 'Computer Science',
    topic: 'Data Structures',
    difficulty: 'EASY',
    question_type: 'true_false',
    question_text: 'A binary search tree maintains sorted keys in in-order traversal.',
    options: ['True', 'False'],
    correct_option_index: 0,
    marks: 2,
    explanation: 'In-order traversal of a BST yields sorted elements.'
  }, dummyUserId);
  console.log(`✓ Created True/False in Question Bank (ID: ${tf.id})`);

  // 2.3 Create Long Answer
  const longAns = await questionBankRepository.createQuestion({
    subject: 'Computer Science',
    topic: 'Database Architecture',
    difficulty: 'MEDIUM',
    question_type: 'long_answer',
    question_text: 'Explain the difference between clustered and non-clustered indexes in SQL.',
    marks: 10,
    expected_answer: 'A clustered index determines the physical order of data in the table, meaning each table can only have one. A non-clustered index creates a separate pointer structure that references table rows.',
    evaluation_criteria: '5 marks for physical ordering vs pointer structure; 3 marks for max 1 clustered vs multiple non-clustered; 2 marks for lookup speed differences.',
    explanation: 'Clustered indexes alter physical row order; non-clustered indexes provide index pages with row pointers.'
  }, dummyUserId);
  console.log(`✓ Created Long Answer in Question Bank (ID: ${longAns.id})`);

  // 2.4 Create Coding Question with test cases
  const codingQ = await questionBankRepository.createQuestion({
    subject: 'Computer Science',
    topic: 'Algorithms',
    difficulty: 'MEDIUM',
    question_type: 'coding',
    question_text: 'Write a JavaScript function reverseWords(str) that reverses the order of words.',
    marks: 15,
    programming_language: 'javascript',
    starter_code: 'function solution(input) {\n  // return reversed words\n}',
    time_limit: 2,
    memory_limit: 128,
    test_cases: [
      { input: 'hello world', expected_output: 'world hello', is_hidden: false },
      { input: 'the sky is blue', expected_output: 'blue is sky the', is_hidden: true }
    ],
    explanation: 'Split by space, reverse array, join by space.'
  }, dummyUserId);
  console.log(`✓ Created Coding Question in Question Bank (ID: ${codingQ.id})`);


  // 3. VERIFY MOCK TEST WITH ALL 4 TYPES & CANDIDATE ATTEMPT
  console.log('\n--- 3. Testing Mock Test Lifecycle, Attempt Scoring & Manual Evaluation ---');

  // 3.1 Create mock test
  const testData = {
    title: 'Comprehensive Multi-Type Assessment 2026',
    description: 'Validates MCQ, True/False, Long Answer, and Coding questions',
    instructions: 'Follow standard examination integrity protocols.',
    subject: 'Computer Science',
    topic: 'Full Stack Engineering',
    duration_minutes: 60,
    total_marks: 29,
    passing_percentage: 50,
    created_by: dummyUserId,
    category: 'mock_exam',
    difficulty: 'medium'
  };

  const questionsList = [
    {
      question_text: mcq.question_text,
      question_type: 'mcq_single',
      options: mcq.options,
      answer_key: { correct_index: 0 },
      marks: 2,
      negative_marks: 0,
      explanation: mcq.explanation
    },
    {
      question_text: tf.question_text,
      question_type: 'true_false',
      options: ['True', 'False'],
      answer_key: { correct_index: 0 },
      marks: 2,
      negative_marks: 0,
      explanation: tf.explanation
    },
    {
      question_text: longAns.question_text,
      question_type: 'long_answer',
      marks: 10,
      expected_answer: longAns.expected_answer,
      evaluation_criteria: longAns.evaluation_criteria,
      explanation: longAns.explanation
    },
    {
      question_text: codingQ.question_text,
      question_type: 'coding',
      marks: 15,
      programming_language: 'javascript',
      starter_code: codingQ.starter_code,
      time_limit: 2,
      memory_limit: 128,
      test_cases: [
        { input: 'hello world', expected_output: 'world hello', is_hidden: false },
        { input: 'the sky is blue', expected_output: 'blue is sky the', is_hidden: true }
      ],
      explanation: codingQ.explanation
    }
  ];

  const createdTest = await mockTestRepository.createTest(testData, questionsList);
  console.log(`✓ Created Mock Test with 4 question types (ID: ${createdTest.id})`);

  // Publish test
  await mockTestRepository.updateTest(createdTest.id, { status: 'published' });

  // 3.2 Student starts attempt
  const attempt = await mockTestRepository.createAttempt({
    test_id: createdTest.id,
    student_id: dummyUserId,
    max_score: 29
  });
  console.log(`✓ Candidate started attempt (ID: ${attempt.id})`);

  // 3.3 Get test questions and verify candidate view does NOT leak hidden test cases
  const fetchedQuestions = await mockTestRepository.getQuestionsByTestId(createdTest.id, { sanitize: true });
  const codingQFetched = fetchedQuestions.find(q => q.question_type === 'coding');
  const tcs = codingQFetched.test_cases || [];
  const candidateHiddenTC = tcs.find(tc => tc.is_hidden);
  if (candidateHiddenTC) {
    assert.equal(candidateHiddenTC.input, undefined, 'Hidden test case input leaked in test questions!');
  }
  console.log('✓ Mock test questions retrieved without hidden test case leakage');

  // 3.4 Candidate executes coding solution during test
  const candidateSolution = `
    function solution(input) {
      return String(input).trim().split(/\\s+/).reverse().join(' ');
    }
  `;

  const codingExec = await codeExecutionService.executeCode({
    code: candidateSolution,
    testCases: codingQ.test_cases,
    timeLimitSeconds: 2,
    memoryLimitMb: 128
  });
  console.log(`✓ Candidate solution executed: ${codingExec.test_cases_passed}/${codingExec.total_test_cases} passed`);
  assert.equal(codingExec.status, 'passed');

  // 3.5 Submit answers for all questions
  const candidateAnswers = [
    {
      question_id: fetchedQuestions.find(q => q.question_type === 'mcq_single').id,
      selected_index: 0 // Correct!
    },
    {
      question_id: fetchedQuestions.find(q => q.question_type === 'true_false').id,
      selected_index: 0 // Correct!
    },
    {
      question_id: fetchedQuestions.find(q => q.question_type === 'long_answer').id,
      text: 'Clustered indexes define the physical order of rows in the storage table. Only 1 can exist per table. Non-clustered indexes are auxiliary data structures containing pointers to rows.'
    },
    {
      question_id: codingQFetched.id,
      code: candidateSolution,
      test_cases_passed: codingExec.test_cases_passed,
      total_test_cases: codingExec.total_test_cases,
      execution_results: codingExec
    }
  ];

  for (const ans of candidateAnswers) {
    await mockTestRepository.saveResponse(attempt.id, ans.question_id, ans, false, true);
  }
  console.log('✓ Candidate saved answers for all 4 questions');

  // 3.6 Submit attempt
  const submissionResult = await mockTestService.submitAttempt(attempt.id, { id: dummyUserId, role: 'STUDENT' });
  console.log(`✓ Attempt finalized. Total score so far: ${submissionResult.total_score}/${submissionResult.max_score}`);

  // MCQ = 2 marks, TF = 2 marks, Coding = 15 marks (all tests passed), Long Answer = 0 (Pending Review)
  // Expect 2 + 2 + 15 = 19
  assert.equal(submissionResult.total_score, 19, `Expected initial score of 19, got ${submissionResult.total_score}`);

  // Fetch attempt details and verify pending review flag
  const attemptReview = await mockTestRepository.getAttemptById(attempt.id);
  const longAnsQId = fetchedQuestions.find(q => q.question_type === 'long_answer').id;
  const longAnsResponse = (attemptReview.responses || []).find(r => r.question_id === longAnsQId);
  assert.equal(longAnsResponse?.is_pending_review, true, 'Long answer should be marked is_pending_review = true');
  console.log('✓ Long answer properly marked as pending manual instructor review');

  // 3.7 Teacher performs manual grading on Long Answer
  console.log('\n--- 4. Teacher Manual Grading & Atomic Score Recalculation ---');
  const evaluatedAttempt = await mockTestRepository.manuallyEvaluateResponse(
    attempt.id,
    longAnsResponse.question_id,
    {
      score: 9.5,
      comment: 'Excellent explanation of physical ordering and pointer architecture. Deducted 0.5 for omitting B-tree mention.',
      evaluatorId: dummyUserId
    }
  );

  console.log(`✓ Teacher evaluated Long Answer: +9.5 marks assigned`);
  // Previous score 19 + 9.5 = 28.5 out of 29 (98.28%)
  console.log(`✓ Recalculated total score: ${evaluatedAttempt.total_score}/${evaluatedAttempt.max_score} (${evaluatedAttempt.percentage}%)`);
  assert.equal(evaluatedAttempt.total_score, 28.5);
  assert.equal(evaluatedAttempt.passed, true);

  // Clean up created test records if connected to postgres
  console.log('\n--- 5. Cleanup Test Artifacts ---');
  if (isPostgresConnected && pool) {
    await pool.query('DELETE FROM mock_test_responses WHERE attempt_id = $1', [attempt.id]);
    await pool.query('DELETE FROM mock_test_attempts WHERE id = $1', [attempt.id]);
    await pool.query('DELETE FROM mock_test_questions WHERE test_id = $1', [createdTest.id]);
    await pool.query('DELETE FROM mock_tests WHERE id = $1', [createdTest.id]);
    await pool.query('DELETE FROM question_bank WHERE id IN ($1, $2, $3, $4)', [mcq.id, tf.id, longAns.id, codingQ.id]);
    console.log('✓ Cleaned up PostgreSQL test rows');
  }

  console.log('\n=== ALL END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runVerification().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
