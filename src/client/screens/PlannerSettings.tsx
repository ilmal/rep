import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Slider, Stepper } from '../components/Controls';
import { ScoreChip } from '../components/ScoreBars';
import { DEFAULT_PLANNER, blockedIds, scoreAll, muscleReport } from '../../shared/planner';
import { availableEquipment, isAvailable } from '../../shared/rules';
import type { PlannerConfig } from '../../shared/types';
import { updatePlanner, useCurrentGym, useLibrary, usePrefs, useRotation, useSessions, useSettings, useWeek } from '../store/actions';

type WKey = 'wRelevance' | 'wRecency' | 'wFrequency' | 'wCoverage' | 'wVariety' | 'wFavorite';
const WEIGHTS: { key: WKey; label: string; help: string }[] = [
  { key: 'wRelevance', label: 'Relevance', help: 'How much the “relevance to my plan” slider on each exercise counts.' },
  { key: 'wRecency', label: 'Recency', help: 'Prefer exercises you have not done for a while.' },
  { key: 'wFrequency', label: 'Frequency', help: 'Prefer exercises you have done fewer times lately.' },
  { key: 'wCoverage', label: 'Muscle coverage', help: 'Prefer exercises for muscles that are overdue.' },
  { key: 'wVariety', label: 'Variety', help: 'Penalise picking near-identical exercises in the same session.' },
  { key: 'wFavorite', label: 'Favorites', help: 'Boost for starred exercises.' },
];
const wLabel = (v: number) => (v === 0 ? 'Off' : v < 0.6 ? 'Low' : v < 1.3 ? 'Normal' : v < 2.2 ? 'High' : 'Very high');

type SKey = 'cooldownSessions' | 'minDaysBetween' | 'freshDays' | 'windowDays' | 'muscleOverdueDays';
const STEPS: { key: SKey; label: string; help: string; unit: string; min: number; max: number; step: number }[] = [
  { key: 'cooldownSessions', label: 'Cooldown', help: 'Skip an exercise if you did it within the last N sessions.', unit: 'sessions', min: 0, max: 10, step: 1 },
  { key: 'minDaysBetween', label: 'Min days between', help: 'Also skip it if you did it within N days.', unit: 'days', min: 0, max: 30, step: 1 },
  { key: 'freshDays', label: 'Fresh after', help: 'Days until an exercise counts as fully rested (recency 100).', unit: 'days', min: 1, max: 90, step: 1 },
  { key: 'windowDays', label: 'History window', help: 'How far back frequency and muscle coverage look.', unit: 'days', min: 7, max: 180, step: 7 },
  { key: 'muscleOverdueDays', label: 'Muscle overdue after', help: 'A muscle untrained this long counts as fully overdue.', unit: 'days', min: 2, max: 60, step: 1 },
];

export default function PlannerSettings() {
  const nav = useNavigate();
  const settings = useSettings();
  const p = settings.planner;
  const lib = useLibrary();
  const prefs = usePrefs();
  const sessions = useSessions();
  const gym = useCurrentGym();
  const rotation = useRotation();
  const week = useWeek();

  const area = rotation[week.next - 1] ?? rotation[0];
  const [picks, held] = useMemo(() => {
    if (!area) return [[], 0] as const;
    const avail = availableEquipment(gym);
    const byId = new Map(lib.map((e) => [e.id, e]));
    const poolIds = area.poolExerciseIds.length ? area.poolExerciseIds : lib.filter((e) => e.primary.some((m) => area.focusMuscles.includes(m))).map((e) => e.id);
    const now = Date.now();
    const blocked = new Set(blockedIds(prefs, now));
    const pool = poolIds.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e && !e.archived && (!gym || isAvailable(e, avail)));
    const open = pool.filter((e) => !blocked.has(e.id)); // banned and paused exercises are never picked
    return [scoreAll({ library: lib, prefs, sessions, planner: p, now, area }, open).sort((a, b) => b.total - a.total).slice(0, 8), pool.length - open.length] as const;
  }, [area, gym, lib, prefs, sessions, p]);

  const report = useMemo(() => muscleReport(sessions, lib, Date.now(), p.windowDays), [sessions, lib, p.windowDays]);
  const isDefault = (Object.keys(DEFAULT_PLANNER) as (keyof PlannerConfig)[]).every((k) => p[k] === DEFAULT_PLANNER[k]);

  return (
    <div className="app">
      <div className="topbar">
        <button type="button" className="iconbtn" aria-label="Back" onClick={() => nav(-1)}><span className="ic ic-chev-left lg" aria-hidden="true" /></button>
        <span className="title">Planner &amp; scoring</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <p className="sub" style={{ padding: '0 2px' }}>
          Every exercise gets a 0–100 score from its relevance, how long since you did it, how often you do it, whether it covers overdue muscles, and whether it is a favorite. Auto-pick areas choose the best scores, then spread them out for variety. Change the weights to steer it. Banned and paused exercises are never picked: they are left out of the preview and of every generated session.
        </p>

        <div className="section-h">Top picks for next session</div>
        <div className="group">
          {!area && <div className="li"><div className="grow"><span className="li-s">Add an area to your rotation to see a preview.</span></div></div>}
          {area && picks.length === 0 && <div className="li"><div className="grow"><span className="li-s">No exercises in {area.name} are available{gym ? ` at ${gym.name}` : ''}.</span></div></div>}
          {picks.map((s, i) => (
            <Link className="li" key={s.exerciseId} to={`/library/${s.exerciseId}`} style={{ opacity: s.avoided ? 0.55 : 1 }}>
              <span className="tile sm ink">{i + 1}</span>
              <div className="grow"><span className="li-t">{s.name}</span><span className="li-s">{s.reasons[0] ?? 'Balanced score'}</span></div>
              {s.avoided && <span className="ic ic-ban sm" aria-label="Avoided" role="img" />}
              {area?.pinnedExerciseIds.includes(s.exerciseId) && <span className="tag accent">Pinned</span>}
              <ScoreChip s={s} />
            </Link>
          ))}
        </div>
        {area && <p className="sub small" style={{ padding: '0 2px' }}>{area.name}{gym ? ` at ${gym.name}` : ''}. Pinned exercises are always included first; the preview updates as you change the knobs.{held > 0 ? ` ${held} banned or paused ${held === 1 ? 'exercise is' : 'exercises are'} left out.` : ''}</p>}

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>Weights</span><span className="sub">0 – 5</span></div>
        <div className="card" style={{ gap: 18 }}>
          {WEIGHTS.map((w) => (
            <div key={w.key} className="stack-s" style={{ gap: 0 }}>
              <div className="between"><span className="strong">{w.label}</span><span className="small strong">{p[w.key].toFixed(1)} · {wLabel(p[w.key])}</span></div>
              <Slider value={p[w.key]} min={0} max={5} step={0.1} label={`${w.label} weight`} format={(v) => `${v.toFixed(1)}, ${wLabel(v)}`} onCommit={(v) => updatePlanner({ [w.key]: Math.round(v * 10) / 10 })} />
              <span className="help">{w.help}</span>
            </div>
          ))}
        </div>

        <div className="section-h">Timing</div>
        <div className="card" style={{ gap: 0, padding: '6px 18px' }}>
          {STEPS.map((s, i) => (
            <div key={s.key}>
              {i > 0 && <div className="divider" />}
              <div className="between" style={{ minHeight: 72, gap: 12 }}>
                <div className="stack-s" style={{ gap: 2 }}><span className="strong">{s.label}</span><span className="help">{s.help}</span></div>
                <Stepper value={p[s.key]} unit={s.unit === 'days' ? 'd' : undefined} minWidth={s.unit === 'days' ? 52 : 36} decLabel={`Decrease ${s.label}`} incLabel={`Increase ${s.label}`}
                  decDisabled={p[s.key] <= s.min} incDisabled={p[s.key] >= s.max}
                  onDec={() => updatePlanner({ [s.key]: Math.max(s.min, p[s.key] - s.step) })} onInc={() => updatePlanner({ [s.key]: Math.min(s.max, p[s.key] + s.step) })} />
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="between"><span className="strong">Randomness (jitter)</span><span className="small strong">{p.jitter.toFixed(2)} · {p.jitter === 0 ? 'Deterministic' : p.jitter < 0.3 ? 'Subtle' : p.jitter < 0.7 ? 'Mixed' : 'Wild'}</span></div>
          <Slider value={p.jitter} min={0} max={2} step={0.05} label="Randomness" format={(v) => v.toFixed(2)} onCommit={(v) => updatePlanner({ jitter: Math.round(v * 100) / 100 })} />
          <span className="help">0 always picks the same top scores; higher shuffles close calls so sessions feel fresh.</span>
        </div>

        <button type="button" className="btn btn-secondary" disabled={isDefault} onClick={() => updatePlanner({ ...DEFAULT_PLANNER })}><span className="ic ic-undo" aria-hidden="true" />Reset to defaults</button>

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>Muscle coverage</span><span className="sub">Days since trained</span></div>
        {sessions.every((s) => s.status !== 'completed') ? (
          <p className="sub small" style={{ padding: '0 2px' }}>Finish a session and this shows which muscles are due.</p>
        ) : (
          <div className="group">
            {report.map((r) => {
              const d = r.lastTrainedDaysAgo;
              const pct = d == null ? 100 : Math.min(100, (d / p.muscleOverdueDays) * 100);
              const overdue = d == null || d >= p.muscleOverdueDays;
              return (
                <div className="li" key={r.muscle} style={{ gap: 12 }}>
                  <div className="grow stack-s" style={{ gap: 6 }}>
                    <div className="between"><span className="li-t">{r.muscle}</span><span className="li-s">{d == null ? 'Never' : d < 1 ? 'Today' : `${Math.round(d)} d ago`} · {r.sets} sets</span></div>
                    <div className="track thin" role="img" aria-label={`${r.muscle}: ${d == null ? 'never trained' : `${Math.round(d)} days since trained`}`}><div className={`fillbar${overdue ? ' accent' : ' green'}`} style={{ width: `${pct}%` }} /></div>
                  </div>
                  {overdue && <span className="tag accent">Due</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
