/**
 * Parser + import check on synthetic AiM CSVs (imperial units, odd channel
 * names, a broken distance channel, a raw throttle sensor).
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../../js/parser.js', import.meta.url), 'utf8'), ctx);
const { checkImport } = ctx;

// 3 laps of a 1000 m loop at a steady 100 mph, 20 Hz
function makeCsv({ distScale = 1, beacons = true, rawThrottle = false } = {}) {
  const mps = 100 * 1.609344 / 3.6;
  const lapT = 1000 / mps;
  const total = lapT * 3;
  const head = [
    '"Format","AiM CSV File"', '"Session","Test"', '"Vehicle","Rush SR"', '"Sample Rate","20"',
    beacons ? `"Beacon Markers","${lapT.toFixed(3)}","${(2 * lapT).toFixed(3)}","${total.toFixed(3)}"` : '',
    beacons ? '"Segment Times","0:22.369","0:22.369","0:22.369"' : '',
    '',
    '"Time","GPS Speed","GPS LatAcc","GPS LonAcc","GPS Latitude","GPS Longitude","Front Brake p","Accelerator Peda","Throttle Plates","Thro Plate Corr","Distance on GPS Speed"',
    '"s","mph","g","g","deg","deg","psi","%","%","%","ft"',
    '',
  ];
  const rows = [];
  for (let t = 0; t <= total; t += 0.05) {
    const ft = mps * t / 0.3048 * distScale;
    rows.push([t.toFixed(3), '100', '0.5', '0', '43.82', '-71.24', '145.038', '80',
               rawThrottle ? '650' : '80', '80', ft.toFixed(2)].join(','));
  }
  return [...head, ...rows].join('\r\n');
}

test('converts imperial units and picks the right channels', () => {
  const { parsed, laps, issues } = checkImport(makeCsv());
  const errors = issues.filter(i => i.level === 'error');
  assert.strictEqual(errors.length, 0, JSON.stringify(errors));
  const r = parsed.rows[100];
  assert.ok(Math.abs(r.speed - 160.93) < 0.01, `speed km/h ${r.speed}`);
  assert.ok(Math.abs(r.brake - 10) < 0.01, `brake bar ${r.brake}`);   // 145.038 psi
  assert.strictEqual(r.accelPos, 80);
  assert.strictEqual(r.throttle, 80);                                  // corrected plate %, not raw
  const timed = laps.filter(l => !l.isOutLap && !l.isInLap);
  assert.ok(timed.length >= 1);
  assert.ok(Math.abs(timed[0].lapDist - 1000) < 5, `lap length ${timed[0].lapDist}`);
});

test('ignores a wrongly scaled distance channel and warns', () => {
  const { laps, issues } = checkImport(makeCsv({ distScale: 3.28 }));
  assert.ok(issues.some(i => i.code === 'distance_mismatch'));
  const timed = laps.filter(l => !l.isOutLap && !l.isInLap);
  assert.ok(Math.abs(timed[0].lapDist - 1000) < 5, `lap length ${timed[0].lapDist}`);
});

test('drops a "%" channel that is really a raw sensor value', () => {
  const csv = makeCsv({ rawThrottle: true }).replace('"Thro Plate Corr"', '"Something Else"');
  const { parsed, issues } = checkImport(csv);
  assert.ok(issues.some(i => i.code === 'percent_out_of_range'));
  assert.ok(!parsed.meta.channels.includes('throttle'));
});

test('blocks files without lap markers or a telemetry table', () => {
  assert.ok(checkImport(makeCsv({ beacons: false })).issues.some(i => i.code === 'no_laps'));
  assert.ok(checkImport('hello,world\n1,2').issues.some(i => i.code === 'no_data_header'));
});
