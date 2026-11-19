/** Mounted once in App (inside the router). Owns: first-visit install redirect, storage persistence, wake lock during a live
 *  session, app-icon badge (sessions left this week), and the "New version ready · Reload" toast. */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/core';
import { useActiveSession, useWeek } from '../store/actions';
import { requestPersistence, setSheetFlag, sheetFlag, useInstallState } from './install';
import { reloadForUpdate, subscribeUpdate, updateWaiting } from './sw-register';
import { startPushBackground, syncBadge } from '../push';

type WakeSentinel = { released: boolean; release(): Promise<void>; addEventListener(t: 'release', f: () => void): void };
type WakeLockApi = { request(type: 'screen'): Promise<WakeSentinel> };

/** Keep the screen awake while `on`. Re-acquires when the page becomes visible again (the OS drops the lock when hidden). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    if (!on || !api) return; // unsupported: graceful no-op (timers are timestamp-based, nothing breaks)
    let sentinel: WakeSentinel | null = null;
    let dead = false;
    const acquire = async () => {
      if (dead || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try { const s = await api.request('screen'); if (dead) { void s.release().catch(() => {}); return; } sentinel = s; } catch { /* denied / low battery: try again on next visibility change */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    void acquire();
    return () => { dead = true; document.removeEventListener('visibilitychange', onVis); void sentinel?.release().catch(() => {}); sentinel = null; };
  }, [on]);
}

export default function PwaHost() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.settings.onboarded);
  const active = useActiveSession();
  const { count, goal } = useWeek();
  const inst = useInstallState();
  const waiting = useSyncExternalStore(subscribeUpdate, updateWaiting);

  // First visit on a phone, in the browser (not installed): offer the install sheet once, before onboarding.
  const redirected = useRef(false);
  useEffect(() => {
    if (!hydrated || redirected.current || onboarded || inst.standalone || inst.platform === 'desktop') return;
    if (pathname !== '/welcome') return; // the App Guard sends a profile-less visit to /welcome first; act after it settles (avoids a redirect race)
    redirected.current = true;
    if (sheetFlag()) return;
    setSheetFlag('shown');
    navigate('/install', { replace: true });
  }, [hydrated, onboarded, inst.standalone, inst.platform, pathname, navigate]);

  // Ask the browser to keep our data once the app is installed or the user has set up (first run).
  // server-side rest alerts + session heartbeat + badge (no-op until the user enables notifications)
  useEffect(() => startPushBackground(), []);
  useEffect(() => { if (hydrated && (inst.standalone || inst.installed || onboarded)) void requestPersistence(); }, [hydrated, inst.standalone, inst.installed, onboarded]);

  useWakeLock(!!active);
  // icon badge = sessions left this week (honours the Icon badge pref); cleared once the week is secured
  useEffect(() => { syncBadge(); }, [hydrated, onboarded, count, goal]);

  // Never reload under someone mid-workout: the toast appears only when no session is active.
  if (!waiting || active) return null;
  return (
    <div className="toast" role="status" aria-live="polite" style={{ bottom: 110 }}>
      <span className="ic ic-download" aria-hidden="true" />
      <span className="grow">New version ready</span>
      <button className="btn btn-soft" style={{ minHeight: 44, padding: '0 14px', width: 'auto' }} onClick={() => { void reloadForUpdate(); }}>Reload</button>
    </div>
  );
}
