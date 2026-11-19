// Heart-rate samples: parsing the formats the iPhone can send, validation, and the small maths the UI needs.
//
// Where the data comes from (iOS web apps cannot read Bluetooth or HealthKit): the athlete's AirPods/Watch write heart rate into Apple
// Health; an iPhone automation (the "Health Auto Export" app's REST automation, or a Shortcut) POSTs it to /api/hr/ingest with a
// dedicated write-only key. This module turns whatever arrives into clean samples.

export interface HrSample { at: number; bpm: number; min?: number; max?: number; source?: string }

export const HR_MIN = 25;
export const HR_MAX = 250;
export const MAX_SAMPLES_PER_REQUEST = 5000;
export const FUTURE_SLACK_MS = 5 * 60_000;
export const MAX_AGE_MS = 400 * 24 * 3600_000;
export const INTERVAL_CHOICES = [5, 10, 15, 30, 60] as const;
export const DEFAULT_HR = { enabled: false, intervalMin: 15 as number };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** ms epoch from: number (s or ms), ISO string, or Health Auto Export's "YYYY-MM-DD HH:mm:ss +0100". null when unusable. */
export function parseAt(v: unknown): number | null {
  if (isNum(v)) return v < 1e11 ? Math.round(v * 1000) : Math.round(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  let tz = m[3] ?? 'Z';
  if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]!.length === 5 ? `${m[2]}:00` : m[2]}${tz}`);
  return Number.isFinite(t) ? t : null;
}

const bpmOk = (n: unknown): n is number => isNum(n) && n >= HR_MIN && n <= HR_MAX;
const r1 = (n: number) => Math.round(n * 10) / 10;

function one(o: Record<string, unknown>, now: number, source?: string): HrSample | null {
  const bpm = [o.bpm, o.Avg, o.avg, o.qty, o.value, o.heartRate].find(bpmOk);
  if (bpm === undefined) return null;
  const at = o.at !== undefined ? parseAt(o.at) : o.date !== undefined ? parseAt(o.date) : o.time !== undefined ? parseAt(o.time) : now;
  if (at === null) return null;
  const s: HrSample = { at, bpm: r1(bpm) };
  const mn = o.min ?? o.Min, mx = o.max ?? o.Max;
  if (bpmOk(mn) && bpmOk(mx) && mn <= mx) { s.min = r1(mn); s.max = r1(mx); }
  const src = typeof o.source === 'string' && o.source.trim() ? o.source.trim().slice(0, 80) : source;
  if (src) s.source = src;
  return s;
}

/**
 * Accepts, in order of specificity:
 *   Health Auto Export  {data:{metrics:[{name:"heart_rate", data:[{date, Min, Avg, Max, source}]}]}}
 *   {samples:[{bpm, at?}]}  |  [{bpm, at?}]  |  {bpm, at?}      (at: ms/s epoch or ISO; default = now)
 * Returns accepted samples (deduped on at+source) and how many entries were dropped (bad bpm/time, outside the allowed window).
 */
export function parseIngest(body: unknown, now: number): { samples: HrSample[]; rejected: number } {
  const raw: Record<string, unknown>[] = [];
  const push = (v: unknown) => { if (v && typeof v === 'object' && !Array.isArray(v)) raw.push(v as Record<string, unknown>); };
  const b = body as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(b)) b.forEach(push);
  else if (b && typeof b === 'object') {
    const metrics = (b.data as { metrics?: unknown } | undefined)?.metrics;
    if (Array.isArray(metrics)) {
      for (const m of metrics) {
        const mm = m as { name?: unknown; data?: unknown };
        if (typeof mm?.name === 'string' && /^heart[_ ]?rate$/i.test(mm.name) && Array.isArray(mm.data)) mm.data.forEach(push);
      }
    } else if (Array.isArray(b.samples)) b.samples.forEach(push);
    else push(b);
  }
  const out = new Map<string, HrSample>();
  let rejected = 0;
  for (const o of raw.slice(0, MAX_SAMPLES_PER_REQUEST)) {
    const s = one(o, now);
    if (!s || s.at > now + FUTURE_SLACK_MS || s.at < now - MAX_AGE_MS) { rejected++; continue; }
    out.set(`${s.at}|${s.source ?? ''}`, s);
  }
  rejected += Math.max(0, raw.length - MAX_SAMPLES_PER_REQUEST);
  return { samples: [...out.values()].sort((a, c) => a.at - c.at), rejected };
}

export interface HrSummary { count: number; avg: number; min: number; max: number }
/** avg is time-agnostic (mean of readings); min/max use the per-reading min/max when present. null for no samples. */
export function summarize(samples: readonly HrSample[]): HrSummary | null {
  if (!samples.length) return null;
  let sum = 0, mn = Infinity, mx = -Infinity;
  for (const s of samples) { sum += s.bpm; mn = Math.min(mn, s.min ?? s.bpm); mx = Math.max(mx, s.max ?? s.bpm); }
  return { count: samples.length, avg: Math.round(sum / samples.length), min: Math.round(mn), max: Math.round(mx) };
}

export const samplesBetween = (samples: readonly HrSample[], from: number, to: number) => samples.filter((s) => s.at >= from && s.at <= to);

/** Five-zone model on % of max HR (the standard 50/60/70/80/90 split). null when below zone 1. */
export function zoneOf(bpm: number, maxHr: number): 1 | 2 | 3 | 4 | 5 | null {
  if (!isNum(bpm) || !isNum(maxHr) || maxHr < 100) return null;
  const p = bpm / maxHr;
  return p >= 0.9 ? 5 : p >= 0.8 ? 4 : p >= 0.7 ? 3 : p >= 0.6 ? 2 : p >= 0.5 ? 1 : null;
}
export const ZONE_NAMES = ['', 'Easy', 'Fat burn', 'Aerobic', 'Hard', 'Max'] as const;
/** Tanaka formula (208 - 0.7 x age); a sane default when the athlete has not set a max. */
export const estimateMaxHr = (age: number): number => Math.round(208 - 0.7 * Math.min(100, Math.max(10, age)));

export function agoText(now: number, at: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Stale = no reading for 2.5x the chosen interval (min 10 min): the automation probably stopped. */
export const isStale = (now: number, lastAt: number | null | undefined, intervalMin: number): boolean =>
  !isNum(lastAt) || now - lastAt > Math.max(10, intervalMin * 2.5) * 60_000;
