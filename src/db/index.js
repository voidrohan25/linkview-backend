import pg from 'pg';
import { config } from '../config/env.js';
import {
  SEED_USERS,
  SEED_COURSES,
  SEED_LESSONS,
  SEED_QUIZZES,
  SEED_QUESTIONS,
  SEED_TEACHER_PROFILES,
  SEED_STUDENT_PROFILES,
  SEED_ACADEMIC_SESSIONS,
  SEED_SUBJECTS,
  SEED_CLASSES,
  SEED_BATCHES,
  SEED_BATCH_TEACHERS,
  SEED_BATCH_ENROLLMENTS,
  SEED_CLASS_SUBJECTS,
  SEED_TEACHER_ASSIGNMENTS,
  SEED_STUDENT_CLASS_ENROLLMENTS,
  SEED_TIMETABLE,
  SEED_ASSIGNMENTS,
  SEED_ANNOUNCEMENTS,
  SEED_LIVE_CLASSES,
  SEED_SYLLABUS_TOPICS,
  SEED_STUDY_MATERIALS,
  SEED_LEAVE_REQUESTS,
  SEED_FEEDBACK_TICKETS,
  SEED_AUDIT_LOGS,
  SEED_NOTIFICATIONS,
  SEED_ATTENDANCE,
  SEED_ASSIGNMENT_SUBMISSIONS,
  SEED_ASSESSMENT_RESULTS,
  SEED_TEACHER_INVITATIONS,
  SEED_PASSWORD_RESET_TOKENS
} from './seedData.js';
import {
  SEED_MOCK_TESTS,
  SEED_MOCK_TEST_QUESTIONS,
  SEED_MOCK_TEST_ATTEMPTS,
  SEED_MOCK_TEST_RESPONSES,
  SEED_MOCK_TEST_PROCTORING_EVENTS
} from './seedMockTests.js';

const { Pool } = pg;

let pool = null;
let isPostgresConnected = false;

// In-Memory Fallback State (automatically seeded)
class InMemoryStore {
  constructor() {
    // Core user/auth
    this.users = [...SEED_USERS];
    this.email_verification_tokens = [];
    this.teacher_invitations = [...SEED_TEACHER_INVITATIONS];
    this.password_reset_tokens = [...SEED_PASSWORD_RESET_TOKENS];

    // Profiles
    this.teacher_profiles = [...SEED_TEACHER_PROFILES];
    this.student_profiles = [...SEED_STUDENT_PROFILES];

    // Academic structure
    this.academic_sessions = [...SEED_ACADEMIC_SESSIONS];
    this.subjects = [...SEED_SUBJECTS];
    this.classes = [...SEED_CLASSES];
    this.batches = [...SEED_BATCHES];
    this.batch_teachers = [...SEED_BATCH_TEACHERS];
    this.batch_enrollments = [...SEED_BATCH_ENROLLMENTS];
    this.class_subjects = [...SEED_CLASS_SUBJECTS];
    this.teacher_assignments = [...SEED_TEACHER_ASSIGNMENTS];
    this.student_class_enrollments = [...SEED_STUDENT_CLASS_ENROLLMENTS];

    // Timetable & Attendance
    this.timetable_entries = [...SEED_TIMETABLE];
    this.attendance_records = [...SEED_ATTENDANCE];

    // Courses & Learning
    this.courses = [...SEED_COURSES];
    this.lessons = [...SEED_LESSONS];
    this.enrollments = [];
    this.lesson_progress = [];

    // Quizzes & Assessments
    this.quizzes = [...SEED_QUIZZES];
    this.questions = [...SEED_QUESTIONS];
    this.quiz_attempts = [];
    this.quiz_attempt_answers = [];
    this.assessment_results = [...SEED_ASSESSMENT_RESULTS];

    // Assignments
    this.assignments = [...SEED_ASSIGNMENTS];
    this.assignment_submissions = [...SEED_ASSIGNMENT_SUBMISSIONS];

    // Content & Materials
    this.study_materials = [...SEED_STUDY_MATERIALS];
    this.syllabus_topics = [...SEED_SYLLABUS_TOPICS];

    // Communication
    this.announcements = [...SEED_ANNOUNCEMENTS];
    this.notifications = [...SEED_NOTIFICATIONS];

    // Live Classes
    this.live_class_sessions = [...SEED_LIVE_CLASSES];

    // HR & Support
    this.leave_requests = [...SEED_LEAVE_REQUESTS];
    this.feedback_tickets = [...SEED_FEEDBACK_TICKETS];

    // AI, Audit & Security Logs
    this.ai_chat_messages = [];
    this.audit_logs = [...SEED_AUDIT_LOGS];
    this.security_logs = [];

    // Secure Mock Tests & AI Examination System
    this.mock_tests = JSON.parse(JSON.stringify(SEED_MOCK_TESTS));
    this.mock_test_sections = [];
    this.mock_test_questions = JSON.parse(JSON.stringify(SEED_MOCK_TEST_QUESTIONS));
    this.mock_test_attempts = JSON.parse(JSON.stringify(SEED_MOCK_TEST_ATTEMPTS));
    this.mock_test_responses = JSON.parse(JSON.stringify(SEED_MOCK_TEST_RESPONSES));
    this.mock_test_proctoring_events = JSON.parse(JSON.stringify(SEED_MOCK_TEST_PROCTORING_EVENTS));
    this.mock_test_audit_logs = [];
    this.mock_test_join_requests = [];
    this.question_bank = [];
    this.coding_test_cases = [];
    this.coding_submissions = [];
  }

  get security_audit_logs() {
    return this.security_logs;
  }

  set security_audit_logs(val) {
    this.security_logs = val;
  }
}

export const memoryStore = new InMemoryStore();

// Initialize Postgres Pool with resilient SSL support
export async function initDb() {
  if (!config.databaseUrl) {
    console.log('[LinkTest DB] No DATABASE_URL provided. Operating in Memory Store mode.');
    return false;
  }

  try {
    const isNeonOrCloud = config.databaseUrl.includes('neon.tech') ||
                          config.databaseUrl.includes('render.com') ||
                          config.databaseUrl.includes('sslmode=require');

    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: isNeonOrCloud ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000
    });

    // Test connection with a fast heartbeat query
    const client = await pool.connect();
    const res = await client.query('SELECT NOW()');

    // Ensure live_class_sessions schema includes lifecycle timestamp columns
    try {
      await client.query(`
        ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP WITH TIME ZONE;
      `);
    } catch {
      // Table may not exist yet prior to migrations
    }

    client.release();

    isPostgresConnected = true;
    console.log(`[LinkTest DB] Connected successfully to PostgreSQL at ${res.rows[0].now}`);
    return true;
  } catch (err) {
    isPostgresConnected = false;
    console.error(`[LinkTest DB ALERT] PostgreSQL connection failed at DATABASE_URL: ${err.message}`);
    console.warn('[LinkTest DB WARNING] Persistent storage is UNAVAILABLE. The server is operating in ephemeral in-memory mode.');
    return false;
  }
}

export function getDbStatus() {
  return {
    isPostgres: isPostgresConnected,
    type: isPostgresConnected ? 'PostgreSQL' : 'InMemoryFallback',
    connected: isPostgresConnected,
    persistent_storage_available: isPostgresConnected,
    warning: isPostgresConnected ? null : 'PostgreSQL is offline. Changes will not persist across restarts.'
  };
}

// Unified query executor for PostgreSQL
export async function query(text, params) {
  if (isPostgresConnected && pool) {
    return pool.query(text, params);
  }
  throw new Error('PostgreSQL is not connected. Use Repository methods.');
}

export { pool, isPostgresConnected };
