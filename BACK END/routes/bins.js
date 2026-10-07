const express = require('express');
const Bin = require('../models/Bin');
const { requireAuth, requireRole } = require('../middleware/auth');
const { FILLING_THRESHOLD, COLLECTION_THRESHOLD, conditionFor, withCondition } = require('../utils/binCondition');

const router = express.Router();
const VALID_TYPES = ['bin', 'recycle', 'collection'];
const OPERATIONAL_STATUSES = ['operational', 'maintenance', 'damaged'];
const numericFill = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;

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

router.get('/:id', async (req, res) => {
  try {
    const bin = await Bin.findById(req.params.id);
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    res.json({ success: true, data: withCondition(bin) });
  } catch (err) { res.status(400).json({ success: false, message: 'Invalid bin ID.' }); }
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
    const now = new Date();
    const bin = await Bin.findOneAndUpdate({ _id: req.params.id, type: 'bin' }, {
      $set: { fillLevel: Number(fillLevel), readingSource: 'simulated', lastReadingAt: now },
    }, { returnDocument: 'after', runValidators: true });
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    const condition = conditionFor(bin.fillLevel, bin.lastReadingAt);
    const collectionState = bin.activeCollectionTask ? bin.collectionState : (condition === 'collection-needed' ? 'needed' : 'none');
    await Bin.updateOne({ _id: bin._id }, { $set: { collectionState } });
    bin.collectionState = collectionState;
    res.json({ success: true, message: 'SIMULATED test reading saved; this is not sensor data.', data: withCondition(bin) });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

router.post('/:id/sensor', async (req, res) => {
  try {
    if (!process.env.DEVICE_KEY || req.get('x-device-key') !== process.env.DEVICE_KEY) return res.status(401).json({ success: false, message: 'Device authentication failed.' });
    const { fillLevel } = req.body || {};
    if (!numericFill(fillLevel)) return res.status(400).json({ success: false, message: 'fillLevel must be a number from 0 to 100.' });
    const bin = await Bin.findOneAndUpdate({ _id: req.params.id, type: 'bin' }, { $set: { fillLevel: Number(fillLevel), readingSource: 'sensor', lastReadingAt: new Date() } }, { returnDocument: 'after', runValidators: true });
    if (!bin) return res.status(404).json({ success: false, message: 'Bin not found.' });
    const condition = conditionFor(bin.fillLevel, bin.lastReadingAt);
    const collectionState = bin.activeCollectionTask ? bin.collectionState : (condition === 'collection-needed' ? 'needed' : 'none');
    await Bin.updateOne({ _id: bin._id }, { $set: { collectionState } });
    bin.collectionState = collectionState;
    res.json({ success: true, data: withCondition(bin) });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
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
