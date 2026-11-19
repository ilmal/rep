import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Ring from '../components/Ring';
import TabBar from '../components/TabBar';
import { chooseSlot, prepareDraft, toggleNoEquipment, useAtHome, useCurrentGym, useDraft, useLibrary, useRotation, useSessions, useSettings, useWeek } from '../store/actions';
import { NO_EQUIPMENT_LABEL } from '../../shared/location';
import { useNow } from '../lib/hooks';
import { TEMPLATE_META, type GymTemplate } from '../../shared/catalog';
import { getState, useStore } from '../store/core';
import { resetStartFlow } from '../store/x-onboarding';
import { useStreak } from '../store/x-streak';
import { EXPRESS_MIN, clearExpressDraft, startExpress } from '../store/x-today';
import { computeStreak, freezePatch } from '../../shared/streak';
import { FrozenCard, LostBanner, RepairCard, RiskCard, STREAK_STYLE, StreakBanner, StreakCard, StreakChip, type ChipMode } from './today/StreakCards';
import { dateLong, dayShort, toDisplay } from '../lib/format';
import { completed, isoWeek, sessionDurationSec, sessionsInWeek, totalPlannedSec, volumeOf, weekStart } from '../../shared/rules';
import type { Gym, Session } from '../../shared/types';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const STYLE = `${STREAK_STYLE}
.step{display:flex;gap:12px;align-items:flex-start}
.step b{width:28px;height:28px;border-radius:14px;background:#262626;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.wd{display:flex;flex-direction:column;align-items:center;gap:6px}
.wdl{font-size:11px;font-weight:600;color:#6B6B6B}
.wdn{width:36px;height:36px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600}
.wd.trained .wdn{background:#121212;color:#fff}
.wd.today .wdn{box-shadow:inset 0 0 0 2px #FF5A1F}
.wd.trained.today .wdn{box-shadow:0 0 0 2px #fff,0 0 0 4px #FF5A1F}`;

const sessionTs = (s: Session) => s.endedAt ?? s.startedAt;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function weekDays(nowMs: number, done: Session[]) {
  const start = new Date(weekStart(nowMs));
  const today = new Date(nowMs); today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    return {
      letter: DAY_LETTERS[i], date: d.getDate(),
      trained: done.some((s) => sessionTs(s) >= d.getTime() && sessionTs(s) < next.getTime()),
      today: d.getTime() === today.getTime(),
    };
  });
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short template label when the gym's equipment still equals a starting template, else null. */
function templateName(g: Gym): { label: string; items: number } {
  const ids = Object.entries(g.equipment).filter(([, v]) => v !== 'none').map(([k]) => k).sort().join(',');
  const items = ids ? ids.split(',').length : 0;
  const hit = (Object.keys(TEMPLATE_META) as GymTemplate[]).find((k) => k !== 'empty' && [...TEMPLATE_META[k].ids].sort().join(',') === ids);
  return { label: hit ? `Template: ${{ full: 'full gym', basic: 'basic gym', home: 'home gym', empty: 'empty' }[hit]}` : 'Custom equipment', items };
}

/** Weight increases in the week: an exercise whose top set beat its previous appearance in an earlier completed session. */
function weightIncreases(week: Session[], all: Session[]): number {
  const done = completed(all);
  const top = (e: Session['exercises'][number]) => e.sets.reduce((m, x) => Math.max(m, x.weight), 0);
  let n = 0;
  for (const s of week) {
    for (const e of s.exercises) {
      const w = top(e);
      if (!w) continue;
      const prev = done.filter((p) => p.id !== s.id && sessionTs(p) < sessionTs(s)).sort((a, b) => sessionTs(b) - sessionTs(a)).map((p) => p.exercises.find((x) => x.exerciseId === e.exerciseId)).find((x) => x && top(x) > 0);
      if (prev && w > top(prev)) n++;
    }
  }
  return n;
}

/** Median warm-up minutes of the last 3 completed sessions (needs all 3 to have a measured warm-up). */
function recentWarmupMin(sessions: Session[]): number | null {
  const last = completed(sessions).sort((a, b) => sessionTs(b) - sessionTs(a)).slice(0, 3);
  if (last.length < 3) return null;
  const d = last.map((s) => (s.warmupStartedAt && s.warmupEndedAt ? (s.warmupEndedAt - s.warmupStartedAt) / 60000 : 0));
  if (d.some((x) => x <= 0)) return null;
  return Math.round(d.sort((a, b) => a - b)[1]);
}

/** Location line of the dark next-session card: tap to flip between the gym and the built-in "At home · no equipment" location. */
function LocationLine({ gym, atHome, bare }: { gym: Gym | null; atHome: boolean; bare?: boolean }) {
  const tag = (t: string) => <span className="tag" style={{ background: '#262626', color: '#E6E6E6' }}>{t}</span>;
  const btn = (label: string, icon: string, t: string, pressed: boolean) => (
    <button type="button" className="hstack" style={{ gap: 8, fontSize: 14, color: '#fff', minHeight: 32, textAlign: 'left' }} onClick={toggleNoEquipment} aria-pressed={pressed}>
      <span className={`ic ${icon} sm`} style={{ color: '#FF5A1F' }} aria-hidden="true" />
      {label && <span>{label}</span>}{tag(t)}
    </button>
  );
  if (atHome) return btn(NO_EQUIPMENT_LABEL, 'ic-home', 'Switch to gym', true);
  if (gym) return btn(gym.name, 'ic-pin', 'At home? Tap', false);
  return (
    <div className="hstack" style={{ gap: 8, fontSize: 14, minHeight: bare ? undefined : 32 }}>
      <span className="ic ic-pin sm" style={{ color: '#FF5A1F' }} aria-hidden="true" />
      <Link to="/session/gym" style={{ textDecoration: 'underline' }}>Choose a gym</Link>
      <button type="button" className="hstack" style={{ gap: 4, color: '#fff', minHeight: 32 }} onClick={toggleNoEquipment} aria-pressed={false} aria-label="At home, no equipment">{tag('At home? Tap')}</button>
    </div>
  );
}

export default function Today() {
  const navigate = useNavigate();
  const settings = useSettings();
  const sessions = useSessions();
  const everDone = useMemo(() => completed(sessions).length, [sessions]);
  const { goal: settingsGoal, next } = useWeek();
  const view = useStreak();
  const cw = view.currentWeek;
  const rotation = useRotation();
  const gym = useCurrentGym();
  const atHome = useAtHome();
  const draft = useDraft();
  const chosen = useStore((s) => s.device.chosenSlot);
  const [pickOpen, setPickOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(true);

  const nowMs = useNow(30_000);
  const library = useLibrary();
  const slot = Math.min(chosen ?? next, Math.max(1, rotation.length));
  const area = rotation[slot - 1];
  const gymId = useStore((s) => s.device.currentGymId);

  useEffect(() => { resetStartFlow(); clearExpressDraft(); }, []);
  useEffect(() => { if (rotation.length) prepareDraft(); }, [slot, gymId, rotation.length, draft === null, settings.targetMinutes, settings.warmupTargetMinutes]);

  const week = useMemo(() => sessionsInWeek(sessions, nowMs).sort((a, b) => sessionTs(a) - sessionTs(b)), [sessions, nowMs]);
  const days = weekDays(nowMs, week);
  const name = settings.name.trim();
  const myDraft = draft && draft.slot === slot ? draft : null;
  const planSec = myDraft ? totalPlannedSec(myDraft.exercises, settings.warmupTargetMinutes) : null;
  const medianWarmMin = useMemo(() => recentWarmupMin(sessions), [sessions]);
  // Only when real: fit-to-time is on, the last 3 warm-ups all ran long on median, and the plan with that real warm-up would overshoot the target.
  const trimmed = settings.fitToTime && medianWarmMin != null && medianWarmMin > settings.warmupTargetMinutes && myDraft != null && myDraft.exercises.length > 0
    && totalPlannedSec(myDraft.exercises, medianWarmMin) > settings.targetMinutes * 60;

  // Week numbers come from the streak model (a goal change applies from next Monday; a repair raises this week's target).
  const goal = everDone === 0 ? settingsGoal : cw.goal;
  const count = everDone === 0 ? 0 : cw.done;
  const daysLeft = cw.daysLeft;
  const left = cw.left;
  const reached = cw.secured;
  const onTrack = left <= daysLeft;

  // What a freeze would leave behind (copy for the confirm card / repair option).
  const after = useMemo(() => {
    const st = getState();
    const p = freezePatch(st.settings, view);
    return p ? computeStreak(sessions, { ...st.settings, ...p }, Date.now()) : null;
  }, [view, sessions]);

  // One streak card at a time: repair > risk > frozen > lost. Nothing without a streak to protect.
  const repairOffer = view.repairOffer;
  const showRepair = !!repairOffer && (repairOffer.canRepair || repairOffer.freezeAvailable);
  const showRisk = !showRepair && !repairOffer && view.atRisk && !view.frozenThisWeek;
  const showFrozen = !showRepair && !showRisk && !reached && (view.frozenThisWeek || view.undoFreezeWeek !== null);
  const showLost = !showRepair && !showRisk && !showFrozen && view.lost;
  const chipMode: ChipMode = repairOffer ? 'repair' : showRisk ? 'risk' : 'normal';
  const hasStreakHistory = view.current > 0 || view.best > 0;

  const others = rotation.map((a, i) => ({ a, n: i + 1 })).filter((x) => x.n !== slot);
  const bonusN = count + 1;
  const allAreas = new Set(week.map((s) => s.areaId)).size >= rotation.length && rotation.length > 0;

  const header = (
    <div className="between" style={{ padding: '0 2px 4px' }}>
      <div className="stack-s" style={{ gap: 4 }}>
        <span className="eyebrow">{dateLong(nowMs)}{showRepair ? ` · Week ${isoWeek(nowMs)}` : ''}</span>
        <h1 className="t-display">Hi {name || 'there'}</h1>
      </div>
      <div className="hstack" style={{ gap: 8 }}>
        {hasStreakHistory && !reached && <StreakChip n={view.current} mode={chipMode} />}
        <Link className="avatar" to="/settings" aria-label="Profile and settings">
          {name ? name.charAt(0).toUpperCase() : <span className="ic ic-gear" aria-hidden="true" />}
        </Link>
      </div>
    </div>
  );

  const strip = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, width: '100%' }} role="list" aria-label="Days this week">
      {days.map((d, i) => (
        <div key={i} role="listitem" className={`wd${d.trained ? ' trained' : ''}${d.today ? ' today' : ''}`} aria-label={`${d.date}${d.trained ? ', trained' : ''}${d.today ? ', today' : ''}`}>
          <span className="wdl" aria-hidden="true">{d.letter}</span><span className="wdn" aria-hidden="true">{d.date}</span>
        </div>
      ))}
    </div>
  );

  const weekListOf = (compact: boolean) => week.length > 0 && (
    <div className="group">
      {[...week].reverse().map((s) => {
        const prs = s.exercises.filter((e) => e.pr).length;
        const mins = Math.round(sessionDurationSec(s) / 60);
        return (
          <Link className="li" to={`/history/${s.id}`} key={s.id}>
            <span className={`tile ink${compact ? ' sm' : ''}`}>{s.slot}</span>
            <div className="grow"><span className="li-t">{s.areaName}</span><span className="li-s">{compact ? DOW[new Date(sessionTs(s)).getDay()] : dayShort(sessionTs(s))}{mins ? ` · ${mins} min` : ''} · {s.gymName}</span></div>
            {prs > 0 && <span className="tag green">+{plural(prs, 'PR')}</span>}
            <span className="ic ic-chev-right chev" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );

  const weekList = weekListOf(false);

  const canStart = !!myDraft && myDraft.exercises.length > 0;
  const startBtn = (label: string, primary: boolean) => (
    <button type="button" className={primary ? 'btn btn-accent' : 'btn btn-secondary'} disabled={!myDraft || myDraft.exercises.length === 0} onClick={() => navigate('/session/preview')}>
      {label}{primary && <> <span className="ic ic-arrow-right" aria-hidden="true" /></>}
    </button>
  );

  if (everDone === 0) {
    const tpl = gym ? templateName(gym) : null;
    const ex = myDraft?.exercises ?? [];
    const lib = new Map(library.map((e) => [e.id, e]));
    const beginner = ex.length > 0 && ex.every((e) => lib.get(e.exerciseId)?.difficulty === 1);
    const half = Math.floor(goal / 2);
    return (
      <div className="app">
        <style>{STYLE}</style>
        <div className="scroll" style={{ paddingTop: 24 }}>
          <div className="between" style={{ padding: '0 2px 4px' }}>
            <div className="stack-s" style={{ gap: 4 }}><span className="eyebrow">{dateLong(nowMs)}</span><h1 className="t-display">{name ? `Welcome, ${name}` : 'Welcome'}</h1></div>
            <Link className="avatar" to="/settings" aria-label="Profile and settings">{name ? name.charAt(0).toUpperCase() : <span className="ic ic-gear" aria-hidden="true" />}</Link>
          </div>

          <section className="card" aria-label="This week" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', width: 84, height: 84, flexShrink: 0 }}>
              <Ring count={0} goal={goal} size={84} stroke={14} label={`0 of ${goal} sessions this week`} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="t-num" style={{ fontSize: 24 }}>0/{goal}</span></div>
            </div>
            <div className="stack-s grow">
              <span className="eyebrow">Week {isoWeek(nowMs)} · your first week</span>
              <span className="t-h">{plural(goal, 'session')}, any {goal === 1 ? 'day' : 'days'}</span>
              {half >= 1 && <span className="sub">Even {half} this week is a good start.</span>}
            </div>
          </section>

          {area ? (
            <section className="card dark" aria-label="First session" style={{ borderRadius: 28, padding: 22, gap: 16 }}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div className="stack-s"><span className="eyebrow">Your first session</span><h2 style={{ fontSize: 30, fontWeight: 700 }}>{area.name}</h2></div>
                <span className="tile lg accent" aria-hidden="true">{slot}</span>
              </div>
              <div className="stack-s" style={{ gap: 8, fontSize: 14 }}>
                <LocationLine gym={gym} atHome={atHome} bare />
                <div className="hstack" style={{ gap: 8 }}>
                  <span className="ic ic-clock sm" style={{ color: '#A8A8A8' }} aria-hidden="true" />
                  {planSec != null ? <span>≈ {Math.round(planSec / 60)} min · {plural(ex.length, 'exercise')}{beginner ? ', all beginner-friendly' : ''}</span> : <span>Planning…</span>}
                  {myDraft?.source === 'coach' && <span className="tag" style={{ background: '#262626', color: '#E6E6E6' }}>Coach plan</span>}
                </div>
              </div>
              <div className="stack" style={{ gap: 12, padding: '4px 0' }}>
                <div className="step"><b>1</b><span style={{ fontSize: 14, color: '#E6E6E6' }}>Weights are starting guesses. Pick what feels right on set 1.</span></div>
                <div className="step"><b>2</b><span style={{ fontSize: 14, color: '#E6E6E6' }}>Rate each exercise when you finish it. Three quick taps.</span></div>
                <div className="step"><b>3</b><span style={{ fontSize: 14, color: '#E6E6E6' }}>After about 3 sessions, weights and timing fit you.</span></div>
              </div>
              {myDraft && ex.length === 0 && <p className="sub muted-on-dark">No exercises fit {atHome ? 'no equipment' : "this gym's equipment"} yet. {atHome ? 'Check the area.' : "Check the gym's equipment below."}</p>}
              <button type="button" className="btn btn-accent" disabled={!myDraft || ex.length === 0} onClick={() => navigate('/session/preview')}>See today's plan <span className="ic ic-arrow-right" aria-hidden="true" /></button>
            </section>
          ) : (
            <section className="card" aria-label="No rotation">
              <h2 className="t-h">No sessions planned</h2>
              <p className="sub">Your rotation is empty. Add a focus area to get your first session.</p>
              <Link className="btn btn-primary" to="/plan">Open plan</Link>
            </section>
          )}

          <div className="group">
            <Link className="li" to="/library"><span className="tile sm warm"><span className="ic ic-star sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Make it yours</span><span className="li-s">Star favourites, ban what you never want</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
            {gym ? (
              <Link className="li" to={`/gyms/${gym.id}`}><span className="tile sm green"><span className="ic ic-dumbbell sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Check {gym.name}'s equipment</span><span className="li-s">{tpl!.label} · {tpl!.items} items</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
            ) : (
              <Link className="li" to="/gyms"><span className="tile sm green"><span className="ic ic-dumbbell sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Add your gym</span><span className="li-s">So the plan only uses what's there</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
            )}
          </div>
        </div>
        <TabBar />
      </div>
    );
  }

  if (reached) {
    const secs = week.reduce((a, s) => a + sessionDurationSec(s), 0);
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    const vol = week.reduce((a, s) => a + s.exercises.reduce((b, e) => b + volumeOf(e), 0), 0);
    const volD = toDisplay(vol, settings.unit);
    const ups = weightIncreases(week, sessions);
    return (
      <div className="app">
        <style>{STYLE}</style>
        <div className="scroll" style={{ paddingTop: 24 }}>
          {header}
          <section className="card" aria-label="This week" style={{ alignItems: 'center', textAlign: 'center', padding: '26px 18px 20px' }}>
            <div style={{ position: 'relative', width: 168, height: 168 }}>
              <Ring count={count} goal={goal} size={168} stroke={12} label={`${count} of ${goal} sessions, goal reached`} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <span className="ic ic-check xl" style={{ color: '#FF5A1F' }} aria-hidden="true" />
                <span className="t-num" style={{ fontSize: 40 }}>{count}/{goal}</span>
              </div>
            </div>
            <div className="stack-s" style={{ alignItems: 'center' }}>
              <h2 className="t-title">Weekly goal reached</h2>
              <p className="sub">{allAreas ? 'Every area got a session. ' : ''}The counter resets Monday. Extra sessions still count.</p>
            </div>
            {strip}
          </section>

          {view.current > 0 && <StreakCard view={view} />}

          <div className="grid3">
            <div className="stat"><span className="stat-v">{h}h {String(m).padStart(2, '0')}</span><span className="stat-l">Time trained</span></div>
            <div className="stat"><span className="stat-v">{volD >= 1000 ? `${(volD / 1000).toFixed(1)}k` : Math.round(volD)}</span><span className="stat-l">{settings.unit} volume</span></div>
            <div className="stat"><span className="stat-v">{ups}</span><span className="stat-l">Weight increases</span></div>
          </div>

          {area && (
            <section className="card" aria-label="Bonus session">
              <div className="hstack">
                <span className="tile lg">{slot}</span>
                <div className="grow stack-s" style={{ gap: 2 }}>
                  <span className="eyebrow">Feeling good? Rotation continues</span>
                  <span className="t-h">{area.name}</span>
                </div>
              </div>
              <p className="sub">This would be session {bonusN} this week. It counts toward the rotation, not next week's goal.</p>
              {startBtn('Start bonus session', false)}
            </section>
          )}

          {week.length > 0 && (
            <>
              <button type="button" className="between card tight" style={{ flexDirection: 'row', textAlign: 'left', width: '100%' }} onClick={() => setRecapOpen(!recapOpen)} aria-expanded={recapOpen}>
                <span className="strong">Week recap</span>
                <span className={`ic ${recapOpen ? 'ic-chev-up' : 'ic-chev-down'}`} style={{ color: '#B5B1A8' }} aria-hidden="true" />
              </button>
              {recapOpen && weekListOf(true)}
            </>
          )}
        </div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="app">
      <style>{STYLE}</style>
      <div className="scroll" style={{ paddingTop: 24 }}>
        {header}

        {showRepair && <RepairCard view={view} slot={slot} canStart={canStart} after={after} onStart={() => navigate('/session/preview')} />}

        {showRisk && (
          <RiskCard key={`${cw.weekStart}-${cw.daysLeft}-${cw.left}`} view={view} slot={slot} canStart={canStart} after={after}
            onStart={() => navigate('/session/preview')} onExpress={() => { if (startExpress()) navigate('/session/preview'); }} />
        )}
        {showRisk && area && (
          <section className="card dark" aria-label="Next session" style={{ borderRadius: 28, padding: 20, gap: 12 }}>
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div className="stack-s"><span className="eyebrow">{chosen != null ? 'Chosen' : 'Up next'} · Session {slot}</span><h2 style={{ fontSize: 26, fontWeight: 700 }}>{area.name}</h2></div>
              <span className="tile lg accent" aria-hidden="true">{slot}</span>
            </div>
            <div className="hstack" style={{ gap: 8, fontSize: 14 }}><span className="ic ic-clock sm" style={{ color: '#A8A8A8' }} aria-hidden="true" />{planSec != null ? `≈ ${Math.round(planSec / 60)} min` : 'Planning…'} · or {EXPRESS_MIN} min express</div>
          </section>
        )}

        {showFrozen && <FrozenCard view={view} />}
        {showLost && <LostBanner view={view} />}

        {!showRepair && !showRisk && (<>
        <section className="card" aria-label="This week">
          <div className="hstack" style={{ gap: 18 }}>
            <div style={{ position: 'relative', width: 124, height: 124, flexShrink: 0 }}>
              <Ring count={count} goal={goal} size={124} stroke={13} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <span className="t-num" style={{ fontSize: 36 }}>{count}/{goal}</span>
                <span className="eyebrow" style={{ fontSize: 12 }}>sessions</span>
              </div>
            </div>
            <div className="stack-s grow">
              <span className="eyebrow">Week {isoWeek(nowMs)}</span>
              <h2 className="t-h">{onTrack ? 'On track' : 'Every session counts'}</h2>
              <p className="sub">
                {onTrack
                  ? `${plural(left, 'session')} left before Sunday. No set days.`
                  : `${plural(left, 'session')} to go with ${plural(daysLeft, 'day')} left. Fit in what you can, extra sessions carry on the rotation.`}
              </p>
            </div>
          </div>
          {strip}
          {view.current > 0 && !showFrozen && !showLost && <StreakBanner view={view} />}
        </section>

        {area ? (
          <section className="card dark" aria-label="Next session" style={{ borderRadius: 28, padding: 22, gap: 16 }}>
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div className="stack-s">
                <span className="eyebrow">{chosen != null ? 'Chosen' : 'Up next'} · Session {slot} of rotation</span>
                <h2 style={{ fontSize: 30, fontWeight: 700 }}>{area.name}</h2>
              </div>
              <span className="tile lg accent" aria-hidden="true">{slot}</span>
            </div>
            <div className="stack-s" style={{ gap: 8 }}>
              <LocationLine gym={gym} atHome={atHome} />
              <div className="hstack" style={{ gap: 8, fontSize: 14 }}>
                <span className="ic ic-clock sm" style={{ color: '#A8A8A8' }} aria-hidden="true" />
                {planSec != null ? <span>≈ {Math.round(planSec / 60)} min</span> : <span>Planning…</span>}
                <span className="muted-on-dark">· target {settings.targetMinutes} min</span>
                {myDraft?.source === 'coach' && <span className="tag" style={{ background: '#262626', color: '#E6E6E6' }}>Coach plan</span>}
              </div>
            </div>
            <div className="wrap" style={{ gap: 6 }} aria-busy={!myDraft}>
              {myDraft?.exercises.map((e) => <span className="chip dark" key={e.id}>{e.name}</span>)}
            </div>
            {myDraft && myDraft.exercises.length === 0 && <p className="sub muted-on-dark">No exercises fit {atHome ? 'no equipment' : "this gym's equipment"} yet. Check the area{atHome ? '' : " or the gym's equipment"}.</p>}
            {startBtn(`Start session ${slot}`, true)}
            {others.length > 0 && (
              <button type="button" className="btn-ghost" style={{ minHeight: 44, fontSize: 14, fontWeight: 600, color: '#E6E6E6' }} onClick={() => setPickOpen(!pickOpen)} aria-expanded={pickOpen}>
                {pickOpen ? 'Close' : 'Do a different session'}
              </button>
            )}
            {pickOpen && (
              <div className="grid3">
                {others.map((o) => (
                  <button type="button" key={o.n} style={{ background: '#262626', borderRadius: 16, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', minHeight: 64 }}
                    onClick={() => { chooseSlot(o.n); setPickOpen(false); }}>
                    <span className="t-num" style={{ fontSize: 18 }}>{o.n}</span><span style={{ fontSize: 12, color: '#E6E6E6' }}>{o.a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="card" aria-label="No rotation">
            <h2 className="t-h">No sessions planned</h2>
            <p className="sub">Your rotation is empty. Add a focus area to get your next session.</p>
            <Link className="btn btn-primary" to="/plan">Open plan</Link>
          </section>
        )}

        {trimmed && (
          <div className="banner info">
            <span className="ic ic-clock" aria-hidden="true" />
            <div><span className="b-t">Plan will trim to fit {settings.targetMinutes} min</span>Your last 3 warm-ups took {medianWarmMin} min (planned {settings.warmupTargetMinutes}), so an accessory exercise is dropped first if time runs short.</div>
          </div>
        )}

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>This week</span><Link className="link" to="/history">History</Link></div>
        {weekList || <p className="sub" style={{ padding: '0 2px' }}>No sessions yet this week.</p>}
        </>)}
      </div>
      <TabBar />
    </div>
  );
}
