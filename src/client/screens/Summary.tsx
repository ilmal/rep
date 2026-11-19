import { goalForWeek } from '../../shared/streak';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Ring from '../components/Ring';
import { dateLong, mmss, rxLine, toDisplay } from '../lib/format';
import { setSessionNote, useRotation, useSessions, useSettings } from '../store/actions';
import { nextSlot, sessionDurationSec, sessionsInWeek, volumeOf } from '../../shared/rules';
import type { Session } from '../../shared/types';
import { useStreak } from '../store/x-streak';
import { newlyUnlockedBadges } from '../store/x-celebrate';
import '../styles/session.css';

export default function Summary() {
  const { id } = useParams();
  const sessions = useSessions();
  const session = sessions.find((s) => s.id === id);
  const navigate = useNavigate();
  if (!session || session.status !== 'completed') {
    return (
      <div className="app">
        <div className="scroll" style={{ paddingTop: 40, alignItems: 'center', textAlign: 'center' }}>
          <h1 className="t-display">Session not found</h1>
          <p className="sub">This session is not available on this device.</p>
          <button className="btn btn-primary" onClick={() => navigate('/', { replace: true })}>Back to Today</button>
        </div>
      </div>
    );
  }
  return <SummaryInner session={session} sessions={sessions} />;
}

const INSTALL_KEY = 'rep-install-reoffer';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
/** Mobile browser tab (not the installed app): the only place the install re-offer makes sense. */
function installable(): boolean {
  try {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches;
    return mobile && !standalone;
  } catch { return false; }
}

const tagCls = (k: string) => (k === 'weight_up' || k === 'rep_up' || k === 'tempo' || k === 'harder' ? 'green' : k === 'hold' ? '' : 'accent');

function SummaryInner({ session, sessions }: { session: Session; sessions: Session[] }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const { unit } = settings;
  const weeklyGoal = goalForWeek(settings, session.endedAt ?? session.startedAt);
  const rotation = useRotation();
  const [note, setNote] = useState(session.note ?? '');
  const saved = useRef(session.note ?? '');
  const flush = () => { if (note !== saved.current) { saved.current = note; setSessionNote(session.id, note); } };
  const noteRef = useRef(note);
  noteRef.current = note;
  // save a pending note if the user leaves without blurring
  useEffect(() => () => { if (noteRef.current !== saved.current) setSessionNote(session.id, noteRef.current); }, [session.id]);

  const ended = session.endedAt ?? session.startedAt;
  const week = sessionsInWeek(sessions, ended);
  const count = week.length;
  // counter animates from the previous count to the real one (design: 0 → 1/4)
  const [shown, setShown] = useState(Math.max(0, count - 1));
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setShown(count), reduce ? 0 : 700);
    return () => clearTimeout(t);
  }, [count]);
  const firstEver = sessions.filter((s) => s.status === 'completed').length === 1;
  const [offer, setOffer] = useState(() => firstEver && !lsGet(INSTALL_KEY) && installable());
  const dismissOffer = () => { lsSet(INSTALL_KEY, '1'); setOffer(false); };
  const total = sessionDurationSec(session);
  const target = session.targetMin * 60;
  const diff = total - target;
  const warm = session.warmupStartedAt && session.warmupEndedAt ? Math.max(0, Math.round((session.warmupEndedAt - session.warmupStartedAt) / 1000)) : 0;
  const warmPlan = session.warmupTargetMin * 60;
  const lifted = session.exercises.filter((e) => e.status === 'done' || (e.sets.length > 0 && e.status !== 'skipped'));
  const setCount = lifted.reduce((a, e) => a + e.sets.length, 0);
  const swapped = session.exercises.filter((e) => e.swappedFrom && e.sets.length > 0).length;
  const volume = lifted.reduce((a, e) => a + volumeOf(e), 0);
  const prev = sessions
    .filter((s) => s.status === 'completed' && s.areaId === session.areaId && s.id !== session.id && (s.endedAt ?? 0) < ended)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  const prevVol = prev ? prev.exercises.filter((e) => e.sets.length > 0).reduce((a, e) => a + volumeOf(e), 0) : 0;
  const volDelta = prevVol > 0 && volume > 0 ? Math.round(((volume - prevVol) / prevVol) * 100) : null;
  const rest = lifted.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.restSec ?? 0), 0), 0);
  const warmC = Math.min(warm, total);
  const restC = Math.min(rest, Math.max(0, total - warmC));
  const lifting = Math.max(0, total - warmC - restC);
  const nextRows = lifted.filter((e) => e.recommendation);
  const nextArea = rotation.length ? rotation[(nextSlot(sessions, rotation.length) - 1) % rotation.length] : undefined;
  const nextSlotN = rotation.length ? ((nextSlot(sessions, rotation.length) - 1) % rotation.length) + 1 : 0;

  // streak: a secured week not yet celebrated opens StreakCelebrate when the user finishes (Flows 5: "on finishing the session")
  const view = useStreak();
  const settingsAll = useSettings();
  const cw = view.currentWeek;
  const thisWeek = ended >= cw.weekStart;
  const cel = thisWeek ? view.celebrate : null;
  const celebrateNow = !!cel?.unseen;
  const unlocked = useMemo(() => newlyUnlockedBadges(sessions, settingsAll, session.id).filter((b) => b.id !== cel?.badge?.id), [sessions, settingsAll, session.id, cel?.badge?.id]);
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const streakCard = ((): { to: string; title: string; sub: string } | null => {
    if (!thisWeek) return null;
    if (cel) {
      const bits = [cel.badge ? 'New badge' : '', cel.freezeEarned ? '+1 freeze' : ''].filter(Boolean);
      const sub = bits.length ? bits.join(' and ') : cel.kind === 'repair' ? 'Missed sessions made up' : 'Goal hit. Extra sessions still count.';
      return { to: celebrateNow ? '/streak/celebrate' : '/streak', title: cel.kind === 'repair' ? `Streak saved · ${n(cel.streak, 'week', 'weeks')}` : `${cel.streak}-week streak!`, sub };
    }
    if (view.current > 0) return { to: '/streak', title: `${view.current}-week streak · ${cw.left} to go`, sub: `${n(cw.left, 'more session', 'more sessions')} by Sunday makes it ${view.current + (view.repairOffer ? 2 : 1)}` };
    return { to: '/streak', title: `Start a streak · ${cw.left} to go`, sub: `${n(cw.left, 'more session', 'more sessions')} by Sunday starts your streak` };
  })();

  const done = () => { flush(); if (offer) lsSet(INSTALL_KEY, '1'); navigate(celebrateNow ? '/streak/celebrate' : '/', { replace: true }); };

  return (
    <div className="app">
      <div className="scroll" style={{ paddingTop: 40, paddingBottom: 130 }}>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 10 }}>
          <div style={{ position: 'relative', width: 150, height: 150 }}>
            <Ring count={shown} goal={weeklyGoal} size={150} stroke={12} track="#E0DED8" label={`${count} of ${weeklyGoal} sessions this week`} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <span className="t-num" style={{ fontSize: 40 }}>{shown}/{weeklyGoal}</span>
              <span className="eyebrow" style={{ fontSize: 12 }}>this week</span>
            </div>
          </div>
          <h1 className="t-display">Session {session.seq} {session.endedEarly ? 'saved' : 'done'}</h1>
          <p className="sub">{session.areaName} · {session.gymName} · {dateLong(ended)}{session.endedEarly ? ' · ended early' : ''}</p>
        </div>

        <div className="grid2">
          <div className="stat"><span className="stat-l">Total time</span><span className="stat-v">{mmss(total)}</span>
            {total > 0 && <span className={`tag ${diff <= 0 ? 'green' : 'accent'}`} style={{ alignSelf: 'flex-start' }}>{mmss(Math.abs(diff))} {diff <= 0 ? 'under' : 'over'} target</span>}</div>
          <div className="stat"><span className="stat-l">Warm-up</span><span className="stat-v">{warm ? mmss(warm) : '—'}</span>
            {warm > 0 && <span className={`tag ${warm <= warmPlan ? 'green' : 'accent'}`} style={{ alignSelf: 'flex-start' }}>{warm <= warmPlan ? '−' : '+'}{mmss(Math.abs(warm - warmPlan))} vs plan</span>}</div>
          <div className="stat"><span className="stat-l">Volume</span><span className="stat-v">{volume > 0 ? `${Math.round(toDisplay(volume, unit)).toLocaleString('en')} ${unit}` : '—'}</span>
            {volDelta != null && <span className="small sub">{volDelta >= 0 ? '+' : ''}{volDelta}% vs last {session.areaName}</span>}</div>
          <div className="stat"><span className="stat-l">Sets</span><span className="stat-v">{setCount}</span>
            <span className="small sub">{lifted.length} {lifted.length === 1 ? 'exercise' : 'exercises'}{swapped ? ` · ${swapped} swapped` : ''}</span></div>
        </div>

        {streakCard && (
          <Link className="card tight" to={streakCard.to} data-testid="streak-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, background: '#121212', color: '#fff' }}>
            <span className="tile" style={{ background: '#2A1A12', color: '#FF5A1F' }}><span className="ic ic-flame-fill" aria-hidden="true" /></span>
            <div className="grow stack-s" style={{ gap: 2 }}><span className="strong">{streakCard.title}</span><span className="small" style={{ color: '#BDBDBD' }}>{streakCard.sub}</span></div>
            <span className="ic ic-chev-right" style={{ color: '#6B6B6B' }} aria-hidden="true" />
          </Link>
        )}

        {unlocked.length > 0 && (
          <Link className="card tight" to="/streak/badges" data-testid="new-badges" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <span className="tile accent"><span className="ic ic-medal" aria-hidden="true" /></span>
            <div className="grow stack-s" style={{ gap: 2 }}><span className="strong">{unlocked.length === 1 ? 'New badge' : `${unlocked.length} new badges`}</span><span className="small sub">{unlocked.map((b) => b.name).join(' · ')}</span></div>
            <span className="ic ic-chev-right chev" aria-hidden="true" />
          </Link>
        )}

        {total > 0 && (
          <div className="card tight">
            <span className="lbl">Where the time went</span>
            <div className="tl slim" role="img" aria-label={`Warm-up ${Math.round(warmC / 60)} min, lifting ${Math.round(lifting / 60)} min, rest ${Math.round(restC / 60)} min`}>
              <span style={{ width: `${(warmC / total) * 100}%`, background: '#FF5A1F' }} />
              <span style={{ width: `${(lifting / total) * 100}%`, background: '#121212' }} />
              <span style={{ width: `${(restC / total) * 100}%`, background: '#B5B1A8' }} />
            </div>
            <div className="between small">
              <span className="hstack" style={{ gap: 6 }}><span className="dot accent" />Warm-up {Math.round(warmC / 60)}</span>
              <span className="hstack" style={{ gap: 6 }}><span className="dot" style={{ background: '#121212' }} />Lifting {Math.round(lifting / 60)}</span>
              <span className="hstack" style={{ gap: 6 }}><span className="dot" />Rest {Math.round(restC / 60)}</span>
            </div>
          </div>
        )}

        {nextRows.length > 0 && (
          <>
            <div className="section-h">Next time</div>
            <div className="group">
              {nextRows.map((e) => {
                const r = e.recommendation!;
                return (
                  <div key={e.id} className="li">
                    <div className="grow"><span className="li-t">{e.name}</span><span className="li-s">{rxLine(r.sets, r.reps, r.weight, unit, e.tracking, e.perHand)}{e.swappedFrom ? ' · swapped in' : ''}</span></div>
                    {e.pr && <span className="tag ink">PR</span>}
                    <span className={`tag ${tagCls(r.kind)}`}>{r.tag}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <label className="field">
          <span className="lbl" style={{ paddingLeft: 2 }}>Note (optional)</span>
          <input className="input" placeholder="How did it feel? Anything to remember?" value={note} onChange={(e) => setNote(e.target.value)} onBlur={flush} />
        </label>

        {offer && (
          <div className="card" role="region" aria-label="Install Gym Tracker">
            <div className="stack-s" style={{ gap: 2 }}><span className="t-h">Add Gym Tracker to your home screen</span><span className="small sub">Opens full screen and works offline.</span></div>
            <div className="hstack" style={{ gap: 8 }}>
              <Link className="btn btn-primary" to="/install" onClick={() => lsSet(INSTALL_KEY, '1')}>Install</Link>
              <button className="btn" onClick={dismissOffer}>Not now</button>
            </div>
          </div>
        )}

        {nextArea && (
          <div className="card dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <span className="tile lg accent">{nextSlotN}</span>
            <div className="grow stack-s" style={{ gap: 2 }}><span className="eyebrow">Up next in rotation</span><span className="t-h">{nextArea.name}</span></div>
          </div>
        )}
      </div>
      <div className="bottombar">
        <button className="btn btn-primary" onClick={done}>Done</button>
      </div>
    </div>
  );
}
