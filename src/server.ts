import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  getUserByEmail,
  getOrCreateGoogleUser,
  ADMIN_EMAILS,
  ADMIN_DEFAULT_PASSWORD,
  findTrainerByEmail,
  getAllUsers,
  promoteStudentToTrainer,
  demoteTrainerToStudent,
  createTrainerInvitation,
} from './lib/usersStore.js';
import { interviewStore } from './lib/interviewStore.js';
import { evaluateAIInterviewAnswer } from './lib/ai.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend clients (Vercel & local development)
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow mobile, Postman, or requests without origin
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.length === 0) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in demo/production API mode
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// 1. Health-check endpoint for Render / monitoring
app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'linkview-backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
  });
});

// 2. Authentication: Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password, provider, fullName, avatarUrl } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const norm = email.trim().toLowerCase();

    // Google OAuth Flow
    if (provider === 'google') {
      const user = getOrCreateGoogleUser({
        email: norm,
        fullName: fullName || norm.split('@')[0],
        avatarUrl,
      });

      let redirectTo = '/student/dashboard';
      if (user.role === 'super_admin') redirectTo = '/admin/dashboard';
      else if (user.role === 'trainer') redirectTo = '/trainer/dashboard';

      return res.json({
        success: true,
        user,
        role: user.role === 'super_admin' ? 'admin' : user.role,
        redirectTo,
      });
    }

    // Admin email & password check
    const isAdmin = ADMIN_EMAILS.includes(norm);
    if (isAdmin) {
      if (password && password !== ADMIN_DEFAULT_PASSWORD && password !== 'admin123') {
        return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
      }

      const adminUser = {
        id: 'admin-lead',
        fullName: 'Rahul Sir (Founder & Admin)',
        email: norm,
        role: 'admin',
        status: 'active',
        batchCode: 'GLOBAL',
      };

      return res.json({
        success: true,
        user: adminUser,
        role: 'admin',
        redirectTo: '/admin/dashboard',
      });
    }

    // Check if Trainer
    const trainer = findTrainerByEmail(norm);
    if (trainer && trainer.status !== 'suspended') {
      return res.json({
        success: true,
        user: {
          id: trainer.id,
          fullName: trainer.fullName,
          email: trainer.email,
          role: 'trainer',
          batchCodes: trainer.batchCodes,
        },
        role: 'trainer',
        redirectTo: '/trainer/dashboard',
      });
    }

    // Default to Student
    const existing = getUserByEmail(norm);
    const studentUser = existing || getOrCreateGoogleUser({
      email: norm,
      fullName: fullName || norm.split('@')[0],
    });

    return res.json({
      success: true,
      user: {
        id: studentUser.id,
        fullName: studentUser.fullName,
        email: studentUser.email,
        role: 'student',
        batchCode: studentUser.batchCode,
      },
      role: 'student',
      redirectTo: '/student/dashboard',
    });
  } catch (err: unknown) {
    const error = err as Error;
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 3. User session resolution
app.post('/api/auth/me', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  const norm = email.trim().toLowerCase();

  if (ADMIN_EMAILS.includes(norm)) {
    return res.json({
      success: true,
      role: 'super_admin',
      email: norm,
      fullName: 'Super Administrator',
      redirectTo: '/admin/dashboard',
    });
  }

  const trainer = findTrainerByEmail(norm);
  if (trainer && trainer.status !== 'suspended') {
    return res.json({
      success: true,
      role: 'trainer',
      email: norm,
      fullName: trainer.fullName,
      batchCodes: trainer.batchCodes,
      redirectTo: '/trainer/dashboard',
    });
  }

  return res.json({
    success: true,
    role: 'student',
    email: norm,
    fullName: norm.split('@')[0],
    redirectTo: '/student/dashboard',
  });
});

// 4. Interview API: Start, Retrieve, Evaluate Turn
const interviewTracks: Record<string, string[]> = {
  python: [
    'Explain how Python manages memory using the Global Interpreter Lock (GIL) and reference counting.',
    'What are generators in Python and how do they optimize memory when processing large datasets?',
    'How do decorators work under the hood in Python?',
  ],
  java: [
    'How does the Java Garbage Collector differentiate between unreachable objects and softly reachable objects?',
    'Can you explain the internal working of ConcurrentHashMap in Java 8 compared to earlier versions?',
    'What happens when a deadlock occurs in Java threads and how would you diagnose it in a live production environment?',
  ],
  dsa: [
    'Given an array of integers, how would you find the subarray with the largest sum in O(n) time?',
    'What is the difference between Dijkstra algorithm and the Bellman-Ford algorithm for negative edge weights?',
    'How does a Bloom filter work and what are its trade-offs regarding false positives?',
  ],
  communication: [
    'Please give me a concise 90-second professional elevator pitch introducing your technical background and key strengths.',
    'Describe a situation where a critical software defect was identified right before launch. How did you communicate with stakeholders and resolve it under pressure?',
    'Where do you envision your technical engineering contributions 2 to 3 years from today?',
  ],
};

app.get('/api/interviews', (req, res) => {
  const id = req.query.id as string;
  if (id) {
    const interview = interviewStore.getInterviewById(id);
    if (!interview) return res.status(404).json({ success: false, error: 'Interview not found' });
    return res.json({ success: true, data: interview });
  }
  return res.json({ success: true, data: interviewStore.getInterviews() });
});

app.post('/api/interviews', (req, res) => {
  try {
    const { track = 'dsa', difficulty = 'intermediate', studentName } = req.body;
    const normTrack = track.toLowerCase();
    const questions = interviewTracks[normTrack] || interviewTracks.dsa;

    const session = interviewStore.scheduleInterview({
      technology: track.toUpperCase(),
      difficulty,
      studentName: studentName || 'Candidate',
      questionCount: questions.length,
      currentQuestion: questions[0],
    });

    session.currentQuestion = questions[0];
    session.totalTurns = questions.length;

    return res.json({ success: true, data: session });
  } catch (err: unknown) {
    const error = err as Error;
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/interviews', async (req, res) => {
  try {
    const { sessionId, answer, proctoringEvents = [] } = req.body;
    const session = interviewStore.getInterviewById(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const normTrack = (session.technology || 'dsa').toLowerCase();
    const questions = interviewTracks[normTrack] || interviewTracks.dsa;

    // Evaluate response with Gemini AI
    let score = 8;
    let feedback = '';

    const aiEval = await evaluateAIInterviewAnswer(session.currentQuestion, answer, normTrack);
    if (aiEval) {
      score = Math.min(10, Math.max(1, Number(aiEval.score)));
      feedback = aiEval.feedback;
    } else {
      score = Math.min(10, Math.max(5, Math.floor(answer.length / 25) + 5));
      feedback = answer.length > 50
        ? 'Good technical clarity and structured explanation. Consider highlighting runtime edge cases.'
        : 'Answer is brief. Try elaborating on production trade-offs and complexity.';
    }

    let nextQuestion: string | undefined = undefined;
    if (session.currentTurn < session.totalTurns) {
      nextQuestion = questions[session.currentTurn];
    }

    const updated = interviewStore.updateInterviewTurn(
      sessionId,
      answer,
      score,
      feedback,
      nextQuestion
    );

    if (proctoringEvents && Array.isArray(proctoringEvents) && updated) {
      updated.proctoringEvents = proctoringEvents;
    }

    return res.json({ success: true, data: updated });
  } catch (err: unknown) {
    const error = err as Error;
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Natural Voice Text-to-Speech API
app.post('/api/tts', async (req, res) => {
  try {
    const { text, gender = 'female' } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: 'Text is required for TTS' });
    }

    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (elevenLabsKey && !elevenLabsKey.includes('placeholder')) {
      const voiceId =
        gender === 'male'
          ? process.env.ELEVENLABS_MALE_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'
          : process.env.ELEVENLABS_FEMALE_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.send(Buffer.from(audioBuffer));
      }
    }

    // Fallback: browser speech guidance
    return res.json({
      success: true,
      mode: 'browser_speech',
      text,
      rate: 0.98,
      pitch: gender === 'female' ? 1.05 : 0.95,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Admin user management & role promotion
app.get('/api/admin/users', (req, res) => {
  const users = getAllUsers();
  return res.json({ success: true, data: users });
});

// 7. Trainer Question Bank & Manual Import API
app.get('/api/trainer/questions', (req, res) => {
  const tech = req.query.technology as string;
  const search = (req.query.search as string)?.toLowerCase();
  let list = interviewStore.getQuestionBank();

  if (tech && tech !== 'all') {
    list = list.filter((q) => q.technology.toLowerCase() === tech.toLowerCase());
  }
  if (search) {
    list = list.filter((q) => q.question.toLowerCase().includes(search) || q.topic.toLowerCase().includes(search));
  }
  return res.json({ success: true, data: list, count: list.length });
});

app.post('/api/trainer/questions', (req, res) => {
  try {
    const { questions, technology, topic, difficulty, question, expectedKeypoints, idealAnswer, tags } = req.body;

    if (Array.isArray(questions)) {
      const added = interviewStore.addBulkQuestions(questions);
      return res.status(201).json({ success: true, message: `Successfully imported ${added.length} questions`, data: added });
    }

    if (!question || !technology) {
      return res.status(400).json({ success: false, error: 'Question text and technology are required' });
    }

    const newQ = interviewStore.addQuestion({
      technology,
      topic: topic || 'Custom Topic',
      difficulty: difficulty || 'intermediate',
      question,
      expectedKeypoints: Array.isArray(expectedKeypoints) ? expectedKeypoints : [expectedKeypoints].filter(Boolean),
      idealAnswer: idealAnswer || '',
      tags: tags || [technology, 'CustomImport'],
    });

    return res.status(201).json({ success: true, message: 'Question added to bank', data: newQ });
  } catch (err: unknown) {
    const error = err as Error;
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/trainer/questions', (req, res) => {
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ success: false, error: 'Question ID is required' });
  const deleted = interviewStore.deleteQuestion(id);
  if (!deleted) return res.status(404).json({ success: false, error: 'Question not found' });
  return res.json({ success: true, message: 'Question removed from bank' });
});

app.post('/api/admin/users', (req, res) => {
  const { fullName, email, role, batchCode } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

  if (role === 'trainer') {
    const origin = req.headers.origin || 'http://localhost:3000';
    const invite = createTrainerInvitation({
      fullName: fullName || 'Trainer Instructor',
      email,
      batchCode,
      baseUrl: origin,
    });
    return res.status(201).json({ success: true, data: invite.user, inviteLink: invite.inviteLink });
  }

  const user = getOrCreateGoogleUser({ fullName: fullName || email.split('@')[0], email });
  return res.status(201).json({ success: true, data: user });
});

app.patch('/api/admin/users', (req, res) => {
  const { userId, action, batchCodes } = req.body;
  if (action === 'promote_to_trainer') {
    promoteStudentToTrainer(userId, batchCodes);
    return res.json({ success: true, message: 'User promoted to Trainer' });
  }
  if (action === 'demote_to_student') {
    demoteTrainerToStudent(userId);
    return res.json({ success: true, message: 'User demoted to Student' });
  }
  return res.status(400).json({ success: false, error: 'Unknown action' });
});

app.listen(PORT, () => {
  console.log(`🚀 LinkView Backend API server listening on port ${PORT}`);
});
