import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStreak } from '../store/x-streak';
import type { BadgeCategory, BadgeView } from '../../shared/streak';
import { dateShort } from '../lib/format';

const CATS: BadgeCategory[] = ['Streaks', 'Consistency', 'Strength', 'Explorer'];
const pct = (b: BadgeView) => (b.got ? 100 : b.progress && b.progress.of > 0 ? Math.round((Math.min(b.progress.n, b.progress.of) / b.progress.of) * 100) : 0);
const prog = (b: BadgeView) => (b.progress ? `${b.progress.n} / ${b.progress.of} ${b.progress.unit}` : 'Locked');
const when = (b: BadgeView) => (b.unlockedAt ? dateShort(b.unlockedAt) : 'Unlocked');
const aria = (b: BadgeView) => b.name + (b.got ? `, unlocked ${when(b)}` : b.progress ? `, ${b.progress.n} of ${b.progress.of}` : ', locked');
const FOCUSABLE = 'button, a[href], [tabindex]:not([tabindex="-1"])';

function BadgeSheet({ b, onClose }: { b: BadgeView; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.btn')?.focus();
    return () => { opener?.focus?.(); };
  }, []);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const els = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <>
      <button type="button" className="scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="Badge" onKeyDown={key} style={{ alignItems: 'center', textAlign: 'center', gap: 12, paddingTop: 10 }}>
        <div className="grabber" />
        <span className={`medal big ${b.got ? 'got' : 'lock'}`}><span className={`ic ${b.icon} xxl`} aria-hidden="true" /></span>
        <h2 className="t-title">{b.name}</h2>
        <p className="sub">{b.how}</p>
        <span className={`tag ${b.got ? 'green' : 'accent'}`}>{b.got ? `Unlocked ${when(b)}` : prog(b)}</span>
        <button type="button" className="btn btn-primary" onClick={onClose} style={{ marginTop: 6 }}>Got it</button>
      </div>
    </>
  );
}

export default function Badges() {
  const v = useStreak();
  const [tab, setTab] = useState<'all' | 'got'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const total = v.badges.length;
  const nm = v.nextMilestone;
  const left = nm ? Math.max(0, nm.progress.of - nm.progress.n) : 0;
  const selected = v.badges.find((b) => b.id === sel) ?? null;
  const cats = CATS.map((c) => ({ name: c, items: v.badges.filter((b) => b.category === c && (tab === 'all' || b.got)) })).filter((c) => c.items.length);

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/streak" aria-label="Back to streak"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Badges</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <div className="card dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <span className="medal got" style={{ width: 64, height: 64, borderRadius: 32 }}><span className="ic ic-trophy xl" aria-hidden="true" /></span>
          <div className="stack-s grow" style={{ gap: 4 }}>
            <span className="t-num" data-testid="badge-count" style={{ fontSize: 32 }}>{v.badgesGot} / {total}</span>
            <span className="small" style={{ color: '#A8A8A8' }}>badges unlocked{nm ? ` · next: ${nm.name} (${left} ${left === 1 ? 'week' : 'weeks'})` : ''}</span>
          </div>
        </div>
        <div className="seg c2 on-bg" role="group" aria-label="Show">
          {([['all', 'All'], ['got', 'Unlocked']] as const).map(([k, label]) => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {cats.length === 0 && <p className="sub" style={{ textAlign: 'center' }}>No badges unlocked yet. Finish a session to earn your first.</p>}
        {cats.map((c) => (
          <div className="stack-s" style={{ gap: 8 }} key={c.name} role="group" aria-label={c.name}>
            <span className="section-h" style={{ margin: '8px 2px 0' }}>{c.name}</span>
            <div className="grid3">
              {c.items.map((b) => (
                <button type="button" key={b.id} className="bd" aria-label={aria(b)} data-got={b.got} onClick={() => setSel(b.id)}>
                  <span className={`medal ${b.got ? 'got' : 'lock'}`}><span className={`ic ${b.icon} lg`} aria-hidden="true" /></span>
                  <span className="bn">{b.name}</span>
                  {b.got ? <span className="bs">{when(b)}</span> : (<><span className="mini"><i style={{ width: `${pct(b)}%` }} /></span><span className="bs">{prog(b)}</span></>)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {selected && <BadgeSheet b={selected} onClose={() => setSel(null)} />}
    </div>
  );
}
