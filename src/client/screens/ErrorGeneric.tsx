import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { logEvent, mutate } from '../store/core';

/** Stable short id (XXXX-XXXX) derived from the error, so the same crash always reports the same id. */
export function errorId(error?: Error): string {
  const src = `${error?.name ?? ''}|${error?.message ?? ''}|${(error?.stack ?? '').split('\n').slice(0, 3).join('|')}`;
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < src.length; i++) { h1 = Math.imul(h1 ^ src.charCodeAt(i), 16777619); h2 = Math.imul(h2 + src.charCodeAt(i), 2246822519) ^ (h2 >>> 13); }
  const hex = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const a = hex(h1), b = hex(h2);
  return `${a.slice(0, 4)}-${b.slice(0, 4)}`;
}

export default function ErrorGeneric({ error, onRetry }: { error?: Error; onRetry?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);
  const id = useMemo(() => errorId(error), [error]);
  const retry = () => {
    if (!onRetry) { window.location.reload(); return; }
    setBusy(true);
    setTimeout(() => { setBusy(false); onRetry(); }, 1500);
  };
  const report = () => {
    // Logged as an app event (persisted + synced); nothing else leaves the device.
    try { mutate((s) => logEvent(s, 'error_reported', undefined, { errorId: id, message: (error?.message ?? '').slice(0, 200) })); } catch { /* store may be the thing that broke */ }
    setReported(true);
  };
  return (
    <div className="app">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px' }}>
        <div className="empty" style={{ padding: 0 }}>
          <div className="empty-ic red"><span className="ic ic-alert xxl" aria-hidden="true" /></div>
          <h1 className="t-title">Something went wrong</h1>
          <p className="sub" style={{ fontSize: 16, lineHeight: 1.5 }}>This screen couldn't load. Your workouts are safe: everything is saved on this phone.</p>
          <span className="tag outline">Error ID {id}</span>
        </div>
      </div>
      <div style={{ padding: '0 20px 36px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {reported && <div className="banner ok" role="status"><span className="ic ic-check" aria-hidden="true" /><div>Report sent with the error ID. Thanks, this helps fix it.</div></div>}
        <button type="button" className="btn btn-primary" onClick={retry} disabled={busy}><span className={`ic ic-refresh ${busy ? 'spinning' : ''}`} aria-hidden="true" />{busy ? 'Trying again…' : 'Try again'}</button>
        <Link className="btn btn-secondary" to="/" onClick={() => onRetry?.()}>Go to Today</Link>
        <button type="button" className="btn btn-ghost" onClick={report} disabled={reported}>{reported ? 'Reported' : 'Report this problem'}</button>
      </div>
    </div>
  );
}
