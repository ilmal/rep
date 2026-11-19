import type { Session, SessionExercise, Unit } from '../../../shared/types';
import { toDisplay } from '../../lib/format';

export interface PhaseProps { session: Session; ex: SessionExercise; now: number; unit: Unit; flash: (m: string) => void; exN: number; exCount: number }

export const dispW = (kg: number, unit: Unit) => String(toDisplay(kg, unit));
export const eachWord = (perHand?: boolean) => (perHand ? ' each' : '');

/** "4 × 6 @ 82.5 kg" (per-hand lifts read "@ 10 kg each", bodyweight "@ BW"). */
export function planLine(sets: number, reps: number, weight: number, unit: Unit, ex: Pick<SessionExercise, 'tracking' | 'perHand'>) {
  if (ex.tracking === 'time') return `${sets} × ${reps} s`;
  if (ex.tracking === 'reps') return `${sets} × ${reps}`;
  return `${sets} × ${reps} @ ${weight ? `${dispW(weight, unit)} ${unit}${eachWord(ex.perHand)}` : 'BW'}`;
}
