const FILLING_THRESHOLD = Number(process.env.BIN_FILLING_THRESHOLD) || 70;
const COLLECTION_THRESHOLD = Number(process.env.BIN_COLLECTION_THRESHOLD) || 90;
const STALE_AFTER_MINUTES = Number(process.env.BIN_READING_STALE_MINUTES) || 120;

function sensorStatusFor(fillLevel) {
  if (fillLevel == null || !Number.isFinite(Number(fillLevel))) return 'UNAVAILABLE';
  if (Number(fillLevel) >= 100) return 'FULL';
  if (Number(fillLevel) >= 80) return 'HIGH';
  if (Number(fillLevel) >= 50) return 'ALMOST_FULL';
  return 'NORMAL';
}

function sensorDeviceState(bin, now = Date.now()) {
  if (sensorStatusFor(bin.fillLevel) === 'FULL') return 'STOPPED_AFTER_FULL';

  const readingAt = bin.lastReadingAt ? new Date(bin.lastReadingAt).getTime() : NaN;
  const collectionAt = bin.lastCollectionAt ? new Date(bin.lastCollectionAt).getTime() : NaN;
  if (Number.isFinite(collectionAt) && (!Number.isFinite(readingAt) || readingAt <= collectionAt)) {
    return 'AWAITING_RESUME';
  }
  if (bin.readingSource !== 'sensor') return 'NOT_CONNECTED';
  if (!Number.isFinite(readingAt) || now - readingAt > STALE_AFTER_MINUTES * 60000) return 'OFFLINE';
  return 'ONLINE';
}

function conditionFor(fillLevel, lastReadingAt, lastCollectionAt) {
  if (fillLevel == null || !Number.isFinite(Number(fillLevel))) return 'unavailable';
  const readAt = lastReadingAt ? new Date(lastReadingAt).getTime() : NaN;
  const collectedAt = lastCollectionAt ? new Date(lastCollectionAt).getTime() : NaN;
  if (Number.isFinite(collectedAt) && (!Number.isFinite(readAt) || readAt <= collectedAt)) return 'awaiting-reading';
  if (Number(fillLevel) >= 100 && Number.isFinite(readAt)) return 'collection-needed';
  const stale = !Number.isFinite(readAt) || Date.now() - readAt > STALE_AFTER_MINUTES * 60000;
  if (stale) return 'stale';
  if (Number(fillLevel) >= COLLECTION_THRESHOLD) return 'collection-needed';
  if (Number(fillLevel) >= FILLING_THRESHOLD) return 'filling';
  return 'available';
}

function withCondition(bin) {
  const value = typeof bin.toObject === 'function' ? bin.toObject() : bin;
  delete value.sensorCycleId;
  delete value.sensorSequence;
  value.fillCondition = conditionFor(value.fillLevel, value.lastReadingAt, value.lastCollectionAt);
  value.sensorStatus = sensorStatusFor(value.fillLevel);
  value.sensorDeviceState = sensorDeviceState(value);
  value.readingStaleAfterMinutes = STALE_AFTER_MINUTES;
  return value;
}

module.exports = {
  FILLING_THRESHOLD,
  COLLECTION_THRESHOLD,
  STALE_AFTER_MINUTES,
  conditionFor,
  sensorStatusFor,
  sensorDeviceState,
  withCondition,
};
