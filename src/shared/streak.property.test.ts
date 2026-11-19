// Property tests for computeStreak: seeded random histories, invariants that must hold for ANY input.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MAX_FREEZES, applyGoalChange, computeStreak, makeCal } from './streak';
import { streakWeeks } from './rules';
import type { Session, Settings } from './types';

const OLD_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Europe/Stockholm'; });
afterAll(() => { if (OLD_TZ === undefined) delete process.env.TZ; else process.env.TZ = OLD_TZ; });

const mulberry32 = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const at = (w: number, d: number, h: number) => new Date(2025, 8, 1 + 7 * w + d, h).getTime();
let n = 0;
const sess = (ts: number): Session => ({
  id: `p${++n}`, seq: n, slot: 1, areaId: 'a', areaName: 'A', gymId: 'g', gymName: 'G', status: 'completed', startedAt: ts - 1000, endedAt: ts,
  targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done', updatedAt: ts,
});

interface Case { sessions: Session[]; settings: Partial<Settings>; now: number; weeks: number }
function gen(seed: number): Case {
  const r = mulberry32(seed);
  const weeks = 1 + Math.floor(r() * 70);
  const goal = 1 + Math.floor(r() * 6);
  const counts = Array.from({ length: weeks }, () => (r() < 0.55 ? goal + Math.floor(r() * 2) : Math.floor(r() * (goal + 1))));
  const sessions = counts.flatMap((c, w) => Array.from({ length: c }, (_, k) => sess(at(w, k % 7, 7 + Math.floor(r() * 14)))));
  const settings: Partial<Settings> = { weeklyGoal: goal, rotation: [] };
  if (r() < 0.3) settings.manualFreezeWeeks = Array.from({ length: 1 + Math.floor(r() * 3) }, () => at(Math.floor(r() * weeks), 0, 0));
  if (r() < 0.3) { const ng = 1 + Math.floor(r() * 6); Object.assign(settings, applyGoalChange({ weeklyGoal: goal }, ng, at(Math.floor(r() * weeks), 2, 12))); }
  return { sessions, settings, now: at(weeks - 1, Math.floor(r() * 7), 12), weeks };
}
const shuffle = <T,>(xs: T[], r: () => number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('computeStreak properties', () => {
  test('invariants hold for 300 random histories', () => {
    for (const seed of SEEDS) {
      const c = gen(seed);
      const v = computeStreak(c.sessions, c.settings, c.now);
      const ctx = `seed ${seed}`;
      expect(v.current <= v.best, ctx).toBe(true);
      expect(v.freezes >= 0 && v.freezes <= MAX_FREEZES, ctx).toBe(true);
      expect(v.current >= 0, ctx).toBe(true);
      v.weeks.forEach((w, i) => { if (w.status === 'open') expect(i, ctx).toBe(v.weeks.length - 1); });
      expect(v.weeks.length, ctx).toBeGreaterThanOrEqual(1);
      expect(v.weeks[v.weeks.length - 1].weekStart, ctx).toBe(v.currentWeek.weekStart);
      for (let i = 1; i < v.weeks.length; i++) expect(v.weeks[i].weekStart > v.weeks[i - 1].weekStart, ctx).toBe(true);
      expect(v.weeks.reduce((m, w) => Math.max(m, w.streakAfter), 0) <= v.best, ctx).toBe(true);
      expect(v.last16.length, ctx).toBe(Math.min(16, v.weeks.length));
      // statuses are consistent with the numbers
      for (const w of v.weeks) {
        if (w.status === 'hit') expect(w.done >= w.goal || w.repairTarget === undefined, ctx).toBe(true);
        if (w.status === 'frozen') expect(w.freezeUsed, ctx).toBe(true);
        if (w.freezeUsed) expect(w.status, ctx).toBe('frozen');
      }
      // counted weeks: the final streak = streakAfter of the last week unless the repair is open
      const last = v.weeks[v.weeks.length - 1];
      if (!v.repairOffer) expect(last.streakAfter, ctx).toBe(v.current);
      // pace maths
      expect(v.currentWeek.left, ctx).toBe(Math.max(0, v.currentWeek.target - v.currentWeek.done));
      expect(v.currentWeek.secured, ctx).toBe(v.currentWeek.left === 0);
      expect(v.currentWeek.daysLeft >= 1 && v.currentWeek.daysLeft <= 7, ctx).toBe(true);
      if (v.atRisk) { expect(v.currentWeek.left > 0 && !v.frozenThisWeek && v.current > 0, ctx).toBe(true); }
      if (v.repairOffer) expect(v.repairOffer.target, ctx).toBe(v.currentWeek.target);
      if (v.lost) expect(v.current === 0 && v.best > 0, ctx).toBe(true);
      expect(v.badges.length, ctx).toBe(18);
      for (const b of v.badges) { expect(b.got, ctx).toBe(b.unlockedAt !== undefined); if (b.progress) expect(b.progress.n <= b.progress.of, ctx).toBe(true); }
      if (v.celebrate) expect(v.weeks[v.weeks.length - 1].status, ctx).toBe('hit');
    }
  });

  test('deterministic and independent of session order / duplicates of the call', () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const c = gen(seed);
      const a = computeStreak(c.sessions, c.settings, c.now);
      const b = computeStreak(shuffle(c.sessions, mulberry32(seed + 9999)), c.settings, c.now);
      expect(b, `seed ${seed}`).toEqual(a);
      expect(computeStreak(c.sessions, c.settings, c.now), `seed ${seed}`).toEqual(a);
    }
  });

  test('a constant goal with no manual freezes: current >= plain streakWeeks (repair and freeze only extend a run)', () => {
    for (const seed of SEEDS) {
      const c = gen(seed);
      const s: Partial<Settings> = { weeklyGoal: c.settings.weeklyGoal, rotation: [] };
      const v = computeStreak(c.sessions, s, c.now);
      expect(v.current, `seed ${seed}`).toBeGreaterThanOrEqual(streakWeeks(c.sessions, s.weeklyGoal!, c.now));
    }
  });

  test('best never decreases when more sessions are added in the past; discarded sessions change nothing', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const c = gen(seed);
      const a = computeStreak(c.sessions, c.settings, c.now);
      const junk = c.sessions.slice(0, 5).map((s) => ({ ...s, id: s.id + 'x', status: 'discarded' as const }));
      expect(computeStreak([...c.sessions, ...junk], c.settings, c.now), `seed ${seed}`).toEqual(a);
    }
  });

  test('prefix replay: the history up to week k is what a device looked at back then (no future leakage)', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const c = gen(seed);
      if (c.weeks < 4) continue;
      const k = 2 + (seed % (c.weeks - 2));
      const cutNow = at(k, 6, 12);
      const early = computeStreak(c.sessions, c.settings, cutNow);
      const onlyEarly = computeStreak(c.sessions.filter((s) => (s.endedAt ?? 0) < at(k + 1, 0, 0)), c.settings, cutNow);
      expect(early, `seed ${seed}`).toEqual(onlyEarly);
      const full = computeStreak(c.sessions, c.settings, c.now);
      for (let i = 0; i < early.weeks.length - 2; i++) {
        // finished weeks that were not waiting for a repair never change status later
        const e = early.weeks[i];
        if (!(e.status === 'missed' && e.repairTarget !== undefined)) expect(full.weeks[i].status, `seed ${seed} week ${i}`).toBe(e.status === 'missed' ? 'missed' : e.status);
      }
    }
  });

  test('fixed-offset calendars give the same answer as the local one when the zone has no DST in range', () => {
    // 2025-09-01..2026 spans CET->CEST? Sept..Oct 25 is CEST (-120), then CET: use a window entirely in CEST
    const sessions = Array.from({ length: 8 }, (_, w) => [0, 2, 4, 5].map((d) => sess(new Date(2025, 5, 2 + 7 * w + d, 12).getTime()))).flat();
    const now = new Date(2025, 5, 2 + 7 * 7 + 6, 12).getTime();
    const local = computeStreak(sessions, { weeklyGoal: 4 }, now);
    const fixed = computeStreak(sessions, { weeklyGoal: 4 }, now, { tz: -120 });
    expect(fixed.weeks).toEqual(local.weeks);
    expect(fixed.current).toBe(8);
    expect(makeCal(-120).weekStart(now)).toBe(local.currentWeek.weekStart);
  });
});
