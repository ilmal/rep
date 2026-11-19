import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { EQUIP_BY_ID } from '../../shared/catalog';
import { swapPrescription } from '../../shared/rules';
import type { Session, SessionExercise } from '../../shared/types';
import { rxLine } from '../lib/format';
import { limitingEquipment, useActiveSession, useLibrary, useSettings } from '../store/actions';
import { DONT_OPTIONS, swapAlternatives, swapWithReason, type DontFor, type Reason } from '../store/x-swap';
import { useStore } from '../store/core';
import { NoAlternativesBody, NoAlternativesScreen } from './NoAlternatives';
import '../styles/session.css';

export type { Reason };
const REASONS: { key: Reason; label: string }[] = [
  { key: 'busy', label: 'Taken' },
  { key: 'gone', label: 'Not here' },
  { key: 'dont', label: 'Don\u2019t want' },
];

/** Shared swap logic for the Live options sheet and the full-screen swap. */
export function useSwap(session: Session, ex: SessionExercise) {
  const lib = useLibrary();
  const unit = useSettings().unit;
  const gyms = useStore((s) => s.gyms);
  const custom = useStore((s) => s.exercises);
  const prefs = useStore((s) => s.prefs);
  const progress = useStore((s) => s.progress);
  const [reason, setReason] = useState<Reason>('busy');
  const [dontFor, setDontFor] = useState<DontFor>('today');
  const exercise = lib.find((e) => e.id === ex.exerciseId);
  const eqId = exercise ? limitingEquipment(exercise) : null;
  const eqName = eqId ? EQUIP_BY_ID[eqId]?.name ?? eqId : null;

  const alts = useMemo(() => {
    void gyms; void custom; void prefs; // recompute when inventory / library / preferences change
    return swapAlternatives(session, ex.exerciseId).map((a) => {
      const rx = swapPrescription(ex, a.exercise, progress);
      const equip = a.exercise.equipment.length ? a.exercise.equipment.map((q) => EQUIP_BY_ID[q]?.name ?? q).join(' + ') : 'bodyweight';
      return { ...a, meta: `${a.exercise.primary.slice(0, 2).join(', ')} \u00b7 ${equip}`, rx: rxLine(rx.sets, rx.reps, rx.weight, unit, a.exercise.tracking, a.exercise.perHand) };
    });
  }, [ex, session, gyms, custom, prefs, progress, unit]);

  const noEquip = 'This exercise needs no equipment, so no gym inventory changes.';
  const dontWord = DONT_OPTIONS.find((d) => d.key === dontFor)!.word;
  const help = reason === 'dont' ? `${ex.name} is ${dontWord}. Gym equipment is not changed.`
    : !eqName ? noEquip
    : reason === 'busy' ? `${eqName} is skipped for this session only. It stays in ${session.gymName}'s inventory.`
    : `${eqName} is removed from ${session.gymName}'s equipment list. Exercises that need it are not planned there again.`;

  const perform = (exerciseId: string): string | null => {
    const to = alts.find((a) => a.exercise.id === exerciseId);
    if (!to) return null;
    swapWithReason(reason, exerciseId, dontFor);
    const tail = reason === 'dont' ? `${ex.name} ${dontWord}.` : !eqName ? '' : reason === 'busy' ? `${eqName} marked taken.` : `${eqName} removed from ${session.gymName}.`;
    return `Swapped to ${to.exercise.name}. ${tail}`.trim();
  };
  return { exercise, alts, reason, setReason, dontFor, setDontFor, help, perform };
}

function ReasonPicker({ sw }: { sw: ReturnType<typeof useSwap> }) {
  return (
    <div className="stack-s" style={{ gap: 8 }}>
      <span className="lbl">Why swap?</span>
      <div className="seg c3 on-bg" role="group" aria-label="Reason">
        {REASONS.map((r) => (
          <button key={r.key} className={sw.reason === r.key ? 'on' : ''} aria-pressed={sw.reason === r.key} onClick={() => sw.setReason(r.key)}>{r.label}</button>
        ))}
      </div>
      {sw.reason === 'dont' && (
        <>
          <span className="lbl">Stop suggesting it</span>
          <div className="seg c3 on-bg" role="group" aria-label="Stop suggesting for">
            {DONT_OPTIONS.map((d) => (
              <button key={d.key} className={sw.dontFor === d.key ? 'on' : ''} aria-pressed={sw.dontFor === d.key} onClick={() => sw.setDontFor(d.key)}>{d.label}</button>
            ))}
          </div>
        </>
      )}
      <span className="help" aria-live="polite">{sw.help}</span>
    </div>
  );
}

/** Swap list inside the Live sheet: tapping an alternative swaps immediately. */
export function SwapSheetBody({ session, ex, onBack, onSwapped }: { session: Session; ex: SessionExercise; onBack: () => void; onSwapped: (msg: string) => void }) {
  const sw = useSwap(session, ex);
  if (sw.alts.length === 0) {
    return <NoAlternativesBody session={session} ex={ex} exercise={sw.exercise} reason={sw.reason} dontFor={sw.dontFor} onResolved={(m) => onSwapped(m ?? `${ex.name} updated`)} />;
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="hstack">
        <button className="iconbtn" aria-label="Back" onClick={onBack} style={{ marginLeft: -10 }}><span className="ic ic-chev-left" aria-hidden="true" /></button>
        <h2 className="t-h grow">Swap {ex.name}</h2>
      </div>
      <ReasonPicker sw={sw} />
      <div className="group">
        {sw.alts.map((a) => (
          <button key={a.exercise.id} className="li" style={{ paddingLeft: 12 }} onClick={() => { const m = sw.perform(a.exercise.id); if (m) onSwapped(m); }}>
            <span className={`match ${a.match >= 85 ? 'hi' : 'mid'}`}><span>{a.match}%</span><small>match</small></span>
            <div className="grow"><span className="li-t">{a.exercise.name}</span><span className="li-s">{a.rx} · {a.meta}</span></div>
            <span className="ic ic-swap sm" style={{ color: '#6B6B6B' }} aria-hidden="true" />
          </button>
        ))}
      </div>
      <Link className="link small center" to="/library">Browse all exercises</Link>
    </div>
  );
}

export default function SwapScreen() {
  const session = useActiveSession();
  if (!session) return <Navigate to="/" replace />;
  if (session.phase === 'warmup') return <Navigate to="/session/warmup" replace />;
  const ex = session.exercises[session.cursor];
  if (!ex) return <Navigate to="/session/live" replace />;
  return <SwapInner session={session} ex={ex} />;
}

function SwapInner({ session, ex }: { session: Session; ex: SessionExercise }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sw = useSwap(session, ex);
  const [sel, setSel] = useState(0);
  const visible = session.exercises.filter((e) => e.status !== 'dropped');
  if (params.get('none') === '1' || sw.alts.length === 0) return <NoAlternativesScreen session={session} reason={sw.reason} dontFor={sw.dontFor} />;
  const chosen = sw.alts[Math.min(sel, sw.alts.length - 1)];
  const close = () => navigate('/session/live');
  const doSwap = () => {
    const msg = sw.perform(chosen.exercise.id);
    navigate('/session/live', { replace: true, state: { toast: msg } });
  };
  return (
    <div className="app">
      <div className="topbar" aria-hidden="true"><span className="iconbtn"><span className="ic ic-list" /></span><span className="title small">Session {session.seq} · {session.areaName}</span><span className="spacer" /></div>
      <div className="scroll" aria-hidden="true" style={{ paddingTop: 8 }}>
        <span className="eyebrow">Exercise {Math.max(1, visible.findIndex((e) => e.id === ex.id) + 1)} of {visible.length}</span>
        <h1 className="t-display">{ex.name}</h1>
        <div className="card" style={{ height: 260 }} />
      </div>
      <button className="scrim" aria-label="Close" onClick={close} />
      <div className="sheet" role="dialog" aria-label="Swap exercise" style={{ maxHeight: '92%', overflowY: 'auto' }}>
        <div className="grabber" />
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div className="stack-s" style={{ gap: 2 }}>
            <h2 className="t-h">Swap {ex.name}</h2>
            <span className="sub">Ranked by muscle match, available at {session.gymName}</span>
          </div>
          <button className="iconbtn" aria-label="Close" onClick={close} style={{ margin: '-6px -10px 0 0' }}><span className="ic ic-x" aria-hidden="true" /></button>
        </div>
        <ReasonPicker sw={sw} />
        <div className="group" role="radiogroup" aria-label="Alternatives">
          {sw.alts.map((a, i) => (
            <button key={a.exercise.id} className="li" role="radio" aria-checked={i === sel} onClick={() => setSel(i)} style={{ paddingLeft: 12 }}>
              <span className={`match ${a.match >= 85 ? 'hi' : 'mid'}`}><span>{a.match}%</span><small>match</small></span>
              <div className="grow"><span className="li-t">{a.exercise.name}</span><span className="li-s">{a.rx} · {a.meta}</span></div>
              <span className={`radio ${i === sel ? 'on' : ''}`} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="between small" style={{ padding: '0 4px' }}>
          <Link className="link" to="/library">Browse all exercises</Link>
          <Link className="link" to="/session/swap?none=1">Nothing fits</Link>
        </div>
        <button className="btn btn-primary" onClick={doSwap}><span className="ic ic-swap" aria-hidden="true" />Swap to {chosen.exercise.name}</button>
      </div>
    </div>
  );
}
