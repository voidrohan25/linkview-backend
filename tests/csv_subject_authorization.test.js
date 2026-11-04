import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';

let server;
let baseUrl;
let adminToken = null;
let teacherToken = null;

describe('Issue #22: CSV Import API Teacher Subject Authorization Guard Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Authenticate Admin (Global unrestricted access)
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const adminData = await adminRes.json();
    assert.strictEqual(adminRes.status, 200);
    adminToken = adminData.data.token;

    // Authenticate Teacher (Restricted to assigned subjects)
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const teacherData = await teacherRes.json();
    assert.strictEqual(teacherRes.status, 200);
    teacherToken = teacherData.data.token;
  });

  after(() => {
    if (server) server.close();
  });

  test('AC 1: Teacher importing questions for their assigned subjects succeeds in preview and import', async () => {
    const assignedSubject = 'Computer Science Fundamentals';
    const uniqueQ = `What is dynamic programming in CS? ${Date.now()}`;
    const validTeacherCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"${uniqueQ}",Optimization technique,Greedy algorithm,Sorting method,Search tree,A,"${assignedSubject}","DP",MEDIUM,"Solves overlapping subproblems",4
`;

    // Preview
    const previewRes = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: validTeacherCsv })
    });
    assert.strictEqual(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.strictEqual(previewData.data.summary.validRows, 1);
    assert.strictEqual(previewData.data.summary.invalidRows, 0);
    assert.strictEqual(previewData.data.rows[0].isValid, true);

    // Import
    const importRes = await fetch(`${baseUrl}/api/questions/csv/import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: validTeacherCsv })
    });
    assert.strictEqual(importRes.status, 200);
    const importData = await importRes.json();
    assert.strictEqual(importData.data.importedCount, 1);
    assert.strictEqual(importData.data.failedCount, 0);
  });

  test('AC 2 & 3: Teacher importing questions for unassigned subjects receives validation error detailing row numbers and offending subject', async () => {
    const unassignedSubject = 'Organic Chemistry and Molecular Physics';
    const invalidTeacherCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"What is covalent bonding?",Electron sharing,Proton exchange,Neutron transfer,Ion separation,A,"${unassignedSubject}","Bonds",EASY,"Sharing of valence electrons",4
`;

    // Preview
    const previewRes = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: invalidTeacherCsv })
    });
    assert.strictEqual(previewRes.status, 200);
    const previewData = await previewRes.json();

    assert.strictEqual(previewData.data.summary.validRows, 0);
    assert.strictEqual(previewData.data.summary.invalidRows, 1);

    const row = previewData.data.rows[0];
    assert.strictEqual(row.rowNumber, 2, 'Must specify exact row number (spreadsheet row 2)');
    assert.strictEqual(row.isValid, false);
    assert.ok(
      row.errors.some(e => e.includes('Permission Denied') && e.includes(unassignedSubject)),
      `Error must mention Permission Denied and offending subject: ${JSON.stringify(row.errors)}`
    );

    // Import rejects insertion of unassigned subject row
    const importRes = await fetch(`${baseUrl}/api/questions/csv/import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: invalidTeacherCsv })
    });
    assert.strictEqual(importRes.status, 200);
    const importData = await importRes.json();
    assert.strictEqual(importData.data.importedCount, 0);
    assert.strictEqual(importData.data.failedCount, 1);
    assert.strictEqual(importData.data.failedRows[0].rowNumber, 2);
    assert.ok(
      importData.data.failedRows[0].errors.some(e => e.includes('Permission Denied') && e.includes(unassignedSubject))
    );
  });

  test('AC 4: Admin can import questions across all subjects without restriction', async () => {
    const unrestrictedSubject = 'Astrophysics & Deep Space Exploration';
    const uniqueQ = `What is Hawking radiation? ${Date.now()}`;
    const adminCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"${uniqueQ}",Black hole thermal emission,Stellar flare,Solar wind,Neutron pulse,A,"${unrestrictedSubject}","Black Holes",HARD,"Theoretical thermal radiation from event horizons",4
`;

    // Preview by Admin
    const previewRes = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: adminCsv })
    });
    assert.strictEqual(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.strictEqual(previewData.data.summary.unrestrictedUser, true);
    assert.strictEqual(previewData.data.summary.validRows, 1);
    assert.strictEqual(previewData.data.summary.invalidRows, 0);
    assert.strictEqual(previewData.data.rows[0].isValid, true);

    // Import by Admin
    const importRes = await fetch(`${baseUrl}/api/questions/csv/import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: adminCsv })
    });
    assert.strictEqual(importRes.status, 200);
    const importData = await importRes.json();
    assert.strictEqual(importData.data.importedCount, 1);
    assert.strictEqual(importData.data.failedCount, 0);
  });

  test('Bidirectional normalization: Teacher assigned to Computer Science Fundamentals can import Computer Science', async () => {
    // Teacher assigned to 'Computer Science Fundamentals'
    const normalizedSubject = 'Computer Science';
    const uniqueQ = `What is Big O notation? ${Date.now()}`;
    const normalizedCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"${uniqueQ}",Algorithm complexity measure,Binary base,CPU core count,Bus bandwidth,A,"${normalizedSubject}","Complexity",EASY,"Describes limiting behavior of functions",4
`;

    const previewRes = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: normalizedCsv })
    });
    assert.strictEqual(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.strictEqual(previewData.data.summary.validRows, 1);
    assert.strictEqual(previewData.data.rows[0].isValid, true);
  });
});
