const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[DB] ERROR: MONGO_URI is not set in your .env file!');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('[DB] Connected to MongoDB successfully');
  } catch (err) {
    console.error('[DB] MongoDB connection failed:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] MongoDB disconnected');
  });
}

module.exports = connectDB;
