// ============================================================
// STATE
// Race Arena — state.js
// ============================================================

const state = {
  // ── LAP DATA ─────────────────────────────────────────────
  sessions: [],
  allLaps: [],
  lapA: null,              // lap ID for Lap A (reference, white)
  lapB: null,              // lap ID for Lap B (comparison, cyan)

  // ── CHART STATE ───────────────────────────────────────────
  charts: {},
  crosshairDist: null,         // distance (m) of the track-map crosshair
  trackRefScreenPts: null,     // [{x,y,dist}] screen-space ref lap pts for crosshair
  lastRenderedPair: { a: null, b: null },

  // ── COACH ─────────────────────────────────────────────────
  promptSystem: '',            // loaded from prompts/marcus-system.md
  promptTemplate: '',          // loaded from prompts/coaching-report.md

  // ── CURRENT USER ─────────────────────────────────────────
  currentUser: null,           // Firebase user object (or null if local mode)
  currentUserProfile: null,    // Firestore profile {username, displayName, photoURL, …}

  // ── LAP TABLE SORT ────────────────────────────────────────
  sortBy:  'date',             // 'time' | 'date' | 'username'
  sortDir: 'desc',             // 'asc'  | 'desc'

  // ── PROFILE CACHE ─────────────────────────────────────────
  // username → profile object, to avoid repeated Firestore reads
  profileCache: {},
};

// ── COLOR HELPERS ─────────────────────────────────────────────
function getLapColor(lapId) {
  if (lapId === state.lapA) return LAP_A_COLOR;
  if (lapId === state.lapB) return LAP_B_COLOR;
  return '#444466';
}

function getLapA() {
  if (state.lapA == null) return null;
  return state.allLaps.find(l => String(l.id) === String(state.lapA)) || null;
}
function getLapB() {
  if (state.lapB == null) return null;
  return state.allLaps.find(l => String(l.id) === String(state.lapB)) || null;
}

// ── LAP LABELS (identity = sessionId / lap id; never CSV filename) ──
function lapSourceLabel(lap) {
  if (!lap) return '';
  if (lap.username) return `@${lap.username}`;
  const track = lap.trackName || lap.session || '';
  if (track) return track;
  if (lap.sessionId) return `${lap.sessionId.slice(0, 8)}…`;
  return '—';
}

/** Stable line for prompts: lap id + track name from telemetry. */
function lapRefLabel(lap) {
  if (!lap) return '';
  const track = lap.trackName || lap.session || '';
  return track ? `${lap.id} · ${track}` : String(lap.id);
}

// ── SORT HELPERS ──────────────────────────────────────────────
function setSortBy(col) {
  if (state.sortBy === col) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortBy  = col;
    state.sortDir = col === 'time' ? 'asc' : 'desc';
  }
}

function sortedLaps() {
  const laps = [...state.allLaps];
  const dir  = state.sortDir === 'asc' ? 1 : -1;

  laps.sort((a, b) => {
    if (state.sortBy === 'time') {
      return dir * (a.timeSeconds - b.timeSeconds);
    }
    if (state.sortBy === 'username') {
      return dir * (lapSourceLabel(a).localeCompare(lapSourceLabel(b)));
    }
    // 'date' — sort by date string then lap number within session
    const dateA = (a.date || '') + String(a.lapNumber || 0).padStart(4, '0');
    const dateB = (b.date || '') + String(b.lapNumber || 0).padStart(4, '0');
    return dir * dateA.localeCompare(dateB);
  });

  return laps;
}
