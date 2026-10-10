// ============================================================
// CONSTANTS
// Race Coach AI — constants.js
// ============================================================

// Bump this string on every deploy you want to verify (shown in footer).
const APP_VERSION = '1.12.1';

// Lap A is always near-black (reference/target line)
// Lap B is always blue (comparison line)
const LAP_A_COLOR = '#111111';
const LAP_B_COLOR = '#1d6fe0';

// Club Motorsports (Tamworth, NH) — all 15 official turns, using the
// numbering on the track map at clubmotorsports.com (turns 2 and 9 are
// split into A/B). Each point is the turn's apex, measured from GPS of a
// 1:45 lap; laps are matched to a turn by their nearest GPS point.
const CLUB_MOTORSPORTS_TRACK = {
  name: 'Club Motorsports',
  corners: [
    { id: '1',  lat: 43.822809, lon: -71.242055, dir: 'right' },
    { id: '2A', lat: 43.820933, lon: -71.240701, dir: 'right' },
    { id: '2B', lat: 43.819852, lon: -71.241056, dir: 'right' },
    { id: '3',  lat: 43.819086, lon: -71.241952, dir: 'left'  },
    { id: '4',  lat: 43.818174, lon: -71.240639, dir: 'right' },
    { id: '5',  lat: 43.817052, lon: -71.240360, dir: 'right' },
    { id: '6',  lat: 43.819202, lon: -71.244702, dir: 'right' },
    { id: '7',  lat: 43.820176, lon: -71.242715, dir: 'left'  },
    { id: '8',  lat: 43.821909, lon: -71.243492, dir: 'left'  },
    { id: '9A', lat: 43.821854, lon: -71.246456, dir: 'left'  },
    { id: '9B', lat: 43.821449, lon: -71.246845, dir: 'left'  },
    { id: '10', lat: 43.819116, lon: -71.248237, dir: 'right' },
    { id: '11', lat: 43.819028, lon: -71.249031, dir: 'right' },
    { id: '12', lat: 43.820580, lon: -71.247925, dir: 'left'  },
    { id: '13', lat: 43.821174, lon: -71.247994, dir: 'left'  },
    { id: '14', lat: 43.822095, lon: -71.249477, dir: 'right' },
    { id: '15', lat: 43.822943, lon: -71.250106, dir: 'right' },
  ],
};
const KNOWN_TRACKS = [CLUB_MOTORSPORTS_TRACK];
