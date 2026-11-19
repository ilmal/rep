import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/core';
import '../styles/session.css';

/** Compact status strip for mid-session connectivity. Never blocks the workout. */
export default function OfflineBanner() {
  const online = useStore((s) => s.online);
  const queued = useStore((s) => Object.keys(s.outbox).length);
  const wasOffline = useRef(!online);
  const synced = useRef(0); // outbox size while offline = how many changes get synced on reconnect
  if (!online) synced.current = queued;
  const [back, setBack] = useState(false);

  useEffect(() => {
    if (!online) { wasOffline.current = true; setBack(false); return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setBack(true);
    const t = setTimeout(() => setBack(false), 4000);
    return () => clearTimeout(t);
  }, [online]);

  if (!online) {
    return (
      <div className="strip off" role="status">
        <span className="ic ic-wifi-off sm" aria-hidden="true" />
        <span className="grow">Offline. Every set is saved on this phone.</span>
        <span className="tag" style={{ background: '#262626', color: '#E6E6E6' }}>{queued} queued</span>
      </div>
    );
  }
  if (back) {
    return (
      <div className="strip on" role="status">
        <span className="ic ic-check sm" aria-hidden="true" />
        <span className="grow">{synced.current === 0 ? 'Back online. Nothing to sync.' : `Back online. ${synced.current} ${synced.current === 1 ? 'change' : 'changes'} synced.`}</span>
      </div>
    );
  }
  return null;
}
