// ============================================================
// TRACK MAP
// Race Coach AI — trackmap.js
// Canvas-based GPS track visualization with speed heatmap.
// Lap A = reference (speed heatmap), Lap B = offset outline.
// ============================================================

function renderTrackMap() {
  const wrap = document.getElementById('trackCanvasWrap');
  const legend = document.getElementById('trackLegend');

  // Collect the laps to show (Lap A + Lap B, in that order)
  const lapA = getLapA();
  const lapB = getLapB();
  const laps = [lapA, lapB].filter(l => l && Array.isArray(l.data) && l.data.length);

  if (!laps.length) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🗺</div>
      <div class="empty-title">No laps selected</div>
      <div class="empty-desc">Select Lap A and Lap B in the Lap Selector tab to see the GPS track map</div>
    </div>`;
    legend.style.display = 'none';
    return;
  }

  legend.style.display = '';

  // Get canvas or create it
  let canvas = document.getElementById('trackCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'trackCanvas';
  }
  wrap.innerHTML = '';
  wrap.appendChild(canvas);

  const W = wrap.clientWidth - 20;
  const H = wrap.clientHeight - 20;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#08080e';
  ctx.fillRect(0, 0, W, H);

  // Find bounding box of all laps
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  laps.forEach(lap => {
    lap.data.forEach(p => {
      if (p.lat === 0 && p.lon === 0) return;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    });
  });

  const pad = 30;
  const latRange = maxLat - minLat || 0.001;
  const lonRange = maxLon - minLon || 0.001;
  const scale = Math.min((W - pad*2) / lonRange, (H - pad*2) / latRange);

  const toXY = (lat, lon) => {
    const x = pad + (lon - minLon) * scale;
    const y = H - pad - (lat - minLat) * scale;
    return [x, y];
  };

  // Lap A is the reference for speed heatmap
  const refLap = lapA || laps[0];
  const speeds = refLap.data.map(p => p.speed);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const midSpeed = (minSpeed + maxSpeed) / 2;

  // Speed-to-color mapping (blue → cyan → green → yellow → red)
  const speedToColor = s => {
    const t = Math.max(0, Math.min(1, (s - minSpeed) / (maxSpeed - minSpeed)));
    if (t < 0.25) {
      const u = t / 0.25;
      return `rgb(${Math.round(0)},${Math.round(64+u*136)},${Math.round(255)})`;
    } else if (t < 0.5) {
      const u = (t - 0.25) / 0.25;
      return `rgb(${Math.round(0)},${Math.round(196+u*28)},${Math.round(255-u*137)})`;
    } else if (t < 0.75) {
      const u = (t - 0.5) / 0.25;
      return `rgb(${Math.round(u*255)},${Math.round(224-u*109)},${Math.round(118-u*118)})`;
    } else {
      const u = (t - 0.75) / 0.25;
      return `rgb(${Math.round(255-u*55)},${Math.round(115-u*74)},0)`;
    }
  };

  // Draw Lap B first (outline, behind heatmap)
  if (lapB) {
    ctx.strokeStyle = LAP_B_COLOR + '99';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let first = true;
    lapB.data.forEach((p, i) => {
      if (p.lat === 0 && p.lon === 0) return;
      if (i % 2 !== 0) return; // skip every other point for performance
      const [x, y] = toXY(p.lat, p.lon);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Draw Lap A colored by speed (on top)
  for (let i = 1; i < refLap.data.length; i++) {
    const p0 = refLap.data[i-1];
    const p1 = refLap.data[i];
    if (p0.lat === 0 || p1.lat === 0) continue;
    const [x0, y0] = toXY(p0.lat, p0.lon);
    const [x1, y1] = toXY(p1.lat, p1.lon);
    ctx.strokeStyle = speedToColor(p0.speed);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Start marker
  const [sx, sy] = toXY(refLap.data[0].lat, refLap.data[0].lon);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(sx, sy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#08080e';
  ctx.font = 'bold 9px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('S', sx, sy + 3);

  // Update legend
  document.getElementById('speedMax').textContent = `${Math.round(maxSpeed)} km/h`;
  document.getElementById('speedMid').textContent = `${Math.round(midSpeed)} km/h`;
  document.getElementById('speedMin').textContent = `${Math.round(minSpeed)} km/h`;

  const lapLegend = document.getElementById('trackLapLegend');
  let legendHTML = `<div class="legend-item">
    <div class="legend-swatch" style="background:#fff;"></div>
    <span style="font-size:10px;color:#fff;">Lap A · ${refLap.timeStr}</span>
  </div>`;
  if (lapB) {
    legendHTML += `<div class="legend-item">
      <div class="legend-swatch" style="background:${LAP_B_COLOR};"></div>
      <span style="font-size:10px;color:${LAP_B_COLOR};">Lap B · ${lapB.timeStr}</span>
    </div>`;
  }
  lapLegend.innerHTML = legendHTML;

  // Save screen-space pts for click crosshair
  state.trackRefScreenPts = refLap.data
    .filter(p => p.lat && p.lon && !(p.lat === 0 && p.lon === 0))
    .map(p => { const [x, y] = toXY(p.lat, p.lon); return { x, y, dist: p.dist }; });

  // Save base image (before crosshair) for fast overlay redraws
  state._trackBaseCanvas = document.createElement('canvas');
  state._trackBaseCanvas.width = W;
  state._trackBaseCanvas.height = H;
  state._trackBaseCanvas.getContext('2d').drawImage(canvas, 0, 0);

  // Draw existing crosshair marker
  updateTrackCrosshair();

  // Click handler (attach once per canvas element)
  if (!canvas._crosshairBound) {
    canvas._crosshairBound = true;
    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('click', e => {
      if (!state.trackRefScreenPts?.length) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
      let best = null, bestD = Infinity;
      for (const pt of state.trackRefScreenPts) {
        const d = Math.hypot(mx - pt.x, my - pt.y);
        if (d < bestD) { bestD = d; best = pt; }
      }
      if (!best || bestD > 60) return;
      state.crosshairDist = (state.crosshairDist != null &&
        Math.abs(state.crosshairDist - best.dist) < 5) ? null : best.dist;
      updateTrackCrosshair();
      Object.values(state.charts).forEach(c => c.update('none'));
    });
  }
}

// Lightweight crosshair redraw — restores saved base image and draws only the dot
function updateTrackCrosshair() {
  const canvas = document.getElementById('trackCanvas');
  if (!canvas || !state._trackBaseCanvas) return;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(state._trackBaseCanvas, 0, 0);

  if (state.crosshairDist == null || !state.trackRefScreenPts?.length) return;
  const nearest = state.trackRefScreenPts.reduce((b, p) =>
    Math.abs(p.dist - state.crosshairDist) < Math.abs(b.dist - state.crosshairDist) ? p : b);
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(nearest.x, nearest.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}
