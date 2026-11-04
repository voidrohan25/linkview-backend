import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { livekitService } from '../src/services/livekitService.js';

let server;
let baseUrl;
let teacherToken = null;
let studentToken = null;

function decodeJwtPayload(token) {
  const parts = token.split('.');
  assert.strictEqual(parts.length, 3, 'Token must be a valid JWT with 3 parts');
  const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
}

describe('Issue #25: LiveKit WebRTC Room Token Service & Status API Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    livekitService.serverUrl = 'wss://livekit.test.linktest.io';
    livekitService.apiKey = 'test-api-key-livekit';
    livekitService.apiSecret = 'test-api-secret-livekit-super-secret-key-12345';

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

    // Authenticate Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const studentData = await studentRes.json();
    assert.strictEqual(studentRes.status, 200);
    studentToken = studentData.data.token;
  });

  after(() => {
    if (server) server.close();
  });

  test('AC 4: Unauthenticated token request is rejected with HTTP 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName: 'lecture-room-101' })
    });
    assert.strictEqual(res.status, 401);
  });

  test('AC 1: Teacher receives room token with publish permissions (canPublish: true)', async () => {
    const roomName = 'lecture-physics-101';
    const res = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ roomName })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.data.token, 'Must return signed LiveKit JWT');
    assert.strictEqual(data.data.roomName, roomName);

    const claims = decodeJwtPayload(data.data.token);
    assert.strictEqual(claims.iss, 'test-api-key-livekit');
    assert.ok(claims.video, 'Must include video grant');
    assert.strictEqual(claims.video.room, roomName);
    assert.strictEqual(claims.video.roomJoin, true);
    assert.strictEqual(claims.video.canPublish, true, 'Teacher must have canPublish: true');
    assert.strictEqual(claims.video.canSubscribe, true);
  });

  test('AC 2: Student receives room token with subscriber permissions (canPublish: false, canSubscribe: true)', async () => {
    const roomName = 'lecture-physics-101';
    const res = await fetch(`${baseUrl}/api/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({ roomName })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.data.token, 'Must return signed LiveKit JWT');

    const claims = decodeJwtPayload(data.data.token);
    assert.ok(claims.video, 'Must include video grant');
    assert.strictEqual(claims.video.room, roomName);
    assert.strictEqual(claims.video.roomJoin, true);
    assert.strictEqual(claims.video.canPublish, false, 'Student must have canPublish: false');
    assert.strictEqual(claims.video.canSubscribe, true, 'Student must have canSubscribe: true');
  });

  test('AC 3: When LiveKit credentials are unconfigured, status endpoint returns operational fallback report', async () => {
    // Temporarily unset credentials
    const origUrl = livekitService.serverUrl;
    const origKey = livekitService.apiKey;
    const origSecret = livekitService.apiSecret;

    try {
      livekitService.serverUrl = null;
      livekitService.apiKey = null;
      livekitService.apiSecret = null;

      const res = await fetch(`${baseUrl}/api/livekit/status`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.configured, false);
      assert.strictEqual(json.data.provider, 'external_fallback');
      assert.ok(json.data.message.includes('fallback'));
    } finally {
      livekitService.serverUrl = origUrl;
      livekitService.apiKey = origKey;
      livekitService.apiSecret = origSecret;
    }
  });
});
