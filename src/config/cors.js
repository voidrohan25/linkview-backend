import { config } from './env.js';

/**
 * Returns list of allowed origins from environment FRONTEND_URL and local dev ports.
 */
export function getAllowedOrigins() {
  const configuredOrigins = (config.frontendUrl || '')
    .split(',')
    .map(url => url.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const defaultOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:4173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:4173'
  ];

  return Array.from(new Set([...configuredOrigins, ...defaultOrigins]));
}

/**
 * Validates whether an incoming origin is permitted by policy.
 */
export function isOriginAllowed(origin) {
  // Allow requests without Origin header (e.g. server-to-server, curl, tests)
  if (!origin) return true;

  const normalizedOrigin = origin.replace(/\/+$/, '');
  const allowed = getAllowedOrigins();

  if (allowed.includes(normalizedOrigin)) {
    return true;
  }

  // Safe check for preview deployments
  try {
    const parsed = new URL(origin);
    if (parsed.hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch {
    // Ignore URL parse error
  }

  return false;
}

/**
 * Express CORS configuration options.
 */
export const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    const err = new Error(`CORS policy does not allow access from origin ${origin}`);
    err.statusCode = 403;
    err.status = 403;
    err.code = 'CORS_FORBIDDEN';
    return callback(err);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
  credentials: true,
  optionsSuccessStatus: 204
};

/**
 * Generates secure cookie options according to environment.
 */
export function getSecureCookieOptions(overrides = {}) {
  const isProd = config.nodeEnv === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    ...overrides
  };
}
