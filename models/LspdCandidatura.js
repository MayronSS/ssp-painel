const mongoose = require('mongoose');

const lspdCandidaturaSchema = new mongoose.Schema({
    guildId: { 
        type: String, 
        required: true 
    },
    corporationSlug: {
        type: String,
        default: 'pmesp',
        index: true
    },
    userId: { 
        type: String, 
        required: true, 
        index: true 
    },
    username: { 
        type: String 
    },
    nomeSobrenome: { 
        type: String 
    },
    idCidade: { 
        type: String 
    },
    modulo: { 
        type: String, 
        enum: ['porte', 'paraguaio', 'recrutamento'], 
        required: true 
    },
    tipo: { 
        type: String, 
        required: true 
    },
    respostas: [
        {
            pergunta: { type: String, required: true },
            resposta: { type: String, required: true }
        }
    ],
    status: { 
        type: String, 
        enum: ['pendente', 'pre_aprovado', 'aprovado', 'reprovado'], 
        default: 'pendente' 
    },
    ticketChannelId: { 
        type: String, 
        default: null 
    },
    reviewChannelId: { 
        type: String, 
        default: null 
    },
    aprovadoPor: { 
        type: String, 
        default: null 
    },
    reprovadoPor: { 
        type: String, 
        default: null 
    },
    motivoReprovacao: { 
        type: String, 
        default: null 
    },
    idade: {
        type: String,
        default: null
    },
    discordId: {
        type: String,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.models.LspdCandidatura || mongoose.model('LspdCandidatura', lspdCandidaturaSchema);
