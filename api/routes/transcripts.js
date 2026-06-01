const express = require('express');
const router = express.Router();
const LspdTranscript = require('../../models/LspdTranscript');
const { requireAdmin } = require('../middlewares/auth');
const { registrarAuditLog, panelOnlyActionDisabled, countTranscriptMessages } = require('../utils/helpers');

// Listar transcripts
router.get('/transcripts', async (req, res) => {
    try {
        const { modulo, q } = req.query;
        let query = {};
        if (modulo) query.modulo = modulo;
        if (q) {
            query.$or = [
                { citizenName: { $regex: q, $options: 'i' } },
                { citizenId: { $regex: q, $options: 'i' } },
                { channelName: { $regex: q, $options: 'i' } },
                { ticketId: { $regex: q, $options: 'i' } },
                { closedByName: { $regex: q, $options: 'i' } },
                { closedBy: { $regex: q, $options: 'i' } },
                { protocolo: { $regex: q, $options: 'i' } }
            ];
        }
        const transcriptDocs = await LspdTranscript.find(query)
            .sort({ createdAt: -1 })
            .lean();
        const transcripts = transcriptDocs.map(({ htmlContent = '', ...transcript }) => ({
            ...transcript,
            htmlSize: Buffer.byteLength(htmlContent || '', 'utf8'),
            messageCount: countTranscriptMessages(htmlContent)
        }));
        res.json({ success: true, transcripts });
    } catch (error) {
        console.error("Erro em /api/transcripts:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar transcripts.' });
    }
});

// Detalhes do transcript
router.get('/transcripts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const transcript = await LspdTranscript.findById(id).lean();
        if (!transcript) {
            return res.status(404).json({ success: false, message: 'Transcript não encontrado.' });
        }
        res.json({ success: true, transcript });
    } catch (error) {
        console.error("Erro em /api/transcripts/:id:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar transcript.' });
    }
});

// Visualizar o transcript bruto em HTML
router.get('/transcripts/:id/raw', async (req, res) => {
    try {
        const { id } = req.params;
        const transcript = await LspdTranscript.findById(id).select('htmlContent channelName protocolo citizenId citizenName ticketId').lean();
        if (!transcript || !transcript.htmlContent) {
            return res.status(404).send('Transcript não encontrado ou vazio.');
        }

        await registrarAuditLog(
            'transcript_visualizado',
            'Transcript Visualizado',
            `O transcript ${transcript.protocolo || id} do canal #${transcript.channelName || transcript.ticketId} foi aberto por ${req.session.user.displayName}.`,
            req.session.user.id,
            req.session.user.username,
            {
                transcriptId: id,
                protocolo: transcript.protocolo,
                ticketId: transcript.ticketId,
                channelName: transcript.channelName,
                citizenId: transcript.citizenId,
                citizenName: transcript.citizenName
            }
        );

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(transcript.htmlContent);
    } catch (error) {
        console.error("Erro em /api/transcripts/:id/raw:", error);
        res.status(500).send('Erro ao buscar transcript bruto.');
    }
});

// Deletar transcript (desativado)
router.delete('/transcripts/:id', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir transcript');
});

module.exports = router;
