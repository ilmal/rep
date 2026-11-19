import { Link } from 'react-router-dom';
import type { Session } from '../../../shared/types';
import { hms } from '../../lib/format';
import HrChip from '../../components/HrChip';

/** Live topbar: overview, "Session N · Area", running clock + minutes left vs target, End. `back` swaps overview/End for the feedback screen's back chevron. */
export default function LiveTopbar({ session, now, onBack }: { session: Session; now: number; onBack?: () => void }) {
  const elapsed = Math.max(0, (now - session.startedAt) / 1000);
  const left = Math.round((session.targetMin * 60 - elapsed) / 60);
  const leftTxt = left >= 0 ? `${left} min left` : `${-left} min over`;
  return (
    <div className="topbar" style={{ paddingRight: 16 }}>
      {onBack
        ? <button className="iconbtn" aria-label="Back to sets" onClick={onBack}><span className="ic ic-chev-left lg" aria-hidden="true" /></button>
        : <Link className="iconbtn" to="/session/plan" aria-label="Session overview"><span className="ic ic-list" aria-hidden="true" /></Link>}
      <div className="grow stack-s" style={{ alignItems: 'center', gap: 0 }}>
        <span className="small strong">Session {session.seq} · {session.areaName}</span>
        <span className="hstack small" style={{ gap: 6, color: '#6B6B6B', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="live" aria-hidden="true" />
          <span><span role="timer" aria-label="Session time">{hms(elapsed)}</span>{onBack ? '' : <> · <span data-testid="time-left">{leftTxt}</span></>}</span>
          <HrChip now={now} />
        </span>
      </div>
      {onBack ? <span className="spacer" /> : <Link className="btn btn-soft btn-sm" to="/session/end">End</Link>}
    </div>
  );
}
