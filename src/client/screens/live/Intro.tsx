import { useState } from 'react';
import { GuideSheet } from '../../components/ExerciseGuide';
import { EQUIP_BY_ID } from '../../../shared/catalog';
import { mmss } from '../../lib/format';
import { useLibrary } from '../../store/actions';
import { beginExercise, isFirstTime, lastTime } from '../../store/x-live';
import { skipCurrent } from '../../store/actions';
import { planLine, type PhaseProps } from './common';

/** "Up next": what today looks like for this exercise, before set 1. */
export default function Intro({ session, ex, unit, flash, exN, exCount, openSwap }: PhaseProps & { openSwap: () => void }) {
  const lib = useLibrary();
  const [guide, setGuide] = useState(false);
  const exercise = lib.find((e) => e.id === ex.exerciseId);
  const equip = (exercise?.equipment ?? []).map((q) => EQUIP_BY_ID[q]?.name ?? q);
  const first = isFirstTime(ex);
  const last = first ? null : lastTime(session, ex, unit);
  const lastCls = last?.dir === 'up' ? { c: 'ok', i: 'ic-arrow-up' } : last?.dir === 'down' ? { c: 'warn', i: 'ic-arrow-down' } : { c: 'info', i: 'ic-minus' };
  return (
    <div className="focus live-intro">
      <div className="stack-s" style={{ gap: 8, paddingTop: 6 }}>
        <span className="eyebrow">Up next · exercise {exN} of {exCount}</span>
        <h1 className="t-display" style={{ fontSize: 34 }}>{ex.name}</h1>
        <div className="wrap" style={{ gap: 6 }}>
          {equip.map((q) => <span key={q} className="tag outline"><span className="ic ic-dumbbell xs" aria-hidden="true" />{q}</span>)}
        </div>
        {exercise && <button type="button" className="btn btn-secondary btn-sm live-howto" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => setGuide(true)}><span className="ic ic-book sm" aria-hidden="true" />How to do it</button>}
      </div>
      <div style={{ flex: 1, minHeight: 4 }} />
      <div className="card" style={{ gap: 10 }}>
        <span className="lbl">Today</span>
        <span className="live-plan" data-testid="plan-line">{planLine(ex.plannedSets, ex.repTarget, ex.plannedWeight, unit, ex)}</span>
        {ex.tempo && <span className="sub" data-testid="tempo-cue">3 s tempo: lower for three seconds on every rep.</span>}
        <span className="sub">{mmss(ex.restSec || 90)} rest between sets · about {Math.round((ex.plannedSets * ((ex.restSec || 90) + 45)) / 60)} min</span>
      </div>
      {first && (
        <div className="banner info"><span className="ic ic-info" aria-hidden="true" /><div><span className="b-t">First time doing this</span>The weight is a starting guess. Rate it after the last set and the next session will be calibrated.</div></div>
      )}
      {last && (
        <div className={`banner ${lastCls.c}`}><span className={`ic ${lastCls.i}`} aria-hidden="true" /><div>{last.text}</div></div>
      )}
      <div style={{ flex: 1, minHeight: 4 }} />
      <div className="grid2">
        <button className="btn btn-secondary" onClick={openSwap}><span className="ic ic-swap" aria-hidden="true" />Swap</button>
        <button className="btn btn-secondary" onClick={() => { skipCurrent(); flash(`${ex.name} skipped`); }}><span className="ic ic-skip" aria-hidden="true" />Skip</button>
      </div>
      <button className="btn btn-accent go" onClick={beginExercise}><span className="ic ic-play" aria-hidden="true" />Start set 1</button>
      {guide && exercise && <GuideSheet ex={exercise} showEdit={false} onClose={() => setGuide(false)} />}
    </div>
  );
}
