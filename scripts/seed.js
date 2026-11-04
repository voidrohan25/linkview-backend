import pg from 'pg';
import dotenv from 'dotenv';
import {
  SEED_USERS,
  SEED_TEACHER_PROFILES,
  SEED_STUDENT_PROFILES,
  SEED_ACADEMIC_SESSIONS,
  SEED_SUBJECTS,
  SEED_CLASSES,
  SEED_BATCHES,
  SEED_CLASS_SUBJECTS,
  SEED_TEACHER_ASSIGNMENTS,
  SEED_STUDENT_CLASS_ENROLLMENTS,
  SEED_COURSES,
  SEED_LESSONS,
  SEED_QUIZZES,
  SEED_QUESTIONS,
  SEED_TIMETABLE,
  SEED_ASSIGNMENTS,
  SEED_ANNOUNCEMENTS,
  SEED_LIVE_CLASSES,
  SEED_SYLLABUS_TOPICS,
  SEED_STUDY_MATERIALS
} from '../src/db/seedData.js';
import {
  SEED_MOCK_TESTS,
  SEED_MOCK_TEST_QUESTIONS,
  SEED_MOCK_TEST_ATTEMPTS,
  SEED_MOCK_TEST_RESPONSES,
  SEED_MOCK_TEST_PROCTORING_EVENTS
} from '../src/db/seedMockTests.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const { Pool } = pg;

export async function runSeed({ dbUrl = null, dbPool = null } = {}) {
  const connectionUrl = (dbUrl !== null && dbUrl !== undefined ? dbUrl : (process.env.DATABASE_URL || '')).trim();
  if (!dbPool && !connectionUrl) {
    console.error('[Seed] Error: DATABASE_URL is not defined in environment.');
    throw new Error('[Seed] Error: DATABASE_URL is not defined in environment.');
  }

  let pool = dbPool;
  let shouldClosePool = false;

  if (!pool) {
    const isNeonOrCloud = connectionUrl.includes('neon.tech') ||
                          connectionUrl.includes('render.com') ||
                          connectionUrl.includes('supabase.co') ||
                          connectionUrl.includes('sslmode=require') ||
                          connectionUrl.includes('ssl=true');
    pool = new Pool({
      connectionString: connectionUrl,
      ssl: isNeonOrCloud ? { rejectUnauthorized: false } : false
    });
    shouldClosePool = true;
  }

  const client = await pool.connect();
  try {
    console.log('[Seed] Beginning LinkTest PostgreSQL database seeding...');
    await client.query('BEGIN');

    // 1. Seed Users
    console.log(`[Seed] Inserting ${SEED_USERS.length} seed users...`);
    for (const u of SEED_USERS) {
      await client.query(
        `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (email) DO UPDATE 
         SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
             status = EXCLUDED.status, email_verified = EXCLUDED.email_verified, email_verified_at = EXCLUDED.email_verified_at`,
        [u.id, u.full_name, u.email, u.password_hash, u.role, u.status || 'active', u.email_verified ?? true, u.email_verified_at || new Date().toISOString(), u.created_at]
      );
    }

    // 2. Seed Academic Sessions
    console.log(`[Seed] Inserting academic sessions...`);
    for (const s of SEED_ACADEMIC_SESSIONS) {
      await client.query(
        `INSERT INTO academic_sessions (id, name, start_date, end_date, is_current, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_current = EXCLUDED.is_current`,
        [s.id, s.name, s.start_date, s.end_date, s.is_current, s.created_at]
      );
    }

    // 3. Seed Teacher Profiles
    console.log(`[Seed] Inserting teacher profiles...`);
    for (const tp of SEED_TEACHER_PROFILES) {
      await client.query(
        `INSERT INTO teacher_profiles (id, user_id, employee_id, department, qualification, specialization, joining_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [tp.id, tp.user_id, tp.employee_id, tp.department, tp.qualification, tp.specialization, tp.joining_date, tp.created_at, tp.updated_at]
      );
    }

    // 4. Seed Student Profiles
    console.log(`[Seed] Inserting student profiles...`);
    for (const sp of SEED_STUDENT_PROFILES) {
      await client.query(
        `INSERT INTO student_profiles (id, user_id, enrollment_number, date_of_birth, guardian_name, guardian_contact, address, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [sp.id, sp.user_id, sp.enrollment_number, sp.date_of_birth, sp.guardian_name, sp.guardian_contact, sp.address, sp.created_at, sp.updated_at]
      );
    }

    // 5. Seed Subjects
    console.log(`[Seed] Inserting subjects...`);
    for (const sub of SEED_SUBJECTS) {
      await client.query(
        `INSERT INTO subjects (id, name, code, description, department, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code`,
        [sub.id, sub.name, sub.code, sub.description, sub.department, sub.status, sub.created_at]
      );
    }

    // 6. Seed Classes
    console.log(`[Seed] Inserting classes...`);
    for (const cl of SEED_CLASSES) {
      await client.query(
        `INSERT INTO classes (id, name, description, academic_session_id, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [cl.id, cl.name, cl.description, cl.academic_session_id, cl.created_at]
      );
    }

    // 7. Seed Batches
    console.log(`[Seed] Inserting batches...`);
    for (const b of SEED_BATCHES) {
      await client.query(
        `INSERT INTO batches (id, class_id, name, capacity, class_teacher_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity`,
        [b.id, b.class_id, b.name, b.capacity, b.class_teacher_id, b.created_at]
      );
    }

    // 8. Seed Class Subjects
    for (const cs of SEED_CLASS_SUBJECTS) {
      await client.query(
        `INSERT INTO class_subjects (id, class_id, subject_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [cs.id, cs.class_id, cs.subject_id]
      );
    }

    // 9. Seed Teacher Assignments
    for (const ta of SEED_TEACHER_ASSIGNMENTS) {
      await client.query(
        `INSERT INTO teacher_assignments (id, teacher_id, class_id, batch_id, subject_id, assigned_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [ta.id, ta.teacher_id, ta.class_id, ta.batch_id, ta.subject_id, ta.assigned_at]
      );
    }

    // 10. Seed Student Class Enrollments
    for (const sce of SEED_STUDENT_CLASS_ENROLLMENTS) {
      await client.query(
        `INSERT INTO student_class_enrollments (id, student_id, class_id, batch_id, enrolled_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [sce.id, sce.student_id, sce.class_id, sce.batch_id, sce.enrolled_at]
      );
    }

    // 11. Seed Courses
    console.log(`[Seed] Inserting ${SEED_COURSES.length} seed courses...`);
    for (const c of SEED_COURSES) {
      await client.query(
        `INSERT INTO courses (id, title, description, category, thumbnail_url, instructor_name, instructor_id, status, published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category`,
        [c.id, c.title, c.description, c.category, c.thumbnail_url, c.instructor_name, c.instructor_id, c.status || 'published', c.published, c.created_at, c.updated_at]
      );
    }

    // 12. Seed Lessons
    console.log(`[Seed] Inserting ${SEED_LESSONS.length} seed lessons...`);
    for (const l of SEED_LESSONS) {
      await client.query(
        `INSERT INTO lessons (id, course_id, title, content, video_url, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, content = EXCLUDED.content, video_url = EXCLUDED.video_url, position = EXCLUDED.position`,
        [l.id, l.course_id, l.title, l.content, l.video_url, l.position]
      );
    }

    // 13. Seed Quizzes
    console.log(`[Seed] Inserting ${SEED_QUIZZES.length} seed quizzes...`);
    for (const q of SEED_QUIZZES) {
      await client.query(
        `INSERT INTO quizzes (id, course_id, title, description, teacher_id, status, duration_minutes, pass_percentage, results_published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description`,
        [q.id, q.course_id, q.title, q.description, q.teacher_id, q.status || 'published', q.duration_minutes || 20, q.pass_percentage || 60, q.results_published ?? true, q.created_at, q.updated_at]
      );
    }

    // 14. Seed Questions
    console.log(`[Seed] Inserting ${SEED_QUESTIONS.length} quiz questions...`);
    for (const qu of SEED_QUESTIONS) {
      await client.query(
        `INSERT INTO questions (id, quiz_id, question_text, options, correct_option_index, explanation, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE
         SET question_text = EXCLUDED.question_text, options = EXCLUDED.options, 
             correct_option_index = EXCLUDED.correct_option_index, explanation = EXCLUDED.explanation`,
        [qu.id, qu.quiz_id, qu.question_text, JSON.stringify(qu.options), qu.correct_option_index, qu.explanation, qu.position]
      );
    }

    // 15. Seed Timetable
    console.log(`[Seed] Inserting timetable entries...`);
    for (const tt of SEED_TIMETABLE) {
      await client.query(
        `INSERT INTO timetable_entries (id, class_id, batch_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, academic_session_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [tt.id, tt.class_id, tt.batch_id, tt.subject_id, tt.teacher_id, tt.day_of_week, tt.start_time, tt.end_time, tt.room, tt.academic_session_id, tt.created_at]
      );
    }

    // 16. Seed Assignments
    console.log(`[Seed] Inserting assignments...`);
    for (const as of SEED_ASSIGNMENTS) {
      await client.query(
        `INSERT INTO assignments (id, title, instructions, subject_id, class_id, batch_id, teacher_id, issue_date, due_date, max_marks, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, instructions = EXCLUDED.instructions`,
        [as.id, as.title, as.instructions, as.subject_id, as.class_id, as.batch_id, as.teacher_id, as.issue_date, as.due_date, as.max_marks, as.status, as.created_at, as.updated_at]
      );
    }

    // 17. Seed Announcements
    console.log(`[Seed] Inserting announcements...`);
    for (const an of SEED_ANNOUNCEMENTS) {
      await client.query(
        `INSERT INTO announcements (id, title, content, author_id, target_type, target_id, status, publish_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [an.id, an.title, an.content, an.author_id, an.target_type, an.target_id, an.status, an.publish_at, an.created_at, an.updated_at]
      );
    }

    // 18. Seed Live Classes
    console.log(`[Seed] Inserting live classes...`);
    for (const lc of SEED_LIVE_CLASSES) {
      await client.query(
        `INSERT INTO live_class_sessions (id, title, description, teacher_id, class_id, batch_id, subject_id, scheduled_at, meeting_url, meeting_provider, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [lc.id, lc.title, lc.description, lc.teacher_id, lc.class_id, lc.batch_id, lc.subject_id, lc.scheduled_at, lc.meeting_url || null, lc.meeting_provider || 'external', lc.status, lc.created_at]
      );
    }

    // 19. Seed Syllabus Topics
    console.log(`[Seed] Inserting syllabus topics...`);
    for (const syl of SEED_SYLLABUS_TOPICS) {
      await client.query(
        `INSERT INTO syllabus_topics (id, subject_id, class_id, teacher_id, chapter, topic, planned_date, completed, completed_date, notes, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [syl.id, syl.subject_id, syl.class_id, syl.teacher_id, syl.chapter, syl.topic, syl.planned_date, syl.completed, syl.completed_date, syl.notes, syl.position, syl.created_at]
      );
    }

    // 20. Seed Study Materials
    console.log(`[Seed] Inserting study materials...`);
    for (const sm of SEED_STUDY_MATERIALS) {
      await client.query(
        `INSERT INTO study_materials (id, title, description, type, external_url, subject_id, class_id, course_id, uploaded_by, published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [sm.id, sm.title, sm.description, sm.type, sm.external_url, sm.subject_id, sm.class_id, sm.course_id, sm.uploaded_by, sm.published, sm.created_at, sm.updated_at]
      );
    }

    // 21. Seed Mock Tests
    console.log(`[Seed] Inserting ${SEED_MOCK_TESTS.length} mock tests...`);
    for (const t of SEED_MOCK_TESTS) {
      await client.query(
        `INSERT INTO mock_tests (
           id, title, description, instructions, subject, topic, difficulty, category, tags,
           created_by, class_id, batch_id, course_id, scheduled_start, scheduled_end,
           duration_minutes, total_marks, pass_percentage, max_attempts, randomize_questions,
           randomize_options, negative_marking, negative_mark_penalty, proctoring_config,
           status, results_published, allow_instant_result, show_explanations, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id, t.title, t.description, t.instructions, t.subject, t.topic, t.difficulty, t.category, JSON.stringify(t.tags),
          t.created_by, t.class_id, t.batch_id, t.course_id, t.scheduled_start, t.scheduled_end,
          t.duration_minutes, t.total_marks, t.pass_percentage, t.max_attempts, t.randomize_questions,
          t.randomize_options, t.negative_marking, t.negative_mark_penalty, JSON.stringify(t.proctoring_config),
          t.status, t.results_published, t.allow_instant_result, t.show_explanations, t.created_at, t.updated_at
        ]
      );
    }

    // 22. Seed Mock Test Questions
    console.log(`[Seed] Inserting ${SEED_MOCK_TEST_QUESTIONS.length} mock test questions...`);
    for (const q of SEED_MOCK_TEST_QUESTIONS) {
      await client.query(
        `INSERT INTO mock_test_questions (
           id, test_id, section_id, question_text, question_type, options, answer_key,
           marks, negative_marks, explanation, topic, difficulty, order_index, case_passage,
           image_url, metadata, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO NOTHING`,
        [
          q.id, q.test_id, q.section_id, q.question_text, q.question_type, JSON.stringify(q.options || []), JSON.stringify(q.answer_key),
          q.marks, q.negative_marks, q.explanation, q.topic, q.difficulty, q.order_index, q.case_passage,
          q.image_url, JSON.stringify(q.metadata || {}), new Date().toISOString()
        ]
      );
    }

    // 23. Seed Sample Attempt & Responses
    console.log(`[Seed] Inserting demo student mock test attempt...`);
    for (const att of SEED_MOCK_TEST_ATTEMPTS) {
      await client.query(
        `INSERT INTO mock_test_attempts (
           id, test_id, student_id, started_at, expires_at, submitted_at, status,
           total_score, max_score, percentage, passed, correct_count, incorrect_count,
           unanswered_count, time_spent_seconds, warning_count, test_snapshot, proctoring_summary,
           evaluator_remarks, evaluated_by, evaluated_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
         ON CONFLICT (id) DO NOTHING`,
        [
          att.id, att.test_id, att.student_id, att.started_at, att.expires_at, att.submitted_at, att.status,
          att.total_score, att.max_score, att.percentage, att.passed, att.correct_count, att.incorrect_count,
          att.unanswered_count, att.time_spent_seconds, att.warning_count, JSON.stringify(att.test_snapshot), JSON.stringify(att.proctoring_summary),
          att.evaluator_remarks, att.evaluated_by, att.evaluated_at, att.created_at, att.updated_at
        ]
      );
    }

    for (const resp of SEED_MOCK_TEST_RESPONSES) {
      await client.query(
        `INSERT INTO mock_test_responses (
           id, attempt_id, question_id, response_data, is_marked_for_review, is_visited,
           score_awarded, is_correct, evaluation_comment, evaluated_by, evaluated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (attempt_id, question_id) DO NOTHING`,
        [
          resp.id, resp.attempt_id, resp.question_id, JSON.stringify(resp.response_data), resp.is_marked_for_review, resp.is_visited,
          resp.score_awarded, resp.is_correct, resp.evaluation_comment, resp.evaluated_by, resp.evaluated_at
        ]
      );
    }

    for (const evt of SEED_MOCK_TEST_PROCTORING_EVENTS) {
      await client.query(
        `INSERT INTO mock_test_proctoring_events (
           id, attempt_id, event_type, severity, client_timestamp, server_timestamp,
           duration_seconds, confidence, metadata, review_status, review_notes, reviewed_by, reviewed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING`,
        [
          evt.id, evt.attempt_id, evt.event_type, evt.severity, evt.client_timestamp, evt.server_timestamp,
          evt.duration_seconds, evt.confidence, JSON.stringify(evt.metadata), evt.review_status, evt.review_notes, evt.reviewed_by, evt.reviewed_at
        ]
      );
    }

    await client.query('COMMIT');
    console.log('================================================================');
    console.log('  LinkTest Database Seeding Completed Successfully!             ');
    console.log('----------------------------------------------------------------');
    console.log('  Student User:  student@linktest.io   | Password: Student123!   ');
    console.log('  Teacher User:  teacher@linktest.io   | Password: Teacher123!   ');
    console.log('  Admin User:    admin@linktest.io     | Password: Admin123!     ');
    console.log('================================================================');
    return true;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('[Seed Error] Rollback error:', rbErr.message);
    }
    console.error('[Seed] Database seeding failed:', err.message);
    throw err;
  } finally {
    client.release();
    if (shouldClosePool && pool) {
      await pool.end();
    }
  }
}

async function runCli() {
  try {
    await runSeed();
    process.exit(0);
  } catch (err) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli();
}
