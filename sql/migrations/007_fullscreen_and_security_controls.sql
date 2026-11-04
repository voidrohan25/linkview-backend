-- Migration 007: Add Fullscreen and Warning Auto-Submission Controls
-- LinkTest Secure Examination System

-- 1. Add tracking columns to mock_test_attempts
ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS security_warning_count INTEGER DEFAULT 0;
ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS fullscreen_exit_count INTEGER DEFAULT 0;
ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS submission_status VARCHAR(50) DEFAULT NULL;
ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS submission_reason VARCHAR(100) DEFAULT NULL;

-- 2. Expand status column size and update status check constraint to permit AUTO_SUBMITTED
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

-- 3. Update mock_test_proctoring_events to support SECURITY_WARNING and AUTO_SUBMISSION
ALTER TABLE mock_test_proctoring_events ALTER COLUMN event_type TYPE VARCHAR(64);
ALTER TABLE mock_test_proctoring_events DROP CONSTRAINT IF EXISTS mock_test_proctoring_events_event_type_check;
ALTER TABLE mock_test_proctoring_events ADD CONSTRAINT mock_test_proctoring_events_event_type_check CHECK (event_type IN (
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
));
