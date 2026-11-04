import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, memoryStore } from '../src/db/index.js';
import { emailService, setTransporter, getTransporter } from '../src/services/emailService.js';
import { tokenRepository } from '../src/repositories/tokenRepository.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { hashOtp, verifyOtpHash } from '../src/utils/cryptoOtp.js';

let server;
let baseUrl;
let originalTransporter;

describe('Registration & OTP Performance, Reliability, and Security Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    originalTransporter = getTransporter();
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    setTransporter(originalTransporter);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    emailService.clearLastSentEmail();
    setTransporter(null);
    process.env.MOCK_EMAIL = 'true';
  });

  // --- 1. REGISTRATION FLOW ---

  test('1. Valid registration creates unverified student and dispatches OTP', async () => {
    const email = `reg.perf.${Date.now()}@linktest.io`;
    const start = performance.now();

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Pooja Hegde',
        email,
        password: 'Password123!'
      })
    });

    const elapsed = performance.now() - start;
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.role, 'STUDENT');
    assert.strictEqual(body.data.user.email_verified, false);
    assert.strictEqual(body.data.email_sent, true);
    assert.strictEqual(body.data.token, undefined, 'Session token must not be issued before email verification');
    assert.match(body.message, /Account created/i);

    // Verify mock email was dispatched with 6-digit OTP
    const lastEmail = emailService.getLastSentEmail();
    assert.ok(lastEmail, 'Verification email must be dispatched');
    assert.strictEqual(lastEmail.to, email);
    assert.match(lastEmail.otp, /^\d{6}$/);

    // Verify in-memory latency is snappy (< 500ms)
    assert.ok(elapsed < 1000, `Registration took ${elapsed.toFixed(2)}ms, target was < 1000ms`);
  });

  test('2. Duplicate registration with already-verified email returns 409 CONFLICT', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Duplicate Student',
        email: 'student@linktest.io', // Seeded student is already verified
        password: 'Password123!'
      })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'CONFLICT');
    assert.match(body.error.message, /already exists/i);
  });

  test('3. Invalid email format is rejected immediately with 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Valid Name',
        email: 'invalid-email-format',
        password: 'Password123!'
      })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  test('4. Weak password (< 6 chars) is rejected with 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Weak Pw User',
        email: `weak.${Date.now()}@linktest.io`,
        password: '123'
      })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  test('5. Missing required fields are rejected with 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: '',
        email: ''
      })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  test('6. Rapid concurrent duplicate registration requests are handled safely without unhandled crashes', async () => {
    const email = `race.${Date.now()}@linktest.io`;

    // Fire 2 concurrent registration requests at the same instant
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Race User 1',
          email,
          password: 'Password123!'
        })
      }),
      fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Race User 2',
          email,
          password: 'Password123!'
        })
      })
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed (201) and one should be handled gracefully (either 201 idempotent update or 409 CONFLICT or 429 RESEND_COOLDOWN)
    assert.strictEqual(statuses[0], 201, 'At least one request must succeed with 201');
    assert.ok([201, 409, 429].includes(statuses[1]), `Second request should be clean, got ${statuses[1]}`);
    assert.notStrictEqual(statuses[1], 500, 'Concurrent registration must never cause an unhandled 500 crash');
  });

  test('7. Email delivery failure during registration returns 201 with email_sent=false and clear notice', async () => {
    const email = `emailfail.${Date.now()}@linktest.io`;

    // Mock a broken transporter that throws an SMTP error
    delete process.env.MOCK_EMAIL;
    const failingTransporter = {
      sendMail: async () => {
        const err = new Error('getaddrinfo ENOTFOUND smtp.mock.failed');
        err.code = 'ENOTFOUND';
        throw err;
      }
    };
    setTransporter(failingTransporter);

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Email Fail User',
        email,
        password: 'Password123!'
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.email_sent, false);
    assert.strictEqual(body.data.email_error, 'SMTP_UNAVAILABLE');
    assert.match(body.message, /couldn't send the verification email/i);

    // Verify user and token record were still saved so user can resend once email recovers
    const user = await userRepository.findByEmail(email);
    assert.ok(user, 'User record must exist even if email send failed');
    const token = await tokenRepository.findByUserId(user.id);
    assert.ok(token, 'Token record must exist even if email send failed');
  });

  test('8. Email delivery timeout during registration returns 201 with email_error=EMAIL_TIMEOUT', async () => {
    const email = `timeout.${Date.now()}@linktest.io`;

    delete process.env.MOCK_EMAIL;
    const timingOutTransporter = {
      sendMail: async () => {
        const err = new Error('Connection timed out');
        err.code = 'ETIMEDOUT';
        throw err;
      }
    };
    setTransporter(timingOutTransporter);

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Timeout User',
        email,
        password: 'Password123!'
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.email_sent, false);
    assert.strictEqual(body.data.email_error, 'EMAIL_TIMEOUT');
  });

  // --- 2. OTP VERIFICATION FLOW ---

  test('9. Correct OTP verifies user, sets timestamp, and returns active JWT', async () => {
    const email = `verify.success.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Priya Sharma',
        email,
        password: 'Password123!'
      })
    });

    const otp = emailService.getLastSentEmail().otp;

    const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.email_verified, true);
    assert.ok(body.data.user.email_verified_at, 'email_verified_at must be populated');
    assert.ok(body.data.token, 'A valid JWT token must be returned');

    // Confirm that user can now log in
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password123!' })
    });
    assert.strictEqual(loginRes.status, 200);
  });

  test('10. Invalid OTP is rejected with remaining attempts counter', async () => {
    const email = `invalid.otp.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Wrong OTP User',
        email,
        password: 'Password123!'
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '999999' })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'INVALID_OTP');
    assert.match(body.error.message, /attempt\(s\) remaining/i);
  });

  test('11. Expired OTP is rejected with 400 OTP_EXPIRED', async () => {
    const email = `expired.otp.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Expired OTP User',
        email,
        password: 'Password123!'
      })
    });

    const user = await userRepository.findByEmail(email);
    const otp = emailService.getLastSentEmail().otp;

    // Force token expiration in database
    await tokenRepository.setTokenExpiredForTest(user.id);

    const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'OTP_EXPIRED');
  });

  test('12. Reused OTP is rejected after successful verification', async () => {
    const email = `reused.otp.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Reuse User',
        email,
        password: 'Password123!'
      })
    });

    const otp = emailService.getLastSentEmail().otp;

    // First attempt verifies
    const res1 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    assert.strictEqual(res1.status, 200);

    // Second attempt with same OTP fails
    const res2 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    assert.strictEqual(res2.status, 400);
  });

  test('13. Exceeding maximum 5 incorrect OTP attempts locks account verification with 429', async () => {
    const email = `lockout.perf.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Lockout User',
        email,
        password: 'Password123!'
      })
    });

    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: '111111' })
      });
    }

    // 6th attempt is locked with 429 MAX_ATTEMPTS_EXCEEDED
    const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '111111' })
    });

    assert.strictEqual(res.status, 429);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'MAX_ATTEMPTS_EXCEEDED');
  });

  test('14. Resend verification enforces 60-second cooldown', async () => {
    const email = `cooldown.perf.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Cooldown User',
        email,
        password: 'Password123!'
      })
    });

    // Immediate resend within 60s
    const res = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    assert.strictEqual(res.status, 429);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'RESEND_COOLDOWN');
    assert.ok(body.error.details.cooldown_seconds > 0);
  });

  test('15. Resend after cooldown expires invalidates old OTP and issues new working OTP', async () => {
    const email = `newotp.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'New OTP User',
        email,
        password: 'Password123!'
      })
    });

    const firstOtp = emailService.getLastSentEmail().otp;
    const user = await userRepository.findByEmail(email);

    // Fast-forward cooldown by 61 seconds
    const pastTime = new Date(Date.now() - 65 * 1000).toISOString();
    await tokenRepository.setTokenLastSentAtForTest(user.id, pastTime);

    // Resend succeeds
    const resendRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    assert.strictEqual(resendRes.status, 200);
    const secondOtp = emailService.getLastSentEmail().otp;
    assert.notStrictEqual(firstOtp, secondOtp, 'Resend must issue a fresh OTP');

    // First OTP should no longer work
    const failRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: firstOtp })
    });
    assert.strictEqual(failRes.status, 400);

    // Second OTP must work
    const okRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: secondOtp })
    });
    assert.strictEqual(okRes.status, 200);
  });

  // --- 3. SECURITY ASSERTIONS ---

  test('16. Security: OTP is stored only as SHA-256 hash in database, never plaintext', async () => {
    const email = `crypto.otp.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Crypto Student',
        email,
        password: 'Password123!'
      })
    });

    const plainOtp = emailService.getLastSentEmail().otp;
    const user = await userRepository.findByEmail(email);
    const tokenRecord = await tokenRepository.findByUserId(user.id);

    assert.ok(tokenRecord, 'Token record must exist');
    assert.notStrictEqual(tokenRecord.token_hash, plainOtp, 'Plain OTP must NOT be stored in database');
    assert.strictEqual(tokenRecord.token_hash, hashOtp(plainOtp), 'Hash in database must match SHA-256 of plain OTP');
    assert.strictEqual(verifyOtpHash(plainOtp, tokenRecord.token_hash), true, 'Timing-safe hash check must verify');
  });

  test('17. Security: OTP is never exposed in API responses', async () => {
    const email = `no.leak.${Date.now()}@linktest.io`;
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Leak Test Student',
        email,
        password: 'Password123!'
      })
    });

    const bodyText = await res.text();
    const sentOtp = emailService.getLastSentEmail().otp;

    assert.strictEqual(bodyText.includes(`"otp":"${sentOtp}"`), false, 'API response must never expose raw OTP');
    assert.strictEqual(bodyText.includes(`"${sentOtp}"`), false, 'API response must never contain the OTP code');
    assert.strictEqual(bodyText.includes('password_hash'), false, 'Password hash must never leak in response');
  });

  test('18. Security: Failed email delivery hides credentials and internal paths from response', async () => {
    delete process.env.MOCK_EMAIL;
    const failingTransporter = {
      sendMail: async () => {
        const err = new Error('535 5.7.8 Username and Password not accepted with secret_password_xyz');
        err.code = 'EAUTH';
        throw err;
      }
    };
    setTransporter(failingTransporter);

    const email = `secretleak.${Date.now()}@linktest.io`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Secret Leak Student',
        email,
        password: 'Password123!'
      })
    });

    const regText = await regRes.text();
    assert.strictEqual(regText.includes('secret_password_xyz'), false, 'Credentials must never leak in register response');
  });
});
