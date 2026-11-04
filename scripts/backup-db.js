import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function backup() {
  console.log('[Backup] Discovering tables in public schema...');
  const tableRes = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );

  const tables = tableRes.rows.map(r => r.table_name);
  console.log(`[Backup] Found ${tables.length} tables to backup.`);

  const backupData = {
    timestamp: new Date().toISOString(),
    databaseUrl: process.env.DATABASE_URL.replace(/:[^:]*@/, ':***@'),
    tables: {}
  };

  for (const table of tables) {
    try {
      const res = await pool.query(`SELECT * FROM "${table}"`);
      backupData.tables[table] = res.rows;
      console.log(`[Backup] Table "${table}": ${res.rows.length} rows`);
    } catch (e) {
      console.error(`[Backup] Failed to backup table "${table}": ${e.message}`);
    }
  }

  const backupDir = path.resolve('../.backup');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFile = path.join(backupDir, `database-snapshot-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`[Backup] Complete database backup saved successfully to: ${backupFile}`);

  await pool.end();
}

backup().catch(console.error);
