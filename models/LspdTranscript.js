const mongoose = require('mongoose');

const lspdTranscriptSchema = new mongoose.Schema({
    ticketId: { 
        type: String, 
        required: true,
        index: true 
    },
    channelName: { 
        type: String, 
        required: true 
    },
    citizenId: { 
        type: String, 
        required: true,
        index: true 
    },
    citizenName: { 
        type: String 
    },
    closedBy: { 
        type: String, 
        required: true 
    },
    closedByName: { 
        type: String 
    },
    modulo: { 
        type: String, 
        required: true,
        index: true // 'atendimento' ou 'corregedoria'
    },
    htmlContent: { 
        type: String, 
        required: true 
    },
    protocolo: { 
        type: String,
        default: 'N/A'
    }
}, { timestamps: true });

module.exports = mongoose.models.LspdTranscript || mongoose.model('LspdTranscript', lspdTranscriptSchema);
