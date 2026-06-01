const mongoose = require('mongoose');

const corregedoriaCaseSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    index: true,
  },
  corporationSlug: {
    type: String,
    default: 'pmesp',
    index: true,
  },
  caseNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  caseMessageId: {
    type: String,
    default: '',
    index: true,
  },
  caseChannelId: {
    type: String,
    required: true,
    index: true,
  },
  ticketChannelId: {
    type: String,
    default: '',
  },
  ticketChannelName: {
    type: String,
    default: '',
  },
  reporterId: {
    type: String,
    default: '',
  },
  reporterLabel: {
    type: String,
    default: 'Não informado',
  },
  accusedUserId: {
    type: String,
    required: true,
    index: true,
  },
  accusedLabel: {
    type: String,
    default: 'Não informado',
  },
  accusedRpId: {
    type: String,
    default: 'Não informado',
  },
  rankRoleId: {
    type: String,
    default: '',
  },
  rankLabel: {
    type: String,
    default: 'Não informado',
  },
  createdBy: {
    type: String,
    required: true,
  },
  createdByLabel: {
    type: String,
    default: '',
  },
  summary: {
    type: String,
    default: '',
  },
  transcriptFilename: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['voting', 'applied', 'archived'],
    default: 'voting',
    index: true,
  },
  votes: {
    type: Map,
    of: String,
    default: () => new Map(),
  },
  voteTimestamps: {
    type: Map,
    of: Date,
    default: () => new Map(),
  },
  durationVotes: {
    type: Map,
    of: String,
    default: () => new Map(),
  },
  durationVoteTimestamps: {
    type: Map,
    of: Date,
    default: () => new Map(),
  },
  selectedPenalty: {
    type: String,
    default: '',
  },
  durationDays: {
    type: Number,
    default: null,
  },
  durationPermanent: {
    type: Boolean,
    default: false,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  appliedBy: {
    type: String,
    default: '',
  },
  resultChannelId: {
    type: String,
    default: '',
  },
  resultMessageId: {
    type: String,
    default: '',
  },
  resultSentAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

corregedoriaCaseSchema.index({ guildId: 1, status: 1 });

module.exports = mongoose.models.CorregedoriaCase || mongoose.model('CorregedoriaCase', corregedoriaCaseSchema);
