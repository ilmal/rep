// Service worker registration (workbox 'prompt' mode). Update flow lives here; PwaHost renders the toast.
import { registerSW } from 'virtual:pwa-register';
import { persistNow } from '../store/core';

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
const subs = new Set<() => void>();
export const updateWaiting = () => waiting;
export const subscribeUpdate = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Flush state then activate the waiting worker and reload. Callers must make sure no session is active. */
export async function reloadForUpdate() { await persistNow(); await applyUpdate?.(true); }

export function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() { waiting = true; subs.forEach((f) => f()); },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // look for a new version hourly and whenever the app comes back to the foreground
      const check = () => { if (navigator.onLine) void reg.update().catch(() => {}); };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
}
