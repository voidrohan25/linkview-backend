import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let app;
let server;
let baseUrl;
let memoryStore;

before(async () => {
  process.env.DATABASE_URL = '';
  const [{ default: expressApp }, db] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/index.js')
  ]);
  app = expressApp;
  memoryStore = db.memoryStore;
  const initialized = await db.initDb();
  assert.equal(initialized, false);

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

test('backend serves seeded auth and courses without DATABASE_URL', async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = (await healthResponse.json()).data;
  assert.equal(health.status, 'operational');
  assert.equal(health.database.isPostgres, false);
  assert.equal(health.database.connected, false);
  assert.equal(health.database.type, 'InMemoryFallback');

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@linktest.io', password: 'Admin123!' })
  });
  assert.equal(loginResponse.status, 200);
  const login = (await loginResponse.json()).data;
  assert.equal(login.user.role, 'ADMIN');
  assert.ok(login.token);

  const coursesResponse = await fetch(`${baseUrl}/api/courses`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  assert.equal(coursesResponse.status, 200);
  const courses = (await coursesResponse.json()).data.courses;
  assert.equal(courses.length, memoryStore.courses.length);
  assert.ok(courses.length > 0);
});
