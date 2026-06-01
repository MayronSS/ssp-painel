const https = require('https');
const GuildConfig = require('../../models/GuildConfig');
const Ponto = require('../../models/Ponto');
const LspdTranscript = require('../../models/LspdTranscript');

const DISCORD_COMPONENTS_V2_FLAG = 32768;
const PONTO_ICON = {
    check: '\u2705',
    stop: '\u23f9\uFE0F',
    clock: '\u{1F552}',
    clipboard: '\u{1F4CB}',
    user: '\u{1F46E}',
    refresh: '\u{1F504}'
};

function discordAPIRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            return reject(new Error("Token do Discord não configurado no .env"));
        }
        const options = {
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10${path}`,
            method: method,
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'DiscordBot (https://github.com/discordjs/discord.js, 14.11.0)'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    let json = {};
                    if (data) {
                        json = JSON.parse(data);
                    }
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject(new Error(json.message || `HTTP ${res.statusCode}`));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

function discordMultipartRequest(path, method = 'POST', payload = {}, files = []) {
    return new Promise((resolve, reject) => {
        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            return reject(new Error("Token do Discord não configurado no .env"));
        }

        const boundary = `----lspd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const chunks = [];
        const push = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'));

        push(`--${boundary}\r\n`);
        push('Content-Disposition: form-data; name="payload_json"\r\n');
        push('Content-Type: application/json\r\n\r\n');
        const payloadJson = { ...payload };
        if (files.length && !payloadJson.attachments) {
            payloadJson.attachments = files.map((file, index) => ({
                id: index,
                filename: file.filename,
                description: file.description || file.filename
            }));
        }
        push(JSON.stringify(payloadJson));
        push('\r\n');

        files.forEach((file, index) => {
            push(`--${boundary}\r\n`);
            push(`Content-Disposition: form-data; name="files[${index}]"; filename="${file.filename}"\r\n`);
            push(`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`);
            push(file.data);
            push('\r\n');
        });

        push(`--${boundary}--\r\n`);
        const body = Buffer.concat(chunks);

        const options = {
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10${path}`,
            method,
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                'User-Agent': 'DiscordBot (https://github.com/discordjs/discord.js, 14.11.0)'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    let json = {};
                    if (data) json = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject(new Error(json.message || `HTTP ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function sendDiscordFileMessage(path, payload, files) {
    return discordMultipartRequest(path, 'POST', payload, files);
}

async function getActiveGuildConfig() {
    const guildId = process.env.GUILD_ID || 'default';
    return GuildConfig.findOne({ guildId }).lean();
}

function toDiscordTimestamp(date, style = 'f') {
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

function shortId(value = '') {
    return String(value).slice(-8) || 'manual';
}

function formatDurationWithSeconds(ms = 0) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
}

function textComponent(content) {
    return { type: 10, content };
}

function separatorComponent() {
    return { type: 14, divider: true, spacing: 1 };
}

function fileComponent(filename) {
    return { type: 13, file: { url: `attachment://${filename}` } };
}

function containerComponent(components) {
    return { type: 17, accent_color: 0x111625, components };
}

function buildComponentsV2Payload(components) {
    return { components, flags: DISCORD_COMPONENTS_V2_FLAG };
}

function componentHasTextRaw(component, acceptedTexts) {
    if (!component) return false;
    const content = component.content || '';
    if (typeof content === 'string' && acceptedTexts.some(text => content.includes(text))) return true;
    const children = component.components || [];
    return children.some(child => componentHasTextRaw(child, acceptedTexts));
}

async function buildPontoStatusPayloadForDiscord() {
    const ativos = await Ponto.find({ status: 'aberto' }).sort({ entrada: 1 }).lean();
    const body = ativos.length === 0
        ? '*Nenhum oficial em patrulhamento no momento.*'
        : ativos.map((ponto, index) => {
            const durationMs = Date.now() - new Date(ponto.entrada).getTime();
            return `**${index + 1}.** ${PONTO_ICON.user} <@${ponto.userId}> - **${formatDurationWithSeconds(durationMs)}**\n> Início: ${toDiscordTimestamp(ponto.entrada, 'f')} - \`${shortId(ponto._id)}\``;
        }).join('\n\n');

    return buildComponentsV2Payload([
        containerComponent([
            textComponent(`${PONTO_ICON.clipboard} **Registro de Baixa (Em Serviço)**`),
            separatorComponent(),
            textComponent(body),
            separatorComponent(),
            textComponent(`${PONTO_ICON.refresh} **Atualização automática do sistema de ponto LSPD**`)
        ])
    ]);
}

function calculatePontoDurationMs(entrada, saida, status) {
    if (status !== 'fechado' || !entrada || !saida) return 0;
    return Math.max(0, new Date(saida).getTime() - new Date(entrada).getTime());
}

function buildPontoLogPayloadForDiscord({ type, ponto, actorName = 'Painel Web', now = new Date(), durationMs = null }) {
    const isEntrada = type === 'entrada';
    const entrada = new Date(ponto.entrada);
    const saida = ponto.saida ? new Date(ponto.saida) : new Date(now);
    const title = isEntrada ? `${PONTO_ICON.check} **Ponto Aberto**` : `${PONTO_ICON.stop} **Ponto Encerrado**`;
    const timeLine = isEntrada
        ? `${PONTO_ICON.clock} Entrada: ${toDiscordTimestamp(entrada, 'f')}`
        : `${PONTO_ICON.clock} ${toDiscordTimestamp(entrada, 't')} -> ${toDiscordTimestamp(saida, 't')} - **${formatDurationWithSeconds(durationMs ?? calculatePontoDurationMs(entrada, saida, 'fechado'))}**`;

    return buildComponentsV2Payload([
        containerComponent([
            textComponent(title),
            separatorComponent(),
            textComponent([
                `${PONTO_ICON.user} <@${ponto.userId}> - **${ponto.username || 'Oficial LSPD'}**`,
                timeLine,
                `Registro: \`${shortId(ponto._id)}\` - Origem: **${actorName}**`
            ].join('\n'))
        ])
    ]);
}

async function syncPontoStatusToDiscord() {
    const config = await getActiveGuildConfig();
    const channelId = config?.channels?.pontoPanel || process.env.CHANNEL_PONTO_PANEL;
    if (!channelId) return { skipped: true, reason: 'Canal de painel de ponto não configurado.' };

    const payload = await buildPontoStatusPayloadForDiscord();
    const messages = await discordAPIRequest(`/channels/${channelId}/messages?limit=50`, 'GET');
    const statusMessage = Array.isArray(messages)
        ? messages.find(message => {
            const embedTitle = message.embeds?.[0]?.title || '';
            if (embedTitle.includes('Registro de Baixa')) return true;
            return (message.components || []).some(component =>
                componentHasTextRaw(component, ['Registro de Baixa', 'Em Serviço', 'Em Servico', 'Em Servi'])
            );
        })
        : null;

    if (statusMessage) {
        await discordAPIRequest(`/channels/${channelId}/messages/${statusMessage.id}`, 'PATCH', {
            ...payload,
            content: null,
            embeds: []
        });
    } else {
        await discordAPIRequest(`/channels/${channelId}/messages`, 'POST', payload);
    }

    return { skipped: false };
}

async function sendPontoLogToDiscord({ type, ponto, actorName, now = new Date(), durationMs = null }) {
    const config = await getActiveGuildConfig();
    const channelId =
        config?.channels?.pontoLogs ||
        config?.channels?.copomLogs ||
        process.env.CHANNEL_PONTO_LOGS ||
        process.env.CHANNEL_COPOM_LOGS;

    if (!channelId) return { skipped: true, reason: 'Canal de logs de ponto não configurado.' };

    const payload = buildPontoLogPayloadForDiscord({ type, ponto, actorName, now, durationMs });
    await discordAPIRequest(`/channels/${channelId}/messages`, 'POST', payload);
    return { skipped: false };
}

async function notifyPontoDiscord({ logType = null, ponto, actorName, now = new Date(), durationMs = null }) {
    const result = { statusSynced: false, logSent: false };
    try {
        await syncPontoStatusToDiscord();
        result.statusSynced = true;
    } catch (error) {
        console.error('[Ponto Sync] Erro ao atualizar status no Discord:', error.message);
        result.statusError = error.message;
    }

    if (logType && ponto) {
        try {
            await sendPontoLogToDiscord({ type: logType, ponto, actorName, now, durationMs });
            result.logSent = true;
        } catch (error) {
            console.error('[Ponto Sync] Erro ao enviar log de ponto:', error.message);
            result.logError = error.message;
        }
    }

    return result;
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripDiscordPrefix(content = '') {
    return String(content).replace(/^💻 \*\*\[Painel Web\]\s*(?:\([^)]+\))?\*\*:\s*/u, '');
}

function findComponentByCustomIdRaw(components, customId) {
    for (const component of components || []) {
        if (component.custom_id === customId) return component;
        const found = findComponentByCustomIdRaw(component.components || [], customId);
        if (found) return found;
    }
    return null;
}

function isDiscordSnowflake(value) {
    return /^\d{17,20}$/.test(String(value || ''));
}

function formatTicketClaimedBy(claimedBy, claimedByLabel) {
    if (isDiscordSnowflake(claimedBy)) {
        return `<@${claimedBy}>`;
    }
    return `**${claimedByLabel || claimedBy || 'Painel Web'}**`;
}

function updateTicketClaimStatusRaw(components, claimedBy, claimedByLabel) {
    const statusLine = `> **Status:** atendimento assumido por ${formatTicketClaimedBy(claimedBy, claimedByLabel)}.`;
    let changed = false;

    const rewriteContent = (content) => {
        const lines = String(content).split('\n');
        const statusIndex = lines.findIndex((line) =>
            line.startsWith('> **Status:** aguardando um oficial assumir') ||
            line.startsWith('> **Status:** atendimento assumido por') ||
            line.startsWith('> **Responsável:**')
        );

        if (statusIndex >= 0) {
            lines[statusIndex] = statusLine;
            return lines.join('\n');
        }

        if (content.includes('**Atendimento Iniciado**') || content.includes('**Atendimento em Espera**')) {
            return `${content}\n${statusLine}`;
        }

        return content;
    };

    const visit = (items = []) => {
        for (const component of items) {
            if (typeof component.content === 'string') {
                const nextContent = rewriteContent(component.content);
                if (nextContent !== component.content) {
                    component.content = nextContent;
                    changed = true;
                }
            }
            visit(component.components || []);
        }
    };

    visit(components);
    return changed;
}

async function fetchDiscordChannelMessages(channelId) {
    const allMessages = [];
    let before = null;

    for (let page = 0; page < 20; page += 1) {
        const query = before ? `?limit=100&before=${before}` : '?limit=100';
        const messages = await discordAPIRequest(`/channels/${channelId}/messages${query}`, 'GET');
        if (!Array.isArray(messages) || messages.length === 0) break;

        allMessages.push(...messages);
        before = messages[messages.length - 1].id;
        if (messages.length < 100) break;
    }

    return allMessages.reverse();
}

function buildTicketTranscriptHtml({ channel, messages, ticket, closedByName }) {
    const rows = messages.map((message) => {
        const author = message.author?.global_name || message.author?.username || 'Desconhecido';
        const timestamp = new Date(message.timestamp).toLocaleString('pt-BR');
        const content = escapeHtml(stripDiscordPrefix(message.content || '')).replace(/\n/g, '<br>');
        const attachments = (message.attachments || [])
            .map((attachment) => `<a href="${escapeHtml(attachment.url)}" target="_blank">${escapeHtml(attachment.filename || attachment.url)}</a>`)
            .join('<br>');

        return `
            <article class="message">
                <div class="meta">
                    <strong>${escapeHtml(author)}</strong>
                    <span>${escapeHtml(timestamp)}</span>
                </div>
                <div class="content">${content || '<em>Mensagem sem texto.</em>'}</div>
                ${attachments ? `<div class="attachments">${attachments}</div>` : ''}
            </article>`;
    }).join('\n');

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Transcript - ${escapeHtml(channel.name || ticket.channelId)}</title>
  <style>
    body { margin: 0; background: #313338; color: #dbdee1; font-family: Arial, sans-serif; }
    header { padding: 24px; background: #1e1f22; border-bottom: 1px solid #232428; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 4px 0; color: #b5bac1; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    .message { display: block; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
    .meta { display: flex; gap: 10px; align-items: baseline; margin-bottom: 5px; }
    .meta strong { color: #f2f3f5; }
    .meta span { color: #949ba4; font-size: 12px; }
    .content { line-height: 1.45; white-space: normal; overflow-wrap: anywhere; }
    .attachments { margin-top: 8px; font-size: 13px; }
    a { color: #8ea1e1; }
    em { color: #949ba4; }
  </style>
</head>
<body>
  <header>
    <h1>#${escapeHtml(channel.name || ticket.channelId)}</h1>
    <p>Cidadão: ${escapeHtml(ticket.username || ticket.userId)} (${escapeHtml(ticket.userId)})</p>
    <p>Departamento: ${escapeHtml(ticket.reason || 'Atendimento')}</p>
    <p>Fechado por: ${escapeHtml(closedByName)}</p>
  </header>
  <main>
    ${rows || '<p>Nenhuma mensagem encontrada no canal.</p>'}
  </main>
</body>
</html>`;
}

async function createTicketTranscriptFromDiscord(ticket, closedByName, closedById) {
    const channel = await discordAPIRequest(`/channels/${ticket.channelId}`, 'GET');
    const messages = await fetchDiscordChannelMessages(ticket.channelId);
    const htmlContent = buildTicketTranscriptHtml({ channel, messages, ticket, closedByName });
    const protocolo = `PRT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
    const modulo = (channel.name || '').includes('corregedoria') || String(ticket.reason || '').toLowerCase().includes('corregedoria')
        ? 'corregedoria'
        : 'atendimento';

    const transcript = await LspdTranscript.create({
        ticketId: ticket.channelId,
        channelName: channel.name || ticket.channelId,
        citizenId: ticket.userId || '0',
        citizenName: ticket.username || 'Desconhecido',
        closedBy: closedById,
        closedByName,
        modulo,
        htmlContent,
        protocolo
    });

    return { transcript, htmlContent, channel };
}

function buildTicketArchiveLogPayloadForDiscord({ channelName, channelId, officerId, officerName, citizenId, transcriptFilename }) {
    const ticketLabel = channelName ? `#${channelName}` : 'ticket encerrado';
    const components = [
        textComponent('📋 **Arquivo de Protocolo Digital**'),
        separatorComponent(),
        textComponent([
            'Status: atendimento encerrado e transcript gerado.',
            `Ticket: ${ticketLabel}`,
            `Oficial responsável: ${officerId && /^\d+$/.test(String(officerId)) ? `<@${officerId}>` : officerName || 'Painel Web'}`,
            `Cidadão solicitante: ${citizenId ? `<@${citizenId}>` : 'Não identificado'}`,
            `ID do canal: ${channelId || 'N/A'}`,
            'Arquivo: cópia completa do processo em HTML Transcript anexada.'
        ].join('\n'))
    ];

    if (transcriptFilename) {
        components.push(separatorComponent(), fileComponent(transcriptFilename));
    }

    const payload = buildComponentsV2Payload([
        containerComponent(components)
    ]);

    payload.allowed_mentions = {
        users: [...new Set([officerId, citizenId].filter((value) => /^\d+$/.test(String(value))).map(String))]
    };
    return payload;
}

function buildTicketDmCopyPayloadForDiscord({ channelName, userId, transcriptFilename }) {
    const ticketLabel = channelName ? `#${channelName}` : 'ticket encerrado';
    const components = [
        textComponent('📋 **Cópia de Atendimento Disponível**'),
        separatorComponent(),
        textComponent([
            userId ? `Olá <@${userId}>.` : 'Olá.',
            'Status: atendimento encerrado e transcript gerado.',
            `Ticket: ${ticketLabel}`,
            'Arquivo: cópia completa do processo em HTML Transcript anexada.',
            'Mensagem: obrigado por cooperar com a LSPD.'
        ].join('\n'))
    ];

    if (transcriptFilename) {
        components.push(separatorComponent(), fileComponent(transcriptFilename));
    }

    const payload = buildComponentsV2Payload([
        containerComponent(components)
    ]);

    payload.allowed_mentions = {
        users: userId ? [String(userId)] : []
    };
    return payload;
}

async function sendTicketCloseLogs({ ticket, channel, htmlContent, actorName, actorId }) {
    const config = await getActiveGuildConfig();
    const logChannelId = config?.channels?.adminLogs || process.env.CHANNEL_ADMIN_LOGS;
    const filename = `Processo-${channel.name || ticket.channelId}.html`;
    const htmlBuffer = Buffer.from(htmlContent, 'utf8');

    if (logChannelId) {
        await sendDiscordFileMessage(
            `/channels/${logChannelId}/messages`,
            buildTicketArchiveLogPayloadForDiscord({
                channelName: channel.name || ticket.channelId,
                channelId: ticket.channelId,
                officerId: actorId,
                officerName: actorName,
                citizenId: ticket.userId,
                transcriptFilename: filename
            }),
            [{ filename, contentType: 'text/html; charset=utf-8', data: htmlBuffer }]
        );
    }

    if (ticket.userId) {
        try {
            const dm = await discordAPIRequest('/users/@me/channels', 'POST', { recipient_id: ticket.userId });
            if (dm?.id) {
                await sendDiscordFileMessage(
                    `/channels/${dm.id}/messages`,
                    buildTicketDmCopyPayloadForDiscord({
                        channelName: channel.name || ticket.channelId,
                        userId: ticket.userId,
                        transcriptFilename: filename
                    }),
                    [{ filename, contentType: 'text/html; charset=utf-8', data: htmlBuffer }]
                );
            }
        } catch (error) {
            console.error(`[Ticket Close] Não foi possível enviar DM para ${ticket.userId}:`, error.message);
        }
    }
}

async function deleteTicketVoiceChannelIfExists(channelName) {
    const config = await getActiveGuildConfig();
    const guildId = process.env.GUILD_ID || (config?.guildId !== 'default' ? config?.guildId : null);
    if (!guildId || !channelName) return false;

    const ticketName = String(channelName).split('-')[1];
    if (!ticketName) return false;

    const voiceNames = [`📞・ rádio-${ticketName}`, `📞 rádio-${ticketName}`];
    const channels = await discordAPIRequest(`/guilds/${guildId}/channels`, 'GET');
    const voiceChannel = Array.isArray(channels)
        ? channels.find((channel) => channel.type === 2 && voiceNames.includes(channel.name))
        : null;

    if (!voiceChannel?.id) return false;

    await discordAPIRequest(`/channels/${voiceChannel.id}`, 'DELETE');
    return true;
}

async function syncTicketClaimMessage(ticket, claimedBy, claimedByLabel) {
    if (!ticket.channelId) {
        throw new Error('Ticket sem canal vinculado.');
    }

    const messages = await fetchDiscordChannelMessages(ticket.channelId);
    const targetMessage = messages.find((message) =>
        findComponentByCustomIdRaw(message.components || [], 'ticket_assumir')
    );

    if (!targetMessage) {
        throw new Error('Mensagem de controles do ticket não encontrada no Discord.');
    }

    const components = JSON.parse(JSON.stringify(targetMessage.components || []));
    const claimButton = findComponentByCustomIdRaw(components, 'ticket_assumir');
    if (claimButton) {
        claimButton.label = `Assumido por ${claimedByLabel || 'Painel Web'}`.slice(0, 80);
        claimButton.disabled = true;
    }
    updateTicketClaimStatusRaw(components, claimedBy, claimedByLabel);

    await discordAPIRequest(`/channels/${ticket.channelId}/messages/${targetMessage.id}`, 'PATCH', {
        components,
        flags: targetMessage.flags || DISCORD_COMPONENTS_V2_FLAG
    });

    return true;
}

module.exports = {
    discordAPIRequest,
    discordMultipartRequest,
    sendDiscordFileMessage,
    getActiveGuildConfig,
    toDiscordTimestamp,
    shortId,
    formatDurationWithSeconds,
    calculatePontoDurationMs,
    buildPontoStatusPayloadForDiscord,
    buildPontoLogPayloadForDiscord,
    syncPontoStatusToDiscord,
    sendPontoLogToDiscord,
    notifyPontoDiscord,
    syncTicketClaimMessage,
    sendTicketCloseLogs,
    createTicketTranscriptFromDiscord,
    deleteTicketVoiceChannelIfExists
};
