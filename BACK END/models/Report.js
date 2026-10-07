const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  refId:       { type: String, unique: true },
  fullName:    { type: String, required: true, trim: true },
  phone:       { type: String, required: true, trim: true },
  location:    { type: String, required: true, trim: true },
  latitude:    { type: Number, min: -90, max: 90, default: null },
  longitude:   { type: Number, min: -180, max: 180, default: null },
  problemType: { type: String, enum: ['overflow','illegal','damaged','missing','smell','other'], required: true },
  priority:    { type: String, enum: ['low','medium','high','urgent'], default: 'medium' },
  description: { type: String, required: true, trim: true },
  photoUrl:    { type: String, default: null },
  status:      { type: String, enum: ['pending','in-progress','resolved','dismissed'], default: 'pending' },
  resolvedAt:  { type: Date, default: null },
  resolutionNote: { type: String, trim: true, maxlength: 1000, default: '' },
  rejectionReason: { type: String, trim: true, maxlength: 1000, default: '' },
  assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedAt: { type: Date, default: null },
  assignmentHistory: [{
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    driverName: { type: String, required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
  }],
  workNotes: { type: String, trim: true, maxlength: 2000, default: '' },
  workEvidenceUrl: { type: String, default: null },
  workSubmittedAt: { type: Date, default: null },
  workSubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  archivedAt:  { type: Date, default: null },
}, { timestamps: true });

// Auto-generate refId before saving (Mongoose v7+ — no next parameter)
reportSchema.pre('save', function () {
  if (!this.refId) {
    var year = new Date().getFullYear();
    var num  = Math.floor(Math.random() * 9000) + 1000;
    this.refId = 'RPT-' + year + '-' + num;
  }
});

module.exports = mongoose.model('Report', reportSchema);
