const express = require('express');
const router = express.Router();
const DisciplinaryWarning = require('../../models/DisciplinaryWarning');
const LspdCadastro = require('../../models/LspdCadastro');
const Member = require('../../models/Member');
const GuildConfig = require('../../models/GuildConfig');
const { requireAdmin } = require('../middlewares/auth');
const { discordAPIRequest } = require('../utils/discord');
const { registrarAuditLog } = require('../utils/helpers');
const notifService = require('../services/notificationService');

// Configurações das penalidades
const PENALTIES = {
    verbal: { label: 'Advertência verbal', roleKey: 'advVerbal', fallbackRoleId: '1508503597565087985', days: 1 },
    adv1: { label: 'ADV 1', roleKey: 'adv1', fallbackRoleId: '1508503623502528542', days: 7 },
    adv2: { label: 'ADV 2', roleKey: 'adv2', fallbackRoleId: '1508503641789698182', days: 14 },
    adv3: { label: 'ADV 3', roleKey: 'adv3', fallbackRoleId: '1508503655920435330', days: 30 }
};

const DURATIONS = {
    d7: { label: '7 dias', days: 7 },
    d15: { label: '15 dias', days: 15 },
    d30: { label: '30 dias', days: 30 },
    d60: { label: '60 dias', days: 60 },
    permanent: { label: 'Permanente', days: null, permanent: true }
};

// Listar advertências
router.get('/warnings', async (req, res) => {
    try {
        const { status, q } = req.query;
        let query = {};
        if (status) query.status = status;
        if (q) {
            query.$or = [
                { userId: { $regex: q, $options: 'i' } },
                { caseNumber: { $regex: q, $options: 'i' } },
                { penalty: { $regex: q, $options: 'i' } }
            ];
        }

        const warnings = await DisciplinaryWarning.find(query).sort({ createdAt: -1 }).lean();

        // Cruzar com LspdCadastro para obter os nomes RP dos oficiais
        const userIds = [...new Set(warnings.map(w => w.userId))];
        const officers = await LspdCadastro.find({ userId: { $in: userIds } }).lean();
        const officersMap = {};
        officers.forEach(o => {
            officersMap[o.userId] = o.nomeSobrenome || o.username;
        });

        // Buscar na coleção Member para cobrir oficiais sem cadastro completo no RP
        const members = await Member.find({ discordUserId: { $in: userIds } }).lean();
        members.forEach(m => {
            if (!officersMap[m.discordUserId]) {
                officersMap[m.discordUserId] = m.username;
            }
        });

        // Buscar corregedoria cases caso haja caseId
        const mongoose = require('mongoose');
        const caseIds = warnings.filter(w => w.caseId).map(w => w.caseId);
        let casesMap = {};
        if (caseIds.length > 0) {
            try {
                const casesDocs = await mongoose.connection.db.collection('corregedoriacases')
                    .find({ _id: { $in: caseIds } }).toArray();
                casesDocs.forEach(c => {
                    casesMap[c._id.toString()] = c;
                });
            } catch (err) {
                console.error("Erro ao buscar corregedoria cases para warnings:", err);
            }
        }

        const formatted = warnings.map(w => {
            let reason = w.reason;
            if (!reason && w.caseId) {
                const associatedCase = casesMap[w.caseId.toString()];
                if (associatedCase) {
                    reason = associatedCase.summary;
                }
            }
            return {
                ...w,
                reason: reason || 'Nenhum motivo registrado.',
                officerName: officersMap[w.userId] || 'Oficial SSP'
            };
        });

        res.json({ success: true, warnings: formatted });
    } catch (error) {
        console.error("Erro em /api/warnings:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar advertências.' });
    }
});

// Helper para construir o log de advertência no Discord
function buildDirectWarningLogPayload(data) {
    const expiresText = data.expiresAt 
        ? `<t:${Math.floor(data.expiresAt.getTime() / 1000)}:f>` 
        : '`Permanente`';

    return {
        components: [
            {
                type: 17, // CONTAINER
                accent_color: 13959168, // Vermelho (0xD50000)
                components: [
                    {
                        type: 10, // TEXT_DISPLAY
                        content: `🛑 **Punição Aplicada Diretamente — ${data.caseNumber}**\n\nUma nova advertência administrativa foi registrada no sistema.`
                    },
                    {
                        type: 14, // SEPARATOR
                        divider: true,
                        spacing: 1
                    },
                    {
                        type: 10, // TEXT_DISPLAY
                        content: `👤 **Policial Punido**\n> **Discord:** <@${data.userId}> (${data.userTag})\n> **Nível:** **${data.penaltyLabel}**\n> **Duração:** \`${data.durationLabel}\` (expira em: ${expiresText})\n> **Aplicado por:** <@${data.appliedBy}>`
                    },
                    {
                        type: 14, // SEPARATOR
                        divider: true,
                        spacing: 1
                    },
                    {
                        type: 10, // TEXT_DISPLAY
                        content: `📋 **Motivo administrativo**\n> ${data.reason}`
                    }
                ]
            }
        ],
        flags: 32768 // IsComponentsV2
    };
}

// Helper para construir a notificação por DM no Discord
function buildDirectWarningDmPayload(data) {
    const expiresText = data.expiresAt 
        ? `<t:${Math.floor(data.expiresAt.getTime() / 1000)}:f>` 
        : '`Permanente`';

    return {
        components: [
            {
                type: 17, // CONTAINER
                accent_color: 13959168, // Vermelho (0xD50000)
                components: [
                    {
                        type: 10, // TEXT_DISPLAY
                        content: `🛑 **SECRETARIA DE SEGURANÇA PÚBLICA • NOTIFICAÇÃO DISCIPLINAR**\n\nPrezado(a) <@${data.userId}>,\n\nInformamos que foi aplicada uma penalidade administrativa diretamente em sua ficha de serviço.`
                    },
                    {
                        type: 14, // SEPARATOR
                        divider: true,
                        spacing: 1
                    },
                    {
                        type: 10, // TEXT_DISPLAY
                        content: `🎫 **Detalhes da advertência**\n> **Identificador:** \`${data.caseNumber}\`\n> **Nível:** **${data.penaltyLabel}**\n> **Duração:** \`${data.durationLabel}\` (expira em: ${expiresText})\n> **Aplicado por:** <@${data.appliedBy}>`
                    },
                    {
                        type: 14, // SEPARATOR
                        divider: true,
                        spacing: 1
                    },
                    {
                        type: 10, // TEXT_DISPLAY
                        content: `📋 **Motivo da Punição**\n> ${data.reason}`
                    }
                ]
            }
        ],
        flags: 32768 // IsComponentsV2
    };
}

// Aplicar advertência direta
router.post('/warnings/apply', requireAdmin, async (req, res) => {
    try {
        const { userId, level, duration, reason } = req.body;
        const moderatorId = req.session.user.id;
        const moderatorName = req.session.user.displayName;

        if (!userId || !level || !duration || !reason || reason.trim() === '') {
            return res.status(400).json({ success: false, message: 'Todos os campos são obrigatórios.' });
        }

        const penalty = PENALTIES[level];
        if (!penalty) {
            return res.status(400).json({ success: false, message: 'Nível de advertência inválido.' });
        }

        const resolvedDuration = DURATIONS[duration];
        if (!resolvedDuration) {
            return res.status(400).json({ success: false, message: 'Duração de advertência inválida.' });
        }

        const guildId = process.env.GUILD_ID;

        // 1. Verificar se usuário existe no servidor do Discord
        let member;
        try {
            member = await discordAPIRequest(`/guilds/${guildId}/members/${userId}`, 'GET');
        } catch (memberErr) {
            return res.status(404).json({ success: false, message: 'Policial não encontrado no servidor do Discord.' });
        }

        // 2. Resolver o Cargo da Penalidade no Banco ou usar fallback
        const guildConfig = await GuildConfig.findOne({ guildId });
        const roleId = guildConfig?.roles?.[penalty.roleKey] || penalty.fallbackRoleId;

        if (!roleId) {
            return res.status(500).json({ success: false, message: `Cargo para a penalidade ${penalty.label} não está configurado.` });
        }

        const caseNumber = `DIR-${Date.now().toString().slice(-8)}`;
        const durationDays = resolvedDuration.days;
        const expiresAt = resolvedDuration.permanent ? null : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

        let roleAdded = false;
        let warning;

        try {
            // 3. Adicionar cargo disciplinar via Discord API (HTTP request)
            await discordAPIRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, 'PUT');
            roleAdded = true;

            // 4. Salvar no MongoDB
            warning = await DisciplinaryWarning.create({
                guildId,
                userId,
                roleId,
                penalty: level,
                caseNumber,
                appliedBy: moderatorId,
                expiresAt,
                permanent: Boolean(resolvedDuration.permanent),
                status: 'active',
                reason
            });

            // 5. Enviar Log no Canal do Discord se configurado
            const logChannelId = guildConfig?.channels?.disciplinaryWarnings;
            if (logChannelId) {
                try {
                    const logPayload = buildDirectWarningLogPayload({
                        caseNumber,
                        userId,
                        userTag: member.user.username,
                        penaltyLabel: penalty.label,
                        durationLabel: resolvedDuration.label,
                        expiresAt,
                        appliedBy: moderatorId,
                        reason
                    });
                    await discordAPIRequest(`/channels/${logChannelId}/messages`, 'POST', logPayload);
                } catch (discordErr) {
                    console.error("Erro ao enviar log de advertência ao Discord:", discordErr.message);
                }
            }

            // 6. Enviar notificação em DM
            try {
                const dmChannel = await discordAPIRequest('/users/@me/channels', 'POST', { recipient_id: userId });
                if (dmChannel?.id) {
                    const dmPayload = buildDirectWarningDmPayload({
                        caseNumber,
                        userId,
                        penaltyLabel: penalty.label,
                        durationLabel: resolvedDuration.label,
                        expiresAt,
                        appliedBy: moderatorId,
                        reason
                    });
                    await discordAPIRequest(`/channels/${dmChannel.id}/messages`, 'POST', dmPayload);
                }
            } catch (dmErr) {
                console.error(`Erro ao notificar usuário ${userId} por DM:`, dmErr.message);
            }

        } catch (discordError) {
            console.error("Erro durante aplicação da punição no Discord:", discordError.message);
            // Rollback DB se falhar no Discord
            if (warning?._id) {
                await DisciplinaryWarning.deleteOne({ _id: warning._id }).catch(() => null);
            }
            return res.status(500).json({ success: false, message: `Erro ao aplicar punição no Discord: ${discordError.message}` });
        }

        await registrarAuditLog(
            'warning_aplicada',
            'Advertência Aplicada',
            `A advertência ${caseNumber} (${penalty.label}) foi aplicada em <@${userId}> por ${moderatorName}.`,
            moderatorId,
            req.session.user.username,
            { caseNumber, userId, level, duration }
        );

        res.json({
            success: true,
            message: `Advertência aplicada com sucesso! ID do Caso: ${caseNumber}`,
            warning: {
                ...warning.toObject(),
                officerName: member.nick || member.user.global_name || member.user.username
            }
        });

        // Notify all panel users
        try {
          await notifService.broadcast('warning_aplicada', 'Advertência Aplicada', `${penalty.label} (${caseNumber}) aplicada por ${moderatorName}.`, { link: '#warnings' });
        } catch(_) {}
    } catch (error) {
        console.error("Erro ao aplicar advertência:", error);
        res.status(500).json({ success: false, message: 'Erro ao aplicar advertência.' });
    }
});

module.exports = router;
