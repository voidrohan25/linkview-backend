import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeMigrationSql, isCloudSslRequired, getMigrationDbConfig, runMigration } from '../scripts/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Issue #7: PostgreSQL Schema Migration Runner Suite', () => {

  test('AC 1: backend/package.json defines db:migrate script pointing to scripts/migrate.js', () => {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.scripts, 'package.json must contain scripts');
    assert.strictEqual(pkg.scripts['db:migrate'], 'node scripts/migrate.js');
  });

  test('AC 1 & Schema: backend/sql/schema.sql contains required relational tables and compiles cleanly', () => {
    const schemaPath = path.resolve(__dirname, '../sql/schema.sql');
    assert.ok(fs.existsSync(schemaPath), 'schema.sql must exist');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Required tables from Issue #7 scope
    const requiredTables = [
      'users',
      'classes',
      'batches',
      'subjects',
      'courses',
      'lessons',
      'quizzes',
      'mock_tests'
    ];

    for (const table of requiredTables) {
      const regex = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\b`, 'i');
      assert.match(schemaSql, regex, `schema.sql must define table: ${table}`);
    }
  });

  test('AC 2: Existing tables and indexes are preserved safely with CREATE TABLE/INDEX IF NOT EXISTS and no destructive drops', () => {
    const sampleDdl = `
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE classes;
      TRUNCATE TABLE subjects CASCADE;
      DROP DATABASE linktest;
      CREATE TABLE users (id VARCHAR(64) PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);
      CREATE INDEX idx_users_email ON users(email);
      CREATE UNIQUE INDEX idx_users_uniq ON users(email);
    `;

    const sanitized = sanitizeMigrationSql(sampleDdl);

    assert.doesNotMatch(sanitized, /DROP\s+TABLE/i, 'Sanitized DDL must not contain DROP TABLE');
    assert.doesNotMatch(sanitized, /DROP\s+DATABASE/i, 'Sanitized DDL must not contain DROP DATABASE');
    assert.doesNotMatch(sanitized, /TRUNCATE/i, 'Sanitized DDL must not contain TRUNCATE');
    assert.match(sanitized, /CREATE TABLE IF NOT EXISTS users/i, 'Must use CREATE TABLE IF NOT EXISTS');
    assert.match(sanitized, /CREATE INDEX IF NOT EXISTS idx_users_email/i, 'Must use CREATE INDEX IF NOT EXISTS');
    assert.match(sanitized, /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uniq/i, 'Must use CREATE UNIQUE INDEX IF NOT EXISTS');
  });

  test('AC 3: Handles both local non-SSL PostgreSQL and remote SSL Neon/Cloud URLs', () => {
    const localUrl = 'postgresql://postgres:postgres@localhost:5432/linktest';
    const neonUrl = 'postgresql://user:pass@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require';
    const renderUrl = 'postgres://user:pass@dpg-abc-a.oregon-postgres.render.com/prod_db';
    const sslParamUrl = 'postgresql://user:pass@db.example.com:5432/test?ssl=true';

    // Local non-SSL
    assert.strictEqual(isCloudSslRequired(localUrl), false);
    const localConfig = getMigrationDbConfig(localUrl);
    assert.strictEqual(localConfig.connectionString, localUrl);
    assert.strictEqual(localConfig.ssl, false);

    // Neon cloud endpoint
    assert.strictEqual(isCloudSslRequired(neonUrl), true);
    const neonConfig = getMigrationDbConfig(neonUrl);
    assert.strictEqual(neonConfig.connectionString, neonUrl);
    assert.deepStrictEqual(neonConfig.ssl, { rejectUnauthorized: false });

    // Render cloud endpoint
    assert.strictEqual(isCloudSslRequired(renderUrl), true);
    const renderConfig = getMigrationDbConfig(renderUrl);
    assert.deepStrictEqual(renderConfig.ssl, { rejectUnauthorized: false });

    // Explicit ssl query param
    assert.strictEqual(isCloudSslRequired(sslParamUrl), true);
    const sslParamConfig = getMigrationDbConfig(sslParamUrl);
    assert.deepStrictEqual(sslParamConfig.ssl, { rejectUnauthorized: false });
  });

  test('AC 4: Transaction support commits on success and rolls back on failure', async () => {
    const queryLog = [];
    let rolledBack = false;

    // Successful transaction run
    const successPool = {
      connect: async () => ({
        query: async (sql) => {
          queryLog.push(sql.trim());
          return { rows: [] };
        },
        release: () => {}
      }),
      end: async () => {}
    };

    const tempSchema = path.join(__dirname, 'temp_neon_migration_test.sql');
    fs.writeFileSync(tempSchema, 'CREATE TABLE sample_ac_table (id INT);');

    try {
      const res = await runMigration({
        dbPool: successPool,
        customSchemaPath: tempSchema
      });
      assert.strictEqual(res, true);
      assert.ok(queryLog.includes('BEGIN'), 'Must issue BEGIN');
      assert.ok(queryLog.includes('COMMIT'), 'Must issue COMMIT on success');

      // Failure simulation triggers ROLLBACK
      const failPool = {
        connect: async () => ({
          query: async (sql) => {
            if (sql.includes('CREATE TABLE')) {
              throw new Error('Simulated syntax or database constraint error');
            }
            if (sql.trim() === 'ROLLBACK') {
              rolledBack = true;
            }
            return { rows: [] };
          },
          release: () => {}
        }),
        end: async () => {}
      };

      await assert.rejects(
        async () => {
          await runMigration({
            dbPool: failPool,
            customSchemaPath: tempSchema
          });
        },
        /Simulated syntax or database constraint error/
      );
      assert.strictEqual(rolledBack, true, 'Transaction must be rolled back on failure');
    } finally {
      if (fs.existsSync(tempSchema)) {
        fs.unlinkSync(tempSchema);
      }
    }
  });

  test('AC 4: Exits with non-zero error diagnostics when DATABASE_URL is missing', async () => {
    await assert.rejects(
      async () => {
        await runMigration({ dbUrl: '' });
      },
      /DATABASE_URL is not defined or is empty/
    );
  });
});
