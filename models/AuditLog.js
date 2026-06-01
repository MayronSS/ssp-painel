const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    type: { 
        type: String, 
        required: true,
        index: true 
    },
    title: { 
        type: String, 
        required: true 
    },
    description: { 
        type: String, 
        required: true 
    },
    userId: { 
        type: String, 
        required: true,
        index: true 
    },
    username: { 
        type: String,
        required: true
    },
    details: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
    }
}, { timestamps: true });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
