// ============================================================
// DATABASE
// Race Arena — database.js
// Firestore CRUD: lap metadata, session deduplication,
// loading all community laps.
// Depends on: firebase-config.js, state.js, parser.js
// ============================================================

// ── CONTENT HASH ─────────────────────────────────────────────
// SHA-256 of the raw CSV text, hex-encoded.

async function hashCSV(text) {
  const buf  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Firestore rejects undefined field values (e.g. legacy or merged objects).
function firestoreSafe(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// ── CHECK IF SESSION ALREADY UPLOADED (per-user) ─────────────
// Checks under users/{uid}/sessions/{hash} so each user can upload
// independently — another user's duplicate doesn't block you.

async function sessionExists(hash, uid) {
  if (!FIREBASE_CONFIGURED) return false;
  const snap = await db.collection('users').doc(uid)
    .collection('sessions').doc(hash).get();
  return snap.exists;
}

// ── SAVE SESSION + LAPS ──────────────────────────────────────
// Writes to:
//   users/{uid}/sessions/{hash}   — per-user dedup record
//   users/{uid}/laps/{hash}_{i}   — laps owned by this user
//   laps/{hash}_{i}               — global community index

async function saveSessionAndLaps(hash, laps, meta, csvPath) {
  if (!FIREBASE_CONFIGURED) return;
  if (!meta || !meta.uid) return;

  const batch    = db.batch();
  const userRef  = db.collection('users').doc(meta.uid);
  const username = String(meta.username || '');
  const displayName = String(
    (meta.displayName != null && meta.displayName !== '') ? meta.displayName : username
  );

  const sessionData = firestoreSafe({
    uploadedBy: meta.uid,
    username,
    sessionHash: hash,
    trackName:  (laps[0] && laps[0].session) || '',
    uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  // Per-user session record (dedup guard)
  batch.set(userRef.collection('sessions').doc(hash), sessionData);

  laps.forEach((lap, i) => {
    const lapDocId = `${hash}_${i}`;
    const lapData = firestoreSafe({
      sessionHash:  hash,
      lapIdx:       i,
      lapId:        lapDocId,
      uid:          meta.uid,
      username,
      displayName,
      lapTime:      lap.timeStr || lap.lapTime || '',
      timeSeconds:  lap.timeSeconds,
      date:         lap.date || '',
      sessionLabel: lap.session || '',
      trackName:    lap.session || '',
      vehicle:      lap.vehicle || '',
      notes:        lap.notes || '',
      isOutLap:     lap.isOutLap || false,
      isInLap:      lap.isInLap  || false,
      csvPath,
    });

    // Under the user's subcollection
    batch.set(userRef.collection('laps').doc(lapDocId), lapData);

    // Global community index
    batch.set(db.collection('laps').doc(lapDocId), lapData);
  });

  await batch.commit();
}

// ── DELETE LAP ───────────────────────────────────────────────
// Removes a lap from global community index and the user's subcollection.

async function deleteLapFromCloud(lapId, uid) {
  if (!FIREBASE_CONFIGURED) return;
  const batch = db.batch();
  batch.delete(db.collection('laps').doc(lapId));
  batch.delete(db.collection('users').doc(uid).collection('laps').doc(lapId));
  await batch.commit();
}

// ── LOAD ALL COMMUNITY LAPS ──────────────────────────────────
// Returns an array of lap metadata objects from Firestore.
// Does NOT download CSV data (lazy — only fetch on A/B select).

async function loadAllCloudLaps() {
  if (!FIREBASE_CONFIGURED) return [];

  const snap = await db.collection('laps').get();
  return snap.docs.map(doc => {
    const data = doc.data();
    // Document id is always the canonical lap key; lapId field can be missing on old docs.
    const lapId = data.lapId != null && data.lapId !== '' ? data.lapId : doc.id;
    return { ...data, lapId, _cloud: true };
  });
}

// ── MERGE CLOUD LAPS INTO STATE ──────────────────────────────
// Cloud laps are "skeleton" laps: metadata only, data=null.
// Full telemetry is lazy-loaded when a lap is selected for A/B.

function mergeCloudLaps(cloudLaps) {
  for (const cl of cloudLaps) {
    const rawId = cl.lapId;
    if (rawId == null || rawId === '') continue;
    const id = String(rawId);

    // Skip if already present (by lapId)
    if (state.allLaps.find(l => l.id === id)) continue;

    const idx = typeof cl.lapIdx === 'number' ? cl.lapIdx : parseInt(cl.lapIdx, 10);
    const lapNum = Number.isFinite(idx) ? idx + 1 : 1;
    const timeStr = cl.lapTime != null ? String(cl.lapTime) : '';

    state.allLaps.push({
      id,
      sessionId:    cl.sessionHash,
      lapNumber:    lapNum,
      timeStr,
      lapTime:      cl.lapTime,
      timeSeconds:  cl.timeSeconds,
      date:         cl.date,
      sessionLabel: cl.sessionLabel,
      trackName:    cl.trackName || cl.sessionLabel || '',
      session:      cl.trackName || cl.sessionLabel || '',
      vehicle:      cl.vehicle || '',
      notes:        cl.notes || '',
      uid:          cl.uid || null,
      isOutLap:     cl.isOutLap,
      isInLap:      cl.isInLap,
      username:     cl.username  || null,
      displayName:  cl.displayName || cl.username || '',
      csvPath:      cl.csvPath,
      data:         null,
      _cloud:       true,
    });
  }
}

// ── ENSURE LAP DATA LOADED ───────────────────────────────────
// If a cloud lap's .data is null, download and parse its CSV.
// Caches extracted laps per csvPath so a second lap from the same
// session is instant (no re-download, no re-parse).

const _sessionLapCache = new Map();

async function ensureLapData(lap) {
  if (lap.data && lap.data.length) return true;  // already in memory
  if (!lap._cloud || !lap.csvPath) return false;

  try {
    let sessionId = lap.sessionId;
    if (!sessionId && lap.id) {
      const parts = lap.id.split('_');
      if (parts.length >= 2) sessionId = parts.slice(0, -1).join('_');
    }
    if (!sessionId) return false;

    const cacheKey = lap.csvPath;
    let laps = _sessionLapCache.get(cacheKey);
    if (!laps) {
      const text   = await downloadCSV(lap.csvPath);
      const parsed = parseAimCSV(text);
      if (!parsed) return false;
      laps = extractLaps(parsed, sessionId);
      _sessionLapCache.set(cacheKey, laps);
    }

    const parts  = lap.id.split('_');
    const lapIdx = parseInt(parts[parts.length - 1], 10);
    const match  = laps[lapIdx];
    if (match) {
      lap.data        = match.data;
      lap.timeSeconds = match.timeSeconds;
      lap.timeStr     = match.timeStr;
      lap.lapNumber   = match.lapNumber;
      lap.sessionId   = match.sessionId;
      lap.session     = match.session;
      lap.trackName   = match.session;
    }
    return !!lap.data;
  } catch (e) {
    console.error('[Race Arena] Failed to load lap data:', e);
    return false;
  }
}

// ── ANALYSIS CACHE (Firestore) ──────────────────────────────
// Stores and retrieves AI coaching analysis results keyed by
// a deterministic pair key so identical lap-pair analyses are reused.

function _analysisPairKey(lapAId, lapBId) {
  const uid = auth?.currentUser?.uid || 'anon';
  return `${uid}__${String(lapAId)}__${String(lapBId)}`;
}

async function getCachedAnalysis(lapAId, lapBId) {
  if (!FIREBASE_CONFIGURED || !auth?.currentUser) return null;
  const key = _analysisPairKey(lapAId, lapBId);
  try {
    const doc = await db.collection('analyses').doc(key).get();
    return doc.exists ? doc.data() : null;
  } catch (e) {
    console.warn('[Race Arena] getCachedAnalysis error:', e);
    return null;
  }
}

async function saveCachedAnalysis(lapAId, lapBId, response, zonesHtml) {
  if (!FIREBASE_CONFIGURED || !auth?.currentUser) return;
  const key = _analysisPairKey(lapAId, lapBId);
  try {
    await db.collection('analyses').doc(key).set({
      lapAId: String(lapAId),
      lapBId: String(lapBId),
      response,
      zonesHtml: zonesHtml || '',
      uid: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[Race Arena] saveCachedAnalysis error:', e);
  }
}

// ── SAVE LAP NOTE ────────────────────────────────────────────

async function saveLapNote(lapId, uid, notes) {
  if (!FIREBASE_CONFIGURED || !uid) return;
  const data = { notes: notes || '' };
  const batch = db.batch();
  batch.update(db.collection('laps').doc(lapId), data);
  batch.update(db.collection('users').doc(uid).collection('laps').doc(lapId), data);
  await batch.commit();
}

// ── FETCH USER PROFILES FOR A SET OF USERNAMES ───────────────

async function fetchProfiles(usernames) {
  if (!FIREBASE_CONFIGURED || !usernames.length) return {};
  // Firestore rules: /users reads require auth — guests skip prefetch (driver pills still show @username).
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return {};

  const uniq = [...new Set(usernames.filter(Boolean))];
  const profiles = {};

  // Firestore "in" query supports up to 10 items
  const chunks = [];
  for (let i = 0; i < uniq.length; i += 10) chunks.push(uniq.slice(i, i + 10));

  for (const chunk of chunks) {
    const snap = await db.collection('users')
      .where('username', 'in', chunk)
      .get();
    snap.docs.forEach(doc => { profiles[doc.data().username] = doc.data(); });
  }

  return profiles;
}
