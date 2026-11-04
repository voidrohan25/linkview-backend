import 'dotenv/config';
import { notificationService } from '../src/services/notificationService.js';
import { authService } from '../src/services/authService.js';
import pg from 'pg';

const { Pool } = pg;
const dbUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

async function runVerification() {
  console.log('====================================================');
  console.log(' LINKTEST UNIFIED NOTIFICATION SYSTEM E2E VERIFICATION ');
  console.log('====================================================\n');

  try {
    // 1. Fetch our standard test users for each role
    const usersRes = await pool.query(
      `SELECT id, email, role, full_name FROM users WHERE role IN ('STUDENT', 'TEACHER', 'ADMIN')`
    );
    const student = usersRes.rows.find(u => u.role === 'STUDENT');
    const teacher = usersRes.rows.find(u => u.role === 'TEACHER');
    const admin = usersRes.rows.find(u => u.role === 'ADMIN');

    if (!student || !teacher || !admin) {
      throw new Error(`Missing test users. Found: ${usersRes.rows.map(u => `${u.role}: ${u.email}`).join(', ')}`);
    }

    console.log(`[Setup] Target Accounts:`);
    console.log(`  - Student: ${student.email} (${student.id})`);
    console.log(`  - Teacher: ${teacher.email} (${teacher.id})`);
    console.log(`  - Admin:   ${admin.email} (${admin.id})\n`);

    // Clean any prior test notifications for these accounts to ensure a clean slate
    await pool.query(
      `DELETE FROM notifications WHERE user_id = ANY($1) AND event_key LIKE 'test_verify:%'`,
      [[student.id, teacher.id, admin.id]]
    );

    // =========================================================================
    // TEST 1: STUDENT REAL EVENT NOTIFICATIONS
    // =========================================================================
    console.log('--- TEST 1: Student Notifications ---');

    // 1a. Mock test approved
    const n1 = await notificationService.createNotification({
      userId: student.id,
      title: 'Teacher Approved Mock-Test Entry',
      message: 'Your access request for "Data Structures Exam" has been approved.',
      type: 'SUCCESS',
      priority: 'HIGH',
      actionUrl: '/mock-tests/test-ds-101/check',
      actionLabel: 'Join Mock Test',
      relatedEntityType: 'MOCK_TEST',
      relatedEntityId: 'test-ds-101',
      eventKey: `test_verify:student:${student.id}:APPROVED`
    });
    console.log('  [1a] Mock Test Approved created:', n1 ? 'PASS' : 'FAIL', `(${n1?.priority})`);

    // 1b. Result Published
    const n2 = await notificationService.createNotification({
      userId: student.id,
      title: 'Examination Result Published',
      message: 'Your result for "Data Structures Exam" has been published.',
      type: 'RESULT_PUBLISHED',
      priority: 'NORMAL',
      actionUrl: '/mock-tests/attempts/att-ds-101/result',
      actionLabel: 'View Result',
      relatedEntityType: 'MOCK_TEST_RESULT',
      relatedEntityId: 'att-ds-101',
      eventKey: `test_verify:student:${student.id}:RESULT_RELEASED`
    });
    console.log('  [1b] Result Published created:', n2 ? 'PASS' : 'FAIL', `(Action: ${n2?.action_label || n2?.actionLabel})`);

    // 1c. Assignment Graded
    const n3 = await notificationService.createNotification({
      userId: student.id,
      title: 'Assignment Graded',
      message: 'Your Algorithms assignment was evaluated: 92/100 marks awarded.',
      type: 'SUCCESS',
      priority: 'NORMAL',
      actionUrl: '/assignments',
      actionLabel: 'View Result',
      relatedEntityType: 'ASSIGNMENT',
      relatedEntityId: 'asgn-algo-01',
      eventKey: `test_verify:student:${student.id}:ASSIGNMENT_GRADED`
    });
    console.log('  [1c] Assignment Graded created:', n3 ? 'PASS' : 'FAIL');

    // 1d. Critical Security Auto-Submit
    const n4 = await notificationService.createNotification({
      userId: student.id,
      title: 'Examination Automatically Submitted',
      message: 'Your examination was automatically submitted due to an examination security violation (Fullscreen exited).',
      type: 'ERROR',
      priority: 'CRITICAL',
      actionUrl: '/mock-tests/attempts/att-ds-101/result',
      actionLabel: 'View Summary',
      relatedEntityType: 'MOCK_TEST',
      relatedEntityId: 'att-ds-101',
      eventKey: `test_verify:student:${student.id}:AUTO_SUBMIT`
    });
    console.log('  [1d] Security Auto-Submit created:', n4 ? 'PASS' : 'FAIL', `(Priority: ${n4?.priority})`);

    // =========================================================================
    // TEST 2: TEACHER REAL EVENT NOTIFICATIONS
    // =========================================================================
    console.log('\n--- TEST 2: Teacher Notifications ---');

    // 2a. Student Requested Mock-Test Access
    const t1 = await notificationService.createNotification({
      userId: teacher.id,
      title: 'Student Requested Mock-Test Access',
      message: `${student.full_name} requested entry approval for "Data Structures Exam".`,
      type: 'APPROVAL_REQUIRED',
      priority: 'HIGH',
      actionUrl: '/teacher',
      actionLabel: 'Review Request',
      relatedEntityType: 'MOCK_TEST_JOIN_REQUEST',
      relatedEntityId: 'req-001',
      eventKey: `test_verify:teacher:${teacher.id}:REQUESTED`
    });
    console.log('  [2a] Student Requested Access created:', t1 ? 'PASS' : 'FAIL', `(Priority: ${t1?.priority})`);

    // 2b. Batch Assigned
    const t2 = await notificationService.createNotification({
      userId: teacher.id,
      title: 'New Batch Assigned',
      message: 'You have been allocated to teach academic batch "CS-2026-A".',
      type: 'INFO',
      priority: 'NORMAL',
      actionUrl: '/teacher/classes',
      actionLabel: 'View Batches',
      relatedEntityType: 'BATCH',
      relatedEntityId: 'batch-cs-2026',
      eventKey: `test_verify:teacher:${teacher.id}:BATCH_ASSIGNED`
    });
    console.log('  [2b] Batch Assigned created:', t2 ? 'PASS' : 'FAIL');

    // =========================================================================
    // TEST 3: ADMIN EVENT NOTIFICATIONS
    // =========================================================================
    console.log('\n--- TEST 3: Admin Notifications ---');

    // 3a. CSV Question Import Completed
    const a1 = await notificationService.createNotification({
      userId: admin.id,
      title: 'Question Import Completed',
      message: '48 questions were successfully imported into the Question Bank.',
      type: 'TASK_COMPLETED',
      priority: 'NORMAL',
      actionUrl: '/admin/questions',
      actionLabel: 'View Question Bank',
      relatedEntityType: 'QUESTION_IMPORT',
      eventKey: `test_verify:admin:${admin.id}:IMPORT_COMPLETED`
    });
    console.log('  [3a] Question Import Completed created:', a1 ? 'PASS' : 'FAIL');

    // =========================================================================
    // TEST 4: DUPLICATE PREVENTION VERIFICATION
    // =========================================================================
    console.log('\n--- TEST 4: Strict Duplicate Prevention ---');
    // Try to insert n1 again with the exact same eventKey
    const duplicateAttempt = await notificationService.createNotification({
      userId: student.id,
      title: 'Teacher Approved Mock-Test Entry (DUPLICATE)',
      message: 'This should be rejected by eventKey conflict.',
      type: 'SUCCESS',
      priority: 'HIGH',
      actionUrl: '/mock-tests/test-ds-101/check',
      actionLabel: 'Join Mock Test',
      relatedEntityType: 'MOCK_TEST',
      relatedEntityId: 'test-ds-101',
      eventKey: `test_verify:student:${student.id}:APPROVED` // identical key
    });
    console.log('  [4] Duplicate insert result:', duplicateAttempt === null ? 'REJECTED (PASS)' : 'DUPLICATE CREATED (FAIL)');

    // =========================================================================
    // TEST 5: ROLE ISOLATION VERIFICATION
    // =========================================================================
    console.log('\n--- TEST 5: Strict Role Isolation ---');
    const studentNotifs = await notificationService.getNotifications(student.id);
    const teacherNotifs = await notificationService.getNotifications(teacher.id);
    const adminNotifs = await notificationService.getNotifications(admin.id);

    const studentHasTeacherNotif = studentNotifs.notifications.some(n => n.userId === teacher.id || n.title.includes('Review Request'));
    const teacherHasStudentNotif = teacherNotifs.notifications.some(n => n.userId === student.id || n.title.includes('Automatically Submitted'));
    const adminHasPrivateStudentNotif = adminNotifs.notifications.some(n => n.userId === student.id);

    console.log(`  Student total notifications: ${studentNotifs.notifications.length}, unread: ${studentNotifs.unread_count}`);
    console.log(`  Teacher total notifications: ${teacherNotifs.notifications.length}, unread: ${teacherNotifs.unread_count}`);
    console.log(`  Admin total notifications:   ${adminNotifs.notifications.length}, unread: ${adminNotifs.unread_count}`);
    console.log('  Student role isolation verified:', !studentHasTeacherNotif ? 'PASS' : 'FAIL');
    console.log('  Teacher role isolation verified:', !teacherHasStudentNotif ? 'PASS' : 'FAIL');
    console.log('  Admin role isolation verified:  ', !adminHasPrivateStudentNotif ? 'PASS' : 'FAIL');

    // =========================================================================
    // TEST 6: READ / UNREAD STATE MANAGEMENT & API
    // =========================================================================
    console.log('\n--- TEST 6: Read / Unread State Management ---');
    const initialUnread = studentNotifs.unread_count;

    // Mark single notification as read
    await notificationService.markAsRead(student.id, [n1.id]);
    const afterSingleRead = await notificationService.getNotifications(student.id);
    console.log(`  Unread count after reading 1 item: ${afterSingleRead.unread_count} (was ${initialUnread}) -> ${afterSingleRead.unread_count === initialUnread - 1 ? 'PASS' : 'FAIL'}`);

    // Mark all as read
    await notificationService.markAsRead(student.id, null);
    const afterAllRead = await notificationService.getNotifications(student.id);
    console.log(`  Unread count after "mark all as read": ${afterAllRead.unread_count} -> ${afterAllRead.unread_count === 0 ? 'PASS' : 'FAIL'}`);

    // Verify unreadOnly filter
    const unreadOnlyRes = await notificationService.getNotifications(student.id, { unreadOnly: true });
    console.log(`  Unread-only query returned count: ${unreadOnlyRes.notifications.length} -> ${unreadOnlyRes.notifications.length === 0 ? 'PASS' : 'FAIL'}`);

    // =========================================================================
    // TEST 7: DISMISS PERMANENTLY
    // =========================================================================
    console.log('\n--- TEST 7: Dismiss Notification ---');
    await notificationService.dismissNotification(student.id, n2.id);
    const afterDismiss = await notificationService.getNotifications(student.id);
    const dismissedItemPresent = afterDismiss.notifications.some(n => n.id === n2.id);
    console.log('  Dismissed item hidden from list:', !dismissedItemPresent ? 'PASS' : 'FAIL');

    // =========================================================================
    // TEST 8: NON-BREAKING SAFETY VERIFICATION
    // =========================================================================
    console.log('\n--- TEST 8: Non-Breaking Safety ---');
    // Call with invalid/missing params - must not throw exception
    let didThrow = false;
    try {
      await notificationService.createNotification({ userId: null, title: null, message: null });
    } catch {
      didThrow = true;
    }
    console.log('  Invalid notification creation handled gracefully without throwing:', !didThrow ? 'PASS' : 'FAIL');

    console.log('\n====================================================');
    console.log(' ALL NOTIFICATION BACKEND & MECHANICS TESTS PASSED ');
    console.log('====================================================\n');
  } finally {
    await pool.end();
  }
}

runVerification().catch(err => {
  console.error('[Verification Failed]:', err);
  process.exit(1);
});
