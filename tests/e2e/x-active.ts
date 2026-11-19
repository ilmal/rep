// Active (in-progress) session builder shared by session-plan / session-end / resume specs.
import { GYM_ID, makeAreas, makeSession, makeGym } from './fixtures';
import type { Session } from '../../src/shared/types';

export const IDS = ['deadlift', 'rdl', 'pullup', 'plank', 'ohp'];
const MIN = 60000;

/** 5 exercises: [0,1] done, [2] active with 1 of 3 sets, [3,4] todo. Started `startedMinAgo`, last set `lastSetMinAgo` ago. */
export function activeSession(o: { id?: string; seq?: number; slot?: number; startedMinAgo?: number; lastSetMinAgo?: number; noSets?: boolean; phase?: Session['phase']; over?: Partial<Session> } = {}): Session {
  const area = makeAreas()[o.slot ? o.slot - 1 : 0];
  const slot = o.slot ?? 1;
  const base = makeSession({ id: o.id ?? 'act-1', seq: o.seq ?? 1, slot, areaId: area.id, areaName: area.name, daysAgo: 0, exerciseIds: IDS, minutes: o.startedMinAgo ?? 45 });
  const now = Date.now();
  const start = now - (o.startedMinAgo ?? 45) * MIN;
  const last = now - (o.lastSetMinAgo ?? 20) * MIN;
  const exercises = base.exercises.map((e, i) => {
    const mk = (n: number) => Array.from({ length: n }, (_, k) => ({ weight: 40, reps: 8, doneAt: last - ((n - 1 - k) * 3 + (i < 2 ? (2 - i) * 6 : 0)) * MIN, restSec: 90 }));
    if (o.noSets) return { ...e, status: i === 0 ? ('active' as const) : ('todo' as const), sets: [], startedAt: undefined, endedAt: undefined, feedback: undefined, recommendation: undefined, estSec: 600 };
    if (i < 2) return { ...e, estSec: 600, sets: mk(3), startedAt: start + (12 + i * 8) * MIN, endedAt: last - (1 - i) * 8 * MIN };
    if (i === 2) return { ...e, status: 'active' as const, estSec: 600, sets: mk(1), startedAt: last - 3 * MIN, endedAt: undefined, feedback: undefined, recommendation: undefined };
    return { ...e, status: 'todo' as const, estSec: 600, sets: [], startedAt: undefined, endedAt: undefined, feedback: undefined, recommendation: undefined };
  });
  return {
    ...base, status: 'active', startedAt: start, warmupStartedAt: start, warmupEndedAt: start + 12 * MIN, endedAt: undefined, exercises,
    cursor: o.noSets ? 0 : 2, phase: o.phase ?? 'set', updatedAt: now, ...(o.over ?? {}),
  } as Session;
}
export { GYM_ID, makeGym };
