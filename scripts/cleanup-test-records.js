import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function cleanup() {
  const client = await pool.connect();
  try {
    console.log('[Cleanup] Beginning safe production test data cleanup...');
    await client.query('BEGIN');

    // 1. Identify test users
    const testUserCondition = `
      email LIKE '%@example.com'
      OR email ~ '[0-9]{10}'
      OR email LIKE 'test.student.%'
      OR email LIKE 'unverified.%'
      OR email LIKE 'otp.test.%'
      OR email LIKE 'verified.student.%'
      OR email LIKE 'reuse.test.%'
      OR email LIKE 'cooldown.%'
      OR email LIKE 'lockout.%'
      OR email LIKE 'expired.%'
      OR email LIKE 'tamper.%'
      OR email LIKE 'concurrent.%'
      OR email LIKE 'smtp.failure.%'
      OR email LIKE 'student2.%'
      OR email LIKE 'other.teacher.%'
      OR email LIKE 'local.student.%'
      OR email LIKE 'unlink.test.%'
    `;

    const testUsersRes = await client.query(`SELECT id, email FROM users WHERE ${testUserCondition}`);
    const testUserIds = testUsersRes.rows.map(r => r.id);
    console.log(`[Cleanup] Identified ${testUserIds.length} automated test accounts for safe removal.`);

    // 2. Identify automated test mock tests
    const testMockCondition = `
      title LIKE 'Automated %'
      OR title LIKE 'Debug Test %'
      OR title LIKE 'Check Questions %'
      OR title IN ('test 1', 'Test 2', 'Test 3')
    `;
    const testMocksRes = await client.query(`SELECT id, title FROM mock_tests WHERE ${testMockCondition}`);
    const testMockIds = testMocksRes.rows.map(r => r.id);
    console.log(`[Cleanup] Identified ${testMockIds.length} automated test examinations for removal.`);

    // 3. Identify automated test batches
    const testBatchCondition = `code LIKE 'TEST_BATCH_%' OR code LIKE 'E2E-%'`;
    const testBatchesRes = await client.query(`SELECT id, name, code FROM batches WHERE ${testBatchCondition}`);
    const testBatchIds = testBatchesRes.rows.map(r => r.id);
    console.log(`[Cleanup] Identified ${testBatchIds.length} automated test cohorts for removal.`);

    // --- Clean mock test child records ---
    if (testMockIds.length > 0) {
      await client.query(`DELETE FROM mock_test_responses WHERE attempt_id IN (SELECT id FROM mock_test_attempts WHERE test_id = ANY($1))`, [testMockIds]);
      await client.query(`DELETE FROM mock_test_proctoring_events WHERE attempt_id IN (SELECT id FROM mock_test_attempts WHERE test_id = ANY($1))`, [testMockIds]);
      await client.query(`DELETE FROM mock_test_join_requests WHERE mock_test_id = ANY($1)`, [testMockIds]);
      await client.query(`DELETE FROM mock_test_audit_logs WHERE test_id = ANY($1)`, [testMockIds]);
      await client.query(`DELETE FROM mock_test_attempts WHERE test_id = ANY($1)`, [testMockIds]);
      await client.query(`DELETE FROM mock_test_questions WHERE test_id = ANY($1)`, [testMockIds]);
      await client.query(`DELETE FROM mock_tests WHERE id = ANY($1)`, [testMockIds]);
      console.log(`[Cleanup] Cleaned ${testMockIds.length} test mock tests and their child records.`);
    }

    // --- Clean batch child records ---
    if (testBatchIds.length > 0) {
      await client.query(`DELETE FROM batch_enrollments WHERE batch_id = ANY($1)`, [testBatchIds]);
      await client.query(`DELETE FROM batch_teachers WHERE batch_id = ANY($1)`, [testBatchIds]);
      await client.query(`DELETE FROM student_class_enrollments WHERE batch_id = ANY($1)`, [testBatchIds]);
      await client.query(`DELETE FROM timetable_entries WHERE batch_id = ANY($1)`, [testBatchIds]);
      await client.query(`DELETE FROM attendance_records WHERE batch_id = ANY($1)`, [testBatchIds]);
      await client.query(`DELETE FROM assignments WHERE batch_id = ANY($1)`, [testBatchIds]);
      await client.query(`DELETE FROM live_class_sessions WHERE batch_id = ANY($1)`, [testBatchIds]);
      await client.query(`DELETE FROM batches WHERE id = ANY($1)`, [testBatchIds]);
      console.log(`[Cleanup] Cleaned ${testBatchIds.length} test batches and their child records.`);
    }

    // --- Clean test users child records ---
    if (testUserIds.length > 0) {
      await client.query(`DELETE FROM email_verification_tokens WHERE user_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM quiz_attempt_answers WHERE attempt_id IN (SELECT id FROM quiz_attempts WHERE user_id = ANY($1))`, [testUserIds]);
      await client.query(`DELETE FROM quiz_attempts WHERE user_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM mock_test_responses WHERE attempt_id IN (SELECT id FROM mock_test_attempts WHERE student_id = ANY($1))`, [testUserIds]);
      await client.query(`DELETE FROM mock_test_proctoring_events WHERE attempt_id IN (SELECT id FROM mock_test_attempts WHERE student_id = ANY($1))`, [testUserIds]);
      await client.query(`DELETE FROM mock_test_join_requests WHERE student_id = ANY($1) OR teacher_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM mock_test_attempts WHERE student_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM student_profiles WHERE user_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM teacher_profiles WHERE user_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM batch_enrollments WHERE student_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM batch_teachers WHERE teacher_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM student_class_enrollments WHERE student_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1)`, [testUserIds]);
      await client.query(`DELETE FROM users WHERE id = ANY($1)`, [testUserIds]);
      console.log(`[Cleanup] Cleaned ${testUserIds.length} test users and their child records.`);
    }

    await client.query('COMMIT');
    console.log('[Cleanup] Production cleanup committed successfully!');

    // Post-cleanup summary
    const remainingUsers = await client.query('SELECT id, full_name, email, role, status FROM users ORDER BY created_at ASC');
    console.log('\n=== REMAINING ACTIVE USERS IN DATABASE ===');
    console.table(remainingUsers.rows);

    const remainingBatches = await client.query('SELECT id, name, code FROM batches');
    console.log('\n=== REMAINING BATCHES IN DATABASE ===');
    console.table(remainingBatches.rows);

    const remainingMocks = await client.query('SELECT id, title, subject, status FROM mock_tests');
    console.log('\n=== REMAINING MOCK TESTS IN DATABASE ===');
    console.table(remainingMocks.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Cleanup ERROR] Rolled back transaction due to error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup().catch(console.error);
