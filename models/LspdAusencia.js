const mongoose = require('mongoose');

const lspdAusenciaSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  corporationSlug: { type: String, default: 'pmesp', index: true },
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  nomeRp: { type: String, required: true },
  corporacao: { type: String, default: 'PMESP' },
  passaporte: { type: String, default: '-' },
  motivo: { type: String, required: true },
  dataInicio: { type: String, required: true },
  dataFim: { type: String, required: true },
  duracaoDias: { type: Number, required: true },
  status: { type: String, enum: ['pendente', 'aprovado', 'reprovado'], default: 'pendente' },
  aprovadoPor: { type: String, default: null },
  motivoReprovacao: { type: String, default: null },
  logMessageId: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.models.LspdAusencia || mongoose.model('LspdAusencia', lspdAusenciaSchema);
