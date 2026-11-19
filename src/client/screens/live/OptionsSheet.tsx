import { useState } from 'react';
import { isNoEquipment } from '../../../shared/location';
import { Link } from 'react-router-dom';
import { dateShort, rxLine } from '../../lib/format';
import { addSetToCurrent, limitingEquipment, removeSetFromCurrent, skipCurrent, useLibrary } from '../../store/actions';
import {
  gentlerAlternatives, goLighter, painSkip, PAUSE_2W_DAYS, prescriptionFor, swapAlternatives, swapExercise, type NopeFor, type SwapReason,
} from '../../store/x-live';
import { planLine, type PhaseProps } from './common';

export type MenuView = 'main' | 'swap' | 'pain' | 'painswap';

const REASONS: { key: 'busy' | 'gone' | 'nope'; label: string }[] = [
  { key: 'busy', label: 'Taken' }, { key: 'gone', label: 'Not here' }, { key: 'nope', label: 'Don’t want' },
];
const DURS: { key: NopeFor; label: string }[] = [{ key: 'today', label: 'Today' }, { key: '2w', label: '2 weeks' }, { key: 'never', label: 'Never (ban)' }];

export default function OptionsSheet({ session, ex, unit, flash, view, setView, onClose }: PhaseProps & { view: MenuView; setView: (v: MenuView) => void; onClose: () => void }) {
  return (
    <>
      <button className="scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet live-sheet" role="dialog" aria-label="Exercise options">
        <div className="grabber" />
        {view === 'main' && <Main {...{ session, ex, unit, flash, setView, onClose }} />}
        {view === 'pain' && <Pain {...{ ex, flash, setView, onClose }} />}
        {(view === 'swap' || view === 'painswap') && <SwapView key={view} {...{ session, ex, unit, flash, setView, onClose }} gentle={view === 'painswap'} />}
      </div>
    </>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return <button className="iconbtn" aria-label="Back" onClick={onClick} style={{ marginLeft: -10 }}><span className="ic ic-chev-left" aria-hidden="true" /></button>;
}

function Main({ session, ex, flash, setView, onClose }: Pick<PhaseProps, 'session' | 'ex' | 'unit' | 'flash'> & { setView: (v: MenuView) => void; onClose: () => void }) {
  const canRemove = ex.plannedSets > Math.max(1, ex.sets.length + 1);
  const canAdd = ex.plannedSets < 12;
  void session;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <h2 className="t-h">{ex.name}</h2>
      <div className="group">
        <button className="menu-i" onClick={() => setView('swap')}><span className="tile sm warm"><span className="ic ic-swap sm" aria-hidden="true" /></span><span className="grow">Swap exercise<small>Taken, not here, or you&apos;d rather not</small></span><span className="ic ic-chev-right chev" aria-hidden="true" /></button>
        <button className="menu-i" onClick={() => setView('pain')}><span className="tile sm red"><span className="ic ic-alert sm" aria-hidden="true" /></span><span className="grow">It hurts or feels off</span><span className="ic ic-chev-right chev" aria-hidden="true" /></button>
        <button className="menu-i" disabled={!canAdd} onClick={() => { addSetToCurrent(); onClose(); flash(`Set added: ${ex.plannedSets + 1} sets`); }}><span className="tile sm"><span className="ic ic-plus sm" aria-hidden="true" /></span><span className="grow">Add a set</span></button>
        <button className="menu-i" disabled={!canRemove} onClick={() => { removeSetFromCurrent(); onClose(); flash(`Set removed: ${ex.plannedSets - 1} sets`); }}><span className="tile sm"><span className="ic ic-minus sm" aria-hidden="true" /></span><span className="grow">Remove a set</span></button>
        <button className="menu-i" onClick={() => { skipCurrent(); onClose(); flash(`${ex.name} skipped`); }}><span className="tile sm"><span className="ic ic-skip sm" aria-hidden="true" /></span><span className="grow">Skip this exercise</span></button>
        <Link className="menu-i" to={`/library/${ex.exerciseId}`}><span className="tile sm"><span className="ic ic-chart sm" aria-hidden="true" /></span><span className="grow">History &amp; how-to</span><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
      </div>
    </div>
  );
}

function Pain({ ex, flash, setView, onClose }: Pick<PhaseProps, 'ex' | 'flash'> & { setView: (v: MenuView) => void; onClose: () => void }) {
  const until = dateShort(Date.now() + PAUSE_2W_DAYS * 86400000);
  const weighted = ex.tracking === 'weight_reps' && ex.plannedWeight > 0;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="hstack"><Back onClick={() => setView('main')} /><h2 className="t-h grow">Something feels off</h2></div>
      <p className="sub">Stop the set if anything hurts. Pick what to do. A note is saved with the session.</p>
      <div className="group">
        <button className="menu-i" onClick={() => { goLighter(); onClose(); flash(`${weighted ? 'Weight' : ex.tracking === 'time' ? 'Seconds' : 'Reps'} lowered 20%. Note saved.`); }}><span className="tile sm"><span className="ic ic-arrow-down sm" aria-hidden="true" /></span><span className="grow">Go lighter<small>{weighted ? '−20% weight for the remaining sets' : `−20% ${ex.tracking === 'time' ? 'seconds' : 'reps'} for the remaining sets`}</small></span></button>
        <button className="menu-i" onClick={() => setView('painswap')}><span className="tile sm"><span className="ic ic-swap sm" aria-hidden="true" /></span><span className="grow">Swap to a gentler alternative</span><span className="ic ic-chev-right chev" aria-hidden="true" /></button>
        <button className="menu-i" onClick={() => { painSkip(false); onClose(); flash(`Skipped. Note saved for ${ex.name}`); }}><span className="tile sm"><span className="ic ic-skip sm" aria-hidden="true" /></span><span className="grow">Skip it today</span></button>
        <button className="menu-i" onClick={() => { painSkip(true); onClose(); flash(`${ex.name} paused until ${until}`); }}><span className="tile sm warm"><span className="ic ic-pause-c sm" aria-hidden="true" /></span><span className="grow">Skip and pause for 2 weeks<small>It won&apos;t be planned until {until}</small></span></button>
      </div>
    </div>
  );
}

function SwapView({ session, ex, unit, flash, setView, onClose, gentle }: Pick<PhaseProps, 'session' | 'ex' | 'unit' | 'flash'> & { setView: (v: MenuView) => void; onClose: () => void; gentle: boolean }) {
  const lib = useLibrary();
  const [reason, setReason] = useState<'busy' | 'gone' | 'nope'>('busy');
  const [dur, setDur] = useState<NopeFor>('2w');
  const exercise = lib.find((e) => e.id === ex.exerciseId);
  const eqId = exercise ? limitingEquipment(exercise) : null;
  // Taken / Not here: never offer something that needs the very equipment being swapped away from
  const alts = gentle ? gentlerAlternatives(session, ex) : swapAlternatives(session, ex, reason === 'nope' ? null : eqId);
  const gymName = session.gymName;
  const help = reason === 'busy' ? 'Someone’s on it. Swapped for this session only.'
    : reason === 'gone' ? `Removes the equipment from ${gymName}, so it’s never planned here again.`
    : 'Swapped now. Choose how long to stop suggesting it.';
  const until = dateShort(Date.now() + PAUSE_2W_DAYS * 86400000);
  const durWord = { today: 'for today', '2w': `until ${until}`, never: 'permanently (banned)' }[dur];
  const back = () => setView(gentle ? 'pain' : 'main');

  const pick = (id: string, name: string) => {
    const r: SwapReason = gentle ? 'pain' : reason;
    swapExercise(r, id, dur);
    let msg = `Swapped to ${name}`;
    if (gentle) msg += '. Note saved.';
    else if (reason === 'gone' && eqId && session.gymId && !isNoEquipment(session.gymId)) msg += `. Removed from ${gymName}.`;
    else if (reason === 'nope') msg += `. ${ex.name} off ${durWord}.`;
    onClose();
    flash(msg);
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="hstack"><Back onClick={back} /><h2 className="t-h grow">{gentle ? `Gentler than ${ex.name}` : `Swap ${ex.name}`}</h2></div>
      {!gentle && (
        <>
          <div className="seg c3 on-bg" role="group" aria-label="Why swap">
            {REASONS.map((r) => <button key={r.key} className={reason === r.key ? 'on' : ''} aria-pressed={reason === r.key} onClick={() => setReason(r.key)}>{r.label}</button>)}
          </div>
          <span className="help" aria-live="polite">{help}</span>
          {reason === 'nope' && (
            <div className="stack-s" style={{ gap: 8 }}>
              <span className="lbl">Stop suggesting {ex.name}</span>
              <div className="seg c3 on-bg" role="group" aria-label="For how long">
                {DURS.map((d) => <button key={d.key} className={dur === d.key ? 'on' : ''} aria-pressed={dur === d.key} onClick={() => setDur(d.key)}>{d.label}</button>)}
              </div>
            </div>
          )}
        </>
      )}
      {gentle && <span className="help">Easier movements first. No equipment is marked busy; a note is saved with the session.</span>}
      {alts.length > 0 ? (
        <div className="group">
          {alts.map((a) => {
            const rx = prescriptionFor(ex, a.exercise);
            return (
              <button key={a.exercise.id} className="li" onClick={() => pick(a.exercise.id, a.exercise.name)} style={{ paddingLeft: 12 }} aria-label={`${a.exercise.name}, ${a.match}% match`}>
                <span className="match">{a.match}%</span>
                <div className="grow"><span className="li-t">{a.exercise.name}</span><span className="li-s">{a.exercise.tracking === 'weight_reps' && rx.weight ? planLine(rx.sets, rx.reps, rx.weight, unit, a.exercise) : rxLine(rx.sets, rx.reps, rx.weight, unit, a.exercise.tracking, a.exercise.perHand)}{a.exercise.tracking === 'reps' && !rx.weight ? ' · bodyweight' : ''} · available here</span></div>
                <span className="ic ic-swap sm" style={{ color: '#6B6B6B' }} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : <p className="sub">Nothing else fits at {gymName} right now.</p>}
      <Link className="link small center" to="/session/swap?none=1">None of these work</Link>
    </div>
  );
}

