import { Router } from 'express';
import { teacherController } from '../controllers/teacherController.js';
import { mockTestController } from '../controllers/mockTestController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

// All teacher routes require authentication and TEACHER role
router.use(authenticateToken, requireRole('TEACHER'));

// ── Dashboard & Overview ──
router.get('/dashboard', teacherController.getDashboard);

// ── Mock Test Join Approvals ──
router.get('/mock-tests/join-requests', mockTestController.getAllTeacherJoinRequests);
router.get('/mock-tests/:id/join-requests', mockTestController.getTestJoinRequests);
router.post('/mock-tests/join-requests/:requestId/approve', mockTestController.approveJoinRequest);
router.post('/mock-tests/join-requests/:requestId/reject', mockTestController.rejectJoinRequest);

// ── Classes & Students ──
router.get('/classes', teacherController.getClasses);
router.get('/students', teacherController.getStudents);

// ── Timetable ──
router.get('/timetable', teacherController.getTimetable);

// ── Attendance ──
router.get('/attendance', teacherController.getAttendance);
router.post('/attendance', teacherController.markAttendance);

// ── Assignments & Grading ──
router.get('/assignments', teacherController.getAssignments);
router.post('/assignments', teacherController.createAssignment);
router.get('/assignments/:id/submissions', teacherController.getSubmissions);
router.post('/submissions/:submissionId/grade', teacherController.gradeSubmission);

// ── Study Materials ──
router.get('/materials', teacherController.getMaterials);
router.post('/materials', teacherController.createMaterial);

// ── Live Classes ──
router.get('/live-classes', teacherController.getLiveClasses);
router.post('/live-classes', teacherController.createLiveClass);
router.patch('/live-classes/:id/status', teacherController.updateLiveClassStatus);
router.post('/live-classes/:id/end', teacherController.endLiveClass);

// ── Announcements ──
router.get('/announcements', teacherController.getAnnouncements);
router.post('/announcements', teacherController.createAnnouncement);

// ── Leave Requests ──
router.get('/leave-requests', teacherController.getLeaveRequests);
router.post('/leave-requests', teacherController.createLeaveRequest);

// ── Syllabus ──
router.get('/syllabus', teacherController.getSyllabus);
router.patch('/syllabus/:id', teacherController.updateSyllabusTopic);

// ── Profile ──
router.get('/profile', teacherController.getProfile);
router.put('/profile', teacherController.updateProfile);

export default router;
