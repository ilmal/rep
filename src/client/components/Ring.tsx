/** Segmented weekly ring: `goal` arcs, first `count` filled orange (extra sessions beyond goal are shown only in the label). */
export default function Ring({ count, goal, size = 124, stroke = 13, track = '#ECEBE7', label }: { count: number; goal: number; size?: number; stroke?: number; track?: string; label?: string }) {
  const g = Math.max(1, goal);
  const r = 56;
  const C = 2 * Math.PI * r;
  const gapDeg = g === 1 ? 0 : 8;
  const seg = (C * (360 - gapDeg * g)) / 360 / g;
  const step = C / g;
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" role="img" aria-label={label ?? `${count} of ${goal} sessions this week`}>
      <g transform="rotate(-82 66 66)">
        {Array.from({ length: g }, (_, i) => (
          <circle key={i} cx="66" cy="66" r={r} fill="none" stroke={i < count ? '#FF5A1F' : track} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${Math.max(1, seg - (g === 1 ? 0 : 6))} ${C}`} strokeDashoffset={-i * step} />
        ))}
      </g>
    </svg>
  );
}
