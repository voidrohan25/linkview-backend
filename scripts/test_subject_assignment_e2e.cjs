const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function login(email, password) {
  const res = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email, password });

  const token = res.body?.data?.token || res.body?.token;
  if (res.status !== 200 || !token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return token;
}

async function runTests() {
  console.log('--- STARTING SUBJECT ASSIGNMENT E2E VERIFICATION ---');

  // Ensure test teacher B exists
  try {
    const { Pool } = require('pg');
    const bcrypt = require('bcryptjs');
    require('dotenv').config();
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const hash = await bcrypt.hash('Teacher123!', 10);
    await pool.query(`
      INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, auth_provider)
      VALUES ('user-teacher-002', 'Dr. Ananya Roy', 'ananya@linktest.io', $1, 'TEACHER', 'active', true, 'local')
      ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'TEACHER', status = 'active', email_verified = true
    `, [hash]);
    await pool.end();
  } catch (e) {
    // ignore
  }

  // 1. Authenticate users
  const adminToken = await login('admin@linktest.io', 'Admin123!');
  console.log('✓ Admin authenticated');

  const teacherAToken = await login('teacher@linktest.io', 'Teacher123!');
  console.log('✓ Teacher A authenticated (teacher@linktest.io)');

  const teacherBToken = await login('ananya@linktest.io', 'Teacher123!');
  console.log('✓ Teacher B authenticated (ananya@linktest.io)');

  const studentToken = await login('student@linktest.io', 'Student123!');
  console.log('✓ Student authenticated (student@linktest.io)');

  // 2. Fetch seed subjects, batches, and teachers
  const subjectsRes = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/admin/subjects',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const subjects = subjectsRes.body?.data?.subjects || subjectsRes.body?.data || subjectsRes.body;

  const batchesRes = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/batches',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const batches = batchesRes.body?.data?.batches || batchesRes.body?.data || batchesRes.body;

  const teachersRes = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/admin/teachers',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const teachers = teachersRes.body?.data?.teachers || teachersRes.body?.data || teachersRes.body;

  if (!subjects || subjects.length < 2) {
    const sRes = await request({
      hostname: 'localhost',
      port: 8081,
      path: '/api/admin/subjects',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
    }, { name: 'Advanced Algorithms', code: `CS${Date.now()}` });
    const newSub = sRes.body?.data?.subject || sRes.body?.data;
    if (newSub) subjects.push(newSub);
  }

  if (!batches || batches.length < 2) {
    for (let i = 1; i <= 2; i++) {
      const bRes = await request({
        hostname: 'localhost',
        port: 8081,
        path: '/api/batches',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
      }, {
        name: `Cohort Alpha ${i}`,
        code: `E2E-BATCH-${i}-${Date.now()}`,
        start_date: new Date().toISOString(),
        end_date: new Date(Date.now() + 864000000).toISOString()
      });
      const newB = bRes.body?.data?.batch || bRes.body?.data;
      if (newB) batches.push(newB);
    }
  }

  console.log(`Loaded: ${subjects.length} subjects, ${batches.length} batches, ${teachers.length} teachers`);

  // Identify test entities
  const subjectA = subjects[0]; // e.g. Thermodynamics or Mathematics
  const subjectB = subjects[1]; // e.g. Physics or Fluid Mechanics
  const batchA = batches[0];
  const batchB = batches[1] || batches[0];
  const teacherA = teachers.find(t => t.email === 'teacher@linktest.io') || teachers[0];
  const teacherB = teachers.find(t => t.email === 'ananya@linktest.io') || teachers[1];
  const teacherC = teachers.find(t => t.id !== teacherA.id && t.id !== teacherB.id) || teachers[0];

  console.log('Subject A:', subjectA.id, subjectA.name);
  console.log('Subject B:', subjectB.id, subjectB.name);
  console.log('Batch A:', batchA.id, batchA.name);
  console.log('Batch B:', batchB.id, batchB.name);
  console.log('Teacher A:', teacherA.id, teacherA.full_name);
  console.log('Teacher B:', teacherB.id, teacherB.full_name);
  console.log('Teacher C:', teacherC.id, teacherC.full_name);

  // Helper for assignment
  async function assign(subId, tId, bId, token = adminToken) {
    return await request({
      hostname: 'localhost',
      port: 8081,
      path: '/api/admin/teachers/assignments',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      }
    }, {
      subject_id: subId,
      teacher_id: tId,
      batch_id: bId
    });
  }

  // Clean up any existing assignments between these test items first
  const existingAssignRes = await request({
    hostname: 'localhost',
    port: 8081,
    path: `/api/admin/batches/${batchA.id}/assignments`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const existingListA = existingAssignRes.body?.data?.assignments || existingAssignRes.body?.data || [];
  for (const asg of (Array.isArray(existingListA) ? existingListA : [])) {
    await request({
      hostname: 'localhost',
      port: 8081,
      path: `/api/admin/teachers/assignments/${asg.id}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
  }
  if (batchB.id !== batchA.id) {
    const existingAssignB = await request({
      hostname: 'localhost',
      port: 8081,
      path: `/api/admin/batches/${batchB.id}/assignments`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const existingListB = existingAssignB.body?.data?.assignments || existingAssignB.body?.data || [];
    for (const asg of (Array.isArray(existingListB) ? existingListB : [])) {
      await request({
        hostname: 'localhost',
        port: 8081,
        path: `/api/admin/teachers/assignments/${asg.id}`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
    }
  }

  // --- CASE 1: Subject A → Teacher A → Batch A ---
  console.log('\n--- CASE 1: Subject A → Teacher A → Batch A ---');
  const resCase1 = await assign(subjectA.id, teacherA.id, batchA.id);
  console.log('Status:', resCase1.status, 'Response:', JSON.stringify(resCase1.body));
  if (resCase1.status !== 201) throw new Error(`CASE 1 failed: HTTP ${resCase1.status}`);
  const assignment1 = resCase1.body.data?.assignment || resCase1.body.data;
  console.log('✓ CASE 1 Passed! Assignment created with ID:', assignment1.id);

  // --- CASE 6: Try duplicate assignment (expect 409 Conflict) ---
  console.log('\n--- CASE 6: Try duplicate assignment ---');
  const resCase6 = await assign(subjectA.id, teacherA.id, batchA.id);
  console.log('Status:', resCase6.status, 'Response:', JSON.stringify(resCase6.body));
  if (resCase6.status !== 409) throw new Error(`CASE 6 failed: Expected 409 Conflict, got ${resCase6.status}`);
  console.log('✓ CASE 6 Passed! Duplicate assignment properly rejected with 409 Conflict');

  // --- CASE 2: Subject B → Teacher B → Batch A ---
  console.log('\n--- CASE 2: Subject B → Teacher B → Batch A ---');
  const resCase2 = await assign(subjectB.id, teacherB.id, batchA.id);
  console.log('Status:', resCase2.status, 'Response:', JSON.stringify(resCase2.body));
  if (resCase2.status !== 201) throw new Error(`CASE 2 failed: HTTP ${resCase2.status}`);
  const assignment2 = resCase2.body.data?.assignment || resCase2.body.data;
  console.log('✓ CASE 2 Passed! Assignment created with ID:', assignment2.id);

  // --- CASE 3: Subject A → Teacher B → Batch B ---
  console.log('\n--- CASE 3: Subject A → Teacher B → Batch B ---');
  const resCase3 = await assign(subjectA.id, teacherB.id, batchB.id);
  console.log('Status:', resCase3.status, 'Response:', JSON.stringify(resCase3.body));
  if (resCase3.status !== 201) throw new Error(`CASE 3 failed: HTTP ${resCase3.status}`);
  const assignment3 = resCase3.body.data?.assignment || resCase3.body.data;
  console.log('✓ CASE 3 Passed! Assignment created with ID:', assignment3.id);

  // --- CASE 7: Teacher views dashboard ---
  console.log('\n--- CASE 7: Teacher views dashboard ---');
  // Teacher A dashboard
  const resDashA = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/teacher/dashboard',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherAToken}` }
  });
  const classesA = resDashA.body.data?.assigned_classes || [];
  console.log(`Teacher A assigned_classes (${classesA.length}):`, classesA.map(c => `${c.subject_name} -> ${c.batch_name || c.class_name} (ID: ${c.id})`));
  const teacherAHasAssignment1 = classesA.some(c => c.id === assignment1.id);
  const teacherAHasAssignment2 = classesA.some(c => c.id === assignment2.id);
  const teacherAHasAssignment3 = classesA.some(c => c.id === assignment3.id);
  if (!teacherAHasAssignment1) throw new Error('Teacher A does not see Assignment 1 in dashboard');
  if (teacherAHasAssignment2) throw new Error('Teacher A sees Assignment 2 which belongs to Teacher B! Isolation violation!');
  if (teacherAHasAssignment3) throw new Error('Teacher A sees Assignment 3 which belongs to Teacher B! Isolation violation!');
  console.log('✓ Teacher A dashboard correctly isolated: sees Assignment 1, does NOT see Teacher B assignments');

  // Teacher B dashboard
  const resDashB = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/teacher/dashboard',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherBToken}` }
  });
  const classesB = resDashB.body.data?.assigned_classes || [];
  console.log(`Teacher B assigned_classes (${classesB.length}):`, classesB.map(c => `${c.subject_name} -> ${c.batch_name || c.class_name} (ID: ${c.id})`));
  const teacherBHasAssignment2 = classesB.some(c => c.id === assignment2.id);
  const teacherBHasAssignment3 = classesB.some(c => c.id === assignment3.id);
  const teacherBHasAssignment1 = classesB.some(c => c.id === assignment1.id);
  if (!teacherBHasAssignment2) throw new Error('Teacher B does not see Assignment 2 in dashboard');
  if (!teacherBHasAssignment3) throw new Error('Teacher B does not see Assignment 3 in dashboard');
  if (teacherBHasAssignment1) throw new Error('Teacher B sees Assignment 1 which belongs to Teacher A! Isolation violation!');
  console.log('✓ Teacher B dashboard correctly isolated: sees Assignments 2 and 3, does NOT see Teacher A assignments');
  console.log('✓ CASE 7 Passed!');

  // --- CASE 4: Change Teacher A → Teacher C on Assignment 1 ---
  console.log('\n--- CASE 4: Change Teacher A → Teacher C ---');
  const resCase4 = await request({
    hostname: 'localhost',
    port: 8081,
    path: `/api/admin/teachers/assignments/${assignment1.id}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, { teacher_id: teacherC.id });
  console.log('Status:', resCase4.status, 'Response:', JSON.stringify(resCase4.body));
  if (resCase4.status !== 200) throw new Error(`CASE 4 failed: HTTP ${resCase4.status}`);
  console.log('✓ CASE 4 Passed! Teacher updated to Teacher C');

  // Verify Teacher A no longer has Assignment 1
  const resDashAAfterChange = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/teacher/dashboard',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherAToken}` }
  });
  const classesAAfterChange = resDashAAfterChange.body.data?.assigned_classes || [];
  if (classesAAfterChange.some(c => c.id === assignment1.id)) {
    throw new Error('Teacher A still sees assignment 1 after being changed to Teacher C');
  }
  console.log('✓ Teacher A dashboard correctly updated: Assignment 1 transferred away');

  // --- CASE 5: Remove assignment 1 ---
  console.log('\n--- CASE 5: Remove assignment ---');
  const resCase5 = await request({
    hostname: 'localhost',
    port: 8081,
    path: `/api/admin/teachers/assignments/${assignment1.id}`,
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('Status:', resCase5.status, 'Response:', JSON.stringify(resCase5.body));
  if (resCase5.status !== 200) throw new Error(`CASE 5 failed: HTTP ${resCase5.status}`);
  console.log('✓ CASE 5 Passed! Assignment removed');

  // --- CASE 8: Student attempts assignment API (Expect 403 Forbidden) ---
  console.log('\n--- CASE 8: Student attempts assignment API ---');
  const resCase8 = await assign(subjectA.id, teacherA.id, batchA.id, studentToken);
  console.log('Status:', resCase8.status, 'Response:', JSON.stringify(resCase8.body));
  if (resCase8.status !== 403) throw new Error(`CASE 8 failed: Expected 403 Forbidden, got ${resCase8.status}`);
  console.log('✓ CASE 8 Passed! Student blocked with 403 Forbidden');

  // --- CASE 9: Unauthorized user attempts assignment API (Expect 401 Unauthorized) ---
  console.log('\n--- CASE 9: Unauthorized user attempts assignment API ---');
  const resCase9 = await assign(subjectA.id, teacherA.id, batchA.id, null);
  console.log('Status:', resCase9.status, 'Response:', JSON.stringify(resCase9.body));
  if (resCase9.status !== 401) throw new Error(`CASE 9 failed: Expected 401 Unauthorized, got ${resCase9.status}`);
  console.log('✓ CASE 9 Passed! Unauthenticated request blocked with 401 Unauthorized');

  // --- CASE 10: Refresh browser / Verify database persistence ---
  console.log('\n--- CASE 10: Refresh browser / Persistence check ---');
  // Re-assign Subject A to Teacher A for Batch A
  const resReassign = await assign(subjectA.id, teacherA.id, batchA.id);
  if (resReassign.status !== 201) throw new Error(`Reassign failed: ${resReassign.status}`);
  const finalAssignment = resReassign.body.data?.assignment || resReassign.body.data;

  // Query batch assignments endpoint directly (equivalent to loading page / refreshing)
  const resBatchAssignments = await request({
    hostname: 'localhost',
    port: 8081,
    path: `/api/admin/batches/${batchA.id}/assignments`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const batchList = resBatchAssignments.body?.data?.assignments || resBatchAssignments.body?.data || [];
  const found = batchList.find(a => a.id === finalAssignment.id);
  if (!found) throw new Error('Persisted assignment not found on batch assignment query');
  console.log('Found in batch assignments:', found.subject_name, '->', found.teacher_name, `[Status: Assigned]`);

  // Query teacher assignments
  const resTeacherDash = await request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/teacher/dashboard',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${teacherAToken}` }
  });
  const tClasses = resTeacherDash.body.data?.assigned_classes || [];
  const tFound = tClasses.find(c => c.id === finalAssignment.id);
  if (!tFound) throw new Error('Persisted assignment not found on teacher dashboard query');
  console.log('Found in teacher dashboard:', tFound.subject_name, 'in batch', tFound.batch_name || tFound.class_name);
  console.log('✓ CASE 10 Passed! Persistence fully verified');

  console.log('\n==================================================');
  console.log('ALL 10 TEST CASES PASSED SUCCESSFULLY!');
  console.log('==================================================');
}

runTests().catch(err => {
  console.error('TEST RUNNER FAILED:', err);
  process.exit(1);
});
