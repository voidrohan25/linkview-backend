import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: 'c:/Users/abhis/linktest/backend/.env' });

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('[Clean Data] Fatal: DATABASE_URL not found in environment.');
  process.exit(1);
}

const isNeonOrCloud = dbUrl.includes('neon.tech') || dbUrl.includes('render.com') || dbUrl.includes('sslmode=require');
const pool = new Pool({
  connectionString: dbUrl,
  ssl: isNeonOrCloud ? { rejectUnauthorized: false } : false
});

// Tables to be completely truncated (ordered from child/dependent tables to parent tables)
const APPLICATION_TABLES_TO_TRUNCATE = [
  // Examination, Testing & AI Proctoring
  'mock_test_responses',
  'mock_test_proctoring_events',
  'mock_test_audit_logs',
  'mock_test_attempts',
  'mock_test_join_requests',
  'mock_test_questions',
  'mock_test_sections',
  'mock_tests',
  'coding_submissions',
  'coding_test_cases',
  'question_bank',
  'quiz_attempt_answers',
  'quiz_attempts',
  'questions',
  'quizzes',

  // LMS, Courses & Learning
  'assignment_submissions',
  'assignments',
  'lesson_progress',
  'lessons',
  'enrollments',
  'courses',
  'study_materials',
  'syllabus_topics',
  'live_class_sessions',
  'attendance_records',
  'timetable_entries',
  'teacher_assignments',
  'class_subjects',
  'student_class_enrollments',
  'batch_enrollments',
  'batch_teachers',
  'batches',
  'classes',

  // Communication, Support & Notifications
  'announcements',
  'notifications',
  'feedback_tickets',
  'leave_requests',
  'ai_chat_messages',

  // Auth, Profile & Audit Records
  'email_verification_tokens',
  'password_reset_tokens',
  'teacher_invitations',
  'student_profiles',
  'teacher_profiles',
  'audit_logs',
  'security_logs',

  // Core Users table
  'users'
];

// Reference tables that must be preserved
const PRESERVED_REFERENCE_TABLES = [
  'academic_sessions',
  'subjects'
];

async function runCleanup() {
  const client = await pool.connect();
  try {
    console.log('====================================================');
    console.log('       LinkTest Database Clean Slate Initialization  ');
    console.log('====================================================');
    console.log(`Connecting to database...`);

    await client.query('BEGIN');

    console.log(`\n[Step 1] Truncating ${APPLICATION_TABLES_TO_TRUNCATE.length} application test tables...`);
    const truncateSql = `TRUNCATE TABLE ${APPLICATION_TABLES_TO_TRUNCATE.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`;
    await client.query(truncateSql);
    console.log('[Step 1] Successfully truncated all application test tables.');

    console.log(`\n[Step 2] Re-provisioning single clean canonical system Administrator...`);
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@linktest.io').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'LinkTest#ProdAdmin2026!';
    const adminName = process.env.ADMIN_NAME || 'Dr. Priya Patel';
    const adminId = 'user-admin-001';
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const now = new Date().toISOString();

    const insertAdminSql = `
      INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
      VALUES ($1, $2, $3, $4, 'ADMIN', 'active', true, $5, $5)
      RETURNING id, full_name, email, role, status, email_verified;
    `;
    const adminRes = await client.query(insertAdminSql, [adminId, adminName, adminEmail, passwordHash, now]);
    console.log('[Step 2] Administrator account created:');
    console.log(adminRes.rows[0]);

    await client.query('COMMIT');
    console.log('\n[Step 3] Transaction COMMITTED successfully.');

    // Step 4: Verification of empty state across all tables
    console.log('\n[Step 4] Verifying row counts across all 48 database tables:');
    const allTablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const summary = [];
    for (const r of allTablesRes.rows) {
      const countRes = await client.query(`SELECT count(*)::int as count FROM "${r.table_name}"`);
      summary.push({ table: r.table_name, count: countRes.rows[0].count });
    }

    console.log('\n--- APPLICATION DATA TABLES (Target: 0, users: 1) ---');
    summary
      .filter(s => !PRESERVED_REFERENCE_TABLES.includes(s.table))
      .forEach(s => console.log(`  ${s.table.padEnd(32)}: ${s.count}`));

    console.log('\n--- PRESERVED REFERENCE TABLES ---');
    summary
      .filter(s => PRESERVED_REFERENCE_TABLES.includes(s.table))
      .forEach(s => console.log(`  ${s.table.padEnd(32)}: ${s.count}`));

    // Step 5: Verify Schema Integrity (Constraints, Indexes, Foreign Keys)
    console.log('\n[Step 5] Checking schema integrity...');
    const fkRes = await client.query(`
      SELECT count(*)::int as fk_count 
      FROM information_schema.table_constraints 
      WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';
    `);
    const idxRes = await client.query(`
      SELECT count(*)::int as index_count 
      FROM pg_indexes 
      WHERE schemaname = 'public';
    `);
    const uqRes = await client.query(`
      SELECT count(*)::int as unique_count 
      FROM information_schema.table_constraints 
      WHERE constraint_type IN ('UNIQUE', 'PRIMARY KEY') AND table_schema = 'public';
    `);

    console.log(`  Foreign Key Constraints intact : ${fkRes.rows[0].fk_count}`);
    console.log(`  Indexes intact                 : ${idxRes.rows[0].index_count}`);
    console.log(`  Primary & Unique Constraints   : ${uqRes.rows[0].unique_count}`);
    console.log('\nDatabase cleanup complete. Database is now in a pristine state.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Clean Data] Transaction failed and ROLLED BACK:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runCleanup().catch(err => {
  console.error(err);
  process.exit(1);
});
