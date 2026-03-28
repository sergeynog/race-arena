/**
 * Pure checks for cloud lap merge shape (mirrors mergeCloudLaps fields).
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert';

test('cloud lap skeleton must include lapNumber and timeStr for UI/charts', () => {
  const cl = {
    lapId: 'abc123_0',
    sessionHash: 'abc123',
    lapIdx: 0,
    lapTime: '1:44.231',
    timeSeconds: 104.231,
    date: '2025-01-01',
    sessionLabel: 'Track X',
    trackName: 'Track X',
    isOutLap: false,
    isInLap: false,
    username: 'driver1',
    displayName: 'Driver',
    csvPath: 'csvs/u1/abc123.csv',
  };

  const idx = typeof cl.lapIdx === 'number' ? cl.lapIdx : parseInt(cl.lapIdx, 10);
  const lapNum = Number.isFinite(idx) ? idx + 1 : 1;
  const timeStr = cl.lapTime != null ? String(cl.lapTime) : '';

  const lap = {
    id: cl.lapId,
    sessionId: cl.sessionHash,
    lapNumber: lapNum,
    timeStr,
    lapTime: cl.lapTime,
    timeSeconds: cl.timeSeconds,
  };

  assert.strictEqual(lap.lapNumber, 1);
  assert.strictEqual(lap.timeStr, '1:44.231');
  assert.ok(lap.id);
});
