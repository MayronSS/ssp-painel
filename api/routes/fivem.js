/**
 * Rota de integração FiveM → Painel → Discord.
 * Recebe requisições de punch_in / punch_out do servidor de jogo.
 * Salva no MongoDB E envia mensagens diretamente no Discord via REST API.
 * Autenticação via Bearer token (PONTO_API_KEY).
 */
const express = require('express');
const router = express.Router();
const https = require('https');
const Ponto = require('../../models/Ponto');
const { registrarAuditLog } = require('../utils/helpers');

// Configurações
const API_KEY = process.env.PONTO_API_KEY || 'TROCAR_POR_TOKEN_SEGURO_DO_BATE_PONTO';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_PONTO_PANEL = process.env.CHANNEL_PONTO_PANEL;

// Canais de log por corporação
const LOG_CHANNELS = {
  pmesp: process.env.CHANNEL_PONTO_LOGS_PMESP || '1510831185432150136',
  pcesp: process.env.CHANNEL_PONTO_LOGS_PCESP || '1510831189903147171',
};

// ==========================================
// Discord REST API Helper
// ==========================================

/**
 * Envia uma requisição para a API REST do Discord.
 */
function discordApiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    if (!DISCORD_TOKEN) {
      return reject(new Error('DISCORD_TOKEN não configurado'));
    }

    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10${path}`,
      method,
      headers: {
        'Authorization': `Bot ${DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SSP-Painel-FiveM/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            console.error(`[Discord API] ${method} ${path} → ${res.statusCode}:`, data.substring(0, 300));
            resolve(null); // Não rejeitar para não travar o fluxo
          }
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[Discord API] Erro de rede:`, err.message);
      resolve(null); // Não travar o fluxo
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error('Timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Envia uma mensagem em um canal do Discord.
 */
async function sendDiscordMessage(channelId, payload) {
  if (!channelId || !DISCORD_TOKEN) return null;
  return discordApiRequest('POST', `/channels/${channelId}/messages`, payload);
}

/**
 * Busca mensagens recentes de um canal.
 */
async function fetchChannelMessages(channelId, limit = 20) {
  if (!channelId || !DISCORD_TOKEN) return [];
  const result = await discordApiRequest('GET', `/channels/${channelId}/messages?limit=${limit}`);
  return result || [];
}

/**
 * Edita uma mensagem existente.
 */
async function editDiscordMessage(channelId, messageId, payload) {
  if (!channelId || !messageId || !DISCORD_TOKEN) return null;
  return discordApiRequest('PATCH', `/channels/${channelId}/messages/${messageId}`, payload);
}

// ==========================================
// Formatadores
// ==========================================

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
}

function toDiscordTimestamp(date, style = 'F') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

// ==========================================
// Construir embeds para o Discord
// ==========================================

function buildLogEmbed({ type, userId, username, ponto, durationMs }) {
  const isEntrada = type === 'entrada';
  const color = isEntrada ? 0x2ecc71 : 0xe74c3c; // verde / vermelho

  const fields = [
    { name: '👤 Oficial', value: `<@${userId}>`, inline: true },
    { name: '🪪 Nome', value: username, inline: true },
    { name: '🏢 Corporação', value: (ponto.corporationSlug || 'pmesp').toUpperCase(), inline: true },
    { name: '📅 Entrada', value: toDiscordTimestamp(ponto.entrada, 'F'), inline: false },
  ];

  if (!isEntrada && ponto.saida) {
    fields.push({ name: '📅 Saída', value: toDiscordTimestamp(ponto.saida, 'F'), inline: false });
    if (durationMs != null) {
      fields.push({ name: '⏱️ Duração', value: `\`${formatDuration(durationMs)}\``, inline: true });
    }
  }

  fields.push({ name: '🔖 Registro', value: `\`${ponto._id.toString()}\``, inline: false });

  return {
    embeds: [{
      title: isEntrada ? '🟢 Entrada em Serviço (FiveM)' : '🔴 Saída de Serviço (FiveM)',
      color,
      fields,
      footer: { text: 'SSP • Bate-Ponto via Integração FiveM' },
      timestamp: new Date().toISOString()
    }]
  };
}

/**
 * Constrói o embed de status dos oficiais em serviço.
 */
async function buildStatusEmbed() {
  const ativos = await Ponto.find({ status: 'aberto' }).sort({ entrada: 1 }).lean();

  let description;
  if (ativos.length === 0) {
    description = '*Nenhum oficial em patrulhamento no momento.*';
  } else {
    const lines = ativos.map(p => {
      const durationMs = Date.now() - new Date(p.entrada).getTime();
      return `👤 <@${p.userId}> — Em patrulha há **${formatDuration(durationMs)}**`;
    });
    description = lines.join('\n');
  }

  return {
    embeds: [{
      title: '📋 Oficiais em Serviço',
      description,
      color: 0x2b2d31,
      footer: { text: `SSP • ${ativos.length} oficial(is) ativo(s)` },
      timestamp: new Date().toISOString()
    }]
  };
}

/**
 * Atualiza a mensagem de status no canal de ponto.
 * Procura por uma mensagem existente do bot e edita, ou cria nova.
 */
async function updatePanelStatus() {
  if (!CHANNEL_PONTO_PANEL || !DISCORD_TOKEN) return;

  try {
    // Buscar mensagens recentes do canal
    const messages = await fetchChannelMessages(CHANNEL_PONTO_PANEL, 30);
    if (!Array.isArray(messages)) return;

    // Buscar o ID do bot
    const me = await discordApiRequest('GET', '/users/@me');
    if (!me) return;
    const botId = me.id;

    // Procurar mensagem de status existente (embed com título "Oficiais em Serviço" ou "Registro de Baixa")
    const statusMsg = messages.find(m => 
      m.author?.id === botId && 
      m.embeds?.some(e => 
        (e.title && (e.title.includes('Oficiais em Serviço') || e.title.includes('Registro de Baixa')))
      )
    );

    const statusPayload = await buildStatusEmbed();

    if (statusMsg) {
      await editDiscordMessage(CHANNEL_PONTO_PANEL, statusMsg.id, statusPayload);
      console.log('[FiveM API] Painel de status do Discord atualizado.');
    } else {
      // Não criar nova mensagem de status — deixar o bot criar quando iniciar
      console.log('[FiveM API] Mensagem de status não encontrada. O bot criará na próxima inicialização.');
    }
  } catch (err) {
    console.error('[FiveM API] Erro ao atualizar painel de status:', err.message);
  }
}

// ==========================================
// Rota Principal
// ==========================================

/**
 * POST /api/fivem/duty
 * Body: { discord, action, job, name, grade?, citizenid? }
 */
router.post('/fivem/duty', async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const authHeader = req.headers['authorization'];
    
    // Log the incoming request details for debugging
    await registrarAuditLog(
      'sistema',
      'Integração FiveM - Chamada recebida',
      `Chamada do IP ${ip} para /api/fivem/duty. Action: ${req.body?.action || 'N/A'}, Job: ${req.body?.job || 'N/A'}, Name: ${req.body?.name || 'N/A'}`,
      req.body?.discord || 'fivem',
      req.body?.name || 'FiveM Server',
      { body: req.body, hasAuth: !!authHeader }
    ).catch(() => {});

    // 1. Validar Token
    const expectedAuth = `Bearer ${API_KEY}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.warn(`[FiveM API] Tentativa de acesso não autorizada de ${ip}`);
      await registrarAuditLog(
        'sistema',
        'Integração FiveM - Token Inválido',
        `Tentativa de acesso não autorizada de ${ip}. Recebido: ${authHeader || 'Nenhum'}, Esperado: Bearer ${API_KEY.slice(0, 5)}...`,
        req.body?.discord || 'fivem',
        req.body?.name || 'FiveM Server'
      ).catch(() => {});
      return res.status(401).json({ success: false, message: 'Não autorizado. Token inválido.' });
    }

    // 2. Validar payload
    const { discord: rawDiscord, action, job, name } = req.body;
    const discord = rawDiscord ? String(rawDiscord).replace(/\D/g, '') : null;

    if (action !== 'punch_out_all' && (!discord || !action || !job || !name)) {
      await registrarAuditLog(
        'sistema',
        'Integração FiveM - Payload Inválido',
        `Campos obrigatórios ausentes. Recebido: ${JSON.stringify(req.body)}`,
        discord || 'fivem',
        name || 'FiveM Server'
      ).catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'Campos obrigatórios ausentes. Certifique-se de enviar "discord", "action", "job" e "name".'
      });
    }

    // 3. Mapear corporação
    let corporationSlug = 'pmesp';
    let battalionSlug = null;
    if (action !== 'punch_out_all') {
      const jobLower = String(job).toLowerCase();

      if (['pmesp', 'ft', 'rota', 'baep', 'bprv'].includes(jobLower)) {
        corporationSlug = 'pmesp';
        if (jobLower !== 'pmesp') battalionSlug = jobLower;
      } else if (jobLower === 'pcesp') {
        corporationSlug = 'pcesp';
      } else {
        console.warn(`[FiveM API] Job desconhecido: "${job}". Usando fallback pmesp.`);
      }
    }

    // 4. Processar ação
    if (action === 'punch_in') {
      const ativo = await Ponto.findOne({ userId: discord, status: 'aberto' });
      if (ativo) {
        return res.json({ success: true, code: 'already_open', message: 'O oficial já possui um ponto em aberto.' });
      }

      const now = new Date();
      const pontoCriado = await Ponto.create({
        corporationSlug,
        battalionSlug,
        userId: discord,
        username: name,
        entrada: now,
        status: 'aberto',
      });

      console.log(`[FiveM API] Ponto aberto para ${name} (Discord: ${discord}, Job: ${job})`);

      // Enviar log no Discord e atualizar painel (async, não bloqueia resposta)
      setImmediate(async () => {
        try {
          // Log de entrada
          const logChannel = LOG_CHANNELS[corporationSlug] || LOG_CHANNELS.pmesp;
          if (logChannel) {
            await sendDiscordMessage(logChannel, buildLogEmbed({
              type: 'entrada', userId: discord, username: name, ponto: pontoCriado
            }));
          }
          // Atualizar painel de status
          await updatePanelStatus();
        } catch (err) {
          console.error('[FiveM API] Erro ao enviar notificação Discord:', err.message);
        }
      });

      return res.json({ success: true, code: 'success', message: 'Ponto iniciado com sucesso via jogo.' });

    } else if (action === 'punch_out') {
      const ativo = await Ponto.findOne({ userId: discord, status: 'aberto' });
      if (!ativo) {
        return res.json({ success: true, code: 'already_closed', message: 'Nenhum ponto em aberto localizado.' });
      }

      const now = new Date();
      const durationMs = now.getTime() - ativo.entrada.getTime();

      ativo.saida = now;
      ativo.status = 'fechado';
      ativo.durationMs = durationMs;
      ativo.username = name || ativo.username;
      await ativo.save();

      const timeStr = formatDuration(durationMs);
      console.log(`[FiveM API] Ponto fechado para ${name} (Discord: ${discord}, Duração: ${timeStr})`);

      // Enviar log no Discord e atualizar painel (async, não bloqueia resposta)
      setImmediate(async () => {
        try {
          // Log de saída
          const logChannel = LOG_CHANNELS[corporationSlug] || LOG_CHANNELS.pmesp;
          if (logChannel) {
            await sendDiscordMessage(logChannel, buildLogEmbed({
              type: 'saida', userId: discord, username: name, ponto: ativo, durationMs
            }));
          }
          // Atualizar painel de status
          await updatePanelStatus();
        } catch (err) {
          console.error('[FiveM API] Erro ao enviar notificação Discord:', err.message);
        }
      });

      return res.json({ success: true, code: 'success', message: `Ponto encerrado via jogo! Ativo por ${timeStr}.`, durationMs });

    } else if (action === 'punch_out_all') {
      const ativos = await Ponto.find({ status: 'aberto' });
      const now = new Date();

      for (const ativo of ativos) {
        const durationMs = now.getTime() - new Date(ativo.entrada).getTime();
        ativo.saida = now;
        ativo.status = 'fechado';
        ativo.durationMs = durationMs;
        await ativo.save();

        // Log no Discord (async)
        setImmediate(async () => {
          try {
            const logChannel = LOG_CHANNELS[ativo.corporationSlug || 'pmesp'] || LOG_CHANNELS.pmesp;
            if (logChannel) {
              await sendDiscordMessage(logChannel, buildLogEmbed({
                type: 'saida', 
                userId: ativo.userId, 
                username: ativo.username, 
                ponto: ativo, 
                durationMs
              }));
            }
          } catch (err) {
            console.error('[FiveM API] Erro ao enviar notificação de saída em massa:', err.message);
          }
        });
      }

      await updatePanelStatus();

      return res.json({ 
        success: true, 
        code: 'success', 
        message: `Todos os ${ativos.length} pontos abertos foram encerrados via reinício do jogo.` 
      });

    } else {
      return res.status(400).json({ success: false, message: 'Ação inválida. Use "punch_in", "punch_out" ou "punch_out_all".' });
    }

  } catch (error) {
    console.error('[FiveM API] Erro ao processar requisição:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
});

/**
 * GET /api/fivem/health
 */
router.get('/fivem/health', (req, res) => {
  return res.json({ 
    success: true, 
    service: 'SSP Painel — FiveM Integration API',
    discord: DISCORD_TOKEN ? 'configured' : 'missing',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
