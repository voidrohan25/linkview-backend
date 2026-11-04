import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, memoryStore } from '../src/db/index.js';
import { lmsRepository } from '../src/repositories/lmsRepository.js';

let server;
let baseUrl;
let teacherToken;
let studentToken;

describe('Assignment PDF Visibility, Study Materials & Batch Attendance Tests', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    // Login teacher
    const tLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    assert.strictEqual(tLogin.status, 200);
    teacherToken = (await tLogin.json()).data.token;

    // Login student
    const sLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    assert.strictEqual(sLogin.status, 200);
    studentToken = (await sLogin.json()).data.token;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('1. Query token authentication allows direct preview and download of uploaded files', async () => {
    // 1. Upload a file via POST /api/upload using multipart/form-data
    const blob = new Blob(['%PDF-1.4 test assignment content'], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', blob, 'test-submission.pdf');
    formData.append('category', 'submissions');

    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${studentToken}`
      },
      body: formData
    });
    assert.strictEqual(uploadRes.status, 201);
    const uploadData = await uploadRes.json();
    assert.strictEqual(uploadData.success, true);
    assert.ok(uploadData.data.url, 'Upload should return url');

    const uploadedUrl = uploadData.data.url; // e.g. /api/upload/files/submissions/<filename>
    const filename = uploadedUrl.split('/').pop();

    // 2. Unauthenticated request should be rejected (401)
    const unauthRes = await fetch(`${baseUrl}/api/upload/files/submissions/${filename}`);
    assert.strictEqual(unauthRes.status, 401);

    // 3. Query param token allows view
    const viewRes = await fetch(`${baseUrl}/api/upload/files/submissions/${filename}?token=${teacherToken}`);
    assert.strictEqual(viewRes.status, 200);
    const viewText = await viewRes.text();
    assert.strictEqual(viewText, '%PDF-1.4 test assignment content');

    // 4. Query param token + download=true sends attachment
    const downloadRes = await fetch(`${baseUrl}/api/upload/files/submissions/${filename}?token=${studentToken}&download=true`);
    assert.strictEqual(downloadRes.status, 200);
    const disposition = downloadRes.headers.get('content-disposition');
    assert.ok(disposition && disposition.includes('attachment'), 'Should have attachment disposition');
  });

  test('2. Student assignment submission preserves file_path and file_name, visible to teacher and student', async () => {
    const assignmentId = 'assign-001';
    const fakeFilePath = '/api/upload/files/submissions/solution-demo.pdf';
    const fakeFileName = 'solution-demo.pdf';

    // Student submits assignment
    const submitRes = await fetch(`${baseUrl}/api/student/assignments/${assignmentId}/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${studentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Completed project with PDF report attached.',
        file_path: fakeFilePath,
        file_name: fakeFileName
      })
    });
    assert.strictEqual(submitRes.status, 200);
    const submitBody = await submitRes.json();
    assert.strictEqual(submitBody.success, true);
    assert.strictEqual(submitBody.data.file_path, fakeFilePath);
    assert.strictEqual(submitBody.data.file_name, fakeFileName);

    // Student queries assignments - submission details should be joined
    const sAsgnRes = await fetch(`${baseUrl}/api/student/assignments`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(sAsgnRes.status, 200);
    const sAsgnBody = await sAsgnRes.json();
    const myAsgn = sAsgnBody.data.find(a => a.id === assignmentId);
    assert.ok(myAsgn, 'Student should see assignment');
    assert.strictEqual(myAsgn.submission_status, 'submitted');
    assert.strictEqual(myAsgn.file_path, fakeFilePath);
    assert.strictEqual(myAsgn.file_name, fakeFileName);

    // Teacher gets submissions for assignment
    const tSubRes = await fetch(`${baseUrl}/api/teacher/assignments/${assignmentId}/submissions`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(tSubRes.status, 200);
    const tSubBody = await tSubRes.json();
    const submission = tSubBody.data.find(s => s.assignment_id === assignmentId && (s.student_id === 'user-student-001' || s.student_name === 'Aarav Sharma'));
    assert.ok(submission, 'Teacher must see the submission');
    assert.strictEqual(submission.file_path, fakeFilePath);
    assert.strictEqual(submission.file_name, fakeFileName);

    // Teacher grades submission
    const gradeRes = await fetch(`${baseUrl}/api/teacher/submissions/${submission.id}/grade`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        marks_obtained: 95,
        feedback: 'Excellent PDF presentation and thorough solutions.'
      })
    });
    assert.strictEqual(gradeRes.status, 200);
    const gradeBody = await gradeRes.json();
    assert.strictEqual(gradeBody.success, true);
    assert.strictEqual(gradeBody.data.status, 'graded');
    assert.strictEqual(gradeBody.data.marks_obtained, 95);
  });

  test('3. Teacher publishes batch study material and enrolled student can retrieve it', async () => {
    // Teacher creates study material targeted to batch-cs-a1
    const createRes = await fetch(`${baseUrl}/api/teacher/materials`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Batch CS A1 Data Structures Lecture Notes',
        description: 'Comprehensive study handout on Trees and Graphs',
        type: 'pdf',
        file_path: '/api/upload/files/materials/trees-and-graphs.pdf',
        file_name: 'trees-and-graphs.pdf',
        file_size: 2048576,
        class_id: 'class-cs-a',
        batch_id: 'batch-cs-a1',
        subject_id: 'sub-cs-101'
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createBody = await createRes.json();
    assert.strictEqual(createBody.success, true);
    assert.strictEqual(createBody.data.title, 'Batch CS A1 Data Structures Lecture Notes');

    // Student (enrolled in batch-cs-a1) queries study materials
    const sMatRes = await fetch(`${baseUrl}/api/student/materials`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(sMatRes.status, 200);
    const sMatBody = await sMatRes.json();
    const batchMaterial = sMatBody.data.find(m => m.id === createBody.data.id || m.title === 'Batch CS A1 Data Structures Lecture Notes');
    assert.ok(batchMaterial, 'Student enrolled in batch must have access to batch study material');
    assert.strictEqual(batchMaterial.file_path, '/api/upload/files/materials/trees-and-graphs.pdf');
  });

  test('4. Batch-wise attendance isolation preserves records per batch', async () => {
    const testDate = '2027-03-10';

    // Mark attendance for batch-cs-a1 (student-001)
    const markRes1 = await fetch(`${baseUrl}/api/teacher/attendance`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        batch_id: 'batch-cs-a1',
        date: testDate,
        records: [
          { student_id: 'user-student-001', status: 'present', remarks: 'On time in CS A1' }
        ]
      })
    });
    assert.strictEqual(markRes1.status, 200);

    // Query attendance for batch-cs-a1 on testDate
    const getRes1 = await fetch(`${baseUrl}/api/teacher/attendance?batchId=batch-cs-a1&date=${testDate}`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(getRes1.status, 200);
    const getBody1 = await getRes1.json();
    const s1Record = getBody1.data.find(r => r.student_id === 'user-student-001' && r.batch_id === 'batch-cs-a1');
    assert.ok(s1Record, 'Attendance record for batch-cs-a1 must exist');
    assert.strictEqual(s1Record.status, 'present');

    // Query unrecorded date for batch-cs-a1 -> should be empty
    const unrecordedDate = '2027-03-25';
    const getUnrecRes = await fetch(`${baseUrl}/api/teacher/attendance?batchId=batch-cs-a1&date=${unrecordedDate}`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(getUnrecRes.status, 200);
    const unrecBody = await getUnrecRes.json();
    assert.strictEqual(unrecBody.data.length, 0, 'Unmarked date should return 0 records without auto-inserting');
  });
});
