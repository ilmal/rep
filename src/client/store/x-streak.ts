// Streak store layer (screens: Streak, StreakRisk, StreakRepair, StreakCelebrate, Badges, Today). Everything shown is DERIVED by
// computeStreak() (src/shared/streak.ts: API documented at its top) from sessions + settings, so every device and the MCP agree.
// Only three things are persisted, all on the synced Settings entity: goalHistory (written by updateSettings when weeklyGoal
// changes), manualFreezeWeeks (freeze / undo) and streakLastCelebrated (celebrate once per week).
import { useMemo, useSyncExternalStore } from 'react';
import { getState, logEvent, mutate, putEntity, useStore, type State } from './core';
import { celebratedPatch, computeStreak, freezePatch, undoFreezePatch, type StreakView } from '../../shared/streak';

/** The StreakView for a state snapshot at `now` (default: the clock). Pure; call from actions or tests. */
export function selectStreak(state: State = getState(), now: number = Date.now()): StreakView {
  return computeStreak(Object.values(state.sessions), state.settings, now);
}

// minute clock so the pace / days-left copy rolls over at midnight without any store change
const minuteSnapshot = () => Math.floor(Date.now() / 60_000);
const subscribeMinute = (cb: () => void) => { const h = setInterval(cb, 30_000); return () => clearInterval(h); };

/** React hook: the live StreakView. Re-derived when sessions or settings change and every minute. */
export function useStreak(): StreakView {
  const sessions = useStore((s) => s.sessions);
  const settings = useStore((s) => s.settings);
  const minute = useSyncExternalStore(subscribeMinute, minuteSnapshot, minuteSnapshot);
  // computeStreak returns a fresh object, so it must live in useMemo (selectors passed to useStore must be stable)
  return useMemo(() => computeStreak(Object.values(sessions), settings, Date.now()), [sessions, settings, minute]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * "Use a freeze" (StreakRisk / StreakRepair). Covers the open week, or the missed week while a repair is open
 * (view.freezeTarget). Returns false (and writes nothing) when no freeze can be used. Refunded by replay if the goal is still hit.
 */
export function freezeThisWeek(now: number = Date.now()): boolean {
  const st = getState();
  const p = freezePatch(st.settings, selectStreak(st, now));
  if (!p) return false;
  mutate((s) => { putEntity(s, 'settings', 'settings', { ...s.settings, ...p }); logEvent(s, 'streak_freeze', undefined, { weeks: p.manualFreezeWeeks }); });
  return true;
}
/**
 * React hook for the design's "Use a freeze" button: returns the action, so calling it at render time spends nothing.
 * Call the RETURNED function (or freezeThisWeek()) from the click handler.
 */
export function useFreezeThisWeek(): () => boolean { return freezeThisWeek; }

/** Undo for a manual freeze (the toast on Today / Streak). Returns false when there is nothing to undo. */
export function undoFreezeThisWeek(now: number = Date.now()): boolean {
  const st = getState();
  const p = undoFreezePatch(st.settings, selectStreak(st, now));
  if (!p) return false;
  mutate((s) => { putEntity(s, 'settings', 'settings', { ...s.settings, ...p }); logEvent(s, 'streak_unfreeze'); });
  return true;
}

/**
 * StreakCelebrate was shown: never show it again for this week. `weekStart` defaults to the current week; pass the
 * celebrate.weekStart you displayed. No-op (no outbox entry) when already marked.
 */
export function markStreakCelebrated(weekStart?: number, now: number = Date.now()): void {
  const st = getState();
  const v = selectStreak(st, now);
  const patch = weekStart === undefined ? celebratedPatch(v) : { streakLastCelebrated: weekStart };
  if (st.settings.streakLastCelebrated === patch.streakLastCelebrated) return;
  mutate((s) => { putEntity(s, 'settings', 'settings', { ...s.settings, ...patch }); });
}
