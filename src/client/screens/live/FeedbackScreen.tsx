import type { Feedback } from '../../../shared/types';
import { exerciseSeconds } from '../../../shared/rules';
import { mmss } from '../../lib/format';
import { previewRecommendation, saveFeedback } from '../../store/actions';
import { fbKey, fmtTonnage, putFbDraft, skipFeedback, tonnageOf, useFbDraft } from '../../store/x-live';
import { dispW, eachWord, planLine, type PhaseProps } from './common';

const Q: { k: keyof Feedback; title: string; hint: string; opts: [string, string, string][] }[] = [
  { k: 'effort', title: 'Effort today', hint: 'Your energy, not the lift', opts: [['chill', 'Chill today', 'v-ink'], ['normal', 'Normal', 'v-ink'], ['hard', 'Trying hard', 'v-ink']] },
  { k: 'weight', title: 'The weight was', hint: 'Required', opts: [['light', 'Too light', 'v-green'], ['right', 'Just right', 'v-ink'], ['heavy', 'Too heavy', 'v-accent']] },
  { k: 'volume', title: 'Volume', hint: 'Sets × reps', opts: [['reps', 'Too many reps', 'v-accent'], ['sets', 'Too many sets', 'v-accent'], ['ok', 'Right amount', 'v-ink']] },
];

export default function FeedbackScreen({ session, ex, unit }: PhaseProps) {
  const key = fbKey(session.id, ex);
  const fb = useFbDraft(key);
  const t = ex.tracking;
  const nextEx = session.exercises.slice(session.cursor + 1).find((e) => e.status === 'todo');
  const rec = fb.weight ? previewRecommendation(ex, fb as Feedback) : null;

  const reps = ex.sets.map((s) => s.reps);
  const weights = ex.sets.map((s) => s.weight);
  const repStr = reps.every((r) => r === reps[0]) ? String(reps[0]) : reps.join(' / ');
  const wStr = weights.every((w) => w === weights[0]) ? dispW(weights[0], unit) : weights.map((w) => dispW(w, unit)).join(' / ');
  const secs = exerciseSeconds({ ...ex, endedAt: ex.endedAt ?? ex.sets[ex.sets.length - 1]?.doneAt });
  const ton = tonnageOf(ex);
  const doneLine = [
    `${ex.sets.length} × ${repStr}${t === 'time' ? ' s' : ''}${t === 'weight_reps' ? (weights[0] ? ` @ ${wStr} ${unit}${eachWord(ex.perHand)}` : ' · bodyweight') : ''}`,
    secs > 0 ? mmss(secs) : null,
    t === 'weight_reps' && ton > 0 ? fmtTonnage(ton, unit) : null,
  ].filter(Boolean).join(' · ');

  let dirLabel = 'Waiting'; let dirCls = ''; let nextLine = planLine(ex.plannedSets, ex.repTarget, ex.plannedWeight, unit, ex); let why: string[] = ['Rate the weight to see the recommendation.'];
  if (rec) {
    nextLine = planLine(rec.sets, rec.reps, rec.weight, unit, ex);
    why = rec.why.split(/(?<=\.)\s+/).filter(Boolean);
    const up = rec.kind === 'weight_up' || rec.kind === 'rep_up' || rec.kind === 'tempo' || rec.kind === 'harder';
    const vol = fb.volume !== 'ok';
    if (up && vol) { dirLabel = 'Adjusted'; dirCls = 'blue'; }
    else if (up) { dirLabel = 'Progress'; dirCls = 'green'; }
    else if (rec.kind === 'weight_down' || rec.kind === 'volume_down') { dirLabel = 'Ease off'; dirCls = 'accent'; }
    else { dirLabel = 'Hold'; dirCls = ''; }
  }
  const pick = (k: keyof Feedback, v: string) => putFbDraft(key, { ...fb, [k]: v } as typeof fb);
  return (
    <>
      <div className="scroll" style={{ paddingTop: 8, paddingBottom: 170 }}>
        <div className="hstack" style={{ padding: '0 2px', gap: 12 }}>
          <span className="check on" aria-hidden="true"><span className="ic ic-check" /></span>
          <div className="grow stack-s" style={{ gap: 2 }}>
            <h1 className="t-title">{ex.name} done</h1>
            <span className="sub" data-testid="done-line">{doneLine}</span>
          </div>
        </div>
        <div className="card" style={{ gap: 18 }}>
          {Q.map((q) => (
            <div key={q.k} className="stack-s" style={{ gap: 8 }}>
              <div className="between"><span className="strong">{q.title}</span><span className="small sub">{q.hint}</span></div>
              <div className="seg c3" role="group" aria-label={q.title}>
                {q.opts.map(([v, label, cls]) => {
                  const on = fb[q.k] === v;
                  return <button key={v} className={on ? `on ${cls}` : ''} aria-pressed={on} onClick={() => pick(q.k, v)} style={{ minHeight: 52 }}>{label}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="card dark" style={{ gap: 12 }} aria-live="polite">
          <div className="between"><span className="eyebrow">Next time</span><span className={`tag ${dirCls}`}>{dirLabel}</span></div>
          <span className="t-num" style={{ fontSize: 32 }} data-testid="next-time">{nextLine}</span>
          <div className="stack-s" style={{ gap: 4 }}>
            {why.map((w) => (
              <span key={w} className="hstack small" style={{ gap: 8, alignItems: 'flex-start', color: '#D9D9D9' }}><span className="ic ic-check xs" style={{ marginTop: 3, color: '#FF5A1F' }} aria-hidden="true" /><span>{w}</span></span>
            ))}
          </div>
        </div>
      </div>
      <div className="bottombar">
        <button className="btn btn-primary" disabled={!fb.weight} onClick={() => { if (fb.weight) saveFeedback(fb as Feedback); }}>
          {!fb.weight ? 'Rate the weight to continue' : nextEx ? `Save · next: ${nextEx.name}` : 'Save · last exercise done'}
        </button>
        <button className="btn btn-ghost" onClick={skipFeedback} style={{ minHeight: 40, fontSize: 14 }}>Skip feedback</button>
      </div>
    </>
  );
}
