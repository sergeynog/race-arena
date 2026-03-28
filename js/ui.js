// ============================================================
// UI RENDERING
// Race Arena — ui.js
// Renders the Lap Selector tab, compare bar, sidebar, and
// user header chip.  Now supports cloud laps + sort controls.
// ============================================================

// ── CUSTOM CONFIRM DIALOG ────────────────────────────────────
function showConfirm(message, confirmLabel = 'Confirm') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    const msgEl   = document.getElementById('confirmMessage');
    const okBtn   = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');

    msgEl.textContent = message;
    okBtn.textContent = confirmLabel;
    overlay.classList.add('open');

    function cleanup(result) {
      overlay.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk()     { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e)   { if (e.key === 'Escape') cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    okBtn.focus();
  });
}

// ── USER HEADER ─────────────────────────────────────────────
// Guest  → "Sign In" button
// Member → avatar + @username + "Sign Out"

function renderUserHeader() {
  const chip = document.getElementById('userHeaderChip');
  if (!chip) return;

  const user    = state.currentUser;
  const profile = state.currentUserProfile;

  if (!user) {
    // Guest — show Sign In button
    chip.innerHTML = `
      <a href="login.html" class="btn btn-sm" style="
        background:linear-gradient(155deg,#df3040 0%,#c8293a 52%,#a31d2b 100%);
        border-color:transparent;color:#fff;font-weight:700;letter-spacing:0.3px;
        box-shadow:0 2px 10px rgba(200,41,58,0.38),inset 0 1px 0 rgba(255,255,255,0.14);
        text-decoration:none;padding:5px 14px;
      ">Sign In</a>
    `;
    return;
  }

  // Authenticated member
  const avatar = (profile && profile.photoURL)
    ? `<img src="${profile.photoURL}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:1.5px solid var(--border2);">`
    : `<div style="width:26px;height:26px;border-radius:50%;background:var(--card2);border:1.5px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:13px;">👤</div>`;

  const username = profile ? `@${profile.username}` : (user.displayName || user.email || '');

  chip.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      ${avatar}
      <span style="font-size:11px;color:var(--text);font-weight:700;letter-spacing:0.2px;">${escapeHtml(username)}</span>
      <button class="btn btn-sm" id="btnSignOut" style="padding:3px 9px;font-size:10px;">Sign Out</button>
    </div>
  `;

  document.getElementById('btnSignOut')?.addEventListener('click', async () => {
    if (await showConfirm('Sign out of Race Arena?', 'Sign Out')) await signOut();
  });
}

// ── LAP SLOT DISPLAY LABEL ───────────────────────────────────
function lapSlotLabel(lap) {
  if (!lap) return 'Not selected';
  const driver = lap.username ? `@${lap.username}` : lapSourceLabel(lap);
  return `Lap ${lap.lapNumber} · ${lap.timeStr} · ${driver}`;
}

// ── DRIVER PILL ───────────────────────────────────────────────
// Small inline username badge with hover card trigger.
function driverPill(lap) {
  if (!lap.username) {
    return `<span class="lap-file-cell">${escapeHtml(lapSourceLabel(lap))}</span>`;
  }
  const isMe = state.currentUserProfile && lap.username === state.currentUserProfile.username;
  const color = isMe ? 'var(--cyan)' : 'var(--muted)';
  return `<span class="lap-driver-pill" data-username="${escapeHtml(lap.username)}"
    style="color:${color};cursor:pointer;" title="View ${lap.username}'s profile">
    @${escapeHtml(lap.username)}
  </span>`;
}

// ── LAP SELECTOR TAB ─────────────────────────────────────────

function renderLapSelector() {
  const laps  = state.allLaps;
  const lapA  = getLapA();
  const lapB  = getLapB();

  // Slot displays
  const slotAVal   = document.getElementById('slotAValue');
  const slotBVal   = document.getElementById('slotBValue');
  const slotAClear = document.getElementById('slotAClear');
  const slotBClear = document.getElementById('slotBClear');
  const goBtn      = document.getElementById('btnGoAnalysis');

  if (slotAVal) {
    slotAVal.textContent = lapSlotLabel(lapA);
    slotAVal.className   = 'lap-slot-value' + (lapA ? ' has-lap' : '');
  }
  if (slotBVal) {
    slotBVal.textContent = lapSlotLabel(lapB);
    slotBVal.className   = 'lap-slot-value' + (lapB ? ' has-lap' : '');
  }
  if (slotAClear) slotAClear.style.display = lapA ? '' : 'none';
  if (slotBClear) slotBClear.style.display = lapB ? '' : 'none';
  if (goBtn) goBtn.disabled = !(lapA && lapB);

  // Files/users loaded summary
  const filesText = document.getElementById('filesLoadedText');
  if (filesText) {
    if (laps.length) {
      const cloudCount = laps.filter(l => l._cloud).length;
      const localCount = laps.length - cloudCount;
      const parts = [];
      if (localCount) parts.push(`${localCount} local lap${localCount > 1 ? 's' : ''}`);
      if (cloudCount) parts.push(`${cloudCount} community lap${cloudCount > 1 ? 's' : ''}`);
      filesText.textContent = parts.join(' + ') || `${laps.length} laps`;
    } else {
      filesText.textContent = 'No laps loaded';
    }
  }
  const clearBtn = document.getElementById('btnClearFiles');
  if (clearBtn) clearBtn.style.display = laps.filter(l => !l._cloud).length ? '' : 'none';

  // Table
  const tbody = document.getElementById('lapTableBody');
  if (!tbody) return;

  if (!laps.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--muted2);padding:40px 0;">
      Drop CSV files above to load laps${FIREBASE_CONFIGURED ? ' · Community laps loading…' : ''}</td></tr>`;
    return;
  }

  // Best lap across all
  const raceLaps = laps.filter(l => !l.isOutLap && !l.isInLap);
  const bestLap  = raceLaps.length
    ? raceLaps.reduce((a, b) => a.timeSeconds < b.timeSeconds ? a : b)
    : null;

  // Sort laps
  const sorted = sortedLaps();

  // Sort header arrows
  const sortIcon = (col) => {
    if (state.sortBy !== col) return `<span style="color:var(--muted2);font-size:9px;">⇅</span>`;
    return state.sortDir === 'asc'
      ? `<span style="color:var(--cyan);font-size:9px;">↑</span>`
      : `<span style="color:var(--cyan);font-size:9px;">↓</span>`;
  };

  // Update sort headers
  const thTime = document.getElementById('thTime');
  const thDate = document.getElementById('thDate');
  const thUser = document.getElementById('thUser');
  if (thTime) thTime.innerHTML = `Time ${sortIcon('time')}`;
  if (thDate) thDate.innerHTML = `Export Date <span style="font-size:9px;opacity:0.5;cursor:help;" title="This date comes from the AiM CSV export and may reflect when data was downloaded, not the session date.">ⓘ</span> ${sortIcon('date')}`;
  if (thUser) thUser.innerHTML = `Driver ${sortIcon('username')}`;

  // Render rows
  const myUid      = state.currentUser?.uid;
  const myUsername = state.currentUserProfile?.username;

  let html = '';
  sorted.forEach(lap => {
    const isA    = String(lap.id) === String(state.lapA);
    const isB    = String(lap.id) === String(state.lapB);
    const isBest = bestLap && lap.id === bestLap.id;

    let timeClass = 'lap-time-cell';
    if (isA)         timeClass += ' is-lap-a';
    else if (isB)    timeClass += ' is-lap-b';
    else if (isBest) timeClass += ' is-best';

    let badges = '';
    if (isBest)       badges += `<span class="lap-badge badge-best">BEST</span> `;
    if (lap.isOutLap) badges += `<span class="lap-badge badge-outlap">OUT</span> `;
    if (lap.isInLap)  badges += `<span class="lap-badge badge-outlap">IN</span> `;

    const isOwnLap =
      !lap._cloud ||
      (myUid && (lap.uid === myUid || lap.username === myUsername));
    const deleteBtn = isOwnLap
      ? `<button class="lap-delete-btn" data-id="${lap.id}" title="Delete lap"
           style="background:none;border:none;color:var(--muted2);cursor:pointer;
                  font-size:13px;padding:2px 5px;line-height:1;opacity:0.5;"
         >✕</button>`
      : '';

    const trackName = lap.trackName || lap.session || '—';
    const carName   = lap.vehicle || '—';
    const notesText = lap.notes || '';
    const canEdit   = isOwnLap && state.currentUser;
    const noteCell  = canEdit
      ? `<span class="lap-note-cell" data-id="${lap.id}" title="Click to edit notes"
           style="cursor:pointer;color:${notesText ? 'var(--text)' : 'var(--muted2)'};font-size:12px;max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
         >${notesText ? escapeHtml(notesText) : '＋'}</span>`
      : `<span style="color:var(--muted2);font-size:12px;max-width:140px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${notesText ? escapeHtml(notesText) : '—'}</span>`;

    html += `<tr class="${isA ? 'is-lap-a' : ''} ${isB ? 'is-lap-b' : ''}" data-id="${lap.id}">
      <td style="width:28px;text-align:center;">${deleteBtn}</td>
      <td style="width:36px;text-align:center;">
        <button class="slot-btn ${isA ? 'active-a' : ''}" data-slot="a" data-id="${lap.id}" title="Set as Lap A">A</button>
      </td>
      <td style="width:36px;text-align:center;">
        <button class="slot-btn ${isB ? 'active-b' : ''}" data-slot="b" data-id="${lap.id}" title="Set as Lap B">B</button>
      </td>
      <td style="width:36px;text-align:center;color:var(--muted);font-size:11px;">${lap.lapNumber || '—'}</td>
      <td class="${timeClass}">${lap.timeStr || lap.lapTime || '—'}</td>
      <td class="lap-session-cell">${lap.date || '—'}</td>
      <td class="lap-session-cell">${escapeHtml(trackName)}</td>
      <td class="lap-session-cell" style="font-size:12px;">${escapeHtml(carName)}</td>
      <td>${driverPill(lap)}</td>
      <td>${noteCell}</td>
      <td class="lap-file-cell">${badges}</td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // Slot-btn click: toggle lap selection instantly, prefetch data in background
  tbody.querySelectorAll('.slot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id   = btn.dataset.id;
      const slot = btn.dataset.slot;

      if (slot === 'a') {
        if (state.lapB === id) state.lapB = null;
        state.lapA = (state.lapA === id) ? null : id;
      } else {
        if (state.lapA === id) state.lapA = null;
        state.lapB = (state.lapB === id) ? null : id;
      }
      state.crosshairDist = null;
      state.lastRenderedPair = { a: null, b: null };
      updateAll();

      // Prefetch telemetry in background so it's ready when user clicks Analyze
      const lap = state.allLaps.find(l => String(l.id) === String(id));
      if (lap && lap._cloud && !lap.data) {
        ensureLapData(lap).catch(() => {});
      }
    });
  });

  // Delete button
  tbody.querySelectorAll('.lap-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id  = btn.dataset.id;
      const lap = state.allLaps.find(l => String(l.id) === String(id));
      if (!lap) return;
      if (!await showConfirm(`Delete ${lap.timeStr || lap.lapTime || 'this lap'}? This cannot be undone.`, 'Delete')) return;

      // Remove from state
      state.allLaps = state.allLaps.filter(l => l.id !== id);
      if (state.lapA === id) { state.lapA = null; state.lastRenderedPair = { a: null, b: null }; }
      if (state.lapB === id) { state.lapB = null; state.lastRenderedPair = { a: null, b: null }; }
      updateAll();

      // Delete from Firestore if cloud lap
      if (lap._cloud && state.currentUser) {
        deleteLapFromCloud(id, state.currentUser.uid).catch(err =>
          console.warn('[Race Arena] Cloud delete failed:', err));
      }
    });
  });

  // Driver pill hover — show profile card
  tbody.querySelectorAll('.lap-driver-pill').forEach(pill => {
    pill.addEventListener('click', async (e) => {
      e.stopPropagation();
      const username = pill.dataset.username;
      showDriverPopup(username, pill);
    });
  });

  // Notes inline edit
  tbody.querySelectorAll('.lap-note-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cell.querySelector('input')) return;
      const id  = cell.dataset.id;
      const lap = state.allLaps.find(l => String(l.id) === String(id));
      if (!lap) return;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = lap.notes || '';
      input.placeholder = 'e.g. raining, new tires…';
      input.maxLength = 120;
      input.style.cssText = `
        background:var(--bg);border:1px solid var(--cyan);color:var(--text);
        padding:3px 7px;border-radius:4px;font-size:12px;font-family:var(--font);
        width:140px;outline:none;
      `;

      cell.textContent = '';
      cell.appendChild(input);
      input.focus();

      const save = async () => {
        const val = input.value.trim();
        lap.notes = val;
        cell.textContent = val || '＋';
        cell.style.color = val ? 'var(--text)' : 'var(--muted2)';
        if (lap._cloud && state.currentUser) {
          saveLapNote(lap.id, state.currentUser.uid, val).catch(err =>
            console.warn('[Race Arena] Note save failed:', err));
        }
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') input.blur();
        if (ke.key === 'Escape') { input.value = lap.notes || ''; input.blur(); }
      });
    });
  });
}

// ── DRIVER PROFILE POPUP ──────────────────────────────────────

async function showDriverPopup(username, anchorEl) {
  // Remove any existing popup
  document.getElementById('driverPopup')?.remove();

  // Fetch profile (from cache or Firestore)
  let profile = state.profileCache[username];
  if (!profile && FIREBASE_CONFIGURED) {
    try {
      const profiles = await fetchProfiles([username]);
      profile = profiles[username] || null;
      if (profile) state.profileCache[username] = profile;
    } catch (err) {
      console.warn('[Race Arena] Could not load profile for @' + username, err);
    }
  }

  if (!profile) return;

  const popup = document.createElement('div');
  popup.id = 'driverPopup';
  popup.style.cssText = `
    position:fixed; z-index:900;
    background:var(--card); border:1px solid var(--border2); border-top:2px solid var(--accent);
    border-radius:6px; padding:14px; box-shadow:0 8px 32px rgba(0,0,0,0.5);
    min-width:200px; font-size:12px;
  `;
  popup.innerHTML = buildDriverCard(profile);

  document.body.appendChild(popup);

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  popup.style.top  = `${rect.bottom + 6}px`;
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;

  // Click outside to close
  const close = (e) => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

// ── COMPARE BAR ──────────────────────────────────────────────

function renderCompareBar() {
  const bar = document.getElementById('lapCompareBar');
  if (!bar) return;
  const lapA = getLapA();
  const lapB = getLapB();

  if (!lapA && !lapB) {
    bar.innerHTML = `<span style="color:var(--muted2);font-size:11px;">Select Lap A and Lap B in the Lap Selector tab</span>
      <button class="btn btn-sm" style="margin-left:auto;" onclick="switchTab('laps')">← Select Laps</button>`;
    return;
  }

  let html = '';

  if (lapA) {
    const driver = lapA.username ? ` · @${lapA.username}` : ` · ${lapSourceLabel(lapA)}`;
    html += `<div class="compare-chip">
      <div class="compare-chip-dot" style="background:#fff;"></div>
      <span class="compare-chip-label">Lap A</span>
      <span class="compare-chip-time" style="color:#fff;">${lapA.timeStr}</span>
      <span style="color:var(--muted2);font-size:10px;">Lap ${lapA.lapNumber}${driver}</span>
    </div>`;
  }

  if (lapB) {
    let delta = '';
    if (lapA) {
      const diff = lapB.timeSeconds - lapA.timeSeconds;
      const sign = diff >= 0 ? '+' : '';
      const cls  = diff >= 0 ? 'delta-slower' : 'delta-faster';
      delta = `<span class="${cls} compare-chip-delta">${sign}${diff.toFixed(3)}s</span>`;
    }
    const driver = lapB.username ? ` · @${lapB.username}` : ` · ${lapSourceLabel(lapB)}`;
    html += `<div class="compare-chip">
      <div class="compare-chip-dot" style="background:var(--cyan);"></div>
      <span class="compare-chip-label">Lap B</span>
      <span class="compare-chip-time" style="color:var(--cyan);">${lapB.timeStr}</span>
      ${delta}
      <span style="color:var(--muted2);font-size:10px;">Lap ${lapB.lapNumber}${driver}</span>
    </div>`;
  }

  html += `<button class="btn btn-sm" style="margin-left:auto;" onclick="switchTab('laps')">⇄ Change Laps</button>`;
  bar.innerHTML = html;
}

// ── SIDEBAR SLIM SUMMARY ──────────────────────────────────────

function renderSidebar() {
  const lapA = getLapA();
  const lapB = getLapB();
  const container = document.getElementById('sidebarLapSummary');
  if (!container) return;

  let html = '';

  if (lapA) {
    const meta = lapA.username ? `@${lapA.username}` : lapSourceLabel(lapA);
    html += `<div class="sidebar-lap-entry">
      <div class="sidebar-lap-dot" style="background:#fff;"></div>
      <div class="sidebar-lap-info">
        <div class="sidebar-lap-time" style="color:#fff;">A · ${lapA.timeStr}</div>
        <div class="sidebar-lap-meta">Lap ${lapA.lapNumber} · ${meta}</div>
      </div>
    </div>`;
  } else {
    html += `<div style="color:var(--muted2);font-size:11px;">Lap A: not set</div>`;
  }

  if (lapB) {
    const meta = lapB.username ? `@${lapB.username}` : lapSourceLabel(lapB);
    html += `<div class="sidebar-lap-entry">
      <div class="sidebar-lap-dot" style="background:var(--cyan);"></div>
      <div class="sidebar-lap-info">
        <div class="sidebar-lap-time" style="color:var(--cyan);">B · ${lapB.timeStr}</div>
        <div class="sidebar-lap-meta">Lap ${lapB.lapNumber} · ${meta}</div>
      </div>
    </div>`;
  } else {
    html += `<div style="color:var(--muted2);font-size:11px;margin-top:6px;">Lap B: not set</div>`;
  }

  container.innerHTML = html;
}

// ── MASTER UPDATE ─────────────────────────────────────────────

function updateAll() {
  renderLapSelector();
  renderCompareBar();
  renderSidebar();
  renderUserHeader();

  const pairChanged = state.lastRenderedPair.a !== state.lapA ||
                      state.lastRenderedPair.b !== state.lapB;
  if (pairChanged) {
    // Only render charts if both laps have data loaded
    const lapA = getLapA();
    const lapB = getLapB();
    const dataReady = lapA && lapB && Array.isArray(lapA.data) && Array.isArray(lapB.data);
    if (dataReady) {
      renderCharts();
      renderTrackMap();
      state.lastRenderedPair = { a: state.lapA, b: state.lapB };
    }
  }

  syncCoachingBar();
}
