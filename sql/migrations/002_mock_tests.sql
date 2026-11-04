-- Migration 002: Secure Mock Test & AI Examination System Schema
-- LinkTest Enterprise LMS

CREATE TABLE IF NOT EXISTS mock_tests (
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

CREATE INDEX IF NOT EXISTS idx_mock_tests_status ON mock_tests(status);
CREATE INDEX IF NOT EXISTS idx_mock_tests_created_by ON mock_tests(created_by);
CREATE INDEX IF NOT EXISTS idx_mock_tests_subject ON mock_tests(subject);
CREATE INDEX IF NOT EXISTS idx_mock_tests_category ON mock_tests(category);

-- Mock Test Sections (for optional section-based timing and grouping)
CREATE TABLE IF NOT EXISTS mock_test_sections (
    id VARCHAR(64) PRIMARY KEY,
    test_id VARCHAR(64) NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL DEFAULT 1,
    duration_minutes INTEGER NULL,
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mock_test_sections_test ON mock_test_sections(test_id);

-- Mock Test Questions
CREATE TABLE IF NOT EXISTS mock_test_questions (
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
        'case_study'
    )),
    options JSONB DEFAULT '[]'::jsonb,
    answer_key JSONB NOT NULL,
    marks NUMERIC(6,2) NOT NULL DEFAULT 4.00,
    negative_marks NUMERIC(6,2) NOT NULL DEFAULT 1.00,
    explanation TEXT,
    topic VARCHAR(100),
    difficulty VARCHAR(20) DEFAULT 'medium',
    order_index INTEGER NOT NULL DEFAULT 1,
    case_passage TEXT NULL,
    image_url TEXT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mock_test_questions_test ON mock_test_questions(test_id);
CREATE INDEX IF NOT EXISTS idx_mock_test_questions_type ON mock_test_questions(question_type);

-- Mock Test Candidate Attempts
CREATE TABLE IF NOT EXISTS mock_test_attempts (
    id VARCHAR(64) PRIMARY KEY,
    test_id VARCHAR(64) NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN (
        'in_progress',
        'submitted',
        'evaluated',
        'flagged_for_review',
        'cancelled'
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
    test_snapshot JSONB NOT NULL,
    proctoring_summary JSONB DEFAULT '{
        "face_absence_events": 0,
        "multiple_face_events": 0,
        "tab_switch_events": 0,
        "fullscreen_exit_events": 0,
        "camera_disconnect_events": 0,
        "total_events": 0,
        "flagged": false
    }'::jsonb,
    evaluator_remarks TEXT NULL,
    evaluated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mock_attempts_test ON mock_test_attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_student ON mock_test_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_status ON mock_test_attempts(status);

-- Mock Test Candidate Question Responses
CREATE TABLE IF NOT EXISTS mock_test_responses (
    id VARCHAR(64) PRIMARY KEY,
    attempt_id VARCHAR(64) NOT NULL REFERENCES mock_test_attempts(id) ON DELETE CASCADE,
    question_id VARCHAR(64) NOT NULL REFERENCES mock_test_questions(id) ON DELETE CASCADE,
    response_data JSONB NULL,
    is_marked_for_review BOOLEAN NOT NULL DEFAULT false,
    is_visited BOOLEAN NOT NULL DEFAULT true,
    score_awarded NUMERIC(6,2) DEFAULT 0.00,
    is_correct BOOLEAN NULL,
    evaluation_comment TEXT NULL,
    evaluated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attempt_question_response UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_mock_responses_attempt ON mock_test_responses(attempt_id);

-- Mock Test Proctoring Events
CREATE TABLE IF NOT EXISTS mock_test_proctoring_events (
    id VARCHAR(64) PRIMARY KEY,
    attempt_id VARCHAR(64) NOT NULL REFERENCES mock_test_attempts(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
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
        'SUSPICIOUS_KEY_COMBINATION'
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

CREATE INDEX IF NOT EXISTS idx_proctoring_events_attempt ON mock_test_proctoring_events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_events_type ON mock_test_proctoring_events(event_type);

-- Mock Test Audit Logs
CREATE TABLE IF NOT EXISTS mock_test_audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_mock_audit_test ON mock_test_audit_logs(test_id);
CREATE INDEX IF NOT EXISTS idx_mock_audit_attempt ON mock_test_audit_logs(attempt_id);
