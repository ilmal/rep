import { Link } from 'react-router-dom';
import { useWeek } from '../store/actions';

/** Design ring: `goal` rounded arcs on a 132 box (dash = one quarter minus the gap at goal 4 → 70). */
function WelcomeRing({ count, goal }: { count: number; goal: number }) {
  const g = Math.max(1, goal);
  const C = 2 * Math.PI * 56;
  const step = g === 4 ? 87.965 : C / g; // verbatim design numbers at the default goal of 4
  const dash = g === 4 ? 70 : g === 1 ? C : step - 17.966;
  const rest = g === 4 ? 281.86 : C - dash;
  return (
    <svg width="220" height="220" viewBox="0 0 132 132" role="img" aria-label={`Weekly ring, ${count} of ${g} sessions`}>
      <g transform="rotate(-82 66 66)">
        {Array.from({ length: g }, (_, i) => (
          <circle key={i} cx="66" cy="66" r="56" fill="none" stroke={i < count ? '#FF5A1F' : '#E0DED8'} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${dash} ${rest}`} strokeDashoffset={-(i * step)} />
        ))}
      </g>
    </svg>
  );
}

export default function Welcome() {
  const { count, goal } = useWeek();
  return (
    <div className="app">
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 28, padding: '40px 28px 0' }}>
        <div style={{ position: 'relative', width: 220, height: 220 }}>
          <WelcomeRing count={count} goal={goal} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <span className="t-num" style={{ fontSize: 56 }}>{count}/{goal}</span>
            <span className="eyebrow">this week</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
          <h1 className="t-display" style={{ fontSize: 38 }}>Train by the week, not the calendar.</h1>
          <p className="sub" style={{ fontSize: 16, lineHeight: 1.5 }}>Hit your sessions whenever it suits you. The app learns from every set and adapts your next workout to your time, energy and gym.</p>
        </div>
      </div>
      <div style={{ padding: '24px 20px 36px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Link className="btn btn-primary" to="/onboarding/goal">Get started</Link>
        <Link className="btn btn-ghost" to="/signin">I already have an account</Link>
      </div>
    </div>
  );
}
