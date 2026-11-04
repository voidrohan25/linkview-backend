import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Support loading from repository root or backend folder
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const INSECURE_JWT_DEFAULTS = new Set([
  'linktest_dev_jwt_secret_key_892348729384',
  'linktest_jwt_super_secret_key_change_in_production_2026',
  'secret',
  'jwt_secret',
  'changeme',
  'password',
  '12345678901234567890123456789012',
  'supersecretjwtkeythatissolongenough'
]);

/**
 * Validates environment variables according to runtime environment.
 * In production:
 *   - DATABASE_URL is strictly required, non-empty, and must not point to localhost.
 *   - JWT_SECRET is strictly required, non-empty, >= 32 characters, and not a known development default.
 * In development/test:
 *   - Falls back to safe local defaults for frictionless local development.
 * Note: Never log the JWT secret or credentials in error messages.
 */
export function validateConfig(rawEnv = process.env) {
  const nodeEnv = (rawEnv.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';

  if (isProduction) {
    const rawDbUrl = rawEnv.DATABASE_URL;
    const dbUrl = typeof rawDbUrl === 'string' ? rawDbUrl.trim() : '';
    if (!dbUrl) {
      throw new Error('[Startup Config Error] DATABASE_URL is required in production environment.');
    }

    if (
      dbUrl.includes('localhost') ||
      dbUrl.includes('127.0.0.1') ||
      dbUrl.includes('::1') ||
      dbUrl.includes('0.0.0.0')
    ) {
      throw new Error('[Startup Config Error] DATABASE_URL cannot point to localhost or loopback address in production.');
    }

    const rawJwtSecret = rawEnv.JWT_SECRET;
    const jwtSecret = typeof rawJwtSecret === 'string' ? rawJwtSecret.trim() : '';
    if (!jwtSecret) {
      throw new Error('[Startup Config Error] JWT_SECRET is required in production environment.');
    }

    if (jwtSecret.length < 32) {
      throw new Error('[Startup Config Error] JWT_SECRET must be at least 32 characters long in production.');
    }

    if (INSECURE_JWT_DEFAULTS.has(jwtSecret)) {
      throw new Error('[Startup Config Error] JWT_SECRET cannot use hardcoded development defaults in production.');
    }
  }

  return true;
}

/**
 * Builds the centralized configuration object from environment variables.
 */
export function buildConfig(rawEnv = process.env) {
  validateConfig(rawEnv);

  const nodeEnv = (rawEnv.NODE_ENV || 'development').trim();
  const isProduction = nodeEnv.toLowerCase() === 'production';

  return {
    port: parseInt(rawEnv.PORT || '8081', 10),
    nodeEnv,
    databaseUrl: isProduction
      ? (rawEnv.DATABASE_URL || '').trim()
      : (rawEnv.DATABASE_URL !== undefined ? rawEnv.DATABASE_URL.trim() : 'postgresql://postgres:postgres@localhost:5432/linktest'),
    jwtSecret: isProduction
      ? (rawEnv.JWT_SECRET || '').trim()
      : (rawEnv.JWT_SECRET || 'linktest_dev_jwt_secret_key_892348729384'),
    jwtExpiresIn: '7d',
    frontendUrl: rawEnv.FRONTEND_URL || 'http://localhost:5173',
    ollama: {
      baseUrl: rawEnv.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: rawEnv.OLLAMA_MODEL || 'qwen3:8b',
      timeoutMs: 45000
    },
    smtp: {
      host: (rawEnv.SMTP_HOST || 'smtp.gmail.com').trim(),
      port: parseInt(rawEnv.SMTP_PORT || '587', 10),
      secure: rawEnv.SMTP_SECURE === 'true',
      user: (rawEnv.SMTP_USER || '').trim(),
      pass: (rawEnv.SMTP_APP_PASSWORD || '').replace(/\s+/g, ''),
      fromName: rawEnv.SMTP_FROM_NAME || 'LinkTest',
      fromEmail: (rawEnv.SMTP_FROM_EMAIL || rawEnv.SMTP_USER || 'no-reply@linktest.io').trim(),
      timeoutMs: parseInt(rawEnv.SMTP_TIMEOUT_MS || '15000', 10)
    },
    storage: {
      provider: rawEnv.STORAGE_PROVIDER || 'local',
      maxFileSizeMb: parseInt(rawEnv.MAX_FILE_SIZE_MB || '15', 10),
      supabaseUrl: rawEnv.SUPABASE_URL || '',
      supabaseKey: rawEnv.SUPABASE_ANON_KEY || '',
      supabaseBucket: rawEnv.SUPABASE_STORAGE_BUCKET || 'linktest-materials'
    },
    livekit: {
      serverUrl: rawEnv.LIVEKIT_URL || rawEnv.LIVEKIT_SERVER_URL || '',
      apiKey: rawEnv.LIVEKIT_API_KEY || '',
      apiSecret: rawEnv.LIVEKIT_API_SECRET || ''
    },
    cloudAi: {
      provider: (() => {
        const p = (rawEnv.CLOUD_AI_PROVIDER || '').trim().toLowerCase();
        if (p) return p;
        const key = (rawEnv.CLOUD_AI_API_KEY || '').trim();
        if (key.startsWith('gsk_')) return 'groq';
        if (key.startsWith('sk-')) return 'openai';
        return 'groq';
      })(),
      apiKey: (rawEnv.CLOUD_AI_API_KEY || '').trim(),
      baseUrl: (rawEnv.CLOUD_AI_BASE_URL || '').trim(),
      model: (() => {
        const m = (rawEnv.CLOUD_AI_MODEL || '').trim();
        // If decommissioned Groq models are configured or if empty, default to active qwen/qwen3.8-27b
        if (!m || m === 'llama-3.1-8b-instant' || m === 'llama-3.3-70b-versatile') {
          return 'qwen/qwen3.8-27b';
        }
        return m;
      })()
    },
    google: {
      clientId: rawEnv.GOOGLE_CLIENT_ID || '',
      clientSecret: rawEnv.GOOGLE_CLIENT_SECRET || '',
      callbackUrl: rawEnv.GOOGLE_CALLBACK_URL || ''
    }
  };
}

export const config = buildConfig(process.env);


