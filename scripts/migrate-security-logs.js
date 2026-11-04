import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  console.log('[Migration] Creating security_logs table if not exists...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id VARCHAR(36) PRIMARY KEY,
      event_type VARCHAR(60) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
      user_id VARCHAR(255),
      user_email VARCHAR(255),
      ip_address VARCHAR(45),
      user_agent TEXT,
      details TEXT,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs (event_type);
    CREATE INDEX IF NOT EXISTS idx_security_logs_severity ON security_logs (severity);
    CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs (user_id);
  `);
  console.log('[Migration] security_logs table is ready.');

  // Also ensure audit_logs has index on created_at for performant pagination
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
  `);
  console.log('[Migration] audit_logs indexes verified.');

  await pool.end();
}

migrate().catch(err => {
  console.error('[Migration Error]', err);
  process.exit(1);
});
