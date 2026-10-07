const express = require('express');
const Report = require('../models/Report');
const User = require('../models/User');
const upload = require('../middleware/reportUpload');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

const router = express.Router();
const REPORT_STATUSES = ['pending', 'in-progress', 'resolved', 'dismissed'];
const REPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const REPORT_TYPES = ['overflow', 'illegal', 'damaged', 'missing', 'smell', 'other'];

function reportFilter(id) {
  return /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { refId: id };
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function publicReport(report) {
  return { refId: report.refId, status: report.status, createdAt: report.createdAt, updatedAt: report.updatedAt };
}
function safeCoordinates(body) {
  const latEmpty = body.latitude === undefined || body.latitude === '';
  const lngEmpty = body.longitude === undefined || body.longitude === '';
  if (latEmpty || lngEmpty || !Number.isFinite(Number(body.latitude)) || !Number.isFinite(Number(body.longitude)) ||
      Number(body.latitude) < -90 || Number(body.latitude) > 90 || Number(body.longitude) < -180 || Number(body.longitude) > 180) return null;
  return { latitude: Number(body.latitude), longitude: Number(body.longitude) };
}

router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const { fullName, phone, location, problemType, priority, description } = req.body;
    if (!fullName || !phone || !location || !problemType || !description) {
      return res.status(400).json({ success: false, message: 'fullName, phone, location, problemType, and description are required.' });
    }
    if (!REPORT_TYPES.includes(problemType)) return res.status(400).json({ success: false, message: 'Invalid problemType.' });
    if (priority && !REPORT_PRIORITIES.includes(priority)) return res.status(400).json({ success: false, message: 'Invalid priority.' });
    const coordinates = safeCoordinates(req.body);
    if (!coordinates) return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
    const report = await Report.create({
      fullName: String(fullName).trim(), phone: String(phone).trim(), location: String(location).trim(),
      ...coordinates, problemType, priority: priority || 'medium', description: String(description).trim(),
      photoUrl: req.file ? `/uploads/${req.file.filename}` : null,
    });
    res.status(201).json({ success: true, message: 'Report submitted.', data: { refId: report.refId, status: report.status, createdAt: report.createdAt } });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not submit report.' }); }
});

router.get('/', optionalAuth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      if (req.query.refId) {
        const report = await Report.findOne({ refId: req.query.refId, archivedAt: null }).select('refId status createdAt updatedAt');
        return report ? res.json({ success: true, data: [publicReport(report)] }) : res.status(404).json({ success: false, message: 'Report not found.' });
      }
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const filter = { archivedAt: null };
    for (const [key, allowed] of [['status', REPORT_STATUSES], ['priority', REPORT_PRIORITIES], ['problemType', REPORT_TYPES]]) {
      if (req.query[key]) {
        if (!allowed.includes(req.query[key])) return res.status(400).json({ success: false, message: `Invalid ${key}.` });
        filter[key] = req.query[key];
      }
    }
    if (req.query.assignment === 'unassigned') filter.assignedDriver = null;
    if (req.query.q && req.query.q.trim()) {
      const search = new RegExp(escapeRegex(req.query.q.trim()), 'i');
      filter.$or = [{ refId: search }, { fullName: search }, { phone: search }, { location: search }, { description: search }];
    }
    const reports = await Report.find(filter).populate('assignedDriver', 'username displayName').sort({ createdAt: -1 });
    res.json({ success: true, count: reports.length, data: reports });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not load reports.' }); }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const report = await Report.findOne({ ...reportFilter(req.params.id), archivedAt: null }).populate('assignedDriver', 'username displayName');
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
    if (req.user && req.user.role === 'admin') return res.json({ success: true, data: report });
    if (req.params.id !== report.refId) return res.status(403).json({ success: false, message: 'Admin access required.' });
    res.json({ success: true, data: publicReport(report) });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not load report.' }); }
});

router.patch('/:id/assign', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const driverId = req.body && req.body.driverId;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!driverId || !/^[0-9a-fA-F]{24}$/.test(driverId)) return res.status(400).json({ success: false, message: 'A valid driverId is required.' });
    const driver = await User.findOne({ _id: driverId, role: 'driver' }).select('username displayName');
    if (!driver) return res.status(404).json({ success: false, message: 'Eligible Driver not found.' });
    const report = await Report.findOne({ ...reportFilter(req.params.id), archivedAt: null });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
    if (!['pending', 'in-progress'].includes(report.status) || report.workSubmittedAt) return res.status(409).json({ success: false, message: 'This report cannot be assigned or reassigned after work is submitted or the report is closed.' });
    if (String(report.assignedDriver || '') === String(driver._id)) return res.status(409).json({ success: false, message: 'This Driver is already assigned.' });
    report.assignmentHistory.push({ driverId: driver._id, driverName: driver.displayName || driver.username, assignedBy: req.user.id, assignedAt: new Date(), reason });
    report.assignedDriver = driver._id;
    report.assignedAt = new Date();
    await report.save();
    await report.populate('assignedDriver', 'username displayName');
    res.json({ success: true, message: 'Driver assigned.', data: report });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not assign Driver.' }); }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.body || {};
    const note = typeof req.body.resolutionNote === 'string' ? req.body.resolutionNote.trim() : '';
    const rejectionReason = typeof req.body.rejectionReason === 'string' ? req.body.rejectionReason.trim() : '';
    if (!REPORT_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${REPORT_STATUSES.join(', ')}` });
    if (note.length > 1000 || rejectionReason.length > 1000) return res.status(400).json({ success: false, message: 'Notes must be 1000 characters or fewer.' });
    const report = await Report.findOne({ ...reportFilter(req.params.id), archivedAt: null });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
    if (status === 'resolved') {
      if (report.status !== 'in-progress' || !report.workSubmittedAt) return res.status(409).json({ success: false, message: 'A Driver must submit work before Admin verification.' });
      if (!note) return res.status(400).json({ success: false, message: 'A verification note is required.' });
      report.status = 'resolved'; report.resolvedAt = new Date(); report.resolutionNote = note; report.verifiedBy = req.user.id;
    } else if (status === 'dismissed') {
      if (report.status !== 'pending') return res.status(409).json({ success: false, message: 'Only pending reports may be rejected.' });
      if (!rejectionReason) return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
      report.status = 'dismissed'; report.rejectionReason = rejectionReason;
    } else {
      return res.status(400).json({ success: false, message: 'Admin may verify submitted work or reject a pending report. Drivers control work progress.' });
    }
    await report.save();
    res.json({ success: true, message: status === 'resolved' ? 'Driver work verified.' : 'Report rejected.', data: report });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not update report.' }); }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const report = await Report.findOneAndUpdate({ ...reportFilter(req.params.id), archivedAt: null }, { $set: { archivedAt: new Date() } }, { returnDocument: 'after' });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found or already archived.' });
    res.json({ success: true, message: 'Report archived.', data: { refId: report.refId } });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not archive report.' }); }
});

module.exports = router;
