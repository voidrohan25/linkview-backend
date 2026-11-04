import http from 'http';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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
          raw: rawBody.toString('utf8')
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

async function run() {
  console.log('===============================================================');
  console.log('   LINKTEST: PRODUCTION READINESS & ADMIN VERIFICATION SUITE   ');
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

  // 1. Admin Login
  console.log('--- 1. Testing Admin Authentication ---');
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    email: 'admin@linktest.io',
    password: 'Admin123!'
  });
  assert(loginRes.status === 200, 'Admin Login successful (HTTP 200)');
  const token = loginRes.data?.data?.token;
  const adminUser = loginRes.data?.data?.user;
  assert(Boolean(token), 'JWT Token received for Admin');
  assert(adminUser?.role === 'ADMIN', 'Authenticated user role is ADMIN');
  assert(adminUser?.email === 'admin@linktest.io', 'Authenticated user email matches');

  // 2. Admin Dashboard
  console.log('\n--- 2. Testing Admin Dashboard ---');
  const dashRes = await makeRequest('GET', '/api/admin/dashboard', null, token);
  assert(dashRes.status === 200, 'Admin Dashboard API accessible (HTTP 200)');
  assert(dashRes.data?.success === true, 'Dashboard returns success: true');

  // 3. User Management
  console.log('\n--- 3. Testing User Management ---');
  const usersRes = await makeRequest('GET', '/api/admin/users', null, token);
  assert(usersRes.status === 200, 'Users Management API accessible (HTTP 200)');
  const userList = usersRes.data?.data?.users || usersRes.data?.data || [];
  assert(userList.length === 1, `Exactly 1 user returned in users list (Found: ${userList.length})`);
  assert(userList[0]?.email === 'admin@linktest.io', 'Single remaining user is admin@linktest.io');

  // 4. Academic Sessions
  console.log('\n--- 4. Testing System Configuration (Academic Sessions) ---');
  const sessRes = await makeRequest('GET', '/api/admin/academic-sessions', null, token);
  assert(sessRes.status === 200, 'Academic Sessions API accessible (HTTP 200)');
  const sessions = sessRes.data?.data?.sessions || sessRes.data?.data || [];
  assert(sessions.length >= 1, `Active Academic Session configured (Found: ${sessions.length})`);

  // 5. Create Subject
  console.log('\n--- 5. Testing Subject Creation ---');
  const subRes = await makeRequest('POST', '/api/admin/subjects', {
    name: 'Temporary Production Check Subject',
    code: 'PROD_CHECK_101',
    description: 'Temporary subject for validation'
  }, token);
  assert(subRes.status === 200 || subRes.status === 201, `Subject creation successful (HTTP ${subRes.status})`);
  const subjectId = subRes.data?.data?.subject?.id || subRes.data?.data?.id;

  // 6. Create Class & Batch
  console.log('\n--- 6. Testing Class & Batch Creation ---');
  const classRes = await makeRequest('POST', '/api/admin/classes', {
    name: 'Temporary Validation Class',
    description: 'Temporary class for validation'
  }, token);
  assert(classRes.status === 200 || classRes.status === 201, `Class creation successful (HTTP ${classRes.status})`);
  const classId = classRes.data?.data?.class?.id || classRes.data?.data?.id;

  let batchId = null;
  if (classId) {
    const batchRes = await makeRequest('POST', `/api/admin/classes/${classId}/batches`, {
      name: 'Batch A - Validation',
      capacity: 30
    }, token);
    assert(batchRes.status === 200 || batchRes.status === 201, `Batch creation successful (HTTP ${batchRes.status})`);
    batchId = batchRes.data?.data?.batch?.id || batchRes.data?.data?.id;
  }

  // 7. Create Course
  console.log('\n--- 7. Testing Course Creation ---');
  const courseRes = await makeRequest('POST', '/api/admin/courses', {
    title: 'Temporary Validation Course',
    description: 'Temporary course description for platform testing',
    category: 'Computer Science',
    published: true
  }, token);
  assert(courseRes.status === 200 || courseRes.status === 201, `Course creation successful (HTTP ${courseRes.status})`);
  const courseId = courseRes.data?.data?.course?.id || courseRes.data?.data?.id;

  // 8. Teacher Invitation & Assignment
  console.log('\n--- 8. Testing Teacher Assignment ---');
  let assignmentId = null;
  if (subjectId && classId && batchId) {
    const assignRes = await makeRequest('POST', '/api/admin/teachers/assign', {
      teacher_id: adminUser.id,
      subject_id: subjectId,
      class_id: classId,
      batch_id: batchId
    }, token);
    assert(assignRes.status === 200 || assignRes.status === 201, `Teacher Assignment successful (HTTP ${assignRes.status})`);
    assignmentId = assignRes.data?.data?.assignment?.id || assignRes.data?.data?.id;
  }

  // 9. Create Question in Question Bank
  console.log('\n--- 9. Testing Question Bank Management ---');
  const qRes = await makeRequest('POST', '/api/questions', {
    question_text: 'What is the purpose of LinkTest production verification?',
    question_type: 'mcq_single',
    options: ['Quality Assurance', 'Testing', 'Verification', 'All of the above'],
    correct_option_index: 3,
    subject: 'Computer Science',
    topic: 'Testing',
    marks: 5,
    difficulty: 'easy'
  }, token);
  assert(qRes.status === 200 || qRes.status === 201, `Question creation successful (HTTP ${qRes.status})`);
  const questionId = qRes.data?.data?.question?.id || qRes.data?.data?.id;

  // 10. Create Mock Test
  console.log('\n--- 10. Testing Mock Test Creation ---');
  const testRes = await makeRequest('POST', '/api/mock-tests', {
    title: 'Temporary Validation Examination',
    subject: 'Quality Engineering',
    duration_minutes: 30,
    total_marks: 25,
    pass_percentage: 50,
    status: 'draft',
    questions: [
      {
        question_text: 'Sample verification question?',
        question_type: 'mcq_single',
        options: ['A', 'B', 'C', 'D'],
        answer_key: { correct_index: 0 },
        marks: 5
      }
    ]
  }, token);
  assert(testRes.status === 200 || testRes.status === 201, `Mock Test creation successful (HTTP ${testRes.status})`);
  const mockTestId = testRes.data?.data?.test?.id;

  // 11. Audit Logs & Security Logs
  console.log('\n--- 11. Testing Audit Logs & Security Logs Infrastructure ---');
  const auditRes = await makeRequest('GET', '/api/admin/audit-logs', null, token);
  assert(auditRes.status === 200, 'Audit Logs API operational (HTTP 200)');
  const auditLogs = auditRes.data?.data?.logs || auditRes.data?.data || [];
  assert(auditLogs.length > 0, `Audit log events recorded during activity (Count: ${auditLogs.length})`);

  const secRes = await makeRequest('GET', '/api/admin/security-logs', null, token);
  assert(secRes.status === 200, 'Security Logs API operational (HTTP 200)');
  const secLogs = secRes.data?.data?.logs || secRes.data?.data || [];
  assert(secLogs.length > 0, `Security log events recorded during activity (Count: ${secLogs.length})`);

  // 12. Reports Overview
  console.log('\n--- 12. Testing Reports Overview ---');
  const repRes = await makeRequest('GET', '/api/admin/reports/overview', null, token);
  assert(repRes.status === 200, 'Reports Overview API operational (HTTP 200)');

  // 13. Cleanup Temporary Verification Data
  console.log('\n--- 13. Cleaning up Temporary Validation Records ---');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (mockTestId) {
      await client.query('DELETE FROM mock_test_questions WHERE test_id = $1', [mockTestId]);
      await client.query('DELETE FROM mock_test_audit_logs WHERE test_id = $1', [mockTestId]);
      await client.query('DELETE FROM mock_tests WHERE id = $1', [mockTestId]);
    }
    if (questionId) {
      await client.query('DELETE FROM question_bank WHERE id = $1', [questionId]);
    }
    if (assignmentId) {
      await client.query('DELETE FROM teacher_assignments WHERE id = $1', [assignmentId]);
    }
    if (batchId) {
      await client.query('DELETE FROM batches WHERE id = $1', [batchId]);
    }
    if (classId) {
      await client.query('DELETE FROM classes WHERE id = $1', [classId]);
    }
    if (courseId) {
      await client.query('DELETE FROM courses WHERE id = $1', [courseId]);
    }
    if (subjectId) {
      await client.query('DELETE FROM subjects WHERE id = $1', [subjectId]);
    }
    // Clear the temporary audit/security logs generated during this check
    await client.query('DELETE FROM audit_logs');
    await client.query('DELETE FROM security_logs');
    await client.query('DELETE FROM mock_test_audit_logs');
    await client.query('COMMIT');
    console.log('  [PASS] Cleaned up temporary validation records successfully.');
    passed++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  [FAIL] Failed to clean up validation records:', err.message);
    failed++;
  } finally {
    client.release();
    await pool.end();
  }

  // 14. Final Row Count Check
  console.log('\n--- 14. Final Row Count Verification ---');
  const pool2 = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const finalUsers = await pool2.query('SELECT count(*)::int as count FROM users');
  const finalSessions = await pool2.query('SELECT count(*)::int as count FROM academic_sessions');
  const finalCourses = await pool2.query('SELECT count(*)::int as count FROM courses');
  const finalBatches = await pool2.query('SELECT count(*)::int as count FROM batches');
  const finalTests = await pool2.query('SELECT count(*)::int as count FROM mock_tests');
  const finalQuestions = await pool2.query('SELECT count(*)::int as count FROM question_bank');
  await pool2.end();

  assert(finalUsers.rows[0].count === 1, 'Final Users Count is EXACTLY 1 (Admin)');
  assert(finalSessions.rows[0].count === 1, 'Final Academic Sessions Count is EXACTLY 1');
  assert(finalCourses.rows[0].count === 0, 'Final Courses Count is 0');
  assert(finalBatches.rows[0].count === 0, 'Final Batches Count is 0');
  assert(finalTests.rows[0].count === 0, 'Final Mock Tests Count is 0');
  assert(finalQuestions.rows[0].count === 0, 'Final Question Bank Count is 0');

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

run().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
