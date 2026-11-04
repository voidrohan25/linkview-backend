import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('=== ADMIN USERS ===');
  const admins = await pool.query(
    "SELECT id, email, full_name, role, status, auth_provider, email_verified, created_at FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC"
  );
  console.table(admins.rows);

  console.log('\n=== USERS SUMMARY BY ROLE ===');
  const roleCounts = await pool.query(
    "SELECT role, count(*)::int as count FROM users GROUP BY role"
  );
  console.table(roleCounts.rows);

  console.log('\n=== ALL USERS LIST ===');
  const allUsers = await pool.query(
    "SELECT id, email, full_name, role, status, auth_provider, created_at FROM users ORDER BY role, created_at ASC"
  );
  console.table(allUsers.rows);

  console.log('\n=== TABLE ROW COUNTS ===');
  const tableRes = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const counts = [];
  for (const r of tableRes.rows) {
    const t = r.table_name;
    const cntRes = await pool.query(`SELECT count(*)::int as cnt FROM "${t}"`);
    counts.push({ table: t, count: cntRes.rows[0].cnt });
  }
  console.table(counts);

  await pool.end();
}

run().catch(console.error);
