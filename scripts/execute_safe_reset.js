import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const APPLICATION_TABLES = [
  // 1. Mock test & exam tables
  'mock_test_audit_logs',
  'mock_test_proctoring_events',
  'mock_test_responses',
  'mock_test_attempts',
  'mock_test_questions',
  'mock_test_sections',
  'mock_test_join_requests',
  'mock_tests',

  // 2. Question bank & coding
  'coding_submissions',
  'coding_test_cases',
  'question_bank',

  // 3. Quizzes
  'quiz_attempt_answers',
  'quiz_attempts',
  'questions',
  'quizzes',

  // 4. Courses & lessons
  'lesson_progress',
  'lessons',
  'enrollments',
  'courses',

  // 5. Assignments & LMS activities
  'assignment_submissions',
  'assignments',
  'attendance_records',
  'study_materials',
  'syllabus_topics',
  'live_class_sessions',
  'timetable_entries',
  'class_subjects',

  // 6. Batches & Allocations
  'teacher_assignments',
  'batch_enrollments',
  'batch_teachers',
  'batches',
  'student_class_enrollments',
  'classes',

  // 7. Operations & Communication
  'leave_requests',
  'announcements',
  'notifications',
  'feedback_tickets',
  'ai_chat_messages',

  // 8. Logs
  'audit_logs',
  'security_logs',

  // 9. Auth tokens, profiles & users
  'email_verification_tokens',
  'password_reset_tokens',
  'teacher_invitations',
  'student_profiles',
  'teacher_profiles',
  'users'
];

const PRESERVED_REFERENCE_TABLES = [
  'academic_sessions',
  'subjects'
];

async function resetDatabase() {
  const client = await pool.connect();
  try {
    console.log('=== LINKTEST DATABASE RESET INITIALIZATION ===\n');
    console.log('1. Recording pre-cleanup record counts...');
    const preCounts = {};
    for (const table of APPLICATION_TABLES) {
      const res = await client.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
      preCounts[table] = res.rows[0].count;
    }
    for (const table of PRESERVED_REFERENCE_TABLES) {
      const res = await client.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
      preCounts[table] = res.rows[0].count;
    }

    console.log('2. Executing safe transaction cleanup...');
    await client.query('BEGIN');

    const truncateSql = `TRUNCATE TABLE ${APPLICATION_TABLES.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`;
    await client.query(truncateSql);

    await client.query('COMMIT');
    console.log('Transaction committed successfully.\n');

    console.log('3. Recording post-cleanup verification counts...');
    const postCounts = {};
    let allCleared = true;
    for (const table of APPLICATION_TABLES) {
      const res = await client.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
      postCounts[table] = res.rows[0].count;
      if (postCounts[table] !== 0) {
        allCleared = false;
        console.error(`ERROR: Table "${table}" was not cleared! Count: ${postCounts[table]}`);
      }
    }

    console.log('4. Verifying preserved reference tables...');
    for (const table of PRESERVED_REFERENCE_TABLES) {
      const res = await client.query(`SELECT COUNT(*)::int as count FROM "${table}"`);
      postCounts[table] = res.rows[0].count;
      console.log(`Preserved ${table}: ${postCounts[table]} records intact.`);
    }

    console.log('\n=== SUMMARY OF DELETED RECORDS ===');
    let totalDeleted = 0;
    for (const table of APPLICATION_TABLES) {
      const deleted = preCounts[table] - postCounts[table];
      totalDeleted += deleted;
      console.log(`${table}: ${deleted} deleted (now: ${postCounts[table]})`);
    }
    console.log(`\nTotal application records deleted: ${totalDeleted}`);
    console.log(`Verification status: ${allCleared ? 'SUCCESS - ALL APPLICATION TABLES AT 0' : 'FAILED'}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database reset failed, rolled back:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

resetDatabase().catch(err => {
  console.error(err);
  process.exit(1);
});
