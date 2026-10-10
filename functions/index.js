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
const Anthropic        = require('@anthropic-ai/sdk').default;

admin.initializeApp();

const ANTHROPIC_KEY = defineSecret('ANTHROPIC_KEY');

const ALLOWED_ORIGINS = [
  'https://racearena.xyz',
  'https://www.racearena.xyz',
  'https://race-arena-d1bc8.web.app',
  'https://race-arena-d1bc8.firebaseapp.com',
];

// Claude model for coaching + tips. Opus-tier reasoning over the corner
// numbers is worth it here; effort is set per endpoint below.
const CLAUDE_MODEL = 'claude-opus-5-5';

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

// Returns the reply text. Throws Anthropic.APIError on API failures and a
// plain Error when the model declines (stop_reason "refusal").
async function callClaude(system, user, { effort = 'medium' } = {}) {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
  const msg = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    output_config: { effort },
    // Re-run on Anthropic's recommended model if a safety classifier declines
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (msg.stop_reason === 'refusal') {
    throw new Error('Marcus could not answer this request. Please try again.');
  }
  // Thinking blocks come first; join only the text blocks
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// Maps an SDK error to an HTTP status + message for the browser.
function claudeErrorResponse(err) {
  if (err instanceof Anthropic.APIError) {
    const msg = err.error?.error?.message || err.message;
    return { status: err.status === 429 ? 429 : 502, error: `Anthropic API: ${msg}` };
  }
  return { status: 502, error: err.message || 'Could not reach Anthropic API.' };
}

const FUNC_OPTS = {
  secrets:        [ANTHROPIC_KEY],
  region:         'us-central1',
  timeoutSeconds: 300,   // Opus with thinking can take a minute or two
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

  let text;
  try {
    text = await callClaude(system, user, { effort: 'medium' });
  } catch (err) {
    const { status, error } = claudeErrorResponse(err);
    console.error('[marcus]', error);
    res.status(status).json({ error });
    return;
  }
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

  let text;
  try {
    text = await callClaude(system, user, { effort: 'low' });
  } catch (err) {
    const { status, error } = claudeErrorResponse(err);
    console.error('[tips]', error);
    res.status(status).json({ error });
    return;
  }
  console.log(`[tips] Claude done (+${Date.now() - t0}ms)`);

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
