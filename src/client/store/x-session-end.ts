// Session-ending wrappers (EndEarly + Resume screens). Built on the shared endEarly() action, then patched via putEntity
// so we never touch actions.ts: `endReason` chips, and "finish at last logged set" (counted, ended at the last set's time).
import { getState, mutate, putEntity } from './core';
import { endEarly } from './actions';
import type { Session } from '../../shared/types';

export const END_REASONS = ['Out of time', 'Low energy', 'Pain / niggle', 'Gym too busy', 'Other'] as const;
export type EndReason = (typeof END_REASONS)[number];

type WithReason = Session & { endReason?: string[] };

const activeSession = () => Object.values(getState().sessions).find((s) => s.status === 'active');
export const lastSetAt = (s: Session): number => s.exercises.flatMap((e) => e.sets).reduce((m, x) => Math.max(m, x.doneAt), 0);

function patchSession(id: string, fn: (s: Session) => Session) {
  mutate((st) => { const cur = st.sessions[id]; if (cur) putEntity(st, 'session', id, fn(cur)); });
}

/** Save (counted, optionally keeping the rotation slot) or discard, storing optional reason chips on the session. */
export function endSession(mode: 'save' | 'discard', opts: { repeatNext?: boolean; reasons?: string[] } = {}): string | null {
  const id = endEarly(mode, { repeatNext: opts.repeatNext });
  if (id && opts.reasons?.length) patchSession(id, (s) => ({ ...(s as WithReason), endReason: [...opts.reasons!] }));
  return id;
}

/**
 * Resume screen: complete the interrupted session with the data so far. Counted, ended at the last logged set's time
 * (not "now"), so the duration does not include the time the app was closed. Returns null when nothing was logged.
 */
export function finishAtLastSet(): string | null {
  const a = activeSession();
  if (!a) return null;
  const last = lastSetAt(a);
  if (!last) return null;
  const hadWarmupEnd = a.warmupEndedAt != null;
  const unfinished = new Set(a.exercises.filter((e) => e.status === 'todo' || e.status === 'active').map((e) => e.id));
  const id = endEarly('save', { repeatNext: false });
  if (!id) return null;
  patchSession(id, (s) => ({
    ...s,
    endedAt: last,
    endedEarly: unfinished.size > 0,
    warmupEndedAt: hadWarmupEnd ? s.warmupEndedAt : last,
    exercises: s.exercises.map((e) => (unfinished.has(e.id) && e.status === 'done' ? { ...e, endedAt: e.sets.reduce((m, x) => Math.max(m, x.doneAt), 0) } : e)),
  }));
  return id;
}

/** Resume screen: throw the interrupted session away (not counted, rotation pointer unchanged). */
export const discardActive = (): string | null => endEarly('discard');
