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
  drawSolidPath(refXY,   'rgba(0,0,0,0.07)', 8);
  drawSolidPath(compOff, 'rgba(0,0,0,0.07)', 8);

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
    ctx.font = '600 11px Inter, system-ui';
    const tw = ctx.measureText(label).width;
    const pad = 4, bh = 13;
    let lx = Math.max(2, Math.min(W - tw - pad*2 - 2, p.x - pad));
    let ly = Math.max(bh/2 + 2, Math.min(DRAW_H - bh/2 - 2, p.y));
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.roundRect(lx, ly - bh/2, tw + pad*2, bh, 3); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'left';
    ctx.fillText(label, lx + pad, ly + 4);
  };
  drawLineLabel(refXY,   '━ Lap A', LAP_A_COLOR, 0.03);
  drawLineLabel(compOff, '━ Lap B', LAP_B_COLOR, 0.96);

  // Event markers
  const drawMarker = (x, y, shape, color, glowColor, r, label, labelColor) => {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
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
      ctx.font = '600 11px Inter, system-ui';
      const tw = ctx.measureText(label).width;
      const margin = 6;
      let lx = x + r + margin;
      if (lx + tw + 4 > W - 4) lx = x - r - margin - tw - 2;
      let ly = y + 4;
      if (ly > DRAW_H - 4) ly = y - r - 4;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.roundRect(lx - 2, ly - 10, tw + 6, 13, 3);
      ctx.fill();
      ctx.fillStyle = labelColor || '#111111';
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
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
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

  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.font = '600 11px Inter, system-ui';
  ctx.textAlign = 'left';  ctx.fillText(minVal.toFixed(metric === 'brake' ? 1 : 0), LX, LY + 17);
  ctx.textAlign = 'right'; ctx.fillText(maxVal.toFixed(metric === 'brake' ? 1 : 0), LX + LW, LY + 17);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
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
    push(rBrakeStart, true, 'square', '#dc2626', '#dc2626', null, null, 7);
    const rBrakeEnd = closestPoint(refSeg, rb.endDist);
    push(rBrakeEnd, true, 'diamond', '#f59e0b', '#f59e0b', 'REL', '#b45309', 7);
    const rGas = findGasStart(refSeg, rb.endDist);
    push(rGas, true, 'circle', '#16a34a', '#22c55e', 'THROTTLE', '#15803d', 7);

    if (cb) {
      const cBrakeStart = closestPoint(compSeg, cb.startDist);
      push(cBrakeStart, false, 'square',  '#dc2626', '#dc2626', null, null, 7);
      const cBrakeEnd = closestPoint(compSeg, cb.endDist);
      push(cBrakeEnd,   false, 'diamond', '#f59e0b', '#f59e0b', null, null, 7);
      const cGas = findGasStart(compSeg, cb.endDist);
      push(cGas,        false, 'circle',  '#16a34a', '#22c55e', null, null, 7);
    }

  } else {
    const rc = zone.ref, cc = zone.comp;
    const rb = zone.brakeZone, cb = zone.compBrakeZone;

    if (rb) {
      const rBrakeStart = closestPoint(refSeg, rb.startDist);
      push(rBrakeStart, true,  'square',  '#dc2626', '#dc2626', null,  null,      7);
      const rBrakeEnd   = closestPoint(refSeg, rb.endDist);
      push(rBrakeEnd,   true,  'diamond', '#f59e0b', '#f59e0b', 'REL', '#b45309', 7);
      if (cb) {
        const cBrakeStart = closestPoint(compSeg, cb.startDist);
        push(cBrakeStart, false, 'square',  '#dc2626', '#dc2626', null, null, 7);
        const cBrakeEnd   = closestPoint(compSeg, cb.endDist);
        push(cBrakeEnd,   false, 'diamond', '#f59e0b', '#f59e0b', null, null, 7);
      }
    }

    const rGas = rc.throttlePickupDist != null ? closestPoint(refSeg, rc.throttlePickupDist) : null;
    push(rGas, true, 'circle', '#16a34a', '#22c55e', 'THROTTLE', '#15803d', 7);
    if (cc && cc.throttlePickupDist != null) {
      const cGas = closestPoint(compSeg, cc.throttlePickupDist);
      push(cGas, false, 'circle', '#16a34a', '#22c55e', null, null, 7);
    }
  }

  return events;
}

// ── PRESSURE CHART (right panel of each corner card) ──────
function drawPressureChart(canvas, refSeg, compSeg, zone) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  // Scale from original 480×300 logical space → actual canvas size for crisp output
  ctx.scale(canvas.width / 480, canvas.height / 300);
  const W = 480, H = 300;
  ctx.fillStyle = '#ffffff';
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
    ctx.strokeStyle = pct === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.07)';
    ctx.lineWidth = pct === 0 ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(mL + pW, y); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.font = '600 11px Inter, system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(pct + '%', mL - 5, y + 4);
  });

  // X grid lines every ~100m
  const step = dRange > 600 ? 200 : dRange > 300 ? 100 : 50;
  for (let d = Math.ceil(dMin / step) * step; d <= dMax; d += step) {
    const x = toX(d);
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
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
  drawLine(compSeg, brakePct,  '#dc2626', [6, 4]);
  if (throttPct) drawLine(compSeg, throttPct, '#16a34a', [6, 4]);
  drawLine(refSeg,  brakePct,  '#dc2626');
  if (throttPct) drawLine(refSeg,  throttPct, '#16a34a');

  // Y axis label
  ctx.save();
  ctx.translate(10, mT + pH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.font = '600 11px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('%', 0, 0);
  ctx.restore();

  // Axes
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + pH); ctx.lineTo(mL + pW, mT + pH);
  ctx.stroke();

  // X tick labels
  ctx.font = '600 11px Inter, system-ui';
  const nTicks = Math.min(6, Math.floor(pW / 55));
  for (let i = 0; i <= nTicks; i++) {
    const d = dMin + (i / nTicks) * dRange;
    const x = toX(d);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('+' + Math.round(d - dMin) + 'm', x, mT + pH + 13);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, mT + pH); ctx.lineTo(x, mT + pH + 4); ctx.stroke();
  }

  // X axis label
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.font = '11px Inter, system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Distance from corner entry (m)', mL + pW / 2, mT + pH + 28);
  ctx.restore(); // restore scale transform
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

  return `<div class="zone-coaching-header">Coaching notes</div>
    <div class="zone-coaching-tip">${tips.map(t => `<p>• ${t}</p>`).join('')}</div>`;
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

  const fmtDelta = v => v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(3)} s`;
  const maxAbs = Math.max(0.05, ...corners.map(z => Math.abs(z.timeDelta || 0)));

  const html = `
    <div class="corner-view">
      <div class="corner-view-head">
        <div>
          <div class="zone-analysis-title">Corner analysis</div>
          <div class="corner-view-sub">${knownTrack
            ? `${corners.length} turns · official ${escapeHtml(knownTrack.name)} numbering`
            : `${corners.length} corners detected`} · time is Lap B vs Lap A</div>
        </div>
        <div class="corner-picker">
          <button class="btn btn-sm" id="cornerPrev" aria-label="Previous corner">‹</button>
          <select id="cornerSelect" class="corner-select" aria-label="Corner">
            ${corners.map((z, i) => `<option value="${i}">${escapeHtml(z.label)} · ${z.direction}${z.timeDelta != null ? ` · ${fmtDelta(z.timeDelta)}` : ''}</option>`).join('')}
          </select>
          <button class="btn btn-sm" id="cornerNext" aria-label="Next corner">›</button>
        </div>
      </div>

      <div class="corner-strip" role="tablist" aria-label="Time gained or lost per corner">
        ${corners.map((z, i) => {
          const d = z.timeDelta || 0;
          const h = Math.round(Math.abs(d) / maxAbs * 100);
          const cls = d > 0.005 ? 'is-loss' : d < -0.005 ? 'is-gain' : '';
          return `<button class="corner-strip-item ${cls}" data-i="${i}" role="tab"
                    title="${escapeHtml(z.label)}: Lap B ${fmtDelta(z.timeDelta) || 'n/a'}">
                    <span class="corner-strip-bar"><span style="height:${h}%"></span></span>
                    <span class="corner-strip-label">${escapeHtml(String(z.ref.id ?? i + 1))}</span>
                  </button>`;
        }).join('')}
      </div>
      <div class="corner-strip-legend"><span class="is-loss"></span>Lap B slower <span class="is-gain"></span>Lap B faster</div>

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
    const cls = !dir || tiny ? '' : ((dir === 'higher') === (d > 0) ? 'is-good' : 'is-bad');
    return `<td class="mt-delta ${cls}">${tiny ? '0' : (d > 0 ? '+' : '−') + shown}</td>`;
  };

  const metricTable = z => {
    const val = (m, get, fmt) => {
      const v = m ? get(m) : null;
      return v == null || !isFinite(v) ? '—' : fmt(v);
    };
    return `<table class="metric-table">
      <thead><tr><th></th><th>Lap A</th><th>Lap B</th><th>B vs A</th></tr></thead>
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
      : `<div class="corner-verdict ${z.timeDelta > 0.005 ? 'is-loss' : z.timeDelta < -0.005 ? 'is-gain' : ''}">
           <span>Lap B in this section</span><strong>${fmtDelta(z.timeDelta)}</strong>
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
            <figcaption>Line &amp; speed
              <span class="leg"><i style="background:${LAP_A_COLOR}"></i>A</span>
              <span class="leg"><i style="background:${LAP_B_COLOR}"></i>B (offset)</span></figcaption>
            <canvas id="zc_map" width="${MAP_W}" height="${MAP_H}"></canvas>
          </figure>
          <figure class="corner-fig">
            <figcaption>Brake &amp; throttle
              <span class="leg"><i style="background:#dc2626"></i>Brake</span>
              <span class="leg"><i style="background:#16a34a"></i>Throttle</span>
              <span class="leg muted">solid A · dashed B</span></figcaption>
            <canvas id="zc_chart" width="${CHT_W}" height="${CHT_H}"></canvas>
          </figure>
          <figure class="corner-fig is-square">
            <figcaption>Friction circle
              <span class="leg"><i style="background:${LAP_A_COLOR}"></i>A</span>
              <span class="leg"><i style="background:${LAP_B_COLOR}"></i>B</span></figcaption>
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
    drawZoneCanvas(document.getElementById('zc_map'), refSeg, compSeg, z.metric, []);
    drawPressureChart(document.getElementById('zc_chart'), refSeg, compSeg, z);
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

  // Traces: B first, A on top
  const trace = (pts, color) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const px = c + toPx(x), py = c - toPx(y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  trace(ptsB, LAP_B_COLOR);
  trace(ptsA, LAP_A_COLOR);
  ctx.restore();
}

