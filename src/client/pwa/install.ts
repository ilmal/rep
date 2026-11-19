// Install detection + `beforeinstallprompt` capture. Imported by main.tsx so the listener exists before React mounts
// (Chrome fires the event once, early). Other screens import `installState()` / `useInstallState()`.
import { useSyncExternalStore } from 'react';

export type Platform = 'ios' | 'android' | 'desktop';
export type IosBrowser = 'safari' | 'chrome' | 'firefox' | 'other';
export interface InstallState {
  /** running as an installed app (display-mode: standalone or iOS navigator.standalone) */
  standalone: boolean;
  /** an Android/Chrome install prompt was captured and can be shown with `promptInstall()` */
  canPromptInstall: boolean;
  platform: Platform;
  /** which iOS browser (for the share-icon variant of the guide); 'safari' on non-iOS is meaningless */
  iosBrowser: IosBrowser;
  /** the OS reported the app as installed during this page life */
  installed: boolean;
}
interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: BIPEvent | null = null;
let installed = false;
let snap: InstallState | null = null;
const subs = new Set<() => void>();

export function detectPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && touchPoints > 1) return 'ios'; // iPadOS reports a Mac UA
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}
export function detectIosBrowser(ua = navigator.userAgent): IosBrowser {
  if (/CriOS/i.test(ua)) return 'chrome';
  if (/FxiOS/i.test(ua)) return 'firefox';
  if (/EdgiOS|OPiOS|GSA\//i.test(ua)) return 'other';
  return 'safari';
}
export function isStandalone(): boolean {
  try {
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch { return false; }
}
function compute(): InstallState {
  return { standalone: isStandalone(), canPromptInstall: !!deferred, platform: detectPlatform(), iosBrowser: detectIosBrowser(), installed };
}
function refresh() {
  const n = compute();
  if (!snap || (Object.keys(n) as (keyof InstallState)[]).some((k) => n[k] !== snap![k])) { snap = n; subs.forEach((f) => f()); }
}

/** Current install state (cheap; safe to call anywhere, including outside React). */
export function installState(): InstallState { refresh(); return snap!; }
export function useInstallState(): InstallState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => { refresh(); return snap!; });
}

/** Show the native Android install dialog. Resolves with the user's choice, or 'unavailable' when nothing was captured. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null; // a captured prompt can be used once
  refresh();
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'accepted') { installed = true; }
    refresh();
    return outcome;
  } catch { refresh(); return 'dismissed'; }
}

let started = false;
export function startInstallWatch() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; refresh(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; refresh(); void requestPersistence(); });
  try { window.matchMedia('(display-mode: standalone)').addEventListener('change', refresh); } catch { /* old browsers */ }
  refresh();
}

let persisted: boolean | null = null;
/** Ask the browser not to evict our IndexedDB (iOS wipes uninstalled sites after ~7 days idle). Safe to call repeatedly. */
export async function requestPersistence(): Promise<boolean> {
  if (persisted) return true;
  try {
    if (!navigator.storage?.persist) return false;
    persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch { persisted = false; }
  return !!persisted;
}

// localStorage flag: 'shown' = auto-redirected once; 'dismissed' = chose "Continue in the browser".
const KEY = 'rep-install-sheet';
export const sheetFlag = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setSheetFlag = (v: 'shown' | 'dismissed') => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };
