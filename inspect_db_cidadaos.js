const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const dns = require('dns');

dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://simone:123@policia.dek7t83.mongodb.net/?appName=policia";
console.log("Connecting to:", MONGO_URI);

const LspdCadastro = require('./models/LspdCadastro');

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB.");
    const count = await LspdCadastro.countDocuments();
    console.log("Total records in LspdCadastro:", count);
    const docs = await LspdCadastro.find({}).limit(5).lean();
    console.log("First 5 records:", docs);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
