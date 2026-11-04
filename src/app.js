import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import { corsOptions } from './config/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getDbStatus } from './db/index.js';

import authRoutes from './routes/auth.js';
import courseRoutes from './routes/courses.js';
import lessonRoutes from './routes/lessons.js';
import quizRoutes from './routes/quizzes.js';
import progressRoutes from './routes/progress.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import teacherRoutes from './routes/teacher.js';
import studentRoutes from './routes/student.js';
import uploadRoutes from './routes/upload.js';
import livekitRoutes from './routes/livekit.js';
import mockTestRoutes from './routes/mockTests.js';
import batchRoutes from './routes/batches.js';
import studentsRoutes from './routes/students.js';
import questionBankRoutes from './routes/questionBank.js';
import subjectRoutes from './routes/subjects.js';
import codingRoutes from './routes/coding.js';
import reportsRoutes from './routes/reports.js';
import notificationsRoutes from './routes/notifications.js';
import interviewRoutes from './routes/interviews.js';
import proctoringRoutes from './routes/proctoring.js';
import { livekitService } from './services/livekitService.js';

import crypto from 'crypto';

const app = express();

// Configure trust proxy for reverse proxies (Render, Cloudflare, AWS) before rate limiters
app.set('trust proxy', 1);

// Request ID tracking & structured request logging
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Security and utility middleware
app.use(helmet({
  frameguard: { action: 'sameorigin' },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

app.use(express.json({ limit: '2mb' }));

// Health and Diagnostics Endpoint (Safe for production monitoring, no secrets leaked)
app.get('/api/health', (req, res) => {
  const dbStatus = getDbStatus();
  const livekitStatus = livekitService.getStatus();
  const storageConfigured = Boolean(config.storage?.provider);

  res.status(200).json({
    status: 'ok',
    success: true,
    data: {
      status: 'operational',
      platform: 'LinkTest Node.js Express Backend',
      name: 'LinkTest API Server',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      security: {
        helmet: 'enabled',
        cors_policy: 'strict_whitelist',
        frameguard: 'SAMEORIGIN',
        content_type_options: 'nosniff'
      },
      services: {
        database: dbStatus.connected ? 'connected' : 'unavailable',
        api: 'online',
        authentication: 'operational',
        storage: storageConfigured ? 'available' : 'not_configured',
        live_classes: livekitStatus.configured ? 'operational' : 'not_configured'
      },
      database: {
        isPostgres: dbStatus.isPostgres,
        connected: dbStatus.connected,
        type: dbStatus.type
      },
      ollama_configured_model: config.ollama.model,
      google_auth_configured: Boolean(config.google?.clientId),
      auth_methods: ['local_jwt', 'google_oauth2']
    },
    message: 'LinkTest Backend is running smoothly.'
  });
});

// Mount modular API routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/livekit', livekitRoutes);
app.use('/api/mock-tests', mockTestRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/questions', questionBankRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/coding-submissions', codingRoutes);
app.use('/api/coding', codingRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/proctoring', proctoringRoutes);

// Catch-all 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `API route '${req.method} ${req.originalUrl}' does not exist.`
    }
  });
});

// Centralized error handling
app.use(errorHandler);

export default app;
