#!/usr/bin/env node
// ================================================================
// SEED SCRIPT — uploads sample CSVs to Firebase Storage + Firestore
// Uses REST APIs with the firebase-tools stored access token.
// Run from project root:  node scripts/seed.js
// ================================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PROJECT   = 'race-arena-d1bc8';
const BUCKET    = 'race-arena-d1bc8.firebasestorage.app';
const SEED_UID  = 'seed_system';
const SEED_USER = 'race_arena';
const SEED_NAME = 'Race Arena';
const DATA_DIR  = path.join(__dirname, '../data');
const FILES     = ['36.csv', '37.csv', '38.csv'];

// ── Use stored access token from firebase-tools ──────────────────
const fbConfig = JSON.parse(
  fs.readFileSync(path.join(process.env.HOME, '.config/configstore/firebase-tools.json'), 'utf8')
);
const ACCESS_TOKEN = fbConfig.tokens.access_token;
async function getAccessToken() { return ACCESS_TOKEN; }

// ── Firestore: write a document ──────────────────────────────────
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { doubleValue: v };
  return { stringValue: String(v) };
}
function toFsDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFsValue(v);
  return { fields };
}

async function fsWrite(collection, docId, data) {
  const token = await getAccessToken();
  const url   = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${docId}`;
  const res   = await fetch(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(toFsDoc(data)),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore write [${collection}/${docId}] ${res.status}: ${txt}`);
  }
}

async function fsExists(collection, docId) {
  const token = await getAccessToken();
  const url   = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${docId}`;
  const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok;
}

// ── Firebase Storage: upload a file ─────────────────────────────
async function storageUpload(storagePath, content) {
  const token   = await getAccessToken();
  const encoded = encodeURIComponent(storagePath);
  const url     = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encoded}`;
  const buf     = Buffer.from(content, 'utf8');

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'text/csv',
      'Content-Length': String(buf.length),
    },
    body: buf,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Storage upload failed ${res.status}: ${txt}`);
  }
  return storagePath;
}

// ── CSV parser ───────────────────────────────────────────────────
function parseCSVLine(line) {
  const r = []; let cur = ''; let inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { r.push(cur); cur = ''; }
    else cur += c;
  }
  r.push(cur); return r;
}

function parseAimCSV(text) {
  const lines = text.split(/\r?\n/);
  const meta  = {};
  let headers = null, colMap = {}, dataStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i].trim());
    const key   = cells[0];
    if      (key === 'Session')  meta.session = cells[1] || '';
    else if (key === 'Vehicle')  meta.vehicle = cells[1] || '';
    else if (key === 'Racer')    meta.racer   = cells[1] || '';
    else if (key === 'Date')     meta.date    = cells[1] || '';
    else if (key === 'Time') {
      if (cells.length < 5) meta.time = cells[1] || '';
      else {
        headers = cells.map(h => h.trim());
        headers.forEach((h, i) => { colMap[h] = i; });
        dataStart = i + 3; break;
      }
    }
    else if (key === 'Beacon Markers')
      meta.beaconMarkers = cells.slice(1).filter(v => v.trim()).map(Number);
    else if (key === 'Segment Times')
      meta.segmentTimes = cells.slice(1).filter(v => v.trim());
  }
  if (dataStart < 0) return null;

  const col  = (c, n) => { const i = colMap[n]; return i !== undefined ? parseFloat(c[i]) || 0 : 0; };
  const rows = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i].trim());
    if (cells.length < 5) continue;
    rows.push({
      time:     col(cells, 'Time'),
      speed:    col(cells, 'GPS Speed'),
      lat:      col(cells, 'GPS Latitude'),
      lon:      col(cells, 'GPS Longitude'),
      brake:    Math.max(0, col(cells, 'BRAKE PRESS')),
      throttle: col(cells, 'THROTTLE POS'),
      dist:     col(cells, 'Distance on GPS Speed'),
    });
  }
  return { meta, rows };
}

function parseTimeStr(s) {
  if (!s || s === '?') return 9999;
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  return m ? parseInt(m[1]) * 60 + parseFloat(m[2]) : parseFloat(s) || 9999;
}

function extractLaps(session) {
  const { meta, rows } = session;
  const beacons  = (meta.beaconMarkers || []).slice();
  const segTimes = meta.segmentTimes   || [];
  if (!beacons.length) return [];

  const boundaries = [0, ...beacons];
  const laps = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const t0 = boundaries[i], t1 = boundaries[i + 1];
    if (rows.filter(r => r.time >= t0 && r.time <= t1).length < 20) continue;
    const timeStr = segTimes[i] || '?';
    laps.push({
      lapIdx: i, lapNumber: i + 1,
      lapTime: timeStr, timeSeconds: parseTimeStr(timeStr),
      date: meta.date || '', sessionLabel: meta.session || '',
      isOutLap: i === 0,
      isInLap:  i === boundaries.length - 2 && boundaries.length > 2,
    });
  }
  return laps;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  for (const file of FILES) {
    const csvPath = path.join(DATA_DIR, file);
    const csvText = fs.readFileSync(csvPath, 'utf8');
    const hash    = crypto.createHash('sha256').update(csvText).digest('hex');

    console.log(`\n📂  ${file}  (hash ${hash.slice(0, 8)}…)`);

    if (await fsExists(`users/${SEED_UID}/sessions`, hash)) {
      console.log('  ↩ already seeded'); continue;
    }

    const session = parseAimCSV(csvText);
    if (!session) { console.log('  ⚠ parse failed'); continue; }

    const laps = extractLaps(session);
    console.log(`  ${laps.length} laps`);

    const storagePath = `csvs/${SEED_UID}/${hash}.csv`;
    process.stdout.write('  ↑ uploading CSV to Storage… ');
    await storageUpload(storagePath, csvText);
    console.log('✔');

    process.stdout.write('  ✎ writing Firestore… ');
    // Session dedup record
    await fsWrite(`users/${SEED_UID}/sessions`, hash, {
      uploadedBy: SEED_UID, username: SEED_USER,
      sessionHash: hash,
      trackName: session.meta.session || '',
    });

    for (const lap of laps) {
      const lapDocId = `${hash}_${lap.lapIdx}`;
      const lapData  = {
        sessionHash: hash, lapIdx: lap.lapIdx, lapId: lapDocId,
        uid: SEED_UID, username: SEED_USER, displayName: SEED_NAME,
        lapTime: lap.lapTime, timeSeconds: lap.timeSeconds,
        date: lap.date, sessionLabel: lap.sessionLabel,
        trackName: lap.sessionLabel || '',
        isOutLap: lap.isOutLap, isInLap: lap.isInLap,
        csvPath: storagePath,
      };
      await fsWrite(`users/${SEED_UID}/laps`, lapDocId, lapData);
      await fsWrite('laps', lapDocId, lapData);
    }
    console.log('✔');

    laps.forEach(l => {
      const flag = l.isOutLap ? ' [OUT]' : l.isInLap ? ' [IN]' : '';
      console.log(`    lap ${l.lapNumber}  ${l.lapTime}${flag}`);
    });
  }

  console.log('\n✅  Done.');
  process.exit(0);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
