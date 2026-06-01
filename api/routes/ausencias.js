const express = require('express');
const router = express.Router();
const LspdAusencia = require('../../models/LspdAusencia');
const GuildConfig = require('../../models/GuildConfig');
const { requireAdmin } = require('../middlewares/auth');
const { discordAPIRequest } = require('../utils/discord');
const { registrarAuditLog } = require('../utils/helpers');
const notifService = require('../services/notificationService');

// Listar ausências
router.get('/ausencias', async (req, res) => {
    try {
        const { status, q } = req.query;
        let query = {};
        if (status) query.status = status;
        if (q) {
            query.$or = [
                { nomeRp: { $regex: q, $options: 'i' } },
                { passaporte: { $regex: q, $options: 'i' } },
                { username: { $regex: q, $options: 'i' } }
            ];
        }
        const ausencias = await LspdAusencia.find(query).sort({ createdAt: -1 }).lean();
        res.json({ success: true, ausencias });
    } catch (error) {
        console.error("Erro em /api/ausencias:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar ausências.' });
    }
});

// Helper para construir o payload do Discord Components V2 para o resultado da ausência
function buildAusenciaResultPayload(ausencia, status, moderatorId) {
    const isApproved = status === 'aprovado';
    const accentColor = isApproved ? 40960 : 13959168; // Verde (0x00E676) ou Vermelho (0xD50000)
    const statusLabel = isApproved ? 'Ausência Aprovada' : 'Ausência Reprovada';
    const statusEmoji = isApproved ? '✅' : '❌';

    const bodyLines = [
        `**Policial:** <@${ausencia.userId}> — **${ausencia.nomeRp || ausencia.username}**`,
        `> **Passaporte:** \`${ausencia.passaporte}\``,
        `> **Período:** de \`${ausencia.dataInicio}\` a \`${ausencia.dataFim}\``,
        `> **Duração:** \`${ausencia.duracaoDias} dia(s)\``,
        `> **Motivo original:** ${ausencia.motivo}`,
        ''
    ];

    if (isApproved) {
        bodyLines.push(`> **Aprovado por:** <@${moderatorId}>`);
    } else {
        bodyLines.push(`> **Reprovado por:** <@${moderatorId}>`);
        bodyLines.push(`> **Motivo do Indeferimento:** ${ausencia.motivoReprovacao || 'Não justificado'}`);
    }

    const payload = {
        components: [
            {
                type: 17, // CONTAINER
                accent_color: accentColor,
                components: [
                    {
                        type: 10, // TEXT_DISPLAY
                        content: `${statusEmoji} **${statusLabel}**\n\nA decisão sobre o seu afastamento foi registrada.`
                    },
                    {
                        type: 14, // SEPARATOR
                        divider: true,
                        spacing: 1
                    },
                    {
                        type: 10, // TEXT_DISPLAY
                        content: bodyLines.join('\n')
                    }
                ]
            }
        ],
        flags: 32768 // IsComponentsV2
    };

    return payload;
}

// Aprovar ausência
router.put('/ausencias/:id/approve', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const moderatorId = req.session.user.id;
        const moderatorName = req.session.user.displayName;

        const ausencia = await LspdAusencia.findById(id);
        if (!ausencia) {
            return res.status(404).json({ success: false, message: 'Solicitação de ausência não encontrada.' });
        }
        if (ausencia.status !== 'pendente') {
            return res.status(400).json({ success: false, message: `Esta solicitação já foi decidida. Status: ${ausencia.status}` });
        }

        ausencia.status = 'aprovado';
        ausencia.aprovadoPor = moderatorName;
        await ausencia.save();

        // 1. Atualizar mensagem de logs no Discord se existir
        const guildConfig = await GuildConfig.findOne({ guildId: ausencia.guildId || process.env.GUILD_ID });
        const logChannelId = guildConfig?.channels?.ausenciaLogs;

        if (logChannelId && ausencia.logMessageId) {
            try {
                const payload = buildAusenciaResultPayload(ausencia, 'aprovado', moderatorId);
                await discordAPIRequest(`/channels/${logChannelId}/messages/${ausencia.logMessageId}`, 'PATCH', payload);
            } catch (discordError) {
                console.error("Erro ao atualizar log de ausência no Discord:", discordError.message);
            }
        }

        // 2. Notificar por DM
        try {
            const dmChannel = await discordAPIRequest('/users/@me/channels', 'POST', { recipient_id: ausencia.userId });
            if (dmChannel?.id) {
                const payload = buildAusenciaResultPayload(ausencia, 'aprovado', moderatorId);
                await discordAPIRequest(`/channels/${dmChannel.id}/messages`, 'POST', payload);
            }
        } catch (dmError) {
            console.error(`Erro ao notificar usuário ${ausencia.userId} por DM:`, dmError.message);
        }

        await registrarAuditLog(
            'ausencia_decidida',
            'Ausência Aprovada',
            `A ausência de ${ausencia.nomeRp} (${ausencia.passaporte}) foi APROVADA por ${moderatorName}.`,
            moderatorId,
            req.session.user.username,
            { ausenciaId: id, status: 'aprovado' }
        );

        res.json({ success: true, message: 'Ausência aprovada com sucesso!', ausencia });

        // Notify all panel users
        try {
          await notifService.broadcast('ausencia_decidida', 'Ausência Aprovada', `A ausência de ${ausencia.nomeRp} foi aprovada por ${moderatorName}.`, { link: '#ausencias' });
        } catch(_) {}
    } catch (error) {
        console.error("Erro ao aprovar ausência:", error);
        res.status(500).json({ success: false, message: 'Erro ao aprovar ausência.' });
    }
});

// Reprovar ausência
router.put('/ausencias/:id/reject', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const moderatorId = req.session.user.id;
        const moderatorName = req.session.user.displayName;

        if (!reason || reason.trim() === '') {
            return res.status(400).json({ success: false, message: 'O motivo do indeferimento é obrigatório.' });
        }

        const ausencia = await LspdAusencia.findById(id);
        if (!ausencia) {
            return res.status(404).json({ success: false, message: 'Solicitação de ausência não encontrada.' });
        }
        if (ausencia.status !== 'pendente') {
            return res.status(400).json({ success: false, message: `Esta solicitação já foi decidida. Status: ${ausencia.status}` });
        }

        ausencia.status = 'reprovado';
        ausencia.aprovadoPor = moderatorName;
        ausencia.motivoReprovacao = reason;
        await ausencia.save();

        // 1. Atualizar mensagem de logs no Discord se existir
        const guildConfig = await GuildConfig.findOne({ guildId: ausencia.guildId || process.env.GUILD_ID });
        const logChannelId = guildConfig?.channels?.ausenciaLogs;

        if (logChannelId && ausencia.logMessageId) {
            try {
                const payload = buildAusenciaResultPayload(ausencia, 'reprovado', moderatorId);
                await discordAPIRequest(`/channels/${logChannelId}/messages/${ausencia.logMessageId}`, 'PATCH', payload);
            } catch (discordError) {
                console.error("Erro ao atualizar log de ausência no Discord:", discordError.message);
            }
        }

        // 2. Notificar por DM
        try {
            const dmChannel = await discordAPIRequest('/users/@me/channels', 'POST', { recipient_id: ausencia.userId });
            if (dmChannel?.id) {
                const payload = buildAusenciaResultPayload(ausencia, 'reprovado', moderatorId);
                await discordAPIRequest(`/channels/${dmChannel.id}/messages`, 'POST', payload);
            }
        } catch (dmError) {
            console.error(`Erro ao notificar usuário ${ausencia.userId} por DM:`, dmError.message);
        }

        await registrarAuditLog(
            'ausencia_decidida',
            'Ausência Reprovada',
            `A ausência de ${ausencia.nomeRp} (${ausencia.passaporte}) foi REPROVADA por ${moderatorName}. Motivo: ${reason}`,
            moderatorId,
            req.session.user.username,
            { ausenciaId: id, status: 'reprovado', motivoReprovacao: reason }
        );

        res.json({ success: true, message: 'Ausência reprovada com sucesso!', ausencia });

        // Notify all panel users
        try {
          await notifService.broadcast('ausencia_decidida', 'Ausência Reprovada', `A ausência de ${ausencia.nomeRp} foi reprovada. Motivo: ${reason}`, { link: '#ausencias', tone: 'rose' });
        } catch(_) {}
    } catch (error) {
        console.error("Erro ao reprovar ausência:", error);
        res.status(500).json({ success: false, message: 'Erro ao reprovar ausência.' });
    }
});

module.exports = router;
