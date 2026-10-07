const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, trim: true, lowercase: true },
  displayName:  { type: String, trim: true, maxlength: 120 },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['admin', 'staff', 'driver'], default: 'admin' },
}, { timestamps: true });

// Compare password helper
userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
