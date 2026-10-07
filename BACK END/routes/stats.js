/* ================================================================
   SmartBin — Stats Route (MongoDB / Mongoose)
   GET /api/stats  → aggregated dashboard numbers
   ================================================================ */

const express = require('express');
const Bin     = require('../models/Bin');
const Report  = require('../models/Report');
const CollectionRequest = require('../models/CollectionRequest');
const { COLLECTION_THRESHOLD, conditionFor } = require('../utils/binCondition');

const router = express.Router();

/* ── GET /api/stats ────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    /* ── Bin stats ── */
    const [
      totalBins,
      available,
      almostFull,
      full,
      outOfService,
      binByType,
      zones,
      fillAgg,
      binReadings,
    ] = await Promise.all([
      Bin.countDocuments({ type: 'bin' }),
      Bin.countDocuments({ type: 'bin', status: 'available' }),
      Bin.countDocuments({ type: 'bin', status: 'almost-full' }),
      Bin.countDocuments({ type: 'bin', status: 'full' }),
      Bin.countDocuments({ type: 'bin', status: 'out-of-service' }),
      Bin.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
      Bin.distinct('zone', { zone: { $exists: true, $nin: ['', 'Unknown'] } }),
      Bin.aggregate([
        { $match: { type: 'bin' } },
        { $group: { _id: null, avg: { $avg: '$fillLevel' } } },
      ]),
      Bin.find({ type: 'bin' }).select('fillLevel lastReadingAt lastCollectionAt operationalStatus'),
    ]);

    const byType = { bin: 0, recycle: 0, collection: 0 };
    binByType.forEach(t => { byType[t._id] = t.count; });

    /* ── Report stats ── */
    const [
      totalReports,
      pending,
      unassignedReports,
      inProgress,
      resolved,
      dismissed,
      byPriorityAgg,
      byProblemAgg,
      recent,
    ] = await Promise.all([
      Report.countDocuments({ archivedAt: null }),
      Report.countDocuments({ status: 'pending', archivedAt: null }),
      Report.countDocuments({ status: 'pending', assignedDriver: null, archivedAt: null }),
      Report.countDocuments({ status: 'in-progress', archivedAt: null }),
      Report.countDocuments({ status: 'resolved', archivedAt: null }),
      Report.countDocuments({ status: 'dismissed', archivedAt: null }),
      Report.aggregate([
        { $match: { archivedAt: null } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      Report.aggregate([
        { $match: { archivedAt: null } },
        { $group: { _id: '$problemType', count: { $sum: 1 } } },
      ]),
      Report.find({ archivedAt: null }).sort({ createdAt: -1 }).limit(5).select('refId problemType location priority status createdAt'),
    ]);

    const byPriority    = { urgent:0, high:0, medium:0, low:0 };
    const byProblemType = {};
    byPriorityAgg.forEach(p => { byPriority[p._id] = p.count; });
    byProblemAgg.forEach(p  => { byProblemType[p._id] = p.count; });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const [pendingRequests, unassignedRequests, collectionsInProgress, completedToday] = await Promise.all([
      CollectionRequest.countDocuments({ status: 'pending' }),
      CollectionRequest.countDocuments({ status: 'accepted', assignedDriver: null }),
      CollectionRequest.countDocuments({ status: 'in-progress' }),
      CollectionRequest.countDocuments({
        status: 'completed',
        completedAt: { $gte: startOfToday, $lt: startOfTomorrow },
      }),
    ]);

    const collectionNeeded = binReadings.filter(bin => bin.operationalStatus === 'operational' && conditionFor(bin.fillLevel, bin.lastReadingAt, bin.lastCollectionAt) === 'collection-needed').length;
    const staleReadings = binReadings.filter(bin => conditionFor(bin.fillLevel, bin.lastReadingAt, bin.lastCollectionAt) === 'stale').length;
    res.json({
      success: true,
      data: {
        bins: {
          total:        totalBins,
          available,
          almostFull,
          full,
          outOfService,
          needsService: full + outOfService,
          collectionNeeded,
          staleReadings,
          collectionThreshold: COLLECTION_THRESHOLD,
          avgFillLevel: fillAgg[0] ? Math.round(fillAgg[0].avg) : 0,
          zones:        zones.length,
          byType,
        },
        reports: {
          total:       totalReports,
          pending,
          unassigned: unassignedReports,
          inProgress,
          resolved,
          dismissed,
          byPriority,
          byProblemType,
          recent,
        },
        collectionRequests: {
          pending: pendingRequests,
          unassigned: unassignedRequests,
          inProgress: collectionsInProgress,
          completedToday,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
