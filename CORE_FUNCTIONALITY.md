# Race Arena — core functionality

This document is the **product scope** for Race Arena: who it serves, what they can do, and how we ship changes. Detailed feature status and history live in [`features.md`](features.md).

## Purpose

Race Arena is a **race lap analysis** web app: load telemetry-style lap data (CSV), pick laps, visualize and compare them, and (for signed-in users) contribute laps to a shared backend so others can compare against them.

## User profiles

| Profile | Identity | Cloud lap library | Upload laps | Delete own cloud laps | Charts / compare laps | Marcus AI analyzer |
|--------|-----------|-------------------|-------------|------------------------|----------------------|-------------------|
| **Guest** | Not signed in | Depends on security rules + app behavior | No | N/A (nothing owned in cloud) | Yes (data the app can load) | No |
| **Member** | Google account + Firestore profile | Community index + own uploads | Yes | Yes | Yes | Yes |

**Member-only capabilities (beyond guest):**

1. **Cloud persistence** — **upload** sessions/laps and **delete** their own cloud laps.
2. **Marcus AI Race Coach** — the server-side LLM analysis (Anthropic via Cloud Function) requires a **signed-in Firebase user** with a valid **ID token** on each request. That limits anonymous abuse and protects the backend from unauthenticated load (e.g. accidental or malicious **DDoS**-style traffic to the AI proxy).

Guests can still use **charts, track map, lap comparison, and non–Marcus coaching UI** for laps they can load (e.g. local CSVs). See [`features.md`](features.md) for feature IDs.

## Authentication

- **Member** sign-in uses **Firebase Authentication** with the **Google** provider (`login.html`, `js/auth.js`).
- **Guest** uses the app without a Firebase user; upload UI is gated when there is no member profile.

## Data (high level)

- Firebase **Firestore** holds user profiles, per-user lap metadata, and a global `laps` index (see comments in `js/firebase-config.js`).
- Firebase **Storage** holds CSV blobs; access is governed by Storage rules.

## Development and release workflow

1. Implement or change **one feature** (or one bugfix) at a time.
2. **Test** locally (and against staging/production as appropriate).
3. **Deploy** with `firebase deploy` (CLI installed; project already selected on this machine).

After each meaningful feature add or change, update [`features.md`](features.md) so it stays the single source of truth for what’s planned, shipped, or under test.

## Related files

| Area | Location |
|------|----------|
| Firebase init & data model notes | `js/firebase-config.js` |
| Auth & profile | `js/auth.js`, `login.html` |
| App bootstrap, uploads, cloud lap load | `js/app.js` |
| Firestore/Storage operations | `js/database.js`, `js/storage.js` |
| UI & lap table (incl. delete) | `js/ui.js` |
| Marcus AI client (ID token → Cloud Function) | `js/coach.js`, `js/app.js` (coaching flow) |
| Marcus Cloud Function (auth gate) | `functions/index.js` (`marcus`) |
