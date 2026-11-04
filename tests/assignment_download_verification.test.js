import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

let server;
let baseUrl;
let teacherToken;
let studentToken;

describe('Assignment File Download & Security Verification Suite', () => {
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

  test('1. Student submits PDF assignment; teacher downloads it with matching SHA-256 hash and original filename', async () => {
    const originalPdfContent = '%PDF-1.5 %Binary Data for Calculus Homework\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
    const originalHash = crypto.createHash('sha256').update(originalPdfContent).digest('hex');

    // Student uploads PDF file
    const blob = new Blob([originalPdfContent], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', blob, 'Calculus_Homework_Chapter3.pdf');
    formData.append('category', 'submissions');

    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${studentToken}` },
      body: formData
    });
    assert.strictEqual(uploadRes.status, 201);
    const uploadJson = await uploadRes.json();
    assert.strictEqual(uploadJson.success, true);
    const uploadedUrl = uploadJson.data.url;
    const safeFilename = uploadedUrl.split('/').pop();

    // Student submits assignment with the uploaded file
    const submitRes = await fetch(`${baseUrl}/api/student/assignments/assign-001/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${studentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Calculus assignment solutions attached.',
        file_path: uploadedUrl,
        file_name: 'Calculus_Homework_Chapter3.pdf'
      })
    });
    assert.strictEqual(submitRes.status, 200);

    // Teacher inspects submissions list
    const subsRes = await fetch(`${baseUrl}/api/teacher/assignments/assign-001/submissions`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(subsRes.status, 200);
    const subsJson = await subsRes.json();
    const submission = subsJson.data.find(s => s.file_name === 'Calculus_Homework_Chapter3.pdf');
    assert.ok(submission, 'Teacher should find student submission in roster');

    // Teacher downloads the file using the download endpoint with filename query
    const downloadRes = await fetch(`${baseUrl}/api/upload/files/submissions/${safeFilename}?download=true&filename=${encodeURIComponent(submission.file_name)}`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(downloadRes.status, 200);

    // Verify response is NOT HTML (e.g. index.html)
    const contentType = downloadRes.headers.get('content-type') || '';
    assert.ok(!contentType.includes('text/html'), `Content-Type must not be text/html, was ${contentType}`);

    // Verify Content-Disposition has attachment and preserves original student filename
    const disposition = downloadRes.headers.get('content-disposition') || '';
    assert.ok(disposition.includes('attachment'), 'Content-Disposition must be attachment');
    assert.ok(disposition.includes('Calculus_Homework_Chapter3.pdf'), `Content-Disposition must preserve original filename: ${disposition}`);

    // Verify downloaded byte contents and SHA-256 match exactly
    const downloadedBuffer = Buffer.from(await downloadRes.arrayBuffer());
    const downloadedHash = crypto.createHash('sha256').update(downloadedBuffer).digest('hex');
    assert.strictEqual(downloadedHash, originalHash, 'Downloaded file content SHA-256 must match original student upload');
    assert.strictEqual(downloadedBuffer.length, Buffer.byteLength(originalPdfContent), 'Byte length must match exactly');
  });

  test('2. Multi-format support: Teacher downloads DOCX, PNG, and ZIP submissions with content integrity', async () => {
    const testCases = [
      {
        fileName: 'Algorithm_Analysis.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: 'PK\x03\x04 fake docx binary data header test payload'
      },
      {
        fileName: 'Circuit_Diagram.png',
        mimeType: 'image/png',
        content: '\x89PNG\r\n\x1a\n fake png image binary data'
      },
      {
        fileName: 'Project_Source.zip',
        mimeType: 'application/zip',
        content: 'PK\x03\x04\x14\x00 fake zip binary archive data'
      }
    ];

    for (const tc of testCases) {
      const originalHash = crypto.createHash('sha256').update(tc.content).digest('hex');

      const blob = new Blob([tc.content], { type: tc.mimeType });
      const formData = new FormData();
      formData.append('file', blob, tc.fileName);
      formData.append('category', 'submissions');

      const uploadRes = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${studentToken}` },
        body: formData
      });
      assert.strictEqual(uploadRes.status, 201);
      const uploadJson = await uploadRes.json();
      const safeFilename = uploadJson.data.url.split('/').pop();

      // Download file via query token (used for direct browser tab downloads)
      const downloadRes = await fetch(`${baseUrl}/api/upload/files/submissions/${safeFilename}?token=${teacherToken}&download=true&filename=${encodeURIComponent(tc.fileName)}`);
      assert.strictEqual(downloadRes.status, 200);

      const contentType = downloadRes.headers.get('content-type') || '';
      assert.ok(!contentType.includes('text/html'), `Content-Type for ${tc.fileName} must not be text/html`);

      const disposition = downloadRes.headers.get('content-disposition') || '';
      assert.ok(disposition.includes('attachment'), 'Content-Disposition must be attachment');
      assert.ok(disposition.includes(tc.fileName), `Content-Disposition must contain original filename ${tc.fileName}`);

      const downloadedBuffer = Buffer.from(await downloadRes.arrayBuffer());
      const downloadedHash = crypto.createHash('sha256').update(downloadedBuffer).digest('hex');
      assert.strictEqual(downloadedHash, originalHash, `SHA-256 hash must match for ${tc.fileName}`);
    }
  });

  test('3. Missing files, unauthorized access, and directory traversal return structured errors, NOT index.html', async () => {
    // 1. Missing file returns JSON 404 (not HTML)
    const missingRes = await fetch(`${baseUrl}/api/upload/files/submissions/non-existent-file-12345.pdf?download=true`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.strictEqual(missingRes.status, 404);
    const missingType = missingRes.headers.get('content-type') || '';
    assert.ok(missingType.includes('application/json'), 'Missing file error must be JSON');
    const missingBody = await missingRes.json();
    assert.strictEqual(missingBody.error.code, 'FILE_NOT_FOUND');

    // 2. Unauthenticated request returns 401
    const unauthRes = await fetch(`${baseUrl}/api/upload/files/submissions/any-file.pdf`);
    assert.strictEqual(unauthRes.status, 401);

    // 3. Path traversal attempt returns 403
    const traversalRes = await fetch(`${baseUrl}/api/upload/files/submissions/%2E%2E%2F..%2Fpackage.json?token=${teacherToken}`);
    assert.strictEqual(traversalRes.status, 403);
    const traversalBody = await traversalRes.json();
    assert.strictEqual(traversalBody.error.code, 'FORBIDDEN');
  });
});

