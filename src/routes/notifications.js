import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { notificationService } from '../services/notificationService.js';

const router = Router();

// All notification routes require authenticated user
router.use(authenticateToken);

// ── GET /api/notifications ──
router.get('/', async (req, res, next) => {
  try {
    const { unreadOnly, limit } = req.query;
    const data = await notificationService.getNotifications(req.user.id, {
      unreadOnly: unreadOnly === 'true',
      limit: limit ? parseInt(limit, 10) : 50
    });
    return res.status(200).json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/notifications/unread-count ──
router.get('/unread-count', async (req, res, next) => {
  try {
    const data = await notificationService.getNotifications(req.user.id, {
      unreadOnly: true,
      limit: 1
    });
    return res.status(200).json({
      success: true,
      data: { unread_count: data.unread_count }
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/notifications/read ──
router.post('/read', async (req, res, next) => {
  try {
    const { ids } = req.body;
    await notificationService.markAsRead(req.user.id, ids || null);
    return res.status(200).json({
      success: true,
      message: 'Notifications marked as read.'
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/notifications/:id/read ──
router.post('/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
    await notificationService.markAsRead(req.user.id, [id]);
    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.'
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/notifications/:id/dismiss ──
router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const { id } = req.params;
    await notificationService.dismissNotification(req.user.id, id);
    return res.status(200).json({
      success: true,
      message: 'Notification dismissed.'
    });
  } catch (err) {
    next(err);
  }
});

export default router;
