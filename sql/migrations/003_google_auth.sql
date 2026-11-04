-- Migration 003: Google OAuth 2.0 & OpenID Connect Account Linking
-- Adds support for Google Sign-In, secure account linking, and query optimization indexes

-- 1. Make password_hash nullable so Google OAuth accounts can register without a dummy password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Add Google OAuth identity fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50) NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_linked_at TIMESTAMP WITH TIME ZONE;

-- 3. Add high-performance indexes for authentication lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- 4. Optimization indexes for frequent assessment lookups
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_student ON mock_test_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_mock_attempts_test ON mock_test_attempts(test_id);
