import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useActiveSession, useSettings } from '../store/actions';
import { discardActive, finishAtLastSet, lastSetAt } from '../store/x-session-end';
import { useNow } from '../lib/hooks';
import { dateLong, hms } from '../lib/format';

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export default function Resume() {
  const session = useActiveSession();
  const settings = useSettings();
  const now = useNow(1000);
  const navigate = useNavigate();
  const [step, setStep] = useState<'main' | 'discard'>('main');
  const leaving = useRef<string | null>(null); // where we are headed once the session is gone (beats the plain redirect)
  if (!session) return <Navigate to={leaving.current ?? '/'} replace />;

  const live = session.exercises.filter((e) => e.status !== 'dropped');
  const done = live.filter((e) => e.status === 'done').length;
  const logged = live.filter((e) => e.sets.length > 0).length;
  const lastSet = lastSetAt(session);
  const name = settings.name.trim();
  const target = session.phase === 'warmup' ? '/session/warmup' : '/session/live';

  const finish = () => {
    const id = finishAtLastSet();
    leaving.current = id ? `/session/summary/${id}` : '/';
    navigate(leaving.current, { replace: true });
  };
  const discard = () => { leaving.current = '/'; discardActive(); navigate('/', { replace: true }); };

  return (
    <div className="app">
      <div className="scroll" style={{ paddingTop: 24 }} aria-hidden="true">
        <span className="eyebrow">{dateLong(now)}</span>
        <h1 className="t-display">Hi {name || 'there'}</h1>
        <div className="card" style={{ height: 220 }} />
        <div className="card dark" style={{ height: 300 }} />
      </div>
      <div className="scrim" />
      <div className="dialog" role="alertdialog" aria-label="Unfinished session">
        {step === 'main' ? (
          <div className="stack" style={{ gap: 12 }}>
            <div className="hstack" style={{ gap: 8 }}><span className="live" aria-hidden="true" /><span className="eyebrow">Unfinished session</span></div>
            <h2 className="t-title">Session {session.slot} is still running</h2>
            <span className="t-num" style={{ fontSize: 44 }} role="timer">{hms((now - session.startedAt) / 1000)}</span>
            <p className="sub">
              {session.phase === 'warmup' ? 'In warm-up. ' : ''}Started {hhmm(session.startedAt)}{session.gymName ? ` at ${session.gymName}` : ''}. {done} of {live.length} exercises done.{lastSet ? ` Last set logged ${hhmm(lastSet)}.` : ''}
            </p>
            <Link className="btn btn-primary" to={target}><span className="ic ic-play" aria-hidden="true" />Resume</Link>
            {lastSet > 0 && <button className="btn btn-soft" onClick={finish}>Finish &amp; save at {hhmm(lastSet)}</button>}
            <button className="btn btn-ghost" style={{ color: '#B42318' }} onClick={() => setStep('discard')}>Discard session</button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="empty-ic red" style={{ width: 64, height: 64, alignSelf: 'center' }}><span className="ic ic-trash xl" aria-hidden="true" /></div>
            <h2 className="t-h center">Discard session {session.slot}?</h2>
            <p className="sub center">
              {logged === 0 ? 'Nothing is logged yet. ' : `${logged} logged ${logged === 1 ? 'exercise' : 'exercises'} and their timing will be deleted. `}It won't count toward this week, and session {session.slot} stays next in the rotation.
            </p>
            <button className="btn btn-danger" onClick={discard}>Discard</button>
            <button className="btn btn-soft" onClick={() => setStep('main')}>Go back</button>
          </div>
        )}
      </div>
    </div>
  );
}
