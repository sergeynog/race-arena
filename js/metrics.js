// ============================================================
// LAP METRICS
// Race Arena — metrics.js
// Derived channels (combined G, wheel slip, throttle cuts), the
// lap-vs-lap time gap, and per-corner comparison metrics.
// Pure functions; per-lap results are cached on lap._derived.
// ============================================================

// Thresholds calibrated on Cayman GTS AiM Solo 2 DL sessions at Club Motorsports.
// Nothing assumes ABS, traction control or which axle is driven, so the same
// rules read as lock-ups on a car without ABS and as ABS on one with it.
const SLIP_BRAKE = 0.12;  // a wheel ≥12% slower than GPS while braking → lock-up / ABS
const SPIN_MIN   = 0.06;  // an axle ≥6% faster than GPS under power → wheelspin
const CUT_RATIO  = 0.6;   // throttle <60% of its usual opening for this pedal → stability-control cut
const MIN_RUN    = 3;     // samples (0.15 s at 20 Hz) before an event counts
const TURNING_G  = 0.4;   // lateral g above which the car is "cornering"

// ── SMALL HELPERS ─────────────────────────────────────────────
// Field names as resolved by the parser (CHANNEL_DEFS). Laps parsed before
// channel tracking existed have no list — treat everything as present.
function hasChannel(lap, field) {
  return !lap.channels?.length || lap.channels.includes(field);
}

function median(arr) {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function percentile(arr, q) {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : NaN;
}

function movingAvg(arr, half) {
  return arr.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(arr.length - 1, i + half); k++) { sum += arr[k]; n++; }
    return sum / n;
  });
}

// Keeps only true-runs at least MIN_RUN samples long
function minRuns(mask) {
  const out = mask.slice();
  for (let i = 0; i < mask.length;) {
    if (!mask[i]) { i++; continue; }
    let j = i;
    while (j < mask.length && mask[j]) j++;
    if (j - i < MIN_RUN) for (let k = i; k < j; k++) out[k] = false;
    i = j;
  }
  return out;
}

// Linear interpolation of any numeric field (or per-sample array) at a distance
function valueAt(data, key, dist, arr = null) {
  if (!data.length) return NaN;
  const get = i => arr ? arr[i] : data[i][key];
  if (dist <= data[0].dist) return get(0);
  const last = data.length - 1;
  if (dist >= data[last].dist) return get(last);
  let lo = 0, hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (data[mid].dist <= dist) lo = mid; else hi = mid;
  }
  const span = data[hi].dist - data[lo].dist || 1;
  return get(lo) + (get(hi) - get(lo)) * (dist - data[lo].dist) / span;
}

function lapLength(lap) {
  return lap.data[lap.data.length - 1]?.dist || 0;
}

// ── PER-LAP DERIVED CHANNELS ──────────────────────────────────
function lapDerived(lap) {
  if (lap._derived && lap._derived.data === lap.data) return lap._derived;
  const d = lap.data;

  const hasImu    = hasChannel(lap, 'imuLonAcc') && hasChannel(lap, 'imuLatAcc');
  const hasWheels = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].every(c => hasChannel(lap, c));
  // Throttle cuts need pedal and throttle-body position as separate channels
  // (drive-by-wire). Cable throttles log one, so no cut can be inferred.
  const hasPedal  = hasChannel(lap, 'accelPos') && hasChannel(lap, 'throttle');
  const hasThrottle = hasChannel(lap, 'throttle') || hasChannel(lap, 'accelPos');
  const hasBrake  = hasChannel(lap, 'brake');
  const hasSteer  = hasChannel(lap, 'steer');
  const hasAlt    = hasChannel(lap, 'alt');

  // Combined G — IMU when logged (lightly smoothed), else GPS-derived
  const latG = movingAvg(d.map(p => hasImu ? p.imuLatAcc : p.latAcc), 1);
  const lonG = movingAvg(d.map(p => hasImu ? p.imuLonAcc : p.lonAcc), 1);
  const combG = movingAvg(latG.map((x, i) => Math.hypot(x, lonG[i])), 1);
  const gripRef = percentile(combG, 0.99);   // this lap's practical grip ceiling

  // Braking: brake pressure when logged, else firm deceleration
  const braking = i => hasBrake ? d[i].brake > 10 : lonG[i] < -0.5;
  const onPower = i => hasThrottle ? Math.max(d[i].accelPos, d[i].throttle) > 50 : lonG[i] > 0.15;

  let lockup = null, spin = null;
  if (hasWheels) {
    // Wheel-speed sensors read a few % off GPS; calibrate each axle on steady running
    const cruise = d.filter((p, i) => !braking(i) && p.speed > 50 && Math.abs(lonG[i]) < 0.15 && Math.abs(latG[i]) < 0.3);
    const kf = median(cruise.map(p => (p.wheelFL + p.wheelFR) / 2 / p.speed)) || 1;
    const kr = median(cruise.map(p => (p.wheelRL + p.wheelRR) / 2 / p.speed)) || 1;
    // Lock-up: slowest single wheel vs ground speed (front or rear lock)
    lockup = minRuns(d.map((p, i) => braking(i) && p.speed > 40 &&
      (p.speed - Math.min(p.wheelFL / kf, p.wheelFR / kf, p.wheelRL / kr, p.wheelRR / kr)) / p.speed > SLIP_BRAKE));
    // Wheelspin: fastest axle (averaged, so inside/outside wheel paths cancel) vs ground speed.
    // Works for front-, rear- or all-wheel drive without knowing which is driven.
    spin = minRuns(d.map((p, i) => onPower(i) && p.speed > 30 &&
      Math.max((p.wheelFL + p.wheelFR) / 2 / kf, (p.wheelRL + p.wheelRR) / 2 / kr) / p.speed - 1 > SPIN_MIN));
  }

  let cut = null;
  if (hasPedal) {
    // Throttle opening isn't linear with pedal — compare against this lap's usual opening per 10% pedal band
    const band = p => Math.max(0, Math.min(11, Math.floor(p.accelPos / 10)));
    const usual = Array.from({ length: 12 }, (_, b) => median(d.filter(p => band(p) === b).map(p => p.throttle)));
    cut = minRuns(d.map(p => p.accelPos > 70 && p.speed > 40 && p.throttle < CUT_RATIO * usual[band(p)]));
  }

  lap._derived = { data: d, latG, lonG, combG, gripRef, lockup, spin, cut,
                   hasImu, hasWheels, hasPedal, hasThrottle, hasBrake, hasSteer, hasAlt };
  return lap._derived;
}

// ── TIME GAP ──────────────────────────────────────────────────
// Lap B minus Lap A elapsed time at the same point of the lap (distance
// scaled to each lap's own length). Positive = Lap B is behind.
function deltaTrace(lapA, lapB, N = 600) {
  const lenA = lapLength(lapA), lenB = lapLength(lapB);
  if (!lenA || !lenB) return [];
  return Array.from({ length: N }, (_, i) => {
    const f = i / (N - 1);
    return { x: f * lenA, y: valueAt(lapB.data, 'lapTime', f * lenB) - valueAt(lapA.data, 'lapTime', f * lenA) };
  });
}

// Generic distance series for charts
function seriesOf(lap, key, N = 500, arr = null) {
  const len = lapLength(lap);
  return Array.from({ length: N }, (_, i) => {
    const x = (i / (N - 1)) * len;
    return { x, y: valueAt(lap.data, key, x, arr) };
  });
}

// ── PER-CORNER METRICS ────────────────────────────────────────
// win = { start, end } distances on this lap; corner = this lap's corner object
// (entry/min/exit speed, throttle delay); brake = braking zone feeding it or null.
// timeWin (default win) is the stretch the section time is measured over.
function cornerMetrics(lap, win, corner, brake, timeWin = win) {
  const d = lap.data, der = lapDerived(lap);
  const idx = [];
  for (let i = 0; i < d.length; i++) if (d[i].dist >= win.start && d[i].dist <= win.end) idx.push(i);
  if (idx.length < 2) return null;

  // Distance covered while a per-sample flag is set
  const metresWhere = flags => flags ? idx.reduce((m, i, k) =>
    (k && flags[i]) ? m + (d[i].dist - d[idx[k - 1]].dist) : m, 0) : null;

  const g = idx.map(i => der.combG[i]);
  const peakG = Math.max(...g);
  const turning = idx.filter(i => Math.abs(der.latG[i]) > TURNING_G);
  const trailFlags = der.hasBrake ? d.map((p, i) => p.brake > 3 && Math.abs(der.latG[i]) > TURNING_G) : null;
  const apex = corner?.minSpeedDist ?? corner?.apexDist;

  return {
    time:        valueAt(d, 'lapTime', timeWin.end) - valueAt(d, 'lapTime', timeWin.start),
    entrySpeed:  corner?.entrySpeed ?? null,
    minSpeed:    corner?.minSpeed ?? null,
    exitSpeed:   corner?.exitSpeed ?? null,
    brakeBefore: brake && apex != null ? apex - brake.startDist : null,   // m before the slowest point
    peakBrake:   der.hasBrake && brake ? brake.peakBrake : null,
    trailBrake:  metresWhere(trailFlags),
    peakG,
    avgG:        g.reduce((a, b) => a + b, 0) / g.length,
    gripUsed:    der.gripRef ? peakG / der.gripRef : null,
    throttleDelay: der.hasThrottle ? corner?.throttleDelay ?? null : null,
    lockupMetres: metresWhere(der.lockup),
    spinMetres:  metresWhere(der.spin),
    cutMetres:   metresWhere(der.cut),
    steerPerG:   der.hasSteer && turning.length
                   ? median(turning.map(i => Math.abs(d[i].steer) / Math.abs(der.latG[i]))) : null,
    elevChange:  der.hasAlt ? valueAt(d, 'alt', win.end) - valueAt(d, 'alt', win.start) : null,
    slopeAtApex: der.hasAlt && apex != null ? valueAt(d, 'slope', apex) : null,
  };
}

// Same corner window on another lap, by fraction of lap distance
function mapWindow(win, fromLap, toLap) {
  const k = lapLength(toLap) / (lapLength(fromLap) || 1);
  return { start: win.start * k, end: win.end * k };
}

// Points for a friction-circle plot (lateral, longitudinal g) inside a window
function ggPoints(lap, win) {
  const der = lapDerived(lap);
  const pts = [];
  lap.data.forEach((p, i) => {
    if (p.dist >= win.start && p.dist <= win.end) pts.push([der.latG[i], der.lonG[i]]);
  });
  return pts;
}
