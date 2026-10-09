const mongoose = require('mongoose');

const telegramNotificationSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['sending', 'sent', 'failed'], required: true },
  sentAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('TelegramNotification', telegramNotificationSchema);
