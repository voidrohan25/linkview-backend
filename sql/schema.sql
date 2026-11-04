-- LinkTest PostgreSQL Database Schema
-- Version: 2.0.0 (Comprehensive LMS: Admin + Teacher + Student + AI)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS coding_submissions CASCADE;
DROP TABLE IF EXISTS coding_test_cases CASCADE;
DROP TABLE IF EXISTS question_bank CASCADE;
DROP TABLE IF EXISTS mock_test_join_requests CASCADE;
DROP TABLE IF EXISTS mock_test_audit_logs CASCADE;
DROP TABLE IF EXISTS mock_test_proctoring_events CASCADE;
DROP TABLE IF EXISTS mock_test_responses CASCADE;
DROP TABLE IF EXISTS mock_test_attempts CASCADE;
DROP TABLE IF EXISTS mock_test_questions CASCADE;
DROP TABLE IF EXISTS mock_test_sections CASCADE;
DROP TABLE IF EXISTS mock_tests CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS teacher_invitations CASCADE;
DROP TABLE IF EXISTS live_class_sessions CASCADE;
DROP TABLE IF EXISTS feedback_tickets CASCADE;
DROP TABLE IF EXISTS leave_requests CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS syllabus_topics CASCADE;
DROP TABLE IF EXISTS study_materials CASCADE;
DROP TABLE IF EXISTS assignment_submissions CASCADE;
DROP TABLE IF EXISTS assignments CASCADE;
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS timetable_entries CASCADE;
DROP TABLE IF EXISTS student_class_enrollments CASCADE;
DROP TABLE IF EXISTS teacher_assignments CASCADE;
DROP TABLE IF EXISTS class_subjects CASCADE;
DROP TABLE IF EXISTS batch_enrollments CASCADE;
DROP TABLE IF EXISTS batch_teachers CASCADE;
DROP TABLE IF EXISTS batches CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS academic_sessions CASCADE;
DROP TABLE IF EXISTS student_profiles CASCADE;
DROP TABLE IF EXISTS teacher_profiles CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS email_verification_tokens CASCADE;
DROP TABLE IF EXISTS ai_chat_messages CASCADE;
DROP TABLE IF EXISTS quiz_attempt_answers CASCADE;
DROP TABLE IF EXISTS quiz_attempts CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS quizzes CASCADE;
DROP TABLE IF EXISTS lesson_progress CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS lessons CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. USERS
CREATE TABLE users (
    id VARCHAR(64) PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
    email_verified BOOLEAN NOT NULL DEFAULT false,
    email_verified_at TIMESTAMP WITH TIME ZONE NULL,
    phone VARCHAR(30) NULL,
    avatar_url TEXT NULL,
    last_login_at TIMESTAMP WITH TIME ZONE NULL,
    google_id VARCHAR(255) UNIQUE NULL,
    auth_provider VARCHAR(50) NOT NULL DEFAULT 'local',
    account_linked_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_verified ON users(email_verified);
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_auth_provider ON users(auth_provider);

-- 2. TEACHER PROFILES
CREATE TABLE teacher_profiles (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    employee_id VARCHAR(64) NULL,
    department VARCHAR(150) NULL,
    qualification VARCHAR(255) NULL,
    specialization TEXT NULL,
    joining_date DATE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_teacher_profiles_user ON teacher_profiles(user_id);

-- 3. STUDENT PROFILES
CREATE TABLE student_profiles (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    enrollment_number VARCHAR(64) NULL,
    date_of_birth DATE NULL,
    guardian_name VARCHAR(150) NULL,
    guardian_contact VARCHAR(30) NULL,
    address TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_student_profiles_user ON student_profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_enrollment_number
    ON student_profiles(enrollment_number);

-- 4. ACADEMIC SESSIONS
CREATE TABLE academic_sessions (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. SUBJECTS
CREATE TABLE subjects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS department VARCHAR(150);
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

CREATE INDEX idx_subjects_code ON subjects(code);
CREATE INDEX IF NOT EXISTS idx_subjects_department_status ON subjects(department, status);

-- 6. CLASSES
CREATE TABLE classes (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    academic_session_id VARCHAR(64) REFERENCES academic_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 25. COURSES
CREATE TABLE courses (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    thumbnail_url TEXT,
    instructor_name VARCHAR(150) NOT NULL,
    instructor_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'published',
    published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_courses_category ON courses(category);
CREATE INDEX idx_courses_published ON courses(published);

-- 7. BATCHES / SECTIONS
CREATE TABLE batches (
    id VARCHAR(64) PRIMARY KEY,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE CASCADE,
    course_id VARCHAR(64) REFERENCES courses(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE,
    description TEXT,
    start_date DATE,
    end_date DATE,
    capacity INTEGER NOT NULL DEFAULT 40,
    status VARCHAR(20) NOT NULL DEFAULT 'Active',
    class_teacher_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_batches_class ON batches(class_id);
CREATE INDEX idx_batches_course ON batches(course_id);
CREATE INDEX idx_batches_code ON batches(code);
CREATE INDEX idx_batches_status ON batches(status);

-- 7b. BATCH TEACHER ALLOCATIONS
CREATE TABLE batch_teachers (
    id VARCHAR(64) PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_id, teacher_id)
);

CREATE INDEX idx_bt_batch ON batch_teachers(batch_id);
CREATE INDEX idx_bt_teacher ON batch_teachers(teacher_id);

-- 7c. BATCH STUDENT ENROLLMENTS
CREATE TABLE batch_enrollments (
    id VARCHAR(64) PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrolled_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_id, student_id)
);

CREATE INDEX idx_be_batch ON batch_enrollments(batch_id);
CREATE INDEX idx_be_student ON batch_enrollments(student_id);
CREATE INDEX idx_be_status ON batch_enrollments(status);

-- 8. CLASS SUBJECTS (Mapping)
CREATE TABLE class_subjects (
    id VARCHAR(64) PRIMARY KEY,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    CONSTRAINT uq_class_subject UNIQUE (class_id, subject_id)
);

-- 9. TEACHER ASSIGNMENTS
CREATE TABLE teacher_assignments (
    id VARCHAR(64) PRIMARY KEY,
    teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
    subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_teacher_assignment UNIQUE (teacher_id, class_id, batch_id, subject_id)
);

CREATE INDEX idx_teacher_asgn_teacher ON teacher_assignments(teacher_id);
CREATE INDEX idx_teacher_asgn_class ON teacher_assignments(class_id);

-- 10. STUDENT CLASS ENROLLMENTS
CREATE TABLE student_class_enrollments (
    id VARCHAR(64) PRIMARY KEY,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_student_class UNIQUE (student_id, class_id)
);

CREATE INDEX idx_student_class_student ON student_class_enrollments(student_id);
CREATE INDEX idx_student_class_class ON student_class_enrollments(class_id);

-- 11. TIMETABLE ENTRIES
CREATE TABLE timetable_entries (
    id VARCHAR(64) PRIMARY KEY,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
    subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    room VARCHAR(50),
    academic_session_id VARCHAR(64) REFERENCES academic_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_timetable_class ON timetable_entries(class_id);
CREATE INDEX idx_timetable_teacher ON timetable_entries(teacher_id);
CREATE INDEX idx_timetable_day ON timetable_entries(day_of_week);

-- 12. ATTENDANCE RECORDS
CREATE TABLE attendance_records (
    id VARCHAR(64) PRIMARY KEY,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
    subject_id VARCHAR(64) REFERENCES subjects(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
    remarks TEXT,
    marked_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    correction_reason TEXT,
    corrected_at TIMESTAMP WITH TIME ZONE,
    corrected_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_student_subject_date_attendance UNIQUE (student_id, class_id, subject_id, date)
);

CREATE INDEX idx_attendance_student ON attendance_records(student_id);
CREATE INDEX idx_attendance_date ON attendance_records(date);
CREATE INDEX idx_attendance_class ON attendance_records(class_id);

-- 13. ASSIGNMENTS
CREATE TABLE assignments (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    instructions TEXT,
    subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
    teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    max_marks INTEGER NOT NULL DEFAULT 100,
    status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'closed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assignments_class ON assignments(class_id);
CREATE INDEX idx_assignments_teacher ON assignments(teacher_id);
CREATE INDEX idx_assignments_due ON assignments(due_date);

-- 14. ASSIGNMENT SUBMISSIONS
CREATE TABLE assignment_submissions (
    id VARCHAR(64) PRIMARY KEY,
    assignment_id VARCHAR(64) NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,
    file_path TEXT,
    file_name VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'returned')),
    marks_obtained NUMERIC(5,2),
    feedback TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    graded_at TIMESTAMP WITH TIME ZONE,
    graded_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_assignment_student_submission UNIQUE (assignment_id, student_id)
);

CREATE INDEX idx_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX idx_submissions_student ON assignment_submissions(student_id);

-- 15. STUDY MATERIALS
CREATE TABLE study_materials (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(30) NOT NULL DEFAULT 'link' CHECK (type IN ('pdf', 'video', 'link', 'doc', 'slides', 'document')),
    file_path TEXT,
    file_name VARCHAR(255),
    file_size BIGINT,
    external_url TEXT,
    subject_id VARCHAR(64) REFERENCES subjects(id) ON DELETE SET NULL,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    course_id VARCHAR(64),
    lesson_id VARCHAR(64),
    uploaded_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_materials_subject ON study_materials(subject_id);
CREATE INDEX idx_materials_class ON study_materials(class_id);

-- 16. SYLLABUS TOPICS
CREATE TABLE syllabus_topics (
    id VARCHAR(64) PRIMARY KEY,
    subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    chapter VARCHAR(150),
    topic VARCHAR(255) NOT NULL,
    planned_date DATE,
    completed BOOLEAN NOT NULL DEFAULT false,
    completed_date DATE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
    position INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_syllabus_subject ON syllabus_topics(subject_id);
CREATE INDEX idx_syllabus_class ON syllabus_topics(class_id);

-- 17. ANNOUNCEMENTS
CREATE TABLE announcements (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(20) NOT NULL DEFAULT 'global' CHECK (target_type IN ('global', 'class', 'batch', 'course')),
    target_id VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    publish_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_announcements_target ON announcements(target_type, target_id);
CREATE INDEX idx_announcements_created ON announcements(created_at);

-- 18. NOTIFICATIONS
CREATE TABLE notifications (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(30) NOT NULL DEFAULT 'INFO',
    link TEXT,
    read BOOLEAN NOT NULL DEFAULT false,
    priority VARCHAR(20) DEFAULT 'NORMAL',
    related_entity_type VARCHAR(50),
    related_entity_id VARCHAR(64),
    action_url TEXT,
    action_label VARCHAR(100),
    event_key VARCHAR(128),
    dismissed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_read ON notifications(user_id, read);
CREATE UNIQUE INDEX idx_notifications_event_key ON notifications(event_key);

-- 19. LEAVE REQUESTS
CREATE TABLE leave_requests (
    id VARCHAR(64) PRIMARY KEY,
    teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_note TEXT,
    reviewed_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_leave_teacher ON leave_requests(teacher_id);
CREATE INDEX idx_leave_status ON leave_requests(status);

-- 20. FEEDBACK & SUPPORT TICKETS
CREATE TABLE feedback_tickets (
    id VARCHAR(64) PRIMARY KEY,
    submitter_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL DEFAULT 'academic' CHECK (category IN ('academic', 'technical', 'administrative', 'other')),
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    assigned_to VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tickets_submitter ON feedback_tickets(submitter_id);
CREATE INDEX idx_tickets_status ON feedback_tickets(status);

-- 21. LIVE CLASS SESSIONS
CREATE TABLE live_class_sessions (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
    subject_id VARCHAR(64) REFERENCES subjects(id) ON DELETE SET NULL,
    course_id VARCHAR(64),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    meeting_url TEXT NULL,
    meeting_provider VARCHAR(50) DEFAULT 'external',
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ongoing', 'completed', 'cancelled', 'ended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_live_classes_teacher ON live_class_sessions(teacher_id);
CREATE INDEX idx_live_classes_scheduled ON live_class_sessions(scheduled_at);

-- 22. TEACHER INVITATIONS
CREATE TABLE teacher_invitations (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    department VARCHAR(150),
    invited_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE teacher_invitations ADD COLUMN IF NOT EXISTS department VARCHAR(150);

CREATE INDEX idx_teacher_invitations_token ON teacher_invitations(token_hash);
CREATE INDEX idx_teacher_invitations_email ON teacher_invitations(email);

-- 23. PASSWORD RESET TOKENS
CREATE TABLE password_reset_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pwd_reset_token ON password_reset_tokens(token_hash);
CREATE INDEX idx_pwd_reset_user ON password_reset_tokens(user_id);

-- 24. AUDIT LOGS (Immutable & Tamper-Evident)
CREATE TABLE audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(64),
    target_resource VARCHAR(255),
    summary TEXT,
    ip_address VARCHAR(50),
    user_agent TEXT,
    previous_hash VARCHAR(64),
    integrity_hash VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_resource);

-- 25. SECURITY LOGS (Immutable & Tamper-Evident)
CREATE TABLE IF NOT EXISTS security_logs (
    id VARCHAR(64) PRIMARY KEY,
    event_type VARCHAR(60) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
    user_id VARCHAR(255),
    user_email VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    details TEXT,
    metadata JSONB,
    target_resource VARCHAR(255),
    previous_hash VARCHAR(64),
    integrity_hash VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_security_logs_severity ON security_logs (severity);
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_target ON security_logs (target_resource);

CREATE OR REPLACE VIEW security_audit_logs AS SELECT * FROM security_logs;




-- 26. LESSONS
CREATE TABLE lessons (
    id VARCHAR(64) PRIMARY KEY,
    course_id VARCHAR(64) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    video_url TEXT,
    position INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lessons_course_id ON lessons(course_id);
CREATE INDEX idx_lessons_position ON lessons(course_id, position);

-- 27. ENROLLMENTS (Courses)
CREATE TABLE enrollments (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id VARCHAR(64) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_course_enrollment UNIQUE (user_id, course_id)
);

CREATE INDEX idx_enrollments_user_id ON enrollments(user_id);
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);

-- 28. LESSON PROGRESS
CREATE TABLE lesson_progress (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id VARCHAR(64) NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_lesson_progress UNIQUE (user_id, lesson_id)
);

CREATE INDEX idx_progress_user_lesson ON lesson_progress(user_id, lesson_id);

-- 29. QUIZZES
CREATE TABLE quizzes (
    id VARCHAR(64) PRIMARY KEY,
    course_id VARCHAR(64) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    teacher_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'published',
    duration_minutes INTEGER DEFAULT 20,
    pass_percentage INTEGER DEFAULT 60,
    results_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quizzes_course_id ON quizzes(course_id);

-- 30. QUESTIONS
CREATE TABLE questions (
    id VARCHAR(64) PRIMARY KEY,
    quiz_id VARCHAR(64) NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type VARCHAR(30) NOT NULL DEFAULT 'mcq_single',
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_option_index INTEGER NULL,
    explanation TEXT NULL,
    marks NUMERIC(6,2) NOT NULL DEFAULT 1.00,
    expected_answer TEXT NULL,
    evaluation_criteria TEXT NULL,
    programming_language VARCHAR(30) DEFAULT 'javascript',
    starter_code TEXT NULL,
    time_limit NUMERIC(6,2) DEFAULT 2.0,
    memory_limit INTEGER DEFAULT 128,
    test_cases JSONB DEFAULT '[]'::jsonb,
    position INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_questions_quiz_id ON questions(quiz_id);
CREATE INDEX idx_questions_type ON questions(question_type);

-- 31. QUIZ ATTEMPTS
CREATE TABLE quiz_attempts (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id VARCHAR(64) NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quiz_attempts_user ON quiz_attempts(user_id);
CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);

-- 32. QUIZ ATTEMPT ANSWERS
CREATE TABLE quiz_attempt_answers (
    id VARCHAR(64) PRIMARY KEY,
    attempt_id VARCHAR(64) NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id VARCHAR(64) NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected_option_index INTEGER NULL,
    is_correct BOOLEAN NULL,
    response_text TEXT NULL,
    score_awarded NUMERIC(6,2) DEFAULT 0.00,
    evaluation_comment TEXT NULL,
    evaluated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NULL,
    is_pending_review BOOLEAN DEFAULT false,
    execution_results JSONB DEFAULT NULL
);

CREATE INDEX idx_attempt_answers_attempt ON quiz_attempt_answers(attempt_id);

-- 33. AI CHAT MESSAGES
CREATE TABLE ai_chat_messages (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id VARCHAR(64) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_chat_user_convo ON ai_chat_messages(user_id, conversation_id);

-- 34. EMAIL VERIFICATION TOKENS
CREATE TABLE email_verification_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_verification_user UNIQUE (user_id)
);

CREATE INDEX idx_email_verification_user ON email_verification_tokens(user_id);
CREATE INDEX idx_email_verification_expires ON email_verification_tokens(expires_at);

-- 35. MOCK TESTS & SECURE AI EXAMINATION SYSTEM
CREATE TABLE mock_tests (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    instructions TEXT,
    subject VARCHAR(150) NOT NULL,
    topic VARCHAR(150),
    difficulty VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('beginner', 'easy', 'medium', 'hard', 'advanced')),
    category VARCHAR(50) NOT NULL DEFAULT 'mock_exam' CHECK (category IN ('mock_exam', 'practice', 'ai_generated', 'interview_prep', 'subject_test', 'certification')),
    tags JSONB DEFAULT '[]'::jsonb,
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
    course_id VARCHAR(64) REFERENCES courses(id) ON DELETE SET NULL,
    scheduled_start TIMESTAMP WITH TIME ZONE NULL,
    scheduled_end TIMESTAMP WITH TIME ZONE NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 100.00,
    pass_percentage NUMERIC(5,2) NOT NULL DEFAULT 40.00,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    randomize_questions BOOLEAN NOT NULL DEFAULT true,
    randomize_options BOOLEAN NOT NULL DEFAULT true,
    negative_marking BOOLEAN NOT NULL DEFAULT true,
    negative_mark_penalty NUMERIC(5,2) NOT NULL DEFAULT 0.25,
    proctoring_config JSONB NOT NULL DEFAULT '{
        "webcam_required": true,
        "face_detection": true,
        "multi_face_warning": true,
        "face_absence_warning": true,
        "fullscreen_required": true,
        "tab_switch_warning": true,
        "audio_check_required": false,
        "max_warnings": 5
    }'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'closed')),
    results_published BOOLEAN NOT NULL DEFAULT false,
    allow_instant_result BOOLEAN NOT NULL DEFAULT false,
    show_explanations BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mock_tests_status ON mock_tests(status);
CREATE INDEX idx_mock_tests_created_by ON mock_tests(created_by);
CREATE INDEX idx_mock_tests_subject ON mock_tests(subject);
CREATE INDEX idx_mock_tests_category ON mock_tests(category);

-- 36. MOCK TEST SECTIONS
CREATE TABLE mock_test_sections (
    id VARCHAR(64) PRIMARY KEY,
    test_id VARCHAR(64) NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL DEFAULT 1,
    duration_minutes INTEGER NULL,
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mock_test_sections_test ON mock_test_sections(test_id);

-- 37. MOCK TEST QUESTIONS
CREATE TABLE mock_test_questions (
    id VARCHAR(64) PRIMARY KEY,
    test_id VARCHAR(64) NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
    section_id VARCHAR(64) REFERENCES mock_test_sections(id) ON DELETE SET NULL,
    question_text TEXT NOT NULL,
    question_type VARCHAR(30) NOT NULL DEFAULT 'mcq_single' CHECK (question_type IN (
        'mcq_single',
        'mcq_multiple',
        'true_false',
        'fill_blank',
        'short_answer',
        'numerical',
        'matching',
        'subjective',
        'case_study',
        'long_answer',
        'coding'
    )),
    options JSONB DEFAULT '[]'::jsonb,
    answer_key JSONB NOT NULL,
    marks NUMERIC(6,2) NOT NULL DEFAULT 4.00,
    negative_marks NUMERIC(6,2) NOT NULL DEFAULT 1.00,
    explanation TEXT,
    expected_answer TEXT,
    evaluation_criteria TEXT,
    programming_language VARCHAR(30) DEFAULT 'javascript',
    starter_code TEXT,
    time_limit NUMERIC(6,2) DEFAULT 2.0,
    memory_limit INTEGER DEFAULT 128,
    test_cases JSONB DEFAULT '[]'::jsonb,
    topic VARCHAR(100),
    difficulty VARCHAR(20) DEFAULT 'medium',
    order_index INTEGER NOT NULL DEFAULT 1,
    case_passage TEXT NULL,
    image_url TEXT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mock_test_questions_test ON mock_test_questions(test_id);
CREATE INDEX idx_mock_test_questions_type ON mock_test_questions(question_type);

-- 38. MOCK TEST ATTEMPTS
CREATE TABLE mock_test_attempts (
    id VARCHAR(64) PRIMARY KEY,
    test_id VARCHAR(64) NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress' CHECK (status IN (
        'in_progress',
        'submitted',
        'evaluated',
        'flagged_for_review',
        'cancelled',
        'AUTO_SUBMITTED',
        'auto_submitted'
    )),
    total_score NUMERIC(8,2) DEFAULT 0.00,
    max_score NUMERIC(8,2) DEFAULT 0.00,
    percentage NUMERIC(5,2) DEFAULT 0.00,
    passed BOOLEAN DEFAULT false,
    correct_count INTEGER DEFAULT 0,
    incorrect_count INTEGER DEFAULT 0,
    unanswered_count INTEGER DEFAULT 0,
    time_spent_seconds INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    security_warning_count INTEGER DEFAULT 0,
    fullscreen_exit_count INTEGER DEFAULT 0,
    submission_status VARCHAR(50) DEFAULT NULL,
    submission_reason VARCHAR(100) DEFAULT NULL,
    result_status VARCHAR(50) DEFAULT 'PENDING_EVALUATION',
    released_at TIMESTAMP WITH TIME ZONE NULL,
    released_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    integrity_trust_index INTEGER NOT NULL DEFAULT 100 CHECK (integrity_trust_index BETWEEN 0 AND 100),
    disqualified BOOLEAN NOT NULL DEFAULT false,
    test_snapshot JSONB NOT NULL,
    proctoring_summary JSONB DEFAULT '{
        "face_absence_events": 0,
        "multiple_face_events": 0,
        "tab_switch_events": 0,
        "fullscreen_exit_events": 0,
        "camera_disconnect_events": 0,
        "total_events": 0,
        "integrity_trust_index": 100,
        "flagged": false
    }'::jsonb,
    evaluator_remarks TEXT NULL,
    evaluated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mock_attempts_test ON mock_test_attempts(test_id);
CREATE INDEX idx_mock_attempts_student ON mock_test_attempts(student_id);
CREATE INDEX idx_mock_attempts_status ON mock_test_attempts(status);
CREATE INDEX idx_mock_attempts_student_result ON mock_test_attempts(student_id, result_status);
CREATE INDEX idx_mock_attempts_test_result ON mock_test_attempts(test_id, result_status);
CREATE INDEX idx_mock_attempts_released_at ON mock_test_attempts(released_at);

-- 39. MOCK TEST RESPONSES
CREATE TABLE mock_test_responses (
    id VARCHAR(64) PRIMARY KEY,
    attempt_id VARCHAR(64) NOT NULL REFERENCES mock_test_attempts(id) ON DELETE CASCADE,
    question_id VARCHAR(64) NOT NULL REFERENCES mock_test_questions(id) ON DELETE CASCADE,
    response_data JSONB NULL,
    is_marked_for_review BOOLEAN NOT NULL DEFAULT false,
    is_visited BOOLEAN NOT NULL DEFAULT true,
    score_awarded NUMERIC(6,2) DEFAULT 0.00,
    is_correct BOOLEAN NULL,
    is_pending_review BOOLEAN DEFAULT false,
    execution_results JSONB DEFAULT NULL,
    evaluation_comment TEXT NULL,
    evaluated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attempt_question_response UNIQUE (attempt_id, question_id)
);

CREATE INDEX idx_mock_responses_attempt ON mock_test_responses(attempt_id);
CREATE INDEX idx_mock_responses_pending ON mock_test_responses(attempt_id, is_pending_review);

-- 40. MOCK TEST PROCTORING EVENTS
CREATE TABLE mock_test_proctoring_events (
    id VARCHAR(64) PRIMARY KEY,
    attempt_id VARCHAR(64) NOT NULL REFERENCES mock_test_attempts(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL CHECK (event_type IN (
        'FACE_NOT_DETECTED',
        'MULTIPLE_FACES',
        'CAMERA_DISCONNECTED',
        'CAMERA_PERMISSION_REVOKED',
        'TAB_HIDDEN',
        'WINDOW_BLURRED',
        'FULLSCREEN_EXIT',
        'NETWORK_INTERRUPTION',
        'AUDIO_ANOMALY',
        'EXAM_TIME_EXPIRED',
        'SUSPICIOUS_KEY_COMBINATION',
        'SECURITY_WARNING',
        'AUTO_SUBMISSION'
    )),
    severity VARCHAR(20) NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    client_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    server_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_seconds INTEGER DEFAULT 0,
    confidence NUMERIC(4,2) DEFAULT 1.00,
    metadata JSONB DEFAULT '{}'::jsonb,
    review_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'dismissed', 'confirmed_violation')),
    review_notes TEXT NULL,
    reviewed_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE NULL
);

CREATE INDEX idx_proctoring_events_attempt ON mock_test_proctoring_events(attempt_id);
CREATE INDEX idx_proctoring_events_type ON mock_test_proctoring_events(event_type);

-- 41. MOCK TEST AUDIT LOGS
CREATE TABLE mock_test_audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    test_id VARCHAR(64) REFERENCES mock_tests(id) ON DELETE CASCADE,
    attempt_id VARCHAR(64) REFERENCES mock_test_attempts(id) ON DELETE CASCADE,
    actor_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(20) NOT NULL,
    action VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mock_audit_test ON mock_test_audit_logs(test_id);
CREATE INDEX idx_mock_audit_attempt ON mock_test_audit_logs(attempt_id);

-- 42. MOCK TEST JOIN REQUESTS
CREATE TABLE mock_test_join_requests (
    id VARCHAR(64) PRIMARY KEY,
    mock_test_id VARCHAR(64) NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id VARCHAR(64) NULL REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP WITH TIME ZONE NULL,
    reviewed_by VARCHAR(64) NULL REFERENCES users(id) ON DELETE SET NULL,
    rejection_reason TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_join_requests_test ON mock_test_join_requests(mock_test_id);
CREATE INDEX idx_join_requests_student ON mock_test_join_requests(student_id);
CREATE INDEX idx_join_requests_teacher ON mock_test_join_requests(teacher_id);
CREATE INDEX idx_join_requests_status ON mock_test_join_requests(status);
CREATE UNIQUE INDEX uq_active_mock_test_join_request ON mock_test_join_requests(mock_test_id, student_id) WHERE status IN ('PENDING', 'APPROVED');

-- 43. QUESTION BANK
CREATE TABLE IF NOT EXISTS question_bank (
    id VARCHAR(64) PRIMARY KEY,
    question_text TEXT NOT NULL,
    question_type VARCHAR(30) NOT NULL DEFAULT 'mcq_single',
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_option_index INTEGER NOT NULL DEFAULT 0,
    correct_answer VARCHAR(10) NOT NULL DEFAULT 'A',
    subject VARCHAR(100) NOT NULL,
    topic VARCHAR(100) NOT NULL,
    difficulty VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    explanation TEXT,
    marks NUMERIC(6,2) NOT NULL DEFAULT 4.00,
    negative_marks NUMERIC(6,2) NOT NULL DEFAULT 1.00,
    expected_answer TEXT,
    evaluation_criteria TEXT,
    programming_language VARCHAR(30) DEFAULT 'javascript',
    starter_code TEXT,
    time_limit NUMERIC(6,2) DEFAULT 2.0,
    memory_limit INTEGER DEFAULT 128,
    test_cases JSONB DEFAULT '[]'::jsonb,
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    subject_id VARCHAR(64) REFERENCES subjects(id) ON DELETE SET NULL,
    course_id VARCHAR(64) REFERENCES courses(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_question_bank_subject ON question_bank(subject);
CREATE INDEX IF NOT EXISTS idx_question_bank_topic ON question_bank(topic);
CREATE INDEX IF NOT EXISTS idx_question_bank_difficulty ON question_bank(difficulty);
CREATE INDEX IF NOT EXISTS idx_question_bank_type ON question_bank(question_type);
CREATE INDEX IF NOT EXISTS idx_question_bank_created_by ON question_bank(created_by);
CREATE INDEX IF NOT EXISTS idx_question_bank_created_at ON question_bank(created_at);

-- 44. CODING TEST CASES
CREATE TABLE IF NOT EXISTS coding_test_cases (
    id VARCHAR(64) PRIMARY KEY,
    question_id VARCHAR(64) NOT NULL,
    input TEXT NOT NULL,
    expected_output TEXT NOT NULL,
    is_hidden BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coding_test_cases_q ON coding_test_cases(question_id);
CREATE INDEX IF NOT EXISTS idx_coding_test_cases_hidden ON coding_test_cases(question_id, is_hidden);

-- 45. CODING SUBMISSIONS
CREATE TABLE IF NOT EXISTS coding_submissions (
    id VARCHAR(64) PRIMARY KEY,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id VARCHAR(64) NOT NULL,
    attempt_id VARCHAR(64),
    programming_language VARCHAR(30) NOT NULL DEFAULT 'javascript',
    submitted_code TEXT NOT NULL,
    execution_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    score NUMERIC(6,2) DEFAULT 0.00,
    test_cases_passed INTEGER DEFAULT 0,
    total_test_cases INTEGER DEFAULT 0,
    execution_time_ms INTEGER DEFAULT 0,
    memory_usage_mb NUMERIC(6,2) DEFAULT 0.00,
    error_message TEXT,
    test_results JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coding_submissions_student ON coding_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_coding_submissions_question ON coding_submissions(question_id);
CREATE INDEX IF NOT EXISTS idx_coding_submissions_attempt ON coding_submissions(attempt_id);

