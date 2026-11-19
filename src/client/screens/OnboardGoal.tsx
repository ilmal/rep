import { Link } from 'react-router-dom';
import { patchOnboarding, useOnboarding } from '../store/x-onboarding';

const HINTS: Record<number, string> = {
  1: 'A light week. Every session counts.', 2: 'Good for maintenance.', 3: 'Solid, balanced progress.', 4: 'Recommended. Room to hit every area.',
  5: 'High volume. Recovery matters.', 6: 'Very high volume.', 7: 'Every day. Mix in prehab and mobility.',
};
const TIMES = [45, 60, 75, 90];

export default function OnboardGoal() {
  const o = useOnboarding();
  const { goal, targetMinutes: time, warmupMinutes: warm } = o;
  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/welcome" aria-label="Back"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <div className="grow" style={{ padding: '0 48px 0 8px' }}>
          <div className="segs" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}><span className="on" /><span /><span /></div>
        </div>
      </div>
      <div className="scroll" style={{ paddingTop: 16 }}>
        <div className="stack-s">
          <span className="eyebrow">Step 1 of 3</span>
          <h1 className="t-display">Your weekly goal</h1>
          <p className="sub">No fixed days. Train whenever, and the week counter fills up. You can change this anytime.</p>
        </div>

        <div className="card" style={{ alignItems: 'center', gap: 10, padding: '24px 18px' }}>
          <span className="lbl">Sessions per week</span>
          <div className="stepctl" style={{ maxWidth: 280 }}>
            <button type="button" className="stepbtn on-white" aria-label="Fewer sessions" disabled={goal <= 1} onClick={() => patchOnboarding({ goal: Math.max(1, goal - 1) })} style={{ width: 56, height: 56, borderRadius: 28 }}><span className="ic ic-minus lg" aria-hidden="true" /></button>
            <span className="t-num" style={{ fontSize: 88 }} aria-live="polite">{goal}</span>
            <button type="button" className="stepbtn on-white" aria-label="More sessions" disabled={goal >= 7} onClick={() => patchOnboarding({ goal: Math.min(7, goal + 1) })} style={{ width: 56, height: 56, borderRadius: 28 }}><span className="ic ic-plus lg" aria-hidden="true" /></button>
          </div>
          <div className="segs" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${goal}, minmax(0, 1fr))`, width: '100%', maxWidth: 280 }}>
            {Array.from({ length: goal }, (_, i) => <span key={i} className="now" />)}
          </div>
          <p className="sub center">{HINTS[goal]}</p>
        </div>

        <div className="card">
          <div className="stack-s">
            <span className="strong">Target time in the gym</span>
            <span className="sub">Sessions are planned to fit. Warm-up included.</span>
          </div>
          <div className="seg c4">
            {TIMES.map((m) => (
              <button type="button" key={m} className={time === m ? 'on' : ''} aria-pressed={time === m} onClick={() => patchOnboarding({ targetMinutes: m })}>{m} min</button>
            ))}
          </div>
          <div className="divider" />
          <div className="between">
            <div className="stack-s"><span className="strong">Warm-up</span><span className="sub">Tracked separately</span></div>
            <div className="hstack">
              <button type="button" className="stepbtn sm on-white" aria-label="Shorter warm-up" disabled={warm <= 0} onClick={() => patchOnboarding({ warmupMinutes: Math.max(0, warm - 1) })}><span className="ic ic-minus sm" aria-hidden="true" /></button>
              <span className="val sm" style={{ minWidth: 64 }}>{warm}<span className="unit">min</span></span>
              <button type="button" className="stepbtn sm on-white" aria-label="Longer warm-up" disabled={warm >= 30} onClick={() => patchOnboarding({ warmupMinutes: Math.min(30, warm + 1) })}><span className="ic ic-plus sm" aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      </div>
      <div className="bottombar">
        <Link className="btn btn-primary" to="/onboarding/gyms">Continue</Link>
      </div>
    </div>
  );
}
