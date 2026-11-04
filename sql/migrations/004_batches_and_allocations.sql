-- Migration 004: Enhanced Batch Management, Teacher Allocation & Student Batch Enrollment
-- Links batches to courses/programs and introduces dedicated relational allocation tables

-- 1. Enhance existing batches table with course linking, unique code, dates, and lifecycle status
ALTER TABLE batches ALTER COLUMN class_id DROP NOT NULL;

ALTER TABLE batches ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS course_id VARCHAR(64) REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active';
ALTER TABLE batches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Populate unique codes for existing batches safely
UPDATE batches SET code = 'BATCH-' || UPPER(REPLACE(id, '-', '_')) WHERE code IS NULL OR code = '';

-- Make code column unique
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_batches_code') THEN
    ALTER TABLE batches ADD CONSTRAINT uq_batches_code UNIQUE (code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_batches_code ON batches(code);
CREATE INDEX IF NOT EXISTS idx_batches_course ON batches(course_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);

-- 2. Dedicated Teacher Allocation table (batch_teachers)
CREATE TABLE IF NOT EXISTS batch_teachers (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_bt_batch ON batch_teachers(batch_id);
CREATE INDEX IF NOT EXISTS idx_bt_teacher ON batch_teachers(teacher_id);

-- 3. Dedicated Student Batch Enrollment table (batch_enrollments)
CREATE TABLE IF NOT EXISTS batch_enrollments (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_be_batch ON batch_enrollments(batch_id);
CREATE INDEX IF NOT EXISTS idx_be_student ON batch_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_be_status ON batch_enrollments(status);
