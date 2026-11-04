import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const { Pool } = pg;

/**
 * Sanitizes raw SQL to ensure safe execution on existing databases:
 * - Strips destructive DROP TABLE / DROP DATABASE / TRUNCATE statements
 * - Converts CREATE TABLE to CREATE TABLE IF NOT EXISTS
 * - Converts CREATE INDEX to CREATE INDEX IF NOT EXISTS
 * - Converts CREATE UNIQUE INDEX to CREATE UNIQUE INDEX IF NOT EXISTS
 */
export function sanitizeMigrationSql(rawSql) {
  // Strip DROP TABLE ... CASCADE / DROP TABLE ... statements
  let safeSql = rawSql.replace(/DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+[^;]+;/gi, '-- [MIGRATION SAFETY] Stripped destructive statement');

  // Strip DROP DATABASE / TRUNCATE
  safeSql = safeSql.replace(/DROP\s+DATABASE(?:\s+IF\s+EXISTS)?\s+[^;]+;/gi, '-- [MIGRATION SAFETY] Stripped destructive statement');
  safeSql = safeSql.replace(/TRUNCATE(?:\s+TABLE)?\s+[^;]+;/gi, '-- [MIGRATION SAFETY] Stripped destructive statement');

  // Convert CREATE TABLE to CREATE TABLE IF NOT EXISTS
  safeSql = safeSql.replace(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\s+)([a-zA-Z0-9_"]+)/gi, 'CREATE TABLE IF NOT EXISTS $1');

  // Convert CREATE INDEX to CREATE INDEX IF NOT EXISTS
  safeSql = safeSql.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\s+)([a-zA-Z0-9_"]+)/gi, 'CREATE $1INDEX IF NOT EXISTS $2');

  return safeSql;
}

export function isCloudSslRequired(connectionUrl) {
  if (!connectionUrl || typeof connectionUrl !== 'string') return false;
  const lower = connectionUrl.toLowerCase();
  return lower.includes('neon.tech') ||
         lower.includes('render.com') ||
         lower.includes('supabase.co') ||
         lower.includes('sslmode=require') ||
         lower.includes('ssl=true');
}

export function getMigrationDbConfig(connectionUrl) {
  const url = (connectionUrl || '').trim();
  const requiresSsl = isCloudSslRequired(url);
  return {
    connectionString: url,
    ssl: requiresSsl ? { rejectUnauthorized: false } : false
  };
}

/**
 * Executes database migration safely:
 * - Requires DATABASE_URL
 * - Never executes destructive resets, test data cleanup, or development seeds
 * - Runs inside a database transaction (BEGIN / COMMIT / ROLLBACK)
 * - Only confirms success after database commit
 */
export async function runMigration({ dbUrl = null, dbPool = null, customSchemaPath = null } = {}) {
  const connectionUrl = (dbUrl !== null && dbUrl !== undefined ? dbUrl : (process.env.DATABASE_URL || '')).trim();
  if (!dbPool && !connectionUrl) {
    console.error('[Migration Error] DATABASE_URL is not defined or is empty in environment.');
    throw new Error('[Migration Error] DATABASE_URL is not defined or is empty in environment.');
  }

  const schemaPath = customSchemaPath || path.join(__dirname, '../sql/schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`[Migration Error] Schema file not found at: ${schemaPath}`);
    throw new Error(`[Migration Error] Schema file not found at: ${schemaPath}`);
  }

  const rawSql = fs.readFileSync(schemaPath, 'utf8');
  const safeSql = sanitizeMigrationSql(rawSql);

  let pool = dbPool;
  let shouldClosePool = false;

  if (!pool) {
    const config = getMigrationDbConfig(connectionUrl);
    pool = new Pool(config);
    shouldClosePool = true;
  }

  const client = await pool.connect();
  try {
    console.log('[Migration] Beginning safe database migration transaction...');
    await client.query('BEGIN');
    await client.query(safeSql);
    await client.query('COMMIT');
    console.log('[Migration] Schema successfully applied and confirmed by PostgreSQL database.');
    return true;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[Migration Error] Rollback error:', rollbackErr.message);
    }
    console.error('[Migration Error] Migration failed. Transaction rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    if (shouldClosePool && pool) {
      await pool.end();
    }
  }
}

async function runCli() {
  try {
    await runMigration();
    process.exit(0);
  } catch (err) {
    console.error('[Migration Error] Database migration failed:', err.message);
    process.exit(1);
  }
}

// Execute when invoked directly from command line
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli();
}

