import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Stepper } from '../components/Controls';
import { ScoreChip } from '../components/ScoreBars';
import { EQUIP_BY_ID } from '../../shared/catalog';
import { ALL_MUSCLES } from '../../shared/exercises';
import { scoreAll } from '../../shared/planner';
import type { Area, AreaMode, Muscle } from '../../shared/types';
import { deleteArea, saveArea, useAllLibrary, useLibrary, usePrefs, useSessions, useSettings } from '../store/actions';
import { useStore } from '../store/core';

export default function AreaEdit() {
  const { id = '' } = useParams();
  const area = useStore((s) => s.areas[id]);
  if (!area) {
    return (
      <div className="app">
        <div className="topbar"><Link className="iconbtn" to="/plan" aria-label="Back to Plan"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link><span className="title">Area</span><span className="spacer" /></div>
        <div className="scroll"><div className="empty"><div className="empty-ic"><span className="ic ic-list xl" aria-hidden="true" /></div><h2 className="t-h">Area not found</h2><p className="sub">It may have been deleted.</p><Link className="btn btn-primary btn-sm" to="/plan">Back to Plan</Link></div></div>
      </div>
    );
  }
  return <Editor key={area.id} area={area} />;
}

function Editor({ area }: { area: Area }) {
  const nav = useNavigate();
  const settings = useSettings();
  const lib = useLibrary();
  const allLib = useAllLibrary();
  const prefs = usePrefs();
  const sessions = useSessions();
  const slot = useStore((s) => s.settings.rotation.indexOf(area.id) + 1);

  const [draft, setDraft] = useState<Area>(area);
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(area);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const back = () => { if (dirty) setLeaving(true); else nav('/plan', { replace: true }); };
  const patch = (p: Partial<Area>) => setDraft((d) => ({ ...d, ...p }));

  const byId = useMemo(() => new Map(allLib.map((e) => [e.id, e])), [allLib]);
  const pool = draft.poolExerciseIds;
  const poolEx = useMemo(() => pool.map((eid) => byId.get(eid)).filter((e) => !!e), [pool, byId]);
  const scores = useMemo(() => {
    const live = poolEx.filter((e) => !e!.archived) as NonNullable<(typeof poolEx)[number]>[];
    const list = scoreAll({ library: lib, prefs, sessions, planner: settings.planner, now: Date.now(), area: { focusMuscles: draft.focusMuscles } }, live);
    return new Map(list.map((s) => [s.exerciseId, s]));
  }, [poolEx, lib, prefs, sessions, settings.planner, draft.focusMuscles]);

  const toggleMuscle = (m: Muscle) => patch({ focusMuscles: draft.focusMuscles.includes(m) ? draft.focusMuscles.filter((x) => x !== m) : [...draft.focusMuscles, m] });
  const togglePin = (eid: string) => patch({ pinnedExerciseIds: draft.pinnedExerciseIds.includes(eid) ? draft.pinnedExerciseIds.filter((x) => x !== eid) : [...draft.pinnedExerciseIds, eid] });
  const remove = (eid: string) => patch({ poolExerciseIds: pool.filter((x) => x !== eid), pinnedExerciseIds: draft.pinnedExerciseIds.filter((x) => x !== eid) });
  const clean = (): Area => ({ ...draft, name: draft.name.trim() || 'Untitled area' });
  const save = () => { saveArea(clean()); nav('/plan', { replace: true }); };
  const addMore = () => { saveArea(clean()); nav(`/library?addToArea=${draft.id}`); };

  const modes: [AreaMode, string][] = [['auto', 'Auto-pick'], ['fixed', 'Fixed list']];
  const n = draft.exercisesPerSession;
  const pins = draft.pinnedExerciseIds.length;

  return (
    <div className="app">
      <div className="topbar">
        <button type="button" className="iconbtn" aria-label="Back to Plan" onClick={back}><span className="ic ic-chev-left lg" aria-hidden="true" /></button>
        <span className="title">{slot ? `Session ${slot} · area` : 'Area'}</span>
        <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={save}>Save</button>
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <label className="field">
          <span className="lbl" style={{ paddingLeft: 2 }}>Name</span>
          <input className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} style={{ fontFamily: "'Inter Tight', Inter, sans-serif", fontSize: 22, fontWeight: 700 }} />
        </label>

        <div className="card">
          <div className="stack-s"><span className="strong">Focus muscles</span><span className="sub">Exercises are picked to cover these</span></div>
          <div className="wrap">
            {ALL_MUSCLES.map((m) => {
              const on = draft.focusMuscles.includes(m);
              return <button type="button" key={m} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleMuscle(m)}>{m}</button>;
            })}
          </div>
        </div>

        <div className="card">
          <div className="between">
            <div className="stack-s" style={{ gap: 2 }}><span className="strong">Exercises per session</span><span className="sub">Auto-adjust may drop 1 to fit time</span></div>
            <Stepper value={n} minWidth={32} decLabel="Fewer" incLabel="More" decDisabled={n <= 1} incDisabled={n >= 10}
              onDec={() => patch({ exercisesPerSession: Math.max(1, n - 1) })} onInc={() => patch({ exercisesPerSession: Math.min(10, n + 1) })} />
          </div>
          <div className="divider" />
          <div className="stack-s" style={{ gap: 8 }}>
            <span className="strong">How exercises are chosen</span>
            <div className="seg c2">
              {modes.map(([m, label]) => <button type="button" key={m} className={draft.mode === m ? 'on' : ''} aria-pressed={draft.mode === m} onClick={() => patch({ mode: m })}>{label}</button>)}
            </div>
            <span className="help">{draft.mode === 'auto'
              ? `Each session picks ${n} from the pool: flagged ones first, then ranked by planner score and rotated for variety. Always filtered by the gym’s equipment.`
              : 'The same exercises in pool order every time. Unavailable ones are hot-swapped.'}</span>
          </div>
        </div>

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>Exercise pool</span><span className="sub">{pool.length} · {pins} pinned</span></div>
        {pool.length === 0 ? (
          <p className="sub small" style={{ padding: '0 2px' }}>The pool is empty, so sessions pick from every exercise that trains the focus muscles. Add exercises to control the mix.</p>
        ) : (
          <div className="group">
            {pool.map((eid) => {
              const e = byId.get(eid);
              if (!e) return null;
              const pinned = draft.pinnedExerciseIds.includes(eid);
              const equip = e.equipment.map((q) => EQUIP_BY_ID[q]?.name ?? q).join(', ') || 'Bodyweight';
              return (
                <div className="li" key={eid} style={{ gap: 8, opacity: e.archived ? 0.55 : 1 }}>
                  <button type="button" aria-pressed={pinned} aria-label={`${pinned ? 'Unflag' : 'Always include'} ${e.name}`} onClick={() => togglePin(eid)}
                    style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: pinned ? '#A8360A' : '#B5B1A8', background: pinned ? '#FFE7DC' : 'transparent' }}>
                    <span className="ic ic-flag sm" aria-hidden="true" />
                  </button>
                  <Link className="grow stack-s" to={`/library/${eid}`} style={{ gap: 2 }}>
                    <span className="li-t">{e.name}</span>
                    <span className="li-s">{e.archived ? 'Archived' : `${e.primary.join(', ')} · ${equip}`}</span>
                  </Link>
                  <ScoreChip s={scores.get(eid)} />
                  <button type="button" className="iconbtn" aria-label={`Remove ${e.name} from pool`} onClick={() => remove(eid)} style={{ marginRight: -8 }}><span className="ic ic-x sm" aria-hidden="true" /></button>
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className="btn btn-secondary" onClick={addMore}><span className="ic ic-plus" aria-hidden="true" />Add from library</button>
        <p className="sub center small" style={{ padding: '0 16px' }}>Flag = always include when the gym has the equipment. The chip is the planner score (higher is picked sooner).</p>
        <button type="button" className="btn btn-danger-soft" style={{ marginTop: 8 }} onClick={() => setConfirm(true)}><span className="ic ic-trash" aria-hidden="true" />Remove area from rotation</button>
      </div>

      {leaving && (
        <>
          <button type="button" className="scrim" aria-label="Keep editing" onClick={() => setLeaving(false)} />
          <div className="dialog" role="alertdialog" aria-label="Unsaved changes">
            <h2 className="t-h">Discard changes?</h2>
            <p className="sub">Your edits to “{area.name}” have not been saved.</p>
            <button type="button" className="btn btn-primary" onClick={save}>Save changes</button>
            <button type="button" className="btn btn-danger" onClick={() => nav('/plan', { replace: true })}>Discard</button>
            <button type="button" className="btn btn-secondary" onClick={() => setLeaving(false)}>Keep editing</button>
          </div>
        </>
      )}
      {confirm && (
        <>
          <button type="button" className="scrim" aria-label="Cancel" onClick={() => setConfirm(false)} />
          <div className="dialog" role="alertdialog" aria-label="Delete area">
            <h2 className="t-h">Delete “{area.name}”?</h2>
            <p className="sub">It is removed from your rotation. Past sessions keep their history.</p>
            <button type="button" className="btn btn-danger" onClick={() => { deleteArea(area.id); nav('/plan', { replace: true }); }}>Delete area</button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
