// ============================================================
// STORAGE
// Race Arena — storage.js
// Firebase Storage: upload/download CSV files and avatars.
// Depends on: firebase-config.js
// ============================================================

// ── UPLOAD CSV ───────────────────────────────────────────────
// Uploads a CSV file to Storage and returns the storage path.

async function uploadCSV(uid, hash, file) {
  if (!FIREBASE_CONFIGURED) return null;

  const path = `csvs/${uid}/${hash}.csv`;
  const ref  = fbStorage.ref(path);
  await ref.put(file, { contentType: 'text/csv' });
  return path;
}

// ── DOWNLOAD CSV ─────────────────────────────────────────────
// Downloads a CSV file from Storage (by storage path) as text.
// Caches download URLs and CSV text to avoid redundant network trips
// when multiple laps share the same session CSV.

const _urlCache  = new Map();
const _textCache = new Map();

async function downloadCSV(path) {
  if (!FIREBASE_CONFIGURED) return null;

  if (_textCache.has(path)) return _textCache.get(path);

  let url = _urlCache.get(path);
  if (!url) {
    url = await fbStorage.ref(path).getDownloadURL();
    _urlCache.set(path, url);
  }

  const res  = await fetch(url);
  const text = await res.text();
  _textCache.set(path, text);
  return text;
}

// ── UPLOAD AVATAR ─────────────────────────────────────────────
// Uploads a profile picture and returns the public download URL.

async function uploadAvatar(uid, file) {
  if (!FIREBASE_CONFIGURED) return '';

  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `avatars/${uid}/avatar.${ext}`;
  const ref  = fbStorage.ref(path);
  await ref.put(file, { contentType: file.type || 'image/jpeg' });
  return ref.getDownloadURL();
}

// ── FULL UPLOAD FLOW ─────────────────────────────────────────
// Hashes CSV, checks for duplicate, uploads if new, saves metadata.
// Returns: { hash, csvPath, isNew }

async function uploadAndRegisterCSV(file, userMeta) {
  const text = await file.text();
  const hash = await hashCSV(text);

  // Check for duplicate (per-user — other users uploading the same file is fine)
  const exists = await sessionExists(hash, userMeta.uid);
  if (exists) {
    return { hash, csvPath: null, isNew: false };
  }

  // Upload CSV
  const csvPath = await uploadCSV(userMeta.uid, hash, file);

  return { hash, csvPath, text, isNew: true };
}
