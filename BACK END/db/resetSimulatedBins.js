/**
 * resetSimulatedBins.js
 * Clears stale simulated fill levels on bins that:
 *   - have readingSource !== 'sensor'  (never had a real/simulated sensor)
 *   - have no active collection task
 *   - are operational
 *
 * This lets the software simulator start those bins fresh from 0%.
 * Bins with active tasks or real sensor data are left completely untouched.
 *
 * Usage:  node db/resetSimulatedBins.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto   = require('crypto');
const mongoose = require('mongoose');
const Bin      = require('../models/Bin');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const result = await Bin.updateMany(
    {
      type:               'bin',
      readingSource:      { $in: ['simulated', 'manual', null] },
      activeCollectionTask: { $exists: false },
      $or: [
        { activeCollectionTask: null },
        { activeCollectionTask: { $exists: false } },
      ],
    },
    {
      $set: {
        fillLevel:      0,
        readingSource:  null,
        lastReadingAt:  null,
        collectionState: 'none',
        sensorSequence: 0,
        sensorCycleId:  null,   // sensor-state will assign a fresh one on first poll
      },
    }
  );

  console.log(`[resetSimulatedBins] Reset ${result.modifiedCount} bin(s) to 0% (no active tasks affected).`);
  await mongoose.disconnect();
}

run()
  .catch(err => { console.error('[resetSimulatedBins] Error:', err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
