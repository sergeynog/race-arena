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
    const picked = !!(lapA || lapB);
    wrap.innerHTML = `<div class="empty-state">
      <div class="empty-title">${picked ? 'Track map unavailable' : 'No laps selected'}</div>
      <div class="empty-desc">${picked
        ? 'Telemetry for the selected laps couldn’t be loaded. Try again in a moment.'
        : 'Choose two laps on the Laps tab to see the GPS track map.'}</div>
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
  ctx.fillStyle = '#ffffff';
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

  // Center the track in whichever axis has spare room
  const offX = (W - pad*2 - lonRange * scale) / 2;
  const offY = (H - pad*2 - latRange * scale) / 2;
  const toXY = (lat, lon) => {
    const x = pad + offX + (lon - minLon) * scale;
    const y = H - pad - offY - (lat - minLat) * scale;
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

  const tracePath = (lap, step = 1) => {
    ctx.beginPath();
    let first = true;
    lap.data.forEach((p, i) => {
      if ((p.lat === 0 && p.lon === 0) || i % step) return;
      const [x, y] = toXY(p.lat, p.lon);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    });
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (state.mapColorMode === 'speed') {
    // Lap A coloured by its speed
    for (let i = 1; i < refLap.data.length; i++) {
      const p0 = refLap.data[i-1];
      const p1 = refLap.data[i];
      if (p0.lat === 0 || p1.lat === 0) continue;
      const [x0, y0] = toXY(p0.lat, p0.lon);
      const [x1, y1] = toXY(p1.lat, p1.lon);
      ctx.strokeStyle = speedToColor(p0.speed);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  } else if (laps.includes(lapA)) {
    // Lap A — blue, solid
    ctx.strokeStyle = LAP_A_COLOR;
    ctx.lineWidth = 4;
    tracePath(lapA);
    ctx.stroke();
  }

  // Lap B — green, dashed, on top so both lines stay visible where they overlap
  if (laps.includes(lapB)) {
    ctx.strokeStyle = LAP_B_COLOR;
    ctx.lineWidth = 3;
    ctx.setLineDash(LAP_B_DASH);
    tracePath(lapB, 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Start marker
  const [sx, sy] = toXY(refLap.data[0].lat, refLap.data[0].lon);
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 10px "Titillium Web", system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('S', sx, sy + 3);

  // Update legend
  document.getElementById('speedMax').textContent = `${Math.round(maxSpeed)} km/h`;
  document.getElementById('speedMid').textContent = `${Math.round(midSpeed)} km/h`;
  document.getElementById('speedMin').textContent = `${Math.round(minSpeed)} km/h`;

  const lapLegend = document.getElementById('trackLapLegend');
  const speedMode = state.mapColorMode === 'speed';
  let legendHTML = laps.includes(lapA) ? `<div class="legend-item">
    <span class="lap-swatch a"${speedMode ? ' style="border-top-color:#9aa0a6"' : ''}></span>
    <span class="lap-name-a">Lap A · ${lapA.timeStr}${speedMode ? ' (coloured by speed)' : ''}</span>
  </div>` : '';
  if (laps.includes(lapB)) {
    legendHTML += `<div class="legend-item">
      <span class="lap-swatch b"></span>
      <span class="lap-name-b">Lap B · ${lapB.timeStr}</span>
    </div>`;
  }
  lapLegend.innerHTML = legendHTML;
  document.getElementById('speedLegend').hidden = !speedMode;
  document.querySelectorAll('.map-mode-btn').forEach(btn =>
    btn.classList.toggle('is-active', btn.dataset.mode === (speedMode ? 'speed' : 'laps')));

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
  ctx.fillStyle = '#111111';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(nearest.x, nearest.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── RESIZABLE MAP PANEL ───────────────────────────────────────
// Drag (or arrow-key) the panel edge; width is remembered per browser.
const MAP_WIDTH_KEY = 'raceArena.mapWidth';

(function initMapPanel() {
  // Line colouring: laps (A blue / B green) or Lap A by speed
  try { state.mapColorMode = localStorage.getItem('raceArena.mapColorMode') || 'laps'; } catch { state.mapColorMode = 'laps'; }
  document.querySelectorAll('.map-mode-btn').forEach(btn => btn.addEventListener('click', () => {
    state.mapColorMode = btn.dataset.mode;
    try { localStorage.setItem('raceArena.mapColorMode', state.mapColorMode); } catch {}
    if (document.getElementById('trackCanvas')) renderTrackMap();
  }));

  const body   = document.querySelector('.analysis-body');
  const handle = document.getElementById('mapResizer');
  const panel  = document.getElementById('analysisMap');
  const wrap   = document.getElementById('trackCanvasWrap');
  if (!body || !handle || !panel || !wrap) return;

  const setWidth = w => body.style.setProperty('--map-width', `${Math.round(Math.max(260, Math.min(w, 1400)))}px`);
  const save = () => { try { localStorage.setItem(MAP_WIDTH_KEY, String(panel.offsetWidth)); } catch {} };
  try {
    const saved = parseInt(localStorage.getItem(MAP_WIDTH_KEY), 10);
    if (saved) setWidth(saved);
  } catch {}

  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    body.classList.add('is-resizing');
    const move = ev => setWidth(body.getBoundingClientRect().right - ev.clientX);
    const up = () => {
      body.classList.remove('is-resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('keydown', e => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') setWidth(panel.offsetWidth + step);
    else if (e.key === 'ArrowRight') setWidth(panel.offsetWidth - step);
    else return;
    e.preventDefault();
    save();
  });

  // Redraw when the map's box changes size (drag, window resize, tab shown)
  let pending = null;
  new ResizeObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (wrap.clientWidth > 0 && document.getElementById('trackCanvas')) renderTrackMap();
    }, 80);
  }).observe(wrap);
})();
