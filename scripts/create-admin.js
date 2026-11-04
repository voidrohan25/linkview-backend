import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const { Pool } = pg;

/**
 * Creates or updates an administrator account deliberately.
 * Requires explicit email and sufficiently strong password.
 * Never logs credentials.
 */
export async function createAdminUser({ email, password, fullName = 'Production Administrator', dbPool = null, dbUrl = null }) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const trimmedPassword = (password || '').trim();

  if (!normalizedEmail || !trimmedPassword) {
    throw new Error('Both email and password are required to provision an administrator.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    throw new Error('Invalid email format provided.');
  }

  if (trimmedPassword.length < 8) {
    throw new Error('Administrator password must be at least 8 characters long.');
  }

  const connectionString = dbUrl || process.env.DATABASE_URL;
  let localPool = dbPool;
  let shouldClosePool = false;

  if (!localPool) {
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined in environment.');
    }
    const isNeonOrCloud = connectionString.includes('neon.tech') ||
                          connectionString.includes('render.com') ||
                          connectionString.includes('sslmode=require');
    localPool = new Pool({
      connectionString,
      ssl: isNeonOrCloud ? { rejectUnauthorized: false } : false
    });
    shouldClosePool = true;
  }

  try {
    const passwordHash = await bcrypt.hash(trimmedPassword, 10);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const res = await localPool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
       VALUES ($1, $2, $3, $4, 'ADMIN', 'active', true, $5, $5)
       ON CONFLICT (email) DO UPDATE
       SET role = 'ADMIN', password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name,
           status = 'active', email_verified = true, email_verified_at = EXCLUDED.email_verified_at
       RETURNING id, full_name, email, role, status, email_verified`,
      [id, fullName, normalizedEmail, passwordHash, now]
    );

    return res.rows[0];
  } finally {
    if (shouldClosePool && localPool) {
      await localPool.end();
    }
  }
}

async function runCli() {
  const email = process.env.ADMIN_EMAIL || process.argv[2];
  const password = process.env.ADMIN_PASSWORD || process.argv[3];
  const fullName = process.env.ADMIN_NAME || process.argv[4] || 'Production Administrator';

  if (!email || !password) {
    console.error('[Admin Provisioning] Error: Both email and password are required.');
    console.error('Usage via env: ADMIN_EMAIL="admin@yourdomain.com" ADMIN_PASSWORD="your-secure-password" node scripts/create-admin.js');
    console.error('Usage via CLI: node scripts/create-admin.js <email> <password> [fullName]');
    process.exit(1);
  }

  try {
    const admin = await createAdminUser({ email, password, fullName });
    console.log('[Admin Provisioning] Admin account created or upgraded successfully:');
    console.log({
      id: admin.id,
      full_name: admin.full_name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      email_verified: admin.email_verified
    });
  } catch (err) {
    console.error('[Admin Provisioning] Failed to create admin:', err.message);
    process.exit(1);
  }
}

// Execute when invoked directly from command line
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli();
}

