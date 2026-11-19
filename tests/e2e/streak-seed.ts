// Shared seeds for the streak / badges specs. Clock is pinned to Saturday 14 Nov 2026 12:00 local (week starts Mon 9 Nov, 2 days left).
import { makeSession, makeAreas } from './fixtures';
import type { Session } from '../../src/shared/types';

export const NOW = new Date(2026, 10, 14, 12, 0).getTime();
const areas = makeAreas();
let n = 0;
/** One completed session ending at `endMs`. */
export function sessionAt(endMs: number): Session {
  const a = areas[n % 4];
  const s = makeSession({ id: `st-${++n}-${endMs}`, seq: n, slot: (n % 4) + 1, areaId: a.id, areaName: a.name, daysAgo: 0, exerciseIds: ['bench_press', 'seated_row'] });
  const d = endMs - s.endedAt!;
  return { ...s, startedAt: s.startedAt + d, warmupStartedAt: s.startedAt + d, warmupEndedAt: s.startedAt + d + 9 * 60000, endedAt: endMs, updatedAt: endMs,
    exercises: s.exercises.map((e) => ({ ...e, startedAt: e.startedAt! + d, endedAt: e.endedAt! + d, sets: e.sets.map((x) => ({ ...x, doneAt: x.doneAt + d })) })) };
}
/** `count` sessions in the week `ago` weeks before the pinned week (0 = the pinned week; sessions on Mon, Tue, Wed …). */
export const week = (ago: number, count: number): Session[] =>
  Array.from({ length: count }, (_, i) => sessionAt(new Date(2026, 10, 9 - 7 * ago + i, 18, 0).getTime()));
export const MON = new Date(2026, 10, 9).getTime();
