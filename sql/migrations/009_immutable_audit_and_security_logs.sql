-- 009_immutable_audit_and_security_logs.sql
-- Ensure security_logs table exists
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Safe additive columns on audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_resource VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS integrity_hash VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS sequence_no BIGSERIAL;

-- Safe additive columns on security_logs
ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS target_resource VARCHAR(255);
ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(64);
ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS integrity_hash VARCHAR(64);
ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS sequence_no BIGSERIAL;

-- Performant indexes for querying and pagination
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_resource);
CREATE INDEX IF NOT EXISTS idx_audit_logs_sequence ON audit_logs (sequence_no DESC);

CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_security_logs_severity ON security_logs (severity);
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_target ON security_logs (target_resource);
CREATE INDEX IF NOT EXISTS idx_security_logs_sequence ON security_logs (sequence_no DESC);

-- Alias view for security_audit_logs
CREATE OR REPLACE VIEW security_audit_logs AS SELECT * FROM security_logs;
