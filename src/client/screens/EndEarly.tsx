import { goalForWeek } from '../../shared/streak';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { hms } from '../lib/format';
import { useNow } from '../lib/hooks';
import { useActiveSession, useSessions, useSettings } from '../store/actions';
import { END_REASONS, endSession } from '../store/x-session-end';
import { weekCount } from '../../shared/rules';
import type { Session } from '../../shared/types';
import '../styles/session.css';

export default function EndEarly() {
  const session = useActiveSession();
  if (!session) return null; // guard redirects; also the moment after saving
  return <EndInner session={session} />;
}

function EndInner({ session }: { session: Session }) {
  const navigate = useNavigate();
  const now = useNow(1000);
  const sessions = useSessions();
  const settings = useSettings();
  const { rotation } = settings;
  const weeklyGoal = goalForWeek(settings, now);
  const [choice, setChoice] = useState<'save' | 'repeat' | 'discard'>('save');
  const [reasons, setReasons] = useState<string[]>([]);
  const live = session.exercises.filter((e) => e.status !== 'dropped');
  const done = live.filter((e) => e.status === 'done' || (e.sets.length > 0 && e.status !== 'skipped')).length;
  const notStarted = live.filter((e) => (e.status === 'todo' || e.status === 'active') && e.sets.length === 0).length;
  const elapsed = Math.max(0, (now - session.startedAt) / 1000);
  const mins = Math.round(elapsed / 60);
  const weekAfter = weekCount(sessions, now) + 1;
  const nextSession = rotation.length ? (session.slot % rotation.length) + 1 : null;
  const ex = session.exercises[session.cursor];
  const exN = Math.max(1, live.findIndex((e) => e.id === ex?.id) + 1);

  if (!ex && session.exercises.length) return <Navigate to="/session/plan" replace />;

  const go = () => {
    if (choice === 'save' || choice === 'repeat') {
      const id = endSession('save', { repeatNext: choice === 'repeat', reasons });
      navigate(id ? `/session/summary/${id}` : '/', { replace: true });
    } else {
      endSession('discard', { reasons });
      navigate('/', { replace: true });
    }
  };
  const keep = () => navigate(-1);

  const opts = [
    { key: 'save' as const, title: 'Save as completed', sub: `Counts this week (${weekAfter}/${weeklyGoal}).${nextSession ? ` Next up: session ${nextSession}.` : ''}` },
    { key: 'repeat' as const, title: `Save, but repeat session ${session.slot} next`, sub: `Counts this week. Rotation stays on ${session.areaName}.` },
    { key: 'discard' as const, title: 'Discard session', sub: 'Deletes logged sets. Doesn’t count.' },
  ];

  return (
    <div className="app">
      <div className="topbar" aria-hidden="true"><span className="iconbtn"><span className="ic ic-list" /></span><span className="title small">Session {session.seq} · {session.areaName}</span><span className="spacer" /></div>
      <div className="scroll" aria-hidden="true" style={{ paddingTop: 8 }}>
        <span className="eyebrow">Exercise {exN} of {live.length}</span>
        <h1 className="t-display">{ex?.name}</h1>
        <div className="card" style={{ height: 260 }} />
      </div>
      <button className="scrim" aria-label="Keep training" onClick={keep} />
      <div className="sheet" role="dialog" aria-label="End session early">
        <div className="grabber" />
        <div className="stack-s" style={{ gap: 4 }}>
          <h2 className="t-title">End session early?</h2>
          <p className="sub" role="timer" aria-live="off">{done} of {live.length} exercises done · {mins < 1 ? hms(elapsed).slice(2) : `${mins} min`} · {notStarted} not started</p>
        </div>
        <div className="group" role="radiogroup" aria-label="What to do with this session">
          {opts.map((o) => (
            <button key={o.key} className="li" role="radio" aria-checked={choice === o.key} onClick={() => setChoice(o.key)}>
              <span className={`radio ${choice === o.key ? 'on' : ''}`} aria-hidden="true" />
              <div className="grow"><span className="li-t" style={o.key === 'discard' ? { color: '#B42318' } : undefined}>{o.title}</span><span className="li-s">{o.sub}</span></div>
            </button>
          ))}
        </div>
        <div className="stack-s" style={{ gap: 8 }}>
          <span className="lbl" id="end-why">Why? (optional, helps planning)</span>
          <div className="wrap" role="group" aria-labelledby="end-why">
            {END_REASONS.map((r) => {
              const on = reasons.includes(r);
              return <button key={r} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setReasons(on ? reasons.filter((x) => x !== r) : [...reasons, r])}>{r}</button>;
            })}
          </div>
        </div>
        <button className={`btn ${choice === 'discard' ? 'btn-danger' : 'btn-primary'}`} onClick={go}>{choice === 'discard' ? 'Discard session' : 'End & save'}</button>
        <button className="btn btn-ghost" onClick={keep} style={{ minHeight: 40 }}>Keep training</button>
      </div>
    </div>
  );
}
