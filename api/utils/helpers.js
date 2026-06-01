const crypto = require('crypto');
const AuditLog = require('../../models/AuditLog');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword || !storedPassword.includes(':')) return false;
    const [salt, originalHash] = storedPassword.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === originalHash;
}

function normalizeAuditDetails(details = {}) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
        return { origem: 'painel-web', valor: details };
    }

    const normalized = { origem: details.origem || 'painel-web' };
    for (const [key, value] of Object.entries(details)) {
        if (value !== undefined && value !== null && key !== 'origem') {
            normalized[key] = value;
        }
    }
    return normalized;
}

async function registrarAuditLog(type, title, description, userId, username, details = {}) {
    try {
        await AuditLog.create({
            type,
            title,
            description,
            userId: userId || '0',
            username: username || 'Painel Web',
            details: normalizeAuditDetails(details)
        });
    } catch (err) {
        console.error(`Erro ao salvar log de auditoria:`, err);
    }
}

function escapeRegExp(value = '') {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTextSearch(fields, q) {
    if (!q) return null;
    const regex = { $regex: escapeRegExp(q), $options: 'i' };
    return fields.map(field => ({ [field]: regex }));
}

function panelOnlyActionDisabled(res, actionName) {
    return res.status(409).json({
        success: false,
        message: `${actionName} foi desativado no Painel Web porque não existe fluxo equivalente no Discord. Use o Discord ou implemente a ação nos dois lados.`
    });
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function countTranscriptMessages(htmlContent = '') {
    const html = String(htmlContent);
    const discordComponentCount = (html.match(/<discord-message\b/g) || []).length;
    if (discordComponentCount) return discordComponentCount;
    return (html.match(/<article\s+class="message"/g) || []).length;
}

function stripDiscordPrefix(content = '') {
    return String(content).replace(/^💻 \*\*\[Painel Web\]\s*(?:\([^)]+\))?\*\*:\s*/u, '');
}

module.exports = {
    hashPassword,
    verifyPassword,
    registrarAuditLog,
    escapeRegExp,
    buildTextSearch,
    panelOnlyActionDisabled,
    escapeHtml,
    countTranscriptMessages,
    stripDiscordPrefix
};
