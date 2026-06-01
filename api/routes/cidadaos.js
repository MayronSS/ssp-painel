const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const LspdCadastro = require('../../models/LspdCadastro');
const LspdCandidatura = require('../../models/LspdCandidatura');
const { requireAdmin } = require('../middlewares/auth');
const { registrarAuditLog, panelOnlyActionDisabled } = require('../utils/helpers');
const { discordAPIRequest, getActiveGuildConfig } = require('../utils/discord');

// Listar cidadãos com busca (mesclando com oficiais do Discord)
router.get('/cidadaos', async (req, res) => {
    try {
        const { q } = req.query;
        let query = {};
        if (q) {
            query = {
                $or: [
                    { nomeSobrenome: { $regex: q, $options: 'i' } },
                    { idCidade: { $regex: q, $options: 'i' } },
                    { username: { $regex: q, $options: 'i' } }
                ]
            };
        }

        // 1. Buscar cadastros locais no banco
        const dbCidadaos = await LspdCadastro.find(query).sort({ createdAt: -1 }).lean();

        // 2. Buscar membros do Discord em tempo real
        let discordMembers = [];
        try {
            const guildId = process.env.GUILD_ID;
            if (guildId) {
                // Busca até 1000 membros do servidor
                const members = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
                if (Array.isArray(members)) {
                    // Buscar cargos configurados para LSPD
                    const config = await getActiveGuildConfig();
                    
                    const adminRoleIds = [
                        config?.roles?.comandoAdmin,
                        config?.roles?.setupAuthorized,
                        process.env.ROLE_COMMAND,
                        process.env.ROLE_SETUP
                    ].filter(Boolean);

                    const policeRoleIds = [
                        config?.roles?.policial,
                        config?.roles?.lspdGeral,
                        config?.roles?.ticketStaff,
                        process.env.ROLE_POLICIAL,
                        process.env.ROLE_LSPD,
                        process.env.ROLE_TICKET_STAFF
                    ].filter(Boolean);

                    const allAllowedRoles = [...adminRoleIds, ...policeRoleIds];

                    // Filtra membros (ignora bots)
                    discordMembers = members
                        .filter(m => m.user && !m.user.bot)
                        .filter(m => {
                            // Se nenhuma role foi configurada ainda, traz todos os membros para facilidade de teste
                            if (allAllowedRoles.length === 0) return true;
                            // Se tiver roles configuradas, filtra para trazer apenas oficiais
                            return (m.roles || []).some(roleId => allAllowedRoles.includes(roleId));
                        })
                        .map(m => ({
                            userId: m.user.id,
                            nomeSobrenome: m.nick || m.user.global_name || m.user.username,
                            username: m.user.username,
                            idCidade: 'Discord' // Tag padrão para membros buscados do Discord
                        }));
                }
            }
        } catch (discordErr) {
            console.error("Erro ao carregar membros do Discord no painel:", discordErr.message);
        }

        // 3. Mesclar resultados por userId (banco de dados tem prioridade se houver cadastro)
        const mergedMap = new Map();
        
        // Adiciona membros do Discord
        discordMembers.forEach(m => mergedMap.set(m.userId, m));
        
        // Sobrescreve/adiciona com cadastros do banco (trazendo informações como idCidade real)
        dbCidadaos.forEach(c => mergedMap.set(c.userId, c));

        let cidadaos = Array.from(mergedMap.values());

        // Se houver busca textual ativa, filtra a lista consolidada
        if (q) {
            const regex = new RegExp(q, 'i');
            cidadaos = cidadaos.filter(c => 
                regex.test(c.nomeSobrenome) || 
                regex.test(c.username) || 
                regex.test(c.userId) ||
                regex.test(c.idCidade)
            );
        }

        res.json({ success: true, cidadaos });
    } catch (error) {
        console.error("Erro em /api/cidadaos:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar oficiais e cidadãos.' });
    }
});

// Exportar cidadãos em PDF ou Excel
router.get('/cidadaos/export', async (req, res) => {
    try {
        const { format, q } = req.query;
        let query = {};
        if (q) {
            query = {
                $or: [
                    { nomeSobrenome: { $regex: q, $options: 'i' } },
                    { idCidade: { $regex: q, $options: 'i' } },
                    { username: { $regex: q, $options: 'i' } },
                    { userId: { $regex: q, $options: 'i' } }
                ]
            };
        }
        const cidadaos = await LspdCadastro.find(query).sort({ nomeSobrenome: 1 }).lean();
        if (['xlsx', 'pdf'].includes(format)) {
            await registrarAuditLog(
                'relatorio_exportado',
                'Relatório de Cidadãos Exportado',
                `${req.session.user.displayName} exportou o relatório de cidadãos no formato ${format.toUpperCase()}.`,
                req.session.user.id,
                req.session.user.username,
                { relatorio: 'cidadaos', formato: format, total: cidadaos.length, filtro: q || '' }
            );
        }

        if (format === 'xlsx') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Membros LSPD');
            worksheet.columns = [
                { header: 'Nome Completo', key: 'nomeSobrenome', width: 30 },
                { header: 'ID Cidade', key: 'idCidade', width: 15 },
                { header: 'Discord ID', key: 'userId', width: 25 },
                { header: 'Discord Tag', key: 'username', width: 20 },
                { header: 'Data de Cadastro', key: 'createdAt', width: 25 }
            ];
            cidadaos.forEach(c => {
                worksheet.addRow({
                    nomeSobrenome: c.nomeSobrenome,
                    idCidade: c.idCidade,
                    userId: c.userId,
                    username: c.username || 'N/A',
                    createdAt: new Date(c.createdAt).toLocaleString('pt-BR')
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="cidadaos-lspd.xlsx"');
            await workbook.xlsx.write(res);
            return res.end();
        } else if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="cidadaos-lspd.pdf"');
            doc.pipe(res);

            doc.fontSize(18).text('LSPD - Relatório de Oficiais e Cidadãos Cadastrados', { align: 'center' });
            doc.moveDown(2);

            cidadaos.forEach((c, index) => {
                doc.fontSize(10).text(
                    `${index + 1}. Nome: ${c.nomeSobrenome} | ID Cidade: ${c.idCidade}\n` +
                    `   Discord: @${c.username || 'N/A'} (${c.userId})\n` +
                    `   Cadastrado em: ${new Date(c.createdAt).toLocaleString('pt-BR')}\n`,
                    { lineGap: 4 }
                );
                doc.lineCap('round').moveTo(doc.x, doc.y).lineTo(565, doc.y).strokeColor("#dddddd").stroke();
                doc.moveDown();
            });

            doc.end();
        } else {
            res.status(400).send('Formato inválido.');
        }
    } catch(e) {
        console.error("Erro na exportação de cidadãos:", e);
        res.status(500).send('Erro ao gerar relatório.');
    }
});

// Detalhes do cidadão e suas solicitações
router.get('/cidadaos/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let cidadao = await LspdCadastro.findOne({ userId }).lean();
        if (!cidadao) {
            // Tenta buscar no Discord como fallback
            try {
                const guildId = process.env.GUILD_ID;
                if (guildId) {
                    const member = await discordAPIRequest(`/guilds/${guildId}/members/${userId}`, 'GET');
                    if (member && member.user) {
                        cidadao = {
                            userId: member.user.id,
                            nomeSobrenome: member.nick || member.user.global_name || member.user.username,
                            username: member.user.username,
                            idCidade: 'Discord',
                            createdAt: new Date(),
                            status: 'aprovado'
                        };
                    }
                }
            } catch (discordErr) {
                console.error(`[Cidadaos API] Cidadão ${userId} não encontrado no Discord:`, discordErr.message);
            }
        }
        if (!cidadao) {
            return res.status(404).json({ success: false, message: 'Cidadão não encontrado.' });
        }
        const solicitacoes = await LspdCandidatura.find({ userId }).sort({ createdAt: -1 }).lean();
        res.json({ success: true, cidadao, solicitacoes });
    } catch (error) {
        console.error("Erro em /api/cidadaos/:userId:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar dados do cidadão.' });
    }
});

// Excluir cadastro do cidadão (desativado no painel)
router.delete('/cidadaos/:id', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir cadastro');
});

module.exports = router;
