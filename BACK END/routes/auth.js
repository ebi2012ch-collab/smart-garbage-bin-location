/* ================================================================
   SmartBin — Auth Routes (MongoDB / Mongoose)
   POST /api/auth/login   → returns JWT
   GET  /api/auth/me      → current user info
   POST /api/auth/logout  → client drops token
   ================================================================ */

const express        = require('express');
const jwt            = require('jsonwebtoken');
const User           = require('../models/User');
const { requireAuth} = require('../middleware/auth');

const router = express.Router();

/* ── POST /api/auth/login ──────────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { username, password, role } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    if (role && !['admin', 'driver'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Choose Admin or Driver to sign in.' });
    }

    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    if (role && user.role !== role) {
      return res.status(403).json({
        success: false,
        message: `This account is not authorized for the ${role} login.`,
      });
    }
    if (!['admin', 'driver'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'This account cannot access an internal dashboard.' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, displayName: user.displayName || user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: { id: user._id, username: user.username, displayName: user.displayName || user.username, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/auth/me ───────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

/* ── POST /api/auth/logout ─────────────────────────────────── */
router.post('/logout', requireAuth, (req, res) => {
  res.json({ success: true, message: 'Logged out. Delete the token on the client.' });
});

module.exports = router;
