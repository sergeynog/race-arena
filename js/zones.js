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

function metricColor(v, t, metric) {
  // t = 0..1 normalized value
  if (metric === 'brake') {
    // 0 = dark blue, 0.5 = orange, 1 = red
    if (t < 0.5) {
      const u = t * 2;
      return [Math.round(u * 255), Math.round(u * 120), Math.round((1 - u) * 220)];
    } else {
      const u = (t - 0.5) * 2;
      return [255, Math.round((1 - u) * 120), 0];
    }
  } else {
    // speed: blue→cyan→green→yellow→red
    if (t < 0.25) {
      const u = t / 0.25;
      return [0, Math.round(64 + u * 132), 255];
    } else if (t < 0.5) {
      const u = (t - 0.25) / 0.25;
      return [0, Math.round(196 + u * 28), Math.round(255 - u * 137)];
    } else if (t < 0.75) {
      const u = (t - 0.5) / 0.25;
      return [Math.round(u * 255), Math.round(224 - u * 109), Math.round(118 - u * 118)];
    } else {
      const u = (t - 0.75) / 0.25;
      return [Math.round(200 + u * 55), Math.round(115 - u * 74), 0];
    }
  }
}

function drawZoneCanvas(canvas, refSeg, compSeg, metric, events) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  // Scale from original 480×300 logical space → actual canvas size for crisp output
  ctx.scale(canvas.width / 480, canvas.height / 300);
  const W = 480, H = 300;
  const LEGEND_H = 32;
  const DRAW_H = H - LEGEND_H;
  ctx.fillStyle = '#090910';
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

  const PAD = 28;
  const latR = maxLat - minLat || 0.0001;
  const lonR = maxLon - minLon || 0.0001;
  const scale = Math.min((W - PAD * 2) / lonR, (DRAW_H - PAD * 2) / latR);
  const toXY = (lat, lon) => ({
    x: PAD + (lon - minLon) * scale,
    y: DRAW_H - PAD - (lat - minLat) * scale,
  });

  const allVals = [...refSeg, ...compSeg].map(p => p[metric]).filter(v => isFinite(v));
  const minVal = Math.min(...allVals), maxVal = Math.max(...allVals);
  const valRange = maxVal - minVal || 1;
  const norm = v => Math.max(0, Math.min(1, (v - minVal) / valRange));
  const toColor = (v, a = 1) => { const [r, g, b] = metricColor(v, norm(v), metric); return `rgba(${r},${g},${b},${a})`; };

  const toXYArr = seg => seg
    .filter(p => p.lat && p.lon && !(p.lat === 0 && p.lon === 0))
    .map(p => ({ ...toXY(p.lat, p.lon), val: p[metric] || 0 }));

  const refXY  = toXYArr(refSeg);
  const compXY = toXYArr(compSeg);
  const OFFSET_PX = 22;
  const compOff = computeOffsetPath(compXY, OFFSET_PX);

  const drawSolidPath = (pts, color, lw) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach((p, i) => { if (i > 0) ctx.lineTo(p.x, p.y); });
    ctx.stroke();
  };

  // Ghost tracks for context
  drawSolidPath(refXY,   'rgba(255,255,255,0.07)', 8);
  drawSolidPath(compOff, 'rgba(255,255,255,0.07)', 8);

  // Draw Lap B colored by metric (offset)
  for (let i = 1; i < compOff.length; i++) {
    const p0 = compOff[i - 1], p1 = compOff[i];
    ctx.strokeStyle = toColor(p0.val, 1);
    ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  // Draw Lap A colored by metric
  for (let i = 1; i < refXY.length; i++) {
    const p0 = refXY[i - 1], p1 = refXY[i];
    ctx.strokeStyle = toColor(p0.val, 1);
    ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Line labels: Lap A at entry (3%), Lap B at exit (96%)
  const drawLineLabel = (pts, label, color, frac) => {
    if (pts.length < 4) return;
    const idx = Math.max(0, Math.min(pts.length - 1, Math.floor(pts.length * frac)));
    const p = pts[idx];
    ctx.font = 'bold 9px system-ui';
    const tw = ctx.measureText(label).width;
    const pad = 4, bh = 13;
    let lx = Math.max(2, Math.min(W - tw - pad*2 - 2, p.x - pad));
    let ly = Math.max(bh/2 + 2, Math.min(DRAW_H - bh/2 - 2, p.y));
    ctx.fillStyle = 'rgba(8,8,16,0.82)';
    ctx.beginPath(); ctx.roundRect(lx, ly - bh/2, tw + pad*2, bh, 3); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'left';
    ctx.fillText(label, lx + pad, ly + 4);
  };
  drawLineLabel(refXY,   '━ Lap A', '#ffffff', 0.03);
  drawLineLabel(compOff, '━ Lap B', '#00c4ff', 0.96);

  // Event markers
  const drawMarker = (x, y, shape, color, glowColor, r, label, labelColor) => {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    if (shape === 'diamond') {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    } else if (shape === 'square') {
      ctx.rect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    if (label) {
      ctx.font = 'bold 9px system-ui';
      const tw = ctx.measureText(label).width;
      const margin = 6;
      let lx = x + r + margin;
      if (lx + tw + 4 > W - 4) lx = x - r - margin - tw - 2;
      let ly = y + 4;
      if (ly > DRAW_H - 4) ly = y - r - 4;
      ctx.fillStyle = 'rgba(6,6,14,0.82)';
      ctx.beginPath();
      ctx.roundRect(lx - 2, ly - 10, tw + 6, 13, 3);
      ctx.fill();
      ctx.fillStyle = labelColor || '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx, ly);
    }
  };

  events.forEach(ev => {
    if (!ev.lat || !ev.lon) return;
    let sx, sy;
    if (ev.isRef) {
      const { x, y } = toXY(ev.lat, ev.lon); sx = x; sy = y;
    } else {
      const { x: rx, y: ry } = toXY(ev.lat, ev.lon);
      let bestIdx = 0, bestDist = Infinity;
      compXY.forEach((p, i) => {
        const d = (p.x - rx) ** 2 + (p.y - ry) ** 2;
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      sx = compOff[bestIdx]?.x ?? rx;
      sy = compOff[bestIdx]?.y ?? ry;
    }
    drawMarker(sx, sy, ev.shape, ev.color, ev.glow || ev.color, ev.r || 7, ev.label, ev.labelColor || ev.color);
  });

  // Direction arrow
  if (refXY.length > 8) {
    const idx = Math.floor(refXY.length * 0.05);
    const p0 = refXY[idx], p1 = refXY[idx + 4];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const ang = Math.atan2(dy, dx);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.save();
    ctx.translate(p0.x + dx/len*10, p0.y + dy/len*10);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(-5, 5); ctx.lineTo(-5, -5); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Metric gradient bar at bottom
  const LY = DRAW_H + 5;
  const LX = 10, LW = W - 20;
  const grad = ctx.createLinearGradient(LX, 0, LX + LW, 0);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const [r, g, b] = metricColor(minVal + t * valRange, t, metric);
    grad.addColorStop(t, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.roundRect(LX, LY, LW, 7, 3); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'left';  ctx.fillText(minVal.toFixed(metric === 'brake' ? 1 : 0), LX, LY + 17);
  ctx.textAlign = 'right'; ctx.fillText(maxVal.toFixed(metric === 'brake' ? 1 : 0), LX + LW, LY + 17);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(metric === 'brake' ? 'bar' : 'km/h', LX + LW/2, LY + 17);
  ctx.restore(); // restore scale transform
}

function findGasStart(seg, afterDist) {
  for (const p of seg) {
    if (p.dist < afterDist) continue;
    if (p.throttle > 8 || p.accelPos > 8) return p;
  }
  return null;
}

function buildZoneEvents(refSeg, compSeg, zone) {
  const events = [];

  const push = (pt, isRef, shape, color, glow, label, labelColor, r) => {
    if (!pt?.lat) return;
    events.push({ lat: pt.lat, lon: pt.lon, isRef, shape, color, glow, label, labelColor, r });
  };

  if (zone.type === 'brake') {
    const rb = zone.ref, cb = zone.comp;

    const rBrakeStart = closestPoint(refSeg, rb.startDist);
    push(rBrakeStart, true, 'square', '#ff2222', '#ff2222', null, null, 7);
    const rBrakeEnd = closestPoint(refSeg, rb.endDist);
    push(rBrakeEnd, true, 'diamond', '#ff9900', '#ffaa00', 'REL', '#ffbb44', 7);
    const rGas = findGasStart(refSeg, rb.endDist);
    push(rGas, true, 'circle', '#00e076', '#00ff88', 'THROTTLE', '#44ff99', 7);

    if (cb) {
      const cBrakeStart = closestPoint(compSeg, cb.startDist);
      push(cBrakeStart, false, 'square',  '#ff2222', '#ff2222', null, null, 7);
      const cBrakeEnd = closestPoint(compSeg, cb.endDist);
      push(cBrakeEnd,   false, 'diamond', '#ff9900', '#ffaa00', null, null, 7);
      const cGas = findGasStart(compSeg, cb.endDist);
      push(cGas,        false, 'circle',  '#00e076', '#00ff88', null, null, 7);
    }

  } else {
    const rc = zone.ref, cc = zone.comp;
    const rb = zone.brakeZone, cb = zone.compBrakeZone;

    if (rb) {
      const rBrakeStart = closestPoint(refSeg, rb.startDist);
      push(rBrakeStart, true,  'square',  '#ff2222', '#ff2222', null,  null,      7);
      const rBrakeEnd   = closestPoint(refSeg, rb.endDist);
      push(rBrakeEnd,   true,  'diamond', '#ff9900', '#ffaa00', 'REL', '#ffbb44', 7);
      if (cb) {
        const cBrakeStart = closestPoint(compSeg, cb.startDist);
        push(cBrakeStart, false, 'square',  '#ff2222', '#ff2222', null, null, 7);
        const cBrakeEnd   = closestPoint(compSeg, cb.endDist);
        push(cBrakeEnd,   false, 'diamond', '#ff9900', '#ffaa00', null, null, 7);
      }
    }

    const rGas = closestPoint(refSeg, rc.throttlePickupDist);
    push(rGas, true, 'circle', '#00e076', '#00ff88', 'THROTTLE', '#44ff99', 7);
    if (cc) {
      const cGas = closestPoint(compSeg, cc.throttlePickupDist);
      push(cGas, false, 'circle', '#00e076', '#00ff88', null, null, 7);
    }
  }

  return events;
}

function buildZoneStats(zone) {
  const fmt = (v, dec = 1) => v != null ? v.toFixed(dec) : '—';
  const diff = (a, b, unit = '', higherBetter = true) => {
    if (a == null || b == null) return '';
    const d = a - b;
    const better = higherBetter ? d >= 0 : d <= 0;
    const sign = d >= 0 ? '+' : '';
    return `<span class="${better ? 'zs-good' : 'zs-bad'}">${sign}${d.toFixed(1)}${unit}</span>`;
  };

  if (zone.type === 'brake') {
    const rb = zone.ref, cb = zone.comp;
    if (!cb) return `<div class="zone-stat"><span class="zs-label">Brake point</span> <span class="zs-ref">${fmt(rb.startDist, 0)}m</span> · <span class="zs-label">Entry</span> <span class="zs-ref">${fmt(rb.entrySpeed)} km/h</span> · <span class="zs-label">Peak</span> <span class="zs-ref">${fmt(rb.peakBrake)} bar</span></div>`;
    const bpDiff = rb.startDist - cb.startDist;
    return `
      <div class="zone-stat"><span class="zs-label">Brake point</span>  <span class="zs-ref">${fmt(rb.startDist, 0)}m</span> vs <span class="zs-comp">${fmt(cb.startDist, 0)}m</span> ${diff(rb.startDist, cb.startDist, 'm', true)} ${bpDiff > 0 ? '← Lap A brakes later' : '← Lap A brakes earlier'}</div>
      <div class="zone-stat"><span class="zs-label">Entry speed</span>  <span class="zs-ref">${fmt(rb.entrySpeed)} km/h</span> vs <span class="zs-comp">${fmt(cb.entrySpeed)} km/h</span> ${diff(rb.entrySpeed, cb.entrySpeed, '', true)}</div>
      <div class="zone-stat"><span class="zs-label">Peak brake</span>   <span class="zs-ref">${fmt(rb.peakBrake)} bar</span> vs <span class="zs-comp">${fmt(cb.peakBrake)} bar</span> ${diff(rb.peakBrake, cb.peakBrake, '', true)}</div>
      <div class="zone-stat"><span class="zs-label">Min speed</span>    <span class="zs-ref">${fmt(rb.minSpeed)} km/h</span> vs <span class="zs-comp">${fmt(cb.minSpeed)} km/h</span> ${diff(rb.minSpeed, cb.minSpeed, '', true)}</div>`;
  } else {
    const rc = zone.ref, cc = zone.comp;
    if (!cc) return `<div class="zone-stat"><span class="zs-label">Entry</span> <span class="zs-ref">${fmt(rc.entrySpeed)}</span> → <span class="zs-label">Apex</span> <span class="zs-ref">${fmt(rc.minSpeed)}</span> → <span class="zs-label">Exit</span> <span class="zs-ref">${fmt(rc.exitSpeed)} km/h</span></div>`;
    const tDiff = rc.throttleDelay - cc.throttleDelay;
    return `
      <div class="zone-stat"><span class="zs-label">Entry speed</span>  <span class="zs-ref">${fmt(rc.entrySpeed)}</span> vs <span class="zs-comp">${fmt(cc.entrySpeed)} km/h</span> ${diff(rc.entrySpeed, cc.entrySpeed, '', true)}</div>
      <div class="zone-stat"><span class="zs-label">Apex speed</span>   <span class="zs-ref">${fmt(rc.minSpeed)}</span> vs <span class="zs-comp">${fmt(cc.minSpeed)} km/h</span> ${diff(rc.minSpeed, cc.minSpeed, '', true)}</div>
      <div class="zone-stat"><span class="zs-label">Exit speed</span>   <span class="zs-ref">${fmt(rc.exitSpeed)}</span> vs <span class="zs-comp">${fmt(cc.exitSpeed)} km/h</span> ${diff(rc.exitSpeed, cc.exitSpeed, '', true)}</div>
      <div class="zone-stat"><span class="zs-label">Throttle delay</span> <span class="zs-ref">+${fmt(rc.throttleDelay, 0)}m</span> vs <span class="zs-comp">+${fmt(cc.throttleDelay, 0)}m after apex</span> <span class="${tDiff <= 0 ? 'zs-good' : 'zs-bad'}">${tDiff <= 0 ? `Lap A ${Math.abs(tDiff).toFixed(0)}m earlier ↑` : `Lap A ${tDiff.toFixed(0)}m later ↓`}</span></div>`;
  }
}

// ── PRESSURE CHART (right panel of each corner card) ──────
function drawPressureChart(canvas, refSeg, compSeg, zone) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  // Scale from original 480×300 logical space → actual canvas size for crisp output
  ctx.scale(canvas.width / 480, canvas.height / 300);
  const W = 480, H = 300;
  ctx.fillStyle = '#07070f';
  ctx.fillRect(0, 0, W, H);

  const mL = 36, mR = 14, mT = 16, mB = 38;
  const pW = W - mL - mR, pH = H - mT - mB;

  const all = [...refSeg, ...compSeg];
  if (all.length < 2) { ctx.restore(); return; }

  const dMin = Math.min(...all.map(p => p.dist));
  const dMax = Math.max(...all.map(p => p.dist));
  const dRange = dMax - dMin || 1;
  const toX = d => mL + (d - dMin) / dRange * pW;
  const toY = pct => mT + pH - Math.max(0, Math.min(1, pct / 100)) * pH;

  // Grid
  [0, 25, 50, 75, 100].forEach(pct => {
    const y = toY(pct);
    ctx.strokeStyle = pct === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)';
    ctx.lineWidth = pct === 0 ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pW, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(pct + '%', mL - 5, y + 4);
  });

  // X grid lines every ~100m
  const step = dRange > 600 ? 200 : dRange > 300 ? 100 : 50;
  for (let d = Math.ceil(dMin / step) * step; d <= dMax; d += step) {
    const x = toX(d);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, mT); ctx.lineTo(x, mT + pH); ctx.stroke();
  }

  const brakeMax = Math.max(...all.map(p => p.brake || 0)) || 80;
  const tField = all.find(p => (p.throttle || 0) > 0) ? 'throttle'
               : all.find(p => (p.accelPos || 0) > 0) ? 'accelPos' : null;

  const LW = 2;

  const drawLine = (seg, getY, color, dash = []) => {
    const pts = seg.filter(p => !isNaN(getY(p)));
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = LW; ctx.lineJoin = 'round';
    ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = toX(p.dist), y = toY(getY(p));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const brakePct  = p => (p.brake || 0) / brakeMax * 100;
  const throttPct = tField ? (p => p[tField] || 0) : null;

  // Lap B dashed (behind), Lap A solid (on top)
  drawLine(compSeg, brakePct,  '#ff3333', [6, 4]);
  if (throttPct) drawLine(compSeg, throttPct, '#00e076', [6, 4]);
  drawLine(refSeg,  brakePct,  '#ff3333');
  if (throttPct) drawLine(refSeg,  throttPct, '#00e076');

  // Y axis label
  ctx.save();
  ctx.translate(10, mT + pH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('%', 0, 0);
  ctx.restore();

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + pH); ctx.lineTo(mL + pW, mT + pH);
  ctx.stroke();

  // X tick labels
  ctx.font = 'bold 10px system-ui';
  const nTicks = Math.min(6, Math.floor(pW / 55));
  for (let i = 0; i <= nTicks; i++) {
    const d = dMin + (i / nTicks) * dRange;
    const x = toX(d);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('+' + Math.round(d - dMin) + 'm', x, mT + pH + 13);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, mT + pH); ctx.lineTo(x, mT + pH + 4); ctx.stroke();
  }

  // X axis label
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '9px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Distance from corner entry (m)', mL + pW / 2, mT + pH + 28);
  ctx.restore(); // restore scale transform
}

// ── CORNER COACHING TIP ────────────────────────────────────
function buildCornerCoachingTip(zone) {
  const rc = zone.ref, cc = zone.comp;
  const rb = zone.brakeZone, cb = zone.compBrakeZone;
  if (!cc) return '<p style="font-size:11px;color:var(--muted2);">No matching Lap B corner found at this location.</p>';

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

  const apexDiff = rc.minSpeed - cc.minSpeed;
  if (Math.abs(apexDiff) > 1.5) {
    tips.push(apexDiff > 0
      ? `Lap A carries <strong>${apexDiff.toFixed(1)} km/h more</strong> through the apex — the later brake point is generating more minimum speed.`
      : `Lap B is <strong>${Math.abs(apexDiff).toFixed(1)} km/h faster</strong> at apex — find more entry speed or a tighter line.`);
  }

  const tDiff = (rc.throttleDelay || 0) - (cc.throttleDelay || 0);
  if (Math.abs(tDiff) > 5) {
    tips.push(tDiff < 0
      ? `Lap A gets on throttle <strong>${Math.abs(tDiff).toFixed(0)}m earlier</strong> after apex — commit to gas sooner for a faster exit.`
      : `Lap B delays throttle by <strong>${tDiff.toFixed(0)}m</strong> more — patience here will give a cleaner exit and more exit speed.`);
  }

  const exitDiff = rc.exitSpeed - cc.exitSpeed;
  if (Math.abs(exitDiff) > 2) {
    tips.push(exitDiff > 0
      ? `Lap A exits <strong>${exitDiff.toFixed(1)} km/h faster</strong> — the earlier throttle is paying off on the straight.`
      : `Lap B exits <strong>${Math.abs(exitDiff).toFixed(1)} km/h faster</strong> — refine the exit line to match.`);
  }

  if (!tips.length) tips.push('Both laps are very similar here — focus on consistency.');

  return `<div class="zone-coaching-header">🏁 Coaching Notes</div>
    <div class="zone-coaching-tip">${tips.map(t => `<p>• ${t}</p>`).join('')}</div>`;
}

// ── MASTER ZONE RENDERER ───────────────────────────────────
function renderAndDrawZones(refLap, compLap) {
  const BRAKE_CTX = 25;
  const EXIT_CTX  = 45;

  const refCorners  = detectCorners(refLap.data);
  const compCorners = detectCorners(compLap.data);
  const refBraking  = detectBrakingZones(refLap.data);
  const compBraking = detectBrakingZones(compLap.data);

  const corners = refCorners.map((rc, idx) => {
    const cc = compCorners.find(c => Math.abs(c.startDist - rc.startDist) < 200);
    const rb = refBraking.find(b => b.endDist >= rc.startDist - 60 && b.startDist < rc.startDist + 100);
    const cb = rb ? compBraking.find(b => Math.abs(b.startDist - rb.startDist) < 220) : null;

    const distStart = rb ? rb.startDist - BRAKE_CTX : rc.startDist - 80;
    const distEnd   = rc.endDist + EXIT_CTX;

    return {
      type: 'corner',
      label: `Corner ${CLUB_MOTORSPORTS_CORNERS[idx] ?? (idx + 1)}`,
      dist: Math.round(rc.startDist),
      direction: rc.direction,
      distStart, distEnd,
      ref: rc, comp: cc,
      brakeZone: rb, compBrakeZone: cb,
      metric: 'speed',
    };
  });

  if (!corners.length) return null;

  const MAP_W = 1600, MAP_H = 1000;
  const CHT_W = 1600, CHT_H = 1000;

  const html = `
    <div class="zone-analysis-section">
      <div class="zone-analysis-header">
        <span class="zone-analysis-title">📍 Corner-by-Corner Analysis</span>
        ${CLUB_MOTORSPORTS_SKIPPED.length ? `<span class="zone-skipped-note">Corners ${CLUB_MOTORSPORTS_SKIPPED.join(', ')} not shown — taken flat-out, no measurable telemetry delta</span>` : ''}
        <div class="zone-legend-pills">
          <div class="zone-legend-pill"><div style="width:20px;height:4px;background:#fff;border-radius:2px;display:inline-block;"></div>&nbsp;Lap A</div>
          <div class="zone-legend-pill"><div style="width:16px;height:3px;background:#00c4ff;border-radius:2px;display:inline-block;"></div>&nbsp;Lap B (offset)</div>
          <div class="zone-legend-pill" style="margin-left:8px;border-left:1px solid rgba(255,255,255,0.1);padding-left:12px;"><div style="width:16px;height:2px;background:#ff3333;display:inline-block;vertical-align:middle;"></div>&nbsp;Brake</div>
          <div class="zone-legend-pill"><div style="width:16px;height:2px;background:#00e076;display:inline-block;vertical-align:middle;"></div>&nbsp;Throttle</div>
          <div class="zone-legend-pill" style="color:rgba(255,255,255,0.3);font-size:9px;">— solid = Lap A &nbsp;· · · dashed = Lap B</div>
        </div>
      </div>
      <div class="zone-cards">
        ${corners.map((z, i) => `
          <div class="zone-card">
            <div class="zone-card-header">
              <span class="zone-card-title">${z.label}</span>
              <span class="zone-card-dist">~${z.dist}m &middot; ${z.direction}</span>
            </div>
            <div class="zone-card-panels">
              <div class="zone-panel">
                <div class="chart-legend-row">
                  <span class="chart-leg-item" style="color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:0.5px;text-transform:uppercase;">Track Map · Speed</span>
                  <span class="chart-leg-item"><span style="display:inline-block;width:18px;height:3px;background:#fff;border-radius:2px;vertical-align:middle;"></span>&nbsp;Lap A</span>
                  <span class="chart-leg-item"><span style="display:inline-block;width:14px;height:2.5px;background:#00c4ff;border-radius:2px;vertical-align:middle;"></span>&nbsp;Lap B</span>
                </div>
                <canvas id="zc_map_${i}" width="${MAP_W}" height="${MAP_H}"></canvas>
              </div>
              <div class="zone-panel">
                <div class="chart-legend-row">
                  <span class="chart-leg-item"><span class="chart-leg-line" style="background:#ff3333;"></span>Brake Lap A</span>
                  <span class="chart-leg-item"><span class="chart-leg-line chart-leg-dashed" style="border-color:#ff3333;"></span>Brake Lap B</span>
                  <span class="chart-leg-item"><span class="chart-leg-line" style="background:#00e076;"></span>Throttle Lap A</span>
                  <span class="chart-leg-item"><span class="chart-leg-line chart-leg-dashed" style="border-color:#00e076;"></span>Throttle Lap B</span>
                </div>
                <canvas id="zc_chart_${i}" width="${CHT_W}" height="${CHT_H}"></canvas>
              </div>
            </div>
            <div class="zone-card-bottom">
              <div class="zone-stats-col">${buildZoneStats(z)}</div>
              <div class="zone-coaching-col">${buildCornerCoachingTip(z)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  return { html, draw: () => {
    corners.forEach((z, i) => {
      const refSeg  = getDataInRange(refLap.data,  z.distStart, z.distEnd);
      const compSeg = getDataInRange(compLap.data, z.distStart, z.distEnd);
      const mapCanvas   = document.getElementById(`zc_map_${i}`);
      const chartCanvas = document.getElementById(`zc_chart_${i}`);
      if (mapCanvas)   drawZoneCanvas(mapCanvas, refSeg, compSeg, z.metric, []);
      if (chartCanvas) drawPressureChart(chartCanvas, refSeg, compSeg, z);
    });
  }};
}
