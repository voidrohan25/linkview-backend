import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { runSeed } from '../scripts/seed.js';
import {
  SEED_USERS,
  SEED_ACADEMIC_SESSIONS,
  SEED_CLASSES,
  SEED_BATCHES,
  SEED_SUBJECTS,
  SEED_COURSES
} from '../src/db/seedData.js';
import { memoryStore } from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Issue #8: Relational Database Seed Script Suite', () => {

  test('AC 1: backend/package.json defines db:seed script pointing to scripts/seed.js', () => {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.scripts, 'package.json must contain scripts');
    assert.strictEqual(pkg.scripts['db:seed'], 'node scripts/seed.js');
  });

  test('AC 2: Admin user admin@linktest.io has correct password hash (Admin123!) and ADMIN role', () => {
    const adminUser = SEED_USERS.find(u => u.email === 'admin@linktest.io');
    assert.ok(adminUser, 'admin@linktest.io must be present in SEED_USERS');
    assert.strictEqual(adminUser.role, 'ADMIN', 'Admin user role must be ADMIN');
    assert.strictEqual(adminUser.status, 'active');
    assert.strictEqual(adminUser.email_verified, true);

    // Verify bcrypt password hash validates against 'Admin123!'
    const isValidPassword = bcrypt.compareSync('Admin123!', adminUser.password_hash);
    assert.strictEqual(isValidPassword, true, 'Admin password hash must match Admin123!');
  });

  test('AC 3: Required seed datasets (Academic Sessions, Classes, Batches, Subjects, Courses) are populated', () => {
    assert.ok(SEED_ACADEMIC_SESSIONS.length > 0, 'Academic sessions must not be empty');
    assert.ok(SEED_CLASSES.length > 0, 'Classes must not be empty');
    assert.ok(SEED_BATCHES.length > 0, 'Batches must not be empty');
    assert.ok(SEED_SUBJECTS.length > 0, 'Subjects must not be empty');
    assert.ok(SEED_COURSES.length > 0, 'Courses must not be empty');

    // Verify relations
    const classSessionIds = SEED_CLASSES.map(c => c.academic_session_id);
    const sessionIds = new Set(SEED_ACADEMIC_SESSIONS.map(s => s.id));
    for (const sid of classSessionIds) {
      assert.ok(sessionIds.has(sid), `Class academic session ${sid} must exist in sessions`);
    }

    const batchClassIds = SEED_BATCHES.map(b => b.class_id);
    const classIds = new Set(SEED_CLASSES.map(c => c.id));
    for (const cid of batchClassIds) {
      assert.ok(classIds.has(cid), `Batch class ${cid} must exist in classes`);
    }
  });

  test('AC 3 & 4: runSeed execution commits successfully with idempotent ON CONFLICT clauses', async () => {
    const queryStatements = [];
    const mockPool = {
      connect: async () => ({
        query: async (sql, params) => {
          queryStatements.push({ sql: sql.trim(), params });
          return { rows: [] };
        },
        release: () => {}
      }),
      end: async () => {}
    };

    const res = await runSeed({ dbPool: mockPool });
    assert.strictEqual(res, true, 'runSeed must return true on success');

    // Check transaction boundaries
    assert.strictEqual(queryStatements[0].sql, 'BEGIN');
    assert.strictEqual(queryStatements[queryStatements.length - 1].sql, 'COMMIT');

    // Check that inserts contain ON CONFLICT
    const insertStatements = queryStatements.filter(q => q.sql.startsWith('INSERT INTO'));
    assert.ok(insertStatements.length > 0, 'Must have executed INSERT statements');
    for (const ins of insertStatements) {
      assert.match(
        ins.sql,
        /ON CONFLICT/i,
        `Statement must be idempotent with ON CONFLICT: ${ins.sql.substring(0, 50)}...`
      );
    }
  });

  test('AC 4: Seeded entities in memory store are queryable matching seed data', () => {
    const admin = memoryStore.users.find(u => u.email === 'admin@linktest.io');
    assert.ok(admin, 'Admin user must exist in memoryStore');
    assert.strictEqual(admin.role, 'ADMIN');

    const student = memoryStore.users.find(u => u.email === 'student@linktest.io');
    assert.ok(student, 'Student user must exist in memoryStore');
    assert.strictEqual(student.role, 'STUDENT');

    assert.ok(memoryStore.classes.length > 0, 'Classes must exist in memoryStore');
    assert.ok(memoryStore.batches.length > 0, 'Batches must exist in memoryStore');
    assert.ok(memoryStore.subjects.length > 0, 'Subjects must exist in memoryStore');
    assert.ok(memoryStore.courses.length > 0, 'Courses must exist in memoryStore');
  });

  test('Error handling: runSeed rejects if DATABASE_URL is missing', async () => {
    await assert.rejects(
      async () => {
        await runSeed({ dbUrl: '' });
      },
      /DATABASE_URL is not defined in environment/
    );
  });
});
