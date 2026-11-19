import { useEffect, useState } from 'react';

/** Re-render on an interval (wall-clock timers: derive values from timestamps, never count ticks). */
export function useNow(ms = 1000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setT(Date.now());
    const i = setInterval(tick, ms);
    const vis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [ms]);
  return t;
}

export function useToast(): [string, (msg: string, ms?: number) => void] {
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2400); return () => clearTimeout(t); }, [msg]);
  return [msg, (m: string) => setMsg(m)];
}

export function useDebounced<T>(v: T, ms = 200): T {
  const [x, setX] = useState(v);
  useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return x;
}
