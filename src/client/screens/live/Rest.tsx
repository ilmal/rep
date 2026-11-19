import { mmss } from '../../lib/format';
import { adjustRest, endRest, undoLastSet } from '../../store/actions';
import { draftKey, putDraft, type SetDraft } from '../../store/x-live';
import { dispW, eachWord, type PhaseProps } from './common';

const RING = 653.45;

export default function Rest({ session, ex, now, unit, cur }: PhaseProps & { cur: SetDraft }) {
  const t = ex.tracking;
  const endsAt = session.restEndsAt ?? now;
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const total = Math.max(1, session.restTotalSec ?? ex.restSec);
  const last = ex.sets[ex.sets.length - 1];
  const lastLine = last ? `set ${ex.sets.length}: ${t === 'weight_reps' && last.weight ? `${dispW(last.weight, unit)} × ` : ''}${last.reps}${t === 'time' ? ' s' : ''}` : '';
  const nextLine = t === 'time' ? `${cur.r} s` : `${t === 'weight_reps' && cur.w ? `${dispW(cur.w, unit)} ${unit}${eachWord(ex.perHand)}` : 'Bodyweight'} × ${cur.r}`;
  const undo = () => {
    // the logged numbers come back filled in on the set screen
    if (last) putDraft({ key: draftKey(session.id, ex, ex.sets.length - 1), w: last.weight, r: last.reps });
    undoLastSet();
  };
  return (
    <div className="focus live-rest" style={{ alignItems: 'center' }}>
      <div style={{ flex: 1, minHeight: 4 }} />
      <span className="lbl">Rest</span>
      <div className="live-ring">
        <svg width="100%" height="100%" viewBox="0 0 240 240" aria-hidden="true">
          <circle cx="120" cy="120" r="104" fill="none" stroke="#E6E4DF" strokeWidth="14" />
          <circle data-testid="ring" cx="120" cy="120" r="104" fill="none" stroke="#FF5A1F" strokeWidth="14" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - Math.min(1, remaining / total))} transform="rotate(-90 120 120)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <span className="clock" role="timer" aria-label={`Rest remaining ${mmss(remaining)}`}>{mmss(remaining)}</span>
          <span className="sub">of {mmss(total)}</span>
        </div>
      </div>
      <div className="hstack" style={{ gap: 10 }}>
        <button className="ctrl" aria-label="15 seconds less" onClick={() => adjustRest(-15)}>−15 s</button>
        <button className="ctrl" aria-label="15 seconds more" onClick={() => adjustRest(15)}>+15 s</button>
      </div>
      <div style={{ flex: 1, minHeight: 4 }} />
      <div className="card tight" style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div className="grow stack-s" style={{ gap: 2 }}>
          <span className="eyebrow">Up next · set {ex.sets.length + 1} of {ex.plannedSets}</span>
          <span className="strong" style={{ fontSize: 18 }} data-testid="next-line">{nextLine}</span>
        </div>
        <span className="small sub">Adjust when you start</span>
      </div>
      <div className="between small" style={{ width: '100%', padding: '0 4px' }}>
        <span className="sub" data-testid="logged-line">Logged {lastLine}</span>
        <button className="link" onClick={undo}>Undo</button>
      </div>
      <button className="btn btn-primary go" style={{ width: '100%' }} onClick={() => endRest(false)}>Start set {ex.sets.length + 1} now</button>
    </div>
  );
}
