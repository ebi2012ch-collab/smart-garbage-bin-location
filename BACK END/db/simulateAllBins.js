#!/usr/bin/env node
/* ================================================================
   SmartBin Adama City — Multi-Bin Software Simulator
   ================================================================
   Mimics what the Wokwi ESP32 does, but in Node.js, for every
   garbage bin registered in the database.

   Each bin runs its own independent fill cycle:
     0% → fills by FILL_STEP every SENSOR_INTERVAL ms
        → reaches 100% (FULL) → stops sending
        → waits for Admin to assign + Driver to complete collection
        → backend resets bin and rotates cycleId
        → simulator detects new cycleId → resumes from 0%

   Usage:
     cd "BACK END"
     node db/simulateAllBins.js

   Requirements:
     • Backend server must be running (npm run dev in another terminal)
     • DEVICE_KEY in .env must match what this script uses
     • No extra dependencies — uses only Node.js built-ins (http/https)
================================================================ */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

/* ── CONFIG ────────────────────────────────────────────────── */
const API_BASE        = process.env.SIMULATOR_API_URL || `http://localhost:${process.env.PORT || 3000}/api`;
const DEVICE_KEY      = process.env.DEVICE_KEY || '';
const FILL_STEP       = Number(process.env.SIM_FILL_STEP)       || 5;   // % per tick
const SENSOR_INTERVAL = Number(process.env.SIM_SENSOR_INTERVAL) || 8000; // ms between readings
const POLL_INTERVAL   = Number(process.env.SIM_POLL_INTERVAL)   || 6000; // ms between state polls when paused
const STAGGER_MS      = Number(process.env.SIM_STAGGER_MS)      || 1500; // ms between bin startup

/* ── VALIDATION ─────────────────────────────────────────────── */
if (!DEVICE_KEY) {
  console.error('[Simulator] ERROR: DEVICE_KEY is not set in BACK END/.env. Exiting.');
  process.exit(1);
}

/* ── HTTP HELPER (no external deps) ────────────────────────── */
const http  = require('http');
const https = require('https');

function apiRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(API_BASE + path);
    const lib    = url.protocol === 'https:' ? https : http;
    const data   = body ? JSON.stringify(body) : null;
    const opts   = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'x-device-key': DEVICE_KEY,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = lib.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ── STATUS HELPER — must match binCondition.js exactly ─────── */
function sensorStatusFor(fillLevel) {
  if (fillLevel >= 100) return 'FULL';
  if (fillLevel >= 80)  return 'HIGH';
  if (fillLevel >= 50)  return 'ALMOST_FULL';
  return 'NORMAL';
}

/* ── FETCH ALL GARBAGE BINS ─────────────────────────────────── */
async function fetchBins() {
  const res = await apiRequest('/bins?type=bin', 'GET');
  if (res.status !== 200 || !res.body.success) {
    throw new Error(`Could not fetch bins (HTTP ${res.status}): ${res.body.message || res.body}`);
  }
  return res.body.data.filter(b => b.type === 'bin');
}

/* ── PER-BIN SIMULATOR ──────────────────────────────────────── */
class BinSimulator {
  constructor(bin) {
    this.binCode       = bin.binCode || bin._id;
    this.binId         = bin._id;
    this.name          = bin.name;
    this.cycleId       = null;
    this.sequence      = 0;
    this.fillLevel     = 0;
    this.canTransmit   = false;
    this.stateLoaded   = false;
    this.timer         = null;
    this.stopped       = false;
  }

  log(msg) {
    const ts = new Date().toLocaleTimeString('en-GB');
    console.log(`[${ts}] [${this.binCode}] ${msg}`);
  }

  /* Poll GET /bins/:id/sensor-state to sync with the backend */
  async pollState() {
    try {
      const res = await apiRequest(`/bins/${encodeURIComponent(this.binCode)}/sensor-state`, 'GET');
      if (res.status !== 200 || !res.body.success) {
        this.log(`State poll failed (HTTP ${res.status}) — will retry.`);
        return false;
      }
      const d = res.body.data;
      if (!d.cycleId) {
        this.log('Backend returned no cycleId — will retry.');
        return false;
      }

      const newCycle = d.cycleId !== this.cycleId;
      if (newCycle) {
        this.log(`New cycle detected (${d.cycleId.slice(0, 8)}…). Resuming from ${d.fillLevel ?? 0}%.`);
        this.cycleId   = d.cycleId;
        this.fillLevel = d.fillLevel ?? 0;
        this.sequence  = d.lastSequence ?? 0;
      } else {
        // keep local fill level at least as high as what the server knows
        this.fillLevel = Math.max(this.fillLevel, d.fillLevel ?? 0);
        this.sequence  = Math.max(this.sequence, d.lastSequence ?? 0);
      }

      this.canTransmit  = d.canTransmit === true;
      this.stateLoaded  = true;
      this.log(
        `${d.fillLevel ?? 0}% | ${d.status || 'UNKNOWN'} | transmit: ${this.canTransmit ? 'YES' : 'NO'}`
      );
      return true;
    } catch (err) {
      this.log(`State poll error: ${err.message} — will retry.`);
      return false;
    }
  }

  /* Send one sensor reading */
  async sendReading() {
    const nextFill     = Math.min(100, this.fillLevel + FILL_STEP);
    const nextSequence = this.sequence + 1;
    const status       = sensorStatusFor(nextFill);

    const payload = {
      binId:     this.binCode,
      fillLevel: nextFill,
      status,
      cycleId:   this.cycleId,
      sequence:  nextSequence,
    };

    try {
      const res = await apiRequest(`/bins/${encodeURIComponent(this.binCode)}/sensor`, 'POST', payload);

      if (res.status === 200 && res.body.success) {
        this.fillLevel = nextFill;
        this.sequence  = nextSequence;
        this.log(`→ ${nextFill}% [${status}] seq=${nextSequence}`);

        if (nextFill >= 100) {
          this.canTransmit = false;
          this.log('FULL reached. Sensor uploads paused. Waiting for collection reset…');
        }
        return true;
      }

      if (res.status === 409) {
        // Stale cycle, duplicate seq, or bin already FULL — re-sync
        this.log(`409 from backend: "${res.body.message}" — refreshing state.`);
        this.stateLoaded = false;
        return false;
      }

      this.log(`Unexpected HTTP ${res.status}: ${res.body.message || JSON.stringify(res.body)}`);
      this.stateLoaded = false;
      return false;
    } catch (err) {
      this.log(`Send error: ${err.message}`);
      this.stateLoaded = false;
      return false;
    }
  }

  /* Main tick — called on every interval */
  async tick() {
    if (this.stopped) return;

    // Always sync state first if we haven't or if it's stale
    if (!this.stateLoaded) {
      await this.pollState();
    }

    if (!this.stateLoaded) return; // still waiting for backend

    if (this.canTransmit) {
      await this.sendReading();
    } else {
      // Bin is FULL or not ready — just poll for a reset
      await this.pollState();
    }
  }

  start(initialDelay = 0) {
    setTimeout(() => {
      this.log(`Starting simulation (fill step: +${FILL_STEP}% every ${SENSOR_INTERVAL / 1000}s).`);
      // First tick immediately, then on interval
      this.tick();
      this.timer = setInterval(() => this.tick(), SENSOR_INTERVAL);
    }, initialDelay);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.log('Stopped.');
  }
}

/* ── MAIN ───────────────────────────────────────────────────── */
async function main() {
  console.log('');
  console.log('  ┌────────────────────────────────────────────────┐');
  console.log('  │   SmartBin — Multi-Bin Software Simulator      │');
  console.log(`  │   API:        ${API_BASE.padEnd(33)}│`);
  console.log(`  │   Fill step:  +${String(FILL_STEP + '%').padEnd(5)} every ${String(SENSOR_INTERVAL / 1000 + 's').padEnd(22)}│`);
  console.log('  └────────────────────────────────────────────────┘');
  console.log('');

  // Wait for the backend to be reachable
  let bins = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      bins = await fetchBins();
      break;
    } catch (err) {
      if (attempt === 10) {
        console.error(`[Simulator] Could not reach backend after 10 attempts: ${err.message}`);
        console.error('[Simulator] Make sure the backend is running: npm run dev');
        process.exit(1);
      }
      console.log(`[Simulator] Backend not ready (attempt ${attempt}/10) — retrying in 3s…`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  if (!bins.length) {
    console.error('[Simulator] No garbage bins found in the database.');
    console.error('[Simulator] Run: node db/seed.js  or  node db/registerWokwiBin.js');
    process.exit(1);
  }

  console.log(`[Simulator] Found ${bins.length} bin(s): ${bins.map(b => b.binCode || b._id).join(', ')}`);
  console.log('[Simulator] Starting simulators with staggered startup…');
  console.log('');

  const simulators = bins.map((bin, i) => {
    const sim = new BinSimulator(bin);
    sim.start(i * STAGGER_MS); // stagger starts so they don't all hit the API at once
    return sim;
  });

  // Graceful shutdown
  function shutdown() {
    console.log('\n[Simulator] Shutting down…');
    simulators.forEach(s => s.stop());
    process.exit(0);
  }
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[Simulator] All simulators running. Press Ctrl+C to stop.');
  console.log('[Simulator] Keep this window open alongside "npm run dev".');
  console.log('');
}

main();
