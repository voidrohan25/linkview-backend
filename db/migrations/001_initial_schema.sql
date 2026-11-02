-- Migration: 001_initial_schema.sql
-- Description: Core multi-tenant Link Test schema with strict constraints and indexes

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants (Institutes / Organizations)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Profiles (Users across Super Admin, Trainer, Student)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY, -- Maps directly to auth.users id
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'trainer', 'student')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Batches
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

-- 4. Batch Enrollment
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

-- 5. Questions & Banks
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

-- 6. Test Templates & Immutable Versions
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

-- 7. Test Attempts & Authoritative Deadlines
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

-- 8. Attempt Answers (Autosaved with timestamp)
CREATE TABLE IF NOT EXISTS attempt_answers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer_json JSONB,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    is_final BOOLEAN DEFAULT FALSE,
    CONSTRAINT unique_attempt_question UNIQUE (attempt_id, question_id)
);

-- 9. Proctoring Violations & Event Logs
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

-- 10. Audit Logs
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

-- Indexes for fast querying under 500 concurrent user loads
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role ON profiles(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assignments_batch ON test_assignments(batch_id, available_from, available_until);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON test_attempts(student_id, assignment_id, state);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON attempt_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_events_attempt ON attempt_events(attempt_id, occurred_at);
