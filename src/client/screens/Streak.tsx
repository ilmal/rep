import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStreak, freezeThisWeek, undoFreezeThisWeek } from '../store/x-streak';
import { MAX_FREEZES, weekLabel, type StreakView, type WeekResult } from '../../shared/streak';
import { dateShort } from '../lib/format';

// Copy verbatim from Streak.dc.html
const RULES = [
  ['ic-flame', 'warm', 'Hit your weekly goal: +1 week', 'Any days you like. Extra sessions count too. The week runs Monday to Sunday, and goal changes apply from next Monday.'],
  ['ic-wrench', '', 'Missed by 1 or 2? Repair it next week', 'Make up the missing sessions on top of next week’s goal (e.g. 3/4, then 5 next week) and both weeks count. Your streak keeps going.'],
  ['ic-snow', 'blue', 'Freezes cover a week off', 'You earn one every 4 goal weeks and can hold two. If a week can’t be repaired, a freeze is used automatically.'],
  ['ic-clock', '', 'We warn you before it’s too late', 'A heads-up when you fall behind pace (like Wednesday with 0 done), a last-chance alert, and a Monday repair reminder. At most one a day, never after 21:00.'],
] as const;

const WK = {
  hit: ['w-hit', 'ic-check'], repaired: ['w-rep', 'ic-wrench'], frozen: ['w-frz', 'ic-snow'], missed: ['w-miss', 'ic-x'], open: ['w-now', 'ic-flame'],
} as const;
const WK_NAME = { hit: 'goal hit', repaired: 'repaired', frozen: 'frozen', missed: 'missed', open: 'this week' } as const;

const wk = (n: number) => `${n}-week streak`;

function weeksAria(v: StreakView): string {
  const rep = v.last16.filter((w) => w.status === 'repaired').length;
  const frz = v.last16.filter((w) => w.status === 'frozen').length;
  const bits = [rep ? `${rep} repaired` : '', frz ? `${frz} frozen` : ''].filter(Boolean);
  return `Weekly results: ${wk(v.current)}${bits.length ? `, ${bits.join(' and ')} week${rep + frz > 1 ? 's' : ''}` : ''}`;
}

export default function Streak() {
  const v = useStreak();
  const [open, setOpen] = useState(-1);
  const [confirm, setConfirm] = useState(false);
  const cw = v.currentWeek;
  const repairOpen = v.repairOffer !== null;
  const gain = repairOpen ? 2 : 1; // reaching a repair target counts the missed week too
  const nextNum = v.current + gain;
  const noStreak = v.current === 0 && !cw.secured;
  const earnsFreeze = !cw.secured && !v.freezeCapped && v.weeksUntilFreeze <= gain;
  const earnsBadge = !cw.secured && v.nextMilestone && v.nextMilestone.weeks === nextNum ? v.nextMilestone : null;
  const segN = Math.max(1, cw.target);
  const showUse = v.canUseFreezeNow && v.atRisk;
  const lastFreeze = v.freezes === 1;
  const targetLabel = v.freezeTarget === 'missed' ? 'last week' : 'this week';
  const empty = v.weeks.length <= 1 && cw.done === 0 && v.best === 0;

  const use = () => { freezeThisWeek(); setConfirm(false); };
  const undo = () => { undoFreezeThisWeek(); };

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/" aria-label="Back to Today"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Streak</span>
        <Link className="iconbtn" to="/streak/badges" aria-label="All badges"><span className="ic ic-trophy" aria-hidden="true" /></Link>
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <section className="card dark" aria-label="Your streak" style={{ flexDirection: 'row', alignItems: 'center', gap: 18, padding: 22, borderRadius: 28 }}>
          <div className="flamebox"><span className="ic ic-flame-fill" style={{ width: 56, height: 56 }} aria-hidden="true" /></div>
          <div className="stack-s grow" style={{ gap: 2 }}>
            <span className="t-num" data-testid="streak-num" style={{ fontSize: 64, lineHeight: 1 }}>{v.current}</span>
            <span style={{ fontWeight: 700, fontSize: 18 }}>week streak</span>
            <span className="hstack small" style={{ gap: 8, color: '#A8A8A8' }}>
              <span className="tag" style={{ background: '#3A2418', color: '#FFB08A' }}>{v.tierText}</span>Best {v.best}
            </span>
          </div>
        </section>

        <section className="card" aria-label="This week">
          <div className="between">
            <span className="strong">{v.frozenThisWeek ? 'Week frozen' : cw.secured ? 'Week secured' : noStreak ? 'Start your streak' : `Make it ${nextNum} this week`}</span>
            <span className={`tag ${cw.paceTone}`}>{cw.paceLabel}</span>
          </div>
          <div className="segs" role="img" aria-label={`${Math.min(cw.done, segN)} of ${segN} sessions done`} style={{ gridTemplateColumns: `repeat(${segN}, minmax(0, 1fr))` }}>
            {Array.from({ length: segN }, (_, i) => <span key={i} className={i < cw.done ? 'now' : ''} style={{ height: 10, borderRadius: 5 }} />)}
          </div>
          {v.lost && <p className="sub">New streak starts today. Your best is {v.lostStreak}.</p>}
          {empty && <p className="sub">Hit your goal this week.</p>}
          <p className="sub">{cw.paceText}</p>
          {!cw.secured && !v.frozenThisWeek && (
            <div className="stack-s" style={{ gap: 8, background: '#FFF6F1', borderRadius: 16, padding: '12px 14px' }}>
              <span className="lbl" style={{ color: '#A8360A' }}>Reward for {cw.target}/{cw.target}</span>
              <span className="hstack small" style={{ gap: 8 }}><span className="ic ic-flame sm" style={{ color: '#FF5A1F' }} aria-hidden="true" />{nextNum}-week streak</span>
              {earnsFreeze && <span className="hstack small" style={{ gap: 8 }}><span className="ic ic-snow sm" style={{ color: '#1D44A8' }} aria-hidden="true" />+1 streak freeze (every 4 weeks)</span>}
              {earnsBadge && <span className="hstack small" style={{ gap: 8 }}><span className="ic ic-medal sm" style={{ color: '#A8360A' }} aria-hidden="true" />Badge: {earnsBadge.name}</span>}
            </div>
          )}
        </section>

        <section className="card" aria-label="Streak freezes">
          <div className="between"><span className="strong">Streak freezes</span><span className="small sub">{v.freezes} of {MAX_FREEZES}</span></div>
          <div className="hstack" style={{ gap: 10 }}>
            {Array.from({ length: MAX_FREEZES }, (_, i) => i < v.freezes
              ? <span key={i} className="slot on" aria-label="Freeze available"><span className="ic ic-snow lg" aria-hidden="true" /></span>
              : <span key={i} className="slot off" aria-label="Empty freeze slot"><span className="ic ic-snow lg" aria-hidden="true" /></span>)}
            <p className="sub grow">A freeze covers a missed week, so life can happen. Earn one every 4 goal weeks.{v.freezeCapped ? ' You’re holding the maximum.' : ` Next at week ${v.nextFreezeAtWeek}.`}</p>
          </div>
          {v.frozenThisWeek && v.undoFreezeWeek !== null && (
            <div className="stack-s" style={{ gap: 8, background: '#E3EAFC', borderRadius: 16, padding: '12px 14px' }}>
              <span className="strong" style={{ color: '#16357F' }}>Week frozen. Streak safe</span>
              <span className="small" style={{ color: '#16357F' }}>Sessions this week still count toward your rotation and progress. Changed your mind? Hit {cw.goal} and the freeze is refunded.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={undo}>Undo</button>
            </div>
          )}
          {showUse && !confirm && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(true)}><span className="ic ic-snow sm" aria-hidden="true" />Use a freeze this week</button>
          )}
          {showUse && confirm && (
            <div className="card tight" role="group" aria-label="Confirm freeze" style={{ background: 'var(--bg)' }}>
              <span className="strong">{lastFreeze ? `Use your only freeze on ${targetLabel}?` : `Use one of your ${v.freezes} freezes on ${targetLabel}?`}</span>
              <span className="sub">
                Your streak is safe even at {cw.done}/{cw.goal}. {lastFreeze ? `You'll have no freeze left until week ${v.nextFreezeAtWeek}.` : `You'll have ${v.freezes - 1} freeze left.`}{v.freezeTarget === 'current' ? ' Starting a session today is usually the better deal.' : ''}
              </span>
              <div className="grid2"><button type="button" className="btn btn-soft btn-sm" style={{ width: '100%' }} onClick={() => setConfirm(false)}>Keep it</button><button type="button" className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={use}>Use freeze</button></div>
            </div>
          )}
        </section>

        <section className="card" aria-label="Last 16 weeks">
          <div className="between"><span className="strong">Last 16 weeks</span><Link className="link" to="/history">History</Link></div>
          <div className="wk" role="img" aria-label={weeksAria(v)}>
            {v.last16.map((w: WeekResult, i) => {
              const isNow = i === v.last16.length - 1;
              const [cls, icon] = WK[isNow && w.status === 'open' ? 'open' : w.status];
              return (
                <div className="wkc" key={w.weekStart} data-status={w.status} title={`${dateShort(w.weekStart)}: ${WK_NAME[w.status]}`}>
                  <i className={cls}><span className={`ic ${icon} xs`} aria-hidden="true" style={{ color: 'inherit' }} /></i>
                  <span>{weekLabel(w, isNow)}</span>
                </div>
              );
            })}
          </div>
          <div className="wrap small" style={{ gap: '6px 12px', color: '#6B6B6B' }}>
            <span className="hstack" style={{ gap: 5 }}><span className="dot" style={{ background: '#121212' }} />Goal hit</span>
            <span className="hstack" style={{ gap: 5 }}><span className="dot accent" />Repaired</span>
            <span className="hstack" style={{ gap: 5 }}><span className="dot" style={{ background: '#1D44A8' }} />Frozen</span>
            <span className="hstack" style={{ gap: 5 }}><span className="dot" />Missed</span>
          </div>
        </section>

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>Milestones</span><Link className="link" to="/streak/badges">All badges</Link></div>
        <div className="hscroll">
          {v.milestones.map((m) => (
            <div className="mbadge" key={m.weeks} data-state={m.state}>
              <span className={`medal ${m.state}`}><span className={`ic ${m.state === 'got' ? 'ic-medal' : m.state === 'next' ? 'ic-flame' : 'ic-trophy'} lg`} aria-hidden="true" /></span>
              <span className="strong small">{m.short}</span>
              <span className="small sub">{m.state === 'got' ? 'Got it' : m.state === 'next' ? `${m.progress.n} / ${m.progress.of} weeks` : `${m.weeks} weeks`}</span>
            </div>
          ))}
        </div>

        <div className="section-h">How streaks work</div>
        <div className="group">
          {RULES.map(([icon, tile, t, d], i) => {
            const on = open === i;
            return (
              <div key={t}>
                <button type="button" className="li" aria-expanded={on} aria-controls={`rule-${i}`} onClick={() => setOpen(on ? -1 : i)}>
                  <span className={`tile sm ${tile}`}><span className={`ic ${icon} sm`} aria-hidden="true" /></span>
                  <div className="grow"><span className="li-t">{t}</span></div>
                  <span className={`ic ${on ? 'ic-chev-up' : 'ic-chev-down'} chev`} aria-hidden="true" />
                </button>
                {on && <p id={`rule-${i}`} className="sub" style={{ padding: '0 16px 16px 64px' }}>{d}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
