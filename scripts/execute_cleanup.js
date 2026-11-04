import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_ID = 'user-admin-001';

export async function executeCleanup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('[Cleanup] Starting production cleanup transaction...');

    // 1. Mock test child tables
    await client.query('DELETE FROM mock_test_responses');
    await client.query('DELETE FROM mock_test_proctoring_events');
    await client.query('DELETE FROM mock_test_audit_logs');
    await client.query('DELETE FROM mock_test_join_requests');
    await client.query('DELETE FROM mock_test_attempts');
    await client.query('DELETE FROM mock_test_questions');
    await client.query('DELETE FROM mock_test_sections');
    await client.query('DELETE FROM mock_tests');

    // 2. Quiz and Question Bank child tables
    await client.query('DELETE FROM quiz_attempt_answers');
    await client.query('DELETE FROM quiz_attempts');
    await client.query('DELETE FROM coding_test_cases');
    await client.query('DELETE FROM questions');
    await client.query('DELETE FROM quizzes');
    await client.query('DELETE FROM question_bank');

    // 3. Academic coursework, assignments, attendance
    await client.query('DELETE FROM assignment_submissions');
    await client.query('DELETE FROM assignments');
    await client.query('DELETE FROM attendance_records');
    await client.query('DELETE FROM lesson_progress');
    await client.query('DELETE FROM lessons');
    await client.query('DELETE FROM live_class_sessions');
    await client.query('DELETE FROM study_materials');
    await client.query('DELETE FROM syllabus_topics');
    await client.query('DELETE FROM timetable_entries');

    // 4. Batch & Class enrollments & assignments
    await client.query('DELETE FROM batch_enrollments');
    await client.query('DELETE FROM batch_teachers');
    await client.query('DELETE FROM teacher_assignments');
    await client.query('DELETE FROM student_class_enrollments');
    await client.query('DELETE FROM class_subjects');
    await client.query('DELETE FROM batches');
    await client.query('DELETE FROM classes');
    await client.query('DELETE FROM courses');
    await client.query('DELETE FROM subjects');

    // 5. Communications, tokens, profiles
    await client.query('DELETE FROM ai_chat_messages');
    await client.query('DELETE FROM announcements');
    await client.query('DELETE FROM email_verification_tokens');
    await client.query('DELETE FROM password_reset_tokens');
    await client.query('DELETE FROM teacher_invitations');
    await client.query('DELETE FROM leave_requests');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM student_profiles');
    await client.query('DELETE FROM teacher_profiles');

    // Optional / legacy tables if exist
    const hasEnrollments = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'enrollments'");
    if (hasEnrollments.rows.length) await client.query('DELETE FROM enrollments');

    const hasFeedback = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'feedback_tickets'");
    if (hasFeedback.rows.length) await client.query('DELETE FROM feedback_tickets');

    const hasCodingSubs = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'coding_submissions'");
    if (hasCodingSubs.rows.length) await client.query('DELETE FROM coding_submissions');

    // 6. Test activity logs
    await client.query('DELETE FROM audit_logs');
    await client.query('DELETE FROM security_logs');

    // 7. Non-admin users
    const delUsersRes = await client.query('DELETE FROM users WHERE id != $1 RETURNING id, email, role', [ADMIN_ID]);
    console.log(`[Cleanup] Deleted ${delUsersRes.rows.length} non-admin users.`);

    // 8. Verify admin preserved
    const adminRes = await client.query('SELECT id, email, full_name, role, status FROM users WHERE id = $1', [ADMIN_ID]);
    if (adminRes.rows.length !== 1) {
      throw new Error('Fatal error: Admin user was not found after deletion!');
    }

    await client.query('COMMIT');
    console.log('[Cleanup] Production cleanup transaction committed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Cleanup] Transaction failed, rolled back:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1].endsWith('execute_cleanup.js')) {
  executeCleanup().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
