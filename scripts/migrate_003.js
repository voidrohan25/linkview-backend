import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') });
const { Pool } = pg;

async function applyMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('No DATABASE_URL found.');
    process.exit(1);
  }
  const isNeonOrCloud = dbUrl.includes('neon.tech') || dbUrl.includes('render.com') || dbUrl.includes('sslmode=require');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isNeonOrCloud ? { rejectUnauthorized: false } : false
  });

  try {
    const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../sql/migrations/003_google_auth.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('[Migration] Executing 003_google_auth.sql...');
    await pool.query(sql);
    console.log('[Migration] 003_google_auth.sql applied successfully!');
  } catch (err) {
    console.error('[Migration] Failed:', err.message);
  } finally {
    await pool.end();
  }
}

applyMigration();
