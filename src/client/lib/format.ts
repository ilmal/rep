import { EQUIP_BY_ID } from '../../shared/catalog';
import type { Unit } from '../../shared/types';

export const pad = (n: number) => (n < 10 ? '0' : '') + n;
export function mmss(sec: number) { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; }
export function hms(sec: number) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600); return `${h}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`; }
export const minutes = (sec: number) => Math.round(sec / 60);

const KG_PER_LB = 0.45359237;
export const toDisplay = (kg: number, unit: Unit) => (unit === 'lb' ? Math.round((kg / KG_PER_LB) * 2) / 2 : Math.round(kg * 10) / 10);
export const fromDisplay = (v: number, unit: Unit) => (unit === 'lb' ? Math.round(v * KG_PER_LB * 100) / 100 : v);
export const fmtLoad = (kg: number, unit: Unit) => `${toDisplay(kg, unit)} ${unit}`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dayShort = (t: number) => { const d = new Date(t); return `${DAYS[d.getDay()]} ${d.getDate()}`; };
export const dateShort = (t: number) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const dateLong = (t: number) => { const d = new Date(t); return `${FULL_DAYS[d.getDay()]}, ${d.getDate()} ${FULL_MONTHS[d.getMonth()]}`; };
export const monthShort = (t: number) => MONTHS[new Date(t).getMonth()];

export function ago(t: number, nowMs = Date.now()) {
  const s = Math.round((nowMs - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** "4 × 6 @ 82.5 kg" style prescription line. */
export function rxLine(sets: number, reps: number, weight: number, unit: Unit, tracking: 'weight_reps' | 'reps' | 'time' = 'weight_reps', perHand = false) {
  if (tracking === 'time') return `${sets} × ${reps} s`;
  if (tracking === 'reps' || !weight) return `${sets} × ${reps}${tracking === 'reps' ? '' : ''}`;
  return `${sets} × ${reps} @ ${perHand ? '2 × ' : ''}${toDisplay(weight, unit)} ${unit}`;
}

/** Short equipment summary for a small gym: the first few items as lowercase words ("dumbbells, bench, bands"). */
export function equipSummary(g: { equipment: Record<string, string> }, max = 3): string {
  const words: string[] = [];
  for (const [id, st] of Object.entries(g.equipment)) {
    if (st === 'none') continue;
    const name = (EQUIP_BY_ID[id]?.name ?? id).toLowerCase().replace(/\s*\(.*\)$/, '').replace(/^(adjustable|flat|resistance|step \/ plyo)\s+/, '').replace(/^(pull-up) bar$/, '$1 bar');
    if (!words.includes(name)) words.push(name);
  }
  return words.slice(0, max).join(', ');
}
