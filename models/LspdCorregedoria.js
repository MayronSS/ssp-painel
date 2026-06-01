const mongoose = require('mongoose');

const lspdCorregedoriaSchema = new mongoose.Schema({
    guildId: { 
        type: String, 
        required: true 
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
    opcao: { 
        type: String, 
        required: true 
    },
    assunto: { 
        type: String, 
        required: true 
    },
    relato: { 
        type: String, 
        required: true 
    },
    provas: { 
        type: String, 
        default: '' 
    },
    status: { 
        type: String, 
        enum: ['aberto', 'fechado'], 
        default: 'aberto' 
    },
    ticketChannelId: { 
        type: String, 
        default: null 
    },
    voiceChannelId: { 
        type: String, 
        default: null 
    },
    fechadoPor: { 
        type: String, 
        default: null 
    },
    motivoFechamento: { 
        type: String, 
        default: null 
    }
}, { timestamps: true });

// Check if model already compiled to avoid mongoose OverwriteModelError
module.exports = mongoose.models.LspdCorregedoria || mongoose.model('LspdCorregedoria', lspdCorregedoriaSchema);
