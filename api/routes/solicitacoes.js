const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const LspdCandidatura = require('../../models/LspdCandidatura');
const GuildConfig = require('../../models/GuildConfig');
const { requireAdmin } = require('../middlewares/auth');
const { discordAPIRequest } = require('../utils/discord');
const { registrarAuditLog, panelOnlyActionDisabled } = require('../utils/helpers');
const notifService = require('../services/notificationService');

// Listar solicitações
router.get('/solicitacoes', async (req, res) => {
    try {
        const { status, modulo, q } = req.query;
        let query = {};
        if (status) query.status = status;
        if (modulo) query.modulo = modulo;
        if (q) {
            query.$or = [
                { nomeSobrenome: { $regex: q, $options: 'i' } },
                { idCidade: { $regex: q, $options: 'i' } },
                { username: { $regex: q, $options: 'i' } }
            ];
        }
        const solicitacoes = await LspdCandidatura.find(query).sort({ createdAt: -1 }).lean();
        res.json({ success: true, solicitacoes });
    } catch (error) {
        console.error("Erro em /api/solicitacoes:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar solicitações.' });
    }
});

// Aprovar solicitação
router.put('/solicitacoes/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await LspdCandidatura.findByIdAndUpdate(
            id,
            { status: 'aprovado', aprovadoPor: req.session.user.displayName || 'Painel Administrativo' },
            { returnDocument: 'after' }
        );
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Solicitação/Candidatura não encontrada.' });
        }

        // Se for recrutamento, manda mensagem com botão no canal do edital do Discord!
        if (updated.modulo === 'recrutamento') {
            const guildConfig = await GuildConfig.findOne({ guildId: updated.guildId || process.env.GUILD_ID });
            const corpSlug = updated.corporationSlug || 'pmesp';
            const channelId = corpSlug === 'pmesp' ? guildConfig?.channels?.editalResultadosPmesp : guildConfig?.channels?.editalResultadosPcesp;
            if (channelId) {
                try {
                    const body = {
                        content: `||<@${updated.userId}>||`,
                        embeds: [
                            {
                                color: 3066993, // Verde
                                author: {
                                    name: 'DEPARTAMENTO DE POLÍCIA DE LOS SANTOS',
                                    icon_url: guildConfig?.embeds?.design?.logo || 'https://i.imgur.com/8Qp49X0.png'
                                },
                                title: 'Recrutamento LSPD — Aprovado',
                                description: `Prezado <@${updated.userId}>,\n\nSua ficha de inscrição para ingressar na LSPD foi **APROVADA** pela corregedoria/comando!`,
                                fields: [
                                    { name: '👤 Oficial Responsável', value: `${req.session.user.displayName}`, inline: true },
                                    { name: '🎫 Passaporte do Cadete', value: `\`${updated.idCidade || 'N/A'}\``, inline: true }
                                ],
                                image: {
                                    url: 'https://i.imgur.com/XU797R3.png'
                                },
                                footer: {
                                    text: 'LSPD Recrutamento • Parabéns!'
                                }
                            }
                        ],
                        components: [
                            {
                                type: 1, // ACTION_ROW
                                components: [
                                    {
                                        type: 2, // BUTTON
                                        custom_id: `confirmar_dados_${updated.userId}_${updated.idCidade}_${updated.nomeSobrenome}`,
                                        label: 'ASSUMIR DISTINTIVO E CARGOS',
                                        style: 3, // SUCCESS
                                        emoji: { name: '🏅' }
                                    }
                                ]
                            }
                        ]
                    };
                    await discordAPIRequest(`/channels/${channelId}/messages`, 'POST', body);
                } catch (discordError) {
                    console.error("Erro ao enviar notificação de aprovação ao Discord:", discordError);
                }
            }
        }

        await registrarAuditLog(
            'solicitacao_decidida',
            'Solicitação Aprovada via Painel',
            `A solicitação de ${updated.modulo} do cidadão ${updated.nomeSobrenome} foi APROVADA por ${req.session.user.displayName || 'Painel Administrativo'}.`,
            req.session.user.id || '0',
            req.session.user.username || 'Painel',
            { citizenId: updated.userId, modulo: updated.modulo, tipo: updated.tipo, protocolo: updated._id.toString() }
        );

        res.json({ success: true, message: 'Solicitação aprovada com sucesso!', solicitacao: updated });

        // Notify all panel users
        try {
          await notifService.broadcast('solicitacao_decidida', 'Solicitação Aprovada', `${updated.modulo.toUpperCase()} de ${updated.nomeSobrenome} foi aprovada por ${req.session.user.displayName}.`, { link: '#solicitacoes' });
        } catch(_) {}
    } catch (error) {
        console.error("Erro ao aprovar solicitação:", error);
        res.status(500).json({ success: false, message: 'Erro ao aprovar solicitação.' });
    }
});

// Reprovar solicitação
router.put('/solicitacoes/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ success: false, message: 'O motivo da reprovação é obrigatório.' });
        }
        const updated = await LspdCandidatura.findByIdAndUpdate(
            id,
            { status: 'reprovado', reprovadoPor: req.session.user.displayName || 'Painel Administrativo', motivoReprovacao: reason },
            { returnDocument: 'after' }
        );
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Solicitação/Candidatura não encontrada.' });
        }

        // Se for recrutamento, manda mensagem de reprovação no Discord
        if (updated.modulo === 'recrutamento') {
            const guildConfig = await GuildConfig.findOne({ guildId: updated.guildId || process.env.GUILD_ID });
            const corpSlug = updated.corporationSlug || 'pmesp';
            const channelId = corpSlug === 'pmesp' ? guildConfig?.channels?.editalResultadosPmesp : guildConfig?.channels?.editalResultadosPcesp;
            if (channelId) {
                try {
                    const body = {
                        content: `||<@${updated.userId}>||`,
                        embeds: [
                            {
                                color: 15158332, // Vermelho
                                author: {
                                    name: 'DEPARTAMENTO DE POLÍCIA DE LOS SANTOS',
                                    icon_url: guildConfig?.embeds?.design?.logo || 'https://i.imgur.com/8Qp49X0.png'
                                },
                                title: 'Recrutamento LSPD — Reprovado',
                                description: `Prezado <@${updated.userId}>,\n\nInfelizmente, sua ficha de inscrição para ingressar na LSPD foi **REPROVADA** pela corregedoria/comando.\n\n**Motivo:** ${reason}`,
                                fields: [
                                    { name: '👤 Oficial Responsável', value: `${req.session.user.displayName}`, inline: true },
                                    { name: '🎫 Passaporte', value: `\`${updated.idCidade || 'N/A'}\``, inline: true }
                                ],
                                image: {
                                    url: 'https://i.imgur.com/XU797R3.png'
                                },
                                footer: {
                                    text: 'LSPD Recrutamento • Mais sorte na próxima!'
                                }
                            }
                        ]
                    };
                    await discordAPIRequest(`/channels/${channelId}/messages`, 'POST', body);
                } catch (discordError) {
                    console.error("Erro ao enviar notificação de reprovação ao Discord:", discordError);
                }
            }
        }

        await registrarAuditLog(
            'solicitacao_decidida',
            'Solicitação Reprovada via Painel',
            `A solicitação de ${updated.modulo} do cidadão ${updated.nomeSobrenome} foi REPROVADA por ${req.session.user.displayName || 'Painel Administrativo'}. Motivo: ${reason}`,
            req.session.user.id || '0',
            req.session.user.username || 'Painel',
            { citizenId: updated.userId, modulo: updated.modulo, tipo: updated.tipo, motivo: reason, protocolo: updated._id.toString() }
        );

        res.json({ success: true, message: 'Solicitação reprovada com sucesso!', solicitacao: updated });

        // Notify all panel users
        try {
          await notifService.broadcast('solicitacao_decidida', 'Solicitação Reprovada', `${updated.modulo.toUpperCase()} de ${updated.nomeSobrenome} foi reprovada. Motivo: ${reason}`, { link: '#solicitacoes', tone: 'rose' });
        } catch(_) {}
    } catch (error) {
        console.error("Erro ao reprovar solicitação:", error);
        res.status(500).json({ success: false, message: 'Erro ao reprovar solicitação.' });
    }
});

// Editar solicitação (desativado)
router.put('/solicitacoes/:id', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Editar solicitação');
});

// Deletar solicitação (desativado)
router.delete('/solicitacoes/:id', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir solicitação');
});

// Exportar solicitações
router.get('/solicitacoes/export', async (req, res) => {
    try {
        const { format, status, modulo, q } = req.query;
        let query = {};
        if (status) query.status = status;
        if (modulo) query.modulo = modulo;
        if (q) {
            query.$or = [
                { nomeSobrenome: { $regex: q, $options: 'i' } },
                { idCidade: { $regex: q, $options: 'i' } },
                { username: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ];
        }
        const solicitacoes = await LspdCandidatura.find(query).sort({ createdAt: -1 }).lean();
        if (['xlsx', 'pdf'].includes(format)) {
            await registrarAuditLog(
                'relatorio_exportado',
                'Relatório de Solicitações Exportado',
                `${req.session.user.displayName} exportou o relatório de solicitações no formato ${format.toUpperCase()}.`,
                req.session.user.id,
                req.session.user.username,
                { relatorio: 'solicitacoes', formato: format, total: solicitacoes.length, status: status || '', modulo: modulo || '', filtro: q || '' }
            );
        }

        if (format === 'xlsx') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Solicitações LSPD');
            worksheet.columns = [
                { header: 'Cidadão/Oficial', key: 'nomeSobrenome', width: 30 },
                { header: 'ID Cidade', key: 'idCidade', width: 15 },
                { header: 'Serviço', key: 'modulo', width: 20 },
                { header: 'Tipo', key: 'tipo', width: 25 },
                { header: 'Status', key: 'status', width: 15 },
                { header: 'Data de Envio', key: 'createdAt', width: 25 },
                { header: 'Aprovado/Reprovado por', key: 'decididoPor', width: 25 }
            ];
            solicitacoes.forEach(s => {
                worksheet.addRow({
                    nomeSobrenome: s.nomeSobrenome,
                    idCidade: s.idCidade,
                    modulo: s.modulo === 'recrutamento' ? 'Recrutamento (Edital)' : (s.modulo === 'porte' ? 'Porte de Arma' : 'Passaporte/Visto'),
                    tipo: s.tipo,
                    status: s.status,
                    createdAt: new Date(s.createdAt).toLocaleString('pt-BR'),
                    decididoPor: s.status === 'aprovado' ? s.aprovadoPor : (s.status === 'reprovado' ? `${s.reprovadoPor} (Motivo: ${s.motivoReprovacao})` : 'Pendente')
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="solicitacoes-lspd.xlsx"');
            await workbook.xlsx.write(res);
            return res.end();
        } else if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="solicitacoes-lspd.pdf"');
            doc.pipe(res);

            doc.fontSize(18).text('LSPD - Relatório de Solicitações e Recrutamento', { align: 'center' });
            doc.moveDown(2);

            solicitacoes.forEach((s, index) => {
                const decisoInfo = s.status === 'aprovado'
                    ? `Aprovado por: ${s.aprovadoPor}`
                    : (s.status === 'reprovado' ? `Reprovado por: ${s.reprovadoPor} (Motivo: ${s.motivoReprovacao})` : 'Pendente de análise');

                doc.fontSize(10).text(
                    `${index + 1}. Cidadão: ${s.nomeSobrenome} | ID: ${s.idCidade}\n` +
                    `   Serviço: ${s.modulo.toUpperCase()} | Tipo: ${s.tipo}\n` +
                    `   Status: ${s.status.toUpperCase()} | Enviado em: ${new Date(s.createdAt).toLocaleString('pt-BR')}\n` +
                    `   ${decisoInfo}\n`,
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
        console.error("Erro na exportação de solicitações:", e);
        res.status(500).send('Erro ao gerar relatório.');
    }
});

module.exports = router;
