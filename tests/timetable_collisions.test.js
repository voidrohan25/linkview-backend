import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

let server;
let baseUrl;
let adminToken;

describe('Admin timetable scheduling and collisions', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const credentials = [
      { email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'LinkTest#ProdAdmin2026!' },
      { email: 'admin@linktest.io', password: 'Admin123!' }
    ];
    let loginRes;
    for (const body of credentials) {
      loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (loginRes.status === 200) break;
    }
    assert.strictEqual(loginRes.status, 200);
    adminToken = (await loginRes.json()).data.token;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  const headers = () => ({
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  });

  const createEntry = body => fetch(`${baseUrl}/api/admin/timetable`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  });

  test('creates schedules and retrieves entries filtered by batch and weekday', async () => {
    const body = {
      class_id: 'class-cs-a',
      batch_id: 'batch-cs-a1',
      subject_id: 'sub-ds101',
      teacher_id: 'user-teacher-001',
      day_of_week: 7,
      start_time: '20:00',
      end_time: '21:00',
      room: 'Issue16 Room A'
    };
    const createRes = await createEntry(body);
    assert.strictEqual(createRes.status, 201);
    const created = (await createRes.json()).data.entry;
    assert.strictEqual(created.day_of_week, 7);

    const adjacentRes = await createEntry({
      ...body,
      start_time: '21:00',
      end_time: '22:00',
      room: 'Issue16 Room B'
    });
    assert.strictEqual(adjacentRes.status, 201);

    const listRes = await fetch(
      `${baseUrl}/api/admin/timetable?batch_id=batch-cs-a1&day_of_week=7`,
      { headers: headers() }
    );
    assert.strictEqual(listRes.status, 200);
    const entries = (await listRes.json()).data.entries;
    assert.ok(entries.some(entry => entry.id === created.id));
    assert.ok(entries.every(entry => entry.batch_id === 'batch-cs-a1' && entry.day_of_week === 7));
  });

  test('rejects overlapping teacher periods with HTTP 409', async () => {
    const res = await createEntry({
      class_id: 'class-cs-a',
      batch_id: 'batch-cs-b1',
      subject_id: 'sub-cs101',
      teacher_id: 'user-teacher-001',
      day_of_week: 7,
      start_time: '20:30',
      end_time: '21:30',
      room: 'Issue16 Room C'
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'TIMETABLE_COLLISION');
    assert.ok(body.error.details.conflicts.some(conflict => conflict.conflict_types.includes('teacher')));
  });

  test('rejects overlapping room bookings with HTTP 409', async () => {
    const res = await createEntry({
      class_id: 'class-cs-a',
      batch_id: 'batch-cs-a2',
      subject_id: 'sub-ai201',
      teacher_id: 'user-teacher-002',
      day_of_week: 7,
      start_time: '20:15',
      end_time: '20:45',
      room: 'issue16 room a'
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'TIMETABLE_COLLISION');
    assert.ok(body.error.details.conflicts.some(conflict => conflict.conflict_types.includes('room')));
  });

  test('rejects invalid days and time ranges', async () => {
    const validEntry = {
      class_id: 'class-cs-a',
      batch_id: 'batch-cs-a1',
      subject_id: 'sub-ds101',
      teacher_id: 'user-teacher-001',
      day_of_week: 6,
      start_time: '09:00',
      end_time: '10:00'
    };
    for (const body of [
      { ...validEntry, day_of_week: 8 },
      { ...validEntry, start_time: '10:00', end_time: '09:00' },
      { ...validEntry, start_time: '9:00' }
    ]) {
      const res = await createEntry(body);
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error.code, 'VALIDATION_ERROR');
    }
  });
});
