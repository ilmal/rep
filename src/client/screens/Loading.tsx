import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/** Boot skeleton shown while the store hydrates. Static: no store access. */
export default function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 4000); return () => clearTimeout(t); }, []);
  return (
    <div className="app" aria-busy="true" aria-live="polite">
      <div className="scroll" style={{ paddingTop: 24 }}>
        <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading your data</span>
        <div className="between" style={{ padding: '0 2px 4px' }}>
          <div className="stack-s" style={{ gap: 8 }}><div className="skel" style={{ width: 150, height: 14 }} /><div className="skel" style={{ width: 120, height: 34 }} /></div>
          <div className="skel" style={{ width: 44, height: 44, borderRadius: 22 }} />
        </div>
        <div className="card">
          <div className="hstack" style={{ gap: 18 }}>
            <div className="skel" style={{ width: 124, height: 124, borderRadius: 62, flexShrink: 0 }} />
            <div className="stack-s grow" style={{ gap: 10 }}><div className="skel" style={{ width: '60%', height: 12 }} /><div className="skel" style={{ width: '80%', height: 22 }} /><div className="skel" style={{ width: '90%', height: 12 }} /></div>
          </div>
          <div className="skel" style={{ height: 44 }} />
        </div>
        <div className="skel" style={{ height: 290, borderRadius: 28 }} />
        <div className="skel" style={{ height: 70, borderRadius: 20 }} />
        {slow && (
          <div className="banner info" role="status" style={{ position: 'absolute', left: 18, right: 18, bottom: 100, boxShadow: '0 10px 30px rgba(0,0,0,.12)' }}>
            <span className="ic ic-clock" aria-hidden="true" />
            <div className="grow"><span className="b-t">Taking longer than usual</span>Slow connection. Your last synced data is ready to use.</div>
            <Link className="banner-act" to="/">Use it</Link>
          </div>
        )}
      </div>
      <nav className="tabbar" aria-hidden="true">
        {[['ic-home', 'Today'], ['ic-chart', 'Progress'], ['ic-list', 'Plan'], ['ic-building', 'Gyms']].map(([ic, l], i) => (
          <div key={l} className={`tab ${i === 0 ? 'on' : ''}`}><span className={`ic ${ic}`} aria-hidden="true" />{l}</div>
        ))}
      </nav>
    </div>
  );
}
