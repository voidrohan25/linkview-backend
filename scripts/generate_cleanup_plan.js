import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const tableRes = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const tables = tableRes.rows.map(r => r.table_name);

  const report = [];
  for (const t of tables) {
    const cntRes = await pool.query(`SELECT count(*)::int as cnt FROM "${t}"`);
    const total = cntRes.rows[0].cnt;
    let toDelete = total;
    let toKeep = 0;
    let notes = '';

    if (t === 'users') {
      const adminCnt = (await pool.query("SELECT count(*)::int as cnt FROM users WHERE role = 'ADMIN'")).rows[0].cnt;
      toKeep = adminCnt;
      toDelete = total - adminCnt;
      notes = 'Preserves real admin: user-admin-001 (admin@linktest.io)';
    } else if (t === 'academic_sessions') {
      // Configuration record needed for system operation
      toKeep = total;
      toDelete = 0;
      notes = 'Preserves active academic session configuration (Academic Year 2026-27)';
    } else if (['audit_logs', 'security_logs', 'mock_test_audit_logs'].includes(t)) {
      toDelete = total;
      toKeep = 0;
      notes = 'Clears test/demo activity logs (logging infrastructure and tables remain)';
    } else {
      toDelete = total;
      toKeep = 0;
      notes = `Clears test/demo records`;
    }

    report.push({
      table: t,
      current: total,
      to_delete: toDelete,
      to_keep: toKeep,
      notes
    });
  }

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}
run().catch(console.error);
