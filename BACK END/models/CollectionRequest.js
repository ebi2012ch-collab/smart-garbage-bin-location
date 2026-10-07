const crypto = require('crypto');
const mongoose = require('mongoose');

const collectionRequestSchema = new mongoose.Schema({
  refId:      { type: String, unique: true, immutable: true },
  fullName:   { type: String, required: true, trim: true, maxlength: 120 },
  phone:      { type: String, required: true, trim: true, maxlength: 40 },
  location:   { type: String, required: true, trim: true, maxlength: 200 },
  latitude:   { type: Number, min: -90, max: 90, default: null },
  longitude:  { type: Number, min: -180, max: 180, default: null },
  description:{ type: String, required: true, trim: true, maxlength: 1000 },
  status:     {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'assigned', 'in-progress', 'completed'],
    default: 'pending',
  },
  assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedAt:     { type: Date, default: null },
  completedAt:    { type: Date, default: null },
  source:         { type: String, enum: ['citizen', 'bin'], default: 'citizen' },
  binId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Bin', default: null },
  activeBinId:    { type: mongoose.Schema.Types.ObjectId, unique: true, sparse: true },
  binCode:        { type: String, default: null },
  binName:        { type: String, default: null },
  fillLevelAtAssignment: { type: Number, min: 0, max: 100, default: null },
  readingSourceAtAssignment: { type: String, enum: ['simulated', 'sensor', 'manual', null], default: null },
  readingAtAssignment: { type: Date, default: null },
}, { timestamps: true });

collectionRequestSchema.pre('save', function () {
  if (!this.refId) {
    const year = new Date().getFullYear();
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    this.refId = `CRQ-${year}-${id}`;
  }
});

module.exports = mongoose.model('CollectionRequest', collectionRequestSchema);
