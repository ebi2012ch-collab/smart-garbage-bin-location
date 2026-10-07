const test = require('node:test');
const assert = require('node:assert/strict');
const Bin = require('../models/Bin');
const CollectionRequest = require('../models/CollectionRequest');
const { conditionFor, sensorStatusFor, sensorDeviceState, withCondition } = require('../utils/binCondition');
const { requireRole } = require('../middleware/auth');

test('fill thresholds produce independent fill conditions', () => {
  const now = new Date();
  assert.equal(conditionFor(0, now), 'available');
  assert.equal(conditionFor(69, now), 'available');
  assert.equal(conditionFor(70, now), 'filling');
  assert.equal(conditionFor(89, now), 'filling');
  assert.equal(conditionFor(90, now), 'collection-needed');
  assert.equal(conditionFor(95, now, new Date(now.getTime() + 1000)), 'awaiting-reading');
  assert.equal(conditionFor(null, now), 'unavailable');
  assert.equal(conditionFor(95, new Date(Date.now() - 121 * 60 * 1000)), 'stale');
});

test('sensor statuses use the requested fill bands independently of collection thresholds', () => {
  assert.equal(sensorStatusFor(0), 'NORMAL');
  assert.equal(sensorStatusFor(49), 'NORMAL');
  assert.equal(sensorStatusFor(50), 'ALMOST_FULL');
  assert.equal(sensorStatusFor(79), 'ALMOST_FULL');
  assert.equal(sensorStatusFor(80), 'HIGH');
  assert.equal(sensorStatusFor(99), 'HIGH');
  assert.equal(sensorStatusFor(100), 'FULL');
  assert.equal(sensorStatusFor(null), 'UNAVAILABLE');
});

test('sensor communication state distinguishes simulation, offline, full, and reset-awaiting-resume', () => {
  const now = Date.now();
  assert.equal(sensorDeviceState({ fillLevel: 20, readingSource: 'simulated', lastReadingAt: new Date(now) }, now), 'NOT_CONNECTED');
  assert.equal(sensorDeviceState({ fillLevel: 20, readingSource: 'sensor', lastReadingAt: new Date(now - 121 * 60 * 1000) }, now), 'OFFLINE');
  assert.equal(sensorDeviceState({ fillLevel: 100, readingSource: 'sensor', lastReadingAt: new Date(now) }, now), 'STOPPED_AFTER_FULL');
  assert.equal(sensorDeviceState({ fillLevel: 0, readingSource: null, lastReadingAt: new Date(now), lastCollectionAt: new Date(now) }, now), 'AWAITING_RESUME');
  assert.equal(sensorDeviceState({ fillLevel: 0, readingSource: 'sensor', lastReadingAt: new Date(now) }, now), 'ONLINE');
});

test('public bin representations do not expose the device cycle token or sequence', () => {
  const bin = withCondition({
    binCode: 'BIN-001',
    fillLevel: 0,
    readingSource: null,
    sensorCycleId: 'private-cycle-token',
    sensorSequence: 42,
  });
  assert.equal('sensorCycleId' in bin, false);
  assert.equal('sensorSequence' in bin, false);
  assert.equal(bin.sensorStatus, 'NORMAL');
});

test('bins allow missing coordinates and start without claiming a reading', async () => {
  const bin = new Bin({ name: 'Test bin', lat: null, lng: null });
  await bin.validate();
  assert.match(bin.binCode, /^BIN-[0-9A-F]{8}$/);
  assert.equal(bin.fillLevel, null);
  assert.equal(bin.readingSource, null);
  assert.equal(bin.operationalStatus, 'operational');
});

test('bin task schema keeps fill snapshot and active-bin uniqueness separate from task state', () => {
  const indexes = CollectionRequest.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.activeBinId === 1 && options.unique && options.sparse));
  assert.equal(CollectionRequest.schema.path('status').enumValues.includes('assigned'), true);
  assert.equal(CollectionRequest.schema.path('status').enumValues.includes('in-progress'), true);
  assert.equal(CollectionRequest.schema.path('status').enumValues.includes('completed'), true);
  assert.equal(CollectionRequest.schema.path('fillLevelAtAssignment').instance, 'Number');
});

test('role middleware allows admins only on admin workflows', () => {
  let nextCalled = false;
  const adminResponse = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  requireRole('admin')({ user: { role: 'admin' } }, adminResponse, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const driverResponse = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  requireRole('admin')({ user: { role: 'driver' } }, driverResponse, () => assert.fail('driver must not pass admin guard'));
  assert.equal(driverResponse.code, 403);
});
