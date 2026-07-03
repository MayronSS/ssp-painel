const Notification = require('../../models/Notification');

/**
 * Notification Service — creates notifications for panel users.
 * Uses userId="*" for broadcast notifications visible to all users.
 */

const TYPE_CONFIG = {
  ticket_aberto:        { icon: 'fa-headset',              tone: 'brand' },
  ticket_fechado:       { icon: 'fa-lock',                 tone: 'zinc' },
  ticket_assumido:      { icon: 'fa-user-check',           tone: 'emerald' },
  solicitacao_enviada:  { icon: 'fa-file-signature',       tone: 'amber' },
  solicitacao_decidida: { icon: 'fa-gavel',                tone: 'emerald' },
  corregedoria_nova:    { icon: 'fa-building-shield',      tone: 'rose' },
  corregedoria_fechada: { icon: 'fa-building-shield',      tone: 'emerald' },
  ausencia_enviada:     { icon: 'fa-calendar-times',       tone: 'amber' },
  ausencia_decidida:    { icon: 'fa-calendar-check',       tone: 'emerald' },
  warning_aplicada:     { icon: 'fa-triangle-exclamation', tone: 'rose' },
  ponto_aberto:         { icon: 'fa-clock',                tone: 'brand' },
  ponto_fechado:        { icon: 'fa-clock',                tone: 'emerald' },
  sistema:              { icon: 'fa-gear',                 tone: 'indigo' },
  info:                 { icon: 'fa-info-circle',          tone: 'brand' }
};

/**
 * Create a notification for a specific user (by Discord ID).
 */
async function notify(userId, type, title, message, options = {}) {
  try {
    const config = TYPE_CONFIG[type] || TYPE_CONFIG.info;
    await Notification.create({
      userId,
      type,
      title,
      message,
      icon: options.icon || config.icon,
      tone: options.tone || config.tone,
      link: options.link || '',
      details: options.details || {}
    });
  } catch (err) {
    console.error('[NotificationService] Erro ao criar notificação:', err.message);
  }
}

/**
 * Broadcast a notification to ALL panel users.
 * Uses userId="*" which is queried by all users.
 */
async function broadcast(type, title, message, options = {}) {
  try {
    const config = TYPE_CONFIG[type] || TYPE_CONFIG.info;
    await Notification.create({
      userId: '*',
      type,
      title,
      message,
      icon: options.icon || config.icon,
      tone: options.tone || config.tone,
      link: options.link || '',
      details: options.details || {}
    });
  } catch (err) {
    console.error('[NotificationService] Erro ao broadcast:', err.message);
  }
}

/**
 * Get notifications for a user (paginated).
 * Returns both personal (userId) and broadcast ("*") notifications.
 * Adds a virtual 'read' field based on readBy array.
 */
async function getForUser(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const query = { userId: { $in: [userId, '*'] } };
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ ...query, readBy: { $ne: userId } })
  ]);
  // Add virtual 'read' per-user
  notifications.forEach(n => {
    n.read = (n.readBy || []).includes(userId);
  });
  return {
    notifications,
    total,
    unreadCount,
    page,
    pages: Math.ceil(total / limit)
  };
}

/**
 * Get unread count for a user (includes broadcasts).
 */
async function getUnreadCount(userId) {
  return Notification.countDocuments({ userId: { $in: [userId, '*'] }, readBy: { $ne: userId } });
}

/**
 * Mark a notification as read for a specific user.
 */
async function markRead(notificationId, userId) {
  return Notification.updateOne(
    { _id: notificationId, userId: { $in: [userId, '*'] } },
    { $addToSet: { readBy: userId } }
  );
}

/**
 * Mark all notifications as read for a user (includes broadcasts).
 */
async function markAllRead(userId) {
  return Notification.updateMany(
    { userId: { $in: [userId, '*'] }, readBy: { $ne: userId } },
    { $addToSet: { readBy: userId } }
  );
}

module.exports = {
  notify,
  broadcast,
  getForUser,
  getUnreadCount,
  markRead,
  markAllRead,
  TYPE_CONFIG
};
