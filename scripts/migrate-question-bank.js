import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function migrateQuestionBank() {
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

    console.log('[Migration] Creating question_bank table if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS question_bank (
        id VARCHAR(64) PRIMARY KEY,
        question_text TEXT NOT NULL,
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        correct_option_index INTEGER NOT NULL DEFAULT 0,
        correct_answer VARCHAR(10) NOT NULL DEFAULT 'A',
        subject VARCHAR(100) NOT NULL,
        topic VARCHAR(100) NOT NULL,
        difficulty VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        explanation TEXT,
        marks NUMERIC(6,2) NOT NULL DEFAULT 4.00,
        negative_marks NUMERIC(6,2) NOT NULL DEFAULT 1.00,
        created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
        subject_id VARCHAR(64) REFERENCES subjects(id) ON DELETE SET NULL,
        course_id VARCHAR(64) REFERENCES courses(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_question_bank_subject ON question_bank(subject);
      CREATE INDEX IF NOT EXISTS idx_question_bank_topic ON question_bank(topic);
      CREATE INDEX IF NOT EXISTS idx_question_bank_difficulty ON question_bank(difficulty);
      CREATE INDEX IF NOT EXISTS idx_question_bank_created_by ON question_bank(created_by);
      CREATE INDEX IF NOT EXISTS idx_question_bank_created_at ON question_bank(created_at);
    `);

    // Verify row count
    const countRes = await client.query('SELECT COUNT(*)::int as count FROM question_bank');
    console.log(`[Migration] question_bank table ready. Current record count: ${countRes.rows[0].count}`);

    client.release();
    console.log('[Migration] question_bank migration successfully finished.');
    process.exit(0);
  } catch (err) {
    console.error('[Migration] Failed to migrate question_bank:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateQuestionBank();
