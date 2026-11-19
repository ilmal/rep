// Streak surfaces of the Today screen (Main / StreakRisk / StreakRepair / WeekDone boards). Pure presentation: every number comes
// from the StreakView (src/shared/streak.ts), the actions from store/x-streak.ts.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { StreakView } from '../../../shared/streak';
import { MAX_FREEZES } from '../../../shared/streak';
import { freezeThisWeek, undoFreezeThisWeek } from '../../store/x-streak';
import { EXPRESS_MIN } from '../../store/x-today';

export const STREAK_STYLE = `.schip{display:inline-flex;align-items:center;gap:4px;height:40px;padding:0 12px;border-radius:20px;background:#fff;font-family:'Inter Tight',Inter,sans-serif;font-weight:800;font-size:17px;box-shadow:0 1px 2px rgba(18,18,18,.06),0 6px 16px rgba(18,18,18,.06);color:#121212}
.schip.ring{box-shadow:inset 0 0 0 2px #FF5A1F}
.risk{background:#FFE7DC;border-radius:28px;padding:20px;display:flex;flex-direction:column;gap:14px}
.days{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.day{min-height:72px;border-radius:16px;background:#fff !important;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:12px !important;font-weight:700 !important;color:#6B6B6B !important}
.day b{font-family:'Inter Tight',Inter,sans-serif;font-size:18px;color:#121212}
.day.on{background:#121212 !important;color:#fff !important}
.day.on b{color:#fff}
.day.today{box-shadow:inset 0 0 0 2px #FF5A1F}
.opt{display:flex;gap:12px;align-items:flex-start;padding:16px;border-radius:20px;background:#fff !important;text-align:left;width:100%;box-shadow:inset 0 0 0 1px #E6E4DF}
.opt.on{box-shadow:inset 0 0 0 2px #121212}
.segs > span.mk{height:12px;border-radius:6px;background:#E0DED8}
.segs > span.mk.on{background:#FF5A1F}
.segs > span.mk.make{background:repeating-linear-gradient(135deg,#FFE7DC 0 6px,#FFD2BD 6px 12px)}`;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const weeks = (n: number) => plural(n, 'week');

export type ChipMode = 'normal' | 'risk' | 'repair';

/** Header flame chip. Shown only for someone who has (had) a streak; `n` is the real streak length. */
export function StreakChip({ n, mode }: { n: number; mode: ChipMode }) {
  const label = mode === 'risk' ? `${n}-week streak, at risk` : mode === 'repair' ? `${n}-week streak, on the line` : `${n}-week streak`;
  return (
    <Link className={`schip${mode === 'normal' ? '' : ' ring'}`} to="/streak" aria-label={label}>
      <span className={`ic ${mode === 'repair' ? 'ic-flame' : 'ic-flame-fill'} sm`} style={{ color: '#FF5A1F' }} aria-hidden="true" />{n}
    </Link>
  );
}

/** Banner under the week strip: streak length, what finishing the week makes it, and a freeze only when that week would earn one. */
export function StreakBanner({ view }: { view: StreakView }) {
  const cw = view.currentWeek;
  const earns = view.weeksUntilFreeze === 1 && view.freezes < MAX_FREEZES;
  return (
    <Link to="/streak" className="hstack" style={{ gap: 10, background: '#FFF6F1', borderRadius: 16, padding: '12px 14px' }}>
      <span className="ic ic-flame-fill" style={{ color: '#FF5A1F' }} aria-hidden="true" />
      <span className="grow small"><b>{view.current}-week streak.</b> {cw.left} more {cw.left === 1 ? 'session' : 'sessions'} this week makes it {view.current + 1}{earns ? ' and earns a freeze' : ''}.</span>
      <span className="ic ic-chev-right sm" style={{ color: '#B5B1A8' }} aria-hidden="true" />
    </Link>
  );
}

/** What the streak looks like if a freeze were used right now (null when none can be used): drives the confirm / option copy. */
export type AfterFreeze = Pick<StreakView, 'current' | 'freezes' | 'nextFreezeAtWeek'> | null;

const freezeLeft = (a: NonNullable<AfterFreeze>) => (a.freezes === 0 ? `No freeze left until week ${a.nextFreezeAtWeek}.` : `${plural(a.freezes, 'freeze')} left.`);

export function RiskCard({ view, slot, canStart, after, onStart, onExpress }: {
  view: StreakView; slot: number; canStart: boolean; after: AfterFreeze; onStart: () => void; onExpress: () => void;
}) {
  const cw = view.currentWeek;
  const dow = 7 - cw.daysLeft;
  const dayList = Array.from({ length: cw.daysLeft }, (_, i) => {
    const d = new Date(cw.weekStart); d.setDate(d.getDate() + dow + i);
    return { l: i === 0 ? 'Today' : DAYS[dow + i], n: d.getDate() };
  });
  // Start with the first `left` days picked (today first), the shape of the artboard's default.
  const [on, setOn] = useState<boolean[]>(() => dayList.map((_, i) => i < cw.left));
  const [confirm, setConfirm] = useState(false);
  const picked = on.filter(Boolean).length;
  const need = cw.left;
  const art = /^(8|11|18)/.test(String(view.current + 1)) ? 'an' : 'a';
  const short = need - dayList.length;
  const txt = short > 0
    ? `Can’t reach ${cw.target} this week. ${short <= 2 ? 'Do what you can: a week missed by 1–2 can be repaired next week.' : view.canUseFreezeNow ? 'A freeze keeps your streak safe.' : 'Your best stays, and a new streak can start any day.'}`
    : picked >= need
    ? (on[0] ? `${picked} ${picked === 1 ? 'day' : 'days'} picked, starting today. That gets you to ${cw.target}/${cw.target} and ${art} ${view.current + 1}-week streak.`
      : `Picked ${picked} ${picked === 1 ? 'day' : 'days'} but not today, so there’s no room for a missed day. Starting today is safer.`)
    : `Pick ${need - picked} more day${need - picked === 1 ? '' : 's'} to reach ${cw.target}. Only ${dayList.length - picked} left to choose from.`;
  return (
    <section className="risk" aria-label="Streak at risk">
      <div className="hstack" style={{ gap: 12 }}>
        <span className="tile accent"><span className="ic ic-flame" aria-hidden="true" /></span>
        <div className="stack-s grow" style={{ gap: 2 }}>
          <span className="t-h" style={{ color: '#7E2906' }}>Your {view.current}-week streak is at risk</span>
          <span className="small" style={{ color: '#7E2906' }}>{cw.done} of {cw.target} done · {plural(cw.daysLeft, 'day')} left</span>
        </div>
      </div>
      <p style={{ fontSize: 15, color: '#5C2005', margin: 0 }} aria-live="polite">{txt}</p>
      <div className="stack-s" style={{ gap: 8 }}>
        <span className="lbl" style={{ color: '#A8360A' }}>Plan your week · tap days</span>
        <div className="days" role="group" aria-label="Training days" style={{ gridTemplateColumns: `repeat(${Math.max(4, Math.min(7, dayList.length))}, minmax(0, 1fr))` }}>
          {dayList.map((d, i) => (
            <button type="button" key={i} className={`day${on[i] ? ' on' : ''}${i === 0 ? ' today' : ''}`} aria-pressed={on[i]}
              onClick={() => setOn((a) => a.map((v, k) => (k === i ? !v : v)))}><span>{d.l}</span><b>{d.n}</b></button>
          ))}
        </div>
      </div>
      <button type="button" className="btn btn-primary" disabled={!canStart} onClick={onStart}><span className="ic ic-play" aria-hidden="true" />Start session {slot} now</button>
      <div className="grid2" style={view.canUseFreezeNow ? undefined : { gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }} disabled={!canStart} onClick={onExpress}><span className="ic ic-bolt sm" aria-hidden="true" />{EXPRESS_MIN}-min express</button>
        {view.canUseFreezeNow && <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={() => setConfirm(true)} aria-expanded={confirm}><span className="ic ic-snow sm" aria-hidden="true" />Use a freeze</button>}
      </div>
      {confirm && view.canUseFreezeNow && (
        <div className="card tight" role="group" aria-label="Confirm freeze">
          <span className="strong">{view.freezes === 1 ? 'Use your only freeze on this week?' : 'Use a freeze on this week?'}</span>
          <span className="sub">Your streak is safe even at {cw.done}/{cw.target}. {after ? (after.freezes === 0 ? `You'll have no freeze left until week ${after.nextFreezeAtWeek}.` : `You'll have ${plural(after.freezes, 'freeze')} left.`) : ''} Starting a session today is usually the better deal.</span>
          <div className="grid2">
            <button type="button" className="btn btn-soft btn-sm" style={{ width: '100%' }} onClick={() => setConfirm(false)}>Keep it</button>
            <button type="button" className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => { freezeThisWeek(); setConfirm(false); }}>Use freeze</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function RepairCard({ view, slot, canStart, after, onStart }: { view: StreakView; slot: number; canStart: boolean; after: AfterFreeze; onStart: () => void }) {
  const r = view.repairOffer!;
  const cw = view.currentWeek;
  const missed = view.weeks.find((w) => w.weekStart === r.missedWeekStart);
  const canRepair = r.canRepair;
  const canFreeze = r.freezeAvailable && view.canUseFreezeNow;
  const [sel, setSel] = useState<'repair' | 'freeze'>(canRepair ? 'repair' : 'freeze');
  const cur: 'repair' | 'freeze' = sel === 'repair' && !canRepair ? 'freeze' : sel === 'freeze' && !canFreeze ? 'repair' : sel;
  const short = r.deficit === 1 ? 'one session short' : r.deficit === 2 ? 'two sessions short' : `${r.deficit} sessions short`;
  const comebackGot = view.badges.some((b) => b.id === 'comeback' && b.got);
  const opts = [
    ...(canRepair ? [{ k: 'repair' as const, icon: 'ic-wrench', tile: 'warm', t: `Repair it: ${r.target} sessions this week`, d: `Keeps your freeze for a real week off.${comebackGot ? '' : ' Unlocks the Comeback badge.'}`,
      note: view.freezes > 0 ? `If you don’t reach ${r.target} by Sunday, your freeze is used automatically, so the streak still survives.` : `If you don’t reach ${r.target} by Sunday, the streak starts over. Your best stays.` }] : []),
    ...(canFreeze ? [{ k: 'freeze' as const, icon: 'ic-snow', tile: 'blue', t: 'Use a freeze on last week', d: `Back to a normal ${cw.goal} this week.${after ? ` ${after.freezes === 0 ? `0 freezes left until week ${after.nextFreezeAtWeek}.` : freezeLeft(after)}` : ''}`,
      note: `Last week becomes frozen and the streak continues. You need ${cw.goal} this week to make it ${(after?.current ?? view.current) + 1}.` }] : []),
  ];
  const curOpt = opts.find((o) => o.k === cur) ?? opts[0];
  return (
    <>
      <section className="card dark" aria-label="Save your streak" style={{ borderRadius: 28, padding: 22, gap: 16 }}>
        <div className="hstack" style={{ gap: 12 }}>
          <span className="tile accent"><span className="ic ic-wrench" aria-hidden="true" /></span>
          <div className="stack-s grow" style={{ gap: 2 }}>
            <span className="t-h">Save your {view.current}-week streak</span>
            <span className="small" style={{ color: '#A8A8A8' }}>Last week: {missed?.done ?? 0} of {missed?.goal ?? r.target - r.deficit} · {short}</span>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 15, color: '#D9D9D9' }}>Do <b style={{ color: '#fff' }}>{r.target} sessions this week</b>: your {cw.goal}, plus {r.deficit} to make up for last week. Both weeks count and your streak keeps going.</p>
        <div className="stack-s" style={{ gap: 8 }}>
          <div className="segs" role="img" aria-label={`${r.done} of ${r.target} sessions done`} style={{ gridTemplateColumns: `repeat(${r.target}, minmax(0, 1fr))` }}>
            {Array.from({ length: r.target }, (_, i) => <span key={i} className={`mk${i < r.done ? ' on' : ''}${i >= r.target - r.deficit ? ' make' : ''}`} />)}
          </div>
          <div className="between small" style={{ color: '#A8A8A8' }}><span>{r.done} of {r.target} · {plural(r.daysLeft, 'day')} left</span><span>{r.deficit === 1 ? 'Make-up session' : 'Make-up sessions'}</span></div>
        </div>
      </section>

      {opts.length > 0 && (
        <>
          <span className="lbl" style={{ padding: '6px 2px 0' }} id="repair-opts">How do you want to keep it?</span>
          <div className="stack" role="radiogroup" aria-labelledby="repair-opts" style={{ gap: 12 }}>
            {opts.map((o) => (
              <button type="button" role="radio" aria-checked={curOpt.k === o.k} key={o.k} className={`opt${curOpt.k === o.k ? ' on' : ''}`} onClick={() => setSel(o.k)}>
                <span className={`tile sm ${o.tile}`}><span className={`ic ${o.icon} sm`} aria-hidden="true" /></span>
                <span className="grow stack-s" style={{ gap: 2 }}><span className="li-t">{o.t}</span><span className="li-s">{o.d}</span></span>
                <span className={`radio${curOpt.k === o.k ? ' on' : ''}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="banner info"><span className="ic ic-info" aria-hidden="true" /><div>{curOpt.note}</div></div>
          {curOpt.k === 'repair'
            ? <button type="button" className="btn btn-accent" disabled={!canStart} onClick={onStart}>Start session {slot} now</button>
            : <button type="button" className="btn btn-accent" onClick={() => { freezeThisWeek(); }}>Use freeze</button>}
        </>
      )}
    </>
  );
}

export function FrozenCard({ view }: { view: StreakView }) {
  const missed = !view.frozenThisWeek; // frozen via the repair offer: the freeze covers LAST week
  const goal = view.currentWeek.goal;
  return (
    <section className="card" aria-label={missed ? 'Last week frozen' : 'Week frozen'} style={{ background: '#E3EAFC', boxShadow: 'none' }}>
      <div className="hstack">
        <span className="tile blue" style={{ background: '#fff' }}><span className="ic ic-snow" aria-hidden="true" /></span>
        <div className="stack-s grow" style={{ gap: 2 }}>
          <span className="t-h" style={{ color: '#16357F' }}>{missed ? 'Last week frozen. Streak safe' : 'Week frozen. Streak safe'}</span>
          <span className="small" style={{ color: '#16357F' }}>{weeks(view.current)} · {plural(view.freezes, 'freeze')} left</span>
        </div>
      </div>
      <p className="small" style={{ color: '#16357F', margin: 0 }}>
        {missed
          ? `Last week counts and your streak continues. Hit ${goal} this week to keep it going. Changed your mind? Undo brings the repair back.`
          : `Sessions this week still count toward your rotation and progress. Changed your mind? Hit ${goal} and the freeze is refunded.`}
      </p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => undoFreezeThisWeek()}>Undo</button>
    </section>
  );
}

const LOST_KEY = 'rep-streak-lost-dismissed';
const readDismissed = (): number => { try { return Number(localStorage.getItem(LOST_KEY)) || 0; } catch { return 0; } };

/** Gentle one-liner after a reset. Dismissed per week (localStorage, guarded: private windows throw). */
export function LostBanner({ view }: { view: StreakView }) {
  const week = view.currentWeek.weekStart;
  const [gone, setGone] = useState(() => readDismissed() === week);
  if (gone) return null;
  return (
    <div className="banner info" role="status" style={{ alignItems: 'center' }}>
      <span className="ic ic-flame" aria-hidden="true" />
      <div className="grow">New streak starts today. Your best is {view.best}.</div>
      <button type="button" className="btn-ghost" aria-label="Dismiss" style={{ minWidth: 44, minHeight: 44, margin: '-12px -12px -12px 0', color: 'inherit' }}
        onClick={() => { try { localStorage.setItem(LOST_KEY, String(week)); } catch { /* private mode: dismissed for this visit only */ } setGone(true); }}>
        <span className="ic ic-x sm" aria-hidden="true" />
      </button>
    </div>
  );
}

/** WeekDone streak card: celebrate (once) when unseen, else the Streak page. */
export function StreakCard({ view }: { view: StreakView }) {
  const c = view.celebrate;
  const unseen = !!c?.unseen;
  const bits = [c?.badge ? 'New badge' : '', c?.freezeEarned ? '+1 freeze' : ''].filter(Boolean);
  const sub = unseen
    ? `${bits.length ? bits.join(' and ') : 'Week secured'}. Tap to celebrate.`
    : `Week secured. ${view.nextMilestone ? `Next badge at ${view.nextMilestone.weeks} weeks.` : 'Keep it going.'}`;
  return (
    <Link className="card dark" to={unseen ? '/streak/celebrate' : '/streak'} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <span className="tile lg" style={{ background: '#2A1A12', color: '#FF5A1F' }}><span className="ic ic-flame-fill lg" aria-hidden="true" /></span>
      <div className="grow stack-s" style={{ gap: 2 }}><span className="t-h">{view.current}-week streak</span><span className="small" style={{ color: '#BDBDBD' }}>{sub}</span></div>
      <span className="ic ic-chev-right" style={{ color: '#6B6B6B' }} aria-hidden="true" />
    </Link>
  );
}
