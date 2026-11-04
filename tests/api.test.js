import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { emailService } from '../src/services/emailService.js';
import { tokenRepository } from '../src/repositories/tokenRepository.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { securityLogRepository } from '../src/repositories/securityLogRepository.js';
import { setGoogleOAuthClient, getGoogleOAuthClient } from '../src/services/authService.js';
import { config } from '../src/config/env.js';

let server;
let baseUrl;
let studentToken;
let teacherToken;
let adminToken;
let quizAttemptId;
let originalGoogleClient;

describe('LinkTest API End-to-End Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    originalGoogleClient = getGoogleOAuthClient();
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
    setGoogleOAuthClient(originalGoogleClient);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('1. Health Check returns operational status', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'operational');
  });

  test('2. Student Registration creates unverified account & triggers email OTP', async () => {
    emailService.clearLastSentEmail();
    const uniqueEmail = `test.student.${Date.now()}@linktest.io`;

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Rahul Verma',
        email: uniqueEmail,
        password: 'Password123!'
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.role, 'STUDENT');
    assert.strictEqual(body.data.user.email_verified, false, 'New registrations must be unverified');
    assert.strictEqual(body.data.token, undefined, 'Unverified accounts must NOT receive a session token');

    // Verify mock email delivery
    const lastEmail = emailService.getLastSentEmail();
    assert.ok(lastEmail, 'A verification email must be dispatched');
    assert.strictEqual(lastEmail.to, uniqueEmail);
    assert.strictEqual(lastEmail.subject, 'Verify your email address — LinkTest');
    assert.match(lastEmail.otp, /^\d{6}$/, 'OTP must be a 6-digit numeric code');

    // Verify token stored securely (hashed) and TTL is 10 minutes
    const regUser = await userRepository.findByEmail(uniqueEmail);
    const tokenRecord = await tokenRepository.findByUserId(regUser.id);
    assert.ok(tokenRecord, 'A token record must be persisted');
    assert.notStrictEqual(tokenRecord.token_hash, lastEmail.otp, 'Token must be stored as hash, not plaintext');
    const ttlMs = new Date(tokenRecord.expires_at).getTime() - Date.now();
    assert.ok(ttlMs > 9 * 60 * 1000 && ttlMs <= 10 * 60 * 1000 + 5000, 'OTP must have a 10-minute TTL');
  });

  test('3. Invalid email format is rejected by validation', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Invalid Email User',
        email: 'not-an-email',
        password: 'Password123!'
      })
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  test('4. Login rejected for unverified account (EMAIL_NOT_VERIFIED)', async () => {
    const unverifiedEmail = `unverified.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Unverified Student',
        email: unverifiedEmail,
        password: 'Password123!'
      })
    });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: unverifiedEmail,
        password: 'Password123!'
      })
    });

    assert.strictEqual(loginRes.status, 403);
    const body = await loginRes.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'EMAIL_NOT_VERIFIED');
    assert.strictEqual(body.error.message, 'Please verify your email before logging in.');
  });

  test('5. Incorrect OTP verification is rejected and counts attempts', async () => {
    const email = `otp.test.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'OTP Test',
        email,
        password: 'Password123!'
      })
    });

    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        otp: '000000' // Intentionally wrong
      })
    });

    assert.strictEqual(verifyRes.status, 400);
    const body = await verifyRes.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'INVALID_OTP');
  });

  test('6. Correct OTP verifies account and issues authenticated session JWT', async () => {
    const email = `verified.student.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Verified Student',
        email,
        password: 'Password123!'
      })
    });

    const sentOtp = emailService.getLastSentEmail().otp;
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        otp: sentOtp
      })
    });

    assert.strictEqual(verifyRes.status, 200);
    const body = await verifyRes.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.email_verified, true);
    assert.ok(body.data.user.email_verified_at, 'email_verified_at must be populated upon verification');
    assert.ok(body.data.token, 'A valid JWT session must be issued upon email verification');
    studentToken = body.data.token;

    // Login now succeeds after verification
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'Password123!'
      })
    });
    assert.strictEqual(loginRes.status, 200);
  });

  test('7. OTP reuse after successful verification is rejected', async () => {
    const email = `reuse.test.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Reuse Test',
        email,
        password: 'Password123!'
      })
    });

    const otp = emailService.getLastSentEmail().otp;
    // First verification succeeds
    await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    // Second verification attempt with same OTP fails
    const secondRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    assert.strictEqual(secondRes.status, 400);
  });

  test('8. Duplicate registration of verified account is rejected with 409 CONFLICT', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Aarav Sharma Duplicate',
        email: 'student@linktest.io', // Seeded student is already verified
        password: 'Password123!'
      })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'CONFLICT');
  });

  test('9. Resend OTP enforces 60-second cooldown', async () => {
    const email = `cooldown.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Cooldown Test',
        email,
        password: 'Password123!'
      })
    });

    // Immediate resend attempt within 60 seconds
    const resendRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    assert.strictEqual(resendRes.status, 429);
    const body = await resendRes.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'RESEND_COOLDOWN');
  });

  test('10. Max incorrect OTP attempts (5) locks verification', async () => {
    const email = `lockout.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Lockout Test',
        email,
        password: 'Password123!'
      })
    });

    // Attempt 5 incorrect OTPs
    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: '111111' })
      });
    }

    // 6th attempt should be rejected with MAX_ATTEMPTS_EXCEEDED (429)
    const lockRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '111111' })
    });

    assert.strictEqual(lockRes.status, 429);
    const body = await lockRes.json();
    assert.strictEqual(body.error.code, 'MAX_ATTEMPTS_EXCEEDED');
  });

  test('10b. Expired OTP is rejected with OTP_EXPIRED', async () => {
    const email = `expired.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Expired Test',
        email,
        password: 'Password123!'
      })
    });

    const user = await userRepository.findByEmail(email);
    // Artificially expire the token in database
    await tokenRepository.setTokenExpiredForTest(user.id);

    const otp = emailService.getLastSentEmail().otp;
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    assert.strictEqual(verifyRes.status, 400);
    const body = await verifyRes.json();
    assert.strictEqual(body.error.code, 'OTP_EXPIRED');
  });

  test('10c. Public registration cannot grant ADMIN role (tamper resistance)', async () => {
    const email = `tamper.${Date.now()}@linktest.io`;
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Tamper Tester',
        email,
        password: 'Password123!',
        role: 'ADMIN' // Malicious attempt to elevate privileges
      })
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.user.role, 'STUDENT', 'Public registration MUST enforce STUDENT role');
  });

  test('10d. Concurrent OTP verification requests allow exactly one consumption', async () => {
    const email = `concurrent.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Concurrent User',
        email,
        password: 'Password123!'
      })
    });

    const otp = emailService.getLastSentEmail().otp;

    // Fire 2 simultaneous verification calls
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
      }),
      fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
      })
    ]);

    const statuses = [res1.status, res2.status];
    // Exactly one should succeed with 200, the other should fail with 400
    assert.ok(statuses.includes(200), 'At least one request must succeed');
    assert.ok(statuses.includes(400), 'Concurrent duplicate request must be rejected');
  });

  test('10e. Protected endpoint rejects requests without verified session', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid.token.here' }
    });
    assert.strictEqual(res.status, 401);
  });

  test('10f. SMTP delivery failure returns 502 without silently succeeding', async () => {
    const email = `smtp.failure.${Date.now()}@linktest.io`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'SMTP Fail Test',
        email,
        password: 'Password123!'
      })
    });

    // Reset last sent at so cooldown doesn't trigger
    const user = await userRepository.findByEmail(email);
    await tokenRepository.setTokenLastSentAtForTest(user.id, new Date(Date.now() - 120 * 1000).toISOString());

    // Temporarily mock sendVerificationOtp to simulate Gmail rejection
    const originalSend = emailService.sendVerificationOtp;
    emailService.sendVerificationOtp = async () => {
      throw new Error('535-5.7.8 Username and Password not accepted');
    };

    try {
      const resendRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      assert.strictEqual(resendRes.status, 502);
      const body = await resendRes.json();
      assert.strictEqual(body.error.code, 'EMAIL_DELIVERY_FAILED');
    } finally {
      emailService.sendVerificationOtp = originalSend;
    }
  });

  test('10g. Idempotent registration enforces 60-second cooldown', async () => {
    const email = `idempotent.reg.${Date.now()}@linktest.io`;
    // Initial registration
    const firstReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Idempotent User',
        email,
        password: 'Password123!'
      })
    });
    assert.strictEqual(firstReg.status, 201);

    // Immediate second registration with same email
    const secondReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Idempotent User Updated',
        email,
        password: 'NewPassword123!'
      })
    });
    assert.strictEqual(secondReg.status, 429);
    const secondBody = await secondReg.json();
    assert.strictEqual(secondBody.error.code, 'RESEND_COOLDOWN');
    assert.ok(secondBody.error.details?.cooldown_seconds > 0);

    // After cooldown has passed, idempotent registration succeeds
    const user = await userRepository.findByEmail(email);
    await tokenRepository.setTokenLastSentAtForTest(user.id, new Date(Date.now() - 120 * 1000).toISOString());

    const thirdReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Idempotent User Allowed',
        email,
        password: 'Password123!'
      })
    });
    assert.strictEqual(thirdReg.status, 201);
  });

  test('10h. Full OTP verification attempt lockout lifecycle (Manual steps A through J)', async () => {
    const email = `lifecycle.${Date.now()}@linktest.io`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Lifecycle Student',
        email,
        password: 'Password123!'
      })
    });
    assert.strictEqual(regRes.status, 201);
    const user = await userRepository.findByEmail(email);

    // A. First resend allowed after cooldown
    await tokenRepository.setTokenLastSentAtForTest(user.id, new Date(Date.now() - 120 * 1000).toISOString());
    const resendA = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.strictEqual(resendA.status, 200);
    const otpHolderA = emailService.getLastSentEmail().otp;
    assert.ok(otpHolderA);

    // B. Immediate second resend -> 429 RESEND_COOLDOWN
    const resendB = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.strictEqual(resendB.status, 429);
    const bodyB = await resendB.json();
    assert.strictEqual(bodyB.error.code, 'RESEND_COOLDOWN');

    // C. After cooldown -> new OTP allowed and attempts reset
    await tokenRepository.setTokenLastSentAtForTest(user.id, new Date(Date.now() - 120 * 1000).toISOString());
    const resendC = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.strictEqual(resendC.status, 200);
    const activeOtp = emailService.getLastSentEmail().otp;
    const tokenC = await tokenRepository.findByUserId(user.id);
    assert.strictEqual(tokenC.attempts, 0, 'Attempts counter must be 0 after fresh OTP issuance');

    // D. Wrong OTP #1 -> rejected
    const attempt1 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '000000' })
    });
    assert.strictEqual(attempt1.status, 400);
    const body1 = await attempt1.json();
    assert.strictEqual(body1.error.code, 'INVALID_OTP');
    assert.ok(body1.error.message.includes('4 attempt(s) remaining'));

    // E. Wrong OTP #2 -> rejected
    const attempt2 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '000000' })
    });
    assert.strictEqual(attempt2.status, 400);
    assert.strictEqual((await attempt2.json()).error.code, 'INVALID_OTP');

    // F. Wrong OTP #3 -> rejected
    const attempt3 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '000000' })
    });
    assert.strictEqual(attempt3.status, 400);
    assert.strictEqual((await attempt3.json()).error.code, 'INVALID_OTP');

    // G. Wrong OTP #4 -> rejected
    const attempt4 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '000000' })
    });
    assert.strictEqual(attempt4.status, 400);
    const body4 = await attempt4.json();
    assert.strictEqual(body4.error.code, 'INVALID_OTP');
    assert.ok(body4.error.message.includes('1 attempt(s) remaining'));

    // H. Wrong OTP #5 -> 429 MAX_ATTEMPTS_EXCEEDED and OTP invalidated
    const attempt5 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '000000' })
    });
    assert.strictEqual(attempt5.status, 429);
    const body5 = await attempt5.json();
    assert.strictEqual(body5.error.code, 'MAX_ATTEMPTS_EXCEEDED');

    // Verify OTP token is invalidated in database
    const lockedToken = await tokenRepository.findByUserId(user.id);
    assert.strictEqual(lockedToken.token_hash, 'INVALIDATED');
    assert.ok(lockedToken.attempts >= 5);

    // Verify security log recorded
    const logsRes = await securityLogRepository.getLogs({ search: email, limit: 10 });
    const lockoutLog = logsRes.logs.find(l => l.event_type === 'MAX_ATTEMPTS_EXCEEDED');
    assert.ok(lockoutLog, 'A detailed MAX_ATTEMPTS_EXCEEDED security audit log must be recorded');

    // I. Correct old OTP after lock -> rejected
    const attemptOldValid = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: activeOtp })
    });
    assert.strictEqual(attemptOldValid.status, 429);
    const bodyOldValid = await attemptOldValid.json();
    assert.strictEqual(bodyOldValid.error.code, 'MAX_ATTEMPTS_EXCEEDED');

    // J. New OTP after allowed resend -> works
    await tokenRepository.setTokenLastSentAtForTest(user.id, new Date(Date.now() - 120 * 1000).toISOString());
    const resendJ = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.strictEqual(resendJ.status, 200);

    const freshOtp = emailService.getLastSentEmail().otp;
    assert.ok(freshOtp);

    const verifySuccess = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: freshOtp })
    });
    assert.strictEqual(verifySuccess.status, 200);
    const successBody = await verifySuccess.json();
    assert.strictEqual(successBody.success, true);
    assert.strictEqual(successBody.data.user.email_verified, true);
    assert.ok(successBody.data.token);
  });

  test('11. Seeded Admin can log in successfully', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL || 'admin@linktest.io',
        password: process.env.ADMIN_PASSWORD || 'Admin123!'
      })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.role, 'ADMIN');
    adminToken = body.data.token;
  });

  test('12. Student cannot access ADMIN routes (Role Protection)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  test('13. Admin can access ADMIN routes', async () => {
    const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.stats.course_count >= 5);
  });

  test('14. Course Catalogue returns published courses', async () => {
    const res = await fetch(`${baseUrl}/api/courses`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.courses.length >= 5);
  });

  test('15. Quiz Question Sanitization — Answers NEVER exposed in taker endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/quizzes/quiz-web-dev-01`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    const questions = body.data.quiz.questions;
    assert.ok(questions.length > 0);

    for (const q of questions) {
      assert.strictEqual(q.correct_option_index, undefined, 'correct_option_index leaked before submission!');
      assert.strictEqual(q.explanation, undefined, 'explanation leaked before submission!');
    }

    const owner = await userRepository.findById('user-teacher-001');
    const ownerToken = jwt.sign(
      { id: owner.id, email: owner.email, role: owner.role },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const ownerRes = await fetch(`${baseUrl}/api/quizzes/quiz-web-dev-01`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(ownerRes.status, 200);
    const ownerQuiz = (await ownerRes.json()).data.quiz;
    assert.ok(ownerQuiz.questions.every(q => q.correct_option_index !== undefined));
    assert.ok(ownerQuiz.questions.every(q => q.explanation));

    const adminRes = await fetch(`${baseUrl}/api/quizzes/quiz-web-dev-01`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminRes.status, 200);
    assert.ok((await adminRes.json()).data.quiz.questions.every(q => q.correct_option_index !== undefined));

    const otherTeacher = await userRepository.create({
      fullName: 'Unassigned Quiz Teacher',
      email: `quiz.other.teacher.${Date.now()}@linktest.io`,
      passwordHash: 'test-only',
      role: 'TEACHER',
      emailVerified: true,
      emailVerifiedAt: new Date().toISOString()
    });
    const otherTeacherToken = jwt.sign(
      { id: otherTeacher.id, email: otherTeacher.email, role: otherTeacher.role },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const otherTeacherRes = await fetch(`${baseUrl}/api/quizzes/quiz-web-dev-01`, {
      headers: { Authorization: `Bearer ${otherTeacherToken}` }
    });
    assert.strictEqual(otherTeacherRes.status, 200);
    const otherTeacherQuiz = (await otherTeacherRes.json()).data.quiz;
    assert.ok(otherTeacherQuiz.questions.every(q => q.correct_option_index === undefined));
    assert.ok(otherTeacherQuiz.questions.every(q => q.explanation === undefined));
  });

  test('16. Quiz Submission evaluates on server and calculates score', async () => {
    const res = await fetch(`${baseUrl}/api/quizzes/quiz-web-dev-01/attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        answers: [
          { question_id: 'q-wd-1', selected_option_index: 2 }, // Correct (PUT)
          { question_id: 'q-wd-2', selected_option_index: 1 }, // Correct (mutation)
          { question_id: 'q-wd-3', selected_option_index: 1 }, // Correct (bcrypt)
          { question_id: 'q-wd-4', selected_option_index: 1 }, // Correct (parameterized)
          { question_id: 'q-wd-5', selected_option_index: 1 }  // Correct (Bearer)
        ]
      })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.score, 5);
    assert.strictEqual(body.data.total_questions, 5);
    assert.strictEqual(body.data.percentage, 100);
    assert.strictEqual(body.data.passed, true);
    assert.ok(body.data.results.length === 5);
    quizAttemptId = body.data.attempt_id;
  });

  test('16a. Quiz scorecards enforce ownership and log unauthorized access', async () => {
    const ownRes = await fetch(`${baseUrl}/api/quizzes/attempts/${quizAttemptId}`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(ownRes.status, 200);

    const otherStudent = await userRepository.create({
      fullName: 'Other Scorecard Candidate',
      email: `scorecard.other.${Date.now()}@linktest.io`,
      passwordHash: 'test-only',
      emailVerified: true,
      emailVerifiedAt: new Date().toISOString()
    });
    const otherStudentToken = jwt.sign(
      { id: otherStudent.id, email: otherStudent.email, role: 'STUDENT' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const logCountBefore = (await securityLogRepository.getLogs({
      eventType: 'UNAUTHORIZED_SCORECARD_ACCESS'
    })).total;

    const forbiddenRes = await fetch(`${baseUrl}/api/quizzes/attempts/${quizAttemptId}`, {
      headers: { Authorization: `Bearer ${otherStudentToken}` }
    });
    assert.strictEqual(forbiddenRes.status, 403);
    const forbiddenBody = await forbiddenRes.json();
    assert.strictEqual(forbiddenBody.error.code, 'FORBIDDEN');

    const logCountAfter = (await securityLogRepository.getLogs({
      eventType: 'UNAUTHORIZED_SCORECARD_ACCESS'
    })).total;
    assert.strictEqual(logCountAfter, logCountBefore + 1);

    const adminRes = await fetch(`${baseUrl}/api/quizzes/attempts/${quizAttemptId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminRes.status, 200);
  });

  test('17. Lesson Progress persistence updates course percentage', async () => {
    const res = await fetch(`${baseUrl}/api/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        lesson_id: 'lesson-wd-01',
        completed: true
      })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.completed, true);
    assert.ok(body.data.course_progress_percentage > 0);
  });

  test('18. AI Status endpoint returns diagnostics', async () => {
    const res = await fetch(`${baseUrl}/api/ai/status`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.model);
    assert.ok(body.data.status_message);
  });

  // ============================================================
  // GOOGLE IDENTITY SERVICES (GIS) AUTHENTICATION TESTS (19 - 30)
  // ============================================================

  test('19. Google Auth — Valid Google ID token resolves user and returns LinkTest JWT', async () => {
    const uniqueEmail = `gis.valid.${Date.now()}@linktest.io`;
    const uniqueSub = `sub-gis-valid-${Date.now()}`;

    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: uniqueSub,
          email: uniqueEmail,
          email_verified: true,
          name: 'GIS Valid User',
          picture: 'https://lh3.googleusercontent.com/photo.jpg'
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'valid.mock.gis.token' })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.email, uniqueEmail);
    assert.strictEqual(body.data.user.google_id, uniqueSub);
    assert.ok(body.data.token, 'Must return LinkTest session JWT');
  });

  test('20. Google Auth — Existing user with Google email links identity, preserves role, and returns JWT without duplicate', async () => {
    const existingEmail = `gis.existing.${Date.now()}@linktest.io`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Existing Account User',
        email: existingEmail,
        password: 'Password123!'
      })
    });
    assert.strictEqual(regRes.status, 201);

    const uniqueSub = `sub-gis-existing-${Date.now()}`;
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: uniqueSub,
          email: existingEmail,
          email_verified: true,
          name: 'Existing Account User (Google)'
        })
      })
    });

    const linkRes = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'valid.mock.link.token' })
    });

    assert.strictEqual(linkRes.status, 200);
    const body = await linkRes.json();
    assert.strictEqual(body.data.is_new_user, false);
    assert.strictEqual(body.data.account_linked, true);
    assert.strictEqual(body.data.user.email, existingEmail);
    assert.strictEqual(body.data.user.role, 'STUDENT');
    assert.strictEqual(body.data.user.google_id, uniqueSub);
    assert.ok(body.data.token);
  });

  test('21. Google Auth — New Google email creates active STUDENT account with email_verified=true and returns JWT', async () => {
    const newEmail = `gis.newstudent.${Date.now()}@linktest.io`;
    const newSub = `sub-gis-new-${Date.now()}`;

    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: newSub,
          email: newEmail,
          email_verified: true,
          name: 'Ananya Roy',
          picture: 'https://lh3.googleusercontent.com/ananya.jpg'
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'valid.mock.newuser.token' })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.is_new_user, true);
    assert.strictEqual(body.data.user.role, 'STUDENT');
    assert.strictEqual(body.data.user.email_verified, true);
    assert.strictEqual(body.data.user.status, 'active');
    assert.strictEqual(body.data.user.google_id, newSub);
    assert.ok(body.data.token);
  });

  test('22. Google Auth — Invalid Google token rejected with HTTP 401 & code INVALID_GOOGLE_TOKEN', async () => {
    setGoogleOAuthClient({
      verifyIdToken: async () => {
        throw new Error('Invalid token signature or cryptographic verification failed');
      }
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'tampered.or.invalid.token' })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'INVALID_GOOGLE_TOKEN');
  });

  test('23. Google Auth — Expired Google token rejected with HTTP 401', async () => {
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: 'sub-expired',
          email: 'expired@linktest.io',
          email_verified: true,
          exp: Math.floor(Date.now() / 1000) - 1800
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'expired.token' })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'INVALID_GOOGLE_TOKEN');
  });

  test('24. Google Auth — Wrong audience rejected with HTTP 401', async () => {
    const prevClientId = config.google.clientId;
    config.google.clientId = 'linktest-expected-client-id.apps.googleusercontent.com';

    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: 'unauthorized-client-id.apps.googleusercontent.com',
          sub: 'sub-wrong-aud',
          email: 'wrongaud@linktest.io',
          email_verified: true
        })
      })
    });

    try {
      const res = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'wrong.aud.token' })
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'AUDIENCE_MISMATCH');
    } finally {
      config.google.clientId = prevClientId;
    }
  });

  test('25. Google Auth — Invalid issuer rejected with HTTP 401', async () => {
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://fraudulent-issuer.com',
          aud: config.google.clientId || undefined,
          sub: 'sub-bad-iss',
          email: 'badissuer@linktest.io',
          email_verified: true
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'bad.issuer.token' })
    });

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'INVALID_ISSUER');
  });

  test('26. Google Auth — Unverified Google email rejected with HTTP 403', async () => {
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: 'sub-unverified-email',
          email: 'notverified@linktest.io',
          email_verified: false
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'unverified.email.token' })
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'GOOGLE_EMAIL_NOT_VERIFIED');
  });

  test('27. Google Auth — Disabled/suspended user account access is rejected (HTTP 403)', async () => {
    const suspendedEmail = `gis.suspended.${Date.now()}@linktest.io`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Suspended Account User',
        email: suspendedEmail,
        password: 'Password123!'
      })
    });
    const regBody = await regRes.json();
    await userRepository.updateStatus(regBody.data.user.id, 'suspended');

    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: `sub-gis-susp-${Date.now()}`,
          email: suspendedEmail,
          email_verified: true
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'token.for.suspended.user' })
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'ACCOUNT_SUSPENDED');
  });

  test('28. Google Auth — Google login creates security and audit log', async () => {
    const auditEmail = `gis.audit.${Date.now()}@linktest.io`;
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: `sub-gis-audit-${Date.now()}`,
          email: auditEmail,
          email_verified: true,
          name: 'Audit Check User'
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LinkTestAuditVerification/1.0'
      },
      body: JSON.stringify({ credential: 'token.audit.verify' })
    });
    assert.strictEqual(res.status, 200);

    const logRes = await securityLogRepository.getLogs({ search: auditEmail });
    assert.ok(logRes.logs.length > 0, 'Must record security log for Google authentication');
    const matchedLog = logRes.logs.find(l => l.user_email === auditEmail);
    assert.ok(matchedLog);
    assert.strictEqual(matchedLog.metadata?.authMethod, 'GOOGLE');
  });

  test('29. Google Auth — Prevents role escalation (never creates ADMIN or TEACHER)', async () => {
    const escalationAttemptEmail = `gis.escalate.${Date.now()}@linktest.io`;
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: `sub-gis-escalate-${Date.now()}`,
          email: escalationAttemptEmail,
          email_verified: true,
          role: 'ADMIN',
          is_admin: true,
          admin: true
        })
      })
    });

    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'token.attempting.escalation' })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.user.role, 'STUDENT', 'Google registration MUST strictly assign STUDENT role');
  });

  test('30. Google Auth — Existing password login continues working after Google account linking', async () => {
    const studentEmail = `gis.pwdkeep.${Date.now()}@linktest.io`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Password Retained Student',
        email: studentEmail,
        password: 'Password123!'
      })
    });
    assert.strictEqual(regRes.status, 201);

    // Link Google account
    setGoogleOAuthClient({
      verifyIdToken: async () => ({
        getPayload: () => ({
          iss: 'https://accounts.google.com',
          aud: config.google.clientId || undefined,
          sub: `sub-gis-pwd-${Date.now()}`,
          email: studentEmail,
          email_verified: true,
          name: 'Password Retained Student (Google)'
        })
      })
    });

    const linkRes = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'token.pwd.keep' })
    });
    assert.strictEqual(linkRes.status, 200);

    // Verify existing password login still works
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: studentEmail,
        password: 'Password123!'
      })
    });

    assert.strictEqual(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.strictEqual(loginBody.success, true);
    assert.strictEqual(loginBody.data.user.email, studentEmail);
    assert.ok(loginBody.data.token);
  });

  // =========================================================================
  // Issue #5: Server-Side Role Authorization & Access Control Tests
  // =========================================================================

  test('31. Authorization — Missing, malformed, invalid, or expired tokens reject with 401 UNAUTHORIZED', async () => {
    // A. Missing Authorization header
    const missingRes = await fetch(`${baseUrl}/api/admin/dashboard`);
    assert.strictEqual(missingRes.status, 401);
    const missingBody = await missingRes.json();
    assert.strictEqual(missingBody.success, false);
    assert.strictEqual(missingBody.error.code, 'UNAUTHORIZED');
    assert.strictEqual(missingBody.error.message, 'Unauthorized');

    // B. Malformed Bearer header
    const malformedRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: 'Basic not-bearer-token' }
    });
    assert.strictEqual(malformedRes.status, 401);
    const malformedBody = await malformedRes.json();
    assert.strictEqual(malformedBody.error.code, 'UNAUTHORIZED');

    // C. Invalid JWT signature
    const invalidToken = jwt.sign({ id: 'any-id', role: 'ADMIN' }, 'invalid-secret-key-xyz');
    const invalidRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${invalidToken}` }
    });
    assert.strictEqual(invalidRes.status, 401);
    const invalidBody = await invalidRes.json();
    assert.strictEqual(invalidBody.error.code, 'UNAUTHORIZED');

    // D. Expired JWT
    const expiredToken = jwt.sign(
      { id: 'user-admin-001', role: 'ADMIN' },
      config.jwtSecret,
      { expiresIn: -1 }
    );
    const expiredRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    assert.strictEqual(expiredRes.status, 401);
    const expiredBody = await expiredRes.json();
    assert.strictEqual(expiredBody.error.code, 'UNAUTHORIZED');
  });

  test('32. Role Authorization — STUDENT cannot access TEACHER or ADMIN endpoints (403 FORBIDDEN)', async () => {
    // E. Student accessing ADMIN endpoint
    const adminEndpointRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(adminEndpointRes.status, 403);
    const adminEndpointBody = await adminEndpointRes.json();
    assert.strictEqual(adminEndpointBody.success, false);
    assert.strictEqual(adminEndpointBody.error.code, 'FORBIDDEN');
    assert.strictEqual(adminEndpointBody.error.message, 'Forbidden');

    // F. Student accessing TEACHER endpoint
    const teacherEndpointRes = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(teacherEndpointRes.status, 403);
    const teacherEndpointBody = await teacherEndpointRes.json();
    assert.strictEqual(teacherEndpointBody.success, false);
    assert.strictEqual(teacherEndpointBody.error.code, 'FORBIDDEN');
    assert.strictEqual(teacherEndpointBody.error.message, 'Forbidden');
  });

  test('33. Role Authorization — TEACHER access to TEACHER routes allowed, ADMIN-only rejected', async () => {
    // Authenticate seeded Teacher
    const tLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    assert.strictEqual(tLogin.status, 200);
    const tData = await tLogin.json();
    teacherToken = tData.data.token;
    assert.strictEqual(tData.data.user.role, 'TEACHER');

    // G. TEACHER accessing TEACHER endpoint is allowed
    const tClassesRes = await fetch(`${baseUrl}/api/teacher/classes`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(tClassesRes.status, 200);
    const tClassesBody = await tClassesRes.json();
    assert.strictEqual(tClassesBody.success, true);

    // H. TEACHER accessing ADMIN-only endpoint is rejected (403 FORBIDDEN)
    const tAdminRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert.strictEqual(tAdminRes.status, 403);
    const tAdminBody = await tAdminRes.json();
    assert.strictEqual(tAdminBody.success, false);
    assert.strictEqual(tAdminBody.error.code, 'FORBIDDEN');

    // J. ADMIN accessing appropriate management endpoints (requireAnyRole ADMIN, TEACHER) is allowed
    const adminBatchesRes = await fetch(`${baseUrl}/api/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminBatchesRes.status, 200);
    const adminBatchesBody = await adminBatchesRes.json();
    assert.strictEqual(adminBatchesBody.success, true);
  });

  test('34. Role Spoofing Protection — Client cannot escalate privileges via body, query, or headers', async () => {
    // K. Student sends role spoofing attempts
    // Via request body
    const bodySpoofRes = await fetch(`${baseUrl}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({ role: 'ADMIN', name: 'Spoofed Batch', code: 'SPOOF01' })
    });
    assert.strictEqual(bodySpoofRes.status, 403);
    const bodySpoofBody = await bodySpoofRes.json();
    assert.strictEqual(bodySpoofBody.error.code, 'FORBIDDEN');

    // Via query parameter
    const querySpoofRes = await fetch(`${baseUrl}/api/admin/dashboard?role=ADMIN`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.strictEqual(querySpoofRes.status, 403);

    // Via custom headers
    const headerSpoofRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'X-Role': 'ADMIN',
        'X-User-Role': 'ADMIN',
        Role: 'ADMIN'
      }
    });
    assert.strictEqual(headerSpoofRes.status, 403);
  });
});
