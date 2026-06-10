const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://simone:123@policia.dek7t83.mongodb.net/?appName=policia";

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB.");
    
    // We register the Corporation schema to query it
    const Corporation = mongoose.models.Corporation || mongoose.model('Corporation', new mongoose.Schema({
      guildId: String,
      slug: String,
      name: String,
      shortName: String,
      type: String,
      roles: mongoose.Schema.Types.Mixed,
      channels: mongoose.Schema.Types.Mixed,
      active: Boolean
    }, { strict: false }));

    const corps = await Corporation.find({ guildId: "1334721407925489778", type: "primary" });
    console.log("Corporations found:", JSON.stringify(corps, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
