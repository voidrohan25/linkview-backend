import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { adminController } from '../src/controllers/adminController.js';
import { authController } from '../src/controllers/authController.js';
import { authService } from '../src/services/authService.js';
import { emailService } from '../src/services/emailService.js';
import { initDb, isPostgresConnected, memoryStore } from '../src/db/index.js';
import { invitationRepository } from '../src/repositories/invitationRepository.js';
import { lmsRepository } from '../src/repositories/lmsRepository.js';

process.env.MOCK_EMAIL = 'true';
await initDb();

const invokeController = async (controller, req) => {
  let statusCode;
  let body;
  let error;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    }
  };
  await controller(req, res, nextError => {
    error = nextError;
  });
  return { statusCode, body, error };
};

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

test('teacher invitations dispatch a 48-hour email and provision a department profile once', async t => {
  if (isPostgresConnected) return t.skip('Uses the in-memory database.');
  const suffix = crypto.randomUUID();
  const email = `Issue13-${suffix}@example.test`;
  let invitationId;
  let teacherId;
  t.after(() => {
    memoryStore.teacher_invitations = memoryStore.teacher_invitations.filter(invitation => invitation.id !== invitationId);
    memoryStore.users = memoryStore.users.filter(user => user.id !== teacherId && user.email !== email.toLowerCase());
    memoryStore.teacher_profiles = memoryStore.teacher_profiles.filter(profile => profile.user_id !== teacherId);
    memoryStore.audit_logs = (memoryStore.audit_logs || []).filter(entry =>
      entry.resource_id !== email.toLowerCase() && entry.resource_id !== teacherId
    );
    emailService.clearLastSentEmail();
  });

  const inviteResult = await invokeController(adminController.inviteTeacher, {
    body: { email, full_name: 'Issue 13 Faculty', department: 'Computer Science' },
    user: { id: `issue13-admin-${suffix}`, email: 'admin@example.test', full_name: 'Issue 13 Admin' }
  });

  assert.equal(inviteResult.statusCode, 201);
  assert.equal(inviteResult.body.data.email_sent, true);
  assert.equal(inviteResult.body.data.department, 'Computer Science');
  invitationId = inviteResult.body.data.invitation_id;
  const invitation = memoryStore.teacher_invitations.find(item => item.id === invitationId);
  const remainingMs = Date.parse(invitation.expires_at) - Date.now();
  assert.ok(remainingMs <= 48 * 60 * 60 * 1000 && remainingMs > 47 * 60 * 60 * 1000);
  assert.equal(invitation.email, email.toLowerCase());

  const mail = emailService.getLastSentEmail();
  const inviteUrl = mail.text.split('\n').find(line => line.includes('/accept-invite?token='));
  const token = new URL(inviteUrl).searchParams.get('token');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(invitation.token_hash, token);
  assert.equal(invitation.token_hash, tokenHash(token));

  const accepted = await invokeController(authController.acceptTeacherInvite, {
    body: { token, password: 'ValidPassword123!' }
  });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.body.data.user.role, 'TEACHER');
  teacherId = accepted.body.data.user.id;
  const login = await authService.login({ email, password: 'ValidPassword123!' });
  assert.equal(login.user.role, 'TEACHER');
  assert.ok(login.token);
  assert.ok(invitation.accepted_at);
  assert.equal((await lmsRepository.getTeacherProfile(teacherId)).department, 'Computer Science');
  assert.ok(memoryStore.audit_logs.some(entry =>
    entry.action === 'TEACHER_INVITED' && entry.resource_id === email.toLowerCase()
  ));
  assert.ok(memoryStore.audit_logs.some(entry =>
    entry.action === 'TEACHER_INVITE_ACCEPTED' && entry.resource_id === teacherId
  ));

  await assert.rejects(
    authService.acceptTeacherInvite({ token, password: 'AnotherValidPassword123!' }),
    error => error.statusCode === 400 && error.code === 'INVITATION_EXPIRED_OR_INVALID'
  );
});

test('failed invitation delivery removes the pending token and returns a delivery error', async t => {
  if (isPostgresConnected) return t.skip('Uses the in-memory database.');
  const originalSend = emailService.sendTeacherInvitation;
  const email = `delivery-failure-${crypto.randomUUID()}@example.test`;
  t.after(() => {
    emailService.sendTeacherInvitation = originalSend;
    memoryStore.teacher_invitations = memoryStore.teacher_invitations.filter(invitation => invitation.email !== email);
  });
  emailService.sendTeacherInvitation = async () => {
    throw new Error('SMTP unavailable');
  };

  await assert.rejects(
    authService.inviteTeacher({
      email,
      fullName: 'Delivery Failure Faculty',
      department: 'Science',
      invitedBy: 'issue13-admin',
      inviterName: 'Issue 13 Admin'
    }),
    error => error.statusCode === 502 && error.code === 'INVITATION_DELIVERY_FAILED'
  );
  assert.equal(memoryStore.teacher_invitations.some(invitation => invitation.email === email), false);
});

test('invalid and expired teacher invitation tokens use the shared 400 error contract', async t => {
  if (isPostgresConnected) return t.skip('Uses the in-memory database.');
  const invalidToken = crypto.randomBytes(32).toString('hex');
  await assert.rejects(
    authService.acceptTeacherInvite({ token: invalidToken, password: 'ValidPassword123!' }),
    error => error.statusCode === 400 && error.code === 'INVITATION_EXPIRED_OR_INVALID'
  );

  const token = crypto.randomBytes(32).toString('hex');
  const invitation = await invitationRepository.create({
    email: `expired-${crypto.randomUUID()}@example.test`,
    fullName: 'Expired Faculty',
    invitedBy: 'issue13-admin',
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() - 1000).toISOString()
  });
  t.after(() => {
    memoryStore.teacher_invitations = memoryStore.teacher_invitations.filter(item => item.id !== invitation.id);
  });

  await assert.rejects(
    authService.acceptTeacherInvite({ token, password: 'ValidPassword123!' }),
    error => error.statusCode === 400 && error.code === 'INVITATION_EXPIRED_OR_INVALID'
  );
});
