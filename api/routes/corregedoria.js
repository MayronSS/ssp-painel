const express = require('express');
const router = express.Router();
const CorregedoriaCase = require('../../models/CorregedoriaCase');
const { requireAdmin } = require('../middlewares/auth');
const { registrarAuditLog, panelOnlyActionDisabled } = require('../utils/helpers');

// Listar casos da Corregedoria
router.get('/corregedoria', async (req, res) => {
    try {
        const { status, q } = req.query;
        let query = {};
        
        if (status === 'aberto') {
            query.status = { $in: ['voting', 'applied'] };
        } else if (status === 'fechado') {
            query.status = 'archived';
        }
        
        if (q) {
            query.$or = [
                { accusedLabel: { $regex: q, $options: 'i' } },
                { accusedRpId: { $regex: q, $options: 'i' } },
                { reporterLabel: { $regex: q, $options: 'i' } },
                { caseNumber: { $regex: q, $options: 'i' } },
                { summary: { $regex: q, $options: 'i' } }
            ];
        }
        
        const dbCasos = await CorregedoriaCase.find(query).sort({ createdAt: -1 }).lean();
        
        // Mapear CorregedoriaCase para o formato esperado pelo frontend
        const casos = dbCasos.map(c => ({
            _id: c._id,
            guildId: c.guildId,
            userId: c.reporterId,
            username: c.reporterLabel,
            nomeSobrenome: `Denúncia contra: ${c.accusedLabel}`,
            idCidade: c.accusedRpId,
            opcao: c.rankLabel || 'Oficial',
            assunto: `Caso ${c.caseNumber}`,
            relato: `Acusado: ${c.accusedLabel} (${c.accusedRpId})\nCargo: ${c.rankLabel}\nRelator: ${c.reporterLabel} (${c.reporterId})\n\nResumo:\n${c.summary}`,
            provas: c.transcriptFilename ? `/api/transcripts/download/${c.transcriptFilename}` : '',
            status: c.status === 'archived' ? 'fechado' : 'aberto',
            ticketChannelId: c.ticketChannelId || null,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt
        }));
        
        res.json({ success: true, casos });
    } catch (error) {
        console.error("Erro em /api/corregedoria:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar corregedoria.' });
    }
});

// Arquivar corregedoria (desativado)
router.put('/corregedoria/:id/close', async (req, res) => {
    return panelOnlyActionDisabled(res, 'Arquivar corregedoria');
});

// Editar corregedoria (desativado)
router.put('/corregedoria/:id', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Editar corregedoria');
});

// Excluir corregedoria (desativado)
router.delete('/corregedoria/:id', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir corregedoria');
});

module.exports = router;
