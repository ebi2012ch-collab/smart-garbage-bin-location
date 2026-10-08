const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Bin = require('../models/Bin');
const User = require('../models/User');
const CollectionRequest = require('../models/CollectionRequest');
const Report = require('../models/Report');

test('API bin monitoring and collection assignment workflow', async t => {
  const configuredUri = process.env.MONGO_URI;
  if (!configuredUri) return t.skip('MONGO_URI is not configured.');
  const testUri = new URL(configuredUri);
  if (!['localhost', '127.0.0.1', '::1'].includes(testUri.hostname)) return t.skip('Integration test only writes to a local MongoDB instance.');
  testUri.pathname = `/smartbin_workflow_test_${process.pid}`;
  try {
    await mongoose.connect(testUri.toString(), { serverSelectionTimeoutMS: 3000 });
  } catch (_) {
    return t.skip('Local MongoDB is not available.');
  }

  let server;
  let generatedEvidencePath;
  const previousDeviceKey = process.env.DEVICE_KEY;
  process.env.DEVICE_KEY = 'workflow-test-device-key';
  try {
    await mongoose.connection.dropDatabase();
    await Promise.all([Bin.syncIndexes(), CollectionRequest.syncIndexes(), User.syncIndexes(), Report.syncIndexes()]);
    const passwordHash = await bcrypt.hash('workflow-test-password', 4);
    const admin = await User.create({ username: 'workflow-admin', passwordHash, role: 'admin' });
    const driver1 = await User.create({ username: 'workflow-driver-1', passwordHash, role: 'driver', displayName: 'Driver One' });
    const driver2 = await User.create({ username: 'workflow-driver-2', passwordHash, role: 'driver', displayName: 'Driver Two' });
    const token = user => jwt.sign({ id: user._id, role: user.role, username: user.username }, process.env.JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/bins', require('../routes/bins'));
    app.use('/api/collection-requests', require('../routes/collectionRequests'));
    app.use('/api/reports', require('../routes/reports'));
    app.use('/api/driver/tasks', require('../routes/driverTasks'));
    app.use('/api/drivers', require('../routes/drivers'));
    app.use('/api/stats', require('../routes/stats'));
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = async (route, method = 'GET', body, bearer) => {
      const response = await fetch(base + route, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const createReport = async input => {
      const form = new FormData();
      Object.entries(Object.assign({ fullName:'Test Reporter', phone:'0900000000', location:'Test street', problemType:'overflow', priority:'high', description:'Test report details', latitude:'8.54', longitude:'39.27' }, input || {})).forEach(([key, value]) => form.append(key, value));
      const response = await fetch(base + '/reports', { method:'POST', body:form });
      return { status:response.status, body:await response.json() };
    };
    const adminToken = token(admin);
    const driver1Token = token(driver1);
    const driver2Token = token(driver2);
    const deviceCall = async (route, method = 'GET', body, deviceKey = process.env.DEVICE_KEY) => {
      const response = await fetch(base + route, {
        method,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          deviceKey ? { 'x-device-key': deviceKey } : {}
        ),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const collectionRequest = {
      fullName: 'Test Requester',
      phone: '0900000000',
      location: 'Test collection area',
      description: 'Please collect waste from this area.',
      latitude: 8.54,
      longitude: 39.27,
    };
    assert.equal((await call('/collection-requests', 'POST', Object.assign({}, collectionRequest, { latitude: undefined, longitude: undefined }))).status, 400);
    assert.equal((await call('/collection-requests', 'POST', Object.assign({}, collectionRequest, { longitude: undefined }))).status, 400);
    assert.equal((await call('/collection-requests', 'POST', collectionRequest)).status, 201);

    const reportCreated = await createReport();
    assert.equal(reportCreated.status, 201);
    const reportRef = reportCreated.body.data.refId;
    assert.ok(reportRef);
    assert.equal(reportCreated.body.data.status, 'pending');
    assert.equal((await createReport({ latitude:'', longitude:'' })).status, 400);
    assert.equal((await createReport({ latitude:'8.54', longitude:'' })).status, 400);
    assert.equal((await createReport({ latitude:'91', longitude:'39' })).status, 400);
    const publicLookup = await call('/reports?refId=' + encodeURIComponent(reportRef));
    assert.equal(publicLookup.status, 200);
    assert.equal(publicLookup.body.data[0].phone, undefined);
    assert.equal(publicLookup.body.data[0].description, undefined);
    assert.equal((await call('/reports?status=invalid', 'GET', undefined, token(admin))).status, 400);
    assert.equal((await call('/reports?problemType=overflow&q=Test', 'GET', undefined, token(admin))).body.count, 1);
    assert.equal((await call('/reports?status=pending&priority=high&problemType=overflow&q=street', 'GET', undefined, token(admin))).body.count, 1);
    assert.equal((await call('/reports', 'GET', undefined, driver1Token)).status, 403);
    assert.equal((await call('/reports/' + reportRef, 'GET', undefined, driver1Token)).body.data.phone, undefined);
    const assignedReport = await call('/reports/' + reportRef + '/assign', 'PATCH', { driverId: String(driver1._id), reason:'Nearby driver' }, token(admin));
    assert.equal(assignedReport.status, 200);
    assert.equal(String(assignedReport.body.data.assignedDriver._id), String(driver1._id));
    assert.equal((await call('/reports/' + reportRef + '/assign', 'PATCH', { driverId: String(driver1._id) }, token(admin))).status, 409);
    assert.equal((await call('/reports/' + reportRef + '/assign', 'PATCH', { driverId: String(driver2._id) }, driver1Token)).status, 403);
    const reassignedReport = await call('/reports/' + reportRef + '/assign', 'PATCH', { driverId: String(driver2._id), reason:'First driver unavailable' }, token(admin));
    assert.equal(reassignedReport.body.data.assignmentHistory.length, 2);
    assert.equal((await call('/drivers', 'GET', undefined, token(admin))).body.data.find(d => String(d.id) === String(driver2._id)).activeAssignments, 1);
    assert.equal((await call('/driver/tasks/reports', 'GET', undefined, driver1Token)).body.count, 0);
    assert.equal((await call('/driver/tasks/reports', 'GET', undefined, driver2Token)).body.data[0].phone, undefined);
    const unauthorizedReportStart = await call('/driver/tasks/reports/' + reassignedReport.body.data._id + '/start', 'PATCH', {}, driver1Token);
    assert.equal(unauthorizedReportStart.status, 404, JSON.stringify(unauthorizedReportStart.body));
    const startedReport = await call('/driver/tasks/reports/' + reassignedReport.body.data._id + '/start', 'PATCH', {}, driver2Token);
    assert.equal(startedReport.body.data.status, 'in-progress');
    assert.equal(startedReport.body.data.phone, undefined);
    assert.equal((await call('/reports/' + reportRef + '/status', 'PATCH', { status:'resolved', resolutionNote:'Checked' }, token(admin))).status, 409);
    const workForm = new FormData(); workForm.append('notes','Cleared and inspected the reported area.');
    workForm.append('evidence', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7o8AAAAASUVORK5CYII=', 'base64')], { type:'image/png' }), 'work-evidence.png');
    const workResponse = await fetch(base + '/driver/tasks/reports/' + assignedReport.body.data._id + '/work', { method:'POST', headers:{ Authorization:'Bearer ' + driver2Token }, body:workForm });
    assert.equal(workResponse.status, 200);
    const workResult = await workResponse.json();
    assert.match(workResult.data.workEvidenceUrl, /^\/uploads\//);
    generatedEvidencePath = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads', path.basename(workResult.data.workEvidenceUrl));
    assert.equal(fs.existsSync(generatedEvidencePath), true);
    const duplicateWork = new FormData(); duplicateWork.append('notes','Duplicate submission');
    const duplicateResponse = await fetch(base + '/driver/tasks/reports/' + assignedReport.body.data._id + '/work', { method:'POST', headers:{ Authorization:'Bearer ' + driver2Token }, body:duplicateWork });
    assert.equal(duplicateResponse.status, 409);
    assert.equal((await call('/reports/' + reportRef + '/assign', 'PATCH', { driverId:String(driver2._id) }, token(admin))).status, 409);
    assert.equal((await call('/reports/' + reportRef + '/status', 'PATCH', { status:'resolved', resolutionNote:'' }, token(admin))).status, 400);
    assert.equal((await call('/reports/' + reportRef + '/status', 'PATCH', { status:'resolved', resolutionNote:'Verified.' }, driver1Token)).status, 403);
    const verified = await call('/reports/' + reportRef + '/status', 'PATCH', { status:'resolved', resolutionNote:'Verified on review.' }, token(admin));
    assert.equal(verified.body.data.status, 'resolved');
    assert.ok(verified.body.data.resolvedAt);
    assert.equal((await call('/stats')).body.data.reports.resolved, 1);
    const rejectedInput = await createReport({ fullName:'Another Reporter', phone:'0911111111', problemType:'damaged', location:'Second street' });
    assert.equal(rejectedInput.status, 201);
    assert.equal((await call('/reports/' + rejectedInput.body.data.refId + '/status', 'PATCH', { status:'dismissed' }, token(admin))).status, 400);
    const rejected = await call('/reports/' + rejectedInput.body.data.refId + '/status', 'PATCH', { status:'dismissed', rejectionReason:'Outside service area.' }, token(admin));
    assert.equal(rejected.body.data.status, 'dismissed');
    assert.equal(rejected.body.data.rejectionReason, 'Outside service area.');
    assert.equal((await call('/reports/not-a-report')).status, 404);
    const originalFind = Report.find;
    try {
      Report.find = () => { throw new Error('simulated database failure'); };
      const failedList = await call('/reports?status=pending', 'GET', undefined, token(admin));
      assert.equal(failedList.status, 500);
      assert.equal(failedList.body.message, 'Could not load reports.');
    } finally { Report.find = originalFind; }

    const created = await call('/bins', 'POST', { name: 'Workflow bin', zone: 'Test', lat: null, lng: null }, adminToken);
    assert.equal(created.status, 201);
    const bin = created.body.data;
    assert.equal(bin.fillCondition, 'unavailable');
    assert.equal(bin.lat, null);
    assert.equal((await call(`/bins/${bin._id}/simulated-reading`, 'POST', { fillLevel: 101 }, adminToken)).status, 400);
    assert.equal((await call(`/bins/${bin._id}/simulated-reading`, 'POST', { fillLevel: 69 }, driver1Token)).status, 403);
    assert.equal((await call(`/bins/${bin._id}/simulated-reading`, 'POST', { fillLevel: 69 })).status, 401);

    for (const [level, expected] of [[69, 'available'], [70, 'filling'], [89, 'filling'], [90, 'collection-needed']]) {
      const reading = await call(`/bins/${bin._id}/simulated-reading`, 'POST', { fillLevel: level }, adminToken);
      assert.equal(reading.status, 200);
      assert.equal(reading.body.data.fillCondition, expected);
      assert.equal(reading.body.data.readingSource, 'simulated');
      assert.match(reading.body.message, /SIMULATED/);
    }
    assert.equal((await call('/stats')).body.data.bins.collectionNeeded, 1);
    assert.equal((await call('/collection-requests/from-bin', 'POST', { binId: bin._id, driverId: driver1._id }, driver1Token)).status, 403);

    const assignment = await call('/collection-requests/from-bin', 'POST', { binId: bin._id, driverId: driver1._id }, adminToken);
    assert.equal(assignment.status, 201);
    const task = assignment.body.data;
    assert.equal(task.binCode, bin.binCode);
    assert.equal(task.fillLevelAtAssignment, 90);
    assert.equal(task.readingSourceAtAssignment, 'simulated');
    assert.equal(task.status, 'assigned');
    assert.equal((await call('/collection-requests/from-bin', 'POST', { binId: bin._id, driverId: driver2._id }, adminToken)).status, 409);

    const otherDriverTasks = await call('/driver/tasks', 'GET', undefined, driver2Token);
    assert.equal(otherDriverTasks.status, 200);
    assert.equal(otherDriverTasks.body.count, 0);
    assert.equal((await call(`/driver/tasks/${task._id}/status`, 'PATCH', { status: 'in-progress' }, driver2Token)).status, 404);
    assert.equal((await call('/driver/tasks', 'GET', undefined, driver1Token)).body.data[0].binCode, bin.binCode);

    assert.equal((await call(`/driver/tasks/${task._id}/status`, 'PATCH', { status: 'in-progress' }, driver1Token)).body.data.status, 'in-progress');
    assert.equal((await call(`/driver/tasks/${task._id}/status`, 'PATCH', { status: 'completed' }, driver1Token)).body.data.status, 'completed');
    let currentBin = (await call(`/bins/${bin._id}`)).body.data;
    assert.equal(currentBin.fillLevel, 0);
    assert.equal(currentBin.status, 'available');
    assert.equal(currentBin.collectionState, 'none');
    assert.ok(currentBin.lastCollectionAt);
    assert.equal(currentBin.fillCondition, 'awaiting-reading');
    assert.equal(currentBin.sensorDeviceState, 'AWAITING_RESUME');
    assert.equal((await call('/stats')).body.data.bins.collectionNeeded, 0);
    assert.equal((await call('/collection-requests/from-bin', 'POST', { binId: bin._id, driverId: driver2._id }, adminToken)).status, 409);

    const nextReading = await call(`/bins/${bin._id}/simulated-reading`, 'POST', { fillLevel: 25 }, adminToken);
    assert.equal(nextReading.body.data.fillCondition, 'available');
    assert.equal(nextReading.body.data.collectionState, 'none');
    assert.ok(new Date(nextReading.body.data.lastReadingAt) > new Date(currentBin.lastCollectionAt));
    assert.equal((await call('/stats')).body.data.bins.collectionNeeded, 0);

    const fullAgain = await call(`/bins/${bin._id}/simulated-reading`, 'POST', { fillLevel: 92 }, adminToken);
    assert.equal(fullAgain.body.data.collectionState, 'needed');
    assert.equal((await call('/stats')).body.data.bins.collectionNeeded, 1);
    const reassignment = await call('/collection-requests/from-bin', 'POST', { binId: bin._id, driverId: driver2._id }, adminToken);
    assert.equal(reassignment.status, 201);
    assert.equal((await call('/collection-requests/from-bin', 'POST', { binId: bin._id, driverId: driver1._id }, adminToken)).status, 409);

    const sensorBin = await Bin.create({ binCode: 'BIN-001', name: 'Adama Central Bin', type: 'bin', zone: 'Central' });
    assert.equal((await deviceCall('/bins/BIN-001/sensor-state', 'GET', undefined, '')).status, 401);
    assert.equal((await deviceCall('/bins/BIN-001/sensor-state', 'GET', undefined, 'incorrect-key')).status, 401);
    assert.equal((await call('/bins/BIN-001/sensor-state', 'GET', undefined, adminToken)).status, 401);
    const initialDeviceState = await deviceCall('/bins/BIN-001/sensor-state');
    assert.equal(initialDeviceState.status, 200);
    assert.equal(initialDeviceState.body.data.canTransmit, true);
    assert.equal(initialDeviceState.body.data.binId, 'BIN-001');
    const originalCycle = initialDeviceState.body.data.cycleId;
    const sensorReading = (fillLevel, status, sequence, cycleId = originalCycle) =>
      deviceCall('/bins/BIN-001/sensor', 'POST', { binId: 'BIN-001', fillLevel, status, sequence, cycleId });

    assert.equal((await sensorReading(101, 'FULL', 1)).status, 400);
    assert.equal((await deviceCall('/bins/BIN-001/sensor', 'POST', {
      binId: 'BIN-002', fillLevel: 10, status: 'NORMAL', sequence: 1, cycleId: originalCycle,
    })).status, 400);
    assert.equal((await sensorReading(49, 'HIGH', 1)).status, 400);
    assert.equal((await sensorReading(49, 'NORMAL', 0)).status, 400);
    let sensorResult = await sensorReading(49, 'NORMAL', 1);
    assert.equal(sensorResult.status, 200);
    assert.equal(sensorResult.body.data.binId, 'BIN-001');
    assert.ok(sensorResult.body.data.lastUpdated);
    assert.equal(sensorResult.body.data.sensorStatus, 'NORMAL');
    assert.equal(sensorResult.body.data.sensorDeviceState, 'ONLINE');
    assert.equal((await sensorReading(49, 'NORMAL', 1)).status, 409);
    assert.equal((await sensorReading(48, 'NORMAL', 2)).status, 409);
    for (const [fillLevel, status, sequence] of [
      [50, 'ALMOST_FULL', 2],
      [80, 'HIGH', 3],
      [99, 'HIGH', 4],
      [100, 'FULL', 5],
    ]) {
      sensorResult = await sensorReading(fillLevel, status, sequence);
      assert.equal(sensorResult.status, 200);
      assert.equal(sensorResult.body.data.sensorStatus, status);
    }
    assert.equal(sensorResult.body.data.sensorDeviceState, 'STOPPED_AFTER_FULL');
    assert.equal((await sensorReading(100, 'FULL', 6)).status, 409);
    assert.equal((await call(`/bins/${sensorBin._id}/simulated-reading`, 'POST', { fillLevel: 0 }, adminToken)).status, 409);
    await Bin.updateOne({ _id: sensorBin._id }, { $set: { lastReadingAt: new Date(Date.now() - 121 * 60 * 1000) } });
    const staleFullBin = await call(`/bins/${sensorBin._id}`);
    assert.equal(staleFullBin.body.data.fillCondition, 'collection-needed');
    const fullDeviceState = await deviceCall('/bins/BIN-001/sensor-state');
    assert.equal(fullDeviceState.body.data.canTransmit, false);
    assert.equal(fullDeviceState.body.data.fillLevel, 100);
    const publicBin = await call('/bins/BIN-001');
    assert.equal(publicBin.body.data.sensorCycleId, undefined);
    assert.equal(publicBin.body.data.sensorSequence, undefined);

    const fullTask = await call('/collection-requests/from-bin', 'POST', { binId: sensorBin._id, driverId: driver1._id }, adminToken);
    assert.equal(fullTask.status, 201);
    assert.equal((await deviceCall('/bins/BIN-001/sensor-state')).body.data.canTransmit, false);
    assert.equal((await call(`/driver/tasks/${fullTask.body.data._id}/status`, 'PATCH', { status: 'in-progress' }, driver1Token)).status, 200);
    assert.equal((await call(`/driver/tasks/${fullTask.body.data._id}/status`, 'PATCH', { status: 'completed' }, driver1Token)).status, 200);

    const resetDeviceState = await deviceCall('/bins/BIN-001/sensor-state');
    assert.equal(resetDeviceState.status, 200);
    assert.equal(resetDeviceState.body.data.fillLevel, 0);
    assert.equal(resetDeviceState.body.data.status, 'NORMAL');
    assert.equal(resetDeviceState.body.data.canTransmit, true);
    assert.notEqual(resetDeviceState.body.data.cycleId, originalCycle);
    assert.equal(resetDeviceState.body.data.lastSequence, 0);
    assert.equal((await sensorReading(100, 'FULL', 6, originalCycle)).status, 409);
    const resumedReading = await deviceCall('/bins/BIN-001/sensor', 'POST', {
      binId: 'BIN-001',
      fillLevel: 5,
      status: 'NORMAL',
      sequence: 1,
      cycleId: resetDeviceState.body.data.cycleId,
    });
    assert.equal(resumedReading.status, 200);
    assert.equal(resumedReading.body.data.fillLevel, 5);
    assert.equal(resumedReading.body.data.sensorDeviceState, 'ONLINE');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (generatedEvidencePath && fs.existsSync(generatedEvidencePath)) fs.unlinkSync(generatedEvidencePath);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (previousDeviceKey === undefined) delete process.env.DEVICE_KEY;
    else process.env.DEVICE_KEY = previousDeviceKey;
  }
});
