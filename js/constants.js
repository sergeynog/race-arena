// ============================================================
// CONSTANTS
// Race Coach AI — constants.js
// ============================================================

// Bump this string on every deploy you want to verify (shown in footer).
const APP_VERSION = '1.8.4';

// Lap A is always white (reference/target line)
// Lap B is always cyan (comparison line)
const LAP_A_COLOR = '#ffffff';
const LAP_B_COLOR = '#00c4ff';

// Club Motorsports (Tamworth, NH) — official corner numbering.
// Corners 11–15 are high-speed sweepers taken flat-out; no measurable
// braking or speed delta at 20 Hz GPS → explicitly excluded from analysis.
// Detected corners map 1-to-1 to the first N entries below; skipped
// corners simply don't appear in the coaching output.
const CLUB_MOTORSPORTS_CORNERS = ['1','2a','2b','3','4','5','6','7','8','9a','9b','10'];
const CLUB_MOTORSPORTS_SKIPPED = ['11','12','13','14','15'];
