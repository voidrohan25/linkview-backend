-- Rollback Migration 004: Enhanced Batch Management, Teacher Allocation & Student Batch Enrollment

DROP TABLE IF EXISTS batch_enrollments CASCADE;
DROP TABLE IF EXISTS batch_teachers CASCADE;

ALTER TABLE batches DROP CONSTRAINT IF EXISTS uq_batches_code;
DROP INDEX IF EXISTS idx_batches_code;
DROP INDEX IF EXISTS idx_batches_course;
DROP INDEX IF EXISTS idx_batches_status;

ALTER TABLE batches DROP COLUMN IF EXISTS updated_at;
ALTER TABLE batches DROP COLUMN IF EXISTS status;
ALTER TABLE batches DROP COLUMN IF EXISTS end_date;
ALTER TABLE batches DROP COLUMN IF EXISTS start_date;
ALTER TABLE batches DROP COLUMN IF EXISTS description;
ALTER TABLE batches DROP COLUMN IF EXISTS course_id;
ALTER TABLE batches DROP COLUMN IF EXISTS code;
