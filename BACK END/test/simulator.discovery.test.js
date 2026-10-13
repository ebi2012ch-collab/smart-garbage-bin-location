const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

test('software simulator starts readings for bins added after startup', async t => {
  const bins = [{
    _id: 'bin-one',
    binCode: 'BIN-ONE',
    name: 'First bin',
    type: 'bin',
    fillLevel: null,
    lastReadingAt: null,
    lastCollectionAt: null,
  }];
  const sensorStates = new Map();
  const readings = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && url.pathname === '/api/bins') {
      res.end(JSON.stringify({ success: true, data: bins }));
      return;
    }

    const stateMatch = url.pathname.match(/^\/api\/bins\/([^/]+)\/sensor-state$/);
    if (req.method === 'GET' && stateMatch) {
      const binCode = decodeURIComponent(stateMatch[1]);
      let state = sensorStates.get(binCode);
      if (!state) {
        state = { cycleId: 'cycle-' + binCode, lastSequence: 0, fillLevel: 0 };
        sensorStates.set(binCode, state);
      }
      res.end(JSON.stringify({
        success: true,
        data: Object.assign({}, state, { canTransmit: true, status: 'NORMAL' }),
      }));
      return;
    }

    const sensorMatch = url.pathname.match(/^\/api\/bins\/([^/]+)\/sensor$/);
    if (req.method === 'POST' && sensorMatch) {
      const binCode = decodeURIComponent(sensorMatch[1]);
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(raw);
        const state = sensorStates.get(binCode);
        state.fillLevel = payload.fillLevel;
        state.lastSequence = payload.sequence;
        readings.set(binCode, (readings.get(binCode) || 0) + 1);
        res.end(JSON.stringify({ success: true, data: payload }));
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, message: 'Not found' }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'db', 'simulateAllBins.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      DEVICE_KEY: 'simulator-discovery-test-key',
      SIMULATOR_API_URL: `http://127.0.0.1:${address.port}/api`,
      SIM_SENSOR_INTERVAL: '25',
      SIM_POLL_INTERVAL: '25',
      SIM_STAGGER_MS: '1',
      SIM_DISCOVERY_INTERVAL: '25',
    }),
    stdio: 'ignore',
  });

  t.after(async () => {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
    });
    await new Promise(resolve => server.close(resolve));
  });

  await t.test('initial bin starts', async () => {
    await waitFor(() => (readings.get('BIN-ONE') || 0) > 0);
  });

  await t.test('newly added bin starts without restarting simulator', async () => {
    bins.push({
      _id: 'bin-two',
      binCode: 'BIN-TWO',
      name: 'Second bin',
      type: 'bin',
      fillLevel: null,
      lastReadingAt: null,
      lastCollectionAt: null,
    });
    await waitFor(() => (readings.get('BIN-TWO') || 0) > 0);
    assert.ok((readings.get('BIN-ONE') || 0) > 0);
    assert.ok((readings.get('BIN-TWO') || 0) > 0);
  });
});

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for simulator readings.'));
      }
    }, 10);
  });
}
