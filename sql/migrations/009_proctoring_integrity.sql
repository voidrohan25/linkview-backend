-- Persist the integrity score and disqualification outcome for each attempt.
ALTER TABLE mock_test_attempts
ADD COLUMN IF NOT EXISTS security_warning_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS fullscreen_exit_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS submission_status VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS submission_reason VARCHAR(100) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS result_status VARCHAR(50) DEFAULT 'PENDING_EVALUATION',
ADD COLUMN IF NOT EXISTS released_at TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS released_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS integrity_trust_index INTEGER NOT NULL DEFAULT 100,
ADD COLUMN IF NOT EXISTS disqualified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE mock_test_attempts ALTER COLUMN status TYPE VARCHAR(50);
ALTER TABLE mock_test_attempts DROP CONSTRAINT IF EXISTS mock_test_attempts_status_check;
ALTER TABLE mock_test_attempts ADD CONSTRAINT mock_test_attempts_status_check CHECK (status IN (
    'in_progress',
    'submitted',
    'evaluated',
    'flagged_for_review',
    'cancelled',
    'AUTO_SUBMITTED',
    'auto_submitted'
));
