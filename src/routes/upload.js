import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { requireAuth } from '../middleware/auth.js';
import { storageService, getSafeFilePath, DISALLOWED_EXTENSIONS } from '../services/storageService.js';
import { config } from '../config/env.js';

const router = Router();

// Multer memory storage configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxFileSizeMb * 1024 * 1024 // e.g. 15MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (DISALLOWED_EXTENSIONS.has(ext)) {
      const err = new Error(`Executable file extension '${ext}' is disallowed.`);
      err.code = 'DISALLOWED_FILE_TYPE';
      err.statusCode = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

/**
 * POST /api/upload
 * Authenticated upload for study materials, assignment submissions, avatars
 */
router.post('/', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File exceeds maximum allowable limit of ${config.storage.maxFileSizeMb} MB.`
          }
        });
      }
      if (err.code === 'DISALLOWED_FILE_TYPE' || (err.message && err.message.includes('disallowed'))) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'DISALLOWED_FILE_TYPE',
            message: err.message
          }
        });
      }
      return next(err);
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file was uploaded in request.' }
      });
    }

    const category = req.body.category || 'materials';
    if (!['materials', 'submissions', 'avatars'].includes(category)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CATEGORY', message: 'Category must be materials, submissions, or avatars.' }
      });
    }

    // Role check: Only students and teachers can submit homework; only teachers/admins can upload materials
    if (category === 'materials' && !['TEACHER', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only teachers and administrators can upload study materials.' }
      });
    }

    const result = await storageService.saveFile({
      file: req.file,
      category,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'File successfully uploaded and stored.'
    });
  } catch (err) {
    if (err.code === 'DISALLOWED_FILE_TYPE' || (err.message && err.message.includes('not permitted'))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DISALLOWED_FILE_TYPE',
          message: err.message
        }
      });
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds maximum allowable limit of ${config.storage.maxFileSizeMb} MB.`
        }
      });
    }
    next(err);
  }
});

/**
 * GET /api/upload/files/:category/:filename
 * Secure file delivery with path traversal prevention, inline preview, and download support
 */
router.get('/files/:category/:filename', requireAuth, async (req, res, next) => {
  try {
    const { category, filename } = req.params;

    if (!['materials', 'submissions', 'avatars'].includes(category)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CATEGORY', message: 'Invalid storage category requested.' }
      });
    }

    const decodedFilename = decodeURIComponent(filename);
    if (decodedFilename.includes('..') || decodedFilename.includes('/') || decodedFilename.includes('\\')) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Path traversal attempt detected. Access denied.' }
      });
    }

    // Private student submission security check
    if (category === 'submissions') {
      if (!['TEACHER', 'ADMIN', 'STUDENT'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: { code: 'UNAUTHORIZED_ACCESS', message: 'You do not have permission to view this submission.' }
        });
      }
    }

    const { filePath } = await storageService.getFileStream(category, filename);
    if (req.query.download === 'true') {
      const downloadName = (req.query.filename && typeof req.query.filename === 'string')
        ? path.basename(decodeURIComponent(req.query.filename))
        : decodedFilename;
      res.download(filePath, downloadName);
    } else {
      res.sendFile(filePath);
    }
  } catch (err) {
    if (err.code === 'FORBIDDEN' || err.message.includes('Path traversal') || err.message.includes('Access denied')) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied.' }
      });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'The requested file could not be found.' }
      });
    }
    next(err);
  }
});

export default router;
