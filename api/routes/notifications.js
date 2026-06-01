const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');

/**
 * GET /api/notifications — Get user notifications (paginated)
 */
router.get('/notifications', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const result = await notificationService.getForUser(userId, page, 20);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Notifications] Erro ao buscar:', err);
    return res.status(500).json({ success: false, message: 'Erro ao buscar notificações.' });
  }
});

/**
 * GET /api/notifications/unread-count — Get unread count
 */
router.get('/notifications/unread-count', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const count = await notificationService.getUnreadCount(userId);
    return res.json({ success: true, count });
  } catch (err) {
    console.error('[Notifications] Erro ao contar:', err);
    return res.status(500).json({ success: false, count: 0 });
  }
});

/**
 * PUT /api/notifications/:id/read — Mark single notification as read
 */
router.put('/notifications/:id/read', async (req, res) => {
  try {
    const userId = req.session.user.id;
    await notificationService.markRead(req.params.id, userId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Erro ao marcar:', err);
    return res.status(500).json({ success: false, message: 'Erro ao marcar notificação.' });
  }
});

/**
 * PUT /api/notifications/read-all — Mark all as read
 */
router.put('/notifications/read-all', async (req, res) => {
  try {
    const userId = req.session.user.id;
    await notificationService.markAllRead(userId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Erro ao marcar todas:', err);
    return res.status(500).json({ success: false, message: 'Erro ao marcar notificações.' });
  }
});

module.exports = router;
