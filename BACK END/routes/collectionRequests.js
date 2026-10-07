const express = require('express');
const CollectionRequest = require('../models/CollectionRequest');
const Bin = require('../models/Bin');
const { conditionFor } = require('../utils/binCondition');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const REQUEST_STATUSES = ['pending', 'accepted', 'rejected', 'assigned', 'in-progress', 'completed'];

function requestFilter(id) {
  return /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { refId: id };
}

// Create and assign a collection task directly from a bin. The sparse unique
// activeBinId index is the concurrency-safe duplicate-task guard.
router.post('/from-bin', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { binId, driverId } = req.body || {};
    if (typeof binId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(binId) || typeof driverId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(driverId)) {
      return res.status(400).json({ success: false, message: 'A valid bin and driver are required.' });
    }
    const [bin, driver] = await Promise.all([
      Bin.findById(binId),
      require('../models/User').findOne({ _id: driverId, role: 'driver' }).select('_id username displayName'),
    ]);
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    if (!driver) return res.status(404).json({ success: false, message: 'Eligible driver not found.' });
    if (bin.type !== 'bin') return res.status(400).json({ success: false, message: 'Only garbage bins can be assigned for collection.' });
    if (bin.operationalStatus !== 'operational') return res.status(409).json({ success: false, message: `Bin is ${bin.operationalStatus}; resolve its operational condition first.` });
    if (conditionFor(bin.fillLevel, bin.lastReadingAt, bin.lastCollectionAt) !== 'collection-needed') return res.status(409).json({ success: false, message: 'A fresh collection-needed reading after the last collection is required.' });
    if (bin.activeCollectionTask) return res.status(409).json({ success: false, message: 'This bin already has an active collection task.' });

    const coordinates = { latitude: bin.lat == null ? null : bin.lat, longitude: bin.lng == null ? null : bin.lng };
    const task = await CollectionRequest.create({
      source: 'bin', binId: bin._id, activeBinId: bin._id,
      binCode: bin.binCode || String(bin._id), binName: bin.name,
      fillLevelAtAssignment: bin.fillLevel, readingSourceAtAssignment: bin.readingSource,
      readingAtAssignment: bin.lastReadingAt,
      fullName: 'SmartBin collection', phone: 'N/A',
      location: [bin.name, bin.zone].filter(Boolean).join(' — '), ...coordinates,
      description: `Collect garbage from bin ${bin.binCode || bin._id}. Fill at assignment: ${bin.fillLevel}%.`,
      status: 'assigned', assignedDriver: driver._id, assignedAt: new Date(),
    });
    await Bin.updateOne({ _id: bin._id }, { $set: { activeCollectionTask: task._id, collectionState: 'assigned' } });
    const result = await CollectionRequest.findById(task._id).populate('assignedDriver', 'username displayName');
    res.status(201).json({ success: true, message: 'Bin collection task assigned.', data: result });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'This bin already has an active collection task.' });
    res.status(500).json({ success: false, message: 'Could not create collection task.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { fullName, phone, location, latitude, longitude, description } = req.body || {};
    if (![fullName, phone, location, description].every(value => typeof value === 'string' && value.trim())) {
      return res.status(400).json({
        success: false,
        message: 'fullName, phone, location, and description are required.',
      });
    }

    const hasLatitude = latitude !== undefined && latitude !== null && latitude !== '';
    const hasLongitude = longitude !== undefined && longitude !== null && longitude !== '';
    if (!hasLatitude && !hasLongitude) {
      return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
    }
    if (hasLatitude !== hasLongitude) {
      return res.status(400).json({ success: false, message: 'latitude and longitude must be provided together.' });
    }

    if (fullName.trim().length > 120 || phone.trim().length > 40 ||
        location.trim().length > 200 || description.trim().length > 1000) {
      return res.status(400).json({ success: false, message: 'One or more request fields exceed the maximum length.' });
    }

    let coordinates = { latitude: null, longitude: null };
    if (hasLatitude) {
      if (!['number', 'string'].includes(typeof latitude) || !['number', 'string'].includes(typeof longitude)) {
        return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
      }
      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);
      if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90 ||
          !Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
        return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
      }
      coordinates = { latitude: parsedLatitude, longitude: parsedLongitude };
    }

    const collectionRequest = await CollectionRequest.create({
      fullName: fullName.trim(),
      phone: phone.trim(),
      location: location.trim(),
      ...coordinates,
      description: description.trim(),
    });

    res.status(201).json({
      success: true,
      message: 'Collection request submitted.',
      data: { ...collectionRequest.toObject(), id: collectionRequest.refId },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      if (!REQUEST_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${REQUEST_STATUSES.join(', ')}`,
        });
      }
      filter.status = req.query.status;
    }

    const requests = await CollectionRequest.find(filter)
      .populate('assignedDriver', 'username displayName')
      .sort({ createdAt: -1 });
    res.json({ success: true, count: requests.length, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Only pending requests can be accepted or rejected.',
      });
    }

    const filter = requestFilter(req.params.id);
    const updatedRequest = await CollectionRequest.findOneAndUpdate(
      { ...filter, status: 'pending' },
      { status },
      { returnDocument: 'after', runValidators: true }
    );

    if (updatedRequest) {
      return res.json({ success: true, message: `Request ${status}.`, data: updatedRequest });
    }

    const existingRequest = await CollectionRequest.findOne(filter);
    if (!existingRequest) {
      return res.status(404).json({ success: false, message: 'Collection request not found.' });
    }
    res.status(409).json({
      success: false,
      message: `Request cannot be changed from ${existingRequest.status}.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/:id/assign', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { driverId } = req.body || {};
    if (typeof driverId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(driverId)) {
      return res.status(400).json({ success: false, message: 'A valid driver must be selected.' });
    }

    const User = require('../models/User');
    const driver = await User.findOne({ _id: driverId, role: 'driver' }).select('_id username displayName');
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found.' });
    }

    const request = await CollectionRequest.findOneAndUpdate(
      { ...requestFilter(req.params.id), status: 'accepted', assignedDriver: null },
      { $set: { status: 'assigned', assignedDriver: driver._id, assignedAt: new Date() } },
      { returnDocument: 'after', runValidators: true }
    ).populate('assignedDriver', 'username displayName');

    if (request) {
      return res.json({ success: true, message: 'Driver assigned.', data: request });
    }

    const existingRequest = await CollectionRequest.findOne(requestFilter(req.params.id));
    if (!existingRequest) {
      return res.status(404).json({ success: false, message: 'Collection request not found.' });
    }
    res.status(409).json({
      success: false,
      message: `A driver can only be assigned to an unassigned accepted request. Current status: ${existingRequest.status}.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
