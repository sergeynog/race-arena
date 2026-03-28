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
