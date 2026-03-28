// ============================================================
// FIREBASE CONFIG — example / template
// Race Arena
//
// Copy this file to js/firebase-config.js and fill in your
// own Firebase project values. That file is gitignored and
// will never be committed.
//
// SETUP:
// 1. Go to https://console.firebase.google.com/
// 2. Create a project → Add a Web App
// 3. Copy the firebaseConfig values below
// 4. Enable: Authentication (Google), Firestore, Storage
// 5. Deploy rules:  firebase deploy --only firestore:rules,storage
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID"   // optional
};


// Detect placeholder config → run in local-only mode (no cloud features)
const FIREBASE_CONFIGURED = !FIREBASE_CONFIG.apiKey.startsWith('YOUR_');

let db        = null;
let auth      = null;
let fbStorage = null;

if (FIREBASE_CONFIGURED) {
  firebase.initializeApp(FIREBASE_CONFIG);
  db        = firebase.firestore();
  auth      = firebase.auth();
  fbStorage = firebase.storage();
  console.log('[Race Arena] Firebase initialized');
} else {
  console.warn('[Race Arena] Firebase not configured — running in local-only mode. ' +
               'Copy js/firebase-config.example.js → js/firebase-config.js and fill in your values.');
}
