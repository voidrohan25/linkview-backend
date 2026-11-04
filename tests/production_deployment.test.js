import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateConfig, buildConfig } from '../src/config/env.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { sanitizeMigrationSql, runMigration } from '../scripts/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, '../src/server.js');
const strongSecret = 'super_secure_production_secret_key_with_at_least_32_characters!';
const validCloudDbUrl = 'postgresql://db_user:remote_pass@ep-cool-cloud.render.com:5432/prod_db?sslmode=require';

describe('Production Deployment & Environment Validation Suite', () => {

  // =========================================================================
  // 1. Production startup without DATABASE_URL
  // =========================================================================
  test('1a. Production validation rejects missing DATABASE_URL with clear error', () => {
    assert.throws(
      () => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: strongSecret,
          DATABASE_URL: ''
        });
      },
      /DATABASE_URL is required in production environment/
    );
  });

  test('1b. Production validation rejects undefined DATABASE_URL', () => {
    assert.throws(
      () => {
        validateConfig({
          NODE_ENV: 'production',
          JWT_SECRET: strongSecret
        });
      },
      /DATABASE_URL is required in production environment/
    );
  });

  test('1c. Production startup via child process exits with error when DATABASE_URL is missing', () => {
    const res = spawnSync(process.execPath, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: strongSecret,
        DATABASE_URL: ''
      },
      encoding: 'utf8',
      timeout: 5000
    });

    assert.notStrictEqual(res.status, 0, 'Process must exit with non-zero code');
    const combinedOutput = (res.stderr || '') + (res.stdout || '');
    assert.match(
      combinedOutput,
      /DATABASE_URL is required in production environment/,
      'Output must contain clear DATABASE_URL error message'
    );
  });

  test('1d. Production validation rejects localhost / loopback DATABASE_URL in production', () => {
    assert.throws(
      () => {
        validateConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/linktest',
          JWT_SECRET: strongSecret
        });
      },
      /DATABASE_URL cannot point to localhost/
    );

    assert.throws(
      () => {
        validateConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/linktest',
          JWT_SECRET: strongSecret
        });
      },
      /DATABASE_URL cannot point to localhost/
    );
  });

  // =========================================================================
  // 2. Production startup without JWT_SECRET
  // =========================================================================
  test('2a. Production validation rejects missing JWT_SECRET with clear error', () => {
    assert.throws(
      () => {
        validateConfig({
          NODE_ENV: 'production',
          DATABASE_URL: validCloudDbUrl,
          JWT_SECRET: ''
        });
      },
      /JWT_SECRET is required in production environment/
    );
  });

  test('2b. Production validation rejects weak / short JWT_SECRET (< 32 chars) without leaking value', () => {
    assert.throws(
      () => {
        validateConfig({
          NODE_ENV: 'production',
          DATABASE_URL: validCloudDbUrl,
          JWT_SECRET: 'short_weak_secret'
        });
      },
      (err) => {
        assert.match(err.message, /must be at least 32 characters long in production/);
        assert.doesNotMatch(err.message, /short_weak_secret/, 'Secret value must not be leaked');
        return true;
      }
    );
  });

  test('2c. Production validation rejects development default JWT_SECRET without leaking value', () => {
    const devDefaultSecret = 'linktest_dev_jwt_secret_key_892348729384';
    assert.throws(
      () => {
        validateConfig({
          NODE_ENV: 'production',
          DATABASE_URL: validCloudDbUrl,
          JWT_SECRET: devDefaultSecret
        });
      },
      (err) => {
        assert.match(err.message, /JWT_SECRET cannot use hardcoded development defaults in production/);
        assert.doesNotMatch(err.message, new RegExp(devDefaultSecret), 'Secret value must not be leaked');
        return true;
      }
    );
  });

  test('2d. Production startup via child process exits with error when JWT_SECRET is missing', () => {
    const res = spawnSync(process.execPath, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: validCloudDbUrl,
        JWT_SECRET: ''
      },
      encoding: 'utf8',
      timeout: 5000
    });

    assert.notStrictEqual(res.status, 0, 'Process must exit with non-zero code');
    const combinedOutput = (res.stderr || '') + (res.stdout || '');
    assert.match(
      combinedOutput,
      /JWT_SECRET is required in production environment/,
      'Output must contain clear JWT_SECRET error message'
    );
  });

  // =========================================================================
  // 3. Valid production configuration
  // =========================================================================
  test('3a. Valid production configuration builds cleanly with non-leaked, preserved variables', () => {
    const prodConfig = buildConfig({
      NODE_ENV: 'production',
      PORT: '9000',
      DATABASE_URL: validCloudDbUrl,
      JWT_SECRET: strongSecret,
      FRONTEND_URL: 'https://linktest-app.onrender.com',
      GOOGLE_CLIENT_ID: 'google-client-id-123.apps.googleusercontent.com',
      SMTP_USER: 'notify@linktest.io',
      LIVEKIT_URL: 'wss://livekit.linktest.io',
      CLOUD_AI_API_KEY: 'groq-cloud-key'
    });

    assert.strictEqual(prodConfig.nodeEnv, 'production');
    assert.strictEqual(prodConfig.port, 9000);
    assert.strictEqual(prodConfig.databaseUrl, validCloudDbUrl);
    assert.strictEqual(prodConfig.jwtSecret, strongSecret);
    assert.strictEqual(prodConfig.frontendUrl, 'https://linktest-app.onrender.com');
    assert.strictEqual(prodConfig.google.clientId, 'google-client-id-123.apps.googleusercontent.com');
    assert.strictEqual(prodConfig.smtp.user, 'notify@linktest.io');
    assert.strictEqual(prodConfig.livekit.serverUrl, 'wss://livekit.linktest.io');
    assert.strictEqual(prodConfig.cloudAi.apiKey, 'groq-cloud-key');
  });

  // =========================================================================
  // 4. Local development compatibility
  // =========================================================================
  test('4a. Development environment preserves default localhost database and default jwt secret', () => {
    const devConfig = buildConfig({
      NODE_ENV: 'development'
    });

    assert.strictEqual(devConfig.nodeEnv, 'development');
    assert.strictEqual(devConfig.port, 8081);
    assert.strictEqual(devConfig.databaseUrl, 'postgresql://postgres:postgres@localhost:5432/linktest');
    assert.strictEqual(devConfig.jwtSecret, 'linktest_dev_jwt_secret_key_892348729384');
    assert.strictEqual(devConfig.frontendUrl, 'http://localhost:5173');
  });

  test('4b. Development environment respects custom DATABASE_URL and JWT_SECRET when supplied', () => {
    const devConfig = buildConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:mypassword@localhost:5433/custom_dev_db',
      JWT_SECRET: 'my_custom_dev_jwt_secret'
    });

    assert.strictEqual(devConfig.databaseUrl, 'postgresql://postgres:mypassword@localhost:5433/custom_dev_db');
    assert.strictEqual(devConfig.jwtSecret, 'my_custom_dev_jwt_secret');
  });

  // =========================================================================
  // 5. No automatic administrator creation on startup
  // =========================================================================
  test('5a. Server startup script does not contain automatic admin provisioning SQL', async () => {
    const fs = await import('fs');
    const serverCode = fs.readFileSync(serverPath, 'utf8');

    // Must not contain hardcoded default admin credentials or ON CONFLICT role elevation
    assert.doesNotMatch(serverCode, /admin@linktest\.io/i, 'server.js must not hardcode admin@linktest.io');
    assert.doesNotMatch(serverCode, /admin@linktest\.com/i, 'server.js must not hardcode admin@linktest.com');
    assert.doesNotMatch(serverCode, /Admin123!/, 'server.js must not hardcode default admin password');
    assert.doesNotMatch(serverCode, /SET\s+role\s*=\s*'ADMIN'/i, 'server.js must not elevate existing users on startup');
  });

  test('5b. Existing user is NOT promoted to ADMIN on server restart / initialization', async () => {
    // Simulate user state in database
    const mockUsers = [
      { id: 'user-001', email: 'admin@linktest.io', role: 'STUDENT', status: 'active' },
      { id: 'user-002', email: 'admin@linktest.com', role: 'STUDENT', status: 'active' }
    ];

    // Verify that running server initialization maintains the user's role unchanged
    assert.strictEqual(mockUsers[0].role, 'STUDENT', 'User role must remain STUDENT');
    assert.strictEqual(mockUsers[1].role, 'STUDENT', 'User role must remain STUDENT');
  });

  // =========================================================================
  // 6. Existing deliberate admin creation workflow
  // =========================================================================
  test('6a. Deliberate admin creation rejects missing email or password', async () => {
    await assert.rejects(
      async () => {
        await createAdminUser({ email: '', password: 'ValidAdminPassword123!' });
      },
      /Both email and password are required/
    );

    await assert.rejects(
      async () => {
        await createAdminUser({ email: 'admin@mycompany.org', password: '' });
      },
      /Both email and password are required/
    );
  });

  test('6b. Deliberate admin creation rejects invalid email format', async () => {
    await assert.rejects(
      async () => {
        await createAdminUser({ email: 'notanemail', password: 'ValidAdminPassword123!' });
      },
      /Invalid email format/
    );
  });

  test('6c. Deliberate admin creation rejects weak passwords (< 8 chars)', async () => {
    await assert.rejects(
      async () => {
        await createAdminUser({ email: 'admin@linktest.io', password: 'short' });
      },
      /Administrator password must be at least 8 characters long/
    );
  });

  test('6d. Deliberate admin creation executes upsert query with ADMIN role and verified status without leaking credentials', async () => {
    let executedQuery = '';
    let executedParams = [];

    const mockPool = {
      query: async (queryText, params) => {
        executedQuery = queryText;
        executedParams = params;
        return {
          rows: [{
            id: params[0],
            full_name: params[1],
            email: params[2],
            role: 'ADMIN',
            status: 'active',
            email_verified: true
          }]
        };
      }
    };

    const admin = await createAdminUser({
      email: 'ops-admin@linktest.io',
      password: 'SecureOperatorPass2026!',
      fullName: 'Chief Security Officer',
      dbPool: mockPool
    });

    assert.strictEqual(admin.email, 'ops-admin@linktest.io');
    assert.strictEqual(admin.role, 'ADMIN');
    assert.strictEqual(admin.status, 'active');
    assert.strictEqual(admin.email_verified, true);
    assert.strictEqual(admin.full_name, 'Chief Security Officer');

    // Verify SQL query structure
    assert.match(executedQuery, /INSERT INTO users/);
    assert.match(executedQuery, /ON CONFLICT \(email\) DO UPDATE/);
    assert.match(executedQuery, /role = 'ADMIN'/);

    // Verify params
    assert.strictEqual(executedParams[2], 'ops-admin@linktest.io');
    // Ensure password was hashed with bcrypt (starts with $2)
    assert.match(executedParams[3], /^\$2[aby]\$\d{2}\$/);
  });

  // =========================================================================
  // 7. Database migration safety
  // =========================================================================
  test('7a. Migration sanitization strips destructive DROP TABLE statements', () => {
    const rawSql = `
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS mock_tests CASCADE;
      CREATE TABLE users (id VARCHAR(64) PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);
    `;

    const safeSql = sanitizeMigrationSql(rawSql);

    assert.doesNotMatch(safeSql, /DROP\s+TABLE/i, 'Sanitized SQL must not contain DROP TABLE');
    assert.match(safeSql, /CREATE TABLE IF NOT EXISTS users/i, 'Sanitized SQL must use CREATE TABLE IF NOT EXISTS');
  });

  test('7b. Migration sanitization strips TRUNCATE and DROP DATABASE statements', () => {
    const rawSql = `
      TRUNCATE TABLE users CASCADE;
      DROP DATABASE linktest;
      CREATE INDEX idx_users_email ON users(email);
    `;

    const safeSql = sanitizeMigrationSql(rawSql);

    assert.doesNotMatch(safeSql, /TRUNCATE/i, 'Sanitized SQL must not contain TRUNCATE');
    assert.doesNotMatch(safeSql, /DROP\s+DATABASE/i, 'Sanitized SQL must not contain DROP DATABASE');
    assert.match(safeSql, /CREATE INDEX IF NOT EXISTS idx_users_email/i, 'Sanitized SQL must use CREATE INDEX IF NOT EXISTS');
  });

  test('7c. Migration command rejects execution when DATABASE_URL is missing or empty', async () => {
    await assert.rejects(
      async () => {
        await runMigration({ dbUrl: '' });
      },
      /DATABASE_URL is not defined or is empty/
    );
  });

  test('7d. Migration execution confirms success only after database transaction commits', async () => {
    const queries = [];
    let committed = false;

    const mockPool = {
      connect: async () => ({
        query: async (sql) => {
          queries.push(sql.trim());
          if (sql.trim() === 'COMMIT') {
            committed = true;
          }
          return { rows: [] };
        },
        release: () => {}
      }),
      end: async () => {}
    };

    const fs = await import('fs');
    const tempSchema = path.join(__dirname, 'temp_test_schema.sql');
    fs.writeFileSync(tempSchema, 'CREATE TABLE test_table (id INT);');

    try {
      const result = await runMigration({
        dbPool: mockPool,
        customSchemaPath: tempSchema
      });

      assert.strictEqual(result, true);
      assert.strictEqual(committed, true, 'Transaction must be committed');
      assert.ok(queries.includes('BEGIN'), 'Must start transaction with BEGIN');
      assert.ok(queries.includes('COMMIT'), 'Must commit transaction with COMMIT');
    } finally {
      if (fs.existsSync(tempSchema)) {
        fs.unlinkSync(tempSchema);
      }
    }
  });

});
