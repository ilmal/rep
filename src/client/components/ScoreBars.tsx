import type { ScoreBreakdown } from '../../shared/planner';

const ROWS: { key: 'relevance' | 'recency' | 'frequency' | 'coverage' | 'favorite'; label: string; hint: string }[] = [
  { key: 'relevance', label: 'Relevance', hint: 'How much you want it in your plan' },
  { key: 'recency', label: 'Recency', hint: 'Time since you last did it' },
  { key: 'frequency', label: 'Frequency', hint: 'Higher when you do it less often' },
  { key: 'coverage', label: 'Muscle coverage', hint: 'Muscles that are due' },
  { key: 'favorite', label: 'Favorite', hint: 'Starred exercises get a boost' },
];

/** Breakdown bars (0–100) for one exercise score. */
export function ScoreBars({ s }: { s: ScoreBreakdown }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {ROWS.map((r) => (
        <div key={r.key} className="stack-s" style={{ gap: 6 }}>
          <div className="between"><span className="small strong">{r.label}</span><span className="small sub">{Math.round(s[r.key])}</span></div>
          <div className="track thin" role="img" aria-label={`${r.label} ${Math.round(s[r.key])} of 100. ${r.hint}`}>
            <div className={`fillbar${r.key === 'favorite' ? ' accent' : ''}`} style={{ width: `${Math.max(0, Math.min(100, s[r.key]))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact score chip; shows a cooling-down state when the exercise was done too recently. */
export function ScoreChip({ s }: { s: ScoreBreakdown | undefined }) {
  if (!s) return null;
  const n = Math.round(s.total);
  if (s.coolingDown) return <span className="tag blue" title={`Score ${n}, cooling down`}><span className="ic ic-clock sm" aria-hidden="true" />Cooling · {n}</span>;
  return <span className={`tag ${n >= 65 ? 'green' : n >= 40 ? 'accent' : ''}`} title={`Planner score ${n}`}>{n}</span>;
}
