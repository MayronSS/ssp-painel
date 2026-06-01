const mongoose = require('mongoose');

const pontoSchema = new mongoose.Schema({
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
  username: {
    type: String,
    required: true,
  },
  entrada: {
    type: Date,
    required: true,
  },
  saida: {
    type: Date,
    default: null,
  },
  durationMs: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['aberto', 'fechado'],
    default: 'aberto',
    index: true,
  }
}, { timestamps: true });

// Optimize searches by user and status
pontoSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.models.Ponto || mongoose.model('Ponto', pontoSchema);
