import { Router } from 'express';
import { batchController } from '../controllers/batchController.js';
import { authenticateToken, requireAnyRole, requireRole } from '../middleware/auth.js';

const router = Router();

// All batch operations require authentication (ADMIN or TEACHER only)
router.use(authenticateToken, requireAnyRole('ADMIN', 'TEACHER'));

// ── Batch CRUD ─────────────────────────────────────────────────────────────
router.get('/', batchController.getBatches);
router.post('/', requireRole('ADMIN'), batchController.createBatch);

router.get('/:batchId', batchController.getBatchDetail);
router.patch('/:batchId', requireRole('ADMIN'), batchController.updateBatch);
router.post('/:batchId/archive', requireRole('ADMIN'), batchController.archiveBatch);
router.delete('/:batchId', requireRole('ADMIN'), batchController.deleteBatch);

// ── Teacher Allocations ────────────────────────────────────────────────────
router.get('/:batchId/teachers', batchController.getBatchTeachers);
router.post('/:batchId/teachers', requireRole('ADMIN'), batchController.assignTeacher);
router.delete('/:batchId/teachers/:teacherId', requireRole('ADMIN'), batchController.removeTeacher);

// ── Student Enrollments ────────────────────────────────────────────────────
router.get('/:batchId/students', batchController.getBatchStudents);
router.post('/:batchId/students', batchController.enrollStudents);
router.delete('/:batchId/students/:studentId', batchController.removeStudent);

export default router;
