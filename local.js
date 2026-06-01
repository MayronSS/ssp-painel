const express = require('express');
const path = require('path');
const handler = require('./api/index.js');

const server = express();
const PORT = process.env.PORT || 3000;

// API routes are forwarded to Vercel handler
server.all('/api/*', (req, res) => {
  handler(req, res);
});

// Static assets from public folder
server.use(express.static(path.join(__dirname, 'public')));

// Any other requests serve index.html (fallback for single-page app router)
server.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(` Painel LSPD iniciado com sucesso!`);
  console.log(` Acesse em: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
