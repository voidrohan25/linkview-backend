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
  technology: string;
  interviewType: 'technical' | 'hr' | 'coding' | 'mixed';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  durationMinutes: number;
  questionCount: number;
  scheduledAt: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'pending_evaluation' | 'cancelled';
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

const defaultQuestionBank: QuestionBankItem[] = [
  {
    id: 'qb-01',
    technology: 'Java',
    topic: 'JVM & Memory Management',
    difficulty: 'advanced',
    question: 'How does the Java Garbage Collector differentiate between unreachable objects and softly reachable objects?',
    expectedKeypoints: ['WeakReference vs SoftReference', 'JVM heap pressure thresholds', 'G1 / ZGC collection cycles'],
    idealAnswer: 'Softly reachable objects are collected only when the JVM genuinely needs memory before throwing OutOfMemoryError, making them ideal for memory-sensitive caches.',
    tags: ['Java', 'JVM', 'Garbage Collection'],
  },
  {
    id: 'qb-02',
    technology: 'Python',
    topic: 'Internals & GIL',
    difficulty: 'intermediate',
    question: 'Explain how Python manages memory using the Global Interpreter Lock (GIL) and reference counting.',
    expectedKeypoints: ['Reference counting primary mechanism', 'Cyclic GC for reference cycles', 'GIL prevents race conditions'],
    idealAnswer: 'CPython relies primarily on reference counting where every PyObject tracks its reference count. A generational garbage collector handles cyclic references.',
    tags: ['Python', 'Memory', 'GIL'],
  },
  {
    id: 'qb-03',
    technology: 'DSA',
    topic: 'Arrays & Dynamic Programming',
    difficulty: 'intermediate',
    question: 'Given an array of integers, how would you find the subarray with the largest sum in O(n) time?',
    expectedKeypoints: ['Kadane algorithm', 'max_ending_here and max_so_far', 'Negative numbers handling'],
    idealAnswer: 'We use Kadane algorithm maintaining max_ending_here and max_so_far, running in linear O(n) time and O(1) space.',
    tags: ['DSA', 'Arrays', 'Kadane'],
  },
  {
    id: 'qb-04',
    technology: 'Communication',
    topic: 'Elevator Pitch & HR Fluency',
    difficulty: 'beginner',
    question: 'Please give me a concise 90-second professional elevator pitch introducing your technical background and key strengths.',
    expectedKeypoints: ['Introduction', 'Core stack expertise', 'Major project highlight', 'Career vision'],
    idealAnswer: 'Structured overview of technical expertise, core framework strengths, challenge solved in a real-world project, and career aspirations.',
    tags: ['Communication', 'HR', 'Fluency'],
  },
];

class BackendInterviewStore {
  private interviews: InterviewSessionRecord[] = [];
  private questionBank: QuestionBankItem[] = [...defaultQuestionBank];

  getInterviews() {
    return this.interviews;
  }

  getQuestionBank() {
    return this.questionBank;
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
      tags: item.tags || [item.technology, 'TrainerImport'],
    };
    this.questionBank.unshift(newItem);
    return newItem;
  }

  addBulkQuestions(items: Array<Omit<QuestionBankItem, 'id'> & { id?: string }>): QuestionBankItem[] {
    return items.map((item) => this.addQuestion(item));
  }

  deleteQuestion(id: string): boolean {
    const idx = this.questionBank.findIndex((q) => q.id === id);
    if (idx !== -1) {
      this.questionBank.splice(idx, 1);
      return true;
    }
    return false;
  }

  getInterviewById(id: string) {
    return this.interviews.find((i) => i.id === id) || null;
  }

  scheduleInterview(data: Partial<InterviewSessionRecord>): InterviewSessionRecord {
    const newId = data.id || `int-2026-${String(this.interviews.length + 1).padStart(3, '0')}`;
    const tech = data.technology || 'Python';

    const matching = this.questionBank.filter((q) => q.technology.toLowerCase() === tech.toLowerCase());
    const customList = data.customQuestions && data.customQuestions.length > 0 ? data.customQuestions : null;
    const initialQuestion = customList
      ? customList[0]
      : matching[0]?.question || `Can you introduce your core experience with ${tech}?`;
    const count = customList ? customList.length : (data.questionCount || 3);

    const newRecord: InterviewSessionRecord = {
      id: newId,
      studentId: data.studentId || 'student-active',
      studentName: data.studentName || 'Candidate',
      studentEmail: data.studentEmail || 'student@linktest.io',
      trainerId: data.trainerId || 'tr-lead',
      trainerName: data.trainerName || 'Rahul Sir (Lead)',
      batchId: data.batchId || 'GLOBAL',
      batchName: data.batchName || 'Placement Cohort',
      technology: tech,
      interviewType: data.interviewType || 'technical',
      difficulty: data.difficulty || 'intermediate',
      durationMinutes: data.durationMinutes || 30,
      questionCount: count,
      scheduledAt: data.scheduledAt || new Date().toISOString(),
      status: 'scheduled',
      currentTurn: 1,
      totalTurns: count,
      currentQuestion: initialQuestion,
      customQuestions: customList || undefined,
      history: [],
    };

    this.interviews.unshift(newRecord);
    return newRecord;
  }

  updateInterviewTurn(
    sessionId: string,
    studentAnswer: string,
    score: number,
    feedback: string,
    nextQuestion?: string
  ) {
    const interview = this.getInterviewById(sessionId);
    if (!interview) return null;

    interview.history.push({
      turn: interview.currentTurn,
      question: interview.currentQuestion,
      studentAnswer,
      feedback,
      score,
    });

    if (nextQuestion) {
      interview.currentTurn += 1;
      interview.currentQuestion = nextQuestion;
      interview.status = 'in_progress';
    } else {
      interview.status = 'completed';
      const avg = Math.round(
        (interview.history.reduce((a, b) => a + b.score, 0) / interview.history.length) * 10
      );

      interview.scorecard = {
        overallScore: avg,
        technicalAccuracy: Math.min(100, avg + 2),
        conceptualUnderstanding: Math.max(50, avg - 1),
        communication: Math.min(95, avg + 1),
        problemSolving: Math.max(60, avg - 2),
        strengths: [
          'Sound conceptual foundation in systems and algorithmic trade-offs',
          'Structured verbal articulation and logical clarity',
        ],
        weaknesses: [
          'Incorporate exact asymptotic space and cache locality in explanations',
        ],
        recommendations: [
          'Review framework lifecycle optimizations',
          'Practice edge-case handling on system boundary conditions',
        ],
        aiFeedback: 'Strong technical performance suitable for tier-1 engineering placement rounds.',
        evaluatedAt: new Date().toISOString(),
      };
    }

    return interview;
  }
}

export const interviewStore = new BackendInterviewStore();
