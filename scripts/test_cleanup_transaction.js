import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_ID = 'user-admin-001';

async function testDryRun() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('[Dry Run] Transaction started...');

    // 1. Mock test attempt child tables
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
    if ((await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'enrollments'")).rows.length) {
      await client.query('DELETE FROM enrollments');
    }
    if ((await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'feedback_tickets'")).rows.length) {
      await client.query('DELETE FROM feedback_tickets');
    }
    if ((await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'coding_submissions'")).rows.length) {
      await client.query('DELETE FROM coding_submissions');
    }

    // 6. Test activity logs
    await client.query('DELETE FROM audit_logs');
    await client.query('DELETE FROM security_logs');

    // 7. Non-admin users
    const delUsersRes = await client.query('DELETE FROM users WHERE id != $1 RETURNING id, email, role', [ADMIN_ID]);
    console.log(`[Dry Run] Successfully deleted ${delUsersRes.rows.length} test users.`);

    // 8. Verify Admin remains intact
    const adminRes = await client.query('SELECT id, email, full_name, role, status FROM users WHERE id = $1', [ADMIN_ID]);
    console.log('[Dry Run] Admin user check:', adminRes.rows[0]);

    if (adminRes.rows.length !== 1) {
      throw new Error('Admin user was not preserved correctly!');
    }

    console.log('[Dry Run] All FK cascades and targeted DELETE statements succeeded without errors!');
    await client.query('ROLLBACK');
    console.log('[Dry Run] Transaction rolled back cleanly.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Dry Run] Failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

testDryRun().catch(console.error);
