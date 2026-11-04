import { lmsRepository } from '../repositories/lmsRepository.js';
import { progressRepository } from '../repositories/progressRepository.js';
import { quizRepository } from '../repositories/quizRepository.js';
import { courseRepository } from '../repositories/courseRepository.js';
import { mockTestRepository } from '../repositories/mockTestRepository.js';
import { logAudit } from '../repositories/auditRepository.js';
import { notificationService } from '../services/notificationService.js';
import { z } from 'zod';

const submitAssignmentSchema = z.object({
  content: z.string().optional().default(''),
  file_path: z.string().optional().nullable(),
  file_name: z.string().optional().nullable()
});

const createTicketSchema = z.object({
  category: z.enum(['academic', 'technical', 'administrative', 'other']).default('academic'),
  subject: z.string().min(3).max(255),
  description: z.string().min(10).max(2000)
});

export const studentController = {
  // ── Student Dashboard Overview ──────────────────────────────────────
  async getDashboard(req, res, next) {
    try {
      const studentId = req.user.id;
      const todayDayOfWeek = new Date().getDay();

      // Get enrolled classes
      const enrollments = await lmsRepository.getClassesForStudent(studentId);
      const classId = enrollments[0]?.class_id;
      const batchId = enrollments[0]?.batch_id;

      const [timetable, assignments, attendance, liveClasses, announcements, overallProgress, quizAttempts] = await Promise.all([
        classId ? lmsRepository.getTimetable({ classId, batchId, dayOfWeek: todayDayOfWeek }) : [],
        lmsRepository.getAssignments({ studentId, classId }),
        lmsRepository.getAttendance({ studentId }),
        lmsRepository.getLiveClasses({ studentId }),
        lmsRepository.getAnnouncements({ limit: 5 }),
        progressRepository.getUserProgressSummary(studentId),
        quizRepository.getUserAttempts(studentId)
      ]);

      // Calculate attendance percentage
      const totalAttendanceDays = attendance.length;
      const presentDays = attendance.filter(a => a.status === 'present' || a.status === 'late').length;
      const attendancePercentage = totalAttendanceDays > 0 ? Math.round((presentDays / totalAttendanceDays) * 100) : 100;

      // Pending assignments (due in future, not submitted yet)
      const pendingAssignments = assignments.filter(a => !a.submission_status || a.submission_status === 'pending');

      res.status(200).json({
        success: true,
        data: {
          enrolled_classes: enrollments,
          attendance_stats: {
            total_days: totalAttendanceDays,
            present_days: presentDays,
            percentage: attendancePercentage
          },
          metrics: {
            enrolled_classes_count: enrollments.length,
            pending_assignments_count: pendingAssignments.length,
            attendance_percentage: attendancePercentage,
            today_classes_count: timetable.length,
            completed_quizzes_count: quizAttempts.length
          },
          summary: {
            enrolled_classes_count: enrollments.length,
            pending_assignments_count: pendingAssignments.length,
            attendance_percentage: attendancePercentage,
            today_classes_count: timetable.length,
            completed_quizzes_count: quizAttempts.length
          },
          today_schedule: timetable,
          pending_assignments: pendingAssignments.slice(0, 5),
          upcoming_live_classes: (Array.isArray(liveClasses) ? liveClasses : []).filter(lc => lc.status === 'scheduled' || lc.status === 'ongoing').slice(0, 3),
          announcements: announcements.slice(0, 5),
          overall_progress: overallProgress
        }
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Enrolled Classes ────────────────────────────────────────────────
  async getEnrolledClasses(req, res, next) {
    try {
      const classes = await lmsRepository.getClassesForStudent(req.user.id);
      res.status(200).json({ success: true, data: classes });
    } catch (err) {
      next(err);
    }
  },

  // ── Timetable ────────────────────────────────────────────────────────
  async getTimetable(req, res, next) {
    try {
      const enrollments = await lmsRepository.getClassesForStudent(req.user.id);
      if (enrollments.length === 0) {
        return res.status(200).json({ success: true, data: [] });
      }

      const { dayOfWeek } = req.query;
      const classId = enrollments[0].class_id;
      const batchId = enrollments[0].batch_id;

      const entries = await lmsRepository.getTimetable({
        classId,
        batchId,
        dayOfWeek: dayOfWeek !== undefined ? parseInt(dayOfWeek, 10) : undefined
      });

      res.status(200).json({ success: true, data: entries });
    } catch (err) {
      next(err);
    }
  },

  // ── Attendance Records ───────────────────────────────────────────────
  async getAttendance(req, res, next) {
    try {
      const records = await lmsRepository.getAttendance({ studentId: req.user.id });
      const total = records.length;
      const present = records.filter(r => r.status === 'present').length;
      const late = records.filter(r => r.status === 'late').length;
      const absent = records.filter(r => r.status === 'absent').length;
      const percentage = total > 0 ? Math.round(((present + late) / total) * 100) : 100;

      res.status(200).json({
        success: true,
        data: {
          summary: { total, present, late, absent, percentage },
          records
        }
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Assignments & Submissions ────────────────────────────────────────
  async getAssignments(req, res, next) {
    try {
      const { classId, batchId } = req.query;
      const assignments = await lmsRepository.getAssignments({
        classId: classId || undefined,
        batchId: batchId || undefined,
        studentId: req.user.id
      });
      res.status(200).json({ success: true, data: assignments });
    } catch (err) {
      next(err);
    }
  },

  async submitAssignment(req, res, next) {
    try {
      const { id } = req.params;
      const parsed = submitAssignmentSchema.parse(req.body);

      // Enforce single assignment submission policy
      const existing = await lmsRepository.getSubmission(id, req.user.id);
      if (existing && ['submitted', 'graded'].includes(existing.status)) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'ALREADY_SUBMITTED',
            message: 'You have already submitted this assignment. Resubmission is not permitted.'
          }
        });
      }

      const submission = await lmsRepository.submitAssignment({
        assignmentId: id,
        studentId: req.user.id,
        content: parsed.content,
        filePath: parsed.file_path,
        fileName: parsed.file_name
      });

      await logAudit(req.user, 'SUBMIT_ASSIGNMENT', 'assignment_submissions', submission.id, `Submitted assignment ${id}`);
      res.status(200).json({
        success: true,
        data: submission,
        message: 'Assignment submitted successfully.'
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Study Materials ──────────────────────────────────────────────────
  async getMaterials(req, res, next) {
    try {
      const studentId = req.user.id;
      const enrolledClasses = await lmsRepository.getClassesForStudent(studentId);
      const classIds = (enrolledClasses || []).map(c => c.id || c.class_id).filter(Boolean);
      const batchIds = (enrolledClasses || []).map(c => c.batch_id).filter(Boolean);
      const enrolledCourses = await courseRepository.getEnrolledCoursesForUser(studentId);
      const courseIds = (enrolledCourses || []).map(c => c.id).filter(Boolean);

      const materials = await lmsRepository.getMaterials({
        studentAccess: { classIds, batchIds, courseIds },
        published: true
      });
      res.status(200).json({ success: true, data: materials });
    } catch (err) {
      next(err);
    }
  },

  // ── Student Progress & Mock Test Analytics ───────────────────────────
  async getProgress(req, res, next) {
    try {
      const studentId = req.user.id;
      const rawAttempts = await mockTestRepository.getAttemptsByStudent(studentId);

      const attempts = [];
      const testAttemptsMap = {};

      for (const a of rawAttempts) {
        let correctCount = a.correct_count;
        let incorrectCount = a.incorrect_count;
        let unansweredCount = a.unanswered_count;
        let timeSpent = a.time_spent_seconds || 0;
        let maxScore = parseFloat(a.max_score || 0);
        let totalScore = parseFloat(a.total_score || 0);

        if (correctCount === null || correctCount === undefined) {
          const detailed = await mockTestRepository.getAttemptById(a.id);
          const responses = detailed?.responses || [];
          correctCount = responses.filter(r => r.is_correct === true).length;
          incorrectCount = responses.filter(r => r.is_correct === false).length;
          const questions = await mockTestRepository.getQuestionsByTestId(a.test_id);
          const totalQ = questions.length;
          unansweredCount = Math.max(0, totalQ - responses.length);
          if (maxScore === 0) {
            maxScore = questions.reduce((acc, q) => acc + (parseFloat(q.marks) || 1), 0);
          }
        }

        const totalQuestions = (correctCount || 0) + (incorrectCount || 0) + (unansweredCount || 0);
        const attemptedQuestions = (correctCount || 0) + (incorrectCount || 0);
        const accuracy = attemptedQuestions > 0 ? Math.round(((correctCount || 0) / attemptedQuestions) * 100) : 0;
        const percentage = parseFloat(a.percentage || (maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(2) : 0));

        if (!testAttemptsMap[a.test_id]) {
          testAttemptsMap[a.test_id] = await mockTestRepository.getAttemptsByTest(a.test_id);
        }
        const peerAttempts = testAttemptsMap[a.test_id] || [];
        const sortedPeers = [...peerAttempts]
          .filter(p => ['submitted', 'evaluated'].includes(p.status))
          .sort((x, y) => {
            const scoreDiff = parseFloat(y.total_score || 0) - parseFloat(x.total_score || 0);
            if (scoreDiff !== 0) return scoreDiff;
            return (x.time_spent_seconds || 0) - (y.time_spent_seconds || 0);
          });
        const rankIndex = sortedPeers.findIndex(p => p.id === a.id);
        const rank = rankIndex !== -1 ? `${rankIndex + 1} / ${sortedPeers.length}` : '—';

        attempts.push({
          id: a.id,
          test_id: a.test_id,
          test_name: a.test_title || 'Mock Examination',
          subject: a.subject || 'General',
          date: a.submitted_at || a.started_at,
          total_questions: totalQuestions,
          questions_attempted: attemptedQuestions,
          correct_answers: correctCount || 0,
          wrong_answers: incorrectCount || 0,
          unanswered_questions: unansweredCount || 0,
          total_marks: maxScore,
          marks_obtained: totalScore,
          percentage,
          time_taken_seconds: timeSpent,
          accuracy,
          rank,
          passed: Boolean(a.passed),
          status: a.status
        });
      }

      const completedAttempts = attempts.filter(a => ['submitted', 'evaluated'].includes(a.status));
      const totalAttempted = completedAttempts.length;

      let avgScore = 0;
      let highestScore = 0;
      let lowestScore = 0;
      let avgPercentage = 0;
      let avgAccuracy = 0;
      let totalQuestionsAttempted = 0;
      let totalCorrect = 0;
      let totalWrong = 0;
      let totalUnanswered = 0;
      let totalTimeSpent = 0;

      if (totalAttempted > 0) {
        const scores = completedAttempts.map(a => a.marks_obtained);
        const pcts = completedAttempts.map(a => a.percentage);
        const accs = completedAttempts.map(a => a.accuracy);

        avgScore = parseFloat((scores.reduce((sum, s) => sum + s, 0) / totalAttempted).toFixed(2));
        highestScore = Math.max(...scores);
        lowestScore = Math.min(...scores);
        avgPercentage = parseFloat((pcts.reduce((sum, p) => sum + p, 0) / totalAttempted).toFixed(2));
        avgAccuracy = Math.round(accs.reduce((sum, ac) => sum + ac, 0) / totalAttempted);

        totalCorrect = completedAttempts.reduce((sum, a) => sum + a.correct_answers, 0);
        totalWrong = completedAttempts.reduce((sum, a) => sum + a.wrong_answers, 0);
        totalUnanswered = completedAttempts.reduce((sum, a) => sum + a.unanswered_questions, 0);
        totalQuestionsAttempted = totalCorrect + totalWrong;
        totalTimeSpent = completedAttempts.reduce((sum, a) => sum + a.time_taken_seconds, 0);
      }

      const trend = [...completedAttempts]
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(a => ({
          test_name: a.test_name,
          date: a.date ? new Date(a.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '',
          score: a.marks_obtained,
          max_score: a.total_marks,
          percentage: a.percentage,
          accuracy: a.accuracy
        }));

      const allQ = totalCorrect + totalWrong + totalUnanswered;
      const accuracyBreakdown = {
        correct_count: totalCorrect,
        wrong_count: totalWrong,
        unanswered_count: totalUnanswered,
        correct_percentage: allQ > 0 ? Math.round((totalCorrect / allQ) * 100) : 0,
        wrong_percentage: allQ > 0 ? Math.round((totalWrong / allQ) * 100) : 0,
        unanswered_percentage: allQ > 0 ? Math.round((totalUnanswered / allQ) * 100) : 0
      };

      const subjectMap = {};
      completedAttempts.forEach(a => {
        const sub = a.subject || 'General';
        if (!subjectMap[sub]) {
          subjectMap[sub] = {
            subject: sub,
            attempts_count: 0,
            scores: [],
            percentages: [],
            correct: 0,
            wrong: 0,
            unanswered: 0
          };
        }
        subjectMap[sub].attempts_count++;
        subjectMap[sub].scores.push(a.marks_obtained);
        subjectMap[sub].percentages.push(a.percentage);
        subjectMap[sub].correct += a.correct_answers;
        subjectMap[sub].wrong += a.wrong_answers;
        subjectMap[sub].unanswered += a.unanswered_questions;
      });

      const subjects = Object.values(subjectMap).map(s => {
        const attQ = s.correct + s.wrong;
        const totalQ = attQ + s.unanswered;
        const avgPct = s.percentages.length > 0 ? parseFloat((s.percentages.reduce((a, b) => a + b, 0) / s.percentages.length).toFixed(1)) : 0;
        const acc = attQ > 0 ? Math.round((s.correct / attQ) * 100) : 0;
        const avgSc = s.scores.length > 0 ? parseFloat((s.scores.reduce((a, b) => a + b, 0) / s.scores.length).toFixed(1)) : 0;
        return {
          subject: s.subject,
          attempts_count: s.attempts_count,
          average_score: avgSc,
          average_percentage: avgPct,
          accuracy: acc,
          total_questions: totalQ,
          questions_attempted: attQ,
          correct_count: s.correct,
          wrong_count: s.wrong
        };
      });

      let bestSubject = null;
      let weakestSubject = null;
      if (subjects.length > 0) {
        const sorted = [...subjects].sort((a, b) => b.average_percentage - a.average_percentage);
        bestSubject = sorted[0];
        weakestSubject = sorted[sorted.length - 1];
      }

      res.status(200).json({
        success: true,
        data: {
          overall: {
            total_mock_tests_attempted: totalAttempted,
            average_score: avgScore,
            highest_score: highestScore,
            lowest_score: lowestScore,
            average_percentage: avgPercentage,
            average_accuracy: avgAccuracy,
            total_questions_attempted: totalQuestionsAttempted,
            total_correct: totalCorrect,
            total_wrong: totalWrong,
            total_unanswered: totalUnanswered,
            total_time_spent_seconds: totalTimeSpent
          },
          trend,
          accuracy_breakdown: accuracyBreakdown,
          subjects,
          best_subject: bestSubject,
          weakest_subject: weakestSubject,
          attempts
        }
      });
    } catch (err) {
      next(err);
    }
  },

  // ── Live Classes ─────────────────────────────────────────────────────
  async getLiveClasses(req, res, next) {
    try {
      const liveClasses = await lmsRepository.getLiveClasses({
        studentId: req.user.id
      });
      res.status(200).json({ success: true, data: liveClasses });
    } catch (err) {
      next(err);
    }
  },

  // ── Announcements ────────────────────────────────────────────────────
  async getAnnouncements(req, res, next) {
    try {
      const announcements = await lmsRepository.getAnnouncements({ limit: 50 });
      res.status(200).json({ success: true, data: announcements });
    } catch (err) {
      next(err);
    }
  },

  // ── Notifications ────────────────────────────────────────────────────
  async getNotifications(req, res, next) {
    try {
      const { unreadOnly } = req.query;
      const data = await notificationService.getNotifications(req.user.id, {
        unreadOnly: unreadOnly === 'true'
      });
      // Maintain backwards compatibility: data can be array or object
      res.status(200).json({ success: true, data: data.notifications, unread_count: data.unread_count });
    } catch (err) {
      next(err);
    }
  },

  async markNotificationsRead(req, res, next) {
    try {
      const { ids } = req.body;
      const updated = await notificationService.markAsRead(req.user.id, ids || null);
      res.status(200).json({ success: true, data: updated, message: 'Notifications marked as read.' });
    } catch (err) {
      next(err);
    }
  },

  // ── Support / Feedback Tickets ───────────────────────────────────────
  async getTickets(req, res, next) {
    try {
      const tickets = await lmsRepository.getTickets({ submitterId: req.user.id });
      res.status(200).json({ success: true, data: tickets });
    } catch (err) {
      next(err);
    }
  },

  async createTicket(req, res, next) {
    try {
      const parsed = createTicketSchema.parse(req.body);
      const ticket = await lmsRepository.createTicket({
        submitterId: req.user.id,
        category: parsed.category,
        subject: parsed.subject,
        description: parsed.description
      });

      await logAudit(req.user, 'CREATE_TICKET', 'feedback_tickets', ticket.id, `Created support ticket "${parsed.subject}"`);
      res.status(201).json({
        success: true,
        data: ticket,
        message: 'Feedback/Support ticket submitted.'
      });
    } catch (err) {
      next(err);
    }
  }
};
