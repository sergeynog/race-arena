// ============================================================
// AI COACH
// Race Coach AI — coach.js
// Builds telemetry coaching prompts, calls the Anthropic API,
// and manages the coaching controls bar UI.
// ============================================================

// Simple markdown → HTML renderer
function renderMarkdown(text) {
  return text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[h|u|l])/gm, '')
    .split('\n')
    .map(line => line.match(/^<[hul]/) ? line : (line ? `<p>${line}</p>` : ''))
    .join('');
}

// Build the complete coaching prompt from telemetry data.
// Labels all data columns as "YOU" (logged-in user) vs benchmark driver name
// so the AI cannot confuse which driver to coach.
function buildCoachingPrompt(refLap, compLap) {
  const coachTarget = state.currentUserProfile?.displayName
    || state.currentUserProfile?.username || 'the driver';
  const lapADriver = refLap.username ? `@${refLap.username}` : (refLap.racer || 'unknown');
  const lapBDriver = compLap.username ? `@${compLap.username}` : (compLap.racer || 'unknown');
  const isSameDriver = lapADriver === lapBDriver;

  // Determine which lap is the user's
  const userName = state.currentUserProfile?.username || '';
  const userIsA = !!(userName && refLap.username && refLap.username === userName);
  const userLap  = userIsA ? refLap  : compLap;
  const benchLap = userIsA ? compLap : refLap;
  const benchName = userIsA ? lapBDriver : lapADriver;

  const userCorners  = detectCorners(userLap.data);
  const benchCorners = detectCorners(benchLap.data);
  const userBraking  = detectBrakingZones(userLap.data);
  const benchBraking = detectBrakingZones(benchLap.data);

  const timeDiff = userLap.timeSeconds - benchLap.timeSeconds;
  const timeDiffStr = timeDiff > 0
    ? `YOU are ${timeDiff.toFixed(3)}s SLOWER than ${benchName}`
    : timeDiff < 0
      ? `YOU are ${Math.abs(timeDiff).toFixed(3)}s FASTER than ${benchName}`
      : `Identical lap times`;

  const maxDist = Math.min(
    userLap.data[userLap.data.length-1]?.dist || 0,
    benchLap.data[benchLap.data.length-1]?.dist || 0
  );

  // Speed trace — 12 samples, columns = YOU vs benchmark
  const N = 12;
  let speedDeltaText = `dist(m) | YOU(km/h) | ${benchName}(km/h) | Δ(you-bench)\n`;
  for (let i = 0; i < N; i++) {
    const d = (i / (N-1)) * maxDist;
    const up = interpolateAt(userLap.data, d);
    const bp = interpolateAt(benchLap.data, d);
    if (!up || !bp) continue;
    const delta = up.speed - bp.speed;
    speedDeltaText += `${Math.round(d)} | ${up.speed.toFixed(0)} | ${bp.speed.toFixed(0)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}\n`;
  }

  // Braking zones — YOU vs benchmark
  let brakeText = '';
  userBraking.forEach((ub, idx) => {
    const bb = benchBraking.find(b => Math.abs(b.startDist - ub.startDist) < 200);
    brakeText += `Z${idx+1} @${Math.round(ub.startDist)}m: YOU brk=${ub.startDist.toFixed(0)}m entry=${ub.entrySpeed.toFixed(0)} peak=${ub.peakBrake.toFixed(1)}bar min=${ub.minSpeed.toFixed(0)}`;
    if (bb) {
      brakeText += ` | ${benchName} brk=${bb.startDist.toFixed(0)}m entry=${bb.entrySpeed.toFixed(0)} peak=${bb.peakBrake.toFixed(1)}bar min=${bb.minSpeed.toFixed(0)}\n`;
    } else {
      brakeText += ` | ${benchName}: no match\n`;
    }
  });

  // Corners — YOU vs benchmark
  let cornerText = '';
  userCorners.forEach((uc, idx) => {
    const bc = benchCorners.find(c => Math.abs(c.startDist - uc.startDist) < 150);
    cornerText += `C${idx+1}(${uc.direction}) @${Math.round(uc.startDist)}m: YOU entry=${uc.entrySpeed.toFixed(0)} apex=${uc.minSpeed.toFixed(0)} exit=${uc.exitSpeed.toFixed(0)} throt+${uc.throttleDelay.toFixed(0)}m`;
    if (bc) {
      cornerText += ` | ${benchName} entry=${bc.entrySpeed.toFixed(0)} apex=${bc.minSpeed.toFixed(0)} exit=${bc.exitSpeed.toFixed(0)} throt+${bc.throttleDelay.toFixed(0)}m\n`;
    } else {
      cornerText += ` | ${benchName}: no match\n`;
    }
  });

  let driverNote = '';
  if (!isSameDriver) {
    driverNote = `You are coaching ${coachTarget}. The benchmark is ${benchName}. All "YOU" columns are ${coachTarget}'s data. Address all advice to ${coachTarget} using "you".`;
  } else {
    driverNote = `Both laps are from ${coachTarget} — focus on session-to-session improvement.`;
  }

  let userMsg;
  if (state.promptTemplate) {
    userMsg = state.promptTemplate
      .replace('{{TRACK}}', userLap.session)
      .replace('{{VEHICLE}}', userLap.vehicle || benchLap.vehicle || '')
      .replace('{{COACH_TARGET}}', coachTarget)
      .replace('{{YOUR_TIME}}', userLap.timeStr)
      .replace('{{YOUR_LAP_NUM}}', userLap.lapNumber)
      .replace('{{YOUR_REF}}', lapRefLabel(userLap))
      .replace('{{BENCH_NAME}}', benchName)
      .replace('{{BENCH_TIME}}', benchLap.timeStr)
      .replace('{{BENCH_LAP_NUM}}', benchLap.lapNumber)
      .replace('{{BENCH_REF}}', lapRefLabel(benchLap))
      .replace('{{TIME_DIFF}}', timeDiffStr)
      .replace('{{DRIVER_NOTE}}', driverNote)
      .replace('{{SAMPLE_INTERVAL}}', Math.round(maxDist / N))
      .replace('{{SPEED_DELTA}}', speedDeltaText)
      .replace('{{BRAKE_COUNT}}', userBraking.length)
      .replace('{{BRAKE_ZONES}}', brakeText || 'None detected')
      .replace('{{CORNER_COUNT}}', userCorners.length)
      .replace('{{CORNER_ANALYSIS}}', cornerText || 'None detected');
  } else {
    userMsg = `=== SESSION ===
Track: ${userLap.session} | Vehicle: ${userLap.vehicle || ''}
Coaching: ${coachTarget} | Benchmark: ${benchName}
YOU: ${userLap.timeStr} [Lap ${userLap.lapNumber}] | ${benchName}: ${benchLap.timeStr} [Lap ${benchLap.lapNumber}]
${timeDiffStr}
${driverNote}
=== SPEED (${Math.round(maxDist/N)}m intervals) ===
${speedDeltaText}
=== BRAKING (${userBraking.length}) ===
${brakeText || 'None detected'}
=== CORNERS (${userCorners.length}) ===
${cornerText || 'None detected'}
Give: Executive Summary, Top 3 Improvements (ranked by time gain), Braking Analysis, Corner & Throttle, One Focus Point.`;
  }

  const systemMsg = state.promptSystem || `You are Marcus, an elite motorsport performance coach with 20+ years experience. Give specific, data-driven feedback with exact numbers and distances. Prioritize by lap time gain.`;

  return { system: systemMsg, user: userMsg };
}

// ── callClaude ───────────────────────────────────────────────
// Routes through the Firebase Cloud Function (callMarcus) so the
// Anthropic API key never touches the browser.
// Sends the Firebase ID token in the Authorization header.

const MARCUS_URL = 'https://us-central1-race-arena-d1bc8.cloudfunctions.net/marcus';

/** Error thrown when the user must sign in (client or server rejected auth). */
function marcusAuthRequiredError() {
  const e = new Error('MARCUS_AUTH_REQUIRED');
  e.marcusAuthRequired = true;
  return e;
}

function isMarcusAuthHttpError(status, dataError) {
  if (status === 401 || status === 404) return true;
  const msg = (dataError || '').toLowerCase();
  return /sign in|auth|token|log ?in|unauthorized|forbidden/.test(msg);
}

function showMarcusLoginRequiredModal() {
  const root = document.getElementById('marcusLoginModal');
  if (!root) return;
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('marcusLoginModalClose')?.focus();
}

function hideMarcusLoginModal() {
  const root = document.getElementById('marcusLoginModal');
  if (!root) return;
  root.hidden = true;
  document.body.style.overflow = '';
}

function getCoachingEmptyPlaceholderHtml() {
  return `<div class="coaching-empty">
    <div class="coaching-empty-icon">🏎</div>
    <div style="font-size:14px;font-weight:600;color:var(--muted);">Ready to analyze</div>
    <div style="font-size:12px;color:var(--muted2);">
      Select Lap A and Lap B in the Lap Selector tab,<br>
      then click Zone Maps or Analyze Laps.
    </div>
  </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('marcusLoginModal');
  if (!root) return;
  const close = () => hideMarcusLoginModal();
  root.querySelector('.marcus-modal__backdrop')?.addEventListener('click', close);
  document.getElementById('marcusLoginModalClose')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root && !root.hidden) close();
  });
});

async function callClaude(systemPrompt, userPrompt) {
  if (!FIREBASE_CONFIGURED) {
    throw new Error('Firebase is not configured. See js/firebase-config.js.');
  }
  if (!state.currentUser) {
    throw marcusAuthRequiredError();
  }

  const idToken = await state.currentUser.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let res;
  try {
    res = await fetch(MARCUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ system: systemPrompt, user: userPrompt }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Analysis timed out (90 s). Please try again.');
    throw new Error('Network error — check your connection or disable ad blockers for this site.');
  }
  clearTimeout(timeout);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (isMarcusAuthHttpError(res.status, data.error)) {
      throw marcusAuthRequiredError();
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data.content;
}

// ── syncCoachingBar ───────────────────────────────────────────
// Updates Marcus controls bar. No API key check needed — the key
// lives on the server. Requires a signed-in user to analyze.

function syncCoachingBar() {
  const lapA    = getLapA();
  const lapB    = getLapB();
  const hasPair = !!(lapA && lapB);
  const hasUser = !!state.currentUser;

  const elA = document.getElementById('coachLapADisplay');
  const elB = document.getElementById('coachLapBDisplay');
  if (elA) elA.textContent = lapA
    ? `Lap ${lapA.lapNumber} · ${lapA.timeStr} · ${lapA.username ? '@' + lapA.username : lapSourceLabel(lapA)}`
    : '— not set';
  if (elB) elB.textContent = lapB
    ? `Lap ${lapB.lapNumber} · ${lapB.timeStr} · ${lapB.username ? '@' + lapB.username : lapSourceLabel(lapB)}`
    : '— not set';

  const btnZ   = document.getElementById('btnPreviewZones');
  const btnA   = document.getElementById('btnAnalyze');
  const notice = document.getElementById('coachSignInNotice');
  if (btnZ) btnZ.disabled = !hasPair;
  if (btnA) btnA.disabled = !hasPair;
  if (notice) notice.style.display = (!hasUser && hasPair) ? '' : 'none';
}
