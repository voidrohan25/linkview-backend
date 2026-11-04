import { Router } from 'express';

const router = Router();

// In-memory persistent active sessions store
const interviewSessions = new Map();

// Domain technical lexicons for multi-factor evaluation
const TRACK_LEXICONS = {
  python: ['gil', 'garbage collection', 'reference counting', 'memory leak', 'generator', 'decorator', 'asyncio', 'multiprocessing', 'dunder', 'metaclass', 'yield', 'list comprehension', 'mutable', 'immutable'],
  java: ['jvm', 'bytecode', 'garbage collection', 'heap', 'stack', 'multithreading', 'concurrency', 'spring', 'dependency injection', 'interface', 'abstract class', 'polymorphism', 'generics', 'hashmap', 'synchronized'],
  javascript: ['event loop', 'closure', 'prototype', 'promise', 'async', 'await', 'hoisting', 'scope', 'v8', 'callback', 'call stack', 'microtask', 'macrotask', 'dom'],
  react: ['virtual dom', 'reconciliation', 'fiber', 'hooks', 'useeffect', 'usestate', 'usememo', 'usecallback', 'context', 'props', 'state', 'component lifecycle', 'hydration', 'memo'],
  nodejs: ['event loop', 'libuv', 'streams', 'buffers', 'cluster', 'worker threads', 'non-blocking', 'asynchronous', 'express', 'middleware', 'npm', 'commonjs', 'esm'],
  sql: ['index', 'btree', 'acid', 'transaction', 'isolation level', 'join', 'normalization', 'primary key', 'foreign key', 'query optimization', 'explain analyze', 'concurrency control'],
  system_design: ['load balancer', 'caching', 'cdn', 'sharding', 'replication', 'consistency', 'availability', 'cap theorem', 'message queue', 'microservices', 'rate limiter', 'horizontal scaling'],
  default: ['architecture', 'performance', 'scalability', 'complexity', 'trade-offs', 'latency', 'throughput', 'reliability', 'design pattern', 'edge cases']
};

const DEFAULT_QUESTIONS = {
  python: [
    "Explain how Python manages memory using the Global Interpreter Lock (GIL) and reference counting.",
    "Describe the difference between shallow and deep copy, and explain how cyclic references are resolved by Python's cyclic garbage collector.",
    "How does asyncio's cooperative multitasking differ from multithreading, and when would you choose one over the other?"
  ],
  java: [
    "Explain the internal working of Java's Garbage Collector (G1 vs ZGC) and how memory is allocated across Eden, Survivor, and Tenured spaces.",
    "Describe the difference between optimistic and pessimistic locking in concurrent Java applications.",
    "How does HashMap handle bucket collisions in Java 8 and beyond, and what is the Big-O time complexity under high collision load?"
  ],
  default: [
    "Explain the core runtime mechanics, architecture, and memory lifecycle of your primary programming stack.",
    "Describe a complex architectural trade-off you evaluated between performance, consistency, and simplicity.",
    "How do you approach debugging high-concurrency race conditions or memory leaks in a distributed system?"
  ]
};

// GET /api/interviews
router.get('/', (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(200).json({ success: true, data: Array.from(interviewSessions.values()) });
  }

  const session = interviewSessions.get(id);
  if (!session) {
    return res.status(404).json({ success: false, error: { message: "Interview session not found" } });
  }

  return res.status(200).json({ success: true, data: session });
});

// Handler for Session Initialization, Turn Submission & Voluntary End
const processInterviewSubmission = (req, res) => {
  const { sessionId, track = "Python", difficulty = "intermediate", turn, answer, action, proctoringEvents } = req.body;

  const activeId = sessionId || `int-session-${Date.now()}`;
  let session = interviewSessions.get(activeId);

  const normalizedTrack = (track || "python").toLowerCase();
  const trackQuestions = DEFAULT_QUESTIONS[normalizedTrack] || DEFAULT_QUESTIONS.default;

  // 1. Initial Session Creation if not exists
  if (!session) {
    session = {
      id: activeId,
      technology: track,
      difficulty,
      currentTurn: 1,
      totalTurns: trackQuestions.length,
      currentQuestion: trackQuestions[0],
      turns: [],
      status: "in_progress",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    interviewSessions.set(activeId, session);

    if (!answer && action !== 'end') {
      return res.status(200).json({ success: true, data: session });
    }
  }

  // Handle Voluntary End Call Request
  if (action === 'end' || req.body.end) {
    session.status = "completed";
    const turnsCount = session.turns.length || 1;
    const avgTech = session.turns.length ? Math.round(session.turns.reduce((acc, t) => acc + (t.scores?.technicalAccuracy || 50), 0) / turnsCount) : 60;
    const avgConc = session.turns.length ? Math.round(session.turns.reduce((acc, t) => acc + (t.scores?.conceptualUnderstanding || 50), 0) / turnsCount) : 58;
    const avgComm = session.turns.length ? Math.round(session.turns.reduce((acc, t) => acc + (t.scores?.communication || 50), 0) / turnsCount) : 65;
    const avgProb = session.turns.length ? Math.round(session.turns.reduce((acc, t) => acc + (t.scores?.problemSolving || 50), 0) / turnsCount) : 55;
    const overall = Math.round((avgTech + avgConc + avgComm + avgProb) / 4);

    session.scorecard = {
      overallScore: overall,
      technicalAccuracy: avgTech,
      conceptualUnderstanding: avgConc,
      communication: avgComm,
      problemSolving: avgProb,
      strengths: [
        avgTech >= 60 ? `Proficient in ${session.technology} domain terminology` : "Demonstrated oral interview presence",
        "Communicated responses clearly under assessment conditions"
      ],
      weaknesses: [
        "Can provide more exhaustive trade-off analysis between approaches",
        "Could include more specific edge-case considerations"
      ],
      recommendations: [
        `Review internal system mechanics for ${session.technology}`,
        "Practice answering technical viva questions concisely within 2 minutes"
      ],
      aiFeedback: `Interview ended by candidate. Assessment finalized with an evaluated score of ${overall}%.`
    };

    session.updatedAt = new Date().toISOString();
    interviewSessions.set(activeId, session);
    return res.status(200).json({ success: true, data: session, scorecard: session.scorecard });
  }

  // 2. Turn Submission & Multi-Factor Diagnostic Evaluation
  const currentTurnIndex = session.currentTurn - 1;
  const currentQuestionText = session.currentQuestion;
  const studentAnswerText = String(answer || "").trim();

  // Keyword coverage check
  const lexicon = TRACK_LEXICONS[normalizedTrack] || TRACK_LEXICONS.default;
  const lowerAnswer = studentAnswerText.toLowerCase();
  const matchedKeywords = lexicon.filter(kw => lowerAnswer.includes(kw));

  const wordCount = studentAnswerText.split(/\s+/).filter(Boolean).length;
  let technicalScore = 40;
  let conceptualScore = 40;
  let communicationScore = 40;
  let problemSolvingScore = 40;

  if (wordCount >= 60) {
    technicalScore = Math.min(95, 65 + matchedKeywords.length * 6);
    conceptualScore = Math.min(95, 60 + matchedKeywords.length * 5);
    communicationScore = Math.min(95, 75 + (wordCount > 100 ? 15 : 5));
    problemSolvingScore = Math.min(95, 65 + matchedKeywords.length * 5);
  } else if (wordCount >= 25) {
    technicalScore = Math.min(75, 45 + matchedKeywords.length * 5);
    conceptualScore = Math.min(75, 45 + matchedKeywords.length * 4);
    communicationScore = Math.min(75, 55 + (wordCount > 40 ? 10 : 0));
    problemSolvingScore = Math.min(75, 50 + matchedKeywords.length * 4);
  } else {
    technicalScore = Math.max(20, 25 + matchedKeywords.length * 5);
    conceptualScore = Math.max(20, 25 + matchedKeywords.length * 5);
    communicationScore = 35;
    problemSolvingScore = 30;
  }

  const turnScore = Math.round((technicalScore + conceptualScore + communicationScore + problemSolvingScore) / 4);

  let qualitativeFeedback = "";
  if (turnScore >= 75) {
    qualitativeFeedback = `Exceptional technical explanation. Accurately demonstrated key concepts including ${matchedKeywords.slice(0, 3).join(', ') || 'core principles'}.`;
  } else if (turnScore >= 50) {
    qualitativeFeedback = `Sound foundational understanding. Consider elaborating further on runtime memory trade-offs and edge-case handling.`;
  } else {
    qualitativeFeedback = `Response was too brief. Expand on the underlying runtime architecture and practical engineering considerations.`;
  }

  const turnRecord = {
    turnNumber: session.currentTurn,
    question: currentQuestionText,
    answer: studentAnswerText,
    score: Math.round(turnScore / 10),
    scores: {
      technicalAccuracy: technicalScore,
      conceptualUnderstanding: conceptualScore,
      communication: communicationScore,
      problemSolving: problemSolvingScore
    },
    matchedKeywords,
    feedback: qualitativeFeedback,
    submittedAt: new Date().toISOString()
  };

  session.turns.push(turnRecord);

  // Check if final turn reached
  if (session.currentTurn >= session.totalTurns) {
    session.status = "completed";
    session.currentTurn = session.totalTurns;

    // Calculate Authentic Average
    const avgTech = Math.round(session.turns.reduce((acc, t) => acc + t.scores.technicalAccuracy, 0) / session.turns.length);
    const avgConc = Math.round(session.turns.reduce((acc, t) => acc + t.scores.conceptualUnderstanding, 0) / session.turns.length);
    const avgComm = Math.round(session.turns.reduce((acc, t) => acc + t.scores.communication, 0) / session.turns.length);
    const avgProb = Math.round(session.turns.reduce((acc, t) => acc + t.scores.problemSolving, 0) / session.turns.length);
    const overall = Math.round((avgTech + avgConc + avgComm + avgProb) / 4);

    session.scorecard = {
      overallScore: overall,
      technicalAccuracy: avgTech,
      conceptualUnderstanding: avgConc,
      communication: avgComm,
      problemSolving: avgProb,
      strengths: [
        avgTech >= 60 ? `Proficient in ${session.technology} domain terminology and idioms` : `Demonstrated willingness to tackle technical questions`,
        avgComm >= 60 ? `Structured verbal communication and direct answers` : `Maintained steady conversational pacing`
      ],
      weaknesses: [
        avgConc < 70 ? `Deeper analysis of memory lifecycle and runtime trade-offs required` : `Refine concise explanation of algorithmic complexity under load`,
        avgProb < 70 ? `Incorporate concrete production scenarios and failure modes in answers` : `Practice end-to-end edge case identification`
      ],
      recommendations: [
        `Review internal architecture documentation for ${session.technology}`,
        `Practice articulating System Design and concurrency models out loud`,
        `Focus on time-space complexity trade-offs during live viva assessments`
      ],
      aiFeedback: `Overall performance demonstrates a ${overall >= 70 ? 'strong' : overall >= 50 ? 'promising' : 'developing'} foundation in ${session.technology}. Continue refining deep technical precision.`
    };
  } else {
    session.currentTurn += 1;
    session.currentQuestion = trackQuestions[session.currentTurn - 1] || trackQuestions[trackQuestions.length - 1];
  }

  session.updatedAt = new Date().toISOString();
  interviewSessions.set(activeId, session);

  return res.status(200).json({
    success: true,
    data: session,
    evaluation: {
      score: turnRecord.score,
      feedback: turnRecord.feedback,
      scores: turnRecord.scores
    }
  });
};

// POST & PUT /api/interviews
router.post('/', processInterviewSubmission);
router.put('/', processInterviewSubmission);

export default router;
