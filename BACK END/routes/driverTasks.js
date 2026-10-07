const express = require('express');
const crypto = require('crypto');
const CollectionRequest = require('../models/CollectionRequest');
const Bin = require('../models/Bin');
const Report = require('../models/Report');
const reportUpload = require('../middleware/reportUpload');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function requestFilter(id) {
  return /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { refId: id };
}

router.use(requireAuth, requireRole('driver'));

router.get('/reports', async (req, res) => {
  try {
    const reports = await Report.find({ assignedDriver: req.user.id, archivedAt: null, status: { $in: ['pending', 'in-progress'] } })
      .select('-fullName -phone').sort({ updatedAt: -1 });
    res.json({ success: true, count: reports.length, data: reports });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not load assigned reports.' }); }
});

router.patch('/reports/:id/start', async (req, res) => {
  try {
    const report = await Report.findOneAndUpdate(
      { ...requestFilter(req.params.id), assignedDriver: req.user.id, archivedAt: null, status: 'pending', workSubmittedAt: null },
      { $set: { status: 'in-progress' } }, { returnDocument: 'after', runValidators: true }
    ).select('-fullName -phone');
    if (report) return res.json({ success: true, message: 'Report work started.', data: report });
    const ownReport = await Report.findOne({ ...requestFilter(req.params.id), assignedDriver: req.user.id, archivedAt: null });
    if (!ownReport) return res.status(404).json({ success: false, message: 'Assigned report not found.' });
    return res.status(409).json({ success: false, message: 'This report cannot be started in its current state.' });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not start report work.' }); }
});

router.post('/reports/:id/work', reportUpload.single('evidence'), async (req, res) => {
  try {
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
    if (!notes) return res.status(400).json({ success: false, message: 'Work notes are required.' });
    if (notes.length > 2000) return res.status(400).json({ success: false, message: 'Work notes must be 2000 characters or fewer.' });
    const report = await Report.findOneAndUpdate(
      { ...requestFilter(req.params.id), assignedDriver: req.user.id, archivedAt: null, status: 'in-progress', workSubmittedAt: null },
      { $set: { workNotes: notes, workEvidenceUrl: req.file ? `/uploads/${req.file.filename}` : null, workSubmittedAt: new Date(), workSubmittedBy: req.user.id } },
      { returnDocument: 'after', runValidators: true }
    ).select('-fullName -phone');
    if (report) return res.json({ success: true, message: 'Work submitted for Admin verification.', data: report });
    const ownReport = await Report.findOne({ ...requestFilter(req.params.id), assignedDriver: req.user.id, archivedAt: null });
    if (!ownReport) return res.status(404).json({ success: false, message: 'Assigned report not found.' });
    return res.status(409).json({ success: false, message: 'Work was already submitted or the report is no longer in progress.' });
  } catch (err) { res.status(500).json({ success: false, message: 'Could not submit report work.' }); }
});

router.get('/', async (req, res) => {
  try {
    const tasks = await CollectionRequest.find({
      assignedDriver: req.user.id,
      status: { $in: ['assigned', 'in-progress', 'completed'] },
    })
      .populate('assignedDriver', 'username displayName')
      .sort({ updatedAt: -1 });
    res.json({ success: true, count: tasks.length, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['in-progress', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Drivers may only start or complete an assigned task.',
      });
    }

    const requiredCurrentStatus = status === 'in-progress' ? 'assigned' : 'in-progress';
    const update = { status };
    if (status === 'completed') update.completedAt = new Date();
    const updateOperation = { $set: update };
    if (status === 'completed') updateOperation.$unset = { activeBinId: 1 };

    const task = await CollectionRequest.findOneAndUpdate(
      {
        ...requestFilter(req.params.id),
        assignedDriver: req.user.id,
        status: requiredCurrentStatus,
      },
      updateOperation,
      { returnDocument: 'after', runValidators: true }
    ).populate('assignedDriver', 'username displayName');

    if (task) {
      if (task.source === 'bin' && task.binId) {
        if (status === 'completed') {
          const reset = await Bin.updateOne({ _id: task.binId, activeCollectionTask: task._id }, {
            $set: {
              fillLevel: 0,
              status: 'available',
              readingSource: null,
              lastReadingAt: task.completedAt,
              lastCollectionAt: task.completedAt,
              collectionState: 'none',
              sensorCycleId: crypto.randomUUID(),
              sensorSequence: 0,
            },
            $unset: { activeCollectionTask: 1 },
          });
          if (!reset.matchedCount) {
            console.error(`[DriverTasks] Completed bin task ${task._id} but could not reset bin ${task.binId}.`);
            return res.status(500).json({ success: false, message: 'Task completed, but the bin could not be reset. Contact an administrator.' });
          }
        } else {
          await Bin.updateOne({ _id: task.binId, activeCollectionTask: task._id }, { $set: { collectionState: 'in-progress' } });
        }
      }
      return res.json({ success: true, message: `Task ${status}.`, data: task });
    }

    const ownTask = await CollectionRequest.findOne({
      ...requestFilter(req.params.id),
      assignedDriver: req.user.id,
    });
    if (!ownTask) {
      return res.status(404).json({ success: false, message: 'Assigned task not found.' });
    }
    res.status(409).json({
      success: false,
      message: `Task cannot be changed from ${ownTask.status} to ${status}.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
