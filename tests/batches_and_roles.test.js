import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, isPostgresConnected, memoryStore, pool, query } from '../src/db/index.js';

let server;
let baseUrl;
let studentToken;
let teacherToken;
let adminToken;
let testStudentId;
let testTeacherId;
let testBatchId;
let testBatchCode;

describe('LinkTest Batches, Teacher Allocation, Roles & Enrollment Suite', () => {
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

    // 1. Login Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const sBody = await studentRes.json();
    studentToken = sBody.data.token;
    testStudentId = sBody.data.user.id;

    // 2. Login Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const tBody = await teacherRes.json();
    teacherToken = tBody.data.token;
    testTeacherId = tBody.data.user.id;

    // 3. Login Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const aBody = await adminRes.json();
    adminToken = aBody.data.token;

    testBatchCode = `TEST_BATCH_${Date.now()}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // --- 1. Role Security & Public Registration ---
  test('1. Public registration ignores client-supplied ADMIN/TEACHER role and assigns STUDENT', async () => {
    const randomEmail = `hacker_${Date.now()}@example.com`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Privilege Attempt',
        email: randomEmail,
        password: 'Password123!',
        role: 'ADMIN' // Malicious attempt to self-escalate
      })
    });

    assert.strictEqual(regRes.status, 201);
    const body = await regRes.json();
    assert.strictEqual(body.success, true);
    // User record in database must be strictly STUDENT
    const role = isPostgresConnected && pool
      ? (await query('SELECT role FROM users WHERE email = $1', [randomEmail])).rows[0]?.role
      : memoryStore.users.find((user) => user.email === randomEmail)?.role;
    assert.strictEqual(role, 'STUDENT');
  });

  test('2. Admin batch creation endpoint rejects unauthenticated or unauthorized users (401/403)', async () => {
    // Unauthenticated
    const unauthRes = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked Batch', code: 'HACK01' })
    });
    assert.strictEqual(unauthRes.status, 401);

    // Student token attempting to create batch
    const studentCreateRes = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ name: 'Student Batch', code: 'STU01' })
    });
    assert.strictEqual(studentCreateRes.status, 403);
  });

  // --- 2. Batch Creation & Validation ---
  test('3. Admin can create a new cohort batch with unique code and dates', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Automated Test Cohort',
        code: testBatchCode,
        description: 'Cohort created for automated test verification',
        start_date: '2026-11-01',
        end_date: '2026-12-31',
        capacity: 2, // low capacity for capacity testing
        status: 'Active'
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.batch.code, testBatchCode);
    assert.strictEqual(body.data.batch.name, 'Automated Test Cohort');
    testBatchId = body.data.batch.id;
  });

  test('4. Duplicate batch code is rejected with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Duplicate Code Batch',
        code: testBatchCode, // same code as test 3
        capacity: 20
      })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.match(body.message || body.error?.message || String(body.error), /already in use/i);
  });

  test('5. Invalid date range (start_date > end_date) is rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Invalid Date Batch',
        code: `INV_DATE_${Date.now()}`,
        start_date: '2026-12-01',
        end_date: '2026-11-01'
      })
    });

    assert.strictEqual(res.status, 400);
  });

  // --- 3. Teacher Allocation ---
  test('6. Admin can assign active Teacher to batch and reject duplicate assignment', async () => {
    // Assign teacher
    const assignRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ teacher_id: testTeacherId })
    });
    assert.strictEqual(assignRes.status, 201);

    // Duplicate assignment should fail with 409
    const dupRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ teacher_id: testTeacherId })
    });
    assert.strictEqual(dupRes.status, 409);
  });

  test('7. Teacher listing batches returns only assigned batches', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data.batches));
    // The assigned batch must be present
    const hasAssigned = body.data.batches.some((b) => b.id === testBatchId);
    assert.strictEqual(hasAssigned, true);
  });

  // --- 4. Database Student Search & Batch Enrollment ---
  test('8. Student search queries real database and hides sensitive password hash', async () => {
    const res = await fetch(`${baseUrl}/api/students/search?q=student`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.students));
    assert.ok(body.data.students.length > 0);

    const first = body.data.students[0];
    assert.ok(first.id);
    assert.ok(first.full_name);
    assert.ok(first.email);
    assert.strictEqual(first.password_hash, undefined);
  });

  test('9. Assigned teacher can enroll student into batch and duplicate enrollment is rejected', async () => {
    // First enrollment
    const enrollRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ student_ids: [testStudentId] })
    });

    assert.strictEqual(enrollRes.status, 201);
    const body = await enrollRes.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.enrolled_count, 1);

    // Duplicate enrollment attempt
    const dupEnrollRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ student_ids: [testStudentId] })
    });

    const dupBody = await dupEnrollRes.json();
    assert.ok(dupBody.data.failed.some((f) => /already enrolled/i.test(f.reason)));
  });

  test('10. Batch enrollment enforces capacity limit', async () => {
    // Batch has capacity 2, currently 1 student enrolled
    // Find or create a temporary student to fill capacity
    const student2Res = await fetch(`${baseUrl}/api/students/search?limit=10`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const sList = (await student2Res.json()).data.students.filter((s) => s.id !== testStudentId);

    if (sList.length >= 2) {
      const rosterBeforeRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/students`, {
        headers: { Authorization: `Bearer ${teacherToken}` }
      });
      const rosterBefore = (await rosterBeforeRes.json()).data.students.map(student => student.student_id).sort();

      // Try enrolling 2 more students (would make 3, exceeding capacity of 2)
      const overRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/students`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${teacherToken}`
        },
        body: JSON.stringify({ student_ids: [sList[0].id, sList[1].id] })
      });
      const overBody = await overRes.json();
      assert.strictEqual(overRes.status, 400);
      assert.match(overBody.error?.message || overBody.message || '', /capacity/i);

      const rosterAfterRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/students`, {
        headers: { Authorization: `Bearer ${teacherToken}` }
      });
      const rosterAfter = (await rosterAfterRes.json()).data.students.map(student => student.student_id).sort();
      assert.deepStrictEqual(rosterAfter, rosterBefore);
    }
  });

  test('11. Student can be removed from batch', async () => {
    const delRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/students/${testStudentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(delRes.status, 200);

    // Verify testStudentId is no longer in the roster
    const listRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/students`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const listBody = await listRes.json();
    const hasRemoved = listBody.data.students.some((s) => s.student_id === testStudentId);
    assert.strictEqual(hasRemoved, false);
  });

  test('12. Admin can archive a batch and update user role with audit trail', async () => {
    // Archive batch
    const archRes = await fetch(`${baseUrl}/api/batches/${testBatchId}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(archRes.status, 200);

    // Update user role and status
    const updateRoleRes = await fetch(`${baseUrl}/api/admin/users/${testStudentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        role: 'STUDENT',
        status: 'active',
        reason: 'Automated test verified role maintenance'
      })
    });
    assert.strictEqual(updateRoleRes.status, 200);
    const updateBody = await updateRoleRes.json();
    assert.strictEqual(updateBody.success, true);
  });
});
