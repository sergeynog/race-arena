// ============================================================
// CSV PARSER
// Race Coach AI — parser.js
// Parses AiM Race Studio CSV exports into lap objects.
// ============================================================

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

function parseAimCSV(text) {
  const lines = text.split(/\r?\n/);
  const meta = {};
  let headers = null;
  let colMap = {};
  let dataStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = parseCSVLine(line);
    const key = cells[0];

    if (key === 'Session') meta.session = cells[1] || '';
    else if (key === 'Vehicle') meta.vehicle = cells[1] || '';
    else if (key === 'Racer') meta.racer = cells[1] || '';
    else if (key === 'Date') meta.date = cells[1] || '';
    else if (key === 'Time') {
      if (cells.length < 5) { meta.time = cells[1] || ''; }
      else {
        // Data header row
        headers = cells.map(h => h.trim());
        headers.forEach((h, idx) => { colMap[h] = idx; });
        // Skip units row + empty row
        dataStartLine = i + 3;
        break;
      }
    }
    else if (key === 'Sample Rate') meta.sampleRate = parseFloat(cells[1]) || 20;
    else if (key === 'Duration') meta.duration = parseFloat(cells[1]) || 0;
    else if (key === 'Beacon Markers') {
      meta.beaconMarkers = cells.slice(1).filter(v => v && v.trim()).map(v => parseFloat(v));
    }
    else if (key === 'Segment Times') {
      meta.segmentTimes = cells.slice(1).filter(v => v && v.trim());
    }
  }

  if (dataStartLine < 0 || !headers) return null;

  // Helper to get column value
  const col = (cells, name) => {
    const idx = colMap[name];
    return idx !== undefined ? parseFloat(cells[idx]) || 0 : 0;
  };

  const rows = [];
  for (let i = dataStartLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = parseCSVLine(line);
    if (cells.length < 5) continue;
    rows.push({
      time:     col(cells, 'Time'),
      speed:    col(cells, 'GPS Speed'),
      latAcc:   col(cells, 'GPS LatAcc'),
      lonAcc:   col(cells, 'GPS LonAcc'),
      lat:      col(cells, 'GPS Latitude'),
      lon:      col(cells, 'GPS Longitude'),
      brake:    Math.max(0, col(cells, 'BRAKE PRESS')),
      throttle: col(cells, 'THROTTLE POS'),
      accelPos: col(cells, 'ACCEL POS'),
      steer:    col(cells, 'STEER ANGLE'),
      rpm:      col(cells, 'RPM dup 2') || col(cells, 'RPM dup 1'),
      dist:     col(cells, 'Distance on GPS Speed'),
    });
  }

  return { meta, rows };
}

// sessionId = SHA-256 hex of full CSV (same key used in Storage path + Firestore).
function extractLaps(session, sessionId) {
  const { meta, rows } = session;
  const beacons = (meta.beaconMarkers || []).slice();
  const segTimes = meta.segmentTimes || [];
  if (!beacons.length) return [];

  const boundaries = [0, ...beacons];
  const laps = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const t0 = boundaries[i];
    const t1 = boundaries[i + 1];
    const lapRows = rows.filter(r => r.time >= t0 && r.time <= t1);
    if (lapRows.length < 20) continue;

    const startDist = lapRows[0].dist;
    const data = lapRows.map(r => ({
      ...r,
      dist: Math.max(0, r.dist - startDist),
      lapTime: r.time - t0,
    }));

    const timeStr = segTimes[i] || '?';
    const timeSeconds = parseTimeStr(timeStr);

    laps.push({
      id: `${sessionId}_${i}`,
      sessionId,
      lapNumber: i + 1,
      session: meta.session,
      date: meta.date,
      sessionTime: meta.time,
      vehicle: meta.vehicle,
      racer: meta.racer,
      timeStr,
      timeSeconds,
      data,
      lapDist: data[data.length - 1]?.dist || 0,
      isOutLap: i === 0,
      isInLap: i === boundaries.length - 2 && boundaries.length > 2,
    });
  }

  return laps;
}

function parseTimeStr(str) {
  if (!str || str === '?') return Infinity;
  const m = str.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  return parseFloat(str) || Infinity;
}
