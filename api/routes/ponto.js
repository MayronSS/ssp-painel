const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Ponto = require('../../models/Ponto');
const { requireAdmin } = require('../middlewares/auth');
const { notifyPontoDiscord, calculatePontoDurationMs } = require('../utils/discord');
const { registrarAuditLog, panelOnlyActionDisabled } = require('../utils/helpers');

// Listar pontos
router.get('/ponto', async (req, res) => {
    try {
        const { q, status, startDate, endDate, userId, roleId, corporationSlug } = req.query;
        let query = {};
        if (status) query.status = status;
        if (corporationSlug) query.corporationSlug = corporationSlug;

        if (roleId) {
            const guildId = process.env.GUILD_ID;
            let guildMembers = [];
            try {
                const { discordAPIRequest } = require('../utils/discord');
                guildMembers = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
            } catch (discordErr) {
                console.error('[Ponto API] Erro ao buscar membros do Discord para filtro de cargo:', discordErr.message);
            }
            if (Array.isArray(guildMembers)) {
                const filteredUserIds = guildMembers
                    .filter(m => m.roles && m.roles.includes(roleId))
                    .map(m => m.user.id);
                
                if (userId) {
                    query.userId = filteredUserIds.includes(userId) ? userId : 'none';
                } else {
                    query.userId = { $in: filteredUserIds };
                }
            } else {
                if (userId) query.userId = userId;
            }
        } else if (userId) {
            query.userId = userId;
        }

        if (startDate || endDate) {
            query.entrada = {};
            if (startDate) query.entrada.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.entrada.$lte = end;
            }
        }
        if (q) {
            query.$or = [
                { username: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ];
        }

        const { discordAPIRequest } = require('../utils/discord');
        const guildId = process.env.GUILD_ID;
        let guildRoles = [];
        try {
            guildRoles = await discordAPIRequest(`/guilds/${guildId}/roles`, 'GET');
        } catch (err) {
            console.error('[Ponto API] Erro ao buscar roles do Discord:', err.message);
        }

        const rolesList = Array.isArray(guildRoles) 
            ? guildRoles.filter(r => r.name !== '@everyone' && !r.managed && r.name.includes('┃'))
            : [];

        const pontos = await Ponto.find(query).sort({ entrada: -1 }).lean();
        res.json({ success: true, pontos, roles: rolesList });
    } catch (error) {
        console.error("Erro em /api/ponto:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar registros de ponto.' });
    }
});

// Estatísticas de ponto e ranking de oficiais
router.get('/ponto/stats', async (req, res) => {
    try {
        const { corporationSlug } = req.query;
        const matchFilter = { status: 'fechado' };
        if (corporationSlug) matchFilter.corporationSlug = corporationSlug;

        const activeFilter = { status: 'aberto' };
        if (corporationSlug) activeFilter.corporationSlug = corporationSlug;

        const activeOfficers = await Ponto.countDocuments(activeFilter);
        const totalPatrolResult = await Ponto.aggregate([
            { $match: matchFilter },
            { $group: { _id: null, totalMs: { $sum: '$durationMs' } } }
        ]);
        const totalPatrolMs = totalPatrolResult[0]?.totalMs || 0;

        const ranking = await Ponto.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: '$userId',
                    username: { $first: '$username' },
                    totalMs: { $sum: '$durationMs' },
                    shiftsCount: { $sum: 1 }
                }
            },
            { $sort: { totalMs: -1 } },
            { $limit: 10 }
        ]);

        res.json({
            success: true,
            activeOfficers,
            totalPatrolTimeHours: Math.round(totalPatrolMs / (1000 * 60 * 60) * 100) / 100,
            ranking
        });
    } catch (error) {
        console.error("Erro em /api/ponto/stats:", error);
        res.status(500).json({ success: false, message: 'Erro ao carregar estatísticas de ponto.' });
    }
});

// Criar ponto manual (desativado)
router.post('/ponto', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Criar ponto manual');
});

// Editar ponto (desativado)
router.put('/ponto/:id([0-9a-fA-F]{24})', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Editar ponto');
});

// Fechar ponto manualmente (desativado)
router.put('/ponto/:id([0-9a-fA-F]{24})/close', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Fechar ponto de outro oficial');
});

// Deletar ponto (desativado)
router.delete('/ponto/:id([0-9a-fA-F]{24})', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir ponto');
});

// Exportar pontos em PDF/Excel
router.get('/ponto/export', async (req, res) => {
    try {
        const { format, q, status, startDate, endDate, userId, roleId, corporationSlug } = req.query;
        let query = {};
        if (status) query.status = status;
        if (corporationSlug) query.corporationSlug = corporationSlug;

        if (roleId) {
            const guildId = process.env.GUILD_ID;
            let guildMembers = [];
            try {
                const { discordAPIRequest } = require('../utils/discord');
                guildMembers = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
            } catch (discordErr) {
                console.error('[Ponto API Export] Erro ao buscar membros do Discord para filtro de cargo:', discordErr.message);
            }
            if (Array.isArray(guildMembers)) {
                const filteredUserIds = guildMembers
                    .filter(m => m.roles && m.roles.includes(roleId))
                    .map(m => m.user.id);
                
                if (userId) {
                    query.userId = filteredUserIds.includes(userId) ? userId : 'none';
                } else {
                    query.userId = { $in: filteredUserIds };
                }
            } else {
                if (userId) query.userId = userId;
            }
        } else if (userId) {
            query.userId = userId;
        }

        if (startDate || endDate) {
            query.entrada = {};
            if (startDate) query.entrada.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.entrada.$lte = end;
            }
        }
        if (q) {
            query.$or = [
                { username: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ];
        }
        const pontos = await Ponto.find(query).sort({ entrada: -1 }).lean();
        if (['xlsx', 'pdf'].includes(format)) {
            await registrarAuditLog(
                'relatorio_exportado',
                'Relatório de Ponto Exportado',
                `${req.session.user.displayName} exportou o relatório de ponto no formato ${format.toUpperCase()}.`,
                req.session.user.id,
                req.session.user.username,
                { relatorio: 'ponto', formato: format, total: pontos.length, status: status || '', inicio: startDate || '', fim: endDate || '', filtro: q || '' }
            );
        }

        if (format === 'xlsx') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Registros de Ponto LSPD');
            worksheet.columns = [
                { header: 'Policial', key: 'username', width: 25 },
                { header: 'Discord ID', key: 'userId', width: 25 },
                { header: 'Entrada', key: 'entrada', width: 25 },
                { header: 'Saída', key: 'saida', width: 25 },
                { header: 'Duração (Horas)', key: 'durationHours', width: 18 },
                { header: 'Status', key: 'status', width: 15 }
            ];
            pontos.forEach(p => {
                const durationHours = p.status === 'fechado' 
                    ? Math.round(p.durationMs / (1000 * 60 * 60) * 100) / 100 
                      : 0;
                worksheet.addRow({
                    username: p.username,
                    userId: p.userId,
                    entrada: new Date(p.entrada).toLocaleString('pt-BR'),
                    saida: p.saida ? new Date(p.saida).toLocaleString('pt-BR') : 'Em patrulha',
                    durationHours,
                    status: p.status === 'aberto' ? 'Aberto' : 'Fechado'
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="pontos-lspd.xlsx"');
            await workbook.xlsx.write(res);
            return res.end();
        } else if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="pontos-lspd.pdf"');
            doc.pipe(res);

            doc.fontSize(18).text('LSPD - Relatório de Registros de Bate-Ponto', { align: 'center' });
            doc.moveDown(2);

            pontos.forEach((p, index) => {
                const durationHours = p.status === 'fechado' 
                    ? Math.round(p.durationMs / (1000 * 60 * 60) * 100) / 100 
                    : 0;
                const saidaStr = p.saida ? new Date(p.saida).toLocaleString('pt-BR') : 'Em patrulha';

                doc.fontSize(10).text(
                    `${index + 1}. Policial: ${p.username} (${p.userId})\n` +
                    `   Entrada: ${new Date(p.entrada).toLocaleString('pt-BR')} | Saída: ${saidaStr}\n` +
                    `   Duração: ${durationHours} Horas | Status: ${p.status.toUpperCase()}\n`,
                    { lineGap: 4 }
                );
                doc.lineCap('round').moveTo(doc.x, doc.y).lineTo(565, doc.y).strokeColor("#dddddd").stroke();
                doc.moveDown();
            });

            doc.end();
        } else {
            res.status(400).send('Formato inválido.');
        }
    } catch (e) {
        console.error("Erro na exportação de pontos:", e);
        res.status(500).send('Erro ao gerar relatório.');
    }
});

module.exports = router;
