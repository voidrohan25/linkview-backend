-- Rollback Migration 003: Remove Google OAuth columns and performance indexes

DROP INDEX IF EXISTS idx_mock_attempts_test;
DROP INDEX IF EXISTS idx_mock_attempts_student;
DROP INDEX IF EXISTS idx_quiz_attempts_user;
DROP INDEX IF EXISTS idx_users_email_lower;
DROP INDEX IF EXISTS idx_users_auth_provider;
DROP INDEX IF EXISTS idx_users_google_id;

ALTER TABLE users DROP COLUMN IF EXISTS account_linked_at;
ALTER TABLE users DROP COLUMN IF EXISTS auth_provider;
ALTER TABLE users DROP COLUMN IF EXISTS google_id;
