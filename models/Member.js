const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, default: '#99aab5' }
  },
  { _id: false }
);

const observationSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    date: { type: Date, default: Date.now },
    author: { type: String, required: true }
  },
  { _id: false }
);

const memberSchema = new mongoose.Schema(
  {
    discordUserId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    username: {
      type: String,
      required: true,
      trim: true
    },
    avatarUrl: {
      type: String,
      default: null
    },
    roles: {
      type: [roleSchema],
      default: []
    },

    observations: {
      type: [observationSchema],
      default: []
    },
    corporations: {
      type: [{
        slug: { type: String, required: true },
        tag: { type: String, default: null },
        joinedAt: { type: Date, default: Date.now }
      }],
      default: []
    },
    avaliacoesRealizadas: {
      type: Number,
      default: 0,
      min: 0
    },
    avaliacoesRecebidas: {
      type: Number,
      default: 0,
      min: 0
    },
    acoes: {
      type: Number,
      default: 0,
      min: 0
    },
    apreensoes: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.models.Member || mongoose.model('Member', memberSchema);