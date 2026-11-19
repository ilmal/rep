import { Navigate, useNavigate } from 'react-router-dom';
import OfflineBanner from '../components/OfflineBanner';
import SessionTopbar from '../components/SessionTopbar';
import { useNow } from '../lib/hooks';
import { endWarmup, toggleWarmupItem, useActiveSession, useSessions } from '../store/actions';
import { useStore } from '../store/core';
import { autoAdjust, warmupMedianSec } from '../../shared/rules';
import type { Session } from '../../shared/types';
import '../styles/session.css';

/** Design clock format: minutes zero-padded ("09:40"). */
function mmss(sec: number) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`; }

/** Dry run of exactly what "Warm-up done" would apply if pressed at `at` (exercise 1 becomes active first). */
function previewAdjust(session: Session, at: number) {
  const exercises = session.exercises.map((e, i) => (i === 0 ? { ...e, status: 'active' as const } : e));
  let n = 0;
  return autoAdjust({ now: at, sessionStartedAt: session.startedAt, targetMin: session.targetMin, exercises, cursor: 0, newId: () => `p${n++}` });
}

function overrunMessage(session: Session, now: number, warmElapsed: number): string {
  const cur = previewAdjust(session, now);
  const trim = cur.adjustments.find((a) => a.type === 'trim_rest');
  const drops = cur.adjustments.filter((a) => a.type === 'drop');
  const parts: string[] = [];
  if (trim) {
    const rests = cur.exercises.filter((e, i) => e.status === 'todo' && e.restSec !== session.exercises[i].restSec).map((e) => e.restSec);
    parts.push(`Rest trimmed to ${Math.min(...rests)} s on accessories.`);
  }
  if (drops.length) parts.push(`${drops.map((d) => d.text.replace(/ dropped to save.*$/, '')).join(', ')} ${drops.length > 1 ? 'are' : 'is'} dropped to keep you near ${session.targetMin} min.`);
  else {
    // when would the next exercise be dropped if the warm-up keeps running?
    for (let k = 5; k <= 3600; k += 5) {
      const f = previewAdjust(session, now + k * 1000).adjustments.find((a) => a.type === 'drop');
      if (f) { parts.push(`If you pass ${mmss(warmElapsed + k)}, ${f.text.replace(/ dropped to save.*$/, '')} is dropped to keep you near ${session.targetMin} min.`); break; }
    }
  }
  return parts.length ? parts.join(' ') : `Your plan still fits your ${session.targetMin} min target.`;
}

export default function WarmUp() {
  const session = useActiveSession();
  if (!session) return null; // App guard redirects home
  if (session.phase !== 'warmup') return <Navigate to="/session/live" replace />;
  return <WarmUpInner session={session} />;
}

function WarmUpInner({ session }: { session: Session }) {
  const now = useNow(1000);
  const navigate = useNavigate();
  const sessions = useSessions();
  const fitToTime = useStore((s) => s.settings.fitToTime);
  const items = session.warmupItems ?? [];
  const startedAt = session.warmupStartedAt ?? session.startedAt;
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const target = Math.max(1, session.warmupTargetMin * 60);
  const over = elapsed > target;
  const pct = Math.min(100, (elapsed / target) * 100);
  const avg = warmupMedianSec(sessions);
  const doneCount = items.filter((i) => i.done).length;

  const overrunText = over && fitToTime ? overrunMessage(session, now, elapsed) : '';
  const adjustedNow = over && fitToTime && previewAdjust(session, now).applied;

  const finish = () => { endWarmup(); navigate('/session/live'); };

  return (
    <div className="app">
      <OfflineBanner />
      <SessionTopbar session={session} now={now} />
      <div className="scroll" style={{ paddingTop: 12, paddingBottom: 170 }}>
        <div className="card" style={{ alignItems: 'center', textAlign: 'center', padding: '28px 18px 22px', gap: 16 }}>
          <span className={`tag ${over ? 'accent' : 'green'}`}>{over ? 'Over plan' : 'On plan'}</span>
          <span className="lbl">Warm-up</span>
          <span className="clock" role="timer" aria-live="off">{mmss(elapsed)}</span>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="track"><div className={`fillbar ${over ? 'accent' : ''}`} style={{ width: `${pct}%` }} /></div>
            <div className="between small">
              <span className="sub">Planned {mmss(target)}</span>
              {avg != null && <span className="sub">Your avg {mmss(avg)}</span>}
            </div>
          </div>
        </div>

        {over && (
          <div className="banner warn" role="status">
            <span className="ic ic-clock" aria-hidden="true" />
            <div>
              <span className="b-t">Running {mmss(elapsed - target)} over.{fitToTime && adjustedNow ? ' Plan adjusted.' : ''}</span>
              {fitToTime ? overrunText : 'Your session target time is not adjusted automatically.'}
            </div>
          </div>
        )}

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>Suggested</span><span className="sub" aria-live="polite">{doneCount}/{items.length}</span></div>
        {items.length === 0 ? (
          <p className="sub">No warm-up suggestions for this session.</p>
        ) : (
          <div className="group">
            {items.map((it, i) => (
              <button key={i} className="li" onClick={() => toggleWarmupItem(i)} aria-pressed={it.done}>
                <span className={`check sm ${it.done ? 'on' : ''}`} aria-hidden="true"><span className="ic ic-check sm" /></span>
                <div className="grow"><span className="li-t">{it.name}</span><span className="li-s">{it.meta}</span></div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="bottombar">
        <button className="btn btn-primary" onClick={finish}>Warm-up done <span className="ic ic-arrow-right" aria-hidden="true" /></button>
        <button className="btn btn-ghost" onClick={finish} style={{ minHeight: 40, fontSize: 14 }}>Skip warm-up</button>
      </div>
    </div>
  );
}
