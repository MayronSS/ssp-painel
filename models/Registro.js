const mongoose = require('mongoose');

const registroSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    username: {
      type: String,
      required: true,
      trim: true,
    },

    batalhaoId: {
      type: String,
      required: true,
      index: true,
    },

    ultimoAvisoEnviado: {
      type: Date,
      default: null,
    },

    pontos: [
      {
        entrada: {
          type: Date,
          required: true,
        },
        saida: {
          type: Date,
          default: null,
        },
      },
    ],
  },
  { timestamps: true }
);

registroSchema.index({ userId: 1, batalhaoId: 1 });

module.exports = mongoose.model('Registro', registroSchema);
