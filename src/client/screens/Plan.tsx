import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getState } from '../store/core';
import TabBar from '../components/TabBar';
import { Stepper } from '../components/Controls';
import { AREA_TEMPLATES, areaFromTemplate } from '../../shared/exercises';
import { isoWeek, warmupMedianSec } from '../../shared/rules';
import { statusOf } from '../../shared/planner';
import type { Area } from '../../shared/types';
import { newAreaId, saveArea, setRotation, updateSettings, useAreas, useLibrary, usePrefs, useRotation, useSessions, useSettings, useWeek } from '../store/actions';

const MAX_AREAS = 7;

function areaMeta(a: Area) {
  const pinned = a.pinnedExerciseIds.length;
  const mode = a.mode === 'auto' ? 'auto-pick' : 'fixed list';
  return `${a.exercisesPerSession} exercise${a.exercisesPerSession === 1 ? '' : 's'} · ${mode}${a.mode === 'auto' && pinned ? ` · ${pinned} pinned` : ''}`;
}

export default function Plan() {
  const nav = useNavigate();
  const settings = useSettings();
  const rotation = useRotation();
  const areas = useAreas();
  const week = useWeek();
  const sessions = useSessions();
  const library = useLibrary();
  const [adding, setAdding] = useState(false);

  const warmAvg = useMemo(() => warmupMedianSec(sessions), [sessions]);
  const prefs = usePrefs();
  const counts = useMemo(() => {
    const t = Date.now();
    const c = { favorite: 0, paused: 0, banned: 0 };
    for (const e of library) {
      const st = statusOf(prefs[e.id] ?? { exerciseId: e.id, favorite: false, avoid: false, relevance: 50 }, t);
      if (st === 'favorite') c.favorite++; else if (st === 'paused') c.paused++; else if (st === 'banned') c.banned++;
    }
    return c;
  }, [library, prefs]);
  const n = rotation.length;
  const goal = settings.weeklyGoal;
  const ids = rotation.map((a) => a.id);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const l = [...ids];
    [l[i], l[j]] = [l[j], l[i]];
    setRotation(l);
  };

  const leftover = areas.filter((a) => !ids.includes(a.id));
  const templates = AREA_TEMPLATES.filter((t) => !rotation.some((a) => a.name === t.name));

  const addExisting = (a: Area) => { setRotation([...ids, a.id]); setAdding(false); };
  const addTemplate = (name: string) => {
    const t = AREA_TEMPLATES.find((x) => x.name === name);
    if (!t) return;
    const a = areaFromTemplate(t, newAreaId());
    saveArea(a);
    setRotation([...ids, a.id]);
    setAdding(false);
  };
  const addBlank = () => {
    const a: Area = { id: newAreaId(), name: 'New area', focusMuscles: [], exercisesPerSession: 5, mode: 'auto', pinnedExerciseIds: [], poolExerciseIds: [] };
    saveArea(a);
    setRotation([...ids, a.id]);
    setAdding(false);
    nav(`/plan/area/${a.id}`);
  };

  const mismatchText = n > goal
    ? `Your rotation has ${n} areas but the goal is ${goal} a week, so a full cycle takes more than a week. That’s fine: numbering just continues.`
    : `Goal is ${goal} but rotation has ${n} areas, so some areas repeat within a week.`;

  return (
    <div className="app">
      <div className="scroll" style={{ paddingTop: 24 }}>
        <div className="stack-s" style={{ padding: '0 2px 4px' }}>
          <span className="eyebrow">Week {isoWeek(Date.now())} · {week.count} of {goal} done</span>
          <h1 className="t-display">Plan</h1>
        </div>

        <div className="card" style={{ gap: 0, padding: '6px 18px' }}>
          <div className="between" style={{ minHeight: 64 }}>
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">Weekly goal</span><span className="sub">Sessions per week</span></div>
            <Stepper value={goal} minWidth={36} decLabel="Fewer sessions" incLabel="More sessions" decDisabled={goal <= 1} incDisabled={goal >= 7}
              onDec={() => updateSettings({ weeklyGoal: Math.max(1, getState().settings.weeklyGoal - 1) })} onInc={() => updateSettings({ weeklyGoal: Math.min(7, getState().settings.weeklyGoal + 1) })} />
          </div>
          <div className="divider" />
          <div className="between" style={{ minHeight: 64 }}>
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">Target time</span><span className="sub">Warm-up included</span></div>
            <Stepper value={settings.targetMinutes} unit="min" minWidth={64} decLabel="Less time" incLabel="More time" decDisabled={settings.targetMinutes <= 20} incDisabled={settings.targetMinutes >= 150}
              onDec={() => updateSettings({ targetMinutes: Math.max(20, getState().settings.targetMinutes - 5) })} onInc={() => updateSettings({ targetMinutes: Math.min(150, getState().settings.targetMinutes + 5) })} />
          </div>
          <div className="divider" />
          <div className="between" style={{ minHeight: 64 }}>
            <div className="stack-s" style={{ gap: 2 }}>
              <span className="strong">Warm-up</span>
              {warmAvg != null && <span className="sub">Avg last 5: {Math.max(1, Math.round(warmAvg / 60))} min</span>}
            </div>
            <Stepper value={settings.warmupTargetMinutes} unit="min" minWidth={64} decLabel="Shorter warm-up" incLabel="Longer warm-up" decDisabled={settings.warmupTargetMinutes <= 0} incDisabled={settings.warmupTargetMinutes >= 30}
              onDec={() => updateSettings({ warmupTargetMinutes: Math.max(0, getState().settings.warmupTargetMinutes - 1) })} onInc={() => updateSettings({ warmupTargetMinutes: Math.min(30, getState().settings.warmupTargetMinutes + 1) })} />
          </div>
        </div>

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>Rotation</span>{n > 0 && <span className="sub">Loops 1 → {n} → 1</span>}</div>
        {n === 0 ? (
          <div className="empty">
            <div className="empty-ic"><span className="ic ic-list xl" aria-hidden="true" /></div>
            <h2 className="t-h">No areas yet</h2>
            <p className="sub">Add the body areas you train. Sessions rotate through them in order.</p>
          </div>
        ) : (
          <div className="group">
            {rotation.map((a, i) => {
              const isNext = week.next === i + 1;
              return (
                <div className="li" key={a.id} style={{ paddingLeft: 8, gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button type="button" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => move(i, -1)} style={{ width: 32, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6B6B', opacity: i === 0 ? 0.35 : 1 }}><span className="ic ic-chev-up sm" aria-hidden="true" /></button>
                    <button type="button" aria-label={`Move ${a.name} down`} disabled={i === n - 1} onClick={() => move(i, 1)} style={{ width: 32, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6B6B', opacity: i === n - 1 ? 0.35 : 1 }}><span className="ic ic-chev-down sm" aria-hidden="true" /></button>
                  </div>
                  <Link to={`/plan/area/${a.id}`} className="hstack grow" style={{ gap: 12, minHeight: 48 }}>
                    <span className={`tile ${isNext ? 'accent' : 'ink'}`}>{i + 1}</span>
                    <span className="grow stack-s" style={{ gap: 2 }}><span className="li-t">{a.name}</span><span className="li-s">{areaMeta(a)}</span></span>
                    {isNext && <span className="tag accent">Next</span>}
                    <span className="ic ic-chev-right chev" aria-hidden="true" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className="btn btn-secondary" disabled={n >= MAX_AREAS} onClick={() => setAdding(true)}><span className="ic ic-plus" aria-hidden="true" />Add area to rotation</button>
        {n > 0 && n !== goal && <div className="banner info"><span className="ic ic-info" aria-hidden="true" /><div>{mismatchText}</div></div>}

        <div className="section-h">Exercises</div>
        <div className="group">
          <Link className="li" to="/library"><span className="tile sm"><span className="ic ic-dumbbell sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Exercise library</span><span className="li-s">{library.length} exercises · browse by muscle or equipment</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
          <Link className="li" to="/library/exclusions"><span className="tile sm warm"><span className="ic ic-star sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Favourites, paused &amp; banned</span><span className="li-s">{counts.favorite} favourites · {counts.paused} paused · {counts.banned} banned</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
          <Link className="li" to="/exercise/new"><span className="tile sm"><span className="ic ic-plus sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Create exercise</span><span className="li-s">With muscles, equipment and pattern labels</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
          <Link className="li" to="/plan/planner"><span className="tile sm"><span className="ic ic-sparkle sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Planner &amp; scoring</span><span className="li-s">How exercises are picked: recency, relevance, coverage, favorites · cooldown {settings.planner.cooldownSessions} session{settings.planner.cooldownSessions === 1 ? '' : 's'} / {settings.planner.minDaysBetween} d</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
        </div>
      </div>

      {adding && (
        <>
          <button type="button" className="scrim" aria-label="Close" onClick={() => setAdding(false)} />
          <div className="sheet" role="dialog" aria-label="Add area to rotation">
            <div className="grabber" />
            <h2 className="t-h">Add area</h2>
            {leftover.length > 0 && (
              <>
                <span className="eyebrow">Your areas</span>
                <div className="group">
                  {leftover.map((a) => (
                    <button type="button" key={a.id} className="li" style={{ textAlign: 'left', width: '100%' }} onClick={() => addExisting(a)}>
                      <div className="grow"><span className="li-t">{a.name}</span><span className="li-s">{areaMeta(a)}</span></div>
                      <span className="ic ic-plus sm" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </>
            )}
            {templates.length > 0 && (
              <>
                <span className="eyebrow">Templates</span>
                <div className="group">
                  {templates.map((t) => (
                    <button type="button" key={t.name} className="li" style={{ textAlign: 'left', width: '100%' }} onClick={() => addTemplate(t.name)}>
                      <div className="grow"><span className="li-t">{t.name}</span><span className="li-s">{t.desc} · {t.pool.length} exercises</span></div>
                      <span className="ic ic-plus sm" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </>
            )}
            <button type="button" className="btn btn-secondary" onClick={addBlank}><span className="ic ic-edit" aria-hidden="true" />Blank area</button>
          </div>
        </>
      )}
      <TabBar />
    </div>
  );
}
