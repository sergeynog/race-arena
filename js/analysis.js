// ============================================================
// TELEMETRY ANALYSIS
// Race Coach AI — analysis.js
// Corner detection (GPS curvature) and braking zone detection.
// Pure functions — no state dependencies.
// ============================================================

function detectBrakingZones(data) {
  const zones = [];
  let inZone = false;
  let startIdx = 0;
  const MIN_DURATION = 0.2; // seconds

  for (let i = 0; i <= data.length; i++) {
    const braking = i < data.length && (data[i].brake > 0.3 || data[i].lonAcc < -0.2);
    if (!inZone && braking) {
      inZone = true;
      startIdx = i;
    } else if (inZone && (!braking)) {
      const section = data.slice(startIdx, i);
      const duration = (data[i-1]?.lapTime || 0) - (data[startIdx]?.lapTime || 0);
      if (duration >= MIN_DURATION && section.length >= 3) {
        const minSpeed = Math.min(...section.map(d => d.speed));
        zones.push({
          startDist: data[startIdx].dist,
          endDist: data[i-1]?.dist || data[startIdx].dist,
          entrySpeed: data[startIdx].speed,
          minSpeed,
          peakBrake: Math.max(...section.map(d => d.brake)),
          duration,
        });
      }
      inZone = false;
    }
  }
  return zones;
}

function detectCorners(data) {
  // GPS-curvature-based corner detection.
  // For each point: compute heading change over a fixed ±D metre window,
  // giving signed curvature in rad/m independent of speed.

  const D            = 12;      // half-window in metres for curvature estimate
  const SMOOTH_WIN   = 4;       // moving-average half-window over curvature array
  const CURVE_THR    = 0.0032;  // rad/m ≈ radius < ~310 m counts as cornering
  const MIN_DIST     = 15;      // minimum corner length in metres
  const MERGE_GAP_M  = 12;      // merge corners closer than this in metres (keep doubles separate)

  const hasGPS = data.some(p => p.lat && p.lon);
  if (!hasGPS) return [];

  // ── 1. Signed curvature at every sample ──────────────────────────────────
  const cosLat = Math.cos((data.find(p => p.lat)?.lat ?? 0) * Math.PI / 180);
  const raw = data.map((p, i) => {
    if (!p.lat || !p.lon) return 0;
    // find sample ~D m before
    let jj = i;
    for (let j = i - 1; j >= 0; j--) {
      if (p.dist - data[j].dist >= D) { jj = j; break; }
    }
    // find sample ~D m after
    let kk = i;
    for (let k = i + 1; k < data.length; k++) {
      if (data[k].dist - p.dist >= D) { kk = k; break; }
    }
    if (jj === i || kk === i) return 0;
    const pj = data[jj], pk = data[kk];
    if (!pj.lat || !pk.lat) return 0;
    // heading in→ i and i →out (equirectangular)
    const hIn  = Math.atan2((p.lon  - pj.lon) * cosLat, p.lat  - pj.lat);
    const hOut = Math.atan2((pk.lon - p.lon)  * cosLat, pk.lat - p.lat);
    let dh = hOut - hIn;
    while (dh >  Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const span = Math.max(p.dist - pj.dist, 0.001);
    return dh / span;   // rad/m, positive = left turn
  });

  // ── 2. Smooth curvature to reduce GPS noise ───────────────────────────────
  const curv = raw.map((_, i) => {
    let sum = 0, cnt = 0;
    for (let w = -SMOOTH_WIN; w <= SMOOTH_WIN; w++) {
      const k = i + w;
      if (k >= 0 && k < raw.length) { sum += raw[k]; cnt++; }
    }
    return sum / cnt;
  });

  // ── 3. Threshold + direction-change → corner segments ───────────────────
  const corners = [];
  const pushCorner = (sIdx, eIdx) => {
    const section = data.slice(sIdx, eIdx);
    const spanM   = (section.at(-1)?.dist ?? 0) - (section[0]?.dist ?? 0);
    if (spanM < MIN_DIST) return null;
    const minSpeedPt = section.reduce((a, b) => a.speed < b.speed ? a : b);
    const avgCurv    = section.reduce((s, _, si) => s + curv[sIdx + si], 0) / section.length;
    let throttlePickupDist = minSpeedPt.dist;
    const apexRel = section.indexOf(minSpeedPt);
    for (let j = apexRel; j < section.length; j++) {
      if (section[j].throttle > 8 || section[j].accelPos > 8) {
        throttlePickupDist = section[j].dist; break;
      }
    }
    const corner = {
      startIdx: sIdx,
      startDist: data[sIdx].dist,
      endDist:   data[eIdx - 1]?.dist ?? data[sIdx].dist,
      entrySpeed: data[sIdx].speed,
      minSpeed:   minSpeedPt.speed,
      apexDist:   minSpeedPt.dist,
      exitSpeed:  data[Math.min(eIdx, data.length - 1)].speed,
      direction:  avgCurv > 0 ? 'left' : 'right',
      throttlePickupDist,
      throttleDelay: Math.max(0, throttlePickupDist - minSpeedPt.dist),
    };
    corners.push(corner);
    return corner;
  };

  let inCorner = false, startIdx = 0, cornerDir = 0, lastEndDist = -9999;
  for (let i = 0; i <= data.length; i++) {
    const c       = i < data.length ? curv[i] : 0;
    const turning = Math.abs(c) > CURVE_THR;
    const dir     = c >= 0 ? 1 : -1;

    if (!inCorner) {
      if (turning) {
        if (dir === cornerDir && data[i].dist - lastEndDist < MERGE_GAP_M && corners.length > 0) {
          startIdx = corners.pop().startIdx;
        } else {
          startIdx = i;
        }
        cornerDir = dir;
        inCorner  = true;
      }
    } else {
      const dirChanged = turning && dir !== cornerDir;
      const wentStraight = !turning;
      if (dirChanged || wentStraight) {
        const saved = pushCorner(startIdx, i);
        if (saved) lastEndDist = saved.endDist;
        if (dirChanged) {
          startIdx  = i;
          cornerDir = dir;
          // inCorner stays true
        } else {
          inCorner = false;
        }
      }
    }
  }
  return corners;
}

// ── KNOWN-TRACK CORNERS ───────────────────────────────────────
// On a track we have a corner map for (see KNOWN_TRACKS), each official
// turn is located on the lap by its nearest GPS point, so turn numbers
// stay stable no matter how the curvature detector splits or merges bends.

const TRACK_MATCH_RADIUS_M = 40;   // max GPS offset to count a turn as found

function nearestPointIdx(data, lat, lon) {
  const cosLat = Math.cos(lat * Math.PI / 180);
  let best = -1, bestD = Infinity;
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    if (!p.lat || !p.lon) continue;
    const dx = (p.lon - lon) * 111320 * cosLat;
    const dy = (p.lat - lat) * 110540;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, offset: Math.sqrt(bestD) };
}

// Returns the known track this lap was driven on, or null.
function findKnownTrack(data) {
  if (!data?.some(p => p.lat && p.lon)) return null;
  return KNOWN_TRACKS.find(track => {
    const found = track.corners.filter(c =>
      nearestPointIdx(data, c.lat, c.lon).offset <= TRACK_MATCH_RADIUS_M).length;
    return found >= track.corners.length * 0.8;
  }) || null;
}

// Corner objects with the same shape detectCorners() returns, plus id/label.
function cornersForTrack(data, track) {
  const located = track.corners
    .map(c => ({ c, hit: nearestPointIdx(data, c.lat, c.lon) }))
    .filter(({ hit }) => hit.idx >= 0 && hit.offset <= TRACK_MATCH_RADIUS_M)
    .map(({ c, hit }) => ({ ...c, apexDist: data[hit.idx].dist }))
    .sort((a, b) => a.apexDist - b.apexDist);
  const lapEnd = data[data.length - 1].dist;

  return located.map((c, i) => {
    const prev = located[i - 1], next = located[i + 1];
    // Window: up to 120 m before / 100 m after the apex, split halfway
    // with neighbouring turns so back-to-back corners don't overlap.
    const startDist = Math.max(c.apexDist - 120, prev ? (prev.apexDist + c.apexDist) / 2 : 0);
    const endDist   = Math.min(c.apexDist + 100, next ? (c.apexDist + next.apexDist) / 2 : lapEnd);
    const section = data.filter(p => p.dist >= startDist && p.dist <= endDist);
    if (!section.length) return null;

    const nearApex   = section.filter(p => Math.abs(p.dist - c.apexDist) <= 40);
    const minSpeedPt = (nearApex.length ? nearApex : section).reduce((a, b) => a.speed < b.speed ? a : b);
    // Committed throttle (≥50% pedal/throttle) — drivers often hold a little through the turn
    // null when committed throttle doesn't come within this section
    let throttlePickupDist = null;
    for (let j = section.indexOf(minSpeedPt); j < section.length; j++) {
      if (Math.max(section[j].throttle, section[j].accelPos) >= 50) {
        throttlePickupDist = section[j].dist; break;
      }
    }
    return {
      id: c.id,
      label: `Turn ${c.id}`,
      startDist,
      endDist,
      entrySpeed: section[0].speed,
      minSpeed:   minSpeedPt.speed,
      apexDist:   c.apexDist,          // where the turn is on this lap
      minSpeedDist: minSpeedPt.dist,
      exitSpeed:  section[section.length - 1].speed,
      direction:  c.dir,
      throttlePickupDist,
      throttleDelay: throttlePickupDist == null ? null : Math.max(0, throttlePickupDist - minSpeedPt.dist),
    };
  }).filter(Boolean);
}

// Official turns on a known track, otherwise curvature-detected corners.
function getLapCorners(data) {
  const track = findKnownTrack(data);
  return track ? cornersForTrack(data, track) : detectCorners(data);
}

// Same corner on another lap: by turn id on known tracks, else nearest start.
function matchCorner(corner, corners) {
  if (corner.id != null) return corners.find(c => c.id === corner.id) || null;
  return corners.find(c => Math.abs(c.startDist - corner.startDist) < 200) || null;
}

function interpolateAt(data, dist) {
  if (!data.length) return null;
  if (dist <= data[0].dist) return { ...data[0] };
  if (dist >= data[data.length-1].dist) return { ...data[data.length-1] };
  let lo = 0, hi = data.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (data[mid].dist <= dist) lo = mid; else hi = mid;
  }
  const t = (dist - data[lo].dist) / (data[hi].dist - data[lo].dist);
  const lerp = (a, b) => a + (b - a) * t;
  return {
    dist,
    speed:    lerp(data[lo].speed,    data[hi].speed),
    brake:    lerp(data[lo].brake,    data[hi].brake),
    throttle: lerp(data[lo].throttle, data[hi].throttle),
    accelPos: lerp(data[lo].accelPos, data[hi].accelPos),
    latAcc:   lerp(data[lo].latAcc,   data[hi].latAcc),
    lonAcc:   lerp(data[lo].lonAcc,   data[hi].lonAcc),
  };
}

function resampleLap(data, N = 600) {
  if (!data || !data.length) return [];
  const maxDist = data[data.length-1].dist;
  if (maxDist <= 0) return [];
  return Array.from({length: N}, (_, i) => interpolateAt(data, (i / (N-1)) * maxDist));
}
