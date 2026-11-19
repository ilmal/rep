// App-icon badge (Badging API). Best-effort: unsupported browsers and denied permissions are silent no-ops.
type BadgeNav = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Show `n` on the app icon; 0 (or less) clears it. */
export async function setAppBadge(n: number): Promise<void> {
  try {
    const nav = navigator as BadgeNav;
    if (n > 0) await nav.setAppBadge?.(Math.floor(n));
    else await nav.clearAppBadge?.();
  } catch { /* unsupported or not permitted */ }
}
