import type { Settings } from './types';
import { DEFAULT_PLANNER } from './planner';

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  onboarded: false,
  weeklyGoal: 4,
  targetMinutes: 60,
  warmupTargetMinutes: 10,
  restSec: 90,
  unit: 'kg',
  sound: true,
  gps: true,
  fitToTime: true,
  suggestSwaps: true,
  aiAssist: false,
  rotation: [],
  planner: { ...DEFAULT_PLANNER },
  profileNotes: '',
  updatedAt: 0,
};

/** Merge stored settings over defaults (planner is merged key-by-key so new knobs get defaults). */
export function withDefaults(s: Partial<Settings> | null | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), planner: { ...DEFAULT_PLANNER, ...(s?.planner ?? {}) } };
}
