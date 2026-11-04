-- LinkTest LMS Migration 001 — Full LMS Schema
-- Adds TEACHER role and all new LMS entities
-- Run AFTER schema.sql (base schema must exist first)

-- ============================================================
-- 1. Extend users table: add status + TEACHER role
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','deactivated')),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;

-- Widen the role CHECK to include TEACHER
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN'));

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================================
-- 2. Teacher invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS teacher_invitations (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  department VARCHAR(150),
  invited_by VARCHAR(64) NOT NULL REFERENCES users(id),
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE teacher_invitations ADD COLUMN IF NOT EXISTS department VARCHAR(150);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON teacher_invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON teacher_invitations(token_hash);

-- ============================================================
-- 3. Password reset tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);

-- ============================================================
-- 4. Teacher profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS teacher_profiles (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_id VARCHAR(50) UNIQUE,
  department VARCHAR(150),
  qualification VARCHAR(255),
  specialization TEXT,
  joining_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 5. Student profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS student_profiles (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  enrollment_number VARCHAR(50) UNIQUE,
  date_of_birth DATE,
  guardian_name VARCHAR(150),
  guardian_contact VARCHAR(20),
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 6. Academic sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS academic_sessions (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 7. Subjects
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20) UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 8. Classes
-- ============================================================
CREATE TABLE IF NOT EXISTS classes (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  academic_session_id VARCHAR(64) REFERENCES academic_sessions(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 9. Batches (sections within a class)
-- ============================================================
CREATE TABLE IF NOT EXISTS batches (
  id VARCHAR(64) PRIMARY KEY,
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  capacity INTEGER DEFAULT 50,
  class_teacher_id VARCHAR(64) REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_id, name)
);
CREATE INDEX IF NOT EXISTS idx_batches_class ON batches(class_id);

-- ============================================================
-- 10. Class-Subject mapping
-- ============================================================
CREATE TABLE IF NOT EXISTS class_subjects (
  id VARCHAR(64) PRIMARY KEY,
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE(class_id, subject_id)
);

-- ============================================================
-- 11. Teacher assignments (teacher → class/batch/subject)
-- ============================================================
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id VARCHAR(64) PRIMARY KEY,
  teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE CASCADE,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id, class_id, batch_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_ta_teacher ON teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_ta_class ON teacher_assignments(class_id);

-- ============================================================
-- 12. Student class enrollments (student → batch)
-- ============================================================
CREATE TABLE IF NOT EXISTS student_class_enrollments (
  id VARCHAR(64) PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_sce_student ON student_class_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_sce_class ON student_class_enrollments(class_id);

-- ============================================================
-- 13. Timetable entries
-- ============================================================
CREATE TABLE IF NOT EXISTS timetable_entries (
  id VARCHAR(64) PRIMARY KEY,
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  batch_id VARCHAR(64) REFERENCES batches(id) ON DELETE SET NULL,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id),
  teacher_id VARCHAR(64) NOT NULL REFERENCES users(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room VARCHAR(100),
  academic_session_id VARCHAR(64) REFERENCES academic_sessions(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_timetable_class ON timetable_entries(class_id);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_entries(teacher_id);
CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable_entries(day_of_week);

-- ============================================================
-- 14. Attendance records
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_records (
  id VARCHAR(64) PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  batch_id VARCHAR(64) REFERENCES batches(id),
  subject_id VARCHAR(64) REFERENCES subjects(id),
  timetable_entry_id VARCHAR(64) REFERENCES timetable_entries(id),
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','absent','late','excused')),
  marked_by VARCHAR(64) NOT NULL REFERENCES users(id),
  correction_reason TEXT,
  corrected_at TIMESTAMP WITH TIME ZONE,
  corrected_by VARCHAR(64) REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, class_id, subject_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance_records(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);

-- ============================================================
-- 15. Assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS assignments (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  instructions TEXT NOT NULL,
  subject_id VARCHAR(64) REFERENCES subjects(id),
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  batch_id VARCHAR(64) REFERENCES batches(id),
  teacher_id VARCHAR(64) NOT NULL REFERENCES users(id),
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  max_marks INTEGER DEFAULT 100,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','closed','archived')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

-- ============================================================
-- 16. Assignment submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS assignment_submissions (
  id VARCHAR(64) PRIMARY KEY,
  assignment_id VARCHAR(64) NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  file_path TEXT,
  file_name VARCHAR(255),
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  marks_obtained INTEGER,
  feedback TEXT,
  graded_by VARCHAR(64) REFERENCES users(id),
  graded_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','graded','returned','late')),
  UNIQUE(assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON assignment_submissions(student_id);

-- ============================================================
-- 17. Study materials
-- ============================================================
CREATE TABLE IF NOT EXISTS study_materials (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(30) NOT NULL DEFAULT 'document'
    CHECK (type IN ('document','pdf','video','link','note')),
  file_path TEXT,
  file_name VARCHAR(255),
  file_size INTEGER,
  external_url TEXT,
  subject_id VARCHAR(64) REFERENCES subjects(id),
  class_id VARCHAR(64) REFERENCES classes(id),
  course_id VARCHAR(64) REFERENCES courses(id),
  lesson_id VARCHAR(64) REFERENCES lessons(id),
  uploaded_by VARCHAR(64) NOT NULL REFERENCES users(id),
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_materials_subject ON study_materials(subject_id);
CREATE INDEX IF NOT EXISTS idx_materials_class ON study_materials(class_id);
CREATE INDEX IF NOT EXISTS idx_materials_uploader ON study_materials(uploaded_by);

-- ============================================================
-- 18. Syllabus topics
-- ============================================================
CREATE TABLE IF NOT EXISTS syllabus_topics (
  id VARCHAR(64) PRIMARY KEY,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id VARCHAR(64) REFERENCES users(id),
  chapter VARCHAR(255) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  planned_date DATE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_date DATE,
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_syllabus_subject ON syllabus_topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_class ON syllabus_topics(class_id);

-- ============================================================
-- 19. Live class sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS live_class_sessions (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  teacher_id VARCHAR(64) NOT NULL REFERENCES users(id),
  class_id VARCHAR(64) REFERENCES classes(id),
  batch_id VARCHAR(64) REFERENCES batches(id),
  subject_id VARCHAR(64) REFERENCES subjects(id),
  course_id VARCHAR(64) REFERENCES courses(id),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  meeting_url TEXT,
  meeting_provider VARCHAR(50) DEFAULT 'external',
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','live','ongoing','completed','cancelled','ended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_live_class_teacher ON live_class_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_live_class_status ON live_class_sessions(status);
CREATE INDEX IF NOT EXISTS idx_live_class_scheduled ON live_class_sessions(scheduled_at);

-- ============================================================
-- 20. Announcements
-- ============================================================
CREATE TABLE IF NOT EXISTS announcements (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  author_id VARCHAR(64) NOT NULL REFERENCES users(id),
  target_type VARCHAR(20) NOT NULL DEFAULT 'global'
    CHECK (target_type IN ('global','class','course','teacher')),
  target_id VARCHAR(64), -- class_id or course_id when scoped
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  publish_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_announcements_target ON announcements(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);

-- ============================================================
-- 21. Notifications (in-app)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'info'
    CHECK (type IN ('info','success','warning','assignment','quiz','announcement','attendance','timetable','result','live_class')),
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);

-- ============================================================
-- 22. Leave requests (teachers)
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_requests (
  id VARCHAR(64) PRIMARY KEY,
  teacher_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by VARCHAR(64) REFERENCES users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leave_teacher ON leave_requests(teacher_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);

-- ============================================================
-- 23. Feedback tickets (students/teachers → admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id VARCHAR(64) PRIMARY KEY,
  submitter_id VARCHAR(64) NOT NULL REFERENCES users(id),
  category VARCHAR(50) NOT NULL DEFAULT 'general'
    CHECK (category IN ('bug','content','technical','general','complaint','suggestion')),
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to VARCHAR(64) REFERENCES users(id),
  admin_response TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tickets_submitter ON feedback_tickets(submitter_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON feedback_tickets(status);

-- ============================================================
-- 24. Audit logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  actor_id VARCHAR(64) REFERENCES users(id),
  actor_email VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(64),
  summary TEXT NOT NULL,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============================================================
-- 25. Extend quizzes table for teacher quizzes
-- ============================================================
ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS teacher_id VARCHAR(64) REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS class_id VARCHAR(64) REFERENCES classes(id),
  ADD COLUMN IF NOT EXISTS batch_id VARCHAR(64) REFERENCES batches(id),
  ADD COLUMN IF NOT EXISTS subject_id VARCHAR(64) REFERENCES subjects(id),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','published','closed','archived')),
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pass_percentage INTEGER DEFAULT 40,
  ADD COLUMN IF NOT EXISTS opens_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS closes_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS results_published BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- ============================================================
-- 26. Extend courses table for instructor_id (FK to users)
-- ============================================================
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS instructor_id VARCHAR(64) REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','published','archived'));

-- ============================================================
-- 27. Assessment results (manual marks entry)
-- ============================================================
CREATE TABLE IF NOT EXISTS assessment_results (
  id VARCHAR(64) PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id VARCHAR(64) REFERENCES subjects(id),
  class_id VARCHAR(64) REFERENCES classes(id),
  assessment_name VARCHAR(255) NOT NULL,
  assessment_type VARCHAR(30) NOT NULL DEFAULT 'exam'
    CHECK (assessment_type IN ('exam','test','quiz','assignment','project','other')),
  max_marks INTEGER NOT NULL DEFAULT 100,
  marks_obtained NUMERIC(6,2),
  grade VARCHAR(5),
  remarks TEXT,
  entered_by VARCHAR(64) REFERENCES users(id),
  published BOOLEAN NOT NULL DEFAULT false,
  exam_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_results_student ON assessment_results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_class ON assessment_results(class_id);
CREATE INDEX IF NOT EXISTS idx_results_published ON assessment_results(published);
