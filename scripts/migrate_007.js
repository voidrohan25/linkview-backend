import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not defined in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const sqlPath = path.resolve(__dirname, '../../sql/migrations/007_fullscreen_and_security_controls.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('[Migration 007] Executing fullscreen and security controls migration...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[Migration 007] mock_test_attempts and mock_test_proctoring_events updated successfully in PostgreSQL!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration 007] Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
