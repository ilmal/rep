import { useEffect, useId, useState, type ReactNode } from 'react';

/** Design stepper: − value + (see Plan artboard). */
export function Stepper({ value, onDec, onInc, decLabel, incLabel, unit, minWidth = 48, decDisabled, incDisabled }: {
  value: ReactNode; onDec: () => void; onInc: () => void; decLabel: string; incLabel: string; unit?: string; minWidth?: number;
  decDisabled?: boolean; incDisabled?: boolean;
}) {
  return (
    <div className="hstack">
      <button type="button" className="stepbtn sm on-white" aria-label={decLabel} onClick={onDec} disabled={decDisabled}><span className="ic ic-minus sm" aria-hidden="true" /></button>
      <span className="val sm" style={{ minWidth }}>{value}{unit ? <span className="unit">{unit}</span> : null}</span>
      <button type="button" className="stepbtn sm on-white" aria-label={incLabel} onClick={onInc} disabled={incDisabled}><span className="ic ic-plus sm" aria-hidden="true" /></button>
    </div>
  );
}

const RANGE_CSS = `
.range{-webkit-appearance:none;appearance:none;width:100%;height:44px;background:transparent;margin:0;cursor:pointer;--p:50%}
.range:focus{outline:none}
.range::-webkit-slider-runnable-track{height:8px;border-radius:4px;background:linear-gradient(to right,var(--ink) var(--p),var(--fill) var(--p))}
.range::-moz-range-track{height:8px;border-radius:4px;background:var(--fill)}
.range::-moz-range-progress{height:8px;border-radius:4px;background:var(--ink)}
.range::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);margin-top:-10px;border:0}
.range::-moz-range-thumb{width:28px;height:28px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);border:0}
.range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px var(--accent),0 2px 6px rgba(0,0,0,.3)}
.range:disabled{opacity:.5}
`;

/** Range input styled to the system. Updates a local value while dragging and calls onCommit once on release / key-up. */
export function Slider({ value, min, max, step, onCommit, onLive, label, format }: {
  value: number; min: number; max: number; step: number; onCommit: (v: number) => void; onLive?: (v: number) => void; label: string;
  format?: (v: number) => string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const id = useId();
  const pct = ((v - min) / (max - min)) * 100;
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <>
      <style>{RANGE_CSS}</style>
      <input
        id={id} className="range" type="range" min={min} max={max} step={step} value={v} aria-label={label}
        aria-valuetext={format ? format(v) : undefined}
        style={{ ['--p' as string]: `${pct}%` }}
        onChange={(e) => { const n = Number(e.target.value); setV(n); onLive?.(n); }}
        onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit}
      />
    </>
  );
}
