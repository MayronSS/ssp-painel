const mongoose = require('mongoose');

const lspdCadastroSchema = new mongoose.Schema({
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
        type: String, 
        required: true 
    },
    idCidade: { 
        type: String, 
        required: true 
    },
    status: { 
        type: String, 
        default: 'aprovado' 
    },
    aprovadoPor: { 
        type: String, 
        default: null 
    }
}, { timestamps: true });

// Compound index to optimize searches by guild and user
lspdCadastroSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('LspdCadastro', lspdCadastroSchema);
