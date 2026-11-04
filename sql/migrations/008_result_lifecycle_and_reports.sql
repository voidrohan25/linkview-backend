-- 008_result_lifecycle_and_reports.sql
-- Result lifecycle, evaluation tracking, and release state for LinkTest Examination System

-- 1. Add result lifecycle columns to mock_test_attempts
ALTER TABLE mock_test_attempts
ADD COLUMN IF NOT EXISTS result_status VARCHAR(50) DEFAULT 'PENDING_EVALUATION',
ADD COLUMN IF NOT EXISTS released_at TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS released_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;

-- 2. Add evaluation and execution tracking to mock_test_responses
ALTER TABLE mock_test_responses
ADD COLUMN IF NOT EXISTS is_pending_review BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS execution_results JSONB DEFAULT NULL;

-- 3. Add performance indexes for result queries
CREATE INDEX IF NOT EXISTS idx_mock_attempts_student_result ON mock_test_attempts(student_id, result_status);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_test_result ON mock_test_attempts(test_id, result_status);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_released_at ON mock_test_attempts(released_at);
CREATE INDEX IF NOT EXISTS idx_mock_responses_pending ON mock_test_responses(attempt_id, is_pending_review);

-- 4. Backfill existing evaluated attempts to 'RELEASED' if tests had results_published = true
UPDATE mock_test_attempts a
SET result_status = 'RELEASED',
    released_at = COALESCE(a.submitted_at, a.updated_at, CURRENT_TIMESTAMP)
FROM mock_tests t
WHERE a.test_id = t.id
  AND t.results_published = true
  AND a.status IN ('submitted', 'evaluated')
  AND (
      a.result_status IS NULL
      OR a.result_status = 'PENDING_EVALUATION'
  );
