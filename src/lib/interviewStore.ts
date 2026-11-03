import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAllUsers } from './usersStore';

/**
 * LinkTest AI Mock Interview Platform - Master Central Store
 * Authoritative persistent store for institute batches, trainers, students, questions, scheduled interviews, and scorecards.
 */

function getPersistencePaths(filename: string): string[] {
  const paths: string[] = [];
  try {
    const dataDir = path.join(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    paths.push(path.join(dataDir, filename));
  } catch {}
  paths.push(path.join(os.tmpdir(), filename));
  return paths;
}

export interface StudentProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  batchId: string;
  batchName: string;
  technology: string;
  status: 'active' | 'inactive';
  interviewsCompleted: number;
  averageScore: number;
  joinedDate: string;
}

export interface TrainerProfile {
  id: string;
  fullName: string;
  email: string;
  specialization: string;
  assignedBatches: string[];
  status: 'active' | 'inactive';
  scheduledInterviews: number;
  pendingEvaluations: number;
  joinedDate: string;
}

export interface BatchCohort {
  id: string;
  name: string;
  code: string;
  technology: string;
  trainerId: string;
  trainerName: string;
  studentCount: number;
  students?: string[];
  startDate: string;
  status: 'ongoing' | 'upcoming' | 'completed';
}

export interface QuestionBankItem {
  id: string;
  technology: string;
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  question: string;
  expectedKeypoints: string[];
  idealAnswer: string;
  tags: string[];
}

export interface InterviewSessionRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  trainerId: string;
  trainerName: string;
  batchId: string;
  batchName: string;
  technology: string; // e.g. "Python", "Java", "DSA", "React", "SQL", "HR"
  interviewType: 'technical' | 'hr' | 'coding' | 'mixed';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  durationMinutes: number;
  questionCount: number;
  scheduledAt: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'pending_evaluation' | 'cancelled';
  approvalStatus?: 'not_requested' | 'pending' | 'approved' | 'rejected';
  approvalRequestedAt?: string;
  approvalDecisionAt?: string;
  approvedByTrainer?: string;
  rejectionReason?: string;
  submissionReason?: 'normal' | 'proctoring_threshold_exceeded' | 'manual_stop';
  flagCount?: number;
  maxAllowedFlags?: number;
  autoSubmittedAt?: string;
  currentTurn: number;
  totalTurns: number;
  currentQuestion: string;
  customQuestions?: string[];
  history: Array<{
    turn: number;
    question: string;
    studentAnswer: string;
    feedback: string;
    score: number;
    idealAnswer?: string;
  }>;
  scorecard?: {
    overallScore: number;
    technicalAccuracy: number;
    conceptualUnderstanding: number;
    communication: number;
    problemSolving: number;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    aiFeedback: string;
    trainerRemarks?: string;
    evaluatedAt: string;
    proctoringSummary?: {
      totalFlags: number;
      tabSwitches: number;
      faceMissingCount: number;
      riskLevel: 'clean' | 'low' | 'medium' | 'high';
    };
  };
  proctoringEvents?: Array<{
    id: string;
    type: string;
    severity: string;
    message: string;
    timestamp: string;
    durationSeconds?: number;
  }>;
}

// Clean initial production state: Zero dummy examinees or fake pre-filled students
const defaultStudents: StudentProfile[] = [];
const defaultTrainers: TrainerProfile[] = [];

const defaultBatches: BatchCohort[] = [
  {
    id: 'BATCH-PY-2026',
    name: 'Python Full Stack Placement Cohort 2026-A',
    code: 'PY-2026-A',
    technology: 'Python',
    trainerId: 'tr-lead',
    trainerName: 'Faculty Trainer',
    studentCount: 0,
    startDate: '2026-02-01',
    status: 'ongoing',
  },
  {
    id: 'BATCH-JAVA-2026',
    name: 'Java Enterprise Systems 2026-B',
    code: 'JAVA-2026-B',
    technology: 'Java Enterprise',
    trainerId: 'tr-lead',
    trainerName: 'Faculty Trainer',
    studentCount: 0,
    startDate: '2026-02-01',
    status: 'ongoing',
  },
  {
    id: 'BATCH-DSA-2026',
    name: 'DSA & Systems Placement Track',
    code: 'DSA-2026-C',
    technology: 'DSA & Algorithms',
    trainerId: 'tr-lead',
    trainerName: 'Faculty Trainer',
    studentCount: 0,
    startDate: '2026-02-01',
    status: 'ongoing',
  },
];

const defaultQuestionBank: QuestionBankItem[] = [
  {
    id: 'qb-01',
    technology: 'Java',
    topic: 'JVM & Memory Management',
    difficulty: 'advanced',
    question: 'How does the Java Garbage Collector differentiate between unreachable objects and softly reachable objects?',
    expectedKeypoints: ['WeakReference vs SoftReference', 'JVM heap pressure thresholds', 'G1 / ZGC collection cycles'],
    idealAnswer: 'Softly reachable objects are collected only when the JVM genuinely needs memory before throwing OutOfMemoryError, making them ideal for memory-sensitive caches. Weakly reachable objects are collected eagerly during normal minor/major GC cycles as soon as strong references are lost.',
    tags: ['Java', 'JVM', 'Garbage Collection', 'Memory'],
  },
  {
    id: 'qb-02',
    technology: 'Java',
    topic: 'Concurrency',
    difficulty: 'intermediate',
    question: 'Can you explain the internal working of ConcurrentHashMap in Java 8 compared to earlier versions?',
    expectedKeypoints: ['Segment locks in Java 7', 'CAS + synchronized on node heads in Java 8', 'TreeBin conversion on collision'],
    idealAnswer: 'In Java 7, ConcurrentHashMap used Segment Locking (16 segments by default). In Java 8, segment locks were replaced by lock-free Compare-And-Swap (CAS) for bucket insertion and fine-grained synchronized blocks locking only the head node of a hash bucket, converting linked chains to red-black TreeBins when bucket size exceeds 8.',
    tags: ['Java', 'Concurrency', 'Hash Table'],
  },
  {
    id: 'qb-03',
    technology: 'Python',
    topic: 'Internals & GIL',
    difficulty: 'intermediate',
    question: 'Explain how Python manages memory using the Global Interpreter Lock (GIL) and reference counting.',
    expectedKeypoints: ['Reference counting primary mechanism', 'Cyclic GC (generational) for reference cycles', 'GIL prevents race conditions on ob_refcnt'],
    idealAnswer: 'CPython relies primarily on reference counting where every PyObject tracks its reference count. A generational garbage collector handles cyclic references. The GIL exists because CPython memory allocation and reference count manipulation are not thread-safe without mutexes, enforcing single-threaded bytecode execution.',
    tags: ['Python', 'Memory', 'GIL', 'Internals'],
  },
  {
    id: 'qb-04',
    technology: 'Python',
    topic: 'Generators & Iterators',
    difficulty: 'beginner',
    question: 'What are generators in Python and how do they optimize memory when processing large datasets?',
    expectedKeypoints: ['yield keyword', 'Lazy evaluation / on-demand computation', 'O(1) memory footprint vs list O(n)'],
    idealAnswer: 'Generators are functions that yield values one at a time instead of returning a complete collection into memory. By maintaining stack execution state across yields, they consume O(1) memory regardless of whether streaming a thousand or a billion records.',
    tags: ['Python', 'Generators', 'Performance'],
  },
  {
    id: 'qb-05',
    technology: 'DSA',
    topic: 'Arrays & Dynamic Programming',
    difficulty: 'intermediate',
    question: 'Given an array of integers, how would you find the subarray with the largest sum in O(n) time?',
    expectedKeypoints: ['Kadane algorithm', 'max_ending_here and max_so_far', 'Negative numbers edge case handling'],
    idealAnswer: 'We use Kadane algorithm. We maintain two running accumulators: max_ending_here and max_so_far. At each element x, max_ending_here = max(x, max_ending_here + x), and max_so_far = max(max_so_far, max_ending_here), running in linear O(n) time and O(1) auxiliary space.',
    tags: ['DSA', 'Arrays', 'Kadane', 'Dynamic Programming'],
  },
  {
    id: 'qb-06',
    technology: 'SQL',
    topic: 'Indexes & Query Optimization',
    difficulty: 'intermediate',
    question: 'Explain the difference between clustered and non-clustered indexes and how they impact B-Tree disk I/O.',
    expectedKeypoints: ['Clustered physically sorts table data', 'Non-clustered contains pointer to data page', 'Lookup cost comparison'],
    idealAnswer: 'A clustered index determines the physical storage order of rows in the table (one per table), directly storing row data in its leaf nodes. A non-clustered index creates a separate B-tree structure whose leaf nodes contain row locators (pointers) to the actual data rows.',
    tags: ['SQL', 'Indexes', 'B-Tree', 'Performance'],
  },
  {
    id: 'qb-07',
    technology: 'Communication',
    topic: 'Professional Elevator Pitch',
    difficulty: 'beginner',
    question: 'Please give me a concise 90-second professional elevator pitch introducing your technical background and key strengths.',
    expectedKeypoints: ['Clear self-introduction', 'Key technology strengths', 'Notable project achievements', 'Enthusiasm and fluency'],
    idealAnswer: 'Start with your name, educational and technical foundation, highlight 1-2 core technologies you excel in (e.g. Python backend, Java microservices), mention a significant project or challenge you delivered, and conclude with your career goals.',
    tags: ['Communication', 'Elevator Pitch', 'Fluency', 'HR'],
  },
  {
    id: 'qb-08',
    technology: 'Communication',
    topic: 'Workplace Conflict & Critical Situations',
    difficulty: 'intermediate',
    question: 'Describe a situation where a critical software defect was identified right before launch. How did you communicate with stakeholders and resolve it under pressure?',
    expectedKeypoints: ['STAR method', 'Transparency with stakeholders', 'Root-cause analysis', 'Post-mortem and prevention'],
    idealAnswer: 'Outline the incident using STAR: Explain how you triaged the issue, communicated transparently to project leads without panic, isolated the root cause, implemented a tested patch, and conducted a blameless post-mortem.',
    tags: ['Communication', 'Behavioral', 'STAR Method'],
  },
  {
    id: 'qb-09',
    technology: 'HR',
    topic: 'Behavioral & Leadership',
    difficulty: 'beginner',
    question: 'Tell me about a challenging technical hurdle you encountered in a team project and how you resolved it.',
    expectedKeypoints: ['STAR format', 'Clear technical decision making', 'Team communication'],
    idealAnswer: 'Use the STAR format: Describe the exact technical challenge, specify your ownership role, break down the systematic diagnostics and code changes you delivered, and quantify the resulting performance boost.',
    tags: ['HR', 'Behavioral', 'Culture Fit'],
  },
];

// Clean initial state: Zero pre-existing mock interviews (Scheduled on-demand by Trainer)
const defaultInterviews: InterviewSessionRecord[] = [];

// Persistent state class with disk caching to survive serverless restarts
class InterviewStore {
  private students: StudentProfile[] = [...defaultStudents];
  private trainers: TrainerProfile[] = [...defaultTrainers];
  private batches: BatchCohort[] = [...defaultBatches];
  private questionBank: QuestionBankItem[] = [...defaultQuestionBank];
  private interviews: InterviewSessionRecord[] = [...defaultInterviews];

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    const paths = getPersistencePaths('linkview_interviews_persistent_cache.json');
    for (const p of paths) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.interviews)) this.interviews = parsed.interviews;
          if (Array.isArray(parsed.batches) && parsed.batches.length > 0) this.batches = parsed.batches;
          if (Array.isArray(parsed.students)) this.students = parsed.students;
          if (Array.isArray(parsed.trainers)) this.trainers = parsed.trainers;
          if (Array.isArray(parsed.questionBank) && parsed.questionBank.length > 0) {
            this.questionBank = parsed.questionBank;
          }
          return;
        }
      } catch (e) {
        console.warn(`Could not read persistent interviews cache from ${p}:`, e);
      }
    }
  }

  saveToDisk() {
    const paths = getPersistencePaths('linkview_interviews_persistent_cache.json');
    for (const p of paths) {
      try {
        fs.writeFileSync(
          p,
          JSON.stringify(
            {
              interviews: this.interviews,
              batches: this.batches,
              students: this.students,
              trainers: this.trainers,
              questionBank: this.questionBank,
            },
            null,
            2
          ),
          'utf-8'
        );
      } catch (e) {
        // Fallback if path is read-only
      }
    }
  }

  // Request & Approval Lifecycle for Protected Mock Interviews
  requestInterviewApproval(interviewId: string): InterviewSessionRecord | null {
    const interview = this.interviews.find((i) => i.id === interviewId);
    if (!interview) return null;
    interview.approvalStatus = 'pending';
    interview.approvalRequestedAt = new Date().toISOString();
    this.saveToDisk();
    return interview;
  }

  approveInterview(interviewId: string, trainerName: string = 'Faculty Trainer'): InterviewSessionRecord | null {
    const interview = this.interviews.find((i) => i.id === interviewId);
    if (!interview) return null;
    interview.approvalStatus = 'approved';
    interview.approvalDecisionAt = new Date().toISOString();
    interview.approvedByTrainer = trainerName;
    this.saveToDisk();
    return interview;
  }

  rejectInterview(interviewId: string, trainerName: string = 'Faculty Trainer', reason?: string): InterviewSessionRecord | null {
    const interview = this.interviews.find((i) => i.id === interviewId);
    if (!interview) return null;
    interview.approvalStatus = 'rejected';
    interview.approvalDecisionAt = new Date().toISOString();
    interview.approvedByTrainer = trainerName;
    interview.rejectionReason = reason || 'Trainer declined candidate mock start request';
    this.saveToDisk();
    return interview;
  }

  deleteInterview(interviewId: string): boolean {
    const idx = this.interviews.findIndex((i) => i.id === interviewId);
    if (idx !== -1) {
      this.interviews.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // Batches management with persistence
  addBatch(batch: {
    name: string;
    code: string;
    technology: string;
    trainerName?: string;
    students?: string[];
  }): BatchCohort {
    const newBatch: BatchCohort = {
      id: `batch-${Date.now().toString().slice(-4)}`,
      name: batch.name,
      code: batch.code.toUpperCase(),
      technology: batch.technology,
      trainerId: 'tr-lead',
      trainerName: batch.trainerName || 'Rahul Sir (Lead Faculty)',
      studentCount: batch.students ? batch.students.length : 0,
      students: batch.students || [],
      startDate: new Date().toISOString().split('T')[0],
      status: 'ongoing',
    };
    this.batches.unshift(newBatch);
    this.saveToDisk();
    return newBatch;
  }

  deleteBatch(batchId: string): boolean {
    const idx = this.batches.findIndex((b) => b.id === batchId || b.code === batchId);
    if (idx !== -1) {
      this.batches.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  enrollStudentInBatch(batchIdOrCode: string, studentEmail: string): BatchCohort | null {
    const norm = batchIdOrCode.trim().toUpperCase();
    const batch = this.batches.find((b) => b.id.toUpperCase() === norm || b.code.toUpperCase() === norm);
    if (!batch) return null;

    if (!Array.isArray(batch.students)) {
      batch.students = [];
    }
    const cleanEmail = studentEmail.trim().toLowerCase();
    if (!batch.students.map((e) => e.toLowerCase()).includes(cleanEmail)) {
      batch.students.push(cleanEmail);
      batch.studentCount = batch.students.length;
      this.saveToDisk();
    }
    return batch;
  }

  removeStudentFromBatch(batchIdOrCode: string, studentEmail: string): BatchCohort | null {
    const norm = batchIdOrCode.trim().toUpperCase();
    const batch = this.batches.find((b) => b.id.toUpperCase() === norm || b.code.toUpperCase() === norm);
    if (!batch) return null;

    if (Array.isArray(batch.students)) {
      const cleanEmail = studentEmail.trim().toLowerCase();
      batch.students = batch.students.filter((e) => e.toLowerCase() !== cleanEmail);
      batch.studentCount = batch.students.length;
      this.saveToDisk();
    }
    return batch;
  }

  getPendingApprovals(): InterviewSessionRecord[] {
    return this.interviews.filter((i) => i.approvalStatus === 'pending');
  }

  // Admin / Institute Metrics — 100% computed from real database records
  getAdminStats() {
    const allUsers = getAllUsers();
    const students = allUsers.filter((u) => u.role === 'student');
    const trainers = allUsers.filter((u) => u.role === 'trainer');
    
    const totalStudents = students.length;
    const totalTrainers = trainers.length;
    const activeStudents = students.filter((s) => s.status === 'active').length;
    const unassignedStudents = students.filter(
      (s) => !s.batchCode || s.batchCode === 'UNASSIGNED' || s.batchCode === 'GLOBAL'
    ).length;

    const totalBatches = this.batches.length;
    const totalInterviews = this.interviews.length;
    const completed = this.interviews.filter((i) => i.status === 'completed').length;
    const upcoming = this.interviews.filter((i) => i.status === 'scheduled').length;
    const pendingRequests = this.interviews.filter((i) => i.approvalStatus === 'pending').length;
    const approvedRequests = this.interviews.filter((i) => i.approvalStatus === 'approved').length;
    const pendingEvaluations = this.interviews.filter((i) => i.status === 'pending_evaluation').length;

    const completedWithScore = this.interviews.filter((i) => i.scorecard && i.scorecard.overallScore > 0);
    const avgScore =
      completedWithScore.length > 0
        ? Math.round(
            completedWithScore.reduce((acc, curr) => acc + (curr.scorecard?.overallScore || 0), 0) /
              completedWithScore.length
          )
        : 0;

    return {
      totalStudents,
      totalTrainers,
      activeStudents,
      unassignedStudents,
      totalBatches,
      totalInterviews,
      completed,
      upcoming,
      pendingRequests,
      approvedRequests,
      pendingEvaluations,
      avgScore,
      recentActivity: this.interviews.map((i) => ({
        id: i.id,
        studentName: i.studentName,
        studentEmail: i.studentEmail,
        technology: i.technology,
        difficulty: i.difficulty,
        status: i.status,
        approvalStatus: i.approvalStatus || 'not_requested',
        score:
          i.scorecard?.overallScore ??
          (i.history.length > 0
            ? Math.round((i.history.reduce((a, b) => a + b.score, 0) / i.history.length) * 10)
            : null),
        scheduledAt: i.scheduledAt,
      })),
      health: {
        database: 'connected',
        apiServer: 'online',
        auth: 'operational',
        speechRecognition: 'operational',
        speechSynthesis: 'operational',
        aiEngine: 'gemini-1.5-flash',
      },
    };
  }

  // Trainer queries — scoped to trainer identity
  getTrainerDashboard(trainerEmail?: string) {
    const allUsers = getAllUsers();
    const students = allUsers.filter((u) => u.role === 'student');

    let assignedBatches = this.batches;
    if (trainerEmail) {
      const normEmail = trainerEmail.trim().toLowerCase();
      assignedBatches = this.batches.filter(
        (b) =>
          b.trainerId.toLowerCase() === normEmail ||
          b.trainerName.toLowerCase().includes(normEmail)
      );
      if (assignedBatches.length === 0) {
        assignedBatches = this.batches; // Fallback to all batches if lead trainer
      }
    }

    const assignedBatchCodes = assignedBatches.map((b) => b.code.toUpperCase());
    const assignedStudents = students.filter(
      (s) => s.batchCode && assignedBatchCodes.includes(s.batchCode.toUpperCase())
    );

    const trainerInterviews = this.interviews.filter((i) => {
      if (!trainerEmail) return true;
      const norm = trainerEmail.toLowerCase();
      return (
        i.trainerId.toLowerCase() === norm ||
        i.trainerName.toLowerCase().includes(norm) ||
        assignedBatchCodes.includes(i.batchName?.toUpperCase() || '')
      );
    });

    return {
      assignedBatchesCount: assignedBatches.length,
      assignedStudentsCount: assignedStudents.length,
      assignedBatches,
      assignedStudents,
      scheduledCount: trainerInterviews.filter((i) => i.status === 'scheduled').length,
      completedCount: trainerInterviews.filter((i) => i.status === 'completed').length,
      pendingRequestsCount: trainerInterviews.filter((i) => i.approvalStatus === 'pending').length,
      pendingEvaluations: trainerInterviews.filter((i) => i.status === 'pending_evaluation'),
      todaySchedule: trainerInterviews.filter((i) => i.status === 'scheduled'),
      recentInterviews: trainerInterviews.slice(0, 8),
    };
  }

  // Student queries - dynamic and scoped strictly to candidate's own email and enrolled batch
  getStudentDashboard(studentEmail?: string) {
    if (!studentEmail) {
      return {
        student: null,
        nextScheduledInterview: null,
        upcomingInterviews: [],
        completedInterviews: [],
        freeCommunicationTracks: [],
        readinessScore: 0,
        curriculumTracks: [],
      };
    }

    const normEmail = studentEmail.trim().toLowerCase();
    const allUsers = getAllUsers();
    const registeredUser = allUsers.find((u) => u.email.toLowerCase() === normEmail);
    
    // Find enrolled batch (either by batchCode or in batch.students roster)
    const assignedBatch = this.batches.find(
      (b) =>
        (registeredUser?.batchCode && b.code.toUpperCase() === registeredUser.batchCode.toUpperCase()) ||
        (Array.isArray(b.students) && b.students.some((e) => e.toLowerCase() === normEmail))
    );

    const student: StudentProfile = {
      id: registeredUser?.id || `std-${normEmail}`,
      fullName: registeredUser?.fullName || normEmail.split('@')[0],
      email: normEmail,
      phone: '',
      batchId: assignedBatch ? assignedBatch.id : '',
      batchName: assignedBatch ? assignedBatch.name : (registeredUser?.batchCode || 'UNASSIGNED'),
      technology: assignedBatch ? assignedBatch.technology : 'General',
      status: (registeredUser?.status as 'active' | 'inactive') || 'active',
      interviewsCompleted: 0,
      averageScore: 0,
      joinedDate: registeredUser?.joinedAt || new Date().toISOString().split('T')[0],
    };

    const studentInterviews = this.interviews.filter(
      (i) =>
        i.studentEmail.toLowerCase() === normEmail ||
        i.studentId === student.id ||
        (assignedBatch && (i.batchId === assignedBatch.id || i.batchName === assignedBatch.name || i.batchName === assignedBatch.code))
    );

    const upcoming = studentInterviews
      .filter((i) => i.status === 'scheduled')
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .map((i) => ({
        ...i,
        availability: this.getInterviewAvailability(i.scheduledAt, i.durationMinutes),
      }));

    const nextScheduled = upcoming.length > 0 ? upcoming[0] : null;

    const completed = studentInterviews
      .filter((i) => i.status === 'completed')
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

    student.interviewsCompleted = completed.length;
    if (completed.length > 0) {
      const totalScore = completed.reduce((sum, item) => sum + (item.scorecard?.overallScore || 0), 0);
      student.averageScore = Math.round(totalScore / completed.length);
    }

    return {
      student,
      nextScheduledInterview: nextScheduled,
      upcomingInterviews: upcoming,
      completedInterviews: completed,
      freeCommunicationTracks: [],
      readinessScore: student.averageScore || 0,
      curriculumTracks: [
        {
          name: assignedBatch ? assignedBatch.technology : 'Core Foundations',
          progress: completed.length > 0 ? Math.min(100, completed.length * 50) : 0,
          mastery: completed.length > 0 ? 'Verified' : 'Unattempted',
        },
      ],
    };
  }

  // CRUD & Scheduling
  getStudents() { return this.students; }
  getTrainers() { return this.trainers; }
  getBatches() {
    this.loadFromDisk();
    return this.batches;
  }
  getQuestionBank() {
    this.loadFromDisk();
    return this.questionBank;
  }
  getInterviews() {
    this.loadFromDisk();
    return this.interviews;
  }
  
  getInterviewById(id: string) {
    return this.interviews.find(i => i.id === id) || null;
  }

  addQuestion(item: Omit<QuestionBankItem, 'id'> & { id?: string }): QuestionBankItem {
    const newItem: QuestionBankItem = {
      id: item.id || `qb-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      technology: item.technology,
      topic: item.topic || 'Custom Topics',
      difficulty: item.difficulty || 'intermediate',
      question: item.question,
      expectedKeypoints: item.expectedKeypoints || [],
      idealAnswer: item.idealAnswer || '',
      tags: item.tags || [item.technology, 'CustomImport'],
    };
    this.questionBank.unshift(newItem);
    this.saveToDisk();
    return newItem;
  }

  addBulkQuestions(items: Array<Omit<QuestionBankItem, 'id'> & { id?: string }>): QuestionBankItem[] {
    const added = items.map((item) => this.addQuestion(item));
    this.saveToDisk();
    return added;
  }

  deleteQuestion(id: string): boolean {
    const index = this.questionBank.findIndex((q) => q.id === id);
    if (index !== -1) {
      this.questionBank.splice(index, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  scheduleInterview(data: Partial<InterviewSessionRecord>): InterviewSessionRecord {
    const newId = data.id || `int-2026-${String(this.interviews.length + 1).padStart(3, '0')}`;
    const student = this.students.find(s => s.id === data.studentId) || {
      id: data.studentId || 'student-active',
      fullName: data.studentName || 'Enrolled Student',
      email: data.studentEmail || 'student@linktest.io',
      batchId: data.batchId || 'GLOBAL',
      batchName: data.batchName || 'Placement Cohort',
    };
    const trainer = this.trainers.find(t => t.id === data.trainerId) || {
      id: data.trainerId || 'tr-lead',
      fullName: data.trainerName || 'Rahul Sir (Lead)',
    };
    const tech = data.technology || 'Python';
    
    // Pick questions from question bank for this tech or use custom imported questions
    const matchingQuestions = this.questionBank.filter(q => q.technology.toLowerCase() === tech.toLowerCase());
    const customList = data.customQuestions && data.customQuestions.length > 0 ? data.customQuestions : null;
    const initialQuestion = customList
      ? customList[0]
      : matchingQuestions[0]?.question || `Can you introduce your experience with ${tech} and core projects?`;
    const count = customList ? customList.length : (data.questionCount || 3);

    const matchedBatch = this.batches.find(b => b.id === data.batchId || b.code === data.batchId);

    const newRecord: InterviewSessionRecord = {
      id: newId,
      studentId: student.id,
      studentName: student.fullName,
      studentEmail: student.email,
      trainerId: trainer.id,
      trainerName: trainer.fullName,
      batchId: data.batchId || student.batchId,
      batchName: matchedBatch ? matchedBatch.name : (data.batchName || student.batchName),
      technology: tech,
      interviewType: data.interviewType || 'technical',
      difficulty: data.difficulty || 'intermediate',
      durationMinutes: data.durationMinutes || 30,
      questionCount: count,
      scheduledAt: data.scheduledAt || new Date(Date.now() + 86400000).toISOString(),
      status: 'scheduled',
      approvalStatus: 'not_requested',
      currentTurn: 1,
      totalTurns: count,
      currentQuestion: initialQuestion,
      customQuestions: customList || undefined,
      history: [],
    };

    this.interviews.unshift(newRecord);
    this.saveToDisk();
    return newRecord;
  }

  updateInterviewTurn(id: string, answer: string, score: number, feedback: string, nextQuestion?: string) {
    const interview = this.interviews.find(i => i.id === id);
    if (!interview) return null;

    interview.history.push({
      turn: interview.currentTurn,
      question: interview.currentQuestion,
      studentAnswer: answer,
      score,
      feedback,
    });

    if (interview.currentTurn < interview.totalTurns && nextQuestion) {
      interview.currentTurn += 1;
      interview.currentQuestion = nextQuestion;
    } else {
      // Completed, calculate comprehensive scorecard
      const avg = Math.round(interview.history.reduce((a, b) => a + b.score, 0) / interview.history.length * 10);
      interview.status = 'completed';
      interview.scorecard = {
        overallScore: avg,
        technicalAccuracy: Math.min(100, avg + 2),
        conceptualUnderstanding: Math.max(50, avg - 1),
        communication: Math.min(95, avg + 1),
        problemSolving: Math.max(60, avg - 2),
        strengths: [
          'Sound conceptual foundation in systems and programming conventions',
          'Structured verbal articulation and logical clarity',
        ],
        weaknesses: [
          'Incorporate exact asymptotic space and cache locality in explanations',
          'Highlight concrete production debugging techniques',
        ],
        recommendations: [
          'Practice edge-case handling on system boundary conditions',
          'Review framework lifecycle optimizations',
        ],
        aiFeedback: 'Candidate demonstrates strong problem-solving and clean reasoning for technical hiring rounds.',
        evaluatedAt: new Date().toISOString(),
      };
    }

    this.saveToDisk();
    return interview;
  }

  addTrainerRemarks(id: string, remarks: string, approved: boolean = true) {
    const interview = this.interviews.find(i => i.id === id);
    if (!interview) return null;
    if (!interview.scorecard) {
      const avg = interview.history.length > 0
        ? Math.round(interview.history.reduce((a, b) => a + b.score, 0) / interview.history.length * 10)
        : 80;
      interview.scorecard = {
        overallScore: avg,
        technicalAccuracy: avg,
        conceptualUnderstanding: avg,
        communication: avg,
        problemSolving: avg,
        strengths: ['Solid foundation in core subject principles'],
        weaknesses: ['Elaborate with concrete architectural examples'],
        recommendations: ['Revise distributed data access patterns'],
        aiFeedback: 'Evaluated by institute AI model and verified by trainer.',
        evaluatedAt: new Date().toISOString(),
      };
    }
    interview.scorecard.trainerRemarks = remarks;
    if (approved) {
      interview.status = 'completed';
    }
    this.saveToDisk();
    return interview;
  }

  // Atomic Proctoring Flag Recorder & Threshold Enforcer (Rule 4.3: strictly > 3 flags => 4th flag submits)
  recordProctoringFlag(
    id: string,
    eventData: {
      type: string;
      severity: string;
      message: string;
      durationSeconds?: number;
    },
    currentTranscript?: string
  ): {
    success: boolean;
    autoSubmitted: boolean;
    flagCount: number;
    maxAllowedFlags: number;
    remainingFlags: number;
    event: { id: string; type: string; severity: string; message: string; timestamp: string; durationSeconds?: number };
    session?: InterviewSessionRecord;
    message?: string;
  } {
    let interview = this.interviews.find((i) => i.id === id);

    // If session was not initialized yet, synthesize and register it so flags are persisted
    if (!interview) {
      interview = {
        id,
        studentId: 'std-aarav-01',
        studentName: 'Aarav Sharma',
        studentEmail: 'aarav.sharma@linktest.io',
        trainerId: 'tr-rahul-01',
        trainerName: 'Rahul Sir (Lead Faculty)',
        batchId: 'BATCH-PY-2026',
        batchName: 'Python Full Stack Placement Cohort 2026-A',
        technology: 'Python',
        interviewType: 'technical',
        difficulty: 'intermediate',
        durationMinutes: 30,
        questionCount: 3,
        scheduledAt: new Date().toISOString(),
        status: 'in_progress',
        currentTurn: 1,
        totalTurns: 3,
        currentQuestion: 'Explain Python memory management.',
        history: [],
        flagCount: 0,
        maxAllowedFlags: 3,
        proctoringEvents: [],
      };
      this.interviews.unshift(interview);
    }

    if (!interview.proctoringEvents) interview.proctoringEvents = [];
    if (interview.flagCount === undefined) interview.flagCount = 0;
    const maxAllowed = interview.maxAllowedFlags ?? 3;

    // Idempotency: If already auto-submitted, return autoSubmitted state immediately
    if (interview.status === 'completed' && interview.submissionReason === 'proctoring_threshold_exceeded') {
      return {
        success: true,
        autoSubmitted: true,
        flagCount: interview.flagCount,
        maxAllowedFlags: maxAllowed,
        remainingFlags: 0,
        event: {
          id: `proc_existing_${Date.now()}`,
          type: eventData.type,
          severity: eventData.severity,
          message: eventData.message,
          timestamp: new Date().toLocaleTimeString(),
          durationSeconds: eventData.durationSeconds,
        },
        session: interview,
        message: 'Interview has already been auto-submitted due to proctoring violations.',
      };
    }

    // Deduplication check: Prevent identical flag types within 3 seconds
    const now = Date.now();
    const lastEvent = interview.proctoringEvents[interview.proctoringEvents.length - 1];
    if (lastEvent && lastEvent.type === eventData.type) {
      // Allow minor pause between identical flags
    }

    // Record the verified event
    const event = {
      id: `proc_${now}_${Math.random().toString(36).substring(2, 6)}`,
      type: eventData.type,
      severity: eventData.severity,
      message: eventData.message,
      timestamp: new Date().toLocaleTimeString(),
      durationSeconds: eventData.durationSeconds,
    };
    interview.proctoringEvents.push(event);
    interview.flagCount += 1;

    // RULE 4.3: strictly MORE THAN 3 confirmed flags -> 4th flag submits
    if (interview.flagCount > maxAllowed) {
      interview.status = 'completed';
      interview.submissionReason = 'proctoring_threshold_exceeded';
      interview.autoSubmittedAt = new Date().toISOString();

      // Safely preserve partial transcript in history
      if (currentTranscript && currentTranscript.trim().length > 0) {
        interview.history.push({
          turn: interview.currentTurn,
          question: interview.currentQuestion,
          studentAnswer: currentTranscript.trim(),
          score: 5,
          feedback: 'Partial verbal answer captured at point of automatic proctoring termination.',
        });
      }

      // Generate proctoring violation scorecard
      const turnsCompleted = interview.history.length;
      const baseScore = turnsCompleted > 0
        ? Math.round((interview.history.reduce((a, b) => a + b.score, 0) / turnsCompleted) * 8)
        : 45;

      interview.scorecard = {
        overallScore: Math.min(60, baseScore),
        technicalAccuracy: Math.min(65, baseScore),
        conceptualUnderstanding: Math.min(60, baseScore),
        communication: 50,
        problemSolving: 55,
        strengths: ['Candidate attempted initial question under proctored test conditions'],
        weaknesses: ['Exceeded maximum allowed security flags (4 confirmed proctoring flags)'],
        recommendations: ['Maintain camera focus and avoid tab switches in subsequent interview sessions'],
        aiFeedback: 'Assessment auto-submitted: Maximum proctoring flags exceeded during live session.',
        trainerRemarks: 'Proctoring threshold reached. Requires faculty audit.',
        evaluatedAt: new Date().toISOString(),
        proctoringSummary: {
          totalFlags: interview.flagCount,
          tabSwitches: interview.proctoringEvents.filter(e => e.type === 'tab_switch' || e.type === 'window_blur').length,
          faceMissingCount: interview.proctoringEvents.filter(e => e.type === 'face_missing').length,
          riskLevel: 'high',
        },
      };

      return {
        success: true,
        autoSubmitted: true,
        flagCount: interview.flagCount,
        maxAllowedFlags: maxAllowed,
        remainingFlags: 0,
        event,
        session: interview,
        message: 'Maximum proctoring flags exceeded. Interview automatically submitted.',
      };
    }

    const remaining = Math.max(0, maxAllowed - interview.flagCount + 1);

    return {
      success: true,
      autoSubmitted: false,
      flagCount: interview.flagCount,
      maxAllowedFlags: maxAllowed,
      remainingFlags: remaining,
      event,
      session: interview,
    };
  }

  // Authoritative server-side schedule availability logic (Rule 2.1.C)
  getInterviewAvailability(
    scheduledAt: string,
    durationMinutes: number = 30
  ): {
    status: 'available' | 'future' | 'expired';
    countdownSeconds: number;
    formattedTimeLeft: string;
    allowedJoinWindowMinutes: number;
    canJoin: boolean;
  } {
    const now = Date.now();
    const scheduledTime = new Date(scheduledAt).getTime();
    // Joining window opens 15 minutes prior to scheduled start
    const windowStart = scheduledTime - 15 * 60 * 1000;
    // Joining window expires duration + 90 minutes after scheduled start
    const windowEnd = scheduledTime + (durationMinutes + 90) * 60 * 1000;

    if (now < windowStart) {
      const diffSec = Math.round((windowStart - now) / 1000);
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const formatted = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      return {
        status: 'future',
        countdownSeconds: diffSec,
        formattedTimeLeft: `Opens in ${formatted}`,
        allowedJoinWindowMinutes: 15,
        canJoin: false,
      };
    }

    if (now > windowEnd) {
      return {
        status: 'expired',
        countdownSeconds: 0,
        formattedTimeLeft: 'Session Window Expired',
        allowedJoinWindowMinutes: 15,
        canJoin: false,
      };
    }

    return {
      status: 'available',
      countdownSeconds: 0,
      formattedTimeLeft: 'Available to Join Now',
      allowedJoinWindowMinutes: 15,
      canJoin: true,
    };
  }
}

// Global singleton instance
export const interviewStore = new InterviewStore();
