// ============================================================
// APP BOOTSTRAP & EVENT HANDLERS
// Race Arena — app.js
// Auth integration, event listeners, file loading,
// cloud lap loading, prompt loading.
// ============================================================

// ── LAZY DATA LOADER ──────────────────────────────────────────
// Ensures telemetry is loaded for whichever laps are selected.
// Returns silently if laps are already loaded or unselected.
async function ensureSelectedLapData() {
  const lapA = getLapA();
  const lapB = getLapB();
  const promises = [];
  if (lapA && !lapA.data) promises.push(ensureLapData(lapA));
  if (lapB && !lapB.data) promises.push(ensureLapData(lapB));
  if (promises.length) await Promise.all(promises);
}

// ── TAB SWITCHING ─────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');

  const panel = document.getElementById(`panel-${tabName}`);
  if (panel) panel.classList.add('active');

  // Coach + Tips tabs get a full-width layout (sidebar hides)
  document.querySelector('.layout').classList.toggle('coach-mode',
    tabName === 'coaching' || tabName === 'tips');

  if (tabName === 'coaching') {
    syncCoachingBar();
    const mainEl = document.getElementById('coachingMain');
    const lapA = getLapA();
    const lapB = getLapB();
    if (mainEl && mainEl.querySelector('.coaching-empty')) {
      if (lapA && lapB) {
        mainEl.innerHTML = `<div class="coaching-empty">
          <div class="coaching-empty-icon">🏎</div>
          <div style="font-size:14px;font-weight:600;color:var(--fg);">Laps selected — ready to analyze</div>
          <div style="font-size:12px;color:var(--muted2);">
            Click <strong>📍 Zone Maps</strong> for a quick visual, or <strong>🎯 Analyze Laps</strong> for a full AI coaching report.
          </div>
        </div>`;
      }
    }
  }

  if (tabName === 'tips' && !state._tipsLoaded) {
    state._tipsLoaded = true;
    loadSavedTips().then(data => { if (data) renderTips(data); });
  }

  if (tabName === 'charts') {
    ensureSelectedLapData().then(() => {
      renderCharts();
      renderTrackMap();
      state.lastRenderedPair = { a: state.lapA, b: state.lapB };
    });
  }
}

// ── LOAD PROMPT FILES ─────────────────────────────────────────
async function loadPrompts() {
  try {
    const [sysRes, tmplRes] = await Promise.all([
      fetch('prompts/marcus-system.md'),
      fetch('prompts/coaching-report.md'),
    ]);
    if (sysRes.ok)  state.promptSystem   = await sysRes.text();
    if (tmplRes.ok) state.promptTemplate = await tmplRes.text();
  } catch (e) {
    console.warn('[Race Arena] Could not load prompt files — using inline fallback.', e);
  }
}

// ── UPLOAD MODAL ─────────────────────────────────────────────
function showUploadModal(fileCount) {
  return new Promise(resolve => {
    const overlay = document.getElementById('uploadModal');
    const carIn   = document.getElementById('uploadCarInput');
    const notesIn = document.getElementById('uploadNotesInput');
    const okBtn   = document.getElementById('uploadModalConfirm');
    const cancelBtn = document.getElementById('uploadModalCancel');
    const countEl = document.getElementById('uploadModalFileCount');

    countEl.textContent = `${fileCount} file${fileCount > 1 ? 's' : ''} selected`;

    const profile = state.currentUserProfile;
    if (profile) {
      carIn.value   = profile.car || '';
      notesIn.value = profile.defaultNotes || '';
    }

    overlay.classList.add('open');
    carIn.focus();

    function cleanup(result) {
      overlay.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() {
      cleanup({ car: carIn.value.trim(), notes: notesIn.value.trim() });
    }
    function onCancel() { cleanup(null); }
    function onBackdrop(e) { if (e.target === overlay) cleanup(null); }
    function onKey(e) {
      if (e.key === 'Escape') cleanup(null);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') onOk();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

// ── LOAD LOCAL CSV FILES ──────────────────────────────────────
async function loadFiles(files, uploadCar, uploadNotes) {
  const userMeta = state.currentUserProfile
    ? { uid: state.currentUser?.uid, username: state.currentUserProfile.username,
        displayName: state.currentUserProfile.displayName }
    : null;

  uploadCar   = (uploadCar   || '').trim();
  uploadNotes = (uploadNotes || '').trim();

  for (const file of files) {
    const text = await file.text();
    const sessionHash = await hashCSV(text);
    if (state.sessions.find(s => s.sessionHash === sessionHash)) continue;

    const parsed = parseAimCSV(text);
    if (!parsed) { console.warn('[Race Arena] Could not parse file'); continue; }

    parsed.sessionHash = sessionHash;
    state.sessions.push(parsed);

    const laps = extractLaps(parsed, sessionHash);
    if (!laps.length) { console.warn('[Race Arena] No laps in session', sessionHash.slice(0, 8)); continue; }

    // Tag laps with current username, car, and notes
    if (userMeta) {
      laps.forEach(l => {
        l.username    = userMeta.username;
        l.displayName = userMeta.displayName;
      });
    }
    laps.forEach(l => {
      if (uploadCar)   l.vehicle = uploadCar;
      if (uploadNotes) l.notes   = uploadNotes;
    });

    // Merge: replace cloud skeletons with full local data, skip true dupes
    for (const lap of laps) {
      const existing = state.allLaps.find(l => String(l.id) === String(lap.id));
      if (existing) {
        if (existing._cloud && !existing.data) {
          Object.assign(existing, lap, { _cloud: false });
        }
      } else {
        state.allLaps.push(lap);
      }
    }

    // Upload to Firebase if configured and user is signed in
    if (FIREBASE_CONFIGURED && userMeta) {
      _uploadToCloud(file, laps, userMeta).catch(e =>
        console.warn('[Race Arena] Cloud upload failed:', e));
    }
  }

  // Persist upload defaults to profile if changed
  if (FIREBASE_CONFIGURED && userMeta && state.currentUser) {
    const profile = state.currentUserProfile;
    const updates = {};
    if (uploadCar && uploadCar !== (profile.car || ''))               updates.car = uploadCar;
    if (uploadNotes && uploadNotes !== (profile.defaultNotes || ''))   updates.defaultNotes = uploadNotes;
    if (Object.keys(updates).length) {
      db.collection('users').doc(state.currentUser.uid).update(updates).catch(() => {});
      Object.assign(profile, updates);
    }
  }

  // Auto-set Lap A to fastest clean lap if not yet chosen
  if (!state.lapA) {
    const raceLaps = state.allLaps.filter(l => !l.isOutLap && !l.isInLap);
    if (raceLaps.length) {
      const best = raceLaps.reduce((a, b) => a.timeSeconds < b.timeSeconds ? a : b);
      state.lapA = best.id;
    }
  }

  updateAll();
}

// Upload CSV to Firebase Storage + save metadata to Firestore
async function _uploadToCloud(file, laps, userMeta) {
  const { hash, csvPath, isNew } = await uploadAndRegisterCSV(file, userMeta);
  if (!isNew) {
    console.log(`[Race Arena] ${file.name} already in cloud (hash: ${hash.slice(0,8)}…)`);
    return;
  }
  await saveSessionAndLaps(hash, laps, userMeta, csvPath);
  console.log(`[Race Arena] Uploaded session ${hash.slice(0, 8)}… to cloud`);
}

// ── LOAD ALL COMMUNITY LAPS FROM CLOUD ───────────────────────
async function loadCloudLaps() {
  if (!FIREBASE_CONFIGURED) return;
  try {
    const cloudLaps = await loadAllCloudLaps();
    mergeCloudLaps(cloudLaps);
    updateAll(); // show community laps immediately (profile fetch may fail for guests)
    const usernames = [...new Set(cloudLaps.map(l => l.username).filter(Boolean))];
    if (usernames.length) {
      try {
        const profiles = await fetchProfiles(usernames);
        Object.assign(state.profileCache, profiles);
      } catch (pe) {
        console.warn('[Race Arena] Profile prefetch skipped:', pe);
      }
      updateAll();
    }
  } catch (e) {
    console.warn('[Race Arena] Failed to load community laps:', e);
  }
}

// ── CLEAR LOCAL FILES ─────────────────────────────────────────
function clearAllFiles() {
  state.sessions = [];
  state.allLaps  = state.allLaps.filter(l => l._cloud); // keep cloud laps
  state.lapA     = null;
  state.lapB     = null;
  state.crosshairDist = null;
  state.lastRenderedPair = { a: null, b: null };
  destroyCharts();
  updateAll();
}

// ── APP INIT (after auth confirms user) ──────────────────────
async function initApp(firebaseUser, profile) {
  state.currentUser        = firebaseUser;
  state.currentUserProfile = profile;

  // Show/hide the drop zone based on whether user is identified
  const hasIdentity = !!(profile && profile.username);
  const dropZone        = document.getElementById('dropZoneSelector');
  const signInPrompt    = document.getElementById('uploadSignInPrompt');
  if (dropZone)     dropZone.style.display     = hasIdentity ? '' : 'none';
  if (signInPrompt) signInPrompt.style.display = hasIdentity ? 'none' : '';

  renderUserHeader();
  loadPrompts();
  loadTipsPrompts();
  loadCloudLaps();

  // Pre-load saved racing tips so they're ready when the tab opens
  if (firebaseUser) {
    loadSavedTips().then(data => {
      if (data) {
        renderTips(data);
        state._tipsLoaded = true;
      }
    });
  }

  updateAll();
}

// ── DOM READY ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const verEl = document.getElementById('appVersionDisplay');
  if (verEl && typeof APP_VERSION !== 'undefined') verEl.textContent = APP_VERSION;

  // ── AUTH OBSERVER ──────────────────────────────────────────
  // Single callback — called for both guests (null, null)
  // and signed-in members (fbUser, profile).
  // No redirect: the app always loads; upload gate handles access.
  initAuthObserver((firebaseUser, profile) => initApp(firebaseUser, profile));

  // ── DROP ZONE & FILE INPUT ─────────────────────────────────
  const dropZone  = document.getElementById('dropZoneSelector');
  const fileInput = document.getElementById('fileInput');

  async function handleFilesSelected(fileList) {
    if (!fileList.length) return;
    const result = await showUploadModal(fileList.length);
    if (!result) return;
    await loadFiles(fileList, result.car, result.notes);
  }

  if (dropZone) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFilesSelected([...e.dataTransfer.files]);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      handleFilesSelected(files);
    });
  }

  // ── CLEAR LOCAL FILES ──────────────────────────────────────
  document.getElementById('btnClearFiles')?.addEventListener('click', async () => {
    if (await showConfirm('Clear locally loaded files? (Community laps remain.)', 'Clear')) clearAllFiles();
  });

  // ── LAP SLOT CLEARS ────────────────────────────────────────
  document.getElementById('slotAClear')?.addEventListener('click', () => {
    state.lapA = null; state.crosshairDist = null;
    state.lastRenderedPair = { a: null, b: null }; updateAll();
  });
  document.getElementById('slotBClear')?.addEventListener('click', () => {
    state.lapB = null; state.crosshairDist = null;
    state.lastRenderedPair = { a: null, b: null }; updateAll();
  });

  // ── GO TO ANALYSIS ─────────────────────────────────────────
  document.getElementById('btnGoAnalysis')?.addEventListener('click', () => switchTab('charts'));

  // ── TAB BAR ───────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // ── SORT COLUMN HEADERS ────────────────────────────────────
  ['thTime', 'thDate', 'thUser'].forEach(id => {
    const col = { thTime: 'time', thDate: 'date', thUser: 'username' }[id];
    document.getElementById(id)?.addEventListener('click', () => {
      setSortBy(col);
      renderLapSelector();
    });
  });

  // (API key modal removed — Claude is accessed via server-side Cloud Function)

  // ── PREVIEW ZONES ──────────────────────────────────────────
  document.getElementById('btnPreviewZones')?.addEventListener('click', async () => {
    const lapA = getLapA();
    const lapB = getLapB();
    if (!lapA || !lapB) return;
    const mainEl = document.getElementById('coachingMain');

    const needsDownload = (lapA._cloud && !lapA.data) || (lapB._cloud && !lapB.data);
    if (needsDownload) {
      mainEl.innerHTML = `<div class="coaching-loading"><div class="spinner"></div> Loading lap data from cloud…</div>`;
    }
    const [okA, okB] = await Promise.all([ensureLapData(lapA), ensureLapData(lapB)]);
    if (!okA || !okB) {
      mainEl.innerHTML = `<div class="coaching-response" style="border-color:var(--accent);">
        <h2 style="color:var(--accent);">Error</h2>
        <p>Could not load telemetry. Please try again.</p>
      </div>`;
      return;
    }

    const zones = renderAndDrawZones(lapA, lapB);
    if (!zones) {
      mainEl.innerHTML = `<div class="coaching-empty"><div class="coaching-empty-icon">🔍</div><div>No significant zones detected.</div></div>`;
      return;
    }
    mainEl.innerHTML = zones.html;
    requestAnimationFrame(() => zones.draw());
  });

  // ── ANALYZE LAPS ───────────────────────────────────────────
  document.getElementById('btnAnalyze')?.addEventListener('click', async () => {
    const lapA = getLapA();
    const lapB = getLapB();
    if (!lapA || !lapB) return;

    if (!state.currentUser) {
      showMarcusLoginRequiredModal();
      return;
    }

    const mainEl     = document.getElementById('coachingMain');
    const analyzeBtn = document.getElementById('btnAnalyze');
    const zonesBtn   = document.getElementById('btnPreviewZones');
    analyzeBtn.disabled = true;
    if (zonesBtn) zonesBtn.disabled = true;

    // Step 1 — load telemetry if needed
    const needsDownload = (lapA._cloud && !lapA.data) || (lapB._cloud && !lapB.data);
    if (needsDownload) {
      mainEl.innerHTML = `<div class="coaching-loading"><div class="spinner"></div> Loading lap data from cloud…</div>`;
      const [okA, okB] = await Promise.all([ensureLapData(lapA), ensureLapData(lapB)]);
      if (!okA || !okB) {
        mainEl.innerHTML = `<div class="coaching-response" style="border-color:var(--accent);">
          <h2 style="color:var(--accent);">Error</h2>
          <p>Could not load telemetry for ${!okA ? 'Lap A' : 'Lap B'}. Please try again.</p>
        </div>`;
        analyzeBtn.disabled = false;
        if (zonesBtn) zonesBtn.disabled = false;
        return;
      }
    } else {
      await Promise.all([ensureLapData(lapA), ensureLapData(lapB)]);
    }

    // Step 2 — check analysis cache
    mainEl.innerHTML = `<div class="coaching-loading"><div class="spinner"></div> Loading…</div>`;
    const cached = await getCachedAnalysis(lapA.id, lapB.id);
    if (cached && cached.response) {
      const zones = renderAndDrawZones(lapA, lapB);
      mainEl.innerHTML = `
        <div class="coaching-response" style="margin-bottom:24px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">📋 Marcus — AI Coaching Report <span style="opacity:.5">(cached)</span></div>
          ${renderMarkdown(cached.response)}
        </div>
        ${zones ? zones.html : ''}
      `;
      if (zones) requestAnimationFrame(() => zones.draw());
      analyzeBtn.disabled = false;
      if (zonesBtn) zonesBtn.disabled = false;
      syncCoachingBar();
      return;
    }

    // Step 3 — call AI
    mainEl.innerHTML = `<div class="coaching-loading"><div class="spinner"></div> Marcus is analyzing your telemetry…</div>`;

    try {
      const zones = renderAndDrawZones(lapA, lapB);
      const { system, user } = buildCoachingPrompt(lapA, lapB);
      const response = await callClaude(system, user);

      mainEl.innerHTML = `
        <div class="coaching-response" style="margin-bottom:24px;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">📋 Marcus — AI Coaching Report</div>
          ${renderMarkdown(response)}
        </div>
        ${zones ? zones.html : ''}
      `;
      if (zones) requestAnimationFrame(() => zones.draw());

      // Save analysis to Firestore cache (non-blocking)
      saveCachedAnalysis(lapA.id, lapB.id, response, zones ? zones.html : '').catch(e =>
        console.warn('[Race Arena] Analysis cache save failed:', e));

      // Trigger background tips update (non-blocking)
      updateRacingTips(response, lapA, lapB).catch(e =>
        console.warn('[Race Arena] Tips update failed:', e));
    } catch (err) {
      if (err.marcusAuthRequired) {
        showMarcusLoginRequiredModal();
        mainEl.innerHTML = getCoachingEmptyPlaceholderHtml();
      } else {
        mainEl.innerHTML = `<div class="coaching-response" style="border-color:var(--accent);">
        <h2 style="color:var(--accent);">Error</h2>
        <p>${err.message}</p>
        <p style="color:var(--muted2);font-size:12px;">Please try again.</p>
      </div>`;
      }
    } finally {
      analyzeBtn.disabled = false;
      if (zonesBtn) zonesBtn.disabled = false;
      syncCoachingBar();
    }
  });

  // ── RESET TIPS ───────────────────────────────────────────
  document.getElementById('btnResetTips')?.addEventListener('click', resetRacingTips);

});
