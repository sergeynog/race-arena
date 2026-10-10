// ============================================================
// ZONE VISUALIZATION
// Race Coach AI — zones.js
// Corner-by-corner GPS mini-maps and pressure charts for the
// AI Coach tab. Uses Lap A as reference, Lap B as comparison.
// ============================================================

function getDataInRange(data, distStart, distEnd) {
  return data.filter(p => p.dist >= distStart && p.dist <= distEnd);
}

// Perpendicular offset in screen-space (shifts Lap B path for visibility)
function computeOffsetPath(pts, offsetPx) {
  return pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 2)];
    const next = pts[Math.min(pts.length - 1, i + 2)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: p.x + (-dy / len) * offsetPx, y: p.y + (dx / len) * offsetPx, val: p.val };
  });
}

function closestPoint(data, dist) {
  let best = data[0], bestDiff = Infinity;
  for (const p of data) {
    const d = Math.abs(p.dist - dist);
    if (d < bestDiff) { bestDiff = d; best = p; }
    if (p.dist > dist + 100) break;
  }
  return best;
}

function drawZoneCanvas(canvas, refSeg, compSeg) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  // Scale from 480×300 logical space → actual canvas size for crisp output
  ctx.scale(canvas.width / 480, canvas.height / 300);
  const W = 480, H = 300;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const allPts = [...refSeg, ...compSeg].filter(p => p.lat && p.lon && !(p.lat === 0 && p.lon === 0));
  if (!allPts.length) { ctx.restore(); return; }

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  allPts.forEach(p => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  });

  const PAD = 30;
  const latR = maxLat - minLat || 0.0001;
  const lonR = maxLon - minLon || 0.0001;
  const scale = Math.min((W - PAD * 2) / lonR, (H - PAD * 2) / latR);
  const offX = (W - PAD * 2 - lonR * scale) / 2;
  const offY = (H - PAD * 2 - latR * scale) / 2;
  const toXY = (lat, lon) => ({
    x: PAD + offX + (lon - minLon) * scale,
    y: H - PAD - offY - (lat - minLat) * scale,
  });
  const toXYArr = seg => seg
    .filter(p => p.lat && p.lon && !(p.lat === 0 && p.lon === 0))
    .map(p => ({ ...toXY(p.lat, p.lon), speed: p.speed }));

  const refXY   = toXYArr(refSeg);
  const compXY  = toXYArr(compSeg);
  const compOff = computeOffsetPath(compXY, 14).map((p, i) => ({ ...p, speed: compXY[i].speed }));

  const path = (pts, color, lw, dash = []) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach((p, i) => { if (i > 0) ctx.lineTo(p.x, p.y); });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Faint track ribbon for context, then the two laps
  path(refXY, 'rgba(0,0,0,0.06)', 22);
  path(refXY,   LAP_A_COLOR, 4);
  path(compOff, LAP_B_COLOR, 4, LAP_B_DASH);

  // Direction of travel
  if (refXY.length > 8) {
    const idx = Math.floor(refXY.length * 0.05);
    const p0 = refXY[idx], p1 = refXY[idx + 4];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.translate(p0.x + dx / len * 10, p0.y + dy / len * 10);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 5); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Slowest point of each lap, labelled in that lap's colour
  const labelled = [];
  const markSlowest = (pts, color, tag) => {
    if (!pts.length) return;
    const p = pts.reduce((a, b) => (b.speed < a.speed ? b : a));
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const text = `${tag} ${Math.round(p.speed)} km/h`;
    ctx.font = '700 12px "Titillium Web", system-ui';
    const tw = ctx.measureText(text).width;
    let lx = Math.max(4, Math.min(W - tw - 12, p.x + 10));
    let ly = Math.max(14, Math.min(H - 6, p.y + 4));
    // keep the two labels from overlapping
    while (labelled.some(l => Math.abs(l - ly) < 16)) ly = Math.min(H - 6, ly + 16);
    labelled.push(ly);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(lx - 4, ly - 12, tw + 8, 16);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, lx, ly);
  };
  markSlowest(refXY,   LAP_A_COLOR, 'A');
  markSlowest(compOff, LAP_B_COLOR, 'B');
  ctx.restore();
}

// ── BRAKE & THROTTLE (two stacked panels; Lap A blue solid, Lap B green dashed)
function drawPressureChart(canvas, refSeg, compSeg) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(canvas.width / 480, canvas.height / 300);
  const W = 480, H = 300;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const all = [...refSeg, ...compSeg];
  if (all.length < 2) { ctx.restore(); return; }

  const mL = 40, mR = 12, mT = 8, mB = 34, gap = 22;
  const pW = W - mL - mR;
  const pH = (H - mT - mB - gap) / 2;
  const dMin = Math.min(...all.map(p => p.dist));
  const dMax = Math.max(...all.map(p => p.dist));
  const dRange = dMax - dMin || 1;
  const toX = d => mL + (d - dMin) / dRange * pW;

  // Brake as % of the larger lap's peak; throttle as logged (pedal if no plate)
  const brakeMax = Math.max(...all.map(p => p.brake || 0)) || 1;
  const tField = all.some(p => (p.throttle || 0) > 0) ? 'throttle'
               : all.some(p => (p.accelPos || 0) > 0) ? 'accelPos' : null;
  const panels = [
    { title: 'BRAKE',    top: mT,            get: p => (p.brake || 0) / brakeMax * 100, show: brakeMax > 1 },
    { title: 'THROTTLE', top: mT + pH + gap, get: p => tField ? (p[tField] || 0) : NaN, show: !!tField },
  ];

  ctx.font = '600 11px "Titillium Web", system-ui';
  panels.forEach(panel => {
    const toY = pct => panel.top + pH - Math.max(0, Math.min(1, pct / 100)) * pH;
    // grid + labels
    [0, 50, 100].forEach(pct => {
      const y = toY(pct);
      ctx.strokeStyle = pct === 0 ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.07)';
      ctx.lineWidth = pct === 0 ? 1 : 0.6;
      ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pW, y); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.textAlign = 'right';
      ctx.fillText(`${pct}%`, mL - 5, y + 4);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.textAlign = 'left';
    ctx.font = '700 10px "Archivo", system-ui';
    ctx.fillText(panel.title, mL + 4, panel.top + 11);
    ctx.font = '600 11px "Titillium Web", system-ui';
    if (!panel.show) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillText('not logged', mL + 70, panel.top + 11);
      return;
    }
    const line = (seg, color, dash) => {
      const pts = seg.filter(p => isFinite(panel.get(p)));
      if (pts.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = toX(p.dist), y = toY(panel.get(p));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(refSeg,  LAP_A_COLOR, []);
    line(compSeg, LAP_B_COLOR, LAP_B_DASH);
  });

  // Shared distance axis
  const nTicks = Math.min(6, Math.floor(pW / 60));
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.textAlign = 'center';
  for (let i = 0; i <= nTicks; i++) {
    const d = dMin + (i / nTicks) * dRange;
    ctx.fillText(`+${Math.round(d - dMin)}m`, toX(d), H - mB + 16);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText('Distance from section start', mL + pW / 2, H - 4);
  ctx.restore();
}

// ── CORNER COACHING TIP ────────────────────────────────────
function buildCornerCoachingTip(zone) {
  const rc = zone.ref, cc = zone.comp;
  const rb = zone.brakeZone, cb = zone.compBrakeZone;
  if (!cc) return '<p class="muted">No matching Lap B corner found at this location.</p>';

  const tips = [];

  if (rb && cb) {
    const bpDiff = rb.startDist - cb.startDist;
    if (Math.abs(bpDiff) > 3) {
      tips.push(bpDiff > 0
        ? `Lap A brakes <strong>${bpDiff.toFixed(0)}m later</strong> (Lap A at ${rb.startDist.toFixed(0)}m, Lap B at ${cb.startDist.toFixed(0)}m) — hold off and trust the grip.`
        : `Lap B brakes <strong>${Math.abs(bpDiff).toFixed(0)}m later</strong> — work towards that marker consistently.`);
    }
    const pkDiff = rb.peakBrake - cb.peakBrake;
    if (Math.abs(pkDiff) > 4) {
      tips.push(pkDiff > 0
        ? `Lap A applies <strong>${pkDiff.toFixed(0)} bar more peak brake pressure</strong> — squeeze harder initially for a shorter, sharper brake zone.`
        : `Lap B uses more peak pressure — modulate earlier to match.`);
    }
  }

  // Only credit a cause when the data shows it for this corner
  const aBrakesLater   = !!(rb && cb && rb.startDist - cb.startDist > 3);
  const tDiff          = rc.throttleDelay != null && cc.throttleDelay != null ? rc.throttleDelay - cc.throttleDelay : 0;
  const aThrottleFirst = tDiff < -5;

  const apexDiff = rc.minSpeed - cc.minSpeed;
  if (Math.abs(apexDiff) > 1.5) {
    tips.push(apexDiff > 0
      ? `Lap A carries <strong>${apexDiff.toFixed(1)} km/h more</strong> through the apex${aBrakesLater ? ' — the later brake point is generating more minimum speed' : ''}.`
      : `Lap B is <strong>${Math.abs(apexDiff).toFixed(1)} km/h faster</strong> at apex — find more entry speed or a tighter line.`);
  }

  if (Math.abs(tDiff) > 5) {
    tips.push(tDiff < 0
      ? `Lap A gets on throttle <strong>${Math.abs(tDiff).toFixed(0)}m earlier</strong> after apex — commit to gas sooner for a faster exit.`
      : `Lap B delays throttle by <strong>${tDiff.toFixed(0)}m</strong> more — patience here will give a cleaner exit and more exit speed.`);
  }

  const exitDiff = rc.exitSpeed - cc.exitSpeed;
  if (Math.abs(exitDiff) > 2) {
    tips.push(exitDiff > 0
      ? `Lap A exits <strong>${exitDiff.toFixed(1)} km/h faster</strong>${aThrottleFirst ? ' — the earlier throttle is paying off on the straight' : ''}.`
      : `Lap B exits <strong>${Math.abs(exitDiff).toFixed(1)} km/h faster</strong> — refine the exit line to match.`);
  }

  // Tips from the extra channels (only when both laps have the data)
  const mA = zone.mA, mB = zone.mB;
  if (mA && mB) {
    if (zone.timeDelta != null && Math.abs(zone.timeDelta) >= 0.03) {
      tips.unshift(zone.timeDelta > 0
        ? `Lap B loses <strong>${zone.timeDelta.toFixed(3)} s</strong> through this section.`
        : `Lap B gains <strong>${Math.abs(zone.timeDelta).toFixed(3)} s</strong> through this section.`);
    }
    if (mA.gripUsed != null && mB.gripUsed != null && Math.abs(mA.gripUsed - mB.gripUsed) >= 0.08) {
      const [hi, lo, hiM, loM] = mA.gripUsed > mB.gripUsed ? ['A', 'B', mA, mB] : ['B', 'A', mB, mA];
      tips.push(`Lap ${hi} uses more of the available grip (${hiM.peakG.toFixed(2)} g vs ${loM.peakG.toFixed(2)} g peak) — Lap ${lo} has margin left here.`);
    }
    const slip = (m, lap) => m.lockupMetres >= 5
      ? `Lap ${lap} has <strong>${m.lockupMetres.toFixed(0)} m</strong> of wheel slip under braking — a lock-up, or ABS working if fitted. Ease pressure as speed falls.` : null;
    [slip(mA, 'A'), slip(mB, 'B')].filter(Boolean).forEach(t => tips.push(t));
    if (mB.spinMetres >= 5 && mB.spinMetres > (mA.spinMetres || 0) * 1.5) {
      tips.push(`Lap B spins the driven wheels for <strong>${mB.spinMetres.toFixed(0)} m</strong> on exit — feed the throttle in more progressively.`);
    }
    if (mB.cutMetres >= 5 && mB.cutMetres > (mA.cutMetres || 0) * 1.5) {
      tips.push(`The car's electronics cut Lap B's throttle for <strong>${mB.cutMetres.toFixed(0)} m</strong> — the power request is ahead of the grip.`);
    }
    if (mA.steerPerG && mB.steerPerG && mB.steerPerG > mA.steerPerG * 1.15) {
      tips.push(`Lap B needs <strong>${Math.round((mB.steerPerG / mA.steerPerG - 1) * 100)}% more steering</strong> for the same cornering force — more understeer. Try a slower entry or carrying a little brake to load the front.`);
    }
  }

  if (!tips.length) tips.push('Both laps are very similar here — focus on consistency.');

  // Name each lap in its own colour
  const named = t => t.replace(/\bLap ([AB])\b/g, (_, w) => `<span class="lap-name-${w.toLowerCase()}">Lap ${w}</span>`);
  return `<div class="zone-coaching-header">Coaching notes</div>
    <div class="zone-coaching-tip">${tips.map(t => `<p>• ${named(t)}</p>`).join('')}</div>`;
}

// ── MASTER ZONE RENDERER ───────────────────────────────────
function renderAndDrawZones(refLap, compLap) {
  const BRAKE_CTX = 25;
  const MIN_BRAKE_BAR = 5;
  const MAX_BRAKE_SHIFT_M = 80;
  const EXIT_CTX  = 45;

  const refCorners  = getLapCorners(refLap.data);
  const compCorners = getLapCorners(compLap.data);
  const knownTrack  = findKnownTrack(refLap.data);
  const refBraking  = detectBrakingZones(refLap.data);
  const compBraking = detectBrakingZones(compLap.data);

  const corners = refCorners.map((rc, idx) => {
    const cc = matchCorner(rc, compCorners);
    // Braking zone feeding this corner: starts before the apex, ends within 150 m of it
    // Ignore throttle lifts (decel with ~0 bar) when the lap logs brake pressure
    const brakesFor = (zones, c) => {
      if (!c) return [];
      const near = zones.filter(b => b.startDist < c.apexDist + 10 && b.endDist > c.apexDist - 150);
      const pressed = near.filter(b => b.peakBrake >= MIN_BRAKE_BAR);
      return pressed.length ? pressed : near;
    };
    const rb = brakesFor(refBraking, rc).pop();
    // Lap B's zone with the closest brake point, so shared braking areas
    // (e.g. one stop for two linked turns) compare like with like
    const cbNearest = rb ? brakesFor(compBraking, cc).reduce((best, z) =>
      !best || Math.abs(z.startDist - rb.startDist) < Math.abs(best.startDist - rb.startDist) ? z : best, null) : null;
    // Brake points this far apart are different stops (e.g. one stop vs two
    // through 10–11), not the same stop made later — don't compare them.
    const cb = cbNearest && Math.abs(cbNearest.startDist - rb.startDist) <= MAX_BRAKE_SHIFT_M ? cbNearest : null;
    const cbOwn = brakesFor(compBraking, cc).pop() || null;

    const distStart = rc.id != null
      ? Math.min(rc.startDist, rb ? rb.startDist - BRAKE_CTX : rc.startDist)
      : (rb ? rb.startDist - BRAKE_CTX : rc.startDist - 80);
    const distEnd   = rc.endDist + (rc.id != null ? 20 : EXIT_CTX);

    return {
      type: 'corner',
      label: rc.label || `Corner ${idx + 1}`,
      dist: Math.round(rc.apexDist),
      direction: rc.direction,
      distStart, distEnd,
      ref: rc, comp: cc,
      brakeZone: rb, compBrakeZone: cb, compBrakeOwn: cbOwn,
      metric: 'speed',
    };
  });

  if (!corners.length) return null;

  // Per-corner metrics. Section time uses the corner's own stretch of track
  // (turns split halfway between apexes) so the sections add up along the lap;
  // the other metrics also include the braking zone that feeds the corner.
  corners.forEach(z => {
    const timeWinA = { start: z.ref.startDist, end: z.ref.endDist };
    const winA     = { start: z.distStart, end: z.distEnd };
    z.mA = cornerMetrics(refLap, winA, z.ref, z.brakeZone, timeWinA);
    z.mB = z.comp
      ? cornerMetrics(compLap, mapWindow(winA, refLap, compLap), z.comp, z.compBrakeOwn,
                      mapWindow(timeWinA, refLap, compLap))
      : null;
    z.timeDelta = z.mA && z.mB ? z.mB.time - z.mA.time : null;
  });

  // timeDelta = Lap B − Lap A section time; say who is ahead rather than a signed number
  const ahead = v => v == null ? null : v > 0.005 ? 'a' : v < -0.005 ? 'b' : null;
  const fmtAhead = v => v == null ? '' : ahead(v)
    ? `Lap ${ahead(v).toUpperCase()} faster by ${Math.abs(v).toFixed(3)} s`
    : 'Even';
  const maxAbs = Math.max(0.05, ...corners.map(z => Math.abs(z.timeDelta || 0)));

  const html = `
    <div class="corner-view">
      <div class="corner-view-head">
        <div>
          <div class="zone-analysis-title">Corner analysis</div>
          <div class="corner-view-sub">${knownTrack
            ? `${corners.length} turns · official ${escapeHtml(knownTrack.name)} numbering`
            : `${corners.length} corners detected`} · bars show who is faster in each turn</div>
        </div>
        <div class="corner-picker">
          <button class="btn btn-sm" id="cornerPrev" aria-label="Previous corner">‹</button>
          <select id="cornerSelect" class="corner-select" aria-label="Corner">
            ${corners.map((z, i) => `<option value="${i}">${escapeHtml(z.label)} · ${z.direction}${z.timeDelta != null ? ` · ${fmtAhead(z.timeDelta)}` : ''}</option>`).join('')}
          </select>
          <button class="btn btn-sm" id="cornerNext" aria-label="Next corner">›</button>
        </div>
      </div>

      <div class="corner-strip" role="tablist" aria-label="Time gained or lost per corner">
        ${corners.map((z, i) => {
          const d = z.timeDelta || 0;
          const h = Math.round(Math.abs(d) / maxAbs * 100);
          const cls = ahead(z.timeDelta) ? `is-${ahead(z.timeDelta)}-ahead` : '';
          return `<button class="corner-strip-item ${cls}" data-i="${i}" role="tab"
                    title="${escapeHtml(z.label)}: ${fmtAhead(z.timeDelta) || 'n/a'}">
                    <span class="corner-strip-bar"><span style="height:${h}%"></span></span>
                    <span class="corner-strip-label">${escapeHtml(String(z.ref.id ?? i + 1))}</span>
                  </button>`;
        }).join('')}
      </div>
      <div class="corner-strip-legend"><span class="is-a-ahead"></span>Lap A faster <span class="is-b-ahead"></span>Lap B faster <em>· taller bar = bigger gap</em></div>

      <div id="cornerDetail"></div>
    </div>`;

  // ── single-corner detail ───────────────────────────────────
  const ROWS = [
    ['Time & speed', [
      ['Section time',        m => m.time,       v => `${v.toFixed(3)} s`, 'lower'],
      ['Entry speed',         m => m.entrySpeed, v => `${v.toFixed(1)} km/h`, 'higher'],
      ['Minimum speed',       m => m.minSpeed,   v => `${v.toFixed(1)} km/h`, 'higher'],
      ['Exit speed',          m => m.exitSpeed,  v => `${v.toFixed(1)} km/h`, 'higher'],
    ]],
    ['Braking', [
      ['Brakes before slowest point', m => m.brakeBefore, v => `${v.toFixed(0)} m`, null],
      ['Peak brake pressure', m => m.peakBrake,  v => `${v.toFixed(0)} bar`, null],
      ['Braking while turning', m => m.trailBrake, v => `${v.toFixed(0)} m`, null],
      ['Wheel slip under braking', m => m.lockupMetres, v => `${v.toFixed(0)} m`, null,
        'A wheel ≥12% slower than ground speed: a lock-up, or ABS working on cars that have it'],
    ]],
    ['Grip', [
      ['Peak combined G',     m => m.peakG,      v => `${v.toFixed(2)} g`, 'higher'],
      ['Average combined G',  m => m.avgG,       v => `${v.toFixed(2)} g`, 'higher'],
      ['Grip used',           m => m.gripUsed,   v => `${Math.round(v * 100)}%`, 'higher',
        'Peak combined G here as a share of the lap’s near-maximum'],
    ]],
    ['Throttle & balance', [
      ['Throttle after slowest point', m => m.throttleDelay, v => `${v.toFixed(0)} m`, 'lower'],
      ['Wheelspin',           m => m.spinMetres, v => `${v.toFixed(0)} m`, 'lower',
        'An axle ≥6% faster than ground speed under power'],
      ['Throttle cut by electronics', m => m.cutMetres, v => `${v.toFixed(0)} m`, 'lower',
        'Throttle well below its usual opening for the pedal position (traction or stability control). Needs separate pedal and throttle channels'],
      ['Steering per g',      m => m.steerPerG,  v => `${v.toFixed(0)}°/g`, null,
        'More steering for the same cornering force means more understeer'],
    ]],
  ];

  const deltaCell = (a, b, dir, fmt) => {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return '<td class="mt-delta">—</td>';
    const d = b - a;
    const shown = fmt(Math.abs(d)).replace(/^-/, '');
    const tiny = Math.abs(d) < 1e-6 || /^0(\.0+)?(?![.\d])/.test(shown);   // rounds to zero
    // colour by which lap is better on this metric
    const cls = !dir || tiny ? '' : ((dir === 'higher') === (d > 0) ? 'is-b-better' : 'is-a-better');
    return `<td class="mt-delta ${cls}">${tiny ? '0' : (d > 0 ? '+' : '−') + shown}</td>`;
  };

  const metricTable = z => {
    const val = (m, get, fmt) => {
      const v = m ? get(m) : null;
      return v == null || !isFinite(v) ? '—' : fmt(v);
    };
    return `<table class="metric-table">
      <thead><tr><th></th><th><span class="lap-swatch a"></span> Lap A</th><th><span class="lap-swatch b"></span> Lap B</th><th title="Lap B minus Lap A, coloured by the lap that is better on that metric">Difference</th></tr></thead>
      ${ROWS.map(([group, rows]) => {
        const shown = rows.filter(([, get]) => (z.mA && get(z.mA) != null) || (z.mB && get(z.mB) != null));
        if (!shown.length) return '';
        return `<tbody>
          <tr class="mt-group"><th colspan="4">${group}</th></tr>
          ${shown.map(([label, get, fmt, dir, hint]) => `<tr>
            <th scope="row"${hint ? ` title="${escapeHtml(hint)}"` : ''}>${label}${hint ? ' <span class="mt-hint">ⓘ</span>' : ''}</th>
            <td>${val(z.mA, get, fmt)}</td>
            <td class="mt-b">${val(z.mB, get, fmt)}</td>
            ${deltaCell(z.mA && get(z.mA), z.mB && get(z.mB), dir, fmt)}
          </tr>`).join('')}
        </tbody>`;
      }).join('')}
    </table>`;
  };

  const subline = z => {
    const parts = [z.direction === 'left' ? 'Left-hander' : 'Right-hander', `apex ~${z.dist} m`];
    const slope = z.mA?.slopeAtApex;
    if (slope != null && isFinite(slope) && Math.abs(slope) >= 0.5) {
      parts.push(`${slope > 0 ? 'uphill' : 'downhill'} ${Math.abs(Math.tan(slope * Math.PI / 180) * 100).toFixed(0)}% at apex`);
    }
    const elev = z.mA?.elevChange;
    if (elev != null && isFinite(elev) && Math.abs(elev) >= 1) parts.push(`${elev > 0 ? '+' : '−'}${Math.abs(elev).toFixed(0)} m elevation`);
    return parts.join(' · ');
  };

  const MAP_W = 1600, MAP_H = 1000, CHT_W = 1600, CHT_H = 1000, GG = 900;

  const renderDetail = i => {
    const z = corners[i];
    const el = document.getElementById('cornerDetail');
    if (!el) return;
    const verdict = z.timeDelta == null ? ''
      : `<div class="corner-verdict ${ahead(z.timeDelta) ? `is-${ahead(z.timeDelta)}-ahead` : ''}">
           <span>In this section</span><strong>${fmtAhead(z.timeDelta)}</strong>
         </div>`;
    el.innerHTML = `
      <div class="corner-detail">
        <div class="corner-detail-head">
          <div>
            <div class="corner-title">${escapeHtml(z.label)}</div>
            <div class="corner-sub">${subline(z)}</div>
          </div>
          ${verdict}
        </div>

        <div class="corner-visuals">
          <figure class="corner-fig">
            <figcaption>Racing line
              <span class="leg"><span class="lap-swatch a"></span>A</span>
              <span class="leg"><span class="lap-swatch b"></span>B (offset)</span>
              <span class="leg muted">dot = slowest point</span></figcaption>
            <canvas id="zc_map" width="${MAP_W}" height="${MAP_H}"></canvas>
          </figure>
          <figure class="corner-fig">
            <figcaption>Brake &amp; throttle
              <span class="leg"><span class="lap-swatch a"></span>A</span>
              <span class="leg"><span class="lap-swatch b"></span>B</span></figcaption>
            <canvas id="zc_chart" width="${CHT_W}" height="${CHT_H}"></canvas>
          </figure>
          <figure class="corner-fig is-square">
            <figcaption>Friction circle
              <span class="leg"><span class="lap-swatch a"></span>A</span>
              <span class="leg"><span class="lap-swatch b"></span>B</span></figcaption>
            <canvas id="zc_gg" width="${GG}" height="${GG}"></canvas>
          </figure>
        </div>

        <div class="corner-body">
          ${metricTable(z)}
          <div class="corner-notes">${buildCornerCoachingTip(z)}</div>
        </div>
      </div>`;

    const refSeg  = getDataInRange(refLap.data,  z.distStart, z.distEnd);
    const winB    = mapWindow({ start: z.distStart, end: z.distEnd }, refLap, compLap);
    const compSeg = getDataInRange(compLap.data, winB.start, winB.end);
    drawZoneCanvas(document.getElementById('zc_map'), refSeg, compSeg);
    drawPressureChart(document.getElementById('zc_chart'), refSeg, compSeg);
    drawFrictionCircle(document.getElementById('zc_gg'),
      ggPoints(refLap, { start: z.distStart, end: z.distEnd }), ggPoints(compLap, winB));
  };

  const draw = () => {
    const select = document.getElementById('cornerSelect');
    const strip  = document.querySelectorAll('.corner-strip-item');
    const show = i => {
      i = Math.max(0, Math.min(corners.length - 1, i));
      select.value = String(i);
      strip.forEach(b => b.classList.toggle('is-active', Number(b.dataset.i) === i));
      state.selectedCorner = corners[i].label;
      renderDetail(i);
    };
    select.addEventListener('change', () => show(Number(select.value)));
    strip.forEach(b => b.addEventListener('click', () => show(Number(b.dataset.i))));
    document.getElementById('cornerPrev').addEventListener('click', () => show(Number(select.value) - 1));
    document.getElementById('cornerNext').addEventListener('click', () => show(Number(select.value) + 1));
    // Reopen the corner the driver last looked at, if it exists for this pair
    const last = corners.findIndex(z => z.label === state.selectedCorner);
    show(last >= 0 ? last : 0);
  };

  return { html, draw };
}

// ── FRICTION CIRCLE (lateral vs longitudinal g) ────────────
function drawFrictionCircle(canvas, ptsA, ptsB) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  ctx.save();
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  const all = [...ptsA, ...ptsB];
  const peak = Math.max(1.0, ...all.map(([x, y]) => Math.hypot(x, y)));
  const maxG = Math.ceil(peak * 2) / 2;            // round up to 0.5 g
  const c = S / 2, r = S / 2 - 70;
  const toPx = g => g / maxG * r;

  // Rings every 0.5 g + axes
  ctx.lineWidth = 2;
  for (let g = 0.5; g <= maxG + 1e-9; g += 0.5) {
    ctx.strokeStyle = g % 1 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.arc(c, c, toPx(g), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.font = '600 26px "Titillium Web", system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${g}g`, c + toPx(g) * 0.71 + 6, c - toPx(g) * 0.71 - 6);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.moveTo(c - r, c); ctx.lineTo(c + r, c); ctx.moveTo(c, c - r); ctx.lineTo(c, c + r); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.font = '700 26px "Archivo", system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('ACCEL', c, 38);
  ctx.fillText('BRAKE', c, S - 18);
  ctx.save(); ctx.translate(26, c); ctx.rotate(-Math.PI / 2); ctx.fillText('LATERAL', 0, 0); ctx.restore();

  // Traces: A solid, then B dashed on top so both stay visible
  const k = S / 300;   // canvas is drawn ~3× its on-screen size
  const trace = (pts, color, dash) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.9;
    ctx.setLineDash(dash.map(v => v * k));
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const px = c + toPx(x), py = c - toPx(y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };
  trace(ptsA, LAP_A_COLOR, []);
  trace(ptsB, LAP_B_COLOR, LAP_B_DASH);
  ctx.restore();
}

