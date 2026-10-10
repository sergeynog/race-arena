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

// ── CHANNEL MATCHING ──────────────────────────────────────────
// Channel names vary by car and logger setup (ECU-provided vs manual
// sensors), so each field lists name patterns in priority order. A column
// is used for at most one field. `units` converts to km/h, m, bar, g, °C.
const CHANNEL_DEFS = {
  time:      { names: [/^Time$/i] },
  speed:     { names: [/^GPS Speed$/i, /^Speed$/i], units: 'speed' },
  latAcc:    { names: [/^GPS LatAcc$/i], units: 'acc' },
  lonAcc:    { names: [/^GPS LonAcc$/i], units: 'acc' },
  lat:       { names: [/^GPS Latitude$/i] },
  lon:       { names: [/^GPS Longitude$/i] },
  dist:      { names: [/^Distance on GPS Speed$/i, /^Distance$/i], units: 'length' },
  accelPos:  { names: [/^ACCEL POS$/i, /^PPS$/i, /pedal/i, /^Acc(el(erator)?)?[ _]?(Pos|Ped)/i] },
  throttle:  { names: [/^THROTTLE POS$/i, /^TPS$/i, /^Throttle([ _]?Pos(ition)?)?$/i, /^Thro(ttle)?[ _]?Plate[ _]?Corr/i, /throttle/i] },
  brake:     { names: [/^BRAKE PRESS(URE)?([ _]?F(RONT)?)?$/i, /^(Front[ _]?)?Brake[ _]?P(ress(ure)?)?$/i, /brake.*press/i, /^Brk[ _]?Pres/i], units: 'pressure' },
  steer:     { names: [/^STEER ANGLE$/i, /steer/i] },
  rpm:       { names: [/^RPM dup 2$/i, /^RPM dup 1$/i, /^RPM$/i, /^Engine[ _]?Speed$/i] },
  imuLonAcc: { names: [/^InlineAcc$/i], units: 'acc' },
  imuLatAcc: { names: [/^LateralAcc$/i], units: 'acc' },
  vertAcc:   { names: [/^VerticalAcc$/i], units: 'acc' },
  yawRate:   { names: [/^YawRate$/i] },
  alt:       { names: [/^GPS Altitude$/i], units: 'length' },
  slope:     { names: [/^GPS Slope$/i] },
  radius:    { names: [/^GPS Radius$/i], units: 'length' },
  wheelFL:   { names: [/(wheel|whl|wsp).*[\s_.-]F[ _]?L$/i, /(wheel|whl)[a-z]*FL$/i, /^(WS|WSS)[ _]?FL$/i], units: 'speed' },
  wheelFR:   { names: [/(wheel|whl|wsp).*[\s_.-]F[ _]?R$/i, /(wheel|whl)[a-z]*FR$/i, /^(WS|WSS)[ _]?FR$/i], units: 'speed' },
  wheelRL:   { names: [/(wheel|whl|wsp).*[\s_.-]R[ _]?L$/i, /(wheel|whl)[a-z]*RL$/i, /^(WS|WSS)[ _]?RL$/i], units: 'speed' },
  wheelRR:   { names: [/(wheel|whl|wsp).*[\s_.-]R[ _]?R$/i, /(wheel|whl)[a-z]*RR$/i, /^(WS|WSS)[ _]?RR$/i], units: 'speed' },
  coolant:   { names: [/coolant/i, /water[ _]?temp/i, /^ECT$/i], units: 'temp' },
  intakeAir: { names: [/intk|intake/i, /^IAT$/i], units: 'temp' },
};

// [scale, offset] to the app's units, keyed by the unit text in the CSV
const UNIT_CONVERSIONS = {
  speed:    { mph: [1.609344, 0], 'm/s': [3.6, 0] },
  length:   { ft: [0.3048, 0], km: [1000, 0], mi: [1609.344, 0] },
  pressure: { psi: [1 / 14.5038, 0], kpa: [0.01, 0], mpa: [10, 0] },
  acc:      { 'm/s2': [1 / 9.80665, 0], 'm/s^2': [1 / 9.80665, 0], 'm/s²': [1 / 9.80665, 0] },
  temp:     { f: [5 / 9, -32 * 5 / 9], '°f': [5 / 9, -32 * 5 / 9] },
};

// Units the app already uses, per conversion group (no conversion needed)
const NATIVE_UNITS = {
  speed: ['km/h', 'kph', 'kmh'], length: ['m'], pressure: ['bar'], acc: ['g'], temp: ['c', '°c'],
};

// issues (optional) collects { level, code, message } for the import check
function resolveChannels(headers, units, issues = []) {
  const used = new Set();
  const map = {};
  for (const [field, def] of Object.entries(CHANNEL_DEFS)) {
    let idx = -1;
    for (const re of def.names) {
      idx = headers.findIndex((h, i) => !used.has(i) && re.test(h));
      if (idx >= 0) break;
    }
    if (idx < 0) continue;
    used.add(idx);
    const unit = (units[idx] || '').trim().toLowerCase();
    const conv = def.units && UNIT_CONVERSIONS[def.units][unit];
    if (def.units && unit && !conv && !NATIVE_UNITS[def.units].includes(unit)) {
      issues.push({ level: 'warning', code: 'unknown_unit',
        message: `Unrecognised unit "${units[idx].trim()}" on "${headers[idx]}" — read as-is, values may be off.` });
    }
    const [scale, offset] = conv || [1, 0];
    map[field] = { idx, scale, offset, header: headers[idx], unit: (units[idx] || '').trim() };
  }
  return map;
}

function parseAimCSV(text, issues = []) {
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
        meta.units = parseCSVLine(lines[i + 1] || '');
        meta.channelHeaders = headers;
        colMap = resolveChannels(headers, meta.units, issues);
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

  const fields = Object.keys(CHANNEL_DEFS);
  const rows = [];
  for (let i = dataStartLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = parseCSVLine(line);
    if (cells.length < 5) continue;
    const row = {};
    for (const f of fields) {
      const c = colMap[f];
      row[f] = c ? (parseFloat(cells[c.idx]) || 0) * c.scale + c.offset : 0;
    }
    row.brake = Math.max(0, row.brake);
    rows.push(row);
  }

  // Distance: integrate GPS speed rather than trusting the logger's distance
  // column — some exports scale it wrongly (a Rush SR file reads ~10.8× too
  // long). Matches AiM's own "Distance on GPS Speed" to 0.1 m on correct files.
  const loggerDist = rows.length ? rows[rows.length - 1].dist - rows[0].dist : 0;
  for (let i = 0; i < rows.length; i++) {
    rows[i].dist = i === 0 ? 0
      : rows[i - 1].dist + (rows[i].speed + rows[i - 1].speed) / 2 / 3.6 * Math.max(0, rows[i].time - rows[i - 1].time);
  }
  const gpsDist = rows.length ? rows[rows.length - 1].dist : 0;
  if (colMap.dist && gpsDist > 500 && Math.abs(loggerDist / gpsDist - 1) > 0.03) {
    issues.push({ level: 'warning', code: 'distance_mismatch',
      message: `The logger's distance channel is ${(loggerDist / gpsDist).toFixed(2)}× the GPS distance — using GPS distance instead.` });
  }

  // Percent channels that run far past 100 are raw sensor values, not % —
  // drop them rather than chart nonsense (e.g. "Throttle Plates" 37–691).
  for (const f of ['accelPos', 'throttle']) {
    if (!colMap[f]) continue;
    const v = rows.map(r => r[f]).sort((a, b) => a - b);
    if (v[Math.floor(v.length * 0.95)] > 110) {
      issues.push({ level: 'warning', code: 'percent_out_of_range',
        message: `"${colMap[f].header}" is labelled ${colMap[f].unit || '%'} but reads up to ${Math.round(v[v.length - 1])} — not a percentage, so it was ignored.` });
      delete colMap[f];
      rows.forEach(r => { r[f] = 0; });
    }
  }

  // Fields this file actually logs (channels absent from the file read as 0)
  meta.channels = Object.keys(colMap);
  return { meta, rows };
}

// ── IMPORT CHECK ──────────────────────────────────────────────
// Parses a file and reports whether we can use it. errors block the import;
// warnings mean it imported but something looked off (and gets logged).
const IMPORT_REQUIRED = { time: 'Time', speed: 'GPS Speed', lat: 'GPS Latitude', lon: 'GPS Longitude' };

function checkImport(text) {
  const issues = [];
  const err  = (code, message) => issues.push({ level: 'error', code, message });
  const warn = (code, message) => issues.push({ level: 'warning', code, message });

  if (!/^\s*"?Format"?\s*,\s*"?AiM CSV File/m.test(text.slice(0, 2000))) {
    warn('not_aim_format', 'File doesn\'t start with "Format, AiM CSV File" — expected a CSV export from AiM Race Studio.');
  }
  const parsed = parseAimCSV(text, issues);
  if (!parsed) {
    err('no_data_header', 'No telemetry table found (expected a header row starting "Time, GPS Speed, …"). Export the session from Race Studio as CSV.');
    return { parsed: null, laps: [], issues };
  }

  const have = new Set(parsed.meta.channels);
  const missing = Object.entries(IMPORT_REQUIRED).filter(([f]) => !have.has(f)).map(([, name]) => name);
  if (missing.length) err('missing_channels', `Missing required channel${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
  if (!parsed.rows.length) err('no_rows', 'The telemetry table has no data rows.');
  if (!(parsed.meta.beaconMarkers || []).length) {
    err('no_laps', 'No lap markers ("Beacon Markers") — the session needs a start/finish line set in Race Studio before exporting.');
  }

  const laps = issues.some(i => i.level === 'error') ? [] : extractLaps(parsed, 'check');
  if (!issues.some(i => i.level === 'error') && !laps.some(l => !l.isOutLap && !l.isInLap)) {
    err('no_timed_laps', 'No complete timed laps found between the lap markers.');
  }

  // Values no car produces usually mean a sensor/unit setup problem
  const max = f => parsed.rows.reduce((m, r) => Math.max(m, r[f]), -Infinity);
  if (have.has('speed') && max('speed') > 400) warn('implausible_speed', `GPS speed peaks at ${Math.round(max('speed'))} km/h — check the speed unit.`);
  if (have.has('brake') && max('brake') > 300) warn('implausible_brake', `Brake pressure peaks at ${Math.round(max('brake'))} bar — the sensor's scaling may be wrong; braking detection still works.`);
  if (have.has('latAcc') && max('latAcc') > 4) warn('implausible_g', `Lateral G peaks at ${max('latAcc').toFixed(1)} g — check the acceleration unit.`);

  // Lap lengths should agree within a session
  const timed = laps.filter(l => !l.isOutLap && !l.isInLap).map(l => l.lapDist).sort((a, b) => a - b);
  if (timed.length >= 3) {
    const mid = timed[timed.length >> 1];
    const odd = timed.filter(d => Math.abs(d / mid - 1) > 0.1).length;
    if (odd) warn('lap_length_spread', `${odd} of ${timed.length} laps differ from the typical lap length (${Math.round(mid)} m) by over 10% — possibly missed or extra lap markers.`);
  }

  return { parsed, laps, issues };
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
      channels: meta.channels || [],
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
