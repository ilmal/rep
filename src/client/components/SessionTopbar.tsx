import { Link } from 'react-router-dom';
import type { Session } from '../../shared/types';
import { hms } from '../lib/format';

/** Topbar shared by WarmUp and Live: overview, "Session N · Area", running session clock, End. */
export default function SessionTopbar({ session, now }: { session: Session; now: number }) {
  return (
    <div className="topbar" style={{ paddingRight: 16 }}>
      <Link className="iconbtn" to="/session/plan" aria-label="Session overview"><span className="ic ic-list" aria-hidden="true" /></Link>
      <div className="grow stack-s" style={{ alignItems: 'center', gap: 0 }}>
        <span className="small strong">Session {session.seq} · {session.areaName}</span>
        <span className="hstack small" style={{ gap: 6, color: '#6B6B6B' }}>
          <span className="live" aria-hidden="true" />
          <span role="timer" aria-label="Session time">{hms(Math.max(0, (now - session.startedAt) / 1000))}</span>
        </span>
      </div>
      <Link className="btn btn-soft btn-sm" to="/session/end">End</Link>
    </div>
  );
}
