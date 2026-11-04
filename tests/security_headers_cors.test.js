import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { getAllowedOrigins, isOriginAllowed, getSecureCookieOptions } from '../src/config/cors.js';

describe('Issue #6: Helmet HTTP Security Headers and Strict CORS Policy Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('AC 1: HTTP responses include X-Frame-Options: SAMEORIGIN and X-Content-Type-Options: nosniff', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);

    const frameOptions = res.headers.get('x-frame-options');
    const contentTypeOptions = res.headers.get('x-content-type-options');

    assert.strictEqual(frameOptions, 'SAMEORIGIN', 'Response must include X-Frame-Options: SAMEORIGIN');
    assert.strictEqual(contentTypeOptions, 'nosniff', 'Response must include X-Content-Type-Options: nosniff');
  });

  test('AC 2: CORS permits requests from local development origins and configured FRONTEND_URL', async () => {
    const allowed = getAllowedOrigins();
    assert.ok(allowed.includes('http://localhost:5173'));
    assert.ok(allowed.includes('http://localhost:5174'));

    const testOrigin = 'http://localhost:5173';
    assert.strictEqual(isOriginAllowed(testOrigin), true);

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: testOrigin
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), testOrigin);
    assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
  });

  test('AC 3: Unauthorized origins receive HTTP 403 or omitted Access-Control-Allow-Origin header', async () => {
    const maliciousOrigin = 'https://malicious-attacker-domain.evil';
    assert.strictEqual(isOriginAllowed(maliciousOrigin), false);

    const res = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: maliciousOrigin
      }
    });

    // When CORS rejects an unauthorized origin, either an error (403) is returned or access-control-allow-origin is not granted
    const allowOriginHeader = res.headers.get('access-control-allow-origin');
    assert.notStrictEqual(allowOriginHeader, maliciousOrigin, 'Must never allow unauthorized origin');

    if (res.status === 403) {
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error.code, 'CORS_FORBIDDEN');
    } else {
      assert.strictEqual(allowOriginHeader, null);
    }
  });

  test('AC 4: Preflight OPTIONS requests return HTTP 204 with allowed methods', async () => {
    const validOrigin = 'http://localhost:5173';

    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: validOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });

    assert.strictEqual(res.status, 204, 'Preflight OPTIONS must respond with 204 No Content');
    assert.strictEqual(res.headers.get('access-control-allow-origin'), validOrigin);

    const allowMethods = res.headers.get('access-control-allow-methods') || '';
    assert.ok(allowMethods.includes('GET'), 'Must allow GET');
    assert.ok(allowMethods.includes('POST'), 'Must allow POST');
    assert.ok(allowMethods.includes('PUT'), 'Must allow PUT');
    assert.ok(allowMethods.includes('DELETE'), 'Must allow DELETE');
  });

  test('Diagnostic: GET /api/health includes security diagnostic status', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const json = await res.json();

    assert.strictEqual(json.success, true);
    assert.ok(json.data.security, 'Health response must contain security diagnostic');
    assert.strictEqual(json.data.security.helmet, 'enabled');
    assert.strictEqual(json.data.security.cors_policy, 'strict_whitelist');
    assert.strictEqual(json.data.security.frameguard, 'SAMEORIGIN');
    assert.strictEqual(json.data.security.content_type_options, 'nosniff');
  });

  test('Cookie Security: getSecureCookieOptions sets httpOnly and appropriate secure/sameSite flags', () => {
    const defaultCookie = getSecureCookieOptions();
    assert.strictEqual(defaultCookie.httpOnly, true, 'Cookies must be httpOnly');
    assert.ok(defaultCookie.sameSite, 'Cookies must define sameSite');
    assert.ok(typeof defaultCookie.secure === 'boolean', 'Cookies must define secure');
  });
});
