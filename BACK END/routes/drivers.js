const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Report = require('../models/Report');
const CollectionRequest = require('../models/CollectionRequest');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', async (_req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' })
      .select('username displayName createdAt')
      .sort({ displayName: 1, username: 1 });
    const activeReportCounts = await Report.aggregate([
      { $match: { archivedAt: null, assignedDriver: { $ne: null }, status: { $in: ['pending', 'in-progress'] } } },
      { $group: { _id: '$assignedDriver', count: { $sum: 1 } } },
    ]);
    const activeCollectionCounts = await CollectionRequest.aggregate([
      { $match: { assignedDriver: { $ne: null }, status: { $in: ['assigned', 'in-progress'] } } },
      { $group: { _id: '$assignedDriver', count: { $sum: 1 } } },
    ]);
    const workloads = {};
    activeReportCounts.concat(activeCollectionCounts).forEach(item => { workloads[String(item._id)] = (workloads[String(item._id)] || 0) + item.count; });
    res.json({
      success: true,
      count: drivers.length,
      data: drivers.map(driver => ({
        id: driver._id,
        username: driver.username,
        displayName: driver.displayName || driver.username,
        createdAt: driver.createdAt,
        activeAssignments: workloads[String(driver._id)] || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, password, displayName } = req.body || {};
    if (typeof username !== 'string' || !username.trim() ||
        typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Username and a password of at least 8 characters are required.',
      });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const normalizedDisplayName = typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : username.trim();
    if (normalizedUsername.length > 120 || normalizedDisplayName.length > 120) {
      return res.status(400).json({ success: false, message: 'Username and display name must be 120 characters or fewer.' });
    }

    const driver = await User.create({
      username: normalizedUsername,
      displayName: normalizedDisplayName,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'driver',
    });
    res.status(201).json({
      success: true,
      message: 'Driver account created.',
      data: {
        id: driver._id,
        username: driver.username,
        displayName: driver.displayName,
        createdAt: driver.createdAt,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'That username is already in use.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
