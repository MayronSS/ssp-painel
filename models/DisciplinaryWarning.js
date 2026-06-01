const mongoose = require('mongoose');

const disciplinaryWarningSchema = new mongoose.Schema({
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
  userId: {
    type: String,
    required: true,
    index: true,
  },
  roleId: {
    type: String,
    required: true,
  },
  penalty: {
    type: String,
    required: true,
  },
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CorregedoriaCase',
    required: false,
    index: true,
  },
  caseNumber: {
    type: String,
    default: '',
  },
  appliedBy: {
    type: String,
    required: true,
  },
  appliedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    default: null,
    index: true,
  },
  permanent: {
    type: Boolean,
    default: false,
  },
  removedAt: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'removed'],
    default: 'active',
    index: true,
  },
  removalNote: {
    type: String,
    default: '',
  },
  reason: {
    type: String,
    default: '',
  },
}, { timestamps: true });

disciplinaryWarningSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.models.DisciplinaryWarning || mongoose.model('DisciplinaryWarning', disciplinaryWarningSchema);
