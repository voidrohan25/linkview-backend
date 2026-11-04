import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

let server;
let baseUrl;
let teacherToken = null;

describe('Issue #27: File Upload API Security Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Authenticate Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const teacherData = await teacherRes.json();
    assert.strictEqual(teacherRes.status, 200);
    teacherToken = teacherData.data.token;
  });

  after(() => {
    if (server) server.close();
  });

  test('AC 4: Unauthenticated upload attempts receive HTTP 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 401);
  });

  test('AC 1: Authenticated user can upload allowed file formats (e.g. PDF/PNG/TXT/ZIP) up to 15MB', async () => {
    const formData = new FormData();
    const pdfBlob = new Blob(['%PDF-1.4 sample pdf content for LinkTest'], { type: 'application/pdf' });
    formData.append('file', pdfBlob, 'lecture_notes.pdf');
    formData.append('category', 'materials');

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`
      },
      body: formData
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.data.filename);
    assert.strictEqual(data.data.category, 'materials');
    assert.strictEqual(data.data.mime_type, 'application/pdf');

    // Verify file can be retrieved via the returned URL
    const getRes = await fetch(`${baseUrl}${data.data.url}`, {
      headers: {
        'Authorization': `Bearer ${teacherToken}`
      }
    });
    assert.strictEqual(getRes.status, 200);
    const downloadedText = await getRes.text();
    assert.strictEqual(downloadedText, '%PDF-1.4 sample pdf content for LinkTest');
  });

  test('AC 2: Executable file uploads (.exe, .sh, .bat, .js) are rejected with HTTP 400 DISALLOWED_FILE_TYPE', async () => {
    const maliciousFiles = [
      { name: 'payload.exe', content: 'MZ executable binary', type: 'application/x-msdownload' },
      { name: 'script.sh', content: '#!/bin/bash\nrm -rf /', type: 'application/x-sh' },
      { name: 'malicious.bat', content: '@echo off\ndel /f /s /q c:\\', type: 'text/plain' },
      { name: 'exploit.js', content: 'process.exit(1);', type: 'application/javascript' }
    ];

    for (const f of maliciousFiles) {
      const formData = new FormData();
      const blob = new Blob([f.content], { type: f.type });
      formData.append('file', blob, f.name);
      formData.append('category', 'materials');

      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${teacherToken}`
        },
        body: formData
      });

      assert.strictEqual(res.status, 400, `Must reject ${f.name} with HTTP 400`);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(
        data.error.code,
        'DISALLOWED_FILE_TYPE',
        `Error code must be DISALLOWED_FILE_TYPE for ${f.name}`
      );
    }
  });

  test('AC 3: File retrieval prevents path traversal returning HTTP 400 or 403', async () => {
    const traversalAttempts = [
      '..%2F..%2Fetc%2Fpasswd',
      '..%2F..%2F..%2Fpackage.json',
      '..%5C..%5Cwindows%5Csystem32%5Ccmd.exe',
      '....//....//etc/shadow'
    ];

    for (const payload of traversalAttempts) {
      const res = await fetch(`${baseUrl}/api/upload/files/materials/${payload}`, {
        headers: {
          'Authorization': `Bearer ${teacherToken}`
        }
      });

      assert.ok(
        res.status === 400 || res.status === 403 || res.status === 404,
        `Path traversal payload ${payload} must be blocked (status: ${res.status})`
      );

      if (res.status === 403 || res.status === 400) {
        const data = await res.json();
        assert.strictEqual(data.success, false);
      }
    }
  });
});
