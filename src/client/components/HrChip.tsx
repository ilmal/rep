import { useSettings } from '../store/actions';
import { useLatestHr } from '../store/x-hr';
import { zoneOf, ZONE_NAMES } from '../../shared/heartrate';

/** Live pulse for the session topbar. Renders nothing unless heart rate is switched on in Settings. During a workout readings should
 *  arrive about every minute, so anything older than 5 minutes is shown as "no recent reading" instead of a stale number. */
export default function HrChip({ now }: { now: number }) {
  const hr = useSettings().heartRate;
  const on = !!hr?.enabled;
  const { latest } = useLatestHr(on);
  if (!on) return null;
  const fresh = !!latest && now - latest.at <= 5 * 60_000;
  const bpm = fresh ? Math.round(latest!.bpm) : null;
  const zone = bpm !== null && hr?.maxHr ? zoneOf(bpm, hr.maxHr) : null;
  return (
    <span className="hrchip" data-testid="hr-chip" data-zone={zone ?? ''} data-state={bpm === null ? 'none' : 'live'}
      title={bpm !== null ? `${bpm} bpm${zone ? ` · ${ZONE_NAMES[zone]}` : ''}` : 'No recent heart-rate reading'}>
      <span className="ic ic-heart-pulse sm" aria-hidden="true" />
      <b>{bpm ?? '--'}</b>
      <span className="sr-only">{bpm !== null ? ` beats per minute${zone ? `, ${ZONE_NAMES[zone]} zone` : ''}` : 'No recent heart-rate reading'}</span>
    </span>
  );
}
