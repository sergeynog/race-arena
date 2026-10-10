// ============================================================
// CHARTS
// Race Coach AI — charts.js
// Chart.js telemetry overlays (Speed, Brake, Throttle, G-forces).
// Uses state.lapA / state.lapB — always at most two datasets.
// ============================================================

function destroyCharts() {
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};
}

function makeChartConfig(label, unit, datasets, decimals = 1) {
  return {
    type: 'line',
    data: { datasets },
    options: {
      devicePixelRatio: window.devicePixelRatio || 1,
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#ffffff',
          borderColor: '#d6d6d6',
          borderWidth: 1,
          titleColor: '#6b6b6b',
          bodyColor: '#111111',
          callbacks: {
            title: items => `${Math.round(items[0].parsed.x)} m`,
            label: item => ` ${item.dataset.label}: ${item.parsed.y.toFixed(decimals)} ${unit}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: false },
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: {
            color: '#6b6b6b',
            font: { family: 'Titillium Web', size: 12, weight: '600' },
            maxTicksLimit: 8,
            callback: v => `${Math.round(v)}m`,
          },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: {
            color: '#6b6b6b',
            font: { family: 'Titillium Web', size: 12, weight: '600' },
            maxTicksLimit: 5,
          },
        },
      },
      elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.2 } },
    },
  };
}

// Build Chart.js datasets for a single telemetry field.
// lapObjects: array of {lap, isA} where isA=true means Lap A (white/solid),
//             isA=false means Lap B (cyan/dashed).
function buildDatasets(field, lapObjects) {
  return lapObjects.map(({ lap, isA }) => {
    const color = isA ? LAP_A_COLOR : LAP_B_COLOR;
    const resampled = resampleLap(lap.data, 500);
    return {
      label: `${isA ? 'Lap A' : 'Lap B'} · ${lap.timeStr || lap.lapTime || '?'}`,
      data: resampled.map(p => ({ x: p.dist, y: p[field] })),
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: isA ? [] : LAP_B_DASH,
    };
  });
}

// Datasets from a derived per-sample series (e.g. combined G) or a raw field
function buildSeriesDatasets(lapObjects, seriesFor) {
  return lapObjects.map(({ lap, isA }) => ({
    label: `${isA ? 'Lap A' : 'Lap B'} · ${lap.timeStr || lap.lapTime || '?'}`,
    data: seriesFor(lap),
    borderColor: isA ? LAP_A_COLOR : LAP_B_COLOR,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderDash: isA ? [] : LAP_B_DASH,
  }));
}

// Hover-sync plugin — mousemove on any chart updates the track map crosshair + all sibling charts
Chart.register({
  id: 'chartHoverSync',
  afterEvent(chart, args) {
    const evt = args.event;
    if (evt.type === 'mouseout') {
      if (state.crosshairDist == null) return;
      state.crosshairDist = null;
      if (typeof updateTrackCrosshair === 'function') updateTrackCrosshair();
      Object.values(state.charts).forEach(c => c.update('none'));
      return;
    }
    if (evt.type !== 'mousemove') return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const px = evt.x;
    if (px < chart.chartArea.left || px > chart.chartArea.right) return;
    const dist = xScale.getValueForPixel(px);
    if (dist == null || dist < xScale.min || dist > xScale.max) return;
    state.crosshairDist = dist;
    if (typeof updateTrackCrosshair === 'function') updateTrackCrosshair();
    Object.values(state.charts).forEach(c => {
      if (c !== chart) c.update('none');
    });
  }
});

// Crosshair plugin — draws a vertical line + dots on all charts at the clicked track distance
Chart.register({
  id: 'trackCrosshair',
  afterDraw(chart) {
    if (state.crosshairDist == null) return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const x = xScale.getPixelForValue(state.crosshairDist);
    if (x < chart.chartArea.left - 1 || x > chart.chartArea.right + 1) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    // Dot on each visible dataset
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (!meta.visible || !ds.data.length) return;
      let best = null, bestDx = Infinity;
      ds.data.forEach(pt => {
        const dx = Math.abs(pt.x - state.crosshairDist);
        if (dx < bestDx) { bestDx = dx; best = pt; }
      });
      if (!best) return;
      const px = xScale.getPixelForValue(best.x);
      const py = chart.scales.y.getPixelForValue(best.y);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = ds.borderColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();
  }
});

function renderCharts() {
  const lapA = getLapA();
  const lapB = getLapB();
  const grid = document.getElementById('chartsGrid');

  if (!lapA && !lapB) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-title">No laps selected</div>
      <div class="empty-desc">Choose two laps on the Laps tab to see telemetry overlays.</div>
    </div>`;
    return;
  }

  const pair = lapA?.data && lapB?.data;
  const logs = field => [lapA, lapB].some(l => l?.data && hasChannel(l, field));
  const hasAlt = logs('alt');
  const hasBrake = logs('brake');
  const hasThrottle = logs('throttle') || logs('accelPos');

  grid.innerHTML = `
    ${pair ? `<div class="chart-card wide">
      <div class="chart-title">Time gap <span class="chart-unit">above zero (blue) = <b class="lap-name-a">Lap A ahead</b> · below zero (green) = <b class="lap-name-b">Lap B ahead</b></span></div>
      <div class="chart-container"><canvas id="chartDelta"></canvas></div>
    </div>` : ''}
    <div class="chart-card wide">
      <div class="chart-title">Speed <span class="chart-unit">km/h</span></div>
      <div class="chart-container"><canvas id="chartSpeed"></canvas></div>
    </div>
    ${hasBrake ? `<div class="chart-card">
      <div class="chart-title">Brake Pressure <span class="chart-unit">bar</span></div>
      <div class="chart-container"><canvas id="chartBrake"></canvas></div>
    </div>` : ''}
    ${hasThrottle ? `<div class="chart-card">
      <div class="chart-title">Throttle <span class="chart-unit">%</span></div>
      <div class="chart-container"><canvas id="chartThrottle"></canvas></div>
    </div>` : ''}
    <div class="chart-card">
      <div class="chart-title">Lateral G <span class="chart-unit">g</span></div>
      <div class="chart-container"><canvas id="chartLatG"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">Longitudinal G <span class="chart-unit">g</span></div>
      <div class="chart-container"><canvas id="chartLonG"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">Combined G <span class="chart-unit">g · total grip in use</span></div>
      <div class="chart-container"><canvas id="chartCombG"></canvas></div>
    </div>
    ${hasAlt ? `<div class="chart-card">
      <div class="chart-title">Elevation <span class="chart-unit">m</span></div>
      <div class="chart-container"><canvas id="chartAlt"></canvas></div>
    </div>` : ''}
  `;

  destroyCharts();

  // Build ordered pair array: Lap A first (rendered on top), Lap B second (dashed)
  const lapObjects = [];
  if (lapA && lapA.data) lapObjects.push({ lap: lapA, isA: true });
  if (lapB && lapB.data) lapObjects.push({ lap: lapB, isA: false });

  const fields = [
    ['chartSpeed',    'speed',    'km/h'],
    ['chartBrake',    'brake',    'bar'],
    ['chartThrottle', 'throttle', '%'],
    ['chartLatG',     'latAcc',   'g'],
    ['chartLonG',     'lonAcc',   'g'],
  ];

  fields.forEach(([id, field, unit]) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const datasets = buildDatasets(field, lapObjects);
    const ctx = canvas.getContext('2d');
    state.charts[id] = new Chart(ctx, makeChartConfig(field, unit, datasets));
  });

  const derivedCharts = [
    ['chartCombG', 'g', 2, lap => seriesOf(lap, null, 500, lapDerived(lap).combG)],
    ['chartAlt',   'm', 1, lap => seriesOf(lap, 'alt', 500)],
  ];
  derivedCharts.forEach(([id, unit, dec, seriesFor]) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    state.charts[id] = new Chart(canvas.getContext('2d'),
      makeChartConfig(id, unit, buildSeriesDatasets(lapObjects, seriesFor), dec));
  });

  const deltaCanvas = document.getElementById('chartDelta');
  if (deltaCanvas) {
    const cfg = makeChartConfig('delta', 's', [{
      label: 'Gap (Lap B − Lap A)',
      data: deltaTrace(lapA, lapB),
      borderColor: '#111111',
      borderWidth: 2,
      // Shade by who is ahead: Lap A's colour above zero, Lap B's below
      fill: { target: 'origin', above: 'rgba(29,111,224,0.16)', below: 'rgba(22,163,74,0.18)' },
    }], 3);
    cfg.options.scales.y.ticks.callback = v => `${v > 0 ? '+' : ''}${v.toFixed(1)}s`;
    cfg.options.scales.y.grid.color = ctx => ctx.tick.value === 0 ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.06)';
    state.charts.chartDelta = new Chart(deltaCanvas.getContext('2d'), cfg);
  }
}
