import crypto from 'crypto';
import { isPostgresConnected, pool } from '../db/index.js';
import { memoryStore } from '../db/index.js';

export const NotificationPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

export const NotificationType = {
  SUCCESS: 'SUCCESS',
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  TASK_STARTED: 'TASK_STARTED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  RESULT_PUBLISHED: 'RESULT_PUBLISHED'
};

export const notificationService = {
  /**
   * Safely create a single notification with duplicate prevention.
   * Never throws - logs error and returns null if creation fails.
   */
  async createNotification({
    userId,
    title,
    message,
    type = 'INFO',
    priority = 'NORMAL',
    actionUrl = null,
    actionLabel = null,
    relatedEntityType = null,
    relatedEntityId = null,
    eventKey = null
  }) {
    if (!userId || !title || !message) {
      console.warn('[NotificationService] Missing required fields for notification:', { userId, title });
      return null;
    }

    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const cleanPriority = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(String(priority).toUpperCase())
        ? String(priority).toUpperCase()
        : 'NORMAL';
      const cleanType = String(type).toUpperCase();
      const cleanActionUrl = actionUrl || null;
      const cleanActionLabel = actionLabel || null;

      if (isPostgresConnected && pool) {
        let query;
        let params;

        if (eventKey) {
          query = `
            INSERT INTO notifications (
              id, user_id, title, message, type, link, read, created_at,
              priority, related_entity_type, related_entity_id, action_url, action_label, event_key, dismissed
            )
            VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10, $11, $12, $13, false)
            ON CONFLICT (event_key) DO NOTHING
            RETURNING *
          `;
          params = [
            id, userId, title, message, cleanType, cleanActionUrl, now,
            cleanPriority, relatedEntityType, relatedEntityId, cleanActionUrl, cleanActionLabel, eventKey
          ];
        } else {
          query = `
            INSERT INTO notifications (
              id, user_id, title, message, type, link, read, created_at,
              priority, related_entity_type, related_entity_id, action_url, action_label, dismissed
            )
            VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10, $11, $12, false)
            RETURNING *
          `;
          params = [
            id, userId, title, message, cleanType, cleanActionUrl, now,
            cleanPriority, relatedEntityType, relatedEntityId, cleanActionUrl, cleanActionLabel
          ];
        }

        const res = await pool.query(query, params);
        if (res.rows && res.rows.length > 0) {
          const row = res.rows[0];
          return {
            ...row,
            isRead: row.read,
            actionUrl: row.action_url || row.link,
            actionLabel: row.action_label,
            relatedEntityType: row.related_entity_type,
            relatedEntityId: row.related_entity_id
          };
        }
        // Event key conflict, existing notification was preserved
        return null;
      }

      // In-Memory Fallback
      if (eventKey && memoryStore.notifications.some(n => n.event_key === eventKey)) {
        return null;
      }

      const notif = {
        id,
        user_id: userId,
        title,
        message,
        type: cleanType,
        link: cleanActionUrl,
        read: false,
        isRead: false,
        created_at: now,
        priority: cleanPriority,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
        action_url: cleanActionUrl,
        action_label: cleanActionLabel,
        event_key: eventKey,
        dismissed: false
      };
      memoryStore.notifications.push(notif);
      return notif;
    } catch (err) {
      console.warn('[NotificationService] Failed to create notification (non-breaking):', err.message);
      return null;
    }
  },

  /**
   * Batch notify multiple users
   */
  async notifyUsers(userIds, payload) {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    const results = [];
    for (const uid of uniqueIds) {
      const userEventKey = payload.eventKey ? `${uid}:${payload.eventKey}` : null;
      const res = await this.createNotification({
        ...payload,
        userId: uid,
        eventKey: userEventKey
      });
      if (res) results.push(res);
    }
    return results;
  },

  /**
   * Retrieve notifications for a user
   */
  async getNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
    if (!userId) return { notifications: [], unread_count: 0 };

    try {
      if (isPostgresConnected && pool) {
        const listQuery = `
          SELECT *
          FROM notifications
          WHERE user_id = $1 AND (dismissed = false OR dismissed IS NULL)
          ${unreadOnly ? 'AND read = false' : ''}
          ORDER BY created_at DESC
          LIMIT $2
        `;
        const countQuery = `
          SELECT COUNT(*)::int as unread_count
          FROM notifications
          WHERE user_id = $1 AND read = false AND (dismissed = false OR dismissed IS NULL)
        `;

        const [listRes, countRes] = await Promise.all([
          pool.query(listQuery, [userId, limit]),
          pool.query(countQuery, [userId])
        ]);

        const notifications = listRes.rows.map(row => ({
          id: row.id,
          userId: row.user_id,
          title: row.title,
          message: row.message,
          type: row.type,
          priority: row.priority || 'NORMAL',
          read: row.read,
          isRead: row.read,
          createdAt: row.created_at,
          link: row.action_url || row.link,
          actionUrl: row.action_url || row.link,
          actionLabel: row.action_label,
          relatedEntityType: row.related_entity_type,
          relatedEntityId: row.related_entity_id,
          dismissed: !!row.dismissed
        }));

        return {
          notifications,
          unread_count: countRes.rows[0]?.unread_count || 0
        };
      }

      // Memory Store fallback
      let userNotifs = memoryStore.notifications.filter(n => n.user_id === userId && !n.dismissed);
      const unreadCount = userNotifs.filter(n => !n.read).length;

      if (unreadOnly) {
        userNotifs = userNotifs.filter(n => !n.read);
      }

      const notifications = userNotifs
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit)
        .map(n => ({
          ...n,
          isRead: n.read,
          createdAt: n.created_at,
          actionUrl: n.action_url || n.link,
          actionLabel: n.action_label
        }));

      return {
        notifications,
        unread_count: unreadCount
      };
    } catch (err) {
      console.warn('[NotificationService] Failed to load notifications:', err.message);
      return { notifications: [], unread_count: 0 };
    }
  },

  /**
   * Mark notifications as read
   */
  async markAsRead(userId, notificationIds = null) {
    if (!userId) return false;
    try {
      if (isPostgresConnected && pool) {
        if (Array.isArray(notificationIds) && notificationIds.length > 0) {
          await pool.query(
            'UPDATE notifications SET read = true WHERE user_id = $1 AND id = ANY($2)',
            [userId, notificationIds]
          );
        } else {
          await pool.query(
            'UPDATE notifications SET read = true WHERE user_id = $1',
            [userId]
          );
        }
        return true;
      }

      memoryStore.notifications.forEach(n => {
        if (n.user_id === userId && (!notificationIds || notificationIds.includes(n.id))) {
          n.read = true;
          n.isRead = true;
        }
      });
      return true;
    } catch (err) {
      console.warn('[NotificationService] markAsRead error:', err.message);
      return false;
    }
  },

  /**
   * Dismiss notification
   */
  async dismissNotification(userId, notificationId) {
    if (!userId || !notificationId) return false;
    try {
      if (isPostgresConnected && pool) {
        await pool.query(
          'UPDATE notifications SET dismissed = true, read = true WHERE user_id = $1 AND id = $2',
          [userId, notificationId]
        );
        return true;
      }

      const notif = memoryStore.notifications.find(n => n.user_id === userId && n.id === notificationId);
      if (notif) {
        notif.dismissed = true;
        notif.read = true;
      }
      return true;
    } catch (err) {
      console.warn('[NotificationService] dismissNotification error:', err.message);
      return false;
    }
  }
};
