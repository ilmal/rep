import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AREA_TEMPLATES } from '../../shared/exercises';
import { completeOnboarding } from '../store/actions';
import { fitAreas, patchOnboarding, resetOnboarding, useOnboarding } from '../store/x-onboarding';

export default function OnboardAreas() {
  const navigate = useNavigate();
  const o = useOnboarding();
  const picks = fitAreas(o.areas, o.goal);
  const [open, setOpen] = useState(0);
  const [busy, setBusy] = useState(false);

  function pick(slot: number, name: string) {
    const p = [...picks];
    p[slot] = name;
    patchOnboarding({ areas: p });
    setOpen(-1);
  }
  function finish() {
    if (busy) return;
    setBusy(true);
    const gyms = [o.primary, ...o.extra].map((g, i) => ({
      name: g.name.trim() || (i === 0 ? 'My gym' : 'Gym'), template: g.template, lat: g.lat, lng: g.lng,
    }));
    completeOnboarding({ name: o.name.trim() || undefined, goal: o.goal, targetMinutes: o.targetMinutes, warmupMinutes: o.warmupMinutes, gyms, areaNames: picks });
    resetOnboarding();
    // Design: Finish setup -> SignIn (optional 'Save progress', skippable). App's public-route guard currently bounces onboarded users from /signin to Today.
    navigate('/signin', { state: { afterSetup: true } });
  }

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/onboarding/gyms" aria-label="Back"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <div className="grow" style={{ padding: '0 48px 0 8px' }}>
          <div className="segs" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}><span className="on" /><span className="on" /><span className="on" /></div>
        </div>
      </div>
      <div className="scroll" style={{ paddingTop: 16 }}>
        <div className="stack-s">
          <span className="eyebrow">Step 3 of 3</span>
          <h1 className="t-display">Set your rotation</h1>
          <p className="sub">Each session is a focus area, not a fixed list. Exercises are picked fresh each time from what fits the area and your gym.</p>
        </div>
        {picks.map((a, i) => {
          const isOpen = open === i;
          const t = AREA_TEMPLATES.find((x) => x.name === a);
          return (
            <div className="card tight" style={{ gap: 12 }} key={i}>
              <button type="button" className="hstack" style={{ width: '100%', textAlign: 'left', minHeight: 44 }} onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen} aria-label={`Session ${i + 1}: ${a}. Change area`}>
                <span className={`tile ${isOpen ? 'accent' : 'ink'}`}>{i + 1}</span>
                <span className="grow stack-s" style={{ gap: 2 }}><span className="li-t">{a}</span><span className="li-s">{t?.desc}</span></span>
                <span className="ic ic-chev-down" style={{ color: '#B5B1A8' }} aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="wrap">
                  {AREA_TEMPLATES.map((k) => (
                    <button type="button" key={k.name} className={`chip ${k.name === a ? 'on' : ''}`} aria-pressed={k.name === a} onClick={() => pick(i, k.name)}>{k.name}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <p className="sub center" style={{ padding: '4px 12px' }}>Session {picks.length + 1} loops back to Session 1. Extra sessions just continue the rotation.</p>
      </div>
      <div className="bottombar">
        <button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>Finish setup</button>
      </div>
    </div>
  );
}
