// ============================================================
// RACING TIPS
// Race Arena — tips.js
// Persistent per-user racing tips that evolve with each analysis.
// ============================================================

const TIPS_URL = 'https://us-central1-race-arena-d1bc8.cloudfunctions.net/marcusTips';

let _tipsSystemPrompt = '';
let _tipsTemplate     = '';

async function loadTipsPrompts() {
  try {
    const [sysRes, tmplRes] = await Promise.all([
      fetch('prompts/racing-tips-system.md'),
      fetch('prompts/racing-tips-template.md'),
    ]);
    if (sysRes.ok)  _tipsSystemPrompt = await sysRes.text();
    if (tmplRes.ok) _tipsTemplate     = await tmplRes.text();
  } catch (e) {
    console.warn('[Race Arena] Could not load tips prompt files.', e);
  }
}

// ── Load saved tips from Firestore ──────────────────────────

async function loadSavedTips() {
  if (!FIREBASE_CONFIGURED || !state.currentUser) return null;
  try {
    const doc = await db.collection('users').doc(state.currentUser.uid)
      .collection('tips').doc('current').get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (e) {
    console.warn('[Race Arena] Could not load saved tips:', e);
    return null;
  }
}

// ── Display tips in the tips panel ──────────────────────────

function renderTips(tipsData) {
  const mainEl = document.getElementById('tipsMain');
  const updatedEl = document.getElementById('tipsLastUpdated');
  const resetBtn = document.getElementById('btnResetTips');
  if (!mainEl) return;

  if (!tipsData || !tipsData.content) {
    mainEl.innerHTML = `
      <div class="coaching-empty">
        <div class="coaching-empty-icon">📌</div>
        <div style="font-size:14px;font-weight:600;color:var(--muted);">No racing tips yet</div>
        <div style="font-size:12px;color:var(--muted2);">
          Run a Marcus analysis on the Coach tab.<br>
          Your personal tips will build up over time — tracking patterns,<br>
          improvements, and key focus areas across sessions.
        </div>
      </div>`;
    if (updatedEl) updatedEl.textContent = '';
    if (resetBtn) resetBtn.style.display = 'none';
    return;
  }

  const content = tipsData.content;
  const count = tipsData.analysisCount || 0;

  const sections = parseTipsSections(content);

  let html = '';

  if (sections.focus) {
    html += `<div class="tips-card tips-focus">
      <div class="tips-card-label">🎯 What to Work On</div>
      <div class="coaching-response" style="border:0;padding:0;margin:0;background:transparent;box-shadow:none;">
        ${renderMarkdown(sections.focus)}
      </div>
    </div>`;
  }

  if (sections.patterns) {
    html += `<div class="tips-card tips-patterns">
      <div class="tips-card-label">🔁 Patterns We're Seeing</div>
      <div class="coaching-response" style="border:0;padding:0;margin:0;background:transparent;box-shadow:none;">
        ${renderMarkdown(sections.patterns)}
      </div>
    </div>`;
  }

  if (sections.progress) {
    html += `<div class="tips-card tips-improvements">
      <div class="tips-card-label">📈 Your Progress</div>
      <div class="coaching-response" style="border:0;padding:0;margin:0;background:transparent;box-shadow:none;">
        ${renderMarkdown(sections.progress)}
      </div>
    </div>`;
  }

  if (!html) {
    html = `<div class="coaching-response">${renderMarkdown(content)}</div>`;
  }

  if (count > 0) {
    html += `<div class="tips-analysis-count">Based on ${count} analysis session${count !== 1 ? 's' : ''}</div>`;
  }

  mainEl.innerHTML = html;

  if (updatedEl) {
    const ts = tipsData.updatedAt;
    if (ts && ts.toDate) {
      updatedEl.textContent = `Updated ${ts.toDate().toLocaleDateString()}`;
    } else if (ts) {
      updatedEl.textContent = `Updated ${new Date(ts).toLocaleDateString()}`;
    }
  }

  if (resetBtn) resetBtn.style.display = '';
}

function parseTipsSections(text) {
  const sections = { focus: '', patterns: '', progress: '' };
  const lines = text.split('\n');
  let current = null;

  for (const line of lines) {
    if (/^##\s.*(work on|focus)/i.test(line)) {
      current = 'focus';
      continue;
    } else if (/^##\s.*pattern/i.test(line)) {
      current = 'patterns';
      continue;
    } else if (/^##\s.*(progress|improvement)/i.test(line)) {
      current = 'progress';
      continue;
    }
    if (current) {
      sections[current] += line + '\n';
    }
  }

  return sections;
}

// ── Trigger tips update after a coaching analysis ───────────

async function updateRacingTips(coachingReport, lapA, lapB) {
  if (!FIREBASE_CONFIGURED || !state.currentUser) return;
  if (!_tipsSystemPrompt || !_tipsTemplate) return;

  const tipsMainEl = document.getElementById('tipsMain');

  let previousTips = '(No previous tips — this is the first analysis.)';
  let analysisCount = 1;

  try {
    const existing = await loadSavedTips();
    if (existing && existing.content) {
      previousTips = existing.content;
      analysisCount = (existing.analysisCount || 0) + 1;
    }
  } catch { /* use defaults */ }

  const driverName = state.currentUserProfile?.displayName
    || state.currentUserProfile?.username || 'the driver';
  const lapADriver = lapA?.username ? `@${lapA.username}` : (lapA?.racer || 'unknown');
  const lapBDriver = lapB?.username ? `@${lapB.username}` : (lapB?.racer || 'unknown');
  const isSameDriver = lapADriver === lapBDriver;

  const userIsLapA = lapADriver.includes(driverName) || lapADriver.includes(state.currentUserProfile?.username);
  const userLap = userIsLapA ? 'A' : 'B';
  const userTime = userIsLapA ? (lapA?.timeStr || '?') : (lapB?.timeStr || '?');
  const otherDriver = userIsLapA ? lapBDriver : lapADriver;
  const otherTime = userIsLapA ? (lapB?.timeStr || '?') : (lapA?.timeStr || '?');

  let contextBlock = `\n=== DRIVER CONTEXT ===\n`;
  contextBlock += `Tips owner (YOU): ${driverName}\n`;
  contextBlock += `YOUR lap: Lap ${userLap} — ${userTime}\n`;
  if (!isSameDriver) {
    contextBlock += `Benchmark lap: ${otherDriver} — ${otherTime}\n`;
    contextBlock += `CRITICAL: All tips are for ${driverName}. In the coaching report below, every mention of "${lapADriver}'s lap" is ${lapADriver}'s data, and "${lapBDriver}'s lap" is ${lapBDriver}'s data. Write advice FROM ${driverName}'s perspective — use "you" for ${driverName}'s numbers, and reference ${otherDriver} as the benchmark.\n`;
  } else {
    contextBlock += `Both laps are from ${driverName} — this is a self-comparison.\n`;
  }

  // Rewrite "Lap A" / "Lap B" in the coaching report to use driver names
  // so the tips AI cannot mix up who is who.
  let annotatedReport = coachingReport
    .replace(/\bLap A\b/g, `${lapADriver}'s lap (A)`)
    .replace(/\bLap B\b/g, `${lapBDriver}'s lap (B)`)
    .replace(/\bLA\b/g, lapADriver)
    .replace(/\bLB\b/g, lapBDriver);

  const userPrompt = _tipsTemplate
    .replace('{{PREVIOUS_TIPS}}', previousTips)
    .replace('{{LATEST_REPORT}}', annotatedReport)
    .replace('{{ANALYSIS_COUNT}}', String(analysisCount))
    .replace('{{DRIVER_CONTEXT}}', contextBlock);

  const idToken = await state.currentUser.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(TIPS_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ system: _tipsSystemPrompt, user: userPrompt }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.content) {
      renderTips({
        content: data.content,
        analysisCount: data.analysisCount || analysisCount,
        updatedAt: new Date(),
      });
      console.log('[Race Arena] Racing tips updated');
    } else {
      console.warn('[Race Arena] Tips update failed:', data.error || res.status);
    }
  } catch (err) {
    clearTimeout(timeout);
    console.warn('[Race Arena] Tips update error:', err.message);
  }
}

// ── Reset tips ──────────────────────────────────────────────

async function resetRacingTips() {
  if (!FIREBASE_CONFIGURED || !state.currentUser) return;
  if (!await showConfirm('Reset your racing tips? This will clear all accumulated tips.', 'Reset')) return;

  try {
    await db.collection('users').doc(state.currentUser.uid)
      .collection('tips').doc('current').delete();
    renderTips(null);
  } catch (e) {
    console.error('[Race Arena] Could not reset tips:', e);
  }
}
