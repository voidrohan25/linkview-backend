import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

let server;
let baseUrl;
let teacherToken;

describe('Bulk teacher attendance', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    assert.strictEqual(loginRes.status, 200);
    teacherToken = (await loginRes.json()).data.token;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  const attendanceHeaders = () => ({
    'Authorization': `Bearer ${teacherToken}`,
    'Content-Type': 'application/json'
  });

  test('saves and corrects a batch of attendance records', async () => {
    const attendance = {
      batch_id: 'batch-cs-a1',
      date: '2027-01-13',
      subject_id: 'sub-ds101',
      records: [
        { student_id: 'user-student-001', status: 'present', remarks: 'On time' },
        { student_id: 'user-student-002', status: 'late', remarks: 'Arrived late' }
      ]
    };
    const saveRes = await fetch(`${baseUrl}/api/teacher/attendance`, {
      method: 'POST',
      headers: attendanceHeaders(),
      body: JSON.stringify(attendance)
    });
    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual((await saveRes.json()).data.length, 2);

    const correctionRes = await fetch(`${baseUrl}/api/teacher/attendance`, {
      method: 'POST',
      headers: attendanceHeaders(),
      body: JSON.stringify({
        ...attendance,
        records: [{ student_id: 'user-student-001', status: 'excused', remarks: 'Approved leave' }]
      })
    });
    assert.strictEqual(correctionRes.status, 200);

    const readRes = await fetch(
      `${baseUrl}/api/teacher/attendance?classId=class-cs-a&batchId=batch-cs-a1&subjectId=sub-ds101&date=2027-01-13`,
      { headers: attendanceHeaders() }
    );
    assert.strictEqual(readRes.status, 200);
    const readBody = await readRes.json();
    assert.strictEqual(readBody.data.length, 2);
    assert.ok(readBody.data.every(record => record.batch_id === 'batch-cs-a1'));
    const corrected = readBody.data.find(record => record.student_id === 'user-student-001');
    assert.strictEqual(corrected.status, 'excused');
    assert.strictEqual(corrected.remarks, 'Approved leave');
  });

  test('rejects teachers without a subject assignment and students outside the batch', async () => {
    const unassignedSubjectRes = await fetch(`${baseUrl}/api/teacher/attendance`, {
      method: 'POST',
      headers: attendanceHeaders(),
      body: JSON.stringify({
        batch_id: 'batch-cs-a1',
        date: '2027-01-14',
        subject_id: 'sub-wd101',
        records: [{ student_id: 'user-student-001', status: 'present' }]
      })
    });
    assert.strictEqual(unassignedSubjectRes.status, 403);
    assert.strictEqual((await unassignedSubjectRes.json()).error.code, 'FORBIDDEN');

    const unenrolledStudentRes = await fetch(`${baseUrl}/api/teacher/attendance`, {
      method: 'POST',
      headers: attendanceHeaders(),
      body: JSON.stringify({
        batch_id: 'batch-cs-a1',
        date: '2027-01-14',
        subject_id: 'sub-ds101',
        records: [{ student_id: 'user-student-003', status: 'present' }]
      })
    });
    assert.strictEqual(unenrolledStudentRes.status, 400);
    assert.strictEqual((await unenrolledStudentRes.json()).error.code, 'STUDENT_NOT_ENROLLED');
  });

  test('rejects invalid statuses, dates, and duplicate students', async () => {
    const attendance = {
      batch_id: 'batch-cs-a1',
      date: '2027-01-15',
      subject_id: 'sub-ds101',
      records: [{ student_id: 'user-student-001', status: 'present' }]
    };
    const invalidRequests = [
      { ...attendance, records: [{ student_id: 'user-student-001', status: 'unknown' }] },
      { ...attendance, date: '2027-02-30' },
      {
        ...attendance,
        records: [
          { student_id: 'user-student-001', status: 'present' },
          { student_id: 'user-student-001', status: 'absent' }
        ]
      }
    ];

    for (const body of invalidRequests) {
      const res = await fetch(`${baseUrl}/api/teacher/attendance`, {
        method: 'POST',
        headers: attendanceHeaders(),
        body: JSON.stringify(body)
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error.code, 'VALIDATION_ERROR');
    }
  });
});
