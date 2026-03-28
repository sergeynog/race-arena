# Race Arena — features

Living document: **update this file whenever you add, remove, or materially change a feature** (include a one-line note under [Changelog](#changelog)).

**Last updated:** 2025-03-24

## Status legend

| Status | Meaning |
|--------|---------|
| Done | Implemented and expected to work per current rules |
| Partial | Works in some cases; gaps or follow-up noted |
| Planned | Not implemented yet |
| Verify | Needs manual/automated testing |

---

## F-001 — User profiles: Guest vs Member (Google)

**Scope:** Two modes: **Guest** (not signed in) and **Member** (signed in via Google, with a Firestore profile).

| Piece | Status | Notes |
|-------|--------|--------|
| Google sign-in flow | Done | `login.html`, `signInWithGoogle()` in `js/auth.js` |
| Continue as guest | Done | Link from `login.html`; app loads without Firebase user |
| Profile setup after first Google sign-in | Done | `initAuthObserver` → `login.html?setup=1` when no profile |
| Local-only mode without Firebase config | Done | `FIREBASE_CONFIGURED` in `js/firebase-config.js` |

---

## F-002 — Member-only: upload & delete laps

**Scope:** Only **Members** can **upload** laps to Firebase and **delete** their own laps in the cloud. Guests cannot upload; guests do not own cloud laps to delete.

| Piece | Status | Notes |
|-------|--------|--------|
| Upload CSV to Storage + Firestore when signed in | Done | `loadFiles` → `_uploadToCloud` in `js/app.js` |
| Hide / show upload UI for guests vs members | Done | `initApp` toggles `#dropZoneSelector` / `#uploadSignInPrompt` |
| Delete own lap (cloud) | Done | `deleteLapFromCloud` in `js/database.js`; UI in `js/ui.js` |
| Delete for laps not owned by current user | N/A | Must not allow (enforce in UI + rules) |

---

## F-003 — Anyone: analyze & compare laps (non–Marcus)

**Scope:** **Guests and Members** can analyze and compare laps (select Lap A/B, charts, track view, zone tips that do not call the LLM, etc.) for any lap data the app can load into state. This does **not** include the **Marcus AI** report — see **F-004**.

| Piece | Status | Notes |
|-------|--------|--------|
| Compare two selected laps (charts / map / UI) | Done | `js/charts.js`, `js/zones.js`, `js/ui.js`, tabs in `index.html` |
| Load local CSV files for analysis | Done | `loadFiles` in `js/app.js` |
| Merge community laps from cloud | Done | `loadCloudLaps` → `loadAllCloudLaps` in `js/database.js` |
| Guest can read community Firestore/Storage | Done | `firestore.rules`: global `laps` read `true`; `storage.rules`: public read for `csvs/**`. |

---

## F-004 — Member-only: Marcus AI analyzer

**Scope:** **Marcus AI Race Coach** (LLM coaching report via Cloud Function) is available only to **signed-in** users. Rationale: require Firebase **ID token** on every call so the AI proxy is not open to anonymous abuse or **DDoS**-style load.

| Piece | Status | Notes |
|-------|--------|--------|
| Client sends `Authorization: Bearer <ID token>` | Done | `callClaude()` in `js/coach.js` |
| Cloud Function rejects unauthenticated requests | Done | `401` from `marcus` in `functions/index.js` |
| UI: sign-in notice / error links to login | Done | `syncCoachingBar()`, coaching panel in `index.html` / `js/app.js` |
| Login required: modal (not inline 404/401 page) | Done | `showMarcusLoginRequiredModal()`, `index.html` `#marcusLoginModal`, `js/coach.js`, `js/app.js` |

---

## Automated tests

Run from project root (after `npm install`):

| Command | What |
|---------|------|
| `npm test` | Node unit checks (`tests/unit/`) |
| `npm run test:e2e` | Playwright smoke (`tests/e2e/`) — run **`npx playwright install`** once on your machine; optional `BASE_URL=http://127.0.0.1:5000` for `firebase serve` |
| `npm run test:all` | Both |

Bump **`APP_VERSION`** in `js/constants.js` when shipping; e2e asserts the footer is not the loading placeholder.

---

## Changelog

| Date | Change |
|------|--------|
| 2025-03-24 | Lap selection fix: canonical `lapId` from Firestore doc id; string-safe id matching (**v1.4.1**). |
| 2025-03-24 | Cloud lap merge: `lapNumber` + `timeStr` for guests; `ensureLapData` copies them; charts label fallback; Playwright + unit tests; **v1.4.0**. |
| 2025-03-24 | F-004: Marcus auth failures and guests using Analyze open a modal (“must be logged in”) with Sign in / Register → `login.html`; 401/404 from AI endpoint treated as auth prompt. |
| 2025-03-24 | Added F-004: Marcus AI member-only (auth + abuse/DDoS mitigation). Clarified F-003 as non–Marcus analysis/compare. |
| 2025-03-24 | Initial list: F-001 Guest/Member + Google, F-002 upload/delete for members only, F-003 analyze/compare for all + verify guest access to community data. |
