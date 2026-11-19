import { useMemo } from 'react';
import { useSettings } from '../store/actions';
import { useHrRange } from '../store/x-hr';
import { summarize } from '../../shared/heartrate';

/** Average / max / min pulse with a sparkline for a time window (a finished session). Renders nothing while loading or when off. */
export default function HrCard({ from, to }: { from: number; to: number }) {
  const hr = useSettings().heartRate;
  const samples = useHrRange(hr?.enabled ? from : null, hr?.enabled ? to : null);
  const sum = useMemo(() => (samples ? summarize(samples) : null), [samples]);
  const path = useMemo(() => {
    if (!samples || samples.length < 2) return '';
    const lo = Math.min(...samples.map((s) => s.bpm)), hi = Math.max(...samples.map((s) => s.bpm)), span = Math.max(1, hi - lo);
    return samples.map((s, i) => `${i ? 'L' : 'M'}${(((s.at - from) / Math.max(1, to - from)) * 300).toFixed(1)} ${(34 - ((s.bpm - lo) / span) * 30).toFixed(1)}`).join('');
  }, [samples, from, to]);
  if (!hr?.enabled || samples === null) return null;
  if (!sum) return (
    <div className="card tight" data-testid="hr-card" data-empty="1"><div className="hstack" style={{ gap: 10 }}><span className="ic ic-heart-pulse" aria-hidden="true" /><span className="sub">No heart-rate readings for this session.</span></div></div>
  );
  return (
    <div className="card tight" data-testid="hr-card">
      <div className="between"><span className="t-h">Heart rate</span><span className="ic ic-heart-pulse" aria-hidden="true" style={{ color: '#E5484D' }} /></div>
      <div className="hr-stats">
        <div><span className="t-num" data-testid="hr-avg">{sum.avg}</span><span className="small">avg bpm</span></div>
        <div><span className="t-num" data-testid="hr-max">{sum.max}</span><span className="small">max</span></div>
        <div><span className="t-num" data-testid="hr-min">{sum.min}</span><span className="small">min</span></div>
      </div>
      {path && <svg className="hr-spark" viewBox="0 0 300 38" preserveAspectRatio="none" role="img" aria-label="Heart rate over the session"><path d={path} fill="none" stroke="#E5484D" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>}
    </div>
  );
}
