import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { markStreakCelebrated, useStreak } from '../store/x-streak';
import { celebrateCopy } from '../store/x-celebrate';
import type { Celebrate, StreakView } from '../../shared/streak';

const COLS = ['#FF5A1F', '#FFB08A', '#FFFFFF', '#E3EAFC', '#FF5A1F', '#DDF3E5'];
const CONF = Array.from({ length: 24 }, (_, i) => ({ x: (i * 37) % 100, col: COLS[i % COLS.length], d: 3 + (i % 5) * 0.6, dl: (i % 8) * 0.35 }));
const CSS = `
@keyframes fall{0%{transform:translateY(-40px) rotate(0)}100%{transform:translateY(1000px) rotate(540deg)}}
@keyframes pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1)}}
@keyframes glow{0%,100%{box-shadow:0 0 0 10px rgba(255,90,31,.14),0 0 0 22px rgba(255,90,31,.06)}50%{box-shadow:0 0 0 16px rgba(255,90,31,.2),0 0 0 32px rgba(255,90,31,.08)}}
.conf{position:absolute;top:-40px;width:10px;height:16px;border-radius:3px;animation:fall linear infinite;pointer-events:none}
.bigflame{width:150px;height:150px;border-radius:50px;background:#2A1A12;color:#FF5A1F;display:flex;align-items:center;justify-content:center;animation:pop .7s ease-out both,glow 2.4s ease-in-out infinite}
.rw{display:flex;align-items:center;gap:14px;background:#1F1F1F;border-radius:18px;padding:14px 16px;text-align:left;animation:pop .5s ease-out both}
a.cel-ghost{color:#fff !important}
@media (prefers-reduced-motion: reduce){.conf{display:none}.bigflame,.rw{animation:none}}
`;
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Shown once per secured week (and per repair / milestone): the gate is `celebrate.unseen`, snapshotted on first render
 *  because marking it seen (on mount) clears it from the live view. Nothing to celebrate (or already seen): back to /streak. */
export default function StreakCelebrate() {
  const live = useStreak();
  const [snap] = useState<{ c: Celebrate; v: StreakView } | null>(() => (live.celebrate?.unseen ? { c: live.celebrate, v: live } : null));
  useEffect(() => { if (snap) markStreakCelebrated(snap.c.weekStart); }, [snap]);
  if (!snap) return <Navigate to="/streak" replace />;
  return <Inner c={snap.c} v={snap.v} />;
}

function Inner({ c, v }: { c: Celebrate; v: StreakView }) {
  const copy = celebrateCopy(c, v);
  const [n, setN] = useState(() => (reduced() ? c.streak : copy.from));
  useEffect(() => {
    if (n === c.streak) return;
    const t = setTimeout(() => setN(c.streak), 900);
    return () => clearTimeout(t);
  }, [n, c.streak]);

  return (
    <div className="app" style={{ background: '#121212', color: '#fff' }}>
      <style>{CSS}</style>
      <div aria-hidden="true">
        {CONF.map((k, i) => <i key={i} className="conf" style={{ left: `${k.x}%`, background: k.col, animationDuration: `${k.d}s`, animationDelay: `${k.dl}s` }} />)}
      </div>
      <div className="scroll" style={{ padding: '56px 22px 150px', alignItems: 'center', textAlign: 'center', gap: 14 }}>
        <div className="bigflame"><span className="ic ic-flame-fill" style={{ width: 84, height: 84 }} aria-hidden="true" /></div>
        <span className="t-num" style={{ fontSize: 96, lineHeight: 1, marginTop: 10 }} aria-live="polite" data-testid="streak-count">{n}</span>
        <h1 className="t-title" style={{ fontSize: 30 }}>{copy.headline}</h1>
        <p style={{ margin: 0, color: '#BDBDBD', fontSize: 16 }}>{copy.body}</p>
        <div className="stack" style={{ width: '100%', gap: 10, marginTop: 14 }}>
          {(() => { let d = 0.3; const delay = () => `${(d += 0.2).toFixed(1)}s`; return (<>
            {copy.badge && (
              <div className="rw" style={{ animationDelay: delay() }}><span className="tile" style={{ background: '#FF5A1F', color: '#121212' }}><span className="ic ic-medal" aria-hidden="true" /></span><div className="grow stack-s" style={{ gap: 2 }}><span className="strong">{copy.badge.title}</span><span className="small" style={{ color: '#BDBDBD' }}>{copy.badge.sub}</span></div></div>
            )}
            {copy.freeze && (
              <div className="rw" style={{ animationDelay: delay() }}><span className="tile" style={{ background: '#E3EAFC', color: '#1D44A8' }}><span className="ic ic-snow" aria-hidden="true" /></span><div className="grow stack-s" style={{ gap: 2 }}><span className="strong">{copy.freeze.title}</span><span className="small" style={{ color: '#BDBDBD' }}>{copy.freeze.sub}</span></div></div>
            )}
            {copy.tier && (
              <div className="rw" style={{ animationDelay: delay() }}><span className="tile" style={{ background: '#FF5A1F', color: '#121212' }}><span className="ic ic-flame" aria-hidden="true" /></span><div className="grow stack-s" style={{ gap: 2 }}><span className="strong">{copy.tier.title}</span><span className="small" style={{ color: '#BDBDBD' }}>{copy.tier.sub}</span></div></div>
            )}
            {copy.next && (
              <div className="rw" style={{ animationDelay: delay() }}><span className="tile" style={{ background: '#3A2418', color: '#FFB08A' }}><span className="ic ic-trophy" aria-hidden="true" /></span><div className="grow stack-s" style={{ gap: 6 }}><span className="strong">{copy.next.title}</span><div className="track on-dark thin"><div className="fillbar accent" style={{ width: `${copy.next.pct}%` }} /></div><span className="small" style={{ color: '#BDBDBD' }}>{copy.next.sub}</span></div></div>
            )}
          </>); })()}
        </div>
      </div>
      <div className="bottombar" style={{ background: 'rgba(18,18,18,.94)' }}>
        <Link className="btn btn-accent" to="/" replace>Keep it going</Link>
        <Link className="btn btn-ghost cel-ghost" to="/streak" replace style={{ minHeight: 40 }}>See your streak</Link>
      </div>
    </div>
  );
}
