const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'ticket_aberto', 'ticket_fechado', 'ticket_assumido',
      'solicitacao_enviada', 'solicitacao_decidida',
      'corregedoria_nova', 'corregedoria_fechada',
      'ausencia_enviada', 'ausencia_decidida',
      'warning_aplicada',
      'ponto_aberto', 'ponto_fechado',
      'sistema', 'info'
    ]
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    default: 'fa-bell'
  },
  tone: {
    type: String,
    default: 'brand',
    enum: ['brand', 'emerald', 'amber', 'rose', 'indigo', 'violet', 'zinc']
  },
  link: {
    type: String,
    default: ''
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  readBy: {
    type: [String],
    default: []
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// TTL index: auto-delete after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Compound index for efficient queries
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
