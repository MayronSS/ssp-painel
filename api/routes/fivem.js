/**
 * Rota de integração FiveM → Painel.
 * Recebe requisições de punch_in / punch_out do servidor de jogo.
 * Autenticação via Bearer token (PONTO_API_KEY).
 */
const express = require('express');
const router = express.Router();
const Ponto = require('../../models/Ponto');

// Token de autenticação (mesmo usado no bot)
const API_KEY = process.env.PONTO_API_KEY || 'TROCAR_POR_TOKEN_SEGURO_DO_BATE_PONTO';

/**
 * POST /api/fivem/duty
 * Body: { discord, action, job, name, grade?, citizenid? }
 */
router.post('/fivem/duty', async (req, res) => {
  try {
    // 1. Validar Token
    const authHeader = req.headers['authorization'];
    const expectedAuth = `Bearer ${API_KEY}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.warn(`[FiveM API] Tentativa de acesso não autorizada de ${req.ip}`);
      return res.status(401).json({ success: false, message: 'Não autorizado. Token inválido.' });
    }

    // 2. Validar payload
    const { discord, action, job, name, grade, citizenid } = req.body;

    if (!discord || !action || !job || !name) {
      return res.status(400).json({
        success: false,
        message: 'Campos obrigatórios ausentes. Certifique-se de enviar "discord", "action", "job" e "name".'
      });
    }

    // 3. Mapear corporação
    let corporationSlug = 'pmesp';
    let battalionSlug = null;
    const jobLower = String(job).toLowerCase();

    if (['pmesp', 'ft', 'rota', 'baep', 'bprv'].includes(jobLower)) {
      corporationSlug = 'pmesp';
      if (jobLower !== 'pmesp') {
        battalionSlug = jobLower;
      }
    } else if (jobLower === 'pcesp') {
      corporationSlug = 'pcesp';
    } else {
      console.warn(`[FiveM API] Job desconhecido: "${job}". Usando fallback pmesp.`);
    }

    // 4. Processar ação
    if (action === 'punch_in') {
      // Verificar se já tem ponto ativo
      const ativo = await Ponto.findOne({ userId: discord, status: 'aberto' });
      if (ativo) {
        return res.json({ success: true, code: 'already_open', message: 'O oficial já possui um ponto em aberto.' });
      }

      const now = new Date();
      await Ponto.create({
        corporationSlug,
        battalionSlug,
        userId: discord,
        username: name,
        entrada: now,
        status: 'aberto',
      });

      console.log(`[FiveM API] Ponto aberto para ${name} (Discord: ${discord}, Job: ${job})`);
      return res.json({ success: true, code: 'success', message: 'Ponto iniciado com sucesso via jogo.' });

    } else if (action === 'punch_out') {
      // Buscar ponto ativo
      const ativo = await Ponto.findOne({ userId: discord, status: 'aberto' });
      if (!ativo) {
        return res.json({ success: true, code: 'already_closed', message: 'Nenhum ponto em aberto localizado para este oficial.' });
      }

      const now = new Date();
      const durationMs = now.getTime() - ativo.entrada.getTime();

      ativo.saida = now;
      ativo.status = 'fechado';
      ativo.durationMs = durationMs;
      ativo.username = name || ativo.username;
      await ativo.save();

      const totalSeconds = Math.floor(durationMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const timeStr = `${hours}h ${minutes}m ${seconds}s`;

      console.log(`[FiveM API] Ponto fechado para ${name} (Discord: ${discord}, Duração: ${timeStr})`);
      return res.json({ success: true, code: 'success', message: `Ponto encerrado via jogo! Ativo por ${timeStr}.`, durationMs });

    } else {
      return res.status(400).json({ success: false, message: 'Ação inválida. Use "punch_in" ou "punch_out".' });
    }

  } catch (error) {
    console.error('[FiveM API] Erro ao processar requisição:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
});

/**
 * GET /api/fivem/health
 * Health check público para o FiveM verificar se a API está acessível.
 */
router.get('/fivem/health', (req, res) => {
  return res.json({ success: true, service: 'SSP Painel — FiveM Integration API', timestamp: new Date().toISOString() });
});

module.exports = router;
