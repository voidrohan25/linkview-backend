import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { initDb } from '../src/db/index.js';
import { questionBankRepository } from '../src/repositories/questionBankRepository.js';
import { parseCSVToObjects, generateCSV } from '../src/utils/csvParser.js';

let server;
let baseUrl;
let adminToken = null;
let teacherToken = null;
let studentToken = null;

describe('Bulk Question Import from CSV Suite', () => {
  before(async () => {
    process.env.MOCK_EMAIL = 'true';
    await initDb();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Authenticate Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@linktest.io', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
    });
    const adminData = await adminRes.json();
    assert.equal(adminRes.status, 200);
    adminToken = adminData.data.token;

    // Authenticate Teacher
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher@linktest.io', password: 'Teacher123!' })
    });
    const teacherData = await teacherRes.json();
    assert.equal(teacherRes.status, 200);
    teacherToken = teacherData.data.token;

    // Authenticate Student
    const studentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@linktest.io', password: 'Student123!' })
    });
    const studentData = await studentRes.json();
    assert.equal(studentRes.status, 200);
    studentToken = studentData.data.token;
  });

  after(() => {
    if (server) server.close();
  });

  // ────────────────────────────────────────────────────────────
  // 1. Role-based Access Control
  // ────────────────────────────────────────────────────────────
  test('1. Unauthenticated requests to /api/questions/csv/template are rejected (401)', async () => {
    const res = await fetch(`${baseUrl}/api/questions/csv/template`);
    assert.equal(res.status, 401);
  });

  test('2. Students cannot access CSV import endpoints (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/questions/csv/template`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.equal(res.status, 403);
  });

  // ────────────────────────────────────────────────────────────
  // 2. Sample Template Download
  // ────────────────────────────────────────────────────────────
  test('3. Admin and Teachers can download CSV sample template', async () => {
    const res = await fetch(`${baseUrl}/api/questions/csv/template`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);

    const body = await res.text();
    assert.ok(body.includes('question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks'));
    assert.ok(body.includes('Computer Science Fundamentals'));
  });

  // ────────────────────────────────────────────────────────────
  // 3. CSV Validation & Preview
  // ────────────────────────────────────────────────────────────
  test('4. Empty CSV returns descriptive error', async () => {
    const res = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: '' })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error.message, /empty/i);
  });

  test('5. Missing required columns are detected and listed', async () => {
    const invalidHeaderCsv = `question,optionA,optionB\n"What is 2+2?",3,4\n`;
    const res = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: invalidHeaderCsv })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error.message, /Missing required CSV column headers/i);
    assert.ok(data.error.message.includes('correctAnswer'));
  });

  test('6. Valid CSV previews correctly with row numbers, flags, and RFC 4180 parsing', async () => {
    const uniqueSubject = `CSV-Test-Sub-${Date.now()}`;
    const validCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"What is the time complexity of binary search, when array is sorted?",O(1),O(n),O(log n),O(n^2),C,"${uniqueSubject}","Algorithms",MEDIUM,"Binary search halves search space",4
"Which protocol operates at Transport layer?",HTTP,TCP,IP,Ethernet,B,"${uniqueSubject}","Networking",EASY,"TCP is connection-oriented transport protocol",4
`;
    const res = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: validCsv })
    });
    assert.equal(res.status, 200);
    const resData = await res.json();
    assert.equal(resData.success, true);
    assert.equal(resData.data.summary.totalRows, 2);
    assert.equal(resData.data.summary.validRows, 2);
    assert.equal(resData.data.summary.invalidRows, 0);

    // Verify row numbers match spreadsheet rows (Row 2 and Row 3)
    assert.equal(resData.data.rows[0].rowNumber, 2);
    assert.equal(resData.data.rows[0].isValid, true);
    assert.equal(resData.data.rows[0].data.correctOptionIndex, 2); // 'C' -> 2
    assert.equal(resData.data.rows[1].rowNumber, 3);
    assert.equal(resData.data.rows[1].data.correctOptionIndex, 1); // 'B' -> 1
  });

  test('7. Validation flags invalid answer keys, empty options, and bad marks without silent skip', async () => {
    const invalidCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"Valid question text?",A,B,C,D,E,Computer Science,General,MEDIUM,Test,4
"Another question?",A,B,C,D,A,Computer Science,General,INVALID_DIFF,Test,-5
"Missing options?",A,,,D,A,Computer Science,General,EASY,Test,4
`;
    const res = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: invalidCsv })
    });
    assert.equal(res.status, 200);
    const resData = await res.json();
    assert.equal(resData.data.summary.totalRows, 3);
    assert.equal(resData.data.summary.validRows, 0);
    assert.equal(resData.data.summary.invalidRows, 3);

    // Row 2: Invalid answer key 'E'
    const r1 = resData.data.rows[0];
    assert.equal(r1.rowNumber, 2);
    assert.ok(r1.errors.some(e => e.includes('Invalid correct answer "E"')));

    // Row 3: Negative marks and invalid difficulty
    const r2 = resData.data.rows[1];
    assert.equal(r2.rowNumber, 3);
    assert.ok(r2.errors.some(e => e.includes('Marks must be a positive number')));

    // Row 4: Empty option B and C
    const r3 = resData.data.rows[2];
    assert.equal(r3.rowNumber, 4);
    assert.ok(r3.errors.some(e => e.includes('Option B is required')));
    assert.ok(r3.errors.some(e => e.includes('Option C is required')));
  });

  test('8. Detects duplicate questions within the same CSV file', async () => {
    const duplicateCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"What does CPU stand for?",Central Processing Unit,Central Program Unit,Computer Personal Unit,Control Processing Unit,A,Computer Science,Hardware,EASY,CPU explanation,4
"What does CPU stand for?",Central Processing Unit,Central Program Unit,Computer Personal Unit,Control Processing Unit,A,Computer Science,Hardware,EASY,Duplicate Row,4
`;
    const res = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: duplicateCsv })
    });
    assert.equal(res.status, 200);
    const resData = await res.json();
    assert.equal(resData.data.summary.totalRows, 2);
    assert.equal(resData.data.summary.duplicateInFileCount, 1);
    assert.equal(resData.data.rows[0].isValid, true);
    assert.equal(resData.data.rows[1].isValid, false);
    assert.ok(resData.data.rows[1].errors.some(e => e.includes('Duplicate question: Identical to Row #2')));
  });

  // ────────────────────────────────────────────────────────────
  // 4. Import Execution & Duplicate Handling Strategy
  // ────────────────────────────────────────────────────────────
  test('9. Full import commits questions to database and prevents duplicates on re-import', async () => {
    const uniqueSubject = `Database Systems`;
    const q1Text = `What is a Primary Key in relational databases? ${Date.now()}`;
    const importCsv = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"${q1Text}",Unique row identifier,Any column,Foreign key,Index,A,"${uniqueSubject}","Relational Model",EASY,"Primary key uniquely identifies each record",4
`;

    // 1st Import
    const import1 = await fetch(`${baseUrl}/api/questions/csv/import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        csvContent: importCsv,
        duplicateStrategy: 'skip'
      })
    });
    assert.equal(import1.status, 200);
    const d1 = await import1.json();
    assert.equal(d1.success, true);
    assert.equal(d1.data.importedCount, 1);
    assert.equal(d1.data.skippedCount, 0);

    // Verify it exists in Question Bank
    const bankRes = await fetch(`${baseUrl}/api/questions/bank?search=${encodeURIComponent(q1Text)}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(bankRes.status, 200);
    const bankData = await bankRes.json();
    assert.ok(bankData.data.length >= 1);
    assert.equal(bankData.data[0].question_text, q1Text);

    // 2nd Import of same file with 'skip' duplicate strategy
    const import2 = await fetch(`${baseUrl}/api/questions/csv/import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        csvContent: importCsv,
        duplicateStrategy: 'skip'
      })
    });
    assert.equal(import2.status, 200);
    const d2 = await import2.json();
    assert.equal(d2.data.importedCount, 0);
    assert.equal(d2.data.skippedCount, 1);
    assert.ok(d2.data.skippedRows[0].reason.includes('Duplicate of existing Question Bank item'));
  });

  // ────────────────────────────────────────────────────────────
  // 5. Teacher Subject Permission Enforcement
  // ────────────────────────────────────────────────────────────
  test('10. Teacher is blocked from importing questions into unauthorized subjects', async () => {
    // Teacher has 'Computer Science Fundamentals' and 'Data Structures & Algorithms', but NOT 'Quantum Mechanical Aerospace'
    const unauthorizedSubject = 'Quantum Mechanical Aerospace Engineering';
    const csvWithUnauthorizedSub = `question,optionA,optionB,optionC,optionD,correctAnswer,subject,topic,difficulty,explanation,marks
"What is orbital decay?",Atmospheric drag,Gravitational wave,Solar radiation,Magnetic flux,A,"${unauthorizedSubject}","Astrodynamics",HARD,"Atmospheric drag reduces orbital altitude",4
`;
    const res = await fetch(`${baseUrl}/api/questions/csv/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ csvContent: csvWithUnauthorizedSub })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.summary.validRows, 0);
    assert.equal(data.data.summary.invalidRows, 1);
    assert.ok(data.data.rows[0].errors.some(e => e.includes('Permission Denied: You are not authorized to import questions for subject')));
  });

  // ────────────────────────────────────────────────────────────
  // 6. Error Report Generation
  // ────────────────────────────────────────────────────────────
  test('11. Error report CSV can be downloaded for failed rows', async () => {
    const res = await fetch(`${baseUrl}/api/questions/csv/error-report`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        failedRows: [
          { rowNumber: 2, question: 'Sample failed Q', errors: ['Invalid answer key, must be A-D', 'Marks negative'] }
        ]
      })
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const content = await res.text();
    assert.ok(content.includes('Row Number,Question,Errors'));
    assert.ok(content.includes('2,Sample failed Q,"Invalid answer key, must be A-D; Marks negative"'));
  });
});
