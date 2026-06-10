const express = require('express');
const router = express.Router();
const LspdCadastro = require('../../models/LspdCadastro');
const LspdCandidatura = require('../../models/LspdCandidatura');

const LspdTranscript = require('../../models/LspdTranscript');
const Ticket = require('../../models/Ticket');
const Ponto = require('../../models/Ponto');
const AuditLog = require('../../models/AuditLog');

router.get('/dashboard/summary', async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const [
            totalCidadaos,
            solicitacoesPendentes,
            portesAprovados,
            passaportesAprovados,
            totalTranscripts,
            ticketsAbertos,
            ticketsFechados,
            pontosAbertos,
            editaisAprovados,
            editaisReprovados,
            weeklyActivityResult,
            moduloDistributionResult,
            recentLogs
        ] = await Promise.all([
            LspdCadastro.countDocuments(),
            LspdCandidatura.countDocuments({ status: 'pendente' }),
            LspdCandidatura.countDocuments({ modulo: 'porte', status: 'aprovado' }),
            LspdCandidatura.countDocuments({ modulo: 'paraguaio', status: 'aprovado' }),
            LspdTranscript.countDocuments(),
            Ticket.countDocuments({ status: 'open' }),
            Ticket.countDocuments({ status: 'closed' }),
            Ponto.countDocuments({ status: 'aberto' }),
            LspdCandidatura.countDocuments({ modulo: 'recrutamento', status: 'aprovado' }),
            LspdCandidatura.countDocuments({ modulo: 'recrutamento', status: 'reprovado' }),
            LspdCandidatura.aggregate([
                { $match: { createdAt: { $gte: sevenDaysAgo } } },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: '%Y-%m-%d',
                                date: '$createdAt',
                                timezone: 'America/Sao_Paulo'
                            }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            LspdCandidatura.aggregate([
                {
                    $group: {
                        _id: '$modulo',
                        count: { $sum: 1 }
                    }
                }
            ]),
            AuditLog.find().sort({ createdAt: -1 }).limit(10).lean()
        ]);

        // Formata o histórico semanal de candidaturas
        const weeklyActivity = {};
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateString = date.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
            weeklyActivity[dateString] = 0;
        }
        weeklyActivityResult.forEach(item => {
            if (weeklyActivity[item._id] !== undefined) {
                weeklyActivity[item._id] = item.count;
            }
        });

        // Formata distribuição de módulos
        const moduloDistribution = { porte: 0, paraguaio: 0, recrutamento: 0 };
        moduloDistributionResult.forEach(item => {
            if (moduloDistribution[item._id] !== undefined) {
                moduloDistribution[item._id] = item.count;
            }
        });

        // Formata logs recentes no feed
        const feed = recentLogs.map(log => ({
            type: log.type,
            title: log.title,
            description: log.description,
            username: log.username,
            userId: log.userId,
            timestamp: log.createdAt
        }));

        res.json({
            success: true,
            totalCidadaos,
            solicitacoesPendentes,
            portesAprovados,
            passaportesAprovados,
            totalTranscripts,
            ticketsAbertos,
            ticketsFechados,
            pontosAbertos,
            editaisAprovados,
            editaisReprovados,
            weeklyActivity,
            moduloDistribution,
            activityFeed: feed
        });
    } catch (error) {
        console.error("Erro em /api/dashboard/summary:", error);
        res.status(500).json({ success: false, message: 'Erro ao calcular estatísticas.' });
    }
});

module.exports = router;
