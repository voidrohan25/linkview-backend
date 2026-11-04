import { Router } from 'express';
import { adminController } from '../controllers/adminController.js';
import { courseController } from '../controllers/courseController.js';
import { lessonController } from '../controllers/lessonController.js';
import { quizController } from '../controllers/quizController.js';
import { batchController } from '../controllers/batchController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

// Enforce authentication & ADMIN role across all admin routes
router.use(authenticateToken);
router.use(requireRole('ADMIN'));

// ── Dashboard ──────────────────────────────────────────────
router.get('/dashboard', adminController.getDashboardStats);

// ── User Management ────────────────────────────────────────
router.get('/users', adminController.getUsers);
router.patch('/users/:userId', adminController.updateUser);
router.post('/users/:userId/status', adminController.updateUserStatus);
router.patch('/users/:userId/status', adminController.updateUserStatus);
router.get('/students', adminController.getStudents);
router.post('/students', adminController.createStudent);
router.get('/students/:id', adminController.getStudentDetail);
router.put('/students/:id', adminController.updateStudent);
router.post('/students/:id/status', adminController.updateUserStatus);
router.put('/students/:id/status', adminController.updateStudentStatus);
router.post('/students/:id/reset-password', adminController.resetStudentPassword);
router.post('/students/enroll', adminController.enrollStudent);

// ── Teacher Management ─────────────────────────────────────
router.get('/teachers', adminController.getTeachers);
router.get('/teachers/:id', adminController.getTeacherDetail);
router.post('/teachers/invite', adminController.inviteTeacher);
router.get('/teachers/invitations/list', adminController.getInvitations);
router.put('/teachers/:id', adminController.updateTeacher);
router.post('/teachers/:id/status', adminController.updateUserStatus);
router.post('/teachers/:id/assign', adminController.assignTeacher);
router.post('/teachers/:teacherId/assign', adminController.assignTeacher);
router.post('/teachers/assign', adminController.assignTeacher);
router.post('/teachers/assignments', adminController.assignTeacher);
router.get('/teachers/:id/assignments', adminController.getTeacherAssignments);
router.put('/teachers/assignments/:id', adminController.updateTeacherAssignment);
router.delete('/teachers/assignments/:id', adminController.removeTeacherAssignment);
router.post('/assignments', adminController.assignTeacher);
router.put('/assignments/:id', adminController.updateTeacherAssignment);
router.delete('/assignments/:id', adminController.removeTeacherAssignment);
router.get('/batches/:batchId/assignments', adminController.getBatchAssignments);
router.post('/batches/:batchId/assignments', adminController.assignTeacher);

// ── Classes & Batches ──────────────────────────────────────
router.get('/classes', adminController.getClasses);
router.post('/classes', adminController.createClass);
router.put('/classes/:id', adminController.updateClass);
router.get('/classes/:id/students', adminController.getClassStudents);
router.post('/classes/:id/students', adminController.enrollStudent);
router.get('/classes/:classId/batches', adminController.getBatches);
router.post('/classes/:classId/batches', batchController.createBatch);

// ── Subjects ───────────────────────────────────────────────
router.get('/subjects', adminController.getSubjects);
router.post('/subjects', adminController.createSubject);

// ── Timetable ──────────────────────────────────────────────
router.get('/timetable', adminController.getTimetable);
router.post('/timetable', adminController.createTimetableEntry);
router.delete('/timetable/:id', adminController.deleteTimetableEntry);

// ── Attendance ─────────────────────────────────────────────
router.get('/attendance', adminController.getAttendance);

// ── Assignments ────────────────────────────────────────────
router.get('/assignments', adminController.getAssignments);

// ── Announcements ──────────────────────────────────────────
router.get('/announcements', adminController.getAnnouncements);
router.post('/announcements', adminController.createAnnouncement);
router.put('/announcements/:id', adminController.updateAnnouncement);

// ── Live Classes ───────────────────────────────────────────
router.get('/live-classes', adminController.getLiveClasses);
router.post('/live-classes', adminController.createLiveClass);

// ── Leave Requests ─────────────────────────────────────────
router.get('/leave-requests', adminController.getLeaveRequests);
router.post('/leave-requests/:id/review', adminController.reviewLeaveRequest);
router.patch('/leave-requests/:id/review', adminController.reviewLeaveRequest);

// ── Feedback & Support ─────────────────────────────────────
router.get('/tickets', adminController.getTickets);
router.put('/tickets/:id', adminController.updateTicket);

// ── Audit & Security Logs ─────────────────────────────────
router.get('/audit-logs', adminController.getAuditLogs);
router.get('/security-logs', adminController.getSecurityLogs);

// ── Reports ────────────────────────────────────────────────
router.get('/reports/overview', adminController.getReportsOverview);
router.get('/reports', adminController.getReportsOverview);
router.get('/reports/export', adminController.exportReportsCSV);

// ── Academic Sessions ──────────────────────────────────────
router.get('/academic-sessions', adminController.getAcademicSessions);

// ── Course Administration (existing) ──────────────────────
router.post('/courses', courseController.create);
router.put('/courses/:id', courseController.update);
router.delete('/courses/:id', courseController.delete);
router.post('/courses/:courseId/lessons', lessonController.createLesson);
router.put('/lessons/:id', lessonController.updateLesson);
router.delete('/lessons/:id', lessonController.deleteLesson);
router.post('/quizzes', quizController.createQuiz);

export default router;
