require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Bin = require('../models/Bin');

async function registerWokwiBin() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in BACK END/.env.');
  await mongoose.connect(process.env.MONGO_URI);

  let bin = await Bin.findOne({ binCode: 'BIN-001', type: 'bin' });
  if (!bin) {
    bin = await Bin.findOne({ name: 'Adama Central Bin', type: 'bin' });
    if (bin) {
      bin.binCode = 'BIN-001';
      await bin.save();
    } else {
      bin = await Bin.create({
        binCode: 'BIN-001',
        name: 'Adama Central Bin',
        type: 'bin',
        zone: 'Central',
        lat: 8.54,
        lng: 39.27,
        description: 'Central city garbage point. Wokwi sensor simulation.',
        capacity: 500,
        fillLevel: 0,
      });
    }
  }

  console.log(`[Wokwi] BIN-001 is registered as ${bin.name} (${bin._id}). Existing fill and collection state were preserved.`);
}

registerWokwiBin()
  .catch(err => {
    console.error('[Wokwi] Could not register BIN-001:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
