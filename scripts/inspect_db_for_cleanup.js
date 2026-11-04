import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('=== TABLE ROW COUNTS ===');
  const tableRes = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const tables = tableRes.rows.map(r => r.table_name);

  const counts = [];
  for (const table of tables) {
    try {
      const res = await pool.query(`SELECT COUNT(*)::int as cnt FROM "${table}"`);
      counts.push({ table, count: res.rows[0].cnt });
    } catch (e) {
      counts.push({ table, error: e.message });
    }
  }
  console.log(JSON.stringify(counts, null, 2));

  console.log('\n=== USERS ===');
  const userCols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position"
  );
  console.log('Columns:', userCols.rows.map(r => r.column_name));

  const usersRes = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  console.log('User records:');
  const sanitized = usersRes.rows.map(u => {
    const { password_hash, ...rest } = u;
    return rest;
  });
  console.log(JSON.stringify(sanitized, null, 2));

  await pool.end();
}

run().catch(console.error);
