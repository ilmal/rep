// Heart-rate data for the UI. Readings live on the server (posted by the iPhone automation), not in the offline store: they are
// high-volume and read-only here. Everything degrades to "no reading" when offline, signed out, or nothing is connected.
import { useCallback, useEffect, useState } from 'react';
import { getState, useStore } from './core';
import { api } from './sync';
import type { HrSample } from '../../shared/heartrate';

export interface HrKeyStatus { hasKey: boolean; prefix: string | null; createdAt: number | null; lastUsedAt: number | null; lastSampleAt: number | null; count: number }

const canFetch = () => !!getState().device.token && navigator.onLine;

export async function fetchHrRange(from: number, to: number): Promise<HrSample[] | null> {
  if (!canFetch()) return null;
  try {
    const r = await api<{ samples?: HrSample[] }>(`/hr?from=${Math.floor(from)}&to=${Math.floor(to)}&limit=5000`);
    return r.ok ? (r.data.samples ?? []) : null;
  } catch { return null; }
}
export async function fetchHrKeyStatus(): Promise<HrKeyStatus | null> {
  if (!canFetch()) return null;
  try { const r = await api<HrKeyStatus>('/hr/key'); return r.ok ? r.data : null; } catch { return null; }
}
export async function createHrKey(): Promise<string | null> {
  try { const r = await api<{ key?: string }>('/hr/key', { method: 'POST', body: {} }); return r.ok ? r.data.key ?? null : null; } catch { return null; }
}
export async function revokeHrKey(): Promise<boolean> {
  try { return (await api('/hr/key', { method: 'DELETE' })).ok; } catch { return false; }
}

/** Latest reading, polled while `active` (and the tab is visible). The last good value is kept when a poll fails. */
export function useLatestHr(active: boolean, everyMs = 15_000): { latest: HrSample | null; loaded: boolean } {
  const online = useStore((s) => s.online);
  const token = useStore((s) => s.device.token);
  const [latest, setLatest] = useState<HrSample | null>(null);
  const [loaded, setLoaded] = useState(false);
  const poll = useCallback(async () => {
    if (!canFetch() || document.visibilityState === 'hidden') return;
    try { const r = await api<{ latest: HrSample | null }>('/hr/latest'); if (r.ok) { setLatest(r.data.latest); setLoaded(true); } } catch { /* keep the last value */ }
  }, []);
  useEffect(() => {
    if (!active || !token) return;
    void poll();
    const t = setInterval(() => { void poll(); }, everyMs);
    const vis = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [active, token, online, everyMs, poll]);
  return { latest, loaded };
}

/** Readings between two times (null while loading or unavailable). */
export function useHrRange(from: number | null, to: number | null): HrSample[] | null {
  const token = useStore((s) => s.device.token);
  const online = useStore((s) => s.online);
  const [samples, setSamples] = useState<HrSample[] | null>(null);
  useEffect(() => {
    if (from === null || to === null || !token) { setSamples(null); return; }
    let alive = true;
    void fetchHrRange(from, to).then((r) => { if (alive) setSamples(r); });
    return () => { alive = false; };
  }, [from, to, token, online]);
  return samples;
}
