const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const LspdCadastro = require('../../models/LspdCadastro');
const LspdCandidatura = require('../../models/LspdCandidatura');
const mongoose = require('mongoose');

// Definir ou recuperar o model Corporation
const Corporation = mongoose.models.Corporation || mongoose.model('Corporation', new mongoose.Schema({
    guildId: { type: String, required: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    type: { type: String, required: true },
    roles: {
        geral: { type: String, default: null }
    },
    subdivisions: [
        {
            slug: { type: String },
            name: { type: String },
            shortName: { type: String },
            roleId: { type: String }
        }
    ]
}, { strict: false }));

const { requireAdmin } = require('../middlewares/auth');
const { registrarAuditLog, panelOnlyActionDisabled } = require('../utils/helpers');
const { discordAPIRequest, getActiveGuildConfig } = require('../utils/discord');

// Listar cidadãos com busca (mesclando com oficiais do Discord)
router.get('/cidadaos', async (req, res) => {
    try {
        const { q } = req.query;
        const guildId = process.env.GUILD_ID;

        // 1. Buscar membros do Discord em tempo real
        let discordMembers = [];
        try {
            if (guildId) {
                // Busca até 1000 membros do servidor
                const members = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
                if (Array.isArray(members)) {
                    const ROLE_PMESP = '1510829612274548766';
                    const ROLE_PCESP = '1510829647284273263';

                    // Filtra membros strictly containing PMESP or PCESP roles
                    discordMembers = members.filter(m => {
                        if (!m.user || m.user.bot) return false;
                        const roles = m.roles || [];
                        return roles.includes(ROLE_PMESP) || roles.includes(ROLE_PCESP);
                    });
                }
            }
        } catch (discordErr) {
            console.error("Erro ao carregar membros do Discord no painel:", discordErr.message);
        }

        // Se não houver membros no Discord filtrados, podemos retornar vazio
        if (discordMembers.length === 0) {
            return res.json({ success: true, cidadaos: [] });
        }

        // 2. Carregar cadastros, candidaturas e corporações em lote para alta performance
        const dbCadastros = await LspdCadastro.find({ guildId }).lean();
        const dbCandidaturas = await LspdCandidatura.find({ guildId }).lean();
        const dbCorps = await Corporation.find({ guildId }).lean();

        // Mapear por userId
        const cadastroMap = new Map(dbCadastros.map(c => [c.userId, c]));
        const candidaturaMap = new Map();
        // Ordenar candidaturas ascendentemente por data para que a mais recente sobrescreva as anteriores
        dbCandidaturas.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        dbCandidaturas.forEach(cand => {
            if (cand.idCidade && cand.idCidade !== 'Discord') {
                candidaturaMap.set(cand.userId, cand.idCidade);
            }
        });

        const ROLE_PMESP = '1510829612274548766';
        const ROLE_PCESP = '1510829647284273263';

        // 3. Montar a lista enriquecida de oficiais
        let cidadaos = discordMembers.map(m => {
            const nickname = m.nick || '';
            const displayName = m.user.global_name || '';
            const username = m.user.username || '';
            const userId = m.user.id;

            // Resolução de Passaporte (Citizen ID)
            const cadastro = cadastroMap.get(userId);
            let idCidade = 'N/A';
            if (cadastro && cadastro.idCidade && cadastro.idCidade !== 'Discord') {
                idCidade = cadastro.idCidade;
            } else {
                const candId = candidaturaMap.get(userId);
                if (candId) {
                    idCidade = candId;
                } else if (nickname) {
                    const match = nickname.match(/\[(\d+)\]/);
                    if (match) idCidade = match[1];
                }
            }

            // Resolução do Nome
            const nomeSobrenome = (cadastro && cadastro.nomeSobrenome) || nickname || displayName || username || 'Oficial SSP';

            // Resolução de Corporação
            let corporacao = '';
            const memberRoles = m.roles || [];
            if (memberRoles.includes(ROLE_PMESP)) {
                corporacao = 'PMESP';
            } else if (memberRoles.includes(ROLE_PCESP)) {
                corporacao = 'PCESP';
            }

            // Resolução de Batalhão (subdivisão)
            let batalhao = '';
            for (const corp of dbCorps) {
                if (corp.type === 'tag' && corp.roles?.geral && memberRoles.includes(corp.roles.geral)) {
                    batalhao = corp.shortName || corp.name;
                    break;
                }
            }

            if (!batalhao) {
                for (const corp of dbCorps) {
                    if (corp.type === 'primary' && Array.isArray(corp.subdivisions)) {
                        for (const sub of corp.subdivisions) {
                            if (sub.roleId && memberRoles.includes(sub.roleId)) {
                                batalhao = sub.shortName || sub.name;
                                break;
                            }
                        }
                    }
                    if (batalhao) break;
                }
            }

            return {
                userId,
                nomeSobrenome,
                username,
                idCidade,
                corporacao,
                batalhao,
                status: (cadastro && cadastro.status) || 'aprovado',
                createdAt: (cadastro && cadastro.createdAt) || new Date()
            };
        });

        // 4. Filtrar por busca (se houver q)
        if (q) {
            const regex = new RegExp(q, 'i');
            cidadaos = cidadaos.filter(c => 
                regex.test(c.nomeSobrenome) || 
                regex.test(c.username) || 
                regex.test(c.userId) ||
                regex.test(c.idCidade) ||
                regex.test(c.corporacao) ||
                regex.test(c.batalhao)
            );
        }

        // Ordenar alfabeticamente por Nome
        cidadaos.sort((a, b) => a.nomeSobrenome.localeCompare(b.nomeSobrenome));

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
             const worksheet = workbook.addWorksheet('Membros SSP');
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
            res.setHeader('Content-Disposition', 'attachment; filename="cidadaos-ssp.xlsx"');
            await workbook.xlsx.write(res);
            return res.end();
        } else if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="cidadaos-ssp.pdf"');
            doc.pipe(res);

            doc.fontSize(18).text('SSP - Relatório de Oficiais e Cidadãos Cadastrados', { align: 'center' });
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
        const guildId = process.env.GUILD_ID;
        
        let cidadao = null;
        let member = null;
        let nick = '';
        let globalName = '';
        let username = '';
        
        // 1. Buscar membro no Discord
        try {
            if (guildId) {
                member = await discordAPIRequest(`/guilds/${guildId}/members/${userId}`, 'GET');
                if (member && member.user) {
                    nick = member.nick || '';
                    globalName = member.user.global_name || '';
                    username = member.user.username || '';
                }
            }
        } catch (discordErr) {
            console.error(`[Cidadaos API] Membro ${userId} não encontrado no Discord para detalhes:`, discordErr.message);
        }

        // 2. Buscar no banco
        const cadastro = await LspdCadastro.findOne({ guildId, userId }).lean();
        const candidaturas = await LspdCandidatura.find({ guildId, userId }).sort({ createdAt: -1 }).lean();

        if (cadastro || (member && member.user)) {
            // Resolver idCidade
            let idCidade = 'N/A';
            if (cadastro && cadastro.idCidade && cadastro.idCidade !== 'Discord') {
                idCidade = cadastro.idCidade;
            } else {
                const candComId = candidaturas.find(c => c.idCidade && c.idCidade !== 'Discord');
                if (candComId) {
                    idCidade = candComId.idCidade;
                } else if (nick) {
                    const match = nick.match(/\[(\d+)\]/);
                    if (match) idCidade = match[1];
                }
            }

            // Resolver nomeSobrenome
            let nomeSobrenome = (cadastro && cadastro.nomeSobrenome) || nick || globalName || username || 'Oficial SSP';

            // Resolver corporacao e batalhao
            let corporacao = '';
            let batalhao = '';
            const memberRoles = member ? (member.roles || []) : [];

            const ROLE_PMESP = '1510829612274548766';
            const ROLE_PCESP = '1510829647284273263';

            if (memberRoles.includes(ROLE_PMESP)) {
                corporacao = 'PMESP';
            } else if (memberRoles.includes(ROLE_PCESP)) {
                corporacao = 'PCESP';
            }

            const dbCorps = await Corporation.find({ guildId }).lean();

            for (const corp of dbCorps) {
                if (corp.type === 'tag' && corp.roles?.geral && memberRoles.includes(corp.roles.geral)) {
                    batalhao = corp.shortName || corp.name;
                    break;
                }
            }

            if (!batalhao) {
                for (const corp of dbCorps) {
                    if (corp.type === 'primary' && Array.isArray(corp.subdivisions)) {
                        for (const sub of corp.subdivisions) {
                            if (sub.roleId && memberRoles.includes(sub.roleId)) {
                                batalhao = sub.shortName || sub.name;
                                break;
                            }
                        }
                    }
                    if (batalhao) break;
                }
            }

            cidadao = {
                userId,
                nomeSobrenome,
                username: username || (cadastro && cadastro.username) || 'N/A',
                idCidade,
                corporacao,
                batalhao,
                status: (cadastro && cadastro.status) || 'aprovado',
                createdAt: (cadastro && cadastro.createdAt) || new Date()
            };
        }

        if (!cidadao) {
            return res.status(404).json({ success: false, message: 'Cidadão não encontrado.' });
        }

        res.json({ success: true, cidadao, solicitacoes: candidaturas });
    } catch (error) {
        console.error("Erro em /api/cidadaos/:userId:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar dados do cidadão.' });
    }
});

// Atualizar o Citizen ID (Passaporte) do oficial diretamente do painel web
router.post('/cidadaos/update-citizen-id', requireAdmin, async (req, res) => {
    try {
        const guildId = process.env.GUILD_ID;
        const { userId, idCidade } = req.body;

        if (!userId || !idCidade || String(idCidade).trim() === '') {
            return res.status(400).json({ success: false, message: 'Dados inválidos. ID de Usuário e Citizen ID são obrigatórios.' });
        }

        let cadastro = await LspdCadastro.findOne({ guildId, userId });
        let oldId = cadastro ? cadastro.idCidade : 'Nenhum';

        if (cadastro) {
            cadastro.idCidade = idCidade.trim();
            await cadastro.save();
        } else {
            // Oficial não possui cadastro local, vamos criá-lo
            let nomeSobrenome = 'Oficial SSP';
            let username = 'oficial';

            try {
                if (guildId) {
                    const member = await discordAPIRequest(`/guilds/${guildId}/members/${userId}`, 'GET');
                    if (member && member.user) {
                        nomeSobrenome = member.nick || member.user.global_name || member.user.username;
                        username = member.user.username;
                    }
                }
            } catch (discordErr) {
                console.error("Erro ao buscar oficial no Discord para novo cadastro:", discordErr.message);
            }

            cadastro = await LspdCadastro.create({
                guildId,
                userId,
                username,
                nomeSobrenome,
                idCidade: idCidade.trim(),
                status: 'aprovado',
                aprovadoPor: req.session.user.id
            });
        }

        // Registrar no audit log
        await registrarAuditLog(
            'cidadao_passaporte_atualizado',
            'Passaporte de Oficial Atualizado',
            `${req.session.user.displayName} atualizou o passaporte do oficial ${cadastro.nomeSobrenome} (ID: ${userId}) de "${oldId}" para "${idCidade}".`,
            req.session.user.id,
            req.session.user.username
        );

        res.json({ success: true, message: 'Passaporte atualizado com sucesso!', cidadao: cadastro });
    } catch (error) {
        console.error("Erro ao atualizar passaporte:", error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar passaporte.' });
    }
});

// Excluir cadastro do cidadão (desativado no painel)
router.delete('/cidadaos/:id', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir cadastro');
});

module.exports = router;
