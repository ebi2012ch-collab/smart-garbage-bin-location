const mongoose = require('mongoose');
const crypto = require('crypto');

const binSchema = new mongoose.Schema({
  binCode:       { type: String, unique: true, sparse: true, default: () => `BIN-${crypto.randomBytes(4).toString('hex').toUpperCase()}` },
  name:         { type: String, required: true, trim: true },
  type:         { type: String, enum: ['bin', 'recycle', 'collection'], default: 'bin' },
  status:       { type: String, enum: ['available', 'almost-full', 'full', 'out-of-service'], default: 'available' },
  lat:          { type: Number, min: -90, max: 90, default: null },
  lng:          { type: Number, min: -180, max: 180, default: null },
  description:  { type: String, default: '' },
  zone:         { type: String, default: 'Unknown' },
  capacity:     { type: Number, default: 300 },
  fillLevel:    { type: Number, default: null, min: 0, max: 100 },
  readingSource: { type: String, enum: ['simulated', 'sensor', 'manual', null], default: null },
  lastReadingAt: { type: Date, default: null },
  operationalStatus: { type: String, enum: ['operational', 'maintenance', 'damaged'], default: 'operational' },
  collectionState: { type: String, enum: ['none', 'needed', 'assigned', 'in-progress', 'completed-awaiting-reading'], default: 'none' },
  activeCollectionTask: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionRequest', default: null },
  lastCollectionAt: { type: Date, default: null },
  lastServiced: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Bin', binSchema);
