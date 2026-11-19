import { Link, useNavigate } from 'react-router-dom';
import { hms } from '../../lib/format';
import { finishSession } from '../../store/actions';
import type { PhaseProps } from './common';

export default function Done({ session, now, exCount }: PhaseProps) {
  const navigate = useNavigate();
  const doneCount = session.exercises.filter((e) => e.status === 'done').length;
  const el = Math.max(0, (now - session.startedAt) / 1000);
  const finish = () => { const id = finishSession(); if (id) navigate(`/session/summary/${id}`, { replace: true }); };
  return (
    <div className="focus" style={{ alignItems: 'center', textAlign: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ width: 88, height: 88, borderRadius: 44, background: '#121212', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ic ic-check xxl" aria-hidden="true" /></div>
      <h1 className="t-display">All exercises done</h1>
      <p className="sub" data-testid="done-summary">{doneCount} of {exCount} exercises · {el >= 3600 ? hms(el) : hms(el).replace(/^0:/, '')} in the gym</p>
      <div style={{ height: 24 }} />
      <button className="btn btn-accent go" onClick={finish} style={{ width: '100%' }}>Finish session</button>
      <Link className="btn btn-ghost" to="/session/plan" style={{ width: '100%' }}>Review before finishing</Link>
    </div>
  );
}
