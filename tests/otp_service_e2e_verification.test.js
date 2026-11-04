import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb, memoryStore } from '../src/db/index.js';
import { emailService, setTransporter, getTransporter } from '../src/services/emailService.js';
import { tokenRepository } from '../src/repositories/tokenRepository.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { authService, setGoogleOAuthClient, getGoogleOAuthClient } from '../src/services/authService.js';
import { hashOtp, verifyOtpHash, generateOtp } from '../src/utils/cryptoOtp.js';
import { config } from '../src/config/env.js';
import jwt from 'jsonwebtoken';

let server;
let baseUrl;
let originalTransporter;

describe('OTP Service Comprehensive End-to-End Verification Suite', () => {
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

  // 1. Request an OTP
  test('Step 1 & 2 & 3: Request an OTP, provider accepts, confirm receipt in test environment', async () => {
    const email = `otp.req.${Date.now()}@linktest.io`;
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Ananya Roy',
        email,
        password: 'SecurePassword123!'
      })
    });

    assert.strictEqual(res.status, 201, 'Registration must return HTTP 201');
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.email_sent, true, 'Email dispatch must succeed');
    assert.strictEqual(body.data.user.email_verified, false, 'User must remain unverified until OTP check');

    // Confirm receipt in test environment
    const lastEmail = emailService.getLastSentEmail();
    assert.ok(lastEmail, 'Verification email must be captured');
    assert.strictEqual(lastEmail.to, email);
    assert.match(lastEmail.otp, /^\d{6}$/, 'OTP must be exactly 6 numeric digits');
    assert.match(lastEmail.subject, /Verify your email/i);
    assert.ok(lastEmail.html.includes(lastEmail.otp), 'HTML template must contain the OTP');
  });

  // 4. Enter correct OTP and verify authentication succeeds
  test('Step 4: Enter correct OTP and verify authentication succeeds with active session', async () => {
    const email = `otp.auth.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Vikram Seth',
        email,
        password: 'SecurePassword123!'
      })
    });

    const correctOtp = emailService.getLastSentEmail().otp;

    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: correctOtp })
    });

    assert.strictEqual(verifyRes.status, 200, 'Verification with correct OTP must succeed with 200');
    const verifyBody = await verifyRes.json();
    assert.strictEqual(verifyBody.success, true);
    assert.strictEqual(verifyBody.data.user.email_verified, true, 'User email_verified must be true');
    assert.ok(verifyBody.data.token, 'A valid JWT session token must be returned');

    // Verify session token works with protected /api/auth/me
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${verifyBody.data.token}` }
    });
    assert.strictEqual(meRes.status, 200);
    const meBody = await meRes.json();
    assert.strictEqual(meBody.data.user.email, email);
  });

  // 5. Enter incorrect OTP and verify it is rejected
  test('Step 5: Enter incorrect OTP and verify it is rejected with remaining attempts counter', async () => {
    const email = `otp.incorrect.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Incorrect User',
        email,
        password: 'SecurePassword123!'
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '000000' })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'INVALID_OTP');
    assert.match(body.error.message, /4 attempt\(s\) remaining/i);
  });

  // 6. Attempt verification after expiration and verify rejection
  test('Step 6: Attempt verification after expiration and verify rejection with 400 OTP_EXPIRED', async () => {
    const email = `otp.expired.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Expired Test',
        email,
        password: 'SecurePassword123!'
      })
    });

    const otp = emailService.getLastSentEmail().otp;
    const user = await userRepository.findByEmail(email);

    // Set expiration in the past
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
    assert.match(body.error.message, /expired/i);
  });

  // 7. Attempt to reuse a verified OTP and verify rejection
  test('Step 7: Attempt to reuse a verified OTP and verify rejection', async () => {
    const email = `otp.reuse.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Reuse Test',
        email,
        password: 'SecurePassword123!'
      })
    });

    const otp = emailService.getLastSentEmail().otp;

    // First use: verifies successfully
    const firstRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    assert.strictEqual(firstRes.status, 200);

    // Second use: must be rejected
    const secondRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    assert.strictEqual(secondRes.status, 400);
    const secondBody = await secondRes.json();
    assert.strictEqual(secondBody.success, false);
    assert.ok(
      secondBody.error.code === 'ALREADY_VERIFIED' || secondBody.error.code === 'OTP_ALREADY_USED',
      `Expected ALREADY_VERIFIED or OTP_ALREADY_USED, got ${secondBody.error.code}`
    );
  });

  // 8. Verify resend cooldown and attempt limits
  test('Step 8: Verify resend cooldown (429 RESEND_COOLDOWN) and attempt limits (429 MAX_ATTEMPTS_EXCEEDED)', async () => {
    const email = `otp.limits.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Limits Test',
        email,
        password: 'SecurePassword123!'
      })
    });

    // 8a. Resend cooldown: immediate resend must return 429
    const cooldownRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.strictEqual(cooldownRes.status, 429);
    const cooldownBody = await cooldownRes.json();
    assert.strictEqual(cooldownBody.error.code, 'RESEND_COOLDOWN');
    assert.ok(cooldownBody.error.details.cooldown_seconds > 0);

    // 8b. Attempt limits: 5 incorrect tries lockout
    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: '123456' })
      });
    }

    const lockedRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '123456' })
    });
    assert.strictEqual(lockedRes.status, 429);
    const lockedBody = await lockedRes.json();
    assert.strictEqual(lockedBody.error.code, 'MAX_ATTEMPTS_EXCEEDED');
  });

  // 9. Verify provider failure handling without leaking credentials or silently succeeding
  test('Step 9: Provider failure returns 502/503 without leaking credentials and clears cooldown for retry', async () => {
    delete process.env.MOCK_EMAIL;
    const failingTransporter = {
      sendMail: async () => {
        const err = new Error('535 5.7.8 Authentication failed with secret_app_pass_9988');
        err.code = 'EAUTH';
        throw err;
      }
    };
    setTransporter(failingTransporter);

    const email = `otp.fail.${Date.now()}@linktest.io`;

    // 9a. Registration handles provider failure gracefully
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Failure Test',
        email,
        password: 'SecurePassword123!'
      })
    });

    assert.strictEqual(regRes.status, 201);
    const regBody = await regRes.json();
    assert.strictEqual(regBody.data.email_sent, false);
    assert.strictEqual(regBody.data.email_error, 'SMTP_UNAVAILABLE');
    assert.strictEqual(JSON.stringify(regBody).includes('secret_app_pass_9988'), false, 'Credentials must never leak');

    // 9b. Resend handles provider failure without silently succeeding
    const resendRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    assert.strictEqual(resendRes.status, 503);
    const resendBody = await resendRes.json();
    assert.strictEqual(resendBody.success, false);
    assert.strictEqual(resendBody.error.code, 'SMTP_UNAVAILABLE');
    assert.strictEqual(JSON.stringify(resendBody).includes('secret_app_pass_9988'), false, 'Credentials must never leak');

    // 9c. Cooldown was cleared on failure, so immediate retry is allowed once provider recovers
    process.env.MOCK_EMAIL = 'true';
    setTransporter(null);

    const retryRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.strictEqual(retryRes.status, 200, 'Immediate retry must succeed without cooldown lock after delivery failure');
  });

  // 10. Existing registration, login, and password-reset flows still work
  test('Step 10: Registration, login blocking for unverified users, and password-reset work correctly', async () => {
    const email = `otp.flows.${Date.now()}@linktest.io`;
    const password = 'Password123!';

    // Register
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Flows Student', email, password })
    });

    // Unverified user login must be blocked with 403 EMAIL_NOT_VERIFIED
    const blockedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.strictEqual(blockedLogin.status, 403);
    const blockedBody = await blockedLogin.json();
    assert.strictEqual(blockedBody.error.code, 'EMAIL_NOT_VERIFIED');

    // Verify email with OTP
    const otp = emailService.getLastSentEmail().otp;
    await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    // Now login must succeed with 200
    const okLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.strictEqual(okLogin.status, 200);
    const loginData = await okLogin.json();
    assert.ok(loginData.data.token);

    // Password reset flow
    const forgotRes = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.strictEqual(forgotRes.status, 200);
    const forgotBody = await forgotRes.json();
    assert.match(forgotBody.message, /password reset link has been sent/i);
  });

  // 11. Google login remains unaffected
  test('Step 11: Google login remains unaffected and continues to work cleanly', async () => {
    const googleSub = `google-sub-${Date.now()}`;
    const googleEmail = `google.student.${Date.now()}@gmail.com`;

    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: googleSub,
          email: googleEmail,
          email_verified: true,
          name: 'Google Auth Student',
          picture: 'https://lh3.googleusercontent.com/test.jpg'
        })
      })
    });

    const googleRes = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'mock.google.id.token' })
    });

    assert.strictEqual(googleRes.status, 200, 'Google auth must succeed with HTTP 200');
    const googleBody = await googleRes.json();
    assert.strictEqual(googleBody.success, true);
    assert.strictEqual(googleBody.data.user.email, googleEmail);
    assert.strictEqual(googleBody.data.user.role, 'STUDENT', 'Google registration must preserve STUDENT role');
    assert.strictEqual(googleBody.data.user.email_verified, true, 'Google sign-ins are pre-verified');
    assert.ok(googleBody.data.token, 'A valid LinkTest JWT token must be returned');
  });
});
