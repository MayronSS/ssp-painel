const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config();

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoStore = require('connect-mongo');
// Importar rotas modularizadas
const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const cidadaosRouter = require('./routes/cidadaos');
const solicitacoesRouter = require('./routes/solicitacoes');
const pontoRouter = require('./routes/ponto');
const ticketsRouter = require('./routes/tickets');
const corregedoriaRouter = require('./routes/corregedoria');
const transcriptsRouter = require('./routes/transcripts');
const configRouter = require('./routes/config');
const logsRouter = require('./routes/logs');
const ausenciasRouter = require('./routes/ausencias');
const warningsRouter = require('./routes/warnings');
const officersRouter = require('./routes/officers');
const notificationsRouter = require('./routes/notifications');
const academyRouter = require('./routes/academy');

const { requireAuth } = require('./middlewares/auth');

if (!process.env.MONGO_URI) {
  console.error('\nERRO CRÍTICO: MONGO_URI não foi encontrada nas variáveis de ambiente.');
}

const app = express();

// Confia no proxy (necessário para cookies seguros em Vercel/proxies reversos)
app.set('trust proxy', 1);

// Promessa de conexão do MongoDB
const clientPromise = mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  })
  .then((connection) => {
    console.log('LOG: Conexão com MongoDB estabelecida com sucesso.');
    return connection.connection.getClient();
  })
  .catch((error) => {
    console.error('LOG: Erro fatal ao conectar ao MongoDB:', error);
    process.exit(1);
  });

// Configuração do CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
);

// Configuração de Segurança de Cabeçalhos
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: '2mb' }));

// Rate Limit para rotas gerais da API
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Configuração de Sessão Segura
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'lspd-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      clientPromise: clientPromise,
      collectionName: 'sessions',
      ttl: 24 * 60 * 60 // 1 Dia de expiração
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production' && !process.env.DASHBOARD_URL?.includes('localhost'),
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 1 Dia de validade
    }
  })
);

// --- Rota de Healthcheck (Pública) ---
app.get('/api/health', async (req, res) => {
  return res.json({
    success: true,
    service: 'Painel Operacional LSPD API (Unified)',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// --- Registro de Rotas ---

// Rotas de Autenticação (Algumas públicas, como login e callback)
app.use('/api', authRouter);

// Rotas Protegidas (Exigem autenticação ativa)
app.use('/api', requireAuth, dashboardRouter);
app.use('/api', requireAuth, cidadaosRouter);
app.use('/api', requireAuth, solicitacoesRouter);
app.use('/api', requireAuth, pontoRouter);
app.use('/api', requireAuth, ticketsRouter);
app.use('/api', requireAuth, corregedoriaRouter);
app.use('/api', requireAuth, transcriptsRouter);
app.use('/api', requireAuth, configRouter);
app.use('/api', requireAuth, logsRouter);
app.use('/api', requireAuth, ausenciasRouter);
app.use('/api', requireAuth, warningsRouter);
app.use('/api', requireAuth, officersRouter);
app.use('/api', requireAuth, notificationsRouter);
app.use('/api', requireAuth, academyRouter);

const handler = async (req, res) => {
  try {
    await clientPromise;
    return app(req, res);
  } catch (error) {
    console.error('Erro crítico na inicialização da API:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro crítico na inicialização da API.',
    });
  }
};

module.exports = handler;
