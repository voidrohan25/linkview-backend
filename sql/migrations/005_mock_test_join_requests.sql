-- Migration 005: Mock Test Join Approval System
-- LinkTest Enterprise Examination System

CREATE TABLE IF NOT EXISTS mock_test_join_requests (
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

CREATE INDEX IF NOT EXISTS idx_join_requests_test ON mock_test_join_requests(mock_test_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_student ON mock_test_join_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_teacher ON mock_test_join_requests(teacher_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON mock_test_join_requests(status);

-- Prevent duplicate active requests for the same student + mock_test
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_mock_test_join_request 
ON mock_test_join_requests(mock_test_id, student_id) 
WHERE status IN ('PENDING', 'APPROVED');
