const FILLING_THRESHOLD = Number(process.env.BIN_FILLING_THRESHOLD) || 70;
const COLLECTION_THRESHOLD = Number(process.env.BIN_COLLECTION_THRESHOLD) || 90;
const STALE_AFTER_MINUTES = Number(process.env.BIN_READING_STALE_MINUTES) || 120;

function conditionFor(fillLevel, lastReadingAt, lastCollectionAt) {
  if (fillLevel == null || !Number.isFinite(Number(fillLevel))) return 'unavailable';
  const readAt = lastReadingAt ? new Date(lastReadingAt).getTime() : NaN;
  const stale = !Number.isFinite(readAt) || Date.now() - readAt > STALE_AFTER_MINUTES * 60000;
  if (stale) return 'stale';
  const collectedAt = lastCollectionAt ? new Date(lastCollectionAt).getTime() : NaN;
  if (Number.isFinite(collectedAt) && readAt <= collectedAt) return 'awaiting-reading';
  if (Number(fillLevel) >= COLLECTION_THRESHOLD) return 'collection-needed';
  if (Number(fillLevel) >= FILLING_THRESHOLD) return 'filling';
  return 'available';
}

function withCondition(bin) {
  const value = typeof bin.toObject === 'function' ? bin.toObject() : bin;
  value.fillCondition = conditionFor(value.fillLevel, value.lastReadingAt, value.lastCollectionAt);
  value.readingStaleAfterMinutes = STALE_AFTER_MINUTES;
  return value;
}

module.exports = { FILLING_THRESHOLD, COLLECTION_THRESHOLD, STALE_AFTER_MINUTES, conditionFor, withCondition };
