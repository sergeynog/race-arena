// ============================================================
// RACE ARENA — Cloud Functions
// functions/index.js
//
// Proxies Anthropic API calls server-side so the API key
// is never exposed to the browser.
//
// DEPLOY:
//   1. Store your Anthropic key as a secret (one-time):
//        firebase functions:secrets:set ANTHROPIC_KEY
//        (paste your sk-ant-... key when prompted)
//   2. Deploy:
//        firebase deploy --only functions
// ============================================================

const { onRequest }   = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin            = require('firebase-admin');

admin.initializeApp();

const ANTHROPIC_KEY = defineSecret('ANTHROPIC_KEY');

const ALLOWED_ORIGINS = [
  'https://race-arena-d1bc8.web.app',
  'https://race-arena-d1bc8.firebaseapp.com',
];

// ── callMarcus ───────────────────────────────────────────────
// HTTP function (onRequest).  Verifies Firebase ID token from
// the Authorization header, then proxies to Anthropic.

// ── Helper: verify auth and parse body ──────────────────────
async function authenticateRequest(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return null; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return null; }

  const authHeader = req.headers.authorization || '';
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: 'Sign in to use Marcus AI Race Coach.' });
    return null;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded;
  } catch {
    res.status(401).json({ error: 'Invalid or expired auth token.' });
    return null;
  }
}

async function callAnthropic(system, user, { maxTokens = 1500, model = 'claude-sonnet-4-20250514' } = {}) {
  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY.value(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  return apiRes;
}

const FUNC_OPTS = {
  secrets:        [ANTHROPIC_KEY],
  region:         'us-central1',
  timeoutSeconds: 120,
  memory:         '256MiB',
};

// ── callMarcus — coaching analysis ──────────────────────────
exports.marcus = onRequest(FUNC_OPTS, async (req, res) => {
  const t0 = Date.now();
  const decoded = await authenticateRequest(req, res);
  if (!decoded) return;

  const { system, user } = req.body || {};
  if (!system || !user) {
    res.status(400).json({ error: 'Missing system or user prompt.' });
    return;
  }
  console.log(`[marcus] uid=${decoded.uid} system=${system.length} user=${user.length}`);

  let apiRes;
  try {
    apiRes = await callAnthropic(system, user, { maxTokens: 1500 });
  } catch (err) {
    console.error('[marcus] Network error:', err);
    res.status(503).json({ error: 'Could not reach Anthropic API.' });
    return;
  }

  console.log(`[marcus] Anthropic ${apiRes.status} (+${Date.now() - t0}ms)`);
  if (!apiRes.ok) {
    let msg = `Anthropic API error ${apiRes.status}`;
    try { msg = (await apiRes.json()).error?.message || msg; } catch {}
    console.error('[marcus]', msg);
    res.status(500).json({ error: msg });
    return;
  }

  const data = await apiRes.json();
  const text = data.content?.[0]?.text || '';
  console.log(`[marcus] Done, ${text.length} chars (+${Date.now() - t0}ms)`);
  res.json({ content: text });
});

// ── marcusTips — synthesize racing tips ─────────────────────
exports.marcusTips = onRequest(FUNC_OPTS, async (req, res) => {
  const t0 = Date.now();
  const decoded = await authenticateRequest(req, res);
  if (!decoded) return;

  const { system, user } = req.body || {};
  if (!system || !user) {
    res.status(400).json({ error: 'Missing system or user prompt.' });
    return;
  }
  console.log(`[tips] uid=${decoded.uid} prompt=${user.length}`);

  let apiRes;
  try {
    apiRes = await callAnthropic(system, user, { maxTokens: 1200 });
  } catch (err) {
    console.error('[tips] Network error:', err);
    res.status(503).json({ error: 'Could not reach Anthropic API.' });
    return;
  }

  console.log(`[tips] Anthropic ${apiRes.status} (+${Date.now() - t0}ms)`);
  if (!apiRes.ok) {
    let msg = `Anthropic API error ${apiRes.status}`;
    try { msg = (await apiRes.json()).error?.message || msg; } catch {}
    console.error('[tips]', msg);
    res.status(500).json({ error: msg });
    return;
  }

  const data = await apiRes.json();
  const text = data.content?.[0]?.text || '';

  // Persist to Firestore: users/{uid}/tips/current
  try {
    const uid = decoded.uid;
    const tipsRef = admin.firestore()
      .collection('users').doc(uid)
      .collection('tips').doc('current');
    const existing = await tipsRef.get();
    const count = (existing.exists ? existing.data().analysisCount || 0 : 0) + 1;
    await tipsRef.set({
      content: text,
      analysisCount: count,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[tips] Saved, count=${count}, ${text.length} chars (+${Date.now() - t0}ms)`);
    res.json({ content: text, analysisCount: count });
  } catch (err) {
    console.error('[tips] Firestore save failed:', err);
    res.json({ content: text, analysisCount: -1 });
  }
});
