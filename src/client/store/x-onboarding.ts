// Onboarding wizard state + session-start flow flags (screens group A). Survives Back and reloads via sessionStorage.
import { useSyncExternalStore } from 'react';
import type { GymTemplate } from '../../shared/catalog';
import { AREA_TEMPLATES, DEFAULT_ROTATION_NAMES } from '../../shared/exercises';

export interface OnboardGymDraft { name: string; template: GymTemplate; lat: number | null; lng: number | null }
export interface OnboardState {
  name: string;
  goal: number;
  targetMinutes: number;
  warmupMinutes: number;
  /** 'ask' = location prompt, 'found' = gym form */
  gymStage: 'ask' | 'found';
  locationNote: '' | 'unavailable';
  primary: OnboardGymDraft;
  extra: OnboardGymDraft[];
  /** area template names by slot; null = default for the chosen goal */
  areas: string[] | null;
}

const KEY = 'rep-onboarding-v1';
const initial = (): OnboardState => ({
  name: '', goal: 4, targetMinutes: 60, warmupMinutes: 10, gymStage: 'ask', locationNote: '',
  primary: { name: '', template: 'full', lat: null, lng: null }, extra: [], areas: null,
});

let st: OnboardState = initial();
try {
  const raw = sessionStorage.getItem(KEY);
  if (raw) st = { ...initial(), ...(JSON.parse(raw) as Partial<OnboardState>) };
} catch { /* ignore */ }
const listeners = new Set<() => void>();

export function patchOnboarding(p: Partial<OnboardState>) {
  st = { ...st, ...p };
  try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ }
  for (const l of listeners) l();
}
export function resetOnboarding() {
  st = initial();
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const l of listeners) l();
}
export const getOnboarding = () => st;
export function useOnboarding(): OnboardState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => st, () => st);
}

/** Area picks for a given weekly goal: keep user picks, trim or extend (defaults first, then the other templates). */
export function fitAreas(picks: string[] | null, goal: number): string[] {
  const base = [...(picks ?? DEFAULT_ROTATION_NAMES)].slice(0, goal);
  const order = [...DEFAULT_ROTATION_NAMES, ...AREA_TEMPLATES.map((t) => t.name).filter((n) => !DEFAULT_ROTATION_NAMES.includes(n))];
  let i = 0;
  while (base.length < goal) {
    const next = order.find((n) => !base.includes(n)) ?? order[i++ % order.length];
    base.push(next);
  }
  return base;
}

// ── session-start flow flags (module level so they survive PreSession remounts, e.g. after Library) ──
export const startFlow = { detected: false, confirmed: false };
export const resetStartFlow = () => { startFlow.detected = false; startFlow.confirmed = false; };
