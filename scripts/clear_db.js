const mongoose = require('mongoose');
const dns = require('dns');
// Set custom DNS to ensure lookup on Windows machines works with Atlas SRV URIs
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const uri = process.env.MONGO_URI;

if (!uri) {
  console.error('Erro: MONGO_URI não está definida no arquivo .env');
  process.exit(1);
}

const collectionsToClear = [
  'suggestions',
  'internalrequests',
  'usuarios',
  'notifications',
  'lspdcandidaturas',
  'tickets',
  'academycourses',
  'editalconfirmacaos',
  'lspdcadastros',
  'exoneracaos',
  'blacklists',
  'lspdcorregedorias',
  'members',
  'corregedoriacases',
  'pontos',
  'auditlogs',
  'lspdausencias',
  'sessions',
  'transferencias',
  'disciplinarywarnings',
  'academyenrollments',
  'lspdtranscripts'
];

async function run() {
  console.log('Conectando ao MongoDB...');
  await mongoose.connect(uri);
  console.log('Conectado!');

  console.log('\n--- Realizando Limpeza do Banco de Dados ---');

  for (const colName of collectionsToClear) {
    try {
      const collection = mongoose.connection.db.collection(colName);
      const countBefore = await collection.countDocuments();
      if (countBefore > 0) {
        console.log(`Limpando coleção: ${colName} (${countBefore} documentos)...`);
        const result = await collection.deleteMany({});
        console.log(`Coleção ${colName} limpa! Deletados: ${result.deletedCount}`);
      } else {
        console.log(`Coleção ${colName} já está vazia.`);
      }
    } catch (err) {
      console.error(`Erro ao limpar coleção ${colName}:`, err.message);
    }
  }

  console.log('\n--- Verificando coleções preservadas ---');
  const preserved = ['guildconfigs', 'corporations'];
  for (const colName of preserved) {
    try {
      const collection = mongoose.connection.db.collection(colName);
      const count = await collection.countDocuments();
      console.log(`Coleção PRESERVADA: ${colName} - Documentos restantes: ${count}`);
    } catch (err) {
      console.error(`Erro ao checar coleção ${colName}:`, err.message);
    }
  }

  await mongoose.disconnect();
  console.log('\nProcesso de limpeza concluído com sucesso!');
}

run().catch(console.error);
