import app from './app.js';
import { config } from './config/env.js';
import { initDb, pool } from './db/index.js';

async function startServer() {
  console.log('----------------------------------------------------');
  console.log('       LinkTest | AI Learning Platform Backend       ');
  console.log('----------------------------------------------------');

  // Initialize Database connection (PostgreSQL with fallback)
  await initDb();


  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[LinkTest Server] Ready and listening on port ${config.port} (0.0.0.0)`);
    console.log(`[LinkTest Server] Health Check: http://localhost:${config.port}/api/health`);
    console.log(`[LinkTest Server] AI Status:    http://localhost:${config.port}/api/ai/status`);
    console.log(`[LinkTest Server] Environment:  ${config.nodeEnv}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[LinkTest Server] Fatal: Port ${config.port} is already in use by another process.`);
    } else {
      console.error('[LinkTest Server] Fatal server error:', err.message);
    }
    process.exit(1);
  });

  const shutdown = async (signal) => {
    console.log(`\n[LinkTest Server] Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      if (pool) {
        await pool.end();
      }
      console.log('[LinkTest Server] Server closed. Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[LinkTest Server] Unhandled Promise Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[LinkTest Server] Uncaught Exception:', err);
    shutdown('UNCAUGHT_EXCEPTION');
  });
}

startServer().catch(err => {
  console.error('[LinkTest Server] Fatal startup failure:', err);
  process.exit(1);
});
