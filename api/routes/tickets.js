const express = require('express');
const router = express.Router();
const Ticket = require('../../models/Ticket');
const LspdTranscript = require('../../models/LspdTranscript');
const { requireAdmin } = require('../middlewares/auth');
const { 
    discordAPIRequest, 
    syncTicketClaimMessage, 
    createTicketTranscriptFromDiscord, 
    sendTicketCloseLogs, 
    deleteTicketVoiceChannelIfExists 
} = require('../utils/discord');
const { registrarAuditLog, panelOnlyActionDisabled, buildTextSearch, stripDiscordPrefix } = require('../utils/helpers');
const notifService = require('../services/notificationService');
const { categorize, getCategoryLabel, getAllCategories } = require('../services/categorizationService');

const closingTicketRequests = new Set();

// Listar tickets
router.get('/tickets', async (req, res) => {
    try {
        const { status, q } = req.query;
        const query = {};

        if (status) query.status = status;
        if (req.query.category) query.category = req.query.category;
        const textSearch = buildTextSearch(['username', 'userId', 'channelId', 'reason', 'description', 'claimedBy', 'closedBy'], q);
        if (textSearch) query.$or = textSearch;

        const [tickets, openCount, closedCount, transcriptCount] = await Promise.all([
            Ticket.find(query).sort({ status: -1, createdAt: -1 }).lean(),
            Ticket.countDocuments({ status: 'open' }),
            Ticket.countDocuments({ status: 'closed' }),
            LspdTranscript.countDocuments({})
        ]);

        res.json({
            success: true,
            tickets,
            stats: {
                openCount,
                closedCount,
                totalCount: openCount + closedCount,
                transcriptCount
            }
        });
    } catch (error) {
        console.error("Erro em /api/tickets:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar tickets.' });
    }
});

// Editar ticket (desativado)
router.put('/tickets/:id([0-9a-fA-F]{24})', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Editar ticket');
});

// Assumir ticket
router.put('/tickets/:id([0-9a-fA-F]{24})/claim', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const claimedBy = req.body?.claimedBy || req.session.user.id || req.session.user.username;
        const ticket = await Ticket.findById(id);

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket não encontrado.' });
        }
        if (ticket.status !== 'open') {
            return res.status(409).json({ success: false, message: 'Somente tickets abertos podem ser assumidos.' });
        }
        if (ticket.claimedBy) {
            return res.status(409).json({ success: false, message: 'Este ticket ja foi assumido.' });
        }

        await syncTicketClaimMessage(ticket.toObject(), claimedBy, req.session.user.displayName);

        ticket.claimedBy = claimedBy;
        await ticket.save();

        await registrarAuditLog(
            'ticket_assumido',
            'Ticket Assumido via Painel',
            `O ticket de ${ticket.username} foi assumido por ${req.session.user.displayName}.`,
            req.session.user.id,
            req.session.user.username,
            { ticketId: id, claimedBy }
        );

        res.json({ success: true, message: 'Ticket assumido com sucesso e sincronizado no Discord!', ticket });

        // Notify all panel users
        try {
          await notifService.broadcast('ticket_assumido', 'Ticket Assumido', `${req.session.user.displayName} assumiu o ticket de ${ticket.username}.`, { link: '#tickets' });
        } catch(_) {}
    } catch (error) {
        console.error("Erro ao assumir ticket:", error);
        res.status(500).json({ success: false, message: 'Erro ao assumir ticket.' });
    }
});

// Fechar ticket
router.put('/tickets/:id([0-9a-fA-F]{24})/close', requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (closingTicketRequests.has(id)) {
        return res.status(409).json({ success: false, message: 'Este ticket ja esta em processo de fechamento.' });
    }

    closingTicketRequests.add(id);

    try {
        const actorId = req.session.user.id || '0';
        const actorName = req.session.user.displayName || 'Painel Web';
        const ticket = await Ticket.findOneAndUpdate(
            { _id: id, status: 'open' },
            {
                status: 'closed',
                closedAt: new Date(),
                closedBy: actorId
            },
            { returnDocument: 'after' }
        );
        if (!ticket) {
            const existingTicket = await Ticket.findById(id).select('status').lean();
            if (!existingTicket) {
                return res.status(404).json({ success: false, message: 'Ticket nao encontrado.' });
            }
            return res.status(409).json({ success: false, message: 'Somente tickets abertos podem ser fechados.' });
        }

        let discordChannelDeleted = false;
        let voiceChannelDeleted = false;
        let transcriptResult = null;

        try {
            transcriptResult = await createTicketTranscriptFromDiscord(ticket.toObject(), actorName, actorId);
            await sendTicketCloseLogs({
                ticket: ticket.toObject(),
                channel: transcriptResult.channel,
                htmlContent: transcriptResult.htmlContent,
                actorName,
                actorId
            });
        } catch (transcriptError) {
            console.error(`Erro ao gerar transcript do ticket ${ticket.channelId}:`, transcriptError.message);
            await Ticket.findByIdAndUpdate(id, {
                status: 'open',
                closedAt: null,
                closedBy: null
            }).catch((rollbackError) => {
                console.error(`Erro ao reabrir ticket ${ticket.channelId} apos falha no fechamento:`, rollbackError.message);
            });
            return res.status(500).json({
                success: false,
                message: 'Não foi possível gerar o transcript/log no Discord. O ticket não foi fechado para evitar divergência.'
            });
        }

        try {
            voiceChannelDeleted = await deleteTicketVoiceChannelIfExists(transcriptResult.channel?.name || ticket.channelId);
        } catch (voiceError) {
            console.error(`Erro ao excluir canal de voz do ticket ${ticket.channelId}:`, voiceError.message);
        }

        if (ticket.channelId) {
            try {
                await discordAPIRequest(`/channels/${ticket.channelId}`, 'DELETE');
                discordChannelDeleted = true;
            } catch (discordError) {
                console.error(`Erro ao excluir canal do ticket ${ticket.channelId}:`, discordError.message);
            }
        }

        await registrarAuditLog(
            'ticket_fechado',
            'Ticket Fechado via Painel',
            `O ticket de ${ticket.username} foi fechado por ${req.session.user.displayName}.`,
            req.session.user.id,
            req.session.user.username,
            {
                ticketId: id,
                channelId: ticket.channelId,
                discordChannelDeleted,
                voiceChannelDeleted,
                transcriptId: transcriptResult?.transcript?._id?.toString()
            }
        );

        res.json({
            success: true,
            message: discordChannelDeleted
                ? 'Ticket fechado, transcript gerado e canal excluído com sucesso!'
                : 'Ticket fechado e transcript gerado. Não foi possível excluir o canal do Discord.',
            ticket,
            discordChannelDeleted,
            voiceChannelDeleted,
            transcriptId: transcriptResult?.transcript?._id
        });

        // Notify all panel users
        try {
          await notifService.broadcast('ticket_fechado', 'Ticket Fechado', `${req.session.user.displayName} fechou o ticket de ${ticket.username}.`, { link: '#tickets' });
        } catch(_) {}
    } catch (error) {
        console.error("Erro ao fechar ticket:", error);
        res.status(500).json({ success: false, message: 'Erro ao fechar ticket.' });
    } finally {
        closingTicketRequests.delete(id);
    }
});

// Reabrir ticket (desativado)
router.put('/tickets/:id([0-9a-fA-F]{24})/reopen', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Reabrir ticket');
});

// Excluir ticket (desativado)
router.delete('/tickets/:id([0-9a-fA-F]{24})', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir ticket');
});

// Buscar mensagens recentes do ticket no Discord
router.get('/tickets/:channelId/messages', async (req, res) => {
    try {
        const { channelId } = req.params;
        const discordMessages = await discordAPIRequest(`/channels/${channelId}/messages?limit=50`, 'GET');

        if (!Array.isArray(discordMessages)) {
            return res.json({ success: true, messages: [] });
        }

        const messages = discordMessages.map(msg => ({
            id: msg.id,
            author: msg.author?.global_name || msg.author?.username || 'Desconhecido',
            content: stripDiscordPrefix(msg.content),
            timestamp: msg.timestamp,
            attachments: msg.attachments || []
        }));

        res.json({ success: true, messages: messages.reverse() });
    } catch (error) {
        console.error(`Erro ao buscar mensagens do canal ${req.params.channelId}:`, error);
        res.json({ success: true, messages: [] });
    }
});

// Enviar mensagem no ticket no Discord
router.post('/tickets/:channelId/messages', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: 'O conteúdo da mensagem não pode ser vazio.' });
        }

        const sentMessage = await discordAPIRequest(`/channels/${channelId}/messages`, 'POST', {
            content: `💻 **[Painel Web] (${req.session.user.displayName})**: ${content}`
        });

        await registrarAuditLog(
            'ticket_mensagem',
            'Mensagem Enviada via Painel',
            `${req.session.user.displayName} enviou uma mensagem no canal ${channelId}.`,
            req.session.user.id,
            req.session.user.username,
            {
                channelId,
                discordMessageId: sentMessage?.id,
                tamanho: content.trim().length,
                preview: content.trim().slice(0, 120)
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error(`Erro ao enviar mensagem para o canal ${req.params.channelId}:`, error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao enviar mensagem para o Discord. O canal pode ter sido excluído ou o bot está sem permissão.' 
        });
    }
});

// Get all available categories
router.get('/tickets/categories', (req, res) => {
    const categories = [
        { value: '', label: 'Todas' },
        ...getAllCategories(),
        { value: 'geral', label: 'Geral' }
    ];
    res.json({ success: true, categories });
});

// Auto-categorize all uncategorized tickets
router.post('/tickets/categorize-all', requireAdmin, async (req, res) => {
    try {
        const tickets = await Ticket.find({
            $or: [
                { category: { $exists: false } },
                { category: 'geral' },
                { category: null }
            ]
        }).lean();

        let categorized = 0;
        for (const ticket of tickets) {
            const cat = categorize(ticket.reason, ticket.description);
            if (cat !== 'geral') {
                await Ticket.updateOne({ _id: ticket._id }, { category: cat });
                categorized++;
            }
        }

        await registrarAuditLog(
            'ticket_categorizado',
            'Tickets Auto-Categorizados',
            `${req.session.user.displayName} executou auto-categorização. ${categorized}/${tickets.length} tickets categorizados.`,
            req.session.user.id,
            req.session.user.username,
            { categorized, total: tickets.length }
        );

        res.json({
            success: true,
            message: `${categorized} ticket(s) categorizado(s) de ${tickets.length} pendente(s).`,
            categorized,
            total: tickets.length
        });
    } catch (error) {
        console.error('Erro ao categorizar tickets:', error);
        res.status(500).json({ success: false, message: 'Erro ao auto-categorizar tickets.' });
    }
});

module.exports = router;
