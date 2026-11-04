import { pool, isPostgresConnected, initDb } from '../src/db/index.js';

async function updateSchema() {
  await initDb();
  if (isPostgresConnected && pool) {
    await pool.query(`
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'NORMAL';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_label VARCHAR(100);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(50);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(64);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_key VARCHAR(128);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key ON notifications (event_key);
    `);
    console.log('[Schema] Notifications table columns & unique index verified/added successfully.');
  } else {
    console.log('[Schema] Operating in in-memory mode or Postgres not connected.');
  }
  process.exit(0);
}

updateSchema().catch(err => {
  console.error('[Schema] Error updating schema:', err);
  process.exit(1);
});
