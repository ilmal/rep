import { describe, expect, test } from 'bun:test';
import { agoText, estimateMaxHr, isStale, parseAt, parseIngest, summarize, zoneOf } from './heartrate';

const NOW = Date.parse('2026-11-19T12:00:00Z');

describe('parseAt', () => {
  test('Health Auto Export format, ISO, seconds and ms epochs', () => {
    expect(parseAt('2026-11-19 12:00:00 +0100')).toBe(Date.parse('2026-11-19T12:00:00+01:00'));
    expect(parseAt('2026-11-19 12:00:00 -0500')).toBe(Date.parse('2026-11-19T12:00:00-05:00'));
    expect(parseAt('2026-11-19T12:00:00Z')).toBe(NOW);
    expect(parseAt('2026-11-19T12:00:00.250+00:00')).toBe(NOW + 250);
    expect(parseAt('2026-11-19 12:00 +0000')).toBe(NOW);
    expect(parseAt(NOW / 1000)).toBe(NOW);
    expect(parseAt(NOW)).toBe(NOW);
  });
  test('junk is null', () => { for (const v of ['', 'yesterday', null, undefined, {}, NaN, '2026-13-45 99:99:99']) expect(parseAt(v)).toBeNull(); });
});

describe('parseIngest', () => {
  test('a bare reading defaults to now', () => {
    expect(parseIngest({ bpm: 72 }, NOW)).toEqual({ samples: [{ at: NOW, bpm: 72 }], rejected: 0 });
  });
  test('arrays, {samples}, explicit times and a source', () => {
    const r = parseIngest({ samples: [{ bpm: 60, at: NOW - 60000, source: 'AirPods Pro' }, { bpm: 130.44, at: NOW }] }, NOW);
    expect(r.samples).toEqual([{ at: NOW - 60000, bpm: 60, source: 'AirPods Pro' }, { at: NOW, bpm: 130.4 }]);
    expect(parseIngest([{ bpm: 70 }, { bpm: 71, at: NOW - 1000 }], NOW).samples.map((s) => s.bpm)).toEqual([71, 70]);
  });
  test('Health Auto Export payload: only heart_rate, Avg becomes bpm, Min/Max kept', () => {
    const r = parseIngest({ data: { metrics: [
      { name: 'step_count', units: 'count', data: [{ date: '2026-11-19 11:00:00 +0000', qty: 400 }] },
      { name: 'heart_rate', units: 'count/min', data: [
        { date: '2026-11-19 11:45:00 +0000', Min: 58, Avg: 64.2, Max: 71, source: 'Nils’s AirPods Pro' },
        { date: '2026-11-19 11:50:00 +0000', Min: 90, Avg: 110, Max: 140 },
      ] },
    ] } }, NOW);
    expect(r.samples).toEqual([
      { at: Date.parse('2026-11-19T11:45:00Z'), bpm: 64.2, min: 58, max: 71, source: 'Nils’s AirPods Pro' },
      { at: Date.parse('2026-11-19T11:50:00Z'), bpm: 110, min: 90, max: 140 },
    ]);
    expect(parseIngest({ data: { metrics: [{ name: 'Heart Rate', data: [{ date: '2026-11-19 11:00:00 +0000', qty: 80 }] }] } }, NOW).samples[0]!.bpm).toBe(80);
  });
  test('rejects out-of-range bpm, bad times, the future and the distant past; counts them', () => {
    const r = parseIngest([{ bpm: 24 }, { bpm: 251 }, { bpm: 'x' }, { bpm: 70, at: 'nope' }, { bpm: 70, at: NOW + 10 * 60000 }, { bpm: 70, at: NOW - 401 * 24 * 3600000 }, { bpm: 25 }, { bpm: 250, at: NOW - 1000 }], NOW);
    expect(r.samples.map((s) => s.bpm)).toEqual([250, 25]);
    expect(r.rejected).toBe(6);
    expect(parseIngest({ bpm: 70, at: NOW + 4 * 60000 }, NOW).samples).toHaveLength(1); // a little clock skew is fine
  });
  test('inconsistent min/max are dropped but the reading stays; duplicates collapse; garbage bodies give nothing', () => {
    expect(parseIngest({ bpm: 70, min: 90, max: 60 }, NOW).samples[0]).toEqual({ at: NOW, bpm: 70 });
    expect(parseIngest([{ bpm: 70, at: NOW }, { bpm: 75, at: NOW }], NOW).samples).toEqual([{ at: NOW, bpm: 75 }]);
    for (const b of [null, 5, 'x', [], {}, { data: {} }, { samples: 'x' }]) expect(parseIngest(b, NOW).samples).toEqual([]);
  });
  test('caps the number of samples per request', () => {
    const many = Array.from({ length: 5200 }, (_, i) => ({ bpm: 60 + (i % 50), at: NOW - i * 1000 }));
    const r = parseIngest(many, NOW);
    expect(r.samples.length).toBe(5000);
    expect(r.rejected).toBe(200);
  });
});

describe('maths', () => {
  test('summarize', () => {
    expect(summarize([])).toBeNull();
    expect(summarize([{ at: 1, bpm: 60 }, { at: 2, bpm: 100, min: 90, max: 120 }])).toEqual({ count: 2, avg: 80, min: 60, max: 120 });
  });
  test('zones follow 50/60/70/80/90 % of max', () => {
    expect(zoneOf(99, 200)).toBeNull();
    expect([100, 120, 140, 160, 180, 200].map((b) => zoneOf(b, 200))).toEqual([1, 2, 3, 4, 5, 5]);
    expect(zoneOf(150, 0)).toBeNull();
    expect(estimateMaxHr(30)).toBe(187);
  });
  test('agoText and staleness', () => {
    expect([0, 59_000, 60_000, 90 * 60_000, 3 * 24 * 3600_000].map((d) => agoText(NOW, NOW - d))).toEqual(['just now', 'just now', '1 min ago', '2 h ago', '3 d ago']);
    expect(isStale(NOW, NOW - 30 * 60_000, 15)).toBe(false);
    expect(isStale(NOW, NOW - 38 * 60_000, 15)).toBe(true);
    expect(isStale(NOW, NOW - 12 * 60_000, 1)).toBe(true); // floor of 10 minutes
    expect(isStale(NOW, null, 15)).toBe(true);
  });
});
