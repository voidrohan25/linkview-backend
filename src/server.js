import { validateConfig } from './config/env.js';

// Validate production environment constraints (DATABASE_URL, JWT_SECRET)
if (process.env.NODE_ENV === 'production') {
  validateConfig(process.env);
}

// Execute unified production server bundle
await import('../dist/server.js');

