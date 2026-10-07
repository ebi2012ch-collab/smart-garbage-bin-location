/* ================================================================
   SmartBin — In-Memory Data Store
   Seeded from the frontend bin database and admin credentials.
   Replace with a real database (MongoDB / PostgreSQL) for production.
   ================================================================ */

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

/* ── BINS ──────────────────────────────────────────────────── */
const bins = [
  {
    id: 'bin-001',
    name: 'Adama Central Bin',
    type: 'bin',
    status: 'available',
    lat: 8.5400,
    lng: 39.2700,
    description: 'Central city garbage point. Capacity: 500L',
    zone: 'Central',
    capacity: 500,
    fillLevel: 20,
    lastServiced: '2026-07-27T06:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-002',
    name: 'Market Area Bin',
    type: 'bin',
    status: 'almost-full',
    lat: 8.5450,
    lng: 39.2780,
    description: 'Near the main market. Emptied twice daily.',
    zone: 'Market',
    capacity: 500,
    fillLevel: 78,
    lastServiced: '2026-07-28T05:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-003',
    name: 'Hospital Road Bin',
    type: 'bin',
    status: 'available',
    lat: 8.5360,
    lng: 39.2650,
    description: 'Adjacent to Adama General Hospital.',
    zone: 'Hospital Road',
    capacity: 300,
    fillLevel: 35,
    lastServiced: '2026-07-27T08:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-004',
    name: 'Railway Station Point',
    type: 'collection',
    status: 'available',
    lat: 8.5490,
    lng: 39.2620,
    description: 'Large collection transfer station.',
    zone: 'Railway',
    capacity: 2000,
    fillLevel: 40,
    lastServiced: '2026-07-28T04:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-005',
    name: 'Residential Zone A Bin',
    type: 'bin',
    status: 'full',
    lat: 8.5310,
    lng: 39.2750,
    description: 'Needs immediate service — overflowing.',
    zone: 'Residential A',
    capacity: 300,
    fillLevel: 100,
    lastServiced: '2026-07-25T06:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-006',
    name: 'Recycling Centre East',
    type: 'recycle',
    status: 'available',
    lat: 8.5430,
    lng: 39.2840,
    description: 'Paper, plastic & glass recycling.',
    zone: 'East',
    capacity: 1000,
    fillLevel: 15,
    lastServiced: '2026-07-28T07:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-007',
    name: 'Industrial Area Bin',
    type: 'bin',
    status: 'available',
    lat: 8.5520,
    lng: 39.2700,
    description: 'Serving the industrial district.',
    zone: 'Industrial',
    capacity: 1000,
    fillLevel: 30,
    lastServiced: '2026-07-27T09:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-008',
    name: 'School Zone Recycle',
    type: 'recycle',
    status: 'almost-full',
    lat: 8.5370,
    lng: 39.2820,
    description: 'Recycling point for school district.',
    zone: 'School Zone',
    capacity: 500,
    fillLevel: 72,
    lastServiced: '2026-07-26T08:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-009',
    name: 'South Zone Bin',
    type: 'bin',
    status: 'available',
    lat: 8.5280,
    lng: 39.2680,
    description: 'South residential zone.',
    zone: 'South',
    capacity: 300,
    fillLevel: 25,
    lastServiced: '2026-07-27T07:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'bin-010',
    name: 'North Market Bin',
    type: 'bin',
    status: 'full',
    lat: 8.5560,
    lng: 39.2760,
    description: 'Needs urgent collection.',
    zone: 'North',
    capacity: 500,
    fillLevel: 100,
    lastServiced: '2026-07-24T06:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

/* ── REPORTS ────────────────────────────────────────────────── */
const reports = [
  {
    id: 'RPT-2026-1001',
    fullName: 'Lemma Tadesse',
    phone: '0911234567',
    location: 'Market Area, near main entrance',
    problemType: 'overflow',
    priority: 'high',
    description: 'The bin is completely overflowing and causing a bad smell.',
    photoUrl: null,
    status: 'resolved',
    createdAt: '2026-07-28T07:00:00Z',
    resolvedAt: '2026-07-28T09:30:00Z',
  },
  {
    id: 'RPT-2026-1002',
    fullName: 'Fatuma Alemu',
    phone: '0922345678',
    location: 'Zone B, behind the school',
    problemType: 'illegal',
    priority: 'medium',
    description: 'Illegal waste dumping behind the school fence.',
    photoUrl: null,
    status: 'pending',
    createdAt: '2026-07-28T04:00:00Z',
    resolvedAt: null,
  },
];

/* ── USERS (admin accounts) ─────────────────────────────────── */
// Password is hashed at startup (see init function below)
const users = [
  {
    id: uuidv4(),
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: null, // filled by init()
    role: 'admin',
    createdAt: new Date().toISOString(),
  },
];

/* ── INIT: hash the admin password on first load ─────────────── */
async function init() {
  const rawPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
  users[0].passwordHash = await bcrypt.hash(rawPassword, 10);
  console.log('[DB] In-memory data store ready. Admin user seeded.');
}

module.exports = { bins, reports, users, init };
