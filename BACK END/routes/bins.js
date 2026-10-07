const express = require('express');
const crypto = require('crypto');
const Bin = require('../models/Bin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { FILLING_THRESHOLD, COLLECTION_THRESHOLD, conditionFor, sensorStatusFor, withCondition } = require('../utils/binCondition');

const router = express.Router();
const VALID_TYPES = ['bin', 'recycle', 'collection'];
const OPERATIONAL_STATUSES = ['operational', 'maintenance', 'damaged'];
const numericFill = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
const isObjectId = value => /^[0-9a-fA-F]{24}$/.test(value);

function binFilter(id, type = 'bin') {
  const filter = isObjectId(id) ? { _id: id } : { binCode: String(id).toUpperCase() };
  if (type) filter.type = type;
  return filter;
}

function requireDeviceKey(req, res, next) {
  const configuredKey = process.env.DEVICE_KEY || '';
  const providedKey = req.get('x-device-key') || '';
  const configured = Buffer.from(configuredKey);
  const provided = Buffer.from(providedKey);
  if (!configured.length || configured.length !== provided.length || !crypto.timingSafeEqual(configured, provided)) {
    return res.status(401).json({ success: false, message: 'Device authentication failed.' });
  }
  next();
}

async function ensureSensorCycle(bin) {
  if (bin.sensorCycleId) return bin;
  const cycleId = crypto.randomUUID();
  const updated = await Bin.findOneAndUpdate(
    { _id: bin._id, $or: [{ sensorCycleId: null }, { sensorCycleId: { $exists: false } }] },
    { $set: { sensorCycleId: cycleId, sensorSequence: 0 } },
    { returnDocument: 'after' }
  );
  return updated || Bin.findById(bin._id);
}

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.type && VALID_TYPES.includes(req.query.type)) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status; // legacy filter for existing clients
    if (req.query.zone) filter.zone = { $regex: String(req.query.zone).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const bins = await Bin.find(filter).sort(req.query.sort === 'fill' ? { fillLevel: -1 } : { createdAt: 1 });
    const data = bins.map(withCondition).filter(bin => !req.query.condition || bin.fillCondition === req.query.condition || bin.operationalStatus === req.query.condition);
    res.json({ success: true, thresholds: { filling: FILLING_THRESHOLD, collectionNeeded: COLLECTION_THRESHOLD }, count: data.length, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id/sensor-state', requireDeviceKey, async (req, res) => {
  try {
    let bin = await Bin.findOne(binFilter(req.params.id));
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    bin = await ensureSensorCycle(bin);
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    const sensorStatus = sensorStatusFor(bin.fillLevel);
    res.json({
      success: true,
      data: {
        binId: bin.binCode,
        fillLevel: bin.fillLevel,
        status: sensorStatus,
        lastUpdated: bin.lastReadingAt,
        deviceState: withCondition(bin).sensorDeviceState,
        cycleId: bin.sensorCycleId,
        lastSequence: bin.sensorSequence || 0,
        canTransmit: sensorStatus !== 'FULL',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load sensor state.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const bin = await Bin.findOne(binFilter(req.params.id, null));
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    res.json({ success: true, data: withCondition(bin) });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not load bin.' }); }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, type, lat, lng, description, zone, capacity, operationalStatus } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || ((lat == null || lat === '') !== (lng == null || lng === ''))) return res.status(400).json({ success: false, message: 'Name is required; provide both coordinates or neither.' });
    if (type && !VALID_TYPES.includes(type)) return res.status(400).json({ success: false, message: 'Invalid type.' });
    if (operationalStatus && !OPERATIONAL_STATUSES.includes(operationalStatus)) return res.status(400).json({ success: false, message: 'Invalid operational status.' });
    if (lat != null && (!Number.isFinite(Number(lat)) || Number(lat) < -90 || Number(lat) > 90 || !Number.isFinite(Number(lng)) || Number(lng) < -180 || Number(lng) > 180)) return res.status(400).json({ success: false, message: 'Coordinates are out of range.' });
    const bin = await Bin.create({ name: name.trim(), type, lat: lat == null || lat === '' ? null : Number(lat), lng: lng == null || lng === '' ? null : Number(lng), description, zone, capacity, operationalStatus });
    res.status(201).json({ success: true, message: 'Bin created.', data: withCondition(bin) });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const body = { ...req.body };
    if ('fillLevel' in body || 'readingSource' in body || 'collectionState' in body || 'activeCollectionTask' in body) return res.status(400).json({ success: false, message: 'Reading and collection state must be changed through their workflow endpoints.' });
    if (body.type && !VALID_TYPES.includes(body.type)) return res.status(400).json({ success: false, message: 'Invalid type.' });
    if (body.operationalStatus && !OPERATIONAL_STATUSES.includes(body.operationalStatus)) return res.status(400).json({ success: false, message: 'Invalid operational status.' });
    const bin = await Bin.findByIdAndUpdate(req.params.id, body, { returnDocument: 'after', runValidators: true });
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    res.json({ success: true, data: withCondition(bin) });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const operationalStatus = req.body && (req.body.operationalStatus || (req.body.status === 'out-of-service' ? 'maintenance' : req.body.status === 'available' ? 'operational' : null));
    if (!OPERATIONAL_STATUSES.includes(operationalStatus)) return res.status(400).json({ success: false, message: 'Use operationalStatus: operational, maintenance, or damaged.' });
    const bin = await Bin.findByIdAndUpdate(req.params.id, { operationalStatus }, { returnDocument: 'after', runValidators: true });
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    res.json({ success: true, data: withCondition(bin) });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.post('/:id/simulated-reading', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { fillLevel } = req.body || {};
    if (!numericFill(fillLevel)) return res.status(400).json({ success: false, message: 'fillLevel must be a number from 0 to 100.' });
    if (Number(fillLevel) < 100) {
      const currentBin = await Bin.findOne({ _id: req.params.id, type: 'bin' });
      if (!currentBin) return res.status(404).json({ success: false, message: 'Bin not found.' });
      if (sensorStatusFor(currentBin.fillLevel) === 'FULL') {
        return res.status(409).json({ success: false, message: 'A FULL bin can only be reset after its collection task is completed.' });
      }
    }
    const now = new Date();
    const filter = { _id: req.params.id, type: 'bin' };
    if (Number(fillLevel) < 100) {
      filter.$or = [{ fillLevel: null }, { fillLevel: { $lt: 100 } }];
    }
    const bin = await Bin.findOneAndUpdate(filter, {
      $set: { fillLevel: Number(fillLevel), readingSource: 'simulated', lastReadingAt: now },
    }, { returnDocument: 'after', runValidators: true });
    if (!bin) return res.status(409).json({ success: false, message: 'Bin changed during this update; refresh and try again.' });
    const condition = conditionFor(bin.fillLevel, bin.lastReadingAt);
    const collectionState = bin.activeCollectionTask ? bin.collectionState : (condition === 'collection-needed' ? 'needed' : 'none');
    await Bin.updateOne({ _id: bin._id }, { $set: { collectionState } });
    bin.collectionState = collectionState;
    res.json({ success: true, message: 'SIMULATED test reading saved; this is not sensor data.', data: withCondition(bin) });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.post('/:id/sensor', requireDeviceKey, async (req, res) => {
  try {
    const { binId, fillLevel, status, cycleId, sequence } = req.body || {};
    if (typeof binId !== 'string' || !binId) return res.status(400).json({ success: false, message: 'binId is required.' });
    if (!numericFill(fillLevel)) return res.status(400).json({ success: false, message: 'fillLevel must be a number from 0 to 100.' });
    if (typeof cycleId !== 'string' || !cycleId || cycleId.length > 64 || !Number.isSafeInteger(sequence) || sequence < 1) {
      return res.status(400).json({ success: false, message: 'A valid cycleId and positive integer sequence are required.' });
    }
    const expectedStatus = sensorStatusFor(Number(fillLevel));
    if (status !== expectedStatus) return res.status(400).json({ success: false, message: `status must match the fill level (${expectedStatus}).` });

    let currentBin = await Bin.findOne(binFilter(req.params.id));
    if (!currentBin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    if (![req.params.id, String(currentBin._id), currentBin.binCode].filter(Boolean).includes(binId)) {
      return res.status(400).json({ success: false, message: 'binId must identify the bin in the request URL.' });
    }
    currentBin = await ensureSensorCycle(currentBin);
    if (sensorStatusFor(currentBin.fillLevel) === 'FULL') {
      return res.status(409).json({ success: false, message: 'This bin is FULL; sensor readings are stopped until collection is completed.' });
    }
    if (cycleId !== currentBin.sensorCycleId) return res.status(409).json({ success: false, message: 'Sensor cycle is no longer active. Refresh the device state.' });
    if (sequence <= (currentBin.sensorSequence || 0)) return res.status(409).json({ success: false, message: 'Duplicate or stale sensor sequence.' });
    if (currentBin.fillLevel != null && Number(fillLevel) < currentBin.fillLevel) {
      return res.status(409).json({ success: false, message: 'Fill level cannot decrease before a completed collection.' });
    }

    const now = new Date();
    const condition = conditionFor(Number(fillLevel), now, currentBin.lastCollectionAt);
    const collectionState = currentBin.activeCollectionTask ? currentBin.collectionState : (condition === 'collection-needed' ? 'needed' : 'none');
    const bin = await Bin.findOneAndUpdate({
      _id: currentBin._id,
      sensorCycleId: cycleId,
      sensorSequence: { $lt: sequence },
      $or: [{ fillLevel: null }, { fillLevel: { $lte: Number(fillLevel) } }],
    }, {
      $set: {
        fillLevel: Number(fillLevel),
        readingSource: 'sensor',
        lastReadingAt: now,
        sensorSequence: sequence,
        collectionState,
      },
    }, { returnDocument: 'after', runValidators: true });
    if (!bin) return res.status(409).json({ success: false, message: 'Sensor state changed; refresh the device state before retrying.' });
    const data = withCondition(bin);
    data.binId = bin.binCode;
    data.lastUpdated = bin.lastReadingAt;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not save sensor reading.' });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const bin = await Bin.findById(req.params.id);
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    if (bin.activeCollectionTask) return res.status(409).json({ success: false, message: 'Cannot delete a bin with an active collection task.' });
    await bin.deleteOne();
    res.json({ success: true, message: 'Bin deleted.' });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

module.exports = router;
