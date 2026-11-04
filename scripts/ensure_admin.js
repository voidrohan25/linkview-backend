import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function ensureAdmin() {
  try {
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@linktest.io').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
    const adminName = process.env.ADMIN_NAME || 'Dr. Priya Patel';
    const hash = await bcrypt.hash(adminPassword, 10);
    const now = new Date().toISOString();

    // 1. Provision canonical admin
    const adminRes = await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
       VALUES ('user-admin-001', $1, $2, $3, 'ADMIN', 'active', true, $4, $4)
       ON CONFLICT (email) DO UPDATE
       SET role = 'ADMIN', password_hash = EXCLUDED.password_hash, status = 'active', email_verified = true
       RETURNING id, full_name, email, role, status`,
      [adminName, adminEmail, hash, now]
    );
    console.log('[Admin Setup] Configured Admin account:');
    console.log(adminRes.rows[0]);

    // 2. Provision admin@linktest.com alias as well
    const comRes = await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
       VALUES ('user-admin-002', $1, 'admin@linktest.com', $2, 'ADMIN', 'active', true, $3, $3)
       ON CONFLICT (email) DO UPDATE
       SET role = 'ADMIN', password_hash = EXCLUDED.password_hash, status = 'active', email_verified = true
       RETURNING id, full_name, email, role, status`,
      [adminName, hash, now]
    );
    console.log('[Admin Setup] Configured Admin alias (admin@linktest.com):', comRes.rows[0]);

    // 3. Also promote personal google account if present
    const googleRes = await pool.query(
      `UPDATE users 
       SET role = 'ADMIN', password_hash = $1, status = 'active', email_verified = true 
       WHERE email = 'abhishekkalekar.it.sit@gmail.com'
       RETURNING id, full_name, email, role, status`,
      [hash]
    );
    if (googleRes.rows.length > 0) {
      console.log('[Admin Setup] Also promoted Google account to ADMIN:');
      console.log(googleRes.rows[0]);
    }

    // 3. Output all users
    const all = await pool.query('SELECT id, full_name, email, role, status, email_verified, (password_hash IS NOT NULL) as has_password FROM users');
    console.log('\nAll users currently in database:');
    console.log(all.rows);

  } catch (err) {
    console.error('Failed to ensure admin:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

ensureAdmin();
