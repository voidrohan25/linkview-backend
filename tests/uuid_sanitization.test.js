import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import { initDb, memoryStore } from '../src/db/index.js';
import { batchRepository } from '../src/repositories/batchRepository.js';
import { lmsRepository } from '../src/repositories/lmsRepository.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { sanitizeOptionalString } from '../src/utils/sanitize.js';

let server;
let baseUrl;
let adminToken;

before(async () => {
  await initDb();
  const admin = await userRepository.findByEmail('admin@linktest.io');
  adminToken = jwt.sign({ id: admin.id, role: admin.role }, config.jwtSecret);
  await new Promise(resolve => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test('sanitizeOptionalString trims values and converts empty strings to null', () => {
  assert.equal(sanitizeOptionalString(''), null);
  assert.equal(sanitizeOptionalString('   '), null);
  assert.equal(sanitizeOptionalString('  course-123  '), 'course-123');
  assert.equal(sanitizeOptionalString(null), null);
  assert.equal(sanitizeOptionalString(undefined), undefined);
});

test('batch CRUD normalizes optional foreign keys and deletion cleans all joins', async () => {
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  };
  const createResponse = await fetch(`${baseUrl}/api/batches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Empty Optional Foreign Keys',
      course_id: '',
      class_id: '   ',
      class_teacher_id: ''
    })
  });
  assert.equal(createResponse.status, 201);
  const batch = (await createResponse.json()).data.batch;
  assert.equal(batch.course_id, null);
  assert.equal(batch.class_id, null);
  assert.equal(batch.class_teacher_id, null);

  const updateResponse = await fetch(`${baseUrl}/api/batches/${batch.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ course_id: '  ', class_id: '', class_teacher_id: ' ' })
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()).data.batch;
  assert.equal(updated.course_id, null);
  assert.equal(updated.class_id, null);
  assert.equal(updated.class_teacher_id, null);

  memoryStore.batch_teachers.push({ id: 'test-batch-teacher', batch_id: batch.id, teacher_id: 'user-teacher-001' });
  memoryStore.batch_enrollments.push({ id: 'test-batch-enrollment', batch_id: batch.id, student_id: 'user-student-001' });
  memoryStore.student_class_enrollments.push({ id: 'test-class-enrollment', batch_id: batch.id, student_id: 'user-student-001', class_id: 'class-cs-a' });
  const deletion = await batchRepository.deleteBatch(batch.id);
  assert.equal(deletion.success, true);
  assert.equal(memoryStore.batch_teachers.some(record => record.batch_id === batch.id), false);
  assert.equal(memoryStore.batch_enrollments.some(record => record.batch_id === batch.id), false);
  assert.equal(memoryStore.student_class_enrollments.some(record => record.batch_id === batch.id), false);
});

test('admin scheduling APIs normalize optional foreign keys', async () => {
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  };
  const timetableResponse = await fetch(`${baseUrl}/api/admin/timetable`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      class_id: 'class-cs-a',
      batch_id: '  ',
      subject_id: 'sub-ds101',
      teacher_id: 'user-teacher-001',
      academic_session_id: '',
      day_of_week: 4,
      start_time: '09:00',
      end_time: '10:00'
    })
  });
  assert.equal(timetableResponse.status, 201);
  const entry = (await timetableResponse.json()).data.entry;
  assert.equal(entry.batch_id, null);
  assert.equal(entry.academic_session_id, null);

  const liveClassResponse = await fetch(`${baseUrl}/api/admin/live-classes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'No Optional Relations',
      scheduled_at: new Date(Date.now() + 60_000).toISOString(),
      class_id: '',
      batch_id: ' ',
      subject_id: '',
      course_id: '   '
    })
  });
  assert.equal(liveClassResponse.status, 201);
  const session = (await liveClassResponse.json()).data.session;
  assert.equal(session.class_id, null);
  assert.equal(session.batch_id, null);
  assert.equal(session.subject_id, null);
  assert.equal(session.course_id, null);

  const assignmentResponse = await fetch(`${baseUrl}/api/admin/teachers/assignments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      teacher_id: 'user-teacher-002',
      class_id: '  ',
      batch_id: '',
      subject_id: ' '
    })
  });
  assert.equal(assignmentResponse.status, 201);
  assert.equal((await assignmentResponse.json()).data.assignment.batch_id, null);
});
