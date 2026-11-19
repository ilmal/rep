import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Open dialogs, innermost last: only the topmost one reacts to Escape / Tab (a lightbox over a sheet closes first). */
const stack: symbol[] = [];

/**
 * Modal behaviour for a sheet/lightbox: moves focus in on open, keeps Tab inside, closes on Escape, and returns focus to
 * whatever opened it. Attach the returned ref to the dialog element (role="dialog" aria-modal="true").
 */
export function useDialog<T extends HTMLElement>(onClose: () => void, opts: { initialFocus?: string } = {}) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Symbol('dialog');
    stack.push(id);
    const el = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const first = () => (opts.initialFocus ? el?.querySelector<HTMLElement>(opts.initialFocus) : null) ?? el?.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    first()?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const a = items[0], z = items[items.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === a || !el.contains(cur))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (cur === z || !el.contains(cur))) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
