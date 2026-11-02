-- Migration: 003_interviews_and_proctoring.sql
-- Description: Interview Sessions, AI Evaluations, and Proctoring Audit Events

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
    type VARCHAR(50) NOT NULL CHECK (type IN ('tab_switch', 'window_blur', 'face_missing', 'camera_covered', 'fullscreen_exit', 'copy_paste_attempt')),
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

-- Row Level Security
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE proctoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_scorecards ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_super_admin ON interview_sessions FOR ALL USING (true);
CREATE POLICY turns_super_admin ON interview_turns FOR ALL USING (true);
CREATE POLICY proctoring_super_admin ON proctoring_events FOR ALL USING (true);
CREATE POLICY scorecards_super_admin ON interview_scorecards FOR ALL USING (true);
