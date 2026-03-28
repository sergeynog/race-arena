// ============================================================
// AUTH
// Race Arena — auth.js
// Google OAuth sign-in, user profile creation, username check.
// Depends on: firebase-config.js
//
// Auth model:
//   Guest  → no Firebase user, can browse/compare community laps
//            but cannot upload. onSignedIn(null, null).
//   Member → Google sign-in + Firestore profile, full access.
//            onSignedIn(fbUser, profile).
// ============================================================

// ── SIGN IN / OUT ────────────────────────────────────────────

async function signInWithGoogle() {
  if (!FIREBASE_CONFIGURED) {
    alert('Firebase is not configured. See js/firebase-config.js for setup instructions.');
    return null;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  const result   = await auth.signInWithPopup(provider);
  return result.user;
}

async function signOut() {
  if (FIREBASE_CONFIGURED) await auth.signOut();
  // Page reloads into guest mode — auth observer fires with null user
  window.location.reload();
}

// ── USERNAME CHECK ────────────────────────────────────────────

async function isUsernameAvailable(username) {
  if (!FIREBASE_CONFIGURED) return true;
  const snap = await db.collection('usernames').doc(username.toLowerCase()).get();
  return !snap.exists;
}

// ── PROFILE CREATION ──────────────────────────────────────────

async function createUserProfile({ uid, username, displayName, photoURL, experience, level, car, avatarFile }) {
  if (!FIREBASE_CONFIGURED) return;

  const uname = username.toLowerCase().trim();

  // Reserve username
  await db.collection('usernames').doc(uname).set({ uid });

  // Upload avatar if provided
  let finalPhotoURL = photoURL || '';
  if (avatarFile) finalPhotoURL = await uploadAvatar(uid, avatarFile);

  // Write user document
  await db.collection('users').doc(uid).set({
    username: uname, displayName, photoURL: finalPhotoURL,
    experience, level, car: car || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// ── PROFILE FETCH ─────────────────────────────────────────────

async function fetchUserProfile(uid) {
  if (!FIREBASE_CONFIGURED) return null;
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

// ── AUTH STATE OBSERVER ───────────────────────────────────────
// Called on every page load of index.html.
//
// No redirects happen here — the app always loads.
// Guest access is fully allowed for browsing/comparing.
// Upload gate is enforced in app.js / ui.js.
//
//   not signed in               → onSignedIn(null, null)  [guest]
//   signed in, no profile yet   → redirect to login.html?setup=1
//   signed in, has profile      → onSignedIn(fbUser, profile)
//   Firebase not configured     → onSignedIn(null, null)  [guest, no cloud]

function initAuthObserver(onSignedIn) {
  if (!FIREBASE_CONFIGURED) {
    // No backend — guest mode, no cloud laps available
    onSignedIn(null, null);
    return;
  }

  auth.onAuthStateChanged(async (firebaseUser) => {
    if (!firebaseUser) {
      // Unauthenticated guest — full read access, no upload
      onSignedIn(null, null);
      return;
    }

    const profile = await fetchUserProfile(firebaseUser.uid);

    if (!profile) {
      // Authenticated but profile not yet created → profile setup
      sessionStorage.setItem('pendingUser', JSON.stringify({
        uid:         firebaseUser.uid,
        displayName: firebaseUser.displayName || '',
        email:       firebaseUser.email || '',
        photoURL:    firebaseUser.photoURL || '',
      }));
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html?setup=1';
      }
      return;
    }

    onSignedIn(firebaseUser, profile);
  });
}

// ── DRIVER PROFILE CARD HTML ──────────────────────────────────

function buildDriverCard(profile) {
  if (!profile) return '';
  const avatar = profile.photoURL
    ? `<img src="${profile.photoURL}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--border2);">`
    : `<div style="width:40px;height:40px;border-radius:50%;background:var(--card2);border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:18px;">👤</div>`;

  const expLabel = {
    '<1yr': '< 1 Year', '1-3yr': '1–3 Years',
    '3-7yr': '3–7 Years', '7+': '7+ Years',
  }[profile.experience] || profile.experience || '—';

  const levelColor = {
    novice: 'var(--green)', intermediate: 'var(--yellow)', pro: 'var(--accent)',
  }[profile.level] || 'var(--muted)';

  return `
    <div class="driver-card">
      ${avatar}
      <div class="driver-card-info">
        <div class="driver-card-name">${escapeHtml(profile.displayName || profile.username)}</div>
        <div class="driver-card-username">@${escapeHtml(profile.username)}</div>
        <div class="driver-card-meta">
          <span style="color:${levelColor};font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:0.6px;">${profile.level || '—'}</span>
          <span style="color:var(--muted2);">·</span>
          <span style="color:var(--muted);font-size:10px;">${expLabel}</span>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
