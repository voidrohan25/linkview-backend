import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

let server;
let baseUrl;
let adminToken;
let teacherToken;
let studentToken;
const testCode = `ISSUE15${Date.now()}`;
const testDepartment = `Issue 15 Department ${Date.now()}`;

describe('Curriculum subjects API', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const login = async (email, passwords) => {
      for (const password of passwords) {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (res.status === 200) return (await res.json()).data.token;
      }
      assert.fail(`Unable to authenticate seeded account ${email}`);
    };

    [adminToken, teacherToken, studentToken] = await Promise.all([
      login('admin@linktest.io', [process.env.ADMIN_PASSWORD || 'LinkTest#ProdAdmin2026!', 'Admin123!']),
      login('teacher@linktest.io', ['Teacher123!']),
      login('student@linktest.io', ['Student123!'])
    ]);
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  const authHeaders = token => ({ Authorization: `Bearer ${token}` });
  const createSubject = (token, body) => fetch(`${baseUrl}/api/subjects`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  test('teachers and admins can list subjects with status and department filters', async () => {
    for (const token of [teacherToken, adminToken]) {
      const res = await fetch(`${baseUrl}/api/subjects?status=active&department=computer%20science`, {
        headers: authHeaders(token)
      });
      assert.strictEqual(res.status, 200);
      const subjects = (await res.json()).data.subjects;
      assert.ok(subjects.length > 0);
      assert.ok(subjects.every(subject =>
        subject.status === 'active' && subject.department.toLowerCase() === 'computer science'
      ));
    }

    const forbiddenRes = await fetch(`${baseUrl}/api/subjects`, {
      headers: authHeaders(studentToken)
    });
    assert.strictEqual(forbiddenRes.status, 403);
  });

  test('admin can create normalized subjects, filter them, and receives conflict for duplicate codes', async () => {
    const createRes = await createSubject(adminToken, {
      name: 'Issue 15 Subject',
      code: testCode.toLowerCase(),
      description: 'Subject API regression test',
      department: testDepartment
    });
    assert.strictEqual(createRes.status, 201);
    const created = (await createRes.json()).data.subject;
    assert.strictEqual(created.code, testCode);
    assert.strictEqual(created.status, 'active');
    assert.strictEqual(created.department, testDepartment);

    const duplicateRes = await createSubject(adminToken, {
      name: 'Duplicate Issue 15 Subject',
      code: testCode.toLowerCase(),
      department: testDepartment
    });
    assert.strictEqual(duplicateRes.status, 409);
    assert.strictEqual((await duplicateRes.json()).error.code, 'SUBJECT_CODE_CONFLICT');

    const inactiveCreateRes = await createSubject(adminToken, {
      name: 'Inactive Issue 15 Subject',
      code: `${testCode}I`,
      department: testDepartment,
      status: 'inactive'
    });
    assert.strictEqual(inactiveCreateRes.status, 201);

    const filteredRes = await fetch(
      `${baseUrl}/api/subjects?status=active&department=${encodeURIComponent(testDepartment)}`,
      { headers: authHeaders(teacherToken) }
    );
    assert.strictEqual(filteredRes.status, 200);
    const filteredSubjects = (await filteredRes.json()).data.subjects;
    assert.deepStrictEqual(filteredSubjects.map(subject => subject.code), [testCode]);

    const inactiveListRes = await fetch(
      `${baseUrl}/api/subjects?status=inactive&department=${encodeURIComponent(testDepartment)}`,
      { headers: authHeaders(teacherToken) }
    );
    assert.strictEqual(inactiveListRes.status, 200);
    assert.deepStrictEqual(
      (await inactiveListRes.json()).data.subjects.map(subject => subject.code),
      [`${testCode}I`]
    );

    const dropdownRes = await fetch(`${baseUrl}/api/subjects`, {
      headers: authHeaders(teacherToken)
    });
    assert.ok((await dropdownRes.json()).data.subjects.some(subject => subject.id === created.id));
  });

  test('subject creation rejects non-alphanumeric codes and non-admin roles', async () => {
    const invalidCodeRes = await createSubject(adminToken, {
      name: 'Invalid Issue 15 Subject',
      code: 'BAD-CODE'
    });
    assert.strictEqual(invalidCodeRes.status, 400);
    assert.strictEqual((await invalidCodeRes.json()).error.code, 'VALIDATION_ERROR');

    const forbiddenCreateRes = await createSubject(teacherToken, {
      name: 'Teacher Subject',
      code: `${testCode}T`
    });
    assert.strictEqual(forbiddenCreateRes.status, 403);
  });
});
