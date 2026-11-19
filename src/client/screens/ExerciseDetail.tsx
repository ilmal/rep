import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Slider, Stepper } from '../components/Controls';
import { ScoreBars } from '../components/ScoreBars';
import PauseSheet from '../components/PauseSheet';
import { ExerciseGuide } from '../components/ExerciseGuide';
import { useExerciseContent } from '../store/x-content';
import Toast from '../components/Toast';
import { EQUIP_BY_ID } from '../../shared/catalog';
import { prefOf, scoreExercise, statusOf, PAUSE_FOREVER } from '../../shared/planner';
import { availableEquipment, exerciseHistory, exerciseSeconds, isAvailable, missingEquipment, rankAlternatives, topWeight, volumeOf } from '../../shared/rules';
import type { Exercise, SessionExercise, Unit } from '../../shared/types';
import { archiveExercise, banExercise, pauseExercise, setPref, toggleFavorite, useAllLibrary, useGyms, usePrefs, useSessions, useSettings } from '../store/actions';
import { useStore } from '../store/core';
import { useNow } from '../lib/hooks';
import { dateShort, dayShort, fmtLoad, mmss, rxLine, toDisplay } from '../lib/format';

type Metric = 'top' | 'volume' | 'time';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const DIFF = { 1: 'Easy', 2: 'Medium', 3: 'Advanced' } as const;
const TRACK = { weight_reps: 'Weight × reps', reps: 'Reps only', time: 'Time' } as const;

const bestSetValue = (ex: Exercise, e: SessionExercise): number => {
  if (ex.tracking === 'weight_reps') return topWeight(e);
  if (ex.tracking === 'reps') return e.sets.reduce((m, s) => Math.max(m, s.reps), 0);
  return e.sets.reduce((m, s) => Math.max(m, s.seconds ?? s.reps), 0);
};
const volumeValue = (ex: Exercise, e: SessionExercise): number => {
  if (ex.tracking === 'weight_reps') return volumeOf(e);
  if (ex.tracking === 'reps') return e.sets.reduce((a, s) => a + s.reps, 0);
  return e.sets.reduce((a, s) => a + (s.seconds ?? s.reps), 0);
};

const CSS = `
.bars{display:flex;align-items:flex-end;gap:8px;height:130px;padding-top:18px}
.bar{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}
.bar i{display:block;width:100%;border-radius:8px 8px 4px 4px;background:#D6D3CC}
.bar.last i{background:#FF5A1F}
.bar span{font-size:11px;color:#6B6B6B;font-weight:600}
.bar b{font-size:11px;font-weight:700}
.labels{display:grid;grid-template-columns:110px 1fr;gap:10px 12px;font-size:14px;align-items:start}
.labels dt{color:#6B6B6B}
.labels dd{margin:0;display:flex;flex-wrap:wrap;gap:6px;min-width:0}
`;

function fbText(e: SessionExercise): string {
  const f = e.feedback;
  if (!f) return 'No feedback recorded';
  const effort = { chill: 'Chill today', normal: 'Normal effort', hard: 'Trying hard' }[f.effort];
  const weight = { light: 'too light', right: 'just right', heavy: 'too heavy' }[f.weight];
  const volume = { reps: 'too many reps', sets: 'too many sets', ok: 'right volume' }[f.volume];
  return `${effort} · ${weight} · ${volume}`;
}

export default function ExerciseDetail() {
  const { id = '' } = useParams();
  const all = useAllLibrary();
  const ex = useMemo(() => all.find((e) => e.id === id), [all, id]);
  if (!ex) {
    return (
      <div className="app">
        <div className="topbar"><Link className="iconbtn" to="/library" aria-label="Back to library"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link><span className="title" /><span className="spacer" /></div>
        <div className="scroll"><div className="empty"><div className="empty-ic"><span className="ic ic-search xl" aria-hidden="true" /></div><h2 className="t-h">Exercise not found</h2><Link className="btn btn-primary btn-sm" to="/library">Open library</Link></div></div>
      </div>
    );
  }
  return <Detail key={ex.id} ex={ex} all={all} />;
}

function Detail({ ex, all }: { ex: Exercise; all: Exercise[] }) {
  const nav = useNavigate();
  const settings = useSettings();
  const unit: Unit = settings.unit;
  const sessions = useSessions();
  const prefs = usePrefs();
  const gyms = useGyms();
  const progress = useStore((s) => s.progress[ex.id]);
  const progressAll = useStore((s) => s.progress);
  const pref = prefOf(prefs, ex.id);
  const { userContent } = useExerciseContent(ex);
  const [metric, setMetric] = useState<Metric>('top');
  const [notes, setNotes] = useState(pref.notes ?? '');
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);
  const nowMs = useNow(30000);
  const status = statusOf(pref, nowMs);
  useEffect(() => { setNotes(pref.notes ?? ''); }, [pref.notes]);

  const live = useMemo(() => all.filter((e) => !e.archived), [all]);
  const hist = useMemo(() => exerciseHistory(sessions, ex.id), [sessions, ex.id]);
  const last8 = hist.slice(-8);
  const score = useMemo(() => scoreExercise({ library: live, prefs, sessions, planner: settings.planner, now: Date.now() }, ex), [live, prefs, sessions, settings.planner, ex]);

  // metric values (internally kg / reps / seconds)
  const weighted = ex.tracking === 'weight_reps';
  const vals = last8.map((h) => (metric === 'top' ? bestSetValue(ex, h.ex) : metric === 'volume' ? volumeValue(ex, h.ex) : exerciseSeconds(h.ex) / 60));
  const shown = vals.map((v) => (weighted && metric !== 'time' ? toDisplay(v, unit) : Math.round(v * 10) / 10));
  const unitLabel = metric === 'time' ? 'min' : ex.tracking === 'weight_reps' ? unit : ex.tracking === 'reps' ? 'reps' : 's';
  const fmtVal = (v: number) => (metric === 'time' ? mmss(v * 60) : `${v.toLocaleString()} ${unitLabel}`);
  const max = Math.max(0, ...shown), min = Math.min(...shown, max);
  const latest = shown[shown.length - 1];
  const diff = shown.length > 1 ? latest - shown[0] : 0;
  const improved = metric === 'time' ? diff <= 0 : diff >= 0;
  const deltaText = shown.length < 2 ? 'First session'
    : metric === 'time' ? `${diff <= 0 ? '−' : '+'}${mmss(Math.abs(diff) * 60)} over ${shown.length} sessions`
      : `${diff >= 0 ? '+' : '−'}${Math.abs(Math.round(diff * 10) / 10).toLocaleString()} ${unitLabel} over ${shown.length} sessions`;
  const metrics: [Metric, string][] = [['top', weighted ? 'Top weight' : ex.tracking === 'reps' ? 'Top reps' : 'Best hold'], ['volume', 'Volume'], ['time', 'Time']];

  const lastEntry = hist[hist.length - 1];
  const sub = lastEntry
    ? `Last done ${dayShort(lastEntry.session.endedAt ?? lastEntry.session.startedAt)} · ${rxLine(lastEntry.ex.sets.length, lastEntry.ex.sets[lastEntry.ex.sets.length - 1].reps, topWeight(lastEntry.ex), unit, ex.tracking, ex.perHand)}${lastEntry.ex.feedback ? ` · felt ${{ light: 'too light', right: 'just right', heavy: 'too heavy' }[lastEntry.ex.feedback.weight]}` : ''}`
    : 'Not done yet';

  const pausedText = pref.pausedUntil != null && pref.pausedUntil > nowMs
    ? (pref.pausedUntil >= PAUSE_FOREVER ? 'until you resume' : `until ${dateShort(pref.pausedUntil)}`)
    : 'for the next session';
  const recent = hist.slice(-5).reverse();
  const cooldownDefault = settings.planner.cooldownSessions;
  const daysDefault = settings.planner.minDaysBetween;
  const cd = pref.cooldownSessions, md = pref.minDaysBetween;

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="topbar">
        <Link className="iconbtn" to="/library" aria-label="Back to library"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title" />
        <Link className="iconbtn" to={`/exercise/${ex.id}/edit`} aria-label="Edit exercise"><span className="ic ic-edit" aria-hidden="true" /></Link>
      </div>
      <div className="scroll" style={{ paddingTop: 0, paddingBottom: 40 }}>
        <div className="stack-s" style={{ padding: '0 2px' }}>
          <h1 className="t-display">{ex.name}</h1>
          <p className="sub">{sub}</p>
        </div>
        <div className="grid3">
          <button type="button" className={`btn btn-sm ${pref.favorite ? 'btn-primary' : 'btn-secondary'}`} style={{ width: '100%', padding: '0 8px' }} aria-pressed={pref.favorite} onClick={() => { toggleFavorite(ex.id); setSheet(false); }}><span className={`ic ${pref.favorite ? 'ic-star-fill' : 'ic-star'} sm`} aria-hidden="true" />Favourite</button>
          <button type="button" className="btn btn-sm btn-secondary" style={{ width: '100%', padding: '0 8px' }} onClick={() => { if (status === 'paused') pauseExercise(ex.id, { resume: true }); else setSheet(true); }}><span className={`ic ${status === 'paused' ? 'ic-play' : 'ic-pause-c'} sm`} aria-hidden="true" />{status === 'paused' ? 'Resume' : 'Pause'}</button>
          <button type="button" className="btn btn-sm btn-danger-soft" style={{ width: '100%', padding: '0 8px' }} onClick={() => banExercise(ex.id, status !== 'banned')}><span className="ic ic-ban sm" aria-hidden="true" />{status === 'banned' ? 'Unban' : 'Ban'}</button>
        </div>
        {status !== 'ready' && (
          <div className={`banner ${status === 'favorite' ? 'ok' : status === 'paused' ? 'warn' : 'error'}`}>
            <span className={`ic ${status === 'favorite' ? 'ic-star-fill' : status === 'paused' ? 'ic-pause-c' : 'ic-ban'}`} aria-hidden="true" />
            <div><span className="b-t">{status === 'favorite' ? 'Favourite' : status === 'banned' ? 'Banned' : `Paused ${pausedText}`}</span>{status === 'favorite' ? 'Picked first when it fits the area, gym and time.' : status === 'paused' ? 'Not planned or swapped in. Your history is kept.' : 'Never planned, generated or offered as a swap. History is kept.'}</div>
          </div>
        )}
        {ex.archived && (
          <div className="banner info"><span className="ic ic-info" aria-hidden="true" /><div>This exercise is archived and hidden from the library and planner.</div><button type="button" className="banner-act" onClick={() => archiveExercise(ex.id, false)}>Restore</button></div>
        )}

        <div className="card" id="how-to" data-testid="how-to-card">
          <div className="between"><h2 className="t-h" style={{ fontSize: 17 }}>How to</h2>{userContent && <span className="tag blue" data-testid="your-edits">Your edits</span>}</div>
          <ExerciseGuide ex={ex} />
        </div>

        {hist.length === 0 ? (
          <div className="card"><span className="strong">History</span><p className="sub">No completed sets yet. Progress charts appear after your first session with this exercise.</p></div>
        ) : (
          <div className="card">
            <div className="seg c3" role="group" aria-label="Metric">
              {metrics.map(([k, label]) => <button type="button" key={k} className={metric === k ? 'on' : ''} aria-pressed={metric === k} onClick={() => setMetric(k)}>{label}</button>)}
            </div>
            <div className="between" style={{ alignItems: 'baseline' }}>
              <span className="t-num" style={{ fontSize: 32 }}>{fmtVal(latest)}</span>
              <span className={`tag ${improved && shown.length > 1 ? 'green' : ''}`}>{deltaText}</span>
            </div>
            <div className="bars" role="img" aria-label={`Last ${shown.length} sessions, ${metrics.find((m) => m[0] === metric)![1]}`}>
              {shown.map((v, i) => {
                const h = 30 + (max === min ? 70 : ((v - min) / (max - min)) * 70);
                const label = metric === 'volume' && v >= 1000 ? `${Math.round(v / 100) / 10}k` : metric === 'time' ? mmss(v * 60) : String(v);
                const t = last8[i].session.endedAt ?? last8[i].session.startedAt;
                return (
                  <div key={i} className={`bar${i === shown.length - 1 ? ' last' : ''}`}>
                    <b>{label}</b><i style={{ height: `${h}%` }} /><span>{new Date(t).getDate()}/{new Date(t).getMonth() + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {progress && (
          <div className="card banner-like" style={{ flexDirection: 'row', gap: 12, alignItems: 'center', background: '#121212', color: '#fff' }}>
            <span className="tile sm accent"><span className="ic ic-arrow-up sm" aria-hidden="true" /></span>
            <div className="grow stack-s" style={{ gap: 2 }}><span className="small" style={{ color: '#A8A8A8' }}>Next time</span><span className="strong">{rxLine(progress.sets, progress.reps, progress.weight, unit, ex.tracking, ex.perHand)}</span></div>
            {progress.lastRec && <span className="small" style={{ color: '#A8A8A8' }}>{progress.lastRec.tag}</span>}
          </div>
        )}

        <div className="card">
          <div className="between">
            <span className="strong">Planner score</span>
            <span className="t-num" style={{ fontSize: 28 }}>{Math.round(score.total)}<span className="unit">/100</span></span>
          </div>
          <ScoreBars s={score} />
          {score.reasons.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {score.reasons.map((r) => <li key={r} className="small sub">{r}</li>)}
            </ul>
          )}
        </div>

        <div className="card">
          <span className="strong">Coach tuning</span>
          <div className="stack-s" style={{ gap: 2 }}>
            <div className="between"><span className="strong">Relevance to my plan</span><span className="small strong">{Math.round(pref.relevance)}</span></div>
            <Slider value={pref.relevance} min={0} max={100} step={5} label="Relevance to my plan" onCommit={(v) => setPref(ex.id, { relevance: v })} />
            <span className="help">How much this fits your goals. Higher means it is picked more often.</span>
          </div>
          <div className="divider" />
          <div className="between">
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">Cooldown</span><span className="sub">{cd == null ? `Default · ${cooldownDefault} session${cooldownDefault === 1 ? '' : 's'}` : 'Skip if done in the last N sessions'}</span></div>
            <Stepper value={cd == null ? 'Default' : cd} minWidth={cd == null ? 64 : 36} decLabel="Fewer cooldown sessions" incLabel="More cooldown sessions" decDisabled={cd != null && cd <= 0}
              onDec={() => setPref(ex.id, { cooldownSessions: Math.max(0, (cd ?? cooldownDefault) - 1) })} onInc={() => setPref(ex.id, { cooldownSessions: Math.min(10, (cd ?? cooldownDefault) + 1) })} />
          </div>
          {cd != null && <button type="button" className="link small" style={{ alignSelf: 'flex-start', minHeight: 32 }} onClick={() => setPref(ex.id, { cooldownSessions: undefined })}>Use default</button>}
          <div className="between">
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">Min days between</span><span className="sub">{md == null ? `Default · ${daysDefault} d` : 'Days before it can return'}</span></div>
            <Stepper value={md == null ? 'Default' : md} minWidth={md == null ? 64 : 36} decLabel="Fewer days" incLabel="More days" decDisabled={md != null && md <= 0}
              onDec={() => setPref(ex.id, { minDaysBetween: Math.max(0, (md ?? daysDefault) - 1) })} onInc={() => setPref(ex.id, { minDaysBetween: Math.min(30, (md ?? daysDefault) + 1) })} />
          </div>
          {md != null && <button type="button" className="link small" style={{ alignSelf: 'flex-start', minHeight: 32 }} onClick={() => setPref(ex.id, { minDaysBetween: undefined })}>Use default</button>}
          <div className="divider" />
          <label className="field">
            <span className="strong">Notes</span>
            <textarea className="input" rows={3} value={notes} placeholder="Cues, injuries, preferences…" style={{ padding: '12px 16px', minHeight: 88, resize: 'vertical' }}
              onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (pref.notes ?? '')) setPref(ex.id, { notes }); }} />
          </label>
        </div>

        <div className="card">
          <span className="strong">Labels</span>
          <dl className="labels" style={{ margin: 0 }}>
            {([
              ['Primary', ex.primary.map((m) => <span key={m} className="tag ink">{m}</span>)],
              ['Secondary', ex.secondary.length ? ex.secondary.map((m) => <span key={m} className="tag">{m}</span>) : [<span key="n" className="sub">None</span>]],
              ['Equipment', ex.equipment.length ? ex.equipment.map((q) => <span key={q} className="tag outline">{EQUIP_BY_ID[q]?.name ?? q}</span>) : [<span key="n" className="tag outline">Bodyweight</span>]],
              ['Pattern', [<span key="p" className="tag">{cap(ex.pattern)}</span>]],
              ['Difficulty', [<span key="d" className="tag">{DIFF[ex.difficulty]}</span>]],
              ['Tracking', [<span key="t" className="tag">{TRACK[ex.tracking]}{ex.tracking === 'weight_reps' ? ` · ${fmtLoad(ex.weightStep, unit)} steps` : ''}</span>]],
              ['Rep range', [<span key="r" className="tag">{ex.repMin}–{ex.repMax}{ex.tracking === 'time' ? ' s' : ' reps'} · {ex.defaultSets} sets{ex.perHand ? ' · per hand' : ''}</span>]],
            ] as [string, React.ReactNode[]][]).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>

        {gyms.length > 0 && (
          <>
            <div className="section-h">Gyms</div>
            <div className="group">
              {gyms.map((g) => {
                const avail = availableEquipment(g);
                const ok = isAvailable(ex, avail);
                const alt = ok ? null : rankAlternatives(ex, live, avail, [], progressAll, sessions, 1)[0];
                const miss = missingEquipment(ex, avail).map((q) => EQUIP_BY_ID[q]?.name ?? q).join(', ');
                return (
                  <div className="li" key={g.id}>
                    <span className={`dot ${ok ? 'green' : 'red'}`} />
                    <div className="grow"><span className="li-t">{g.name}</span><span className="li-s">{ok ? 'Available' : `No ${miss.toLowerCase()}${alt ? ` → swaps to ${alt.exercise.name} (${alt.match}%)` : ''}`}</span></div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="section-h">Recent feedback</div>
        {recent.length === 0 ? <p className="sub small" style={{ padding: '0 2px' }}>Nothing recorded yet.</p> : (
          <div className="group">
            {recent.map((h) => {
              const rec = h.ex.recommendation;
              const t = h.session.endedAt ?? h.session.startedAt;
              const up = rec && (rec.kind === 'weight_up' || rec.kind === 'rep_up' || rec.kind === 'tempo' || rec.kind === 'harder');
              return (
                <Link key={h.ex.id + h.session.id} className="li" to={`/history/${h.session.id}`}>
                  <div className="grow"><span className="li-t">{dateShort(t)} · {rxLine(h.ex.sets.length, h.ex.sets[h.ex.sets.length - 1].reps, topWeight(h.ex), unit, ex.tracking, ex.perHand)}</span><span className="li-s">{fbText(h.ex)}</span></div>
                  {rec && <span className={`tag ${up ? 'green' : ''}`}>{rec.tag}</span>}
                </Link>
              );
            })}
          </div>
        )}

        {!ex.archived && (
          <button type="button" className="btn btn-danger-soft" style={{ marginTop: 8 }} onClick={() => { archiveExercise(ex.id, true); nav('/library'); }}><span className="ic ic-trash" aria-hidden="true" />Archive exercise</button>
        )}
      </div>
      {sheet && <PauseSheet exerciseId={ex.id} name={ex.name} onClose={() => setSheet(false)} onDone={setToast} />}
      <Toast msg={toast} bottom={30} />
    </div>
  );
}
