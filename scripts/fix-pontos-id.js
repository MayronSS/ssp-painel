require('dotenv').config();

const mongoose = require('mongoose');
const Registro = require('../models/Registro.js');

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI não encontrada no .env.');
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const registros = await Registro.find();
  let documentosCorrigidos = 0;
  let pontosCorrigidos = 0;

  for (const registro of registros) {
    let alterado = false;

    const pontosCorrigidosDoRegistro = (registro.pontos || []).map((ponto) => {
      const pontoObj = ponto.toObject ? ponto.toObject() : { ...ponto };

      if (!pontoObj._id) {
        pontoObj._id = new mongoose.Types.ObjectId();
        alterado = true;
        pontosCorrigidos += 1;
      }

      return pontoObj;
    });

    if (alterado) {
      registro.pontos = pontosCorrigidosDoRegistro;
      await registro.save({ validateBeforeSave: false });
      documentosCorrigidos += 1;
      console.log(`Corrigido: ${registro.username} (${registro.userId})`);
    }
  }

  console.log('Migração finalizada.');
  console.log(`Documentos corrigidos: ${documentosCorrigidos}`);
  console.log(`Pontos corrigidos: ${pontosCorrigidos}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Erro na migração:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
