import { useMemo, useState } from 'react';
import { isNoEquipment } from '../../shared/location';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { EQUIP_BY_ID } from '../../shared/catalog';
import type { Exercise, Session, SessionExercise } from '../../shared/types';
import { limitingEquipment, skipCurrent, useActiveSession, useLibrary } from '../store/actions';
import { applyDontWant, lowerMatchAlternative, restoreEquipment, swapWithReason, type DontFor, type Reason } from '../store/x-swap';
import { useStore } from '../store/core';
import '../styles/session.css';

type Choice = 'skip' | 'low' | 'any' | 'have';

/** Content of the "No good swap" design. Used inline by the Live options sheet and by the full screen below. */
export function NoAlternativesBody({ session, ex, exercise, onResolved, reason = 'busy', dontFor = 'today' }: { session: Session; ex: SessionExercise; exercise?: Exercise; onResolved: (msg?: string) => void; reason?: Reason; dontFor?: DontFor }) {
  const navigate = useNavigate();
  const sessions = useStore((st) => st.sessions);
  const prefs = useStore((st) => st.prefs);
  const gyms = useStore((st) => st.gyms);
  const custom = useStore((st) => st.exercises);
  const low = useMemo(() => {
    void sessions; void prefs; void gyms; void custom;
    return lowerMatchAlternative(session, ex.exerciseId);
  }, [session, ex.exerciseId, sessions, prefs, gyms, custom]);
  const [choice, setChoice] = useState<Choice>('skip');
  const eqId = exercise ? limitingEquipment(exercise) : null;
  const eqName = eqId ? EQUIP_BY_ID[eqId]?.name ?? eqId : null;
  const canAdd = !!eqId && !!session.gymId && !isNoEquipment(session.gymId); // the built-in no-equipment location has no inventory to edit
  const saveMin = Math.max(1, Math.round(ex.estSec / 60));
  const muscles = exercise?.primary.slice(0, 2).join(' and ').toLowerCase() ?? 'the same muscles';

  const opts: { key: Choice; title: string; sub: string; tag?: string; tagCls?: string }[] = [
    { key: 'skip', title: 'Skip it today', sub: `Saves ~${saveMin} min. The planner will bring it back in a later session.`, tag: 'Recommended', tagCls: 'green' },
    ...(low ? [{ key: 'low' as Choice, title: low.exercise.name, sub: `${[...low.exercise.primary.slice(0, 2)].join(', ')} · ${low.exercise.equipment.length ? low.exercise.equipment.map((q) => EQUIP_BY_ID[q]?.name ?? q).join(' + ') : 'bodyweight'}`, tag: `${low.match}%`, tagCls: 'accent' }] : []),
    { key: 'any', title: 'Pick any exercise', sub: `Browse everything ${session.gymName} can do` },
    ...(canAdd ? [{ key: 'have' as Choice, title: 'I actually have the equipment', sub: `Marks ${eqName} as available at ${session.gymName} and keeps ${ex.name}` }] : []),
  ];
  const cta = choice === 'skip' ? `Skip ${ex.name}` : choice === 'low' && low ? `Use ${low.exercise.name}` : choice === 'any' ? 'Open library' : `Mark ${eqName} available and continue`;

  const go = () => {
    if (choice === 'skip') { if (reason === 'dont') applyDontWant(ex.exerciseId, dontFor); skipCurrent(); onResolved(); }
    else if (choice === 'low' && low) { swapWithReason(reason, low.exercise.id, dontFor); onResolved(`Swapped to ${low.exercise.name}`); }
    else if (choice === 'any') navigate('/library');
    else if (eqId) { restoreEquipment(session, eqId); onResolved(`${eqName} marked available at ${session.gymName}`); }
  };

  return (
    <>
      <div className="stack-s" style={{ alignItems: 'center', textAlign: 'center', gap: 8, paddingTop: 6 }}>
        <div className="empty-ic warm" style={{ width: 64, height: 64 }}><span className="ic ic-swap xl" aria-hidden="true" /></div>
        <h2 className="t-h">No good swap at {session.gymName}</h2>
        <p className="sub">Nothing available at this gym trains {muscles} above a 35% match.</p>
      </div>
      <div className="group" role="radiogroup" aria-label="What now?">
        {opts.map((o) => (
          <button key={o.key} className="li" role="radio" aria-checked={choice === o.key} onClick={() => setChoice(o.key)}>
            <span className={`radio ${choice === o.key ? 'on' : ''}`} aria-hidden="true" />
            <div className="grow"><span className="li-t">{o.title}</span><span className="li-s">{o.sub}</span></div>
            {o.tag && <span className={`tag ${o.tagCls ?? 'green'}`}>{o.tag}</span>}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" onClick={go}>{cta}</button>
    </>
  );
}

/** Full-screen version: faded workout behind a sheet. */
export default function NoAlternatives() {
  const session = useActiveSession();
  if (!session) return <Navigate to="/" replace />;
  return <NoAlternativesScreen session={session} />;
}

export function NoAlternativesScreen({ session, reason, dontFor }: { session: Session; reason?: Reason; dontFor?: DontFor }) {
  const navigate = useNavigate();
  const lib = useLibrary();
  const ex = session.exercises[session.cursor];
  if (!ex || session.phase === 'warmup') return <Navigate to="/session/live" replace />;
  const exercise = lib.find((e) => e.id === ex.exerciseId);
  const visible = session.exercises.filter((e) => e.status !== 'dropped');
  return (
    <div className="app">
      <div className="topbar" aria-hidden="true"><span className="iconbtn"><span className="ic ic-list" /></span><span className="title small">Session {session.seq} · {session.areaName} · {session.gymName}</span><span className="spacer" /></div>
      <div className="scroll" aria-hidden="true" style={{ paddingTop: 8 }}>
        <span className="eyebrow">Exercise {Math.max(1, visible.findIndex((e) => e.id === ex.id) + 1)} of {visible.length}</span>
        <h1 className="t-display">{ex.name}</h1>
        <div className="card" style={{ height: 260 }} />
      </div>
      <Link className="scrim" to="/session/live" aria-label="Close" />
      <div className="sheet" role="dialog" aria-label="No alternative found">
        <div className="grabber" />
        <NoAlternativesBody session={session} ex={ex} exercise={exercise} reason={reason} dontFor={dontFor} onResolved={(msg) => navigate('/session/live', { replace: true, state: msg ? { toast: msg } : undefined })} />
      </div>
    </div>
  );
}
