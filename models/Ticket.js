const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  corporationSlug: {
    type: String,
    default: 'pmesp',
    index: true,
  },
  channelId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  username: {
    type: String,
    required: true,
  },
  reason: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
    index: true,
  },
  claimedBy: {
    type: String,
    default: null,
  },
  closedAt: {
    type: Date,
    default: null,
  },
  closedBy: {
    type: String,
    default: null,
  },
  category: {
    type: String,
    default: 'geral',
    enum: ['denuncia', 'suporte', 'reclamacao', 'duvida', 'elogio', 'bug', 'solicitacao', 'corregedoria', 'geral'],
    index: true,
  },
}, { timestamps: true });

ticketSchema.index({ userId: 1, status: 1 });
ticketSchema.index({ channelId: 1, status: 1 });

module.exports = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
