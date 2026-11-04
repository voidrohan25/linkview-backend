import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function migrateNotifications() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[Migration] DATABASE_URL is not set.');
    process.exit(1);
  }

  const isNeonOrCloud = dbUrl.includes('neon.tech') || dbUrl.includes('render.com') || dbUrl.includes('sslmode=require');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isNeonOrCloud ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('[Migration] Connecting to database...');
    const client = await pool.connect();

    console.log('[Migration] Ensuring notifications table columns and indexes...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'info',
        link TEXT,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'NORMAL';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(50);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(100);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url VARCHAR(255);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_label VARCHAR(100);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_key VARCHAR(255);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key ON notifications (event_key) WHERE event_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read) WHERE read = false;
    `);

    const colRes = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'notifications'
      ORDER BY ordinal_position
    `);
    console.log('[Migration] Current notifications columns:', colRes.rows.map(r => r.column_name).join(', '));

    client.release();
    await pool.end();
    console.log('[Migration] notifications migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[Migration] Failed to migrate notifications:', err);
    process.exit(1);
  }
}

migrateNotifications();
