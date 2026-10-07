/* ================================================================
   SmartBin Adama City — Express API Server (MongoDB)
   ================================================================ */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const connectDB  = require('./db/connect');

const authRoutes    = require('./routes/auth');
const binsRoutes    = require('./routes/bins');
const reportsRoutes = require('./routes/reports');
const collectionRequestsRoutes = require('./routes/collectionRequests');
const driversRoutes = require('./routes/drivers');
const driverTasksRoutes = require('./routes/driverTasks');
const statsRoutes   = require('./routes/stats');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── CORS ─────────────────────────────────────────────────── */
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());

/* ── BODY PARSERS ─────────────────────────────────────────── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── STATIC: serve uploaded images ───────────────────────── */
app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')));

/* ── ROUTES ───────────────────────────────────────────────── */
app.use('/api/auth',    authRoutes);
app.use('/api/bins',    binsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/collection-requests', collectionRequestsRoutes);
app.use('/api/drivers', driversRoutes);
app.use('/api/driver/tasks', driverTasksRoutes);
app.use('/api/stats',   statsRoutes);

/* ── ROOT ─────────────────────────────────────────────────── */
app.get('/', (req, res) => {
  res.json({
    name:    'SmartBin Adama City API',
    version: '1.0.0',
    status:  'running',
    database: 'MongoDB',
    endpoints: {
      auth:    '/api/auth',
      bins:    '/api/bins',
      reports: '/api/reports',
      collectionRequests: '/api/collection-requests',
      drivers: '/api/drivers',
      driverTasks: '/api/driver/tasks',
      stats:   '/api/stats',
    },
  });
});

/* ── 404 HANDLER ─────────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found.` });
});

/* ── GLOBAL ERROR HANDLER ─────────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: `File too large. Max ${process.env.MAX_FILE_SIZE_MB || 5} MB.` });
  }
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

/* ── START: connect to MongoDB then listen ────────────────── */
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │   SmartBin Adama City — API Server          │');
    console.log(`  │   Running on  http://localhost:${PORT}         │`);
    console.log(`  │   Database:   MongoDB                       │`);
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');
    console.log('  Endpoints:');
    console.log(`    GET  http://localhost:${PORT}/api/stats`);
    console.log(`    GET  http://localhost:${PORT}/api/bins`);
    console.log(`    POST http://localhost:${PORT}/api/reports`);
    console.log(`    POST http://localhost:${PORT}/api/collection-requests`);
    console.log(`    POST http://localhost:${PORT}/api/auth/login`);
    console.log('');
  });
});
