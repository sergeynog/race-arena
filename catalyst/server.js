// ============================================================
// Garmin Catalyst Reader — server.js
// Watches for Catalyst USB mount, reads FIT files, serves UI
// ============================================================

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');
const FitParser = require('fit-file-parser').default;

const app = express();
const PORT = process.env.PORT || 4321;
const SESSIONS_DIR = path.join(__dirname, 'sessions');

// Known Garmin Catalyst volume names and FIT file paths
const GARMIN_VOLUME_NAMES = ['GARMIN', 'CATALYST', 'NO NAME'];
const FIT_SEARCH_PATHS = [
  'GARMIN/ACTIVITY',
  'GARMIN/SESSION',
  'Activity',
  'Session',
  '.',
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── State ──────────────────────────────────────────────────
let deviceStatus = { connected: false, volume: null, lastScan: null, fileCount: 0 };
let clients = []; // SSE clients

// ── SSE — push status updates to browser ─────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'status', ...deviceStatus });
  clients.push(send);

  req.on('close', () => {
    clients = clients.filter(c => c !== send);
  });
});

function broadcast(data) {
  clients.forEach(send => send(data));
}

// ── USB Volume Detection ──────────────────────────────────
function findGarminVolume() {
  return new Promise((resolve) => {
    exec('ls /Volumes', (err, stdout) => {
      if (err) return resolve(null);
      const volumes = stdout.trim().split('\n');
      const match = volumes.find(v =>
        GARMIN_VOLUME_NAMES.some(name => v.toUpperCase().includes(name))
      );
      resolve(match ? `/Volumes/${match}` : null);
    });
  });
}

async function findFitFiles(volumePath) {
  const found = [];

  async function scan(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(full);
      } else if (entry.name.toLowerCase().endsWith('.fit')) {
        found.push(full);
      }
    }
  }

  await scan(volumePath);
  return found;
}

// ── FIT File Parser ───────────────────────────────────────
function parseFitFile(filePath) {
  return new Promise((resolve, reject) => {
    const buffer = fs.readFileSync(filePath);
    const parser = new FitParser({
      force: true,
      speedUnit: 'mph',
      lengthUnit: 'mi',
      temperatureUnit: 'fahrenheit',
      elapsedRecordField: true,
      mode: 'list',
    });

    parser.parse(buffer, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

function extractSession(fitData, filePath) {
  const fileName = path.basename(filePath, '.fit');

  // Pull session record
  const sessionMsg = fitData.sessions?.[0] || {};
  const laps = fitData.laps || [];
  const records = fitData.records || [];

  // Build lap summaries
  const lapSummaries = laps.map((lap, i) => ({
    lapNumber: i + 1,
    totalTime: lap.total_elapsed_time,
    totalTimeFmt: formatTime(lap.total_elapsed_time),
    totalDistance: lap.total_distance,
    maxSpeed: lap.max_speed,
    avgSpeed: lap.avg_speed,
    startTime: lap.start_time,
    enhanced: lap.enhanced_avg_speed || null,
  }));

  // GPS track (downsample to ~500 pts to keep JSON small)
  const step = Math.max(1, Math.floor(records.length / 500));
  const track = records
    .filter((_, i) => i % step === 0)
    .filter(r => r.position_lat && r.position_long)
    .map(r => ({
      lat: r.position_lat,
      lon: r.position_long,
      speed: r.speed,
      t: r.elapsed_time,
    }));

  // Coaching / events (Catalyst-specific messages)
  const events = fitData.events || [];
  const coaching = fitData.coaching_events || fitData.coach_suggestions || [];

  return {
    id: fileName,
    file: path.basename(filePath),
    importedAt: new Date().toISOString(),
    date: sessionMsg.start_time || null,
    sport: sessionMsg.sport || 'auto_racing',
    totalTime: sessionMsg.total_elapsed_time,
    totalTimeFmt: formatTime(sessionMsg.total_elapsed_time),
    totalDistance: sessionMsg.total_distance,
    maxSpeed: sessionMsg.max_speed,
    avgSpeed: sessionMsg.avg_speed,
    lapCount: laps.length,
    laps: lapSummaries,
    track,
    events,
    coaching,
    raw: {
      sessionMsg,
      deviceInfo: fitData.device_infos?.[0] || {},
    },
  };
}

function formatTime(seconds) {
  if (!seconds) return '--';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

// ── Scan Device & Import ──────────────────────────────────
async function scanDevice() {
  const volume = await findGarminVolume();

  if (!volume) {
    deviceStatus = { connected: false, volume: null, lastScan: new Date().toISOString(), fileCount: 0 };
    broadcast({ type: 'status', ...deviceStatus });
    return { connected: false, imported: 0, skipped: 0 };
  }

  deviceStatus.connected = true;
  deviceStatus.volume = volume;
  broadcast({ type: 'status', ...deviceStatus, scanning: true });

  const fitFiles = await findFitFiles(volume);
  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const filePath of fitFiles) {
    const id = path.basename(filePath, '.fit');
    const destFile = path.join(SESSIONS_DIR, `${id}.json`);

    if (fs.existsSync(destFile)) {
      skipped++;
      continue;
    }

    try {
      const fitData = await parseFitFile(filePath);
      const session = extractSession(fitData, filePath);
      await fsp.writeFile(destFile, JSON.stringify(session, null, 2));
      imported++;
      broadcast({ type: 'imported', session: { id: session.id, date: session.date, totalTimeFmt: session.totalTimeFmt, lapCount: session.lapCount } });
    } catch (err) {
      errors.push({ file: path.basename(filePath), error: err.message });
    }
  }

  deviceStatus.lastScan = new Date().toISOString();
  deviceStatus.fileCount = fitFiles.length;
  broadcast({ type: 'status', ...deviceStatus, scanning: false });

  return { connected: true, volume, total: fitFiles.length, imported, skipped, errors };
}

// ── Polling — check for device every 5s ──────────────────
let wasConnected = false;
setInterval(async () => {
  const volume = await findGarminVolume();
  const isConnected = !!volume;

  if (isConnected && !wasConnected) {
    console.log(`[catalyst] Device mounted at ${volume} — scanning...`);
    await scanDevice();
  } else if (!isConnected && wasConnected) {
    console.log('[catalyst] Device removed');
    deviceStatus = { connected: false, volume: null, lastScan: new Date().toISOString(), fileCount: 0 };
    broadcast({ type: 'status', ...deviceStatus });
  }

  wasConnected = isConnected;
}, 5000);

// ── API Routes ────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json(deviceStatus));

app.post('/api/scan', async (req, res) => {
  const result = await scanDevice();
  res.json(result);
});

app.get('/api/sessions', async (req, res) => {
  try {
    const files = await fsp.readdir(SESSIONS_DIR);
    const sessions = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
      const raw = await fsp.readFile(path.join(SESSIONS_DIR, f), 'utf8');
      const s = JSON.parse(raw);
      // Return summary only (no track data)
      sessions.push({
        id: s.id, date: s.date, totalTimeFmt: s.totalTimeFmt,
        totalDistance: s.totalDistance, maxSpeed: s.maxSpeed,
        lapCount: s.lapCount, laps: s.laps,
      });
    }
    sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(sessions);
  } catch {
    res.json([]);
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  const raw = await fsp.readFile(filePath, 'utf8');
  res.json(JSON.parse(raw));
});

app.delete('/api/sessions/:id', async (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${req.params.id}.json`);
  try { await fsp.unlink(filePath); res.json({ ok: true }); }
  catch { res.status(404).json({ error: 'Not found' }); }
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Garmin Catalyst Reader`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${getLocalIP()}:${PORT}`);
  console.log(`\n  Plug in your Catalyst via USB to start importing.\n`);
});

function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
