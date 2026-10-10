// ============================================================
// UI RENDERING
// Race Arena — ui.js
// Renders the Lap Selector tab, compare bar, bulk actions and
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
    chip.innerHTML = `<a href="login.html" class="btn btn-primary btn-sm">Sign in</a>`;
    return;
  }

  // Authenticated member
  const avatar = (profile && profile.photoURL)
    ? `<img class="user-avatar" src="${escapeHtml(profile.photoURL)}" alt="">`
    : `<div class="user-avatar">${escapeHtml(((profile && profile.username) || user.displayName || '?').charAt(0).toUpperCase())}</div>`;

  const username = profile ? `@${profile.username}` : (user.displayName || user.email || '');

  chip.innerHTML = `
    <div class="user-chip">
      ${avatar}
      <span class="user-name">${escapeHtml(username)}</span>
      <button class="btn btn-sm btn-ghost" id="btnSignOut">Sign out</button>
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
  return `<span class="lap-driver-pill${isMe ? ' is-me' : ''}" data-username="${escapeHtml(lap.username)}"
    title="View ${escapeHtml(lap.username)}'s profile">@${escapeHtml(lap.username)}</span>`;
}

// ── OWNERSHIP ─────────────────────────────────────────────────
// Local laps are always yours; cloud laps only if you uploaded them.
function isOwnLap(lap) {
  if (!lap._cloud) return true;
  const myUid      = state.currentUser?.uid;
  const myUsername = state.currentUserProfile?.username;
  return !!(myUid && (lap.uid === myUid || lap.username === myUsername));
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
      filesText.textContent = parts.join(' · ') || `${laps.length} laps`;
    } else {
      filesText.textContent = 'No laps loaded';
    }
  }
  const clearBtn = document.getElementById('btnClearFiles');
  if (clearBtn) clearBtn.style.display = laps.filter(l => !l._cloud).length ? '' : 'none';

  // Drop selections for laps that no longer exist or aren't deletable
  const ownIds = new Set(laps.filter(isOwnLap).map(l => String(l.id)));
  for (const id of state.selectedLapIds) if (!ownIds.has(id)) state.selectedLapIds.delete(id);
  syncBulkBar(ownIds.size);

  // Table
  const tbody = document.getElementById('lapTableBody');
  if (!tbody) return;

  if (!laps.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-empty">
      ${FIREBASE_CONFIGURED ? 'Loading community laps…' : 'Upload AiM CSV files above to get started.'}</td></tr>`;
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
    if (state.sortBy !== col) return `<span class="sort-icon">↕</span>`;
    return `<span class="sort-icon is-active">${state.sortDir === 'asc' ? '↑' : '↓'}</span>`;
  };

  // Update sort headers
  const thTime = document.getElementById('thTime');
  const thDate = document.getElementById('thDate');
  const thUser = document.getElementById('thUser');
  if (thTime) thTime.innerHTML = `Time ${sortIcon('time')}`;
  if (thDate) thDate.innerHTML = `Export date ${sortIcon('date')}`;
  if (thUser) thUser.innerHTML = `Driver ${sortIcon('username')}`;

  // Render rows
  let html = '';
  sorted.forEach(lap => {
    const id     = String(lap.id);
    const isA    = id === String(state.lapA);
    const isB    = id === String(state.lapB);
    const isBest = bestLap && lap.id === bestLap.id;
    const isOwn  = ownIds.has(id);
    const isSel  = state.selectedLapIds.has(id);

    let timeClass = 'lap-time-cell';
    if (isA)         timeClass += ' is-lap-a';
    else if (isB)    timeClass += ' is-lap-b';
    else if (isBest) timeClass += ' is-best';

    let badges = '';
    if (isBest)       badges += `<span class="lap-badge badge-best">Best</span>`;
    if (lap.isOutLap) badges += `<span class="lap-badge badge-outlap">Out</span>`;
    if (lap.isInLap)  badges += `<span class="lap-badge badge-outlap">In</span>`;

    const checkbox = isOwn
      ? `<input type="checkbox" class="lap-check" data-id="${escapeHtml(id)}" ${isSel ? 'checked' : ''} aria-label="Select lap">`
      : '';
    const deleteBtn = isOwn
      ? `<button class="lap-delete-btn" data-id="${escapeHtml(id)}" title="Delete lap" aria-label="Delete lap">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
         </button>`
      : '';

    const trackName = lap.trackName || lap.session || '—';
    const carName   = lap.vehicle || '—';
    const notesText = lap.notes || '';
    const canEdit   = isOwn && state.currentUser;
    const noteCell  = canEdit
      ? `<span class="lap-note-cell is-editable${notesText ? '' : ' is-empty'}" data-id="${escapeHtml(id)}" title="Click to edit notes"
         >${notesText ? escapeHtml(notesText) : 'Add note'}</span>`
      : `<span class="lap-note-cell${notesText ? '' : ' is-empty'}">${notesText ? escapeHtml(notesText) : '—'}</span>`;

    const rowClass = [isA && 'is-lap-a', isB && 'is-lap-b', isSel && 'is-selected'].filter(Boolean).join(' ');
    html += `<tr class="${rowClass}" data-id="${escapeHtml(id)}">
      <td class="col-check">${checkbox}</td>
      <td class="col-slot">
        <button class="slot-btn ${isA ? 'active-a' : ''}" data-slot="a" data-id="${escapeHtml(id)}" title="Set as Lap A">A</button>
      </td>
      <td class="col-slot">
        <button class="slot-btn ${isB ? 'active-b' : ''}" data-slot="b" data-id="${escapeHtml(id)}" title="Set as Lap B">B</button>
      </td>
      <td class="col-num">${lap.lapNumber || '—'}</td>
      <td><span class="${timeClass}">${lap.timeStr || lap.lapTime || '—'}</span>${badges}</td>
      <td class="lap-session-cell">${lap.date || '—'}</td>
      <td class="lap-session-cell">${escapeHtml(trackName)}</td>
      <td class="lap-session-cell">${escapeHtml(carName)}</td>
      <td>${driverPill(lap)}</td>
      <td>${noteCell}</td>
      <td class="col-actions">${deleteBtn}</td>
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

  // Row checkboxes — bulk selection
  tbody.querySelectorAll('.lap-check').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedLapIds.add(cb.dataset.id);
      else state.selectedLapIds.delete(cb.dataset.id);
      cb.closest('tr')?.classList.toggle('is-selected', cb.checked);
      syncBulkBar(ownIds.size);
    });
  });

  // Delete button
  tbody.querySelectorAll('.lap-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const lap = state.allLaps.find(l => String(l.id) === btn.dataset.id);
      if (!lap) return;
      if (!await showConfirm(`Delete ${lap.timeStr || lap.lapTime || 'this lap'}? This cannot be undone.`, 'Delete')) return;
      await deleteLaps([lap]);
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
  tbody.querySelectorAll('.lap-note-cell.is-editable').forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cell.querySelector('input')) return;
      const id  = cell.dataset.id;
      const lap = state.allLaps.find(l => String(l.id) === String(id));
      if (!lap) return;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-input lap-note-input';
      input.value = lap.notes || '';
      input.placeholder = 'e.g. raining, new tires…';
      input.maxLength = 120;

      cell.textContent = '';
      cell.appendChild(input);
      input.focus();

      const save = async () => {
        const val = input.value.trim();
        lap.notes = val;
        cell.textContent = val || 'Add note';
        cell.classList.toggle('is-empty', !val);
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

// ── BULK SELECTION ────────────────────────────────────────────

// Show the bulk bar when anything is checked; keep the header
// "select all" checkbox in sync (checked / indeterminate / off).
function syncBulkBar(ownCount) {
  const n       = state.selectedLapIds.size;
  const bar     = document.getElementById('bulkActions');
  const countEl = document.getElementById('bulkCount');
  const all     = document.getElementById('lapSelectAll');
  if (bar) bar.hidden = n === 0;
  if (countEl) countEl.textContent = `${n} selected`;
  document.querySelector('.lap-selector-table')?.classList.toggle('has-own-laps', ownCount > 0);
  if (all) {
    all.disabled      = ownCount === 0;
    all.checked       = ownCount > 0 && n === ownCount;
    all.indeterminate = n > 0 && n < ownCount;
    all.title = ownCount ? 'Select all your laps' : 'You have no laps you can delete';
  }
}

function setAllLapsSelected(checked) {
  state.selectedLapIds.clear();
  if (checked) state.allLaps.filter(isOwnLap).forEach(l => state.selectedLapIds.add(String(l.id)));
  renderLapSelector();
}

async function deleteSelectedLaps() {
  const laps = state.allLaps.filter(l => state.selectedLapIds.has(String(l.id)));
  if (!laps.length) return;
  const label = laps.length === 1 ? '1 lap' : `${laps.length} laps`;
  if (!await showConfirm(`Delete ${label}? This cannot be undone.`, `Delete ${label}`)) return;
  await deleteLaps(laps);
}

// Removes laps from state and, for cloud laps, from Firestore.
// Laps whose cloud delete fails stay in the table.
async function deleteLaps(laps) {
  const uid = state.currentUser?.uid;
  const results = await Promise.allSettled(laps.map(lap =>
    (lap._cloud && uid) ? deleteLapFromCloud(lap.id, uid) : Promise.resolve()));

  const deleted = new Set();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') deleted.add(String(laps[i].id));
    else console.warn('[Race Arena] Cloud delete failed:', r.reason);
  });

  state.allLaps = state.allLaps.filter(l => !deleted.has(String(l.id)));
  deleted.forEach(id => state.selectedLapIds.delete(id));
  if (deleted.has(String(state.lapA))) { state.lapA = null; state.lastRenderedPair = { a: null, b: null }; }
  if (deleted.has(String(state.lapB))) { state.lapB = null; state.lastRenderedPair = { a: null, b: null }; }
  updateAll();

  const failed = laps.length - deleted.size;
  if (failed) showToast(`Couldn't delete ${failed} lap${failed > 1 ? 's' : ''}. Please try again.`, 'error');
  else if (laps.length > 1) showToast(`Deleted ${deleted.size} laps`);
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(message, kind = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('is-leaving'), ms);
  setTimeout(() => el.remove(), ms + 400);
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
  popup.className = 'driver-popup';
  popup.innerHTML = buildDriverCard(profile);

  document.body.appendChild(popup);

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  popup.style.top  = `${rect.bottom + 6}px`;
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;

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
    bar.innerHTML = `<span class="compare-hint">Pick Lap A and Lap B on the Laps tab to compare them.</span>
      <button class="btn btn-sm" style="margin-left:auto;" onclick="switchTab('laps')">Choose laps</button>`;
    return;
  }

  let html = '';

  if (lapA) {
    const driver = lapA.username ? ` · @${lapA.username}` : ` · ${lapSourceLabel(lapA)}`;
    html += `<div class="compare-chip">
      <div class="compare-chip-dot" style="background:var(--lap-a);"></div>
      <span class="compare-chip-label">Lap A</span>
      <span class="compare-chip-time" style="color:var(--lap-a);">${lapA.timeStr}</span>
      <span class="compare-chip-meta">Lap ${lapA.lapNumber}${driver}</span>
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
      <span class="compare-chip-meta">Lap ${lapB.lapNumber}${driver}</span>
    </div>`;
  }

  html += `<button class="btn btn-sm" style="margin-left:auto;" onclick="switchTab('laps')">Change laps</button>`;
  bar.innerHTML = html;
}

// ── MASTER UPDATE ─────────────────────────────────────────────

function updateAll() {
  renderLapSelector();
  renderCompareBar();
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
