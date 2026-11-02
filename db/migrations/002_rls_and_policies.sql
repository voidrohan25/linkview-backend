-- Migration: 002_rls_and_policies.sql
-- Description: Comprehensive Row Level Security (RLS) policies for Link Test

-- Enable RLS across all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper functions to extract authenticated role and tenant
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS VARCHAR AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_user_tenant()
RETURNS UUID AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 1. Profiles Policies
CREATE POLICY profiles_super_admin_all ON profiles
    FOR ALL USING (current_user_role() = 'super_admin');

CREATE POLICY profiles_self_read ON profiles
    FOR SELECT USING (id = auth.uid() OR current_user_role() IN ('trainer', 'super_admin'));

CREATE POLICY profiles_self_update ON profiles
    FOR UPDATE USING (id = auth.uid());

-- 2. Batches Policies
CREATE POLICY batches_super_admin_all ON batches
    FOR ALL USING (current_user_role() = 'super_admin');

CREATE POLICY batches_trainer_manage ON batches
    FOR ALL USING (
        current_user_role() = 'trainer' AND 
        (tenant_id = current_user_tenant() OR created_by = auth.uid())
    );

CREATE POLICY batches_student_read ON batches
    FOR SELECT USING (
        id IN (SELECT batch_id FROM batch_students WHERE student_id = auth.uid())
    );

-- 3. Questions Policies (Answer keys hidden from students)
CREATE POLICY questions_staff_access ON questions
    FOR ALL USING (current_user_role() IN ('trainer', 'super_admin'));

-- 4. Test Attempts Policies
CREATE POLICY test_attempts_super_admin_all ON test_attempts
    FOR ALL USING (current_user_role() = 'super_admin');

CREATE POLICY test_attempts_trainer_view_manage ON test_attempts
    FOR ALL USING (current_user_role() = 'trainer');

CREATE POLICY test_attempts_student_access ON test_attempts
    FOR ALL USING (student_id = auth.uid());

-- 5. Attempt Answers Policies
CREATE POLICY attempt_answers_student_modify ON attempt_answers
    FOR ALL USING (
        attempt_id IN (SELECT id FROM test_attempts WHERE student_id = auth.uid())
    );

CREATE POLICY attempt_answers_staff_read ON attempt_answers
    FOR SELECT USING (current_user_role() IN ('trainer', 'super_admin'));

-- 6. Proctoring Events Policies
CREATE POLICY attempt_events_insert ON attempt_events
    FOR INSERT WITH CHECK (
        attempt_id IN (SELECT id FROM test_attempts WHERE student_id = auth.uid())
    );

CREATE POLICY attempt_events_staff_read ON attempt_events
    FOR SELECT USING (current_user_role() IN ('trainer', 'super_admin'));
