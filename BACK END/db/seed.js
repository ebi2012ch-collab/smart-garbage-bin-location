/* ================================================================
   SmartBin — Database Seeder
   Run with:  node db/seed.js
   Seeds 10 bins and 1 admin user into MongoDB.
   ================================================================ */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const Bin      = require('../models/Bin');
const Report   = require('../models/Report');
const User     = require('../models/User');

const BINS = [
  { binCode:'BIN-001', name:'Adama Central Bin', type:'bin', status:'available', lat:8.5400, lng:39.2700, description:'Central city garbage point.', zone:'Central', capacity:500, fillLevel:20 },
  { name:'Market Area Bin',        type:'bin',        status:'almost-full', lat:8.5450, lng:39.2780, description:'Near the main market.',               zone:'Market',       capacity:500,  fillLevel:78  },
  { name:'Hospital Road Bin',      type:'bin',        status:'available',   lat:8.5360, lng:39.2650, description:'Adjacent to Adama General Hospital.', zone:'Hospital Road',capacity:300,  fillLevel:35  },
  { name:'Railway Station Point',  type:'collection', status:'available',   lat:8.5490, lng:39.2620, description:'Large collection transfer station.',  zone:'Railway',      capacity:2000, fillLevel:40  },
  { name:'Residential Zone A Bin', type:'bin',        status:'full',        lat:8.5310, lng:39.2750, description:'Needs immediate service.',             zone:'Residential A',capacity:300,  fillLevel:100 },
  { name:'Recycling Centre East',  type:'recycle',    status:'available',   lat:8.5430, lng:39.2840, description:'Paper, plastic & glass recycling.',   zone:'East',         capacity:1000, fillLevel:15  },
  { name:'Industrial Area Bin',    type:'bin',        status:'available',   lat:8.5520, lng:39.2700, description:'Serving the industrial district.',    zone:'Industrial',   capacity:1000, fillLevel:30  },
  { name:'School Zone Recycle',    type:'recycle',    status:'almost-full', lat:8.5370, lng:39.2820, description:'Recycling point for school district.',zone:'School Zone',  capacity:500,  fillLevel:72  },
  { name:'South Zone Bin',         type:'bin',        status:'available',   lat:8.5280, lng:39.2680, description:'South residential zone.',             zone:'South',        capacity:300,  fillLevel:25  },
  { name:'North Market Bin',       type:'bin',        status:'full',        lat:8.5560, lng:39.2760, description:'Needs urgent collection.',            zone:'North',        capacity:500,  fillLevel:100 },
];

const SAMPLE_REPORTS = [
  { fullName:'Lemma Tadesse', phone:'0911234567', location:'Market Area, near main entrance', problemType:'overflow', priority:'high',   description:'The bin is completely overflowing and causing a bad smell.', status:'resolved' },
  { fullName:'Fatuma Alemu',  phone:'0922345678', location:'Zone B, behind the school',       problemType:'illegal',  priority:'medium', description:'Illegal waste dumping behind the school fence.',             status:'pending'  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[Seed] Connected to MongoDB');

    // Clear existing data
    await Bin.deleteMany({});
    await Report.deleteMany({});
    await User.deleteMany({});
    console.log('[Seed] Cleared existing data');

    // Seed bins
    await Bin.insertMany(BINS.map(bin => ({ ...bin, readingSource: 'simulated', lastReadingAt: new Date() })));
    console.log(`[Seed] Inserted ${BINS.length} bins with clearly labeled simulated demo readings`);

    // Seed reports
    for (const r of SAMPLE_REPORTS) {
      await new Report(r).save();
    }
    console.log(`[Seed] Inserted ${SAMPLE_REPORTS.length} sample reports`);

    // Seed admin user
    const rawPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hashed = await bcrypt.hash(rawPassword, 10);
    const adminUser = new User({
      username:     process.env.ADMIN_USERNAME || 'admin',
      passwordHash: hashed,
      role:         'admin',
    });
    await adminUser.save();
    console.log(`[Seed] Admin user created → username: ${adminUser.username}`);

    console.log('\n[Seed] ✅ Database seeded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Seed] ERROR:', err.message);
    process.exit(1);
  }
}

seed();
