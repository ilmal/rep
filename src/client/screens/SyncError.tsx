import { useEffect, useRef, useState } from 'react';
import { ago } from '../lib/format';

/** Human label for the raw error kept in device.lastSyncError ("sync 503" → "SYNC_503 · server unavailable"). */
export function describeSyncError(error: string): string {
  if (error === 'no_account') return 'NO_ACCOUNT · couldn’t reach the server to set up backup';
  const m = /^sync (\d{3})$/.exec(error);
  if (m) return `SYNC_${m[1]} · ${+m[1] >= 500 ? 'server unavailable' : +m[1] === 429 ? 'too many requests' : 'request rejected'}`;
  if (/failed to fetch|networkerror|load failed/i.test(error)) return 'NETWORK · can’t reach the server';
  return error;
}

/**
 * Calm sync-failure state (design: SyncError). Mounted by Settings; renders nothing until a sync fails, then the error banner with
 * Try again + Details. After a retry succeeds it shows the green "Synced" banner (and keeps Try again visible but disabled).
 */
export default function SyncError({ error, queued, lastSyncAt, syncing, onRetry }: {
  error?: string; queued: number; lastSyncAt?: number; syncing: boolean; onRetry: () => void;
}) {
  const [details, setDetails] = useState(false);
  const [attempts, setAttempts] = useState(1);
  const [recovered, setRecovered] = useState(false);
  const hadError = useRef(false);
  const retrying = useRef(false);

  useEffect(() => {
    if (error) { hadError.current = true; setRecovered(false); if (retrying.current && !syncing) { retrying.current = false; setAttempts((a) => a + 1); } }
    else if (hadError.current && !syncing) { hadError.current = false; retrying.current = false; setRecovered(true); setAttempts(1); setDetails(false); }
  }, [error, syncing]);

  if (!error && !recovered) return null;
  const retry = () => { retrying.current = true; setRecovered(false); onRetry(); };

  return (
    <div className="stack-s" style={{ gap: 10 }}>
      {error && (
        <div className="banner error" role="alert">
          <span className="ic ic-cloud" aria-hidden="true" />
          <div className="grow"><span className="b-t">{attempts > 1 ? 'Still can’t reach the server' : 'Couldn’t back up your latest changes'}</span>Everything is saved on this phone and nothing is lost. We’ll keep trying in the background.</div>
        </div>
      )}
      {!error && (
        <div className="banner ok" role="status"><span className="ic ic-check" aria-hidden="true" /><div className="grow"><span className="b-t">Synced</span>Your changes are backed up and on all your devices.</div></div>
      )}
      <div className="grid2">
        <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={retry} disabled={syncing || !error}>
          <span className={`ic ic-refresh sm ${syncing ? 'spinning' : ''}`} aria-hidden="true" />{syncing ? 'Retrying…' : error ? 'Try again' : 'Synced'}
        </button>
        <button className="btn btn-soft btn-sm" style={{ width: '100%' }} onClick={() => setDetails((d) => !d)} aria-expanded={details} disabled={!error}>{details ? 'Hide details' : 'Details'}</button>
      </div>
      {details && error && (
        <div className="card tight">
          <div className="kv"><span>Error</span><span>{describeSyncError(error)}</span></div>
          <div className="kv"><span>Queued</span><span>{queued} {queued === 1 ? 'change' : 'changes'}</span></div>
          <div className="kv"><span>Last synced</span><span>{lastSyncAt ? ago(lastSyncAt) : 'Never'}</span></div>
          <div className="kv"><span>Attempts</span><span>{attempts}</span></div>
          <div className="kv"><span>Next auto-retry</span><span>On next app open or within a minute</span></div>
        </div>
      )}
    </div>
  );
}
