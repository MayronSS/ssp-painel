const express = require('express');
const router = express.Router();
const Member = require('../../models/Member');
const Ponto = require('../../models/Ponto');
const DisciplinaryWarning = require('../../models/DisciplinaryWarning');
const LspdCandidatura = require('../../models/LspdCandidatura');
const LspdAusencia = require('../../models/LspdAusencia');
const { getActiveGuildConfig, discordAPIRequest } = require('../utils/discord');
const { requireAdmin } = require('../middlewares/auth');
const { registrarAuditLog } = require('../utils/helpers');

// Listar oficiais
router.get('/officers', async (req, res) => {
    try {
        const config = await getActiveGuildConfig();
        const guildId = process.env.GUILD_ID;

        // Roles policiais alvo
        const targetRoles = [
            config?.roles?.policial,
            config?.roles?.lspdGeral,
            process.env.ROLE_POLICIAL,
            process.env.ROLE_LSPD
        ].filter(Boolean);

        try {
            const { discordAPIRequest } = require('../utils/discord');
            const guildRoles = await discordAPIRequest(`/guilds/${guildId}/roles`, 'GET');
            if (Array.isArray(guildRoles)) {
                guildRoles.forEach(r => {
                    if (r.name.includes('┃') && !targetRoles.includes(r.id)) {
                        targetRoles.push(r.id);
                    }
                });
            }
        } catch (err) {
            console.error('[Officers API] Erro ao buscar roles adicionais para targetRoles:', err.message);
        }

        let guildMembers = [];
        try {
            // Buscar membros do Discord
            guildMembers = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
        } catch (discordErr) {
            console.error('[Officers API] Erro ao buscar membros do Discord:', discordErr.message);
        }

        // Filtrar oficiais (ou usar backup caso a chamada do Discord falhe)
        let officersList = [];
        if (Array.isArray(guildMembers) && guildMembers.length > 0) {
            officersList = guildMembers.filter(m => {
                if (m.user?.bot) return false;
                const roles = m.roles || [];
                return roles.some(roleId => targetRoles.includes(roleId));
            }).map(m => ({
                id: m.user.id,
                username: m.user.username,
                displayName: m.nick || m.user.global_name || m.user.username,
                avatar: m.user.avatar,
                roles: m.roles || []
            }));
        } else {
            // Fallback: buscar policiais que possuem registros de ponto no banco
            const distinctUsers = await Ponto.distinct('userId');
            officersList = distinctUsers.map(userId => ({
                id: userId,
                username: 'Oficial LSPD',
                displayName: 'Oficial LSPD',
                avatar: null,
                roles: []
            }));
        }

        // Buscar informações estatísticas agregadas de Ponto
        const statsMap = {};
        const pointsAgg = await Ponto.aggregate([
            { $match: { status: 'fechado' } },
            { $group: { _id: '$userId', totalMs: { $sum: '$durationMs' }, count: { $sum: 1 } } }
        ]);
        pointsAgg.forEach(p => {
            statsMap[p._id] = {
                totalMs: p.totalMs,
                shiftsCount: p.count
            };
        });

        // Buscar dados salvos na coleção Member (observações, contadores manuais)
        const membersData = await Member.find({ discordUserId: { $in: officersList.map(o => o.id) } }).lean();
        const membersMap = {};
        membersData.forEach(m => {
            membersMap[m.discordUserId] = m;
        });

        // Mesclar informações
        const result = officersList.map(officer => {
            const dbData = membersMap[officer.id] || {};
            const stats = statsMap[officer.id] || { totalMs: 0, shiftsCount: 0 };
            return {
                id: officer.id,
                username: officer.username,
                displayName: officer.displayName,
                avatar: officer.avatar,
                roles: officer.roles,
                totalHours: Math.round((stats.totalMs / (1000 * 60 * 60)) * 10) / 10,
                shiftsCount: stats.shiftsCount,
                acoes: dbData.acoes || 0,
                apreensoes: dbData.apreensoes || 0,
                observationsCount: dbData.observations?.length || 0
            };
        });

        res.json({ success: true, officers: result });
    } catch (error) {
        console.error("Erro em /api/officers:", error);
        res.status(500).json({ success: false, message: 'Erro ao listar oficiais.' });
    }
});

// Ranking de Oficiais
router.get('/officers/ranking', async (req, res) => {
    try {
        const guildId = process.env.GUILD_ID;
        let guildMembers = [];
        try {
            guildMembers = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
        } catch (discordErr) {
            console.error('[Ranking API] Erro ao buscar membros do Discord:', discordErr.message);
        }

        const discordAvatarMap = {};
        if (Array.isArray(guildMembers)) {
            guildMembers.forEach(m => {
                if (m.user?.avatar) {
                    discordAvatarMap[m.user.id] = `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`;
                }
            });
        }

        const dbMembers = await Member.find({}).lean();
        const dbAvatarMap = {};
        dbMembers.forEach(m => {
            if (m.avatarUrl) {
                dbAvatarMap[m.discordUserId] = m.avatarUrl;
            }
        });

        const getAvatarUrl = (userId) => {
            return discordAvatarMap[userId] || dbAvatarMap[userId] || null;
        };

        // 1. Ranking por Horas de Patrulha
        const rankingHours = await Ponto.aggregate([
            { $match: { status: 'fechado' } },
            {
                $group: {
                    _id: '$userId',
                    username: { $first: '$username' },
                    totalMs: { $sum: '$durationMs' },
                    shiftsCount: { $sum: 1 }
                }
            },
            { $sort: { totalMs: -1 } },
            { $limit: 15 }
        ]);

        const formattedHours = rankingHours.map(r => ({
            userId: r._id,
            username: r.username,
            totalHours: Math.round((r.totalMs / (1000 * 60 * 60)) * 10) / 10,
            shiftsCount: r.shiftsCount,
            avatarUrl: getAvatarUrl(r._id)
        }));

        // 2. Ranking de Ações
        const rankingAcoes = await Member.find({ acoes: { $gt: 0 } })
            .sort({ acoes: -1 })
            .limit(15)
            .lean();

        // 3. Ranking de Apreensões
        const rankingApreensoes = await Member.find({ apreensoes: { $gt: 0 } })
            .sort({ apreensoes: -1 })
            .limit(15)
            .lean();

        res.json({
            success: true,
            rankingHours: formattedHours,
            rankingAcoes: rankingAcoes.map(r => ({ userId: r.discordUserId, username: r.username, value: r.acoes, avatarUrl: getAvatarUrl(r.discordUserId) })),
            rankingApreensoes: rankingApreensoes.map(r => ({ userId: r.discordUserId, username: r.username, value: r.apreensoes, avatarUrl: getAvatarUrl(r.discordUserId) }))
        });
    } catch (error) {
        console.error("Erro no ranking de oficiais:", error);
        res.status(500).json({ success: false, message: 'Erro ao gerar rankings.' });
    }
});

// Perfil detalhado de um oficial
router.get('/officers/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const guildId = process.env.GUILD_ID;

        // Tentar obter dados do Discord do membro em tempo real
        let discordMember = null;
        try {
            discordMember = await discordAPIRequest(`/guilds/${guildId}/members/${userId}`, 'GET');
        } catch (e) {
            console.error(`[Officers API] Oficial ${userId} não encontrado no Discord:`, e.message);
        }

        // Buscar dados persistidos do Member
        let dbMember = await Member.findOne({ discordUserId: userId }).lean();
        if (!dbMember) {
            // Inicializar se não existir
            dbMember = await Member.create({
                discordUserId: userId,
                username: discordMember?.user?.username || 'Oficial LSPD',
                avatarUrl: discordMember?.user?.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${discordMember.user.avatar}.png` : null
            });
            dbMember = dbMember.toObject ? dbMember.toObject() : dbMember;
        }

        const { startDate, endDate } = req.query;
        let matchQuery = { userId: userId, status: 'fechado' };
        if (startDate || endDate) {
            matchQuery.entrada = {};
            if (startDate) matchQuery.entrada.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                matchQuery.entrada.$lte = end;
            }
        }

        // Buscar total de horas de patrulha
        const patrolStats = await Ponto.aggregate([
            { $match: matchQuery },
            { $group: { _id: null, totalMs: { $sum: '$durationMs' }, count: { $sum: 1 } } }
        ]);

        const totalMs = patrolStats[0]?.totalMs || 0;
        const shiftsCount = patrolStats[0]?.count || 0;

        // Buscar turnos de Bate-Ponto
        let shiftsQuery = { userId: userId, status: 'fechado' };
        if (startDate || endDate) {
            shiftsQuery.entrada = {};
            if (startDate) shiftsQuery.entrada.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                shiftsQuery.entrada.$lte = end;
            }
        }

        const shiftsFind = Ponto.find(shiftsQuery).sort({ entrada: -1 });
        if (!startDate && !endDate) {
            shiftsFind.limit(10);
        }
        const shifts = await shiftsFind.lean();

        // Buscar histórico de advertências
        const warnings = await DisciplinaryWarning.find({ userId: userId })
            .sort({ createdAt: -1 })
            .lean();

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
                console.error("Erro ao buscar corregedoria cases para profile warnings:", err);
            }
        }

        const formattedWarnings = warnings.map(w => {
            let reason = w.reason;
            if (!reason && w.caseId) {
                const associatedCase = casesMap[w.caseId.toString()];
                if (associatedCase) {
                    reason = associatedCase.summary;
                }
            }
            return {
                ...w,
                reason: reason || 'Nenhum motivo registrado.'
            };
        });

        // Buscar candidatura de recrutamento
        const recruitment = await LspdCandidatura.findOne({ userId, modulo: 'recrutamento' })
            .sort({ createdAt: -1 })
            .lean();

        const recruitmentData = recruitment ? {
            createdAt: recruitment.createdAt,
            updatedAt: recruitment.updatedAt,
            status: recruitment.status,
            aprovadoPor: recruitment.aprovadoPor,
            reprovadoPor: recruitment.reprovadoPor
        } : null;

        // Buscar ausências
        const ausencias = await LspdAusencia.find({ userId })
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            success: true,
            officer: {
                id: userId,
                username: discordMember?.user?.username || dbMember.username,
                displayName: discordMember?.nick || discordMember?.user?.global_name || dbMember.username,
                avatar: discordMember?.user?.avatar || null,
                roles: discordMember?.roles || [],
                observations: dbMember.observations || [],
                acoes: dbMember.acoes || 0,
                apreensoes: dbMember.apreensoes || 0,
                avaliacoesRealizadas: dbMember.avaliacoesRealizadas || 0,
                avaliacoesRecebidas: dbMember.avaliacoesRecebidas || 0,
                totalHours: Math.round((totalMs / (1000 * 60 * 60)) * 10) / 10,
                shiftsCount,
                shifts,
                warnings: formattedWarnings,
                joinedAt: discordMember?.joined_at || null,
                recruitment: recruitmentData,
                ausencias: ausencias
            }
        });
    } catch (error) {
        console.error("Erro no perfil do oficial:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar perfil do oficial.' });
    }
});

// Adicionar observação ao oficial (Apenas Admin/Comando)
router.post('/officers/:userId/observations', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { text } = req.body;

        if (!text || text.trim() === '') {
            return res.status(400).json({ success: false, message: 'Texto da observação é obrigatório.' });
        }

        const author = req.session.user.displayName || req.session.user.username;

        const updated = await Member.findOneAndUpdate(
            { discordUserId: userId },
            { 
                $push: { 
                    observations: { 
                        text: text.trim(), 
                        author, 
                        date: new Date() 
                    } 
                } 
            },
            { returnDocument: 'after', upsert: true }
        );

        await registrarAuditLog(
            'observacao_adicionada',
            'Anotação de Comando Adicionada',
            `Uma anotação de comando foi adicionada ao dossiê de @${userId} por ${author}.`,
            req.session.user.id,
            req.session.user.username,
            { targetUserId: userId }
        );

        res.json({ success: true, message: 'Observação adicionada com sucesso.', observations: updated.observations });
    } catch (error) {
        console.error("Erro ao adicionar observação:", error);
        res.status(500).json({ success: false, message: 'Erro ao adicionar observação.' });
    }
});

// Ajustar contadores de ações e apreensões (Apenas Admin/Comando)
router.put('/officers/:userId/counters', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { acoes, apreensoes, avaliacoesRealizadas, avaliacoesRecebidas } = req.body;

        const updateData = {};
        if (acoes !== undefined) updateData.acoes = Math.max(0, parseInt(acoes) || 0);
        if (apreensoes !== undefined) updateData.apreensoes = Math.max(0, parseInt(apreensoes) || 0);
        if (avaliacoesRealizadas !== undefined) updateData.avaliacoesRealizadas = Math.max(0, parseInt(avaliacoesRealizadas) || 0);
        if (avaliacoesRecebidas !== undefined) updateData.avaliacoesRecebidas = Math.max(0, parseInt(avaliacoesRecebidas) || 0);

        const updated = await Member.findOneAndUpdate(
            { discordUserId: userId },
            { $set: updateData },
            { returnDocument: 'after', upsert: true }
        );

        res.json({ 
            success: true, 
            message: 'Contadores atualizados com sucesso.',
            counters: {
                acoes: updated.acoes,
                apreensoes: updated.apreensoes,
                avaliacoesRealizadas: updated.avaliacoesRealizadas,
                avaliacoesRecebidas: updated.avaliacoesRecebidas
            }
        });
    } catch (error) {
        console.error("Erro ao atualizar contadores:", error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar contadores.' });
    }
});

module.exports = router;
