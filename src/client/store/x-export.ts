// Settings → "Export all data": CSV (one row per logged set, with timing + feedback) and JSON (everything).
// Built from the local store so it works offline and never depends on the server.
import { getState } from './core';
import type { Session } from '../../shared/types';

export const CSV_COLUMNS = [
  'session_id', 'session_no', 'status', 'date', 'area', 'gym', 'started_at', 'ended_at', 'session_minutes', 'warmup_minutes', 'target_minutes', 'ended_early',
  'exercise_no', 'exercise', 'exercise_status', 'swapped_from', 'set_no', 'weight_kg', 'reps', 'seconds', 'set_started_at', 'set_done_at', 'rest_seconds',
  'exercise_started_at', 'exercise_ended_at', 'effort', 'weight_feedback', 'volume_feedback', 'next_recommendation', 'pr', 'session_note',
] as const;

const iso = (t?: number) => (t ? new Date(t).toISOString() : '');
const mins = (a?: number, b?: number) => (a && b && b >= a ? String(Math.round(((b - a) / 60000) * 10) / 10) : '');

/** RFC 4180 quoting; text cells that start with = + - @ are prefixed with ' so spreadsheets never run them as formulas. */
export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sessionsToCsv(sessions: Session[]): string {
  const rows: unknown[][] = [];
  const list = [...sessions].filter((s) => s.status === 'completed' || s.status === 'active').sort((a, b) => a.startedAt - b.startedAt);
  for (const s of list) {
    const head = [s.id, s.seq, s.status, iso(s.startedAt).slice(0, 10), s.areaName, s.gymName, iso(s.startedAt), iso(s.endedAt), mins(s.startedAt, s.endedAt), mins(s.warmupStartedAt, s.warmupEndedAt), s.targetMin, s.endedEarly ? 'yes' : 'no'];
    const tail = (e: Session['exercises'][number]) => [iso(e.startedAt), iso(e.endedAt), e.feedback?.effort, e.feedback?.weight, e.feedback?.volume, e.recommendation ? `${e.recommendation.tag}: ${e.recommendation.sets}x${e.recommendation.reps} @ ${e.recommendation.weight} kg` : '', e.pr ? 'yes' : 'no', s.note];
    s.exercises.forEach((e, i) => {
      const ex = [i + 1, e.name, e.status, e.swappedFrom?.name];
      if (!e.sets.length) rows.push([...head, ...ex, '', '', '', '', '', '', '', ...tail(e)]);
      else e.sets.forEach((set, k) => rows.push([...head, ...ex, k + 1, set.weight, set.reps, set.seconds, iso(set.startedAt), iso(set.doneAt), set.restSec, ...tail(e)]));
    });
    if (!s.exercises.length) rows.push([...head, ...Array(18).fill(''), s.note]);
  }
  return [CSV_COLUMNS.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export function buildJsonExport(): string {
  const s = getState();
  return JSON.stringify({
    app: 'Rep', exportedAt: new Date().toISOString(), units: 'weights are kilograms',
    account: { email: s.device.email ?? null },
    settings: s.settings, gyms: Object.values(s.gyms), areas: Object.values(s.areas), customExercises: Object.values(s.exercises),
    exercisePreferences: Object.values(s.prefs), progress: Object.values(s.progress), sessions: Object.values(s.sessions), coachPlans: Object.values(s.plans),
  }, null, 2);
}

export function buildCsvExport(): string { return sessionsToCsv(Object.values(getState().sessions)); }

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
export function downloadCsv() { download(`rep-export-${stamp()}.csv`, '﻿' + buildCsvExport(), 'text/csv;charset=utf-8'); }
export function downloadJson() { download(`rep-export-${stamp()}.json`, buildJsonExport(), 'application/json'); }
