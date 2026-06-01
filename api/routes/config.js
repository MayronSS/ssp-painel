const express = require('express');
const router = express.Router();
const GuildConfig = require('../../models/GuildConfig');
const { requireAdmin } = require('../middlewares/auth');
const { discordAPIRequest } = require('../utils/discord');
const { registrarAuditLog } = require('../utils/helpers');

// Obter configurações do bot (com fallback para variáveis de ambiente)
router.get('/config', async (req, res) => {
    try {
        const guildId = process.env.GUILD_ID;
        let config = await GuildConfig.findOne({ guildId });
        if (!config) {
            config = await GuildConfig.create({ guildId });
        }
        
        // Converter para objeto plano para podermos manipular
        const configObj = config.toObject ? config.toObject() : config;
        
        if (!configObj.channels) configObj.channels = {};
        if (!configObj.roles) configObj.roles = {};

        // Mapeamento de fallbacks para variáveis de ambiente (.env)
        const fallbacks = {
            channels: {
                ticketsPanel: process.env.CHANNEL_TICKETS_PANEL,
                ticketsCategory: process.env.CATEGORY_TICKETS,
                corregedoriaCategory: process.env.CATEGORY_CORREGEDORIA,
                editalPanel: process.env.CHANNEL_EDITAL_PANEL,
                editalAvaliacao: process.env.CHANNEL_AVALIACAO,
                editalResultados: process.env.CHANNEL_RESULTADOS,
                editalAvaliacaoPmesp: process.env.CHANNEL_AVALIACAO_PMESP,
                editalAvaliacaoPcesp: process.env.CHANNEL_AVALIACAO_PCESP,
                editalResultadosPmesp: process.env.CHANNEL_RESULTADOS_PMESP,
                editalResultadosPcesp: process.env.CHANNEL_RESULTADOS_PCESP,
                pontoPanel: process.env.CHANNEL_PONTO_PANEL,
                pontoLogs: process.env.CHANNEL_PONTO_LOGS,
                pontoLogsPmesp: process.env.CHANNEL_PONTO_LOGS_PMESP,
                pontoLogsPcesp: process.env.CHANNEL_PONTO_LOGS_PCESP,
                copomLogs: process.env.CHANNEL_COPOM_LOGS,
                adminLogs: process.env.CHANNEL_ADMIN_LOGS,
                memberLogs: process.env.CHANNEL_MEMBER_LOGS,
                memberLogsEntrada: process.env.CHANNEL_MEMBER_LOGS_ENTRADA,
                memberLogsSaida: process.env.CHANNEL_MEMBER_LOGS_SAIDA,
                corregedoriaResults: process.env.CHANNEL_CORREGEDORIA_RESULTS,
                disciplinaryWarnings: process.env.CHANNEL_DISCIPLINARY_WARNINGS,
                ausenciaPanel: process.env.CHANNEL_AUSENCIA_PANEL,
                ausenciaLogs: process.env.CHANNEL_AUSENCIA_LOGS,
                ausenciaLogsPmesp: process.env.CHANNEL_AUSENCIA_LOGS_PMESP,
                ausenciaLogsPcesp: process.env.CHANNEL_AUSENCIA_LOGS_PCESP,
                warningPanel: process.env.CHANNEL_WARNING_PANEL,
                avaliacaoPanel: process.env.CHANNEL_AVALIACAO_PANEL,
                avaliacaoLogs: process.env.CHANNEL_AVALIACAO_LOGS,
                academiaPanel: process.env.CHANNEL_ACADEMIA_PANEL,
                academiaAvisos: process.env.CHANNEL_ACADEMIA_AVISOS,
                exoneracoes: process.env.CHANNEL_EXONERACOES,
                transferencias: process.env.CHANNEL_TRANSFERENCIAS,
                solicitacoesInternas: process.env.CHANNEL_SOLICITACOES_INTERNAS,
                blacklist: process.env.CHANNEL_BLACKLIST,
                sugestoes: process.env.CHANNEL_SUGESTOES,
                hierarchy: process.env.CHANNEL_HIERARCHY
            },
            roles: {
                lspdGeral: process.env.ROLE_LSPD,
                comandoAdmin: process.env.ROLE_COMMAND,
                ticketStaff: process.env.ROLE_TICKET_STAFF,
                policial: process.env.ROLE_POLICIAL,
                setupAuthorized: process.env.ROLE_SETUP,
                recrutaCadete: process.env.ROLE_RECRUTA_CADETE,
                advVerbal: process.env.ROLE_ADV_VERBAL,
                adv1: process.env.ROLE_ADV_1,
                adv2: process.env.ROLE_ADV_2,
                adv3: process.env.ROLE_ADV_3,
                administrativo: process.env.ROLE_ADMINISTRATIVO,
                preAprovado: process.env.ROLE_PRE_APROVADO,
                caboRole: process.env.ROLE_CABO
            }
        };

        // Mesclar canais vazios com os fallbacks do .env
        for (const [key, fallbackValue] of Object.entries(fallbacks.channels)) {
            if (!configObj.channels[key] || String(configObj.channels[key]).trim() === '') {
                configObj.channels[key] = fallbackValue || '';
            }
        }

        // Mesclar cargos vazios com os fallbacks do .env
        for (const [key, fallbackValue] of Object.entries(fallbacks.roles)) {
            if (!configObj.roles[key] || String(configObj.roles[key]).trim() === '') {
                configObj.roles[key] = fallbackValue || '';
            }
        }

        res.json({ success: true, config: configObj });
    } catch (error) {
        console.error("Erro em /api/config:", error);
        res.status(500).json({ success: false, message: 'Erro ao carregar configurações.' });
    }
});

// Buscar nome de canal do Discord por ID
router.get('/discord/channels/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        if (!channelId || channelId.trim() === '') {
            return res.status(400).json({ success: false, message: 'ID de canal inválido.' });
        }
        const channel = await discordAPIRequest(`/channels/${channelId}`, 'GET');
        res.json({ success: true, name: channel.name, type: channel.type });
    } catch (error) {
        console.error(`Erro ao buscar canal ${req.params.channelId}:`, error.message);
        res.status(404).json({ success: false, message: 'Canal não encontrado.' });
    }
});

// Buscar nome de cargo do Discord por ID
router.get('/discord/roles/:roleId', async (req, res) => {
    try {
        const { roleId } = req.params;
        if (!roleId || roleId.trim() === '') {
            return res.status(400).json({ success: false, message: 'ID de cargo inválido.' });
        }
        const guildId = process.env.GUILD_ID;
        const roles = await discordAPIRequest(`/guilds/${guildId}/roles`, 'GET');
        if (Array.isArray(roles)) {
            const role = roles.find(r => r.id === roleId);
            if (role) {
                return res.json({ success: true, name: role.name, color: role.color });
            }
        }
        res.status(404).json({ success: false, message: 'Cargo não encontrado.' });
    } catch (error) {
        console.error(`Erro ao buscar cargo ${req.params.roleId}:`, error.message);
        res.status(500).json({ success: false, message: 'Erro ao buscar cargo.' });
    }
});

// Atualizar configurações do bot
router.post('/config', requireAdmin, async (req, res) => {
    try {
        const guildId = process.env.GUILD_ID;
        const { channels, roles, modules, embeds } = req.body;

        let existingConfig = await GuildConfig.findOne({ guildId });
        if (!existingConfig) {
            existingConfig = new GuildConfig({ guildId });
        }

        // Realizar mesclagem parcial para evitar a remoção de campos que não foram enviados pelo frontend
        if (channels && typeof channels === 'object') {
            for (const [key, val] of Object.entries(channels)) {
                existingConfig.channels[key] = val;
            }
        }
        if (roles && typeof roles === 'object') {
            for (const [key, val] of Object.entries(roles)) {
                existingConfig.roles[key] = val;
            }
        }
        if (modules && typeof modules === 'object') {
            for (const [key, val] of Object.entries(modules)) {
                existingConfig.modules[key] = val;
            }
        }
        if (embeds && typeof embeds === 'object') {
            if (embeds.design && typeof embeds.design === 'object') {
                if (embeds.design.colors && typeof embeds.design.colors === 'object') {
                    for (const [key, val] of Object.entries(embeds.design.colors)) {
                        existingConfig.embeds.design.colors[key] = val;
                    }
                }
                if (embeds.design.logo !== undefined) {
                    existingConfig.embeds.design.logo = embeds.design.logo;
                }
            }
            const panels = ['tickets', 'ponto', 'edital', 'ausencia', 'warning', 'avaliacao'];
            for (const panel of panels) {
                if (embeds[panel] && embeds[panel].panel && typeof embeds[panel].panel === 'object') {
                    for (const [key, val] of Object.entries(embeds[panel].panel)) {
                        existingConfig.embeds[panel].panel[key] = val;
                    }
                }
            }
        }

        // Marcar caminhos como modificados no Mongoose para garantir que gravem
        existingConfig.markModified('channels');
        existingConfig.markModified('roles');
        existingConfig.markModified('modules');
        existingConfig.markModified('embeds');

        await existingConfig.save();

        await registrarAuditLog(
            'config_alterada',
            'Configurações do Bot Atualizadas',
            `As configurações do bot foram modificadas via Painel por ${req.session.user.displayName}.`,
            req.session.user.id,
            req.session.user.username
        );

        res.json({ 
            success: true, 
            message: 'Configurações salvas. Para atualizar os painéis no Discord, use /setup no Discord.', 
            config: existingConfig 
        });
    } catch (error) {
        console.error("Erro ao salvar config:", error);
        res.status(500).json({ success: false, message: 'Erro ao salvar configurações do bot.' });
    }
});

module.exports = router;
