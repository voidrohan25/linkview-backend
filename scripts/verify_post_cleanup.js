import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verify() {
  const tableRes = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const tables = tableRes.rows.map(r => r.table_name);

  const report = [];
  for (const t of tables) {
    const res = await pool.query(`SELECT count(*)::int as count FROM "${t}"`);
    report.push({ table: t, count: res.rows[0].count });
  }

  console.log('=== FINAL POST-CLEANUP DATABASE ROW COUNTS ===');
  console.table(report);

  const usersRes = await pool.query('SELECT id, email, full_name, role, status, auth_provider, email_verified, created_at FROM users');
  console.log('\n=== USERS IN DATABASE ===');
  console.table(usersRes.rows);

  await pool.end();
}

verify().catch(console.error);
