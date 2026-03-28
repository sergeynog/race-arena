#!/usr/bin/env node
// ============================================================
// scripts/generate-config.js
// Race Arena — config generator
//
// Reads .env → writes js/firebase-config.js
// Run once after cloning: npm run setup
// ============================================================

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const ENV_FILE  = path.join(ROOT, '.env');
const OUT_FILE  = path.join(ROOT, 'js', 'firebase-config.js');

// ── Parse .env ──────────────────────────────────────────────
if (!fs.existsSync(ENV_FILE)) {
  console.error('\n  ✖  .env file not found.');
  console.error('  Copy .env.example → .env and fill in your Firebase values.\n');
  process.exit(1);
}

const env = {};
fs.readFileSync(ENV_FILE, 'utf8')
  .split('\n')
  .forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  });

const required = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

const missing = required.filter(k => !env[k]);
if (missing.length) {
  console.error(`\n  ✖  Missing values in .env: ${missing.join(', ')}\n`);
  process.exit(1);
}

// ── Write js/firebase-config.js ─────────────────────────────
const output = `// ============================================================
// js/firebase-config.js  —  AUTO-GENERATED, do not edit
// Run:  npm run setup   to regenerate from .env
// This file is gitignored and lives only on your machine.
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "${env.FIREBASE_API_KEY}",
  authDomain:        "${env.FIREBASE_AUTH_DOMAIN}",
  projectId:         "${env.FIREBASE_PROJECT_ID}",
  storageBucket:     "${env.FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${env.FIREBASE_MESSAGING_SENDER_ID}",
  appId:             "${env.FIREBASE_APP_ID}",${env.FIREBASE_MEASUREMENT_ID ? `\n  measurementId:     "${env.FIREBASE_MEASUREMENT_ID}",` : ''}
};

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
  console.warn('[Race Arena] Firebase not configured — run: npm run setup');
}
`;

fs.writeFileSync(OUT_FILE, output, 'utf8');
console.log(`\n  ✔  js/firebase-config.js generated from .env\n`);
