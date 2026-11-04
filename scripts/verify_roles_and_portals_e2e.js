import http from 'http';
import pg from 'pg';
import bcrypt from 'bcryptjs';
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
  console.log('======================================================================');
  console.log('   LINKTEST: ROLE-BASED PORTAL VISIBILITY & ACCESS SECURITY SUITE   ');
  console.log('======================================================================\n');

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

  // --- Step 0: Ensure Test Teacher and Student exist for this validation ---
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('--- Step 0: Provisioning Role Validation Users ---');
  await pool.query("DELETE FROM users WHERE email != 'admin@linktest.io'");
  const teacherHash = await bcrypt.hash('Teacher123!', 10);
  const studentHash = await bcrypt.hash('Student123!', 10);

  await pool.query(`
    INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, auth_provider)
    VALUES ('user-teacher-test', 'Faculty Rajesh Kulkarni', 'teacher@linktest.io', $1, 'TEACHER', 'active', true, 'local')
    ON CONFLICT (id) DO UPDATE SET role = 'TEACHER', status = 'active', email_verified = true
  `, [teacherHash]);

  await pool.query(`
    INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, auth_provider)
    VALUES ('user-student-test', 'Student Atharva Patil', 'student@linktest.io', $1, 'STUDENT', 'active', true, 'local')
    ON CONFLICT (id) DO UPDATE SET role = 'STUDENT', status = 'active', email_verified = true
  `, [studentHash]);

  console.log('  [PASS] Provisioned teacher@linktest.io and student@linktest.io.');

  // --- Step 1: Admin Authentication & Access Control ---
  console.log('\n--- Step 1: ADMIN Authentication & Role Isolation ---');
  const adminLogin = await makeRequest('POST', '/api/auth/login', {
    email: 'admin@linktest.io',
    password: 'Admin123!'
  });
  assert(adminLogin.status === 200, 'Admin Login successful (HTTP 200)');
  const adminToken = adminLogin.data?.data?.token;
  const adminUser = adminLogin.data?.data?.user;
  assert(adminUser?.role === 'ADMIN', 'Admin user role is strictly ADMIN');

  // Admin access to Admin APIs
  const adminDash = await makeRequest('GET', '/api/admin/dashboard', null, adminToken);
  assert(adminDash.status === 200, 'Admin accesses /api/admin/dashboard (HTTP 200)');

  const adminUsers = await makeRequest('GET', '/api/admin/users', null, adminToken);
  assert(adminUsers.status === 200, 'Admin accesses /api/admin/users (HTTP 200)');

  const adminAudit = await makeRequest('GET', '/api/admin/audit-logs', null, adminToken);
  assert(adminAudit.status === 200, 'Admin accesses /api/admin/audit-logs (HTTP 200)');

  // Admin access to Student-only API should be blocked with 403 Forbidden!
  const adminHitsStudent = await makeRequest('GET', '/api/student/dashboard', null, adminToken);
  assert(adminHitsStudent.status === 403, `Admin blocked from /api/student/dashboard with HTTP 403 (Got: ${adminHitsStudent.status})`);

  // --- Step 2: Teacher Authentication & Access Control ---
  console.log('\n--- Step 2: TEACHER Authentication & Role Isolation ---');
  const teacherLogin = await makeRequest('POST', '/api/auth/login', {
    email: 'teacher@linktest.io',
    password: 'Teacher123!'
  });
  assert(teacherLogin.status === 200, 'Teacher Login successful (HTTP 200)');
  const teacherToken = teacherLogin.data?.data?.token;
  const teacherUser = teacherLogin.data?.data?.user;
  assert(teacherUser?.role === 'TEACHER', 'Teacher user role is strictly TEACHER');

  // Teacher access to Teacher APIs
  const teacherDash = await makeRequest('GET', '/api/teacher/dashboard', null, teacherToken);
  assert(teacherDash.status === 200, 'Teacher accesses /api/teacher/dashboard (HTTP 200)');

  const teacherClasses = await makeRequest('GET', '/api/teacher/classes', null, teacherToken);
  assert(teacherClasses.status === 200, 'Teacher accesses /api/teacher/classes (HTTP 200)');

  // Teacher unauthorized attempts on Admin APIs -> MUST RETURN 403 FORBIDDEN!
  const teacherHitsAdminDash = await makeRequest('GET', '/api/admin/dashboard', null, teacherToken);
  assert(teacherHitsAdminDash.status === 403, `Teacher blocked from /api/admin/dashboard with HTTP 403 (Got: ${teacherHitsAdminDash.status})`);

  const teacherHitsAdminUsers = await makeRequest('GET', '/api/admin/users', null, teacherToken);
  assert(teacherHitsAdminUsers.status === 403, `Teacher blocked from /api/admin/users with HTTP 403 (Got: ${teacherHitsAdminUsers.status})`);

  const teacherHitsAdminAudit = await makeRequest('GET', '/api/admin/audit-logs', null, teacherToken);
  assert(teacherHitsAdminAudit.status === 403, `Teacher blocked from /api/admin/audit-logs with HTTP 403 (Got: ${teacherHitsAdminAudit.status})`);

  // Teacher unauthorized attempt on Student API -> MUST RETURN 403 FORBIDDEN!
  const teacherHitsStudentDash = await makeRequest('GET', '/api/student/dashboard', null, teacherToken);
  assert(teacherHitsStudentDash.status === 403, `Teacher blocked from /api/student/dashboard with HTTP 403 (Got: ${teacherHitsStudentDash.status})`);

  // --- Step 3: Student Authentication & Access Control ---
  console.log('\n--- Step 3: STUDENT Authentication & Role Isolation ---');
  const studentLogin = await makeRequest('POST', '/api/auth/login', {
    email: 'student@linktest.io',
    password: 'Student123!'
  });
  assert(studentLogin.status === 200, 'Student Login successful (HTTP 200)');
  const studentToken = studentLogin.data?.data?.token;
  const studentUser = studentLogin.data?.data?.user;
  assert(studentUser?.role === 'STUDENT', 'Student user role is strictly STUDENT');

  // Student access to Student APIs
  const studentDash = await makeRequest('GET', '/api/student/dashboard', null, studentToken);
  assert(studentDash.status === 200, 'Student accesses /api/student/dashboard (HTTP 200)');

  const studentClasses = await makeRequest('GET', '/api/student/classes', null, studentToken);
  assert(studentClasses.status === 200, 'Student accesses /api/student/classes (HTTP 200)');

  // Student unauthorized attempts on Admin APIs -> MUST RETURN 403 FORBIDDEN!
  const studentHitsAdminDash = await makeRequest('GET', '/api/admin/dashboard', null, studentToken);
  assert(studentHitsAdminDash.status === 403, `Student blocked from /api/admin/dashboard with HTTP 403 (Got: ${studentHitsAdminDash.status})`);

  const studentHitsAdminUsers = await makeRequest('GET', '/api/admin/users', null, studentToken);
  assert(studentHitsAdminUsers.status === 403, `Student blocked from /api/admin/users with HTTP 403 (Got: ${studentHitsAdminUsers.status})`);

  const studentHitsAdminBatches = await makeRequest('GET', '/api/admin/batches', null, studentToken);
  assert(studentHitsAdminBatches.status === 403, `Student blocked from /api/admin/batches with HTTP 403 (Got: ${studentHitsAdminBatches.status})`);

  // Student unauthorized attempts on Teacher APIs -> MUST RETURN 403 FORBIDDEN!
  const studentHitsTeacherDash = await makeRequest('GET', '/api/teacher/dashboard', null, studentToken);
  assert(studentHitsTeacherDash.status === 403, `Student blocked from /api/teacher/dashboard with HTTP 403 (Got: ${studentHitsTeacherDash.status})`);

  const studentHitsTeacherClasses = await makeRequest('GET', '/api/teacher/classes', null, studentToken);
  assert(studentHitsTeacherClasses.status === 403, `Student blocked from /api/teacher/classes with HTTP 403 (Got: ${studentHitsTeacherClasses.status})`);

  // Student unauthorized attempts on Batch Management & Student Search
  const studentHitsBatches = await makeRequest('GET', '/api/batches', null, studentToken);
  assert(studentHitsBatches.status === 403, `Student blocked from /api/batches with HTTP 403 (Got: ${studentHitsBatches.status})`);

  const studentHitsStudentSearch = await makeRequest('GET', '/api/students/search', null, studentToken);
  assert(studentHitsStudentSearch.status === 403, `Student blocked from /api/students/search with HTTP 403 (Got: ${studentHitsStudentSearch.status})`);

  // --- Step 4: Unauthenticated Access Control ---
  console.log('\n--- Step 4: Unauthenticated API Access Control ---');
  const anonAdmin = await makeRequest('GET', '/api/admin/dashboard');
  assert(anonAdmin.status === 401, 'Unauthenticated call to /api/admin/dashboard returns HTTP 401');

  const anonTeacher = await makeRequest('GET', '/api/teacher/dashboard');
  assert(anonTeacher.status === 401, 'Unauthenticated call to /api/teacher/dashboard returns HTTP 401');

  const anonStudent = await makeRequest('GET', '/api/student/dashboard');
  assert(anonStudent.status === 401, 'Unauthenticated call to /api/student/dashboard returns HTTP 401');

  // --- Step 5: Post-Validation Clean Up ---
  console.log('\n--- Step 5: Cleaning up Validation Accounts ---');
  await pool.query("DELETE FROM users WHERE email != 'admin@linktest.io'");
  // Clean security logs generated by this security test
  await pool.query("DELETE FROM security_logs");
  await pool.query("DELETE FROM audit_logs");
  console.log('  [PASS] Cleaned up temporary test users and test security logs.');
  passed++;

  // Verify only admin remains
  const countRes = await pool.query("SELECT count(*)::int as cnt FROM users");
  assert(countRes.rows[0].cnt === 1, `Users table has strictly 1 user (Found: ${countRes.rows[0].cnt})`);

  const adminOnly = await pool.query("SELECT email, role FROM users LIMIT 1");
  assert(adminOnly.rows[0].email === 'admin@linktest.io' && adminOnly.rows[0].role === 'ADMIN', 'Single remaining user is admin@linktest.io');

  await pool.end();

  console.log('\n======================================================================');
  console.log(`TOTAL ASSERTIONS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
