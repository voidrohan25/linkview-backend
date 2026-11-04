import { Router } from 'express';

const router = Router();

const flagStore = new Map();

router.post('/', (req, res) => {
  const { interviewId = 'default', event = {}, currentTranscript = '' } = req.body;

  const currentCount = (flagStore.get(interviewId) || 0) + 1;
  flagStore.set(interviewId, currentCount);

  const maxAllowedFlags = 3;
  const autoSubmitted = currentCount > maxAllowedFlags;

  const loggedEvent = {
    id: `flag-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    type: event.type || 'focus_lost',
    severity: event.severity || (currentCount >= 3 ? 'critical' : 'warning'),
    message: event.message || 'Proctoring integrity check recorded.',
    timestamp: new Date().toISOString()
  };

  return res.status(200).json({
    success: true,
    flagCount: currentCount,
    maxAllowedFlags,
    remainingFlags: Math.max(0, maxAllowedFlags - currentCount),
    autoSubmitted,
    event: loggedEvent
  });
});

export default router;
