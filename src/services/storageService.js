import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root uploads directory
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

// Ensure upload directories exist
const DIRECTORIES = {
  materials: path.join(UPLOADS_DIR, 'materials'),
  submissions: path.join(UPLOADS_DIR, 'submissions'),
  avatars: path.join(UPLOADS_DIR, 'avatars')
};

for (const dir of Object.values(DIRECTORIES)) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

// Allowed file MIME types and extensions
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'application/zip',
  'application/x-zip-compressed',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.md', '.zip', '.jpg', '.jpeg', '.png', '.webp'
]);

export const DISALLOWED_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.js', '.mjs', '.vbs', '.scr', '.msi', '.com', '.php', '.py', '.bin', '.dll', '.jar'
]);

/**
 * Sanitize filename to prevent directory traversal and overwrite attacks
 */
export function sanitizeFilename(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.bin';
  const randomHex = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${timestamp}-${randomHex}${safeExt}`;
}

/**
 * Validate upload file constraints
 */
export function validateUploadFile(file) {
  if (!file) {
    const err = new Error('No file provided for upload.');
    err.code = 'NO_FILE';
    err.statusCode = 400;
    throw err;
  }

  const maxBytes = config.storage.maxFileSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    const err = new Error(`File size exceeds maximum allowable limit of ${config.storage.maxFileSizeMb} MB.`);
    err.code = 'FILE_TOO_LARGE';
    err.statusCode = 400;
    throw err;
  }

  const ext = path.extname(file.originalname || file.name || '').toLowerCase();
  if (DISALLOWED_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
    const err = new Error(`File extension '${ext}' is not permitted. Executable or unsupported formats are rejected.`);
    err.code = 'DISALLOWED_FILE_TYPE';
    err.statusCode = 400;
    throw err;
  }

  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    const err = new Error(`File MIME type '${file.mimetype}' is not permitted.`);
    err.code = 'DISALLOWED_FILE_TYPE';
    err.statusCode = 400;
    throw err;
  }

  return true;
}

/**
 * Resolve and verify safe file path to prevent Path Traversal attacks
 */
export function getSafeFilePath(category, filename) {
  const targetDir = DIRECTORIES[category] || DIRECTORIES.materials;
  if (!filename || typeof filename !== 'string' || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    const err = new Error('Path traversal attempt detected. Access denied.');
    err.code = 'FORBIDDEN';
    err.statusCode = 403;
    throw err;
  }

  const safeFilename = path.basename(filename); // Strip any remaining path characters
  const resolvedPath = path.resolve(targetDir, safeFilename);

  // Guard against path traversal out of target directory
  if (!resolvedPath.startsWith(targetDir)) {
    const err = new Error('Path traversal attempt detected. Access denied.');
    err.code = 'FORBIDDEN';
    err.statusCode = 403;
    throw err;
  }

  return resolvedPath;
}

/**
 * Storage Service Adapter
 * Supports Local Storage and Cloud Storage (Supabase)
 */
export class StorageService {
  constructor() {
    this.provider = config.storage.provider; // 'local' | 'supabase'
  }

  /**
   * Save file buffer or move file to target destination
   */
  async saveFile({ file, category = 'materials', userId }) {
    validateUploadFile(file);
    const safeName = sanitizeFilename(file.originalname);

    if (this.provider === 'supabase' && config.storage.supabaseUrl && config.storage.supabaseKey) {
      return await this._uploadToSupabase(file, category, safeName);
    }

    // Default: Local disk storage
    return await this._saveToLocal(file, category, safeName, userId);
  }

  async _saveToLocal(file, category, safeName, userId) {
    const targetDir = DIRECTORIES[category] || DIRECTORIES.materials;
    const destPath = path.join(targetDir, safeName);

    if (file.buffer) {
      await fs.promises.writeFile(destPath, file.buffer);
    } else if (file.path) {
      await fs.promises.copyFile(file.path, destPath);
      // Clean up temp file
      try { await fs.promises.unlink(file.path); } catch (_) {}
    } else {
      throw new Error('Invalid file payload.');
    }

    const fileUrl = `/api/upload/files/${category}/${safeName}`;

    return {
      provider: 'local',
      category,
      filename: safeName,
      original_name: file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      url: fileUrl,
      file_path: fileUrl,
      file_url: fileUrl,
      storage_path: destPath
    };
  }

  async _uploadToSupabase(file, category, safeName) {
    // Adapter implementation for Supabase Storage API
    try {
      const endpoint = `${config.storage.supabaseUrl}/storage/v1/object/${config.storage.supabaseBucket}/${category}/${safeName}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.storage.supabaseKey}`,
          'Content-Type': file.mimetype || 'application/octet-stream'
        },
        body: file.buffer
      });

      if (!response.ok) {
        throw new Error(`Supabase Storage upload failed with status ${response.status}`);
      }

      const publicUrl = `${config.storage.supabaseUrl}/storage/v1/object/public/${config.storage.supabaseBucket}/${category}/${safeName}`;
      return {
        provider: 'supabase',
        category,
        filename: safeName,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        url: publicUrl,
        file_path: publicUrl,
        file_url: publicUrl,
        storage_path: `${category}/${safeName}`
      };
    } catch (err) {
      console.warn('[StorageService] Cloud upload failed, falling back to local storage:', err.message);
      return await this._saveToLocal(file, category, safeName);
    }
  }

  /**
   * Read file stream securely
   */
  async getFileStream(category, filename) {
    const filePath = getSafeFilePath(category, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found on storage server.');
    }
    return {
      stream: fs.createReadStream(filePath),
      filePath,
      stats: await fs.promises.stat(filePath)
    };
  }
}

export const storageService = new StorageService();
