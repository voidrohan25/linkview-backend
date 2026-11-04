-- 006_long_answer_and_coding_questions.sql
-- Migration: Add Long Answer and Coding Question support across Question Bank, Mock Tests, LMS Quizzes, and Submissions

-- 1. Update mock_test_questions check constraint and columns
ALTER TABLE mock_test_questions DROP CONSTRAINT IF EXISTS mock_test_questions_question_type_check;
ALTER TABLE mock_test_questions ADD CONSTRAINT mock_test_questions_question_type_check CHECK (question_type IN (
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
));

ALTER TABLE mock_test_questions ADD COLUMN IF NOT EXISTS expected_answer TEXT;
ALTER TABLE mock_test_questions ADD COLUMN IF NOT EXISTS evaluation_criteria TEXT;
ALTER TABLE mock_test_questions ADD COLUMN IF NOT EXISTS programming_language VARCHAR(30) DEFAULT 'javascript';
ALTER TABLE mock_test_questions ADD COLUMN IF NOT EXISTS starter_code TEXT;
ALTER TABLE mock_test_questions ADD COLUMN IF NOT EXISTS time_limit NUMERIC(6,2) DEFAULT 2.0;
ALTER TABLE mock_test_questions ADD COLUMN IF NOT EXISTS memory_limit INTEGER DEFAULT 128;
ALTER TABLE mock_test_questions ADD COLUMN IF NOT EXISTS test_cases JSONB DEFAULT '[]'::jsonb;

-- 2. Update mock_test_responses for subjective/long answer & coding review
ALTER TABLE mock_test_responses ADD COLUMN IF NOT EXISTS is_pending_review BOOLEAN DEFAULT false;
ALTER TABLE mock_test_responses ADD COLUMN IF NOT EXISTS execution_results JSONB DEFAULT '{}'::jsonb;

-- 3. Update question_bank table
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS question_type VARCHAR(30) DEFAULT 'mcq_single';
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS expected_answer TEXT;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS evaluation_criteria TEXT;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS programming_language VARCHAR(30) DEFAULT 'javascript';
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS starter_code TEXT;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS time_limit NUMERIC(6,2) DEFAULT 2.0;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS memory_limit INTEGER DEFAULT 128;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS test_cases JSONB DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_question_bank_type ON question_bank(question_type);

-- 4. Update questions table (LMS Quizzes)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type VARCHAR(30) DEFAULT 'mcq_single';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS marks NUMERIC(6,2) DEFAULT 1.00;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS expected_answer TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS evaluation_criteria TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS programming_language VARCHAR(30) DEFAULT 'javascript';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS starter_code TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS time_limit NUMERIC(6,2) DEFAULT 2.0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS memory_limit INTEGER DEFAULT 128;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS test_cases JSONB DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(question_type);

-- 5. Update quiz_attempt_answers table
ALTER TABLE quiz_attempt_answers ADD COLUMN IF NOT EXISTS response_text TEXT;
ALTER TABLE quiz_attempt_answers ADD COLUMN IF NOT EXISTS score_awarded NUMERIC(6,2) DEFAULT 0.00;
ALTER TABLE quiz_attempt_answers ADD COLUMN IF NOT EXISTS evaluation_comment TEXT;
ALTER TABLE quiz_attempt_answers ADD COLUMN IF NOT EXISTS evaluated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE quiz_attempt_answers ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE quiz_attempt_answers ADD COLUMN IF NOT EXISTS is_pending_review BOOLEAN DEFAULT false;
ALTER TABLE quiz_attempt_answers ADD COLUMN IF NOT EXISTS execution_results JSONB;

-- 6. Create coding_test_cases table
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

-- 7. Create coding_submissions table
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
