-- ==============================================================================
-- LINKVIEW / LINKTEST COMPLETE UNIFIED SUPABASE SCHEMA & POLICIES
-- Run this entire script in Supabase SQL Editor in ONE single click.
-- Fully Idempotent (safe to run multiple times without errors)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. TENANTS & USERS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY, -- Maps to auth.users.id
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'trainer', 'student')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 2. BATCHES & ENROLLMENTS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_tenant_batch_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS batch_students (
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (batch_id, student_id)
);

CREATE TABLE IF NOT EXISTS batch_trainers (
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (batch_id, trainer_id)
);

-- ==============================================================================
-- 3. QUESTION BANK & ASSIGNMENTS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('single_mcq', 'multiple_mcq', 'true_false', 'short_answer')),
    prompt TEXT NOT NULL,
    options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer_key_json JSONB NOT NULL,
    explanation TEXT,
    marks NUMERIC(5, 2) DEFAULT 1.00,
    negative_marks NUMERIC(5, 2) DEFAULT 0.00,
    difficulty VARCHAR(50) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    topic VARCHAR(100),
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_template_id UUID NOT NULL REFERENCES test_templates(id) ON DELETE CASCADE,
    version INT NOT NULL,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_test_version UNIQUE (test_template_id, version)
);

CREATE TABLE IF NOT EXISTS test_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    test_version_id UUID NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    available_from TIMESTAMPTZ NOT NULL,
    available_until TIMESTAMPTZ NOT NULL,
    duration_seconds INT NOT NULL,
    max_attempts INT DEFAULT 1,
    approval_required BOOLEAN DEFAULT FALSE,
    proctoring_policy_json JSONB DEFAULT '{"max_flags": 5}'::jsonb,
    result_release_mode VARCHAR(50) DEFAULT 'trainer_release' CHECK (result_release_mode IN ('immediate', 'scheduled', 'trainer_release')),
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assignment_id UUID NOT NULL REFERENCES test_assignments(id) ON DELETE CASCADE,
    test_version_id UUID NOT NULL REFERENCES test_versions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    state VARCHAR(50) DEFAULT 'draft' CHECK (state IN ('draft', 'scheduled', 'awaiting_approval', 'ready', 'in_progress', 'submitted', 'auto_submitted', 'expired', 'cancelled')),
    requested_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    deadline_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    submit_reason VARCHAR(100),
    score NUMERIC(6, 2),
    max_score NUMERIC(6, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_student_attempt UNIQUE (assignment_id, student_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS attempt_answers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer_json JSONB,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    is_final BOOLEAN DEFAULT FALSE,
    CONSTRAINT unique_attempt_question UNIQUE (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempt_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) DEFAULT 'medium',
    weight NUMERIC(3, 1) DEFAULT 1.0,
    confidence NUMERIC(3, 2) DEFAULT 1.00,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    metadata_json JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(100),
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 4. AI INTERVIEWS & PROCTORING (LinkView Core)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS interview_sessions (
    id VARCHAR(100) PRIMARY KEY,
    student_id VARCHAR(100) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    student_email VARCHAR(255) NOT NULL,
    trainer_id VARCHAR(100),
    trainer_name VARCHAR(255),
    batch_id VARCHAR(100),
    batch_name VARCHAR(255),
    technology VARCHAR(100) NOT NULL,
    interview_type VARCHAR(50) DEFAULT 'technical',
    difficulty VARCHAR(50) DEFAULT 'intermediate',
    duration_minutes INT DEFAULT 30,
    total_turns INT DEFAULT 3,
    current_turn INT DEFAULT 1,
    current_question TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'pending_evaluation', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interview_turns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    turn INT NOT NULL,
    question TEXT NOT NULL,
    student_answer TEXT NOT NULL,
    ai_feedback TEXT,
    score NUMERIC(4, 2) DEFAULT 0.0,
    ideal_answer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proctoring_events (
    id VARCHAR(100) PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('tab_switch', 'window_blur', 'face_missing', 'multiple_faces', 'camera_covered', 'gaze_away', 'head_down', 'fullscreen_exit', 'copy_paste_attempt')),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    message TEXT NOT NULL,
    duration_seconds INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interview_scorecards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) UNIQUE NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    overall_score NUMERIC(5, 2) NOT NULL,
    technical_accuracy NUMERIC(5, 2),
    conceptual_understanding NUMERIC(5, 2),
    communication NUMERIC(5, 2),
    problem_solving NUMERIC(5, 2),
    strengths JSONB DEFAULT '[]'::jsonb,
    weaknesses JSONB DEFAULT '[]'::jsonb,
    recommendations JSONB DEFAULT '[]'::jsonb,
    ai_feedback TEXT,
    trainer_remarks TEXT,
    evaluated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 5. INDEXES FOR HIGH-THROUGHPUT CONCURRENCY
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role ON profiles(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assignments_batch ON test_assignments(batch_id, available_from, available_until);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON test_attempts(student_id, assignment_id, state);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_events_attempt ON attempt_events(attempt_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_student ON interview_sessions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_interview_turns_session ON interview_turns(session_id, turn);
CREATE INDEX IF NOT EXISTS idx_proctoring_session ON proctoring_events(session_id, type);

-- ==============================================================================
-- 6. SECURITY HELPER FUNCTIONS
-- ==============================================================================

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS VARCHAR AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_user_tenant()
RETURNS UUID AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ==============================================================================
-- 7. ENABLE ROW LEVEL SECURITY (RLS)
-- ==============================================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE proctoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_scorecards ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 8. IDEMPOTENT RLS POLICIES (Drop if exists before create)
-- ==============================================================================

DROP POLICY IF EXISTS profiles_super_admin_all ON profiles;
CREATE POLICY profiles_super_admin_all ON profiles
    FOR ALL USING (current_user_role() = 'super_admin');

DROP POLICY IF EXISTS profiles_self_read ON profiles;
CREATE POLICY profiles_self_read ON profiles
    FOR SELECT USING (id = auth.uid() OR current_user_role() IN ('trainer', 'super_admin'));

DROP POLICY IF EXISTS profiles_self_update ON profiles;
CREATE POLICY profiles_self_update ON profiles
    FOR UPDATE USING (id = auth.uid());

DROP POLICY IF EXISTS batches_super_admin_all ON batches;
CREATE POLICY batches_super_admin_all ON batches
    FOR ALL USING (current_user_role() = 'super_admin');

DROP POLICY IF EXISTS batches_trainer_manage ON batches;
CREATE POLICY batches_trainer_manage ON batches
    FOR ALL USING (
        current_user_role() = 'trainer' AND 
        (tenant_id = current_user_tenant() OR created_by = auth.uid())
    );

DROP POLICY IF EXISTS batches_student_read ON batches;
CREATE POLICY batches_student_read ON batches
    FOR SELECT USING (
        id IN (SELECT batch_id FROM batch_students WHERE student_id = auth.uid())
    );

DROP POLICY IF EXISTS questions_staff_access ON questions;
CREATE POLICY questions_staff_access ON questions
    FOR ALL USING (current_user_role() IN ('trainer', 'super_admin'));

DROP POLICY IF EXISTS test_attempts_super_admin_all ON test_attempts;
CREATE POLICY test_attempts_super_admin_all ON test_attempts
    FOR ALL USING (current_user_role() = 'super_admin');

DROP POLICY IF EXISTS test_attempts_trainer_view_manage ON test_attempts;
CREATE POLICY test_attempts_trainer_view_manage ON test_attempts
    FOR ALL USING (current_user_role() = 'trainer');

DROP POLICY IF EXISTS test_attempts_student_access ON test_attempts;
CREATE POLICY test_attempts_student_access ON test_attempts
    FOR ALL USING (student_id = auth.uid());

DROP POLICY IF EXISTS attempt_answers_student_modify ON attempt_answers;
CREATE POLICY attempt_answers_student_modify ON attempt_answers
    FOR ALL USING (
        attempt_id IN (SELECT id FROM test_attempts WHERE student_id = auth.uid())
    );

DROP POLICY IF EXISTS attempt_answers_staff_read ON attempt_answers;
CREATE POLICY attempt_answers_staff_read ON attempt_answers
    FOR SELECT USING (current_user_role() IN ('trainer', 'super_admin'));

DROP POLICY IF EXISTS attempt_events_insert ON attempt_events;
CREATE POLICY attempt_events_insert ON attempt_events
    FOR INSERT WITH CHECK (
        attempt_id IN (SELECT id FROM test_attempts WHERE student_id = auth.uid())
    );

DROP POLICY IF EXISTS attempt_events_staff_read ON attempt_events;
CREATE POLICY attempt_events_staff_read ON attempt_events
    FOR SELECT USING (current_user_role() IN ('trainer', 'super_admin'));

-- LinkView Interview Policies
DROP POLICY IF EXISTS sessions_super_admin ON interview_sessions;
CREATE POLICY sessions_super_admin ON interview_sessions FOR ALL USING (true);

DROP POLICY IF EXISTS turns_super_admin ON interview_turns;
CREATE POLICY turns_super_admin ON interview_turns FOR ALL USING (true);

DROP POLICY IF EXISTS proctoring_super_admin ON proctoring_events;
CREATE POLICY proctoring_super_admin ON proctoring_events FOR ALL USING (true);

DROP POLICY IF EXISTS scorecards_super_admin ON interview_scorecards;
CREATE POLICY scorecards_super_admin ON interview_scorecards FOR ALL USING (true);

-- ==============================================================================
-- 9. INITIAL SEED: DEFAULT INSTITUTE TENANT
-- ==============================================================================

INSERT INTO tenants (id, name, slug, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'LinkTest Default Institute', 'linktest-default', 'active')
ON CONFLICT (slug) DO NOTHING;
