import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, pool, isPostgresConnected, memoryStore } from '../src/db/index.js';
import { livekitService } from '../src/services/livekitService.js';
import crypto from 'crypto';

let server;
let baseUrl;

describe('LinkTest Phase 2 & 5: LiveKit Live Lectures & Batch Allocation E2E Suite', () => {
  let adminToken = '';
  let teacherToken = '';
  let studentToken = '';
  let teacherId = '';
  let studentId = '';
  let testBatchId = '';
  let liveSessionId = '';

  const rand = crypto.randomUUID().slice(0, 6);
  const teacherEmail = `livekit_teacher_${rand}@test.com`;
  const studentEmail = `livekit_student_${rand}@test.com`;
  const adminEmail = `livekit_admin_${rand}@test.com`;

  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    livekitService.serverUrl = 'wss://test.livekit.cloud';
    livekitService.apiKey = 'test-livekit-key';
    livekitService.apiSecret = 'test-livekit-secret';
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Register & verify Admin
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'LiveKit Admin User',
        email: adminEmail,
        password: 'Password123!'
      })
    });
    if (isPostgresConnected && pool) {
      await pool.query("UPDATE users SET role = 'ADMIN', email_verified = true WHERE email = $1", [adminEmail]);
    } else {
      const u = (memoryStore.users || []).find(user => user.email === adminEmail);
      if (u) { u.role = 'ADMIN'; u.email_verified = true; }
    }
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'Password123!' })
    });
    const aData = await adminLogin.json();
    adminToken = aData.data?.token || aData.token;

    // 2. Register & verify Teacher
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Prof. LiveKit Teacher',
        email: teacherEmail,
        password: 'Password123!'
      })
    });
    if (isPostgresConnected && pool) {
      const uRes = await pool.query("UPDATE users SET role = 'TEACHER', email_verified = true WHERE email = $1 RETURNING id", [teacherEmail]);
      teacherId = uRes.rows[0]?.id;
    } else {
      const u = (memoryStore.users || []).find(user => user.email === teacherEmail);
      if (u) { u.role = 'TEACHER'; u.email_verified = true; teacherId = u.id; }
    }
    const teacherLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: teacherEmail, password: 'Password123!' })
    });
    const tData = await teacherLogin.json();
    teacherToken = tData.data?.token || tData.token;
    if (!teacherId) teacherId = tData.data?.user?.id;

    // 3. Register & verify Student
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'LiveKit Student Learner',
        email: studentEmail,
        password: 'Password123!'
      })
    });
    if (isPostgresConnected && pool) {
      const sRes = await pool.query("UPDATE users SET role = 'STUDENT', email_verified = true WHERE email = $1 RETURNING id", [studentEmail]);
      studentId = sRes.rows[0]?.id;
    } else {
      const u = (memoryStore.users || []).find(user => user.email === studentEmail);
      if (u) { u.role = 'STUDENT'; u.email_verified = true; studentId = u.id; }
    }
    const studentLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: studentEmail, password: 'Password123!' })
    });
    const sData = await studentLogin.json();
    studentToken = sData.data?.token || sData.token;
    if (!studentId) studentId = sData.data?.user?.id;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (isPostgresConnected && pool) {
      if (liveSessionId) {
        await pool.query('DELETE FROM attendance_records WHERE remarks LIKE $1', [`%${liveSessionId}%`]).catch(() => {});
        await pool.query('DELETE FROM live_class_sessions WHERE id = $1', [liveSessionId]).catch(() => {});
      }
      if (testBatchId) {
        await pool.query('DELETE FROM batch_teachers WHERE batch_id = $1', [testBatchId]).catch(() => {});
        await pool.query('DELETE FROM batch_enrollments WHERE batch_id = $1', [testBatchId]).catch(() => {});
        await pool.query('DELETE FROM batches WHERE id = $1', [testBatchId]).catch(() => {});
      }
      await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [adminEmail, teacherEmail, studentEmail]).catch(() => {});
    }
  });

  test('1. LiveKit Health: GET /api/livekit/status returns configured: true and LiveKit provider', async () => {
    const res = await fetch(`${baseUrl}/api/livekit/status`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.configured, true);
    assert.equal(body.data.provider, 'livekit');
    assert.ok(body.data.serverUrl.includes('livekit.cloud'));
  });

  test('2. Admin Batch Flow: Create batch in PostgreSQL with persistence', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: `Quantum Physics Cohort ${rand}`,
        code: `QP-${rand}`.toUpperCase(),
        capacity: 35,
        status: 'Active',
        description: 'Advanced quantum mechanics and live experiments.'
      })
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.ok(body.data.batch?.id);
    testBatchId = body.data.batch.id;
    assert.equal(body.data.batch.capacity, 35);
  });

  test('3. Admin Allocation: Assign teacher to batch', async () => {
    const res = await fetch(`${baseUrl}/api/batches/${testBatchId}/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ teacher_id: teacherId })
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.success, true);
  });

  test('4. Admin Enrollment: Enroll student into batch', async () => {
    const res = await fetch(`${baseUrl}/api/batches/${testBatchId}/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ student_ids: [studentId] })
    });
    const body = await res.json();
    assert.ok([200, 201].includes(res.status), `Expected 200 or 201, got ${res.status}`);
    assert.equal(body.success, true);
    assert.ok(body.data.enrolled_count >= 1);
  });

  test('5. Teacher Visibility: Teacher sees their assigned batch on GET /api/batches', async () => {
    const res = await fetch(`${baseUrl}/api/batches`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const assigned = body.data.batches.find((b) => b.id === testBatchId);
    assert.ok(assigned, 'Teacher must see assigned batch');
    assert.equal(assigned.enrolled_count, 1);
  });

  test('6. Schedule Live Lecture: Teacher schedules lecture WITHOUT requiring Zoom URL', async () => {
    const scheduledTime = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`${baseUrl}/api/teacher/live-classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: `Quantum Teleportation Lecture ${rand}`,
        description: 'Comprehensive derivation and LiveKit discussion',
        batch_id: testBatchId,
        scheduled_at: scheduledTime
      })
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.ok(body.data?.id);
    liveSessionId = body.data.id;
    assert.equal(body.data.meeting_provider, 'livekit');
    assert.equal(body.data.status, 'scheduled');
  });

  test('7. Teacher Launches Classroom: Receives LiveKit WebRTC token & status becomes "ongoing"', async () => {
    const res = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ sessionId: liveSessionId })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.data.token, 'LiveKit WebRTC token must be generated');
    assert.equal(body.data.roomName, `lecture-${liveSessionId}`);
    assert.ok(body.data.serverUrl.includes('livekit.cloud'));

    // Check that session status transitioned to ongoing
    const sessionCheck = await fetch(`${baseUrl}/api/teacher/live-classes`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const checkBody = await sessionCheck.json();
    const updated = checkBody.data.find((s) => s.id === liveSessionId);
    assert.equal(updated.status, 'ongoing');
  });

  test('8. Student Joins Active Lecture: Receives LiveKit token & attendance is recorded', async () => {
    // 8a. Student can see lecture in student live classes list
    const studentList = await fetch(`${baseUrl}/api/student/live-classes`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const sListBody = await studentList.json();
    assert.equal(studentList.status, 200);
    const foundSession = sListBody.data.find((s) => s.id === liveSessionId);
    assert.ok(foundSession, 'Student must see batch live lecture');

    // 8b. Student requests token to join classroom
    const tokenRes = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ sessionId: liveSessionId })
    });
    const tBody = await tokenRes.json();
    assert.equal(tokenRes.status, 200);
    assert.equal(tBody.success, true);
    assert.ok(tBody.data.token);
    assert.equal(tBody.data.roomName, `lecture-${liveSessionId}`);

    // 8c. Attendance check in PostgreSQL
    if (isPostgresConnected && pool) {
      const att = await pool.query(
        'SELECT * FROM attendance_records WHERE student_id = $1 AND status = $2',
        [studentId, 'present']
      );
      assert.ok(att.rows.length >= 1, 'Attendance must be automatically recorded for student joining LiveKit session');
    }
  });

  test('9. Teacher Moderation: Host ends lecture for all participants', async () => {
    const endRes = await fetch(`${baseUrl}/api/teacher/live-classes/${liveSessionId}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const endBody = await endRes.json();
    assert.equal(endRes.status, 200);
    assert.equal(endBody.success, true);
    assert.equal(endBody.data.status, 'completed');
  });

  test('10. Security: Post-conclusion token requests are rejected with 400 LECTURE_ENDED', async () => {
    const res = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ sessionId: liveSessionId })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.ok(
      body.error.code === 'LECTURE_ENDED' || body.error.code === 'SESSION_CONCLUDED',
      `Expected LECTURE_ENDED or SESSION_CONCLUDED, got ${body.error?.code}`
    );
  });

  test('11. Security: Unauthenticated token request is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: liveSessionId })
    });
    assert.equal(res.status, 401);
  });

  test('12. Security & Moderation: Teacher controls student participant media and RBAC blocks students', async () => {
    // 12a. Student attempts to control participant -> must be rejected with 403 Forbidden
    const studentControlRes = await fetch(`${baseUrl}/api/livekit/sessions/${liveSessionId}/control-participant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        participantIdentity: 'student-identity-123',
        action: 'mute_mic'
      })
    });
    assert.equal(studentControlRes.status, 403, 'Student must not be allowed to control participants');

    // 12b. Authorized teacher controls participant -> succeeds with 200
    const teacherControlRes = await fetch(`${baseUrl}/api/livekit/sessions/${liveSessionId}/control-participant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        participantIdentity: studentId,
        action: 'mute_mic'
      })
    });
    const controlBody = await teacherControlRes.json();
    assert.equal(teacherControlRes.status, 200);
    assert.equal(controlBody.success, true);
    assert.equal(controlBody.data.action, 'mute_mic');

    // 12c. Teacher controls camera and screen share
    const camRes = await fetch(`${baseUrl}/api/livekit/sessions/${liveSessionId}/control-participant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        participantIdentity: studentId,
        action: 'disable_camera'
      })
    });
    assert.equal(camRes.status, 200);

    const screenRes = await fetch(`${baseUrl}/api/livekit/sessions/${liveSessionId}/control-participant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        participantIdentity: studentId,
        action: 'stop_screen_share'
      })
    });
    assert.equal(screenRes.status, 200);
  });

  test('13. Live Lectures Recency Sorting: Newest sessions are returned first', async () => {
    const listRes = await fetch(`${baseUrl}/api/teacher/live-classes`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const listBody = await listRes.json();
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listBody.data));
    if (listBody.data.length >= 2) {
      for (let i = 0; i < listBody.data.length - 1; i++) {
        const curr = new Date(listBody.data[i].started_at || listBody.data[i].created_at || 0).getTime();
        const next = new Date(listBody.data[i + 1].started_at || listBody.data[i + 1].created_at || 0).getTime();
        assert.ok(curr >= next, `Lecture at index ${i} should be more recent than index ${i + 1}`);
      }
    }
  });

  test('14. Schedule Live Lecture: Handles empty string optional IDs safely and returns enriched metadata', async () => {
    const scheduledTime = new Date(Date.now() + 7200000).toISOString();
    const res = await fetch(`${baseUrl}/api/teacher/live-classes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        title: `Relativity & Gravitation Masterclass ${rand}`,
        description: 'Deep dive into tensors and general relativity',
        batch_id: testBatchId,
        class_id: '',
        subject_id: '',
        course_id: '',
        scheduled_at: scheduledTime
      })
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.ok(body.data?.id);
    assert.equal(body.data.status, 'scheduled');
    assert.equal(body.data.class_id, null);
    assert.equal(body.data.subject_id, null);
    // Enriched batch name should be present
    assert.ok(body.data.batch_name || body.data.batch_id === testBatchId);
  });

  test('15. Live Lectures List Retrieval: Teacher immediately sees newly scheduled lecture', async () => {
    const listRes = await fetch(`${baseUrl}/api/teacher/live-classes`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const listBody = await listRes.json();
    assert.equal(listRes.status, 200);
    assert.equal(listBody.success, true);
    assert.ok(Array.isArray(listBody.data));

    const scheduled = listBody.data.find(s => s.title.includes(`Relativity & Gravitation Masterclass ${rand}`));
    assert.ok(scheduled, 'Newly scheduled lecture must appear in teacher live-classes list');
    assert.equal(scheduled.status, 'scheduled');
  });

  test('16. Empty State API Behavior: Valid empty array returned without server error', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/teacher/live-classes?status=nonexistent_status`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const emptyBody = await emptyRes.json();
    assert.equal(emptyRes.status, 200);
    assert.equal(emptyBody.success, true);
    assert.deepEqual(emptyBody.data, []);
  });
});
