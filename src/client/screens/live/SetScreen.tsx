import { logSet } from '../../store/actions';
import { draftKey, isFirstTime, putDraft, stepWeight, type SetDraft } from '../../store/x-live';
import { dispW, type PhaseProps } from './common';

export default function SetScreen({ session, ex, unit, exN, exCount, cur, openMenu }: PhaseProps & { cur: SetDraft; openMenu: () => void }) {
  const timeMode = ex.tracking === 'time';
  const setN = Math.min(ex.sets.length + 1, ex.plannedSets);
  const put = (w: number, r: number) => putDraft({ key: draftKey(session.id, ex), w: Math.max(0, w), r: Math.max(0, r) });
  const wStep = ex.weightStep || 2.5;
  const rStep = timeMode ? 5 : 1;
  const firstHint = ex.tracking === 'weight_reps' && ex.sets.length === 0 && isFirstTime(ex);
  const log = () => logSet(ex.tracking === 'weight_reps' ? cur.w : 0, cur.r);
  return (
    <div className="focus live-set">
      <div className="between" style={{ alignItems: 'flex-start', paddingTop: 6 }}>
        <div className="stack-s" style={{ gap: 8 }}>
          <span className="eyebrow">Exercise {exN} of {exCount}</span>
          <h1 className="t-display" style={{ fontSize: 32 }}>{ex.name}</h1>
          <div className="hstack" style={{ gap: 10 }}>
            <div className="setdots" aria-hidden="true">
              {Array.from({ length: ex.plannedSets }, (_, j) => <span key={j} className={j < ex.sets.length ? 'done' : j === ex.sets.length ? 'now' : ''} />)}
            </div>
            <span className="strong small">Set {setN} of {ex.plannedSets}</span>
          </div>
        </div>
        <button className="iconbtn filled" aria-label="Exercise options: swap, pain, sets, skip" onClick={openMenu}><span className="ic ic-more" aria-hidden="true" /></button>
      </div>
      <div style={{ flex: 1, minHeight: 8 }} />
      {firstHint && <p className="small sub center" style={{ padding: '0 12px' }}>Pick a weight you could lift about {ex.repTarget + 2} times with good form.</p>}
      {ex.tracking === 'weight_reps' && (
        <div className="big">
          <span className="lbl">{ex.perHand ? 'Weight · each hand' : 'Weight'}</span>
          <div className="bigrow">
            <button className="bigbtn" aria-label="Less weight" onClick={() => put(stepWeight(cur.w, -1, wStep, unit), cur.r)}><span className="ic ic-minus lg" aria-hidden="true" /></button>
            <span className="bignum" aria-live="polite" data-testid="weight-val">{cur.w ? dispW(cur.w, unit) : 'BW'}<small>{cur.w ? unit : ''}</small></span>
            <button className="bigbtn" aria-label="More weight" onClick={() => put(stepWeight(cur.w, 1, wStep, unit), cur.r)}><span className="ic ic-plus lg" aria-hidden="true" /></button>
          </div>
        </div>
      )}
      <div className="big">
        <span className="lbl">{timeMode ? 'Seconds' : 'Reps'} · target {ex.repTarget}</span>
        <div className="bigrow">
          <button className="bigbtn" aria-label={timeMode ? 'Fewer seconds' : 'Fewer reps'} onClick={() => put(cur.w, cur.r - rStep)}><span className="ic ic-minus lg" aria-hidden="true" /></button>
          <span className="bignum" aria-live="polite" data-testid="reps-val">{cur.r}<small>{timeMode ? 's' : ''}</small></span>
          <button className="bigbtn" aria-label={timeMode ? 'More seconds' : 'More reps'} onClick={() => put(cur.w, cur.r + rStep)}><span className="ic ic-plus lg" aria-hidden="true" /></button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 8 }} />
      <button className="btn btn-accent go" onClick={log}><span className="ic ic-check lg" aria-hidden="true" />Done · set {setN}</button>
    </div>
  );
}
