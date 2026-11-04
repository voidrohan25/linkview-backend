import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminController } from '../src/controllers/adminController.js';
import { batchController } from '../src/controllers/batchController.js';
import { initDb, isPostgresConnected, memoryStore } from '../src/db/index.js';
import { batchRepository } from '../src/repositories/batchRepository.js';

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

test('class creation treats a blank academic session as omitted', async t => {
  if (isPostgresConnected) return t.skip('Uses the in-memory database.');
  const result = await invokeController(adminController.createClass, {
    body: { name: 'Issue 14 class', academic_session_id: '  ' },
    user: { id: 'issue14-admin', email: 'admin@example.test' }
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.data.class.academic_session_id, null);
  memoryStore.classes = memoryStore.classes.filter(cls => cls.id !== result.body.data.class.id);
});

test('nested batch creation uses the route class and defaults capacity to 40', async t => {
  if (isPostgresConnected) return t.skip('Uses the in-memory database.');
  const classId = `issue14-class-${Date.now()}`;
  const otherClassId = `issue14-other-${Date.now()}`;
  memoryStore.classes.push(
    { id: classId, name: 'Issue 14 route class' },
    { id: otherClassId, name: 'Issue 14 body class' }
  );

  const result = await invokeController(batchController.createBatch, {
    body: { name: 'Issue 14 batch', class_id: otherClassId },
    params: { classId },
    user: { id: 'issue14-admin', email: 'admin@example.test' }
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.data.batch.class_id, classId);
  assert.equal(result.body.data.batch.capacity, 40);
  await batchRepository.deleteBatch(result.body.data.batch.id);
  memoryStore.classes = memoryStore.classes.filter(cls => cls.id !== classId && cls.id !== otherClassId);
});

test('bulk enrollment rejects over-capacity requests without partial enrollment', async t => {
  if (isPostgresConnected) return t.skip('Uses the in-memory database.');
  const batchId = `issue14-capacity-${Date.now()}`;
  const studentIds = [`issue14-student-a-${Date.now()}`, `issue14-student-b-${Date.now()}`];
  memoryStore.batches.push({ id: batchId, name: 'Issue 14 capacity batch', capacity: 1, status: 'Active' });
  memoryStore.users.push(
    { id: studentIds[0], role: 'STUDENT', full_name: 'Issue 14 Student A' },
    { id: studentIds[1], role: 'STUDENT', full_name: 'Issue 14 Student B' }
  );

  const result = await invokeController(batchController.enrollStudents, {
    body: { student_ids: studentIds },
    params: { batchId },
    user: { id: 'issue14-admin', email: 'admin@example.test', role: 'ADMIN' }
  });

  assert.equal(result.error?.statusCode, 400);
  assert.equal(result.error?.code, 'BATCH_CAPACITY_EXCEEDED');
  assert.equal(memoryStore.batch_enrollments.some(enrollment => enrollment.batch_id === batchId), false);
  await batchRepository.deleteBatch(batchId);
  memoryStore.users = memoryStore.users.filter(user => !studentIds.includes(user.id));
});

test('batch deletion removes enrollment rows and clears dependent batch references', async t => {
  if (isPostgresConnected) return t.skip('Uses the in-memory database.');
  const batchId = `issue14-delete-${Date.now()}`;
  memoryStore.batches.push({ id: batchId, name: 'Issue 14 delete batch', capacity: 5, status: 'Active' });
  memoryStore.batch_enrollments.push({ id: `${batchId}-enrollment`, batch_id: batchId });
  memoryStore.batch_teachers.push({ id: `${batchId}-teacher`, batch_id: batchId });

  const dependentCollections = [
    'teacher_assignments',
    'timetable_entries',
    'attendance_records',
    'assignments',
    'live_class_sessions',
    'mock_tests'
  ];
  for (const collection of dependentCollections) {
    memoryStore[collection].push({ id: `${batchId}-${collection}`, batch_id: batchId });
  }

  assert.deepEqual(await batchRepository.deleteBatch(batchId), { success: true });
  assert.equal(memoryStore.batches.some(batch => batch.id === batchId), false);
  assert.equal(memoryStore.batch_enrollments.some(enrollment => enrollment.batch_id === batchId), false);
  assert.equal(memoryStore.batch_teachers.some(teacher => teacher.batch_id === batchId), false);
  assert.equal(memoryStore.student_class_enrollments.some(enrollment => enrollment.batch_id === batchId), false);
  for (const collection of dependentCollections) {
    const dependent = memoryStore[collection].find(record => record.id === `${batchId}-${collection}`);
    assert.equal(dependent.batch_id, null, `${collection} should no longer reference the deleted batch`);
    memoryStore[collection] = memoryStore[collection].filter(record => record.id !== dependent.id);
  }
  assert.deepEqual(await batchRepository.deleteBatch(batchId), {
    success: false,
    code: 'NOT_FOUND',
    message: 'Batch not found.'
  });
});
