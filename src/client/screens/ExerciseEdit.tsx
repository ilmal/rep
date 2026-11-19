import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Stepper } from '../components/Controls';
import { EQUIPMENT, EQUIP_CATEGORIES } from '../../shared/catalog';
import { ALL_MUSCLES, ALL_PATTERNS } from '../../shared/exercises';
import type { Exercise, Muscle, Pattern, Tracking } from '../../shared/types';
import { saveExercise, useAllLibrary, usePrefs } from '../store/actions';
import { saveExerciseContent } from '../store/x-content';
import { contentFor, defaultContent } from '../../shared/content';
import ContentEditor, { draftFrom, overrideFrom } from '../components/ContentEditor';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const DIFFS: [1 | 2 | 3, string][] = [[1, 'Easy'], [2, 'Medium'], [3, 'Advanced']];
const TRACKS: [Tracking, string][] = [['weight_reps', 'Weight × reps'], ['reps', 'Reps only'], ['time', 'Time']];

export default function ExerciseEdit() {
  const { id } = useParams();
  const all = useAllLibrary();
  const existing = id ? all.find((e) => e.id === id) : undefined;
  if (id && !existing) {
    return (
      <div className="app">
        <div className="topbar"><Link className="iconbtn" to="/library" aria-label="Cancel"><span className="ic ic-x lg" aria-hidden="true" /></Link><span className="title">Edit exercise</span><span className="spacer" /></div>
        <div className="scroll"><div className="empty"><div className="empty-ic"><span className="ic ic-search xl" aria-hidden="true" /></div><h2 className="t-h">Exercise not found</h2><Link className="btn btn-primary btn-sm" to="/library">Open library</Link></div></div>
      </div>
    );
  }
  return <Form key={existing?.id ?? 'new'} existing={existing} />;
}

function Form({ existing }: { existing?: Exercise }) {
  const [params] = useSearchParams();
  const [name, setName] = useState(existing?.name ?? params.get('name') ?? '');
  const [primary, setPrimary] = useState<Muscle[]>(existing?.primary ?? []);
  const [secondary, setSecondary] = useState<Muscle[]>(existing?.secondary ?? []);
  const [equipment, setEquipment] = useState<string[]>(existing?.equipment ?? []);
  const [pattern, setPattern] = useState<Pattern | null>(existing?.pattern ?? null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(existing?.difficulty ?? 2);
  const [tracking, setTracking] = useState<Tracking>(existing?.tracking ?? 'weight_reps');
  const [weightStep, setWeightStep] = useState(existing?.weightStep ?? 2.5);
  const [repMin, setRepMin] = useState(existing?.repMin ?? 8);
  const [repMax, setRepMax] = useState(existing?.repMax ?? 12);
  const [sets, setSets] = useState(existing?.defaultSets ?? 3);
  const [perHand, setPerHand] = useState(!!existing?.perHand);
  const [prehab, setPrehab] = useState(!!existing?.prehab);
  const [cue, setCue] = useState(existing?.cue ?? '');
  const prefs = usePrefs();
  const dflt = existing ? defaultContent(existing) : {};
  const [draft, setDraft] = useState(() => draftFrom(existing ? contentFor(existing, prefs[existing.id]) : {}));
  const [tried, setTried] = useState(false);
  const { hash } = useLocation();
  useEffect(() => { if (hash === '#how-to') document.getElementById('how-to')?.scrollIntoView({ block: 'start' }); }, [hash]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const curId = existing?.id ?? savedId ?? '';

  const labelSnap = JSON.stringify([name, primary, secondary, equipment, pattern, difficulty, tracking, weightStep, repMin, repMax, sets, perHand, prehab, cue]);
  const [labelSnap0] = useState(labelSnap);
  const snap = labelSnap + JSON.stringify(draft);
  const [savedSnap, setSavedSnap] = useState<string | null>(null);
  const showSaved = savedId !== null && savedSnap === snap;
  const nameBad = !name.trim();
  const primBad = primary.length === 0;
  const patBad = !pattern;
  const toggle = <T,>(list: T[], set: (l: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const stepOptions = [...new Set([1, 2.5, 5, weightStep])].sort((a, b) => a - b);
  const isTime = tracking === 'time';
  const repStep = isTime ? 5 : 1;
  const lo = isTime ? 5 : 1, hi = isTime ? 600 : 100;

  const save = () => {
    setTried(true);
    if (nameBad || primBad || patBad || !pattern) return;
    const ex: Exercise = {
      ...(existing ?? {}),
      id: curId,
      name: name.trim(),
      primary,
      secondary: secondary.filter((m) => !primary.includes(m)),
      equipment,
      pattern,
      difficulty,
      tracking,
      weightStep: tracking === 'reps' ? existing?.weightStep ?? 0 : weightStep,
      repMin, repMax, defaultSets: sets,
      perHand: tracking === 'reps' ? false : perHand,
      prehab,
      cue: cue.trim() || undefined,
      // built-ins are saved as a personal override copy that keeps the built-in id
      isCustom: existing ? existing.isCustom ?? false : true,
    };
    // a built-in whose labels are untouched must not get a personal label copy just because its how-to changed
    const id = existing && !existing.isCustom && labelSnap === labelSnap0 ? existing.id : saveExercise(ex);
    saveExerciseContent(id, overrideFrom(draft, dflt));
    setSavedId(id); setSavedSnap(snap);
  };

  const chips = <T extends string>(opts: readonly T[], on: T[], pick: (v: T) => void, label: (v: T) => string = (v) => v, group?: string) => (
    <div className="wrap" role={group ? 'group' : undefined} aria-label={group}>{opts.map((o) => <button type="button" key={o} className={`chip${on.includes(o) ? ' on' : ''}`} aria-pressed={on.includes(o)} onClick={() => pick(o)}>{label(o)}</button>)}</div>
  );

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to={existing ? `/library/${existing.id}` : '/library'} aria-label="Cancel"><span className="ic ic-x lg" aria-hidden="true" /></Link>
        <span className="title">{existing ? 'Edit exercise' : 'New exercise'}</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 130 }}>
        {existing && !existing.isCustom && <div className="banner info"><span className="ic ic-info" aria-hidden="true" /><div>This is a built-in exercise. Saving creates your personal version of it; the original is untouched.</div></div>}
        <label className="field">
          <span className="lbl" style={{ paddingLeft: 2 }}>Name</span>
          <input className={`input${tried && nameBad ? ' err' : ''}`} placeholder="e.g. Landmine press" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={tried && nameBad} />
          {tried && nameBad && <span className="help err">Give the exercise a name.</span>}
        </label>

        <div className="card tight" style={{ gap: 12 }}>
          <div className="between"><span className="strong">Primary muscles</span><span className="small sub">Required</span></div>
          {chips(ALL_MUSCLES, primary, (m) => toggle(primary, setPrimary, m), undefined, 'Primary muscles')}
          {tried && primBad && <span className="help err">Pick at least one primary muscle. Swaps and generation depend on it.</span>}
        </div>
        <div className="card tight" style={{ gap: 12 }}>
          <div className="between"><span className="strong">Secondary muscles</span><span className="small sub">Optional</span></div>
          {chips(ALL_MUSCLES, secondary, (m) => toggle(secondary, setSecondary, m), undefined, 'Secondary muscles')}
        </div>
        <div className="card tight" style={{ gap: 12 }}>
          <div className="between"><span className="strong">Equipment needed</span><span className="small sub">Used to filter by gym</span></div>
          {EQUIP_CATEGORIES.map((c) => (
            <div key={c} className="stack-s" style={{ gap: 8 }} role="group" aria-label={c}>
              <span className="eyebrow">{c}</span>
              {chips(EQUIPMENT.filter((q) => q.category === c).map((q) => q.id), equipment, (v) => toggle(equipment, setEquipment, v), (v) => EQUIPMENT.find((q) => q.id === v)?.name ?? v)}
            </div>
          ))}
          <span className="help">Leave empty for bodyweight. All selected items must be at the gym.</span>
        </div>
        <div className="card tight" style={{ gap: 12 }}>
          <div className="between"><span className="strong">Movement pattern</span><span className="small sub">One</span></div>
          {chips(ALL_PATTERNS, pattern ? [pattern] : [], (p) => setPattern(pattern === p ? null : p), cap, 'Movement pattern')}
          {tried && patBad && <span className="help err">Pick a movement pattern. Swaps rank alternatives by it.</span>}
        </div>

        <div className="card tight" style={{ gap: 10 }}>
          <span className="strong">Difficulty</span>
          <div className="seg c3" role="group" aria-label="Difficulty">{DIFFS.map(([v, l]) => <button type="button" key={v} className={difficulty === v ? 'on' : ''} aria-pressed={difficulty === v} onClick={() => setDifficulty(v)}>{l}</button>)}</div>
        </div>
        <div className="card tight" style={{ gap: 10 }}>
          <span className="strong">Track as</span>
          <div className="seg c3" role="group" aria-label="Track as">{TRACKS.map(([v, l]) => <button type="button" key={v} className={tracking === v ? 'on' : ''} aria-pressed={tracking === v} onClick={() => { setTracking(v); if (v === 'time' && repMax < 15) { setRepMin(30); setRepMax(60); } if (v !== 'time' && repMax > 40) { setRepMin(8); setRepMax(12); } }}>{l}</button>)}</div>
        </div>
        {tracking !== 'reps' && (
          <div className="card tight" style={{ gap: 10 }}>
            <span className="strong">Weight step</span>
            <div className={`seg c${Math.min(4, stepOptions.length) === 4 ? 4 : 3}`} role="group" aria-label="Weight step">{stepOptions.map((v) => <button type="button" key={v} className={weightStep === v ? 'on' : ''} aria-pressed={weightStep === v} onClick={() => setWeightStep(v)}>{v} kg</button>)}</div>
            <span className="help">How much the load goes up when it felt too light.</span>
          </div>
        )}

        <div className="card tight" style={{ gap: 14 }}>
          <div className="between">
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">{isTime ? 'Min duration' : 'Min reps'}</span><span className="sub">Bottom of the target range</span></div>
            <Stepper value={repMin} unit={isTime ? 's' : undefined} minWidth={isTime ? 56 : 36} decLabel="Lower minimum" incLabel="Higher minimum" decDisabled={repMin <= lo} incDisabled={repMin >= repMax}
              onDec={() => setRepMin(Math.max(lo, repMin - repStep))} onInc={() => setRepMin(Math.min(repMax, repMin + repStep))} />
          </div>
          <div className="between">
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">{isTime ? 'Max duration' : 'Max reps'}</span><span className="sub">Hit this to add load</span></div>
            <Stepper value={repMax} unit={isTime ? 's' : undefined} minWidth={isTime ? 56 : 36} decLabel="Lower maximum" incLabel="Higher maximum" decDisabled={repMax <= repMin} incDisabled={repMax >= hi}
              onDec={() => setRepMax(Math.max(repMin, repMax - repStep))} onInc={() => setRepMax(Math.min(hi, repMax + repStep))} />
          </div>
          <div className="between">
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">Default sets</span></div>
            <Stepper value={sets} minWidth={36} decLabel="Fewer sets" incLabel="More sets" decDisabled={sets <= 1} incDisabled={sets >= 10}
              onDec={() => setSets(Math.max(1, sets - 1))} onInc={() => setSets(Math.min(10, sets + 1))} />
          </div>
          {tracking !== 'reps' && (
            <label className="between" style={{ minHeight: 44 }}>
              <span className="stack-s" style={{ gap: 2 }}><span className="strong">Weight is per hand</span><span className="sub">Dumbbells, kettlebells, one side at a time</span></span>
              <input type="checkbox" className="switch" checked={perHand} onChange={(e) => setPerHand(e.target.checked)} aria-label="Weight is per hand" />
            </label>
          )}
          <label className="between" style={{ minHeight: 44 }}>
            <span className="stack-s" style={{ gap: 2 }}><span className="strong">Counts as prehab</span><span className="sub">Shows under the Prehab filter</span></span>
            <input type="checkbox" className="switch" checked={prehab} onChange={(e) => setPrehab(e.target.checked)} aria-label="Counts as prehab" />
          </label>
        </div>

        <ContentEditor draft={draft} setDraft={setDraft} defaults={dflt} />

        <label className="card tight field" style={{ gap: 10 }}>
          <span className="strong">Cue</span>
          <textarea className="input" rows={3} value={cue} onChange={(e) => setCue(e.target.value)} placeholder="How to do it, in one or two lines" style={{ padding: '12px 16px', minHeight: 88, resize: 'vertical' }} />
          <span className="help">A short one-liner. It shows as the steps above until you write your own steps.</span>
        </label>
      </div>
      <div className="bottombar">
        <button type="button" className="btn btn-primary" onClick={save}>Save exercise</button>
      </div>
      {showSaved && <div className="toast" role="status"><span className="ic ic-check" aria-hidden="true" /><span className="grow">{name.trim()} {existing ? 'saved' : 'added to your library'}</span><Link className="banner-act" to={`/library/${savedId}`}>View</Link></div>}
    </div>
  );
}
