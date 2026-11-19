import { Link } from 'react-router-dom';
import { hms, mmss, rxLine } from '../lib/format';
import { useNow } from '../lib/hooks';
import { dropExercise, moveUpcoming, reapplyAdjustment, undoAdjustmentById, useActiveSession, useSettings } from '../store/actions';
import type { Adjustment, Session, SessionExercise } from '../../shared/types';
import '../styles/session.css';

export default function SessionPlan() {
  const session = useActiveSession();
  if (!session) return null;
  return <PlanInner session={session} />;
}

const WEIGHT_LABEL = { light: 'Too light', right: 'Just right', heavy: 'Too heavy' } as const;

function PlanInner({ session }: { session: Session }) {
  const now = useNow(1000);
  const unit = useSettings().unit;
  const warm = session.phase === 'warmup';
  const back = warm ? '/session/warmup' : '/session/live';
  const exs = session.exercises;
  const elapsed = Math.max(0, Math.floor((now - session.startedAt) / 1000));
  const target = session.targetMin * 60;

  const warmElapsed = warm ? Math.max(0, Math.floor((now - (session.warmupStartedAt ?? session.startedAt)) / 1000))
    : Math.max(0, Math.round(((session.warmupEndedAt ?? session.startedAt) - (session.warmupStartedAt ?? session.startedAt)) / 1000));
  const warmOver = Math.max(0, warmElapsed - session.warmupTargetMin * 60);
  const warmRemaining = warm ? Math.max(0, session.warmupTargetMin * 60 - warmElapsed) : 0;
  const remainingOf = (e: SessionExercise, i: number): number => {
    if (e.status === 'todo' || (i === session.cursor && !warm && e.status === 'active')) {
      if (e.status === 'active') return Math.round(e.estSec * Math.max(0, e.plannedSets - e.sets.length) / Math.max(1, e.plannedSets));
      return e.estSec;
    }
    return 0;
  };
  const remaining = warmRemaining + exs.reduce((a, e, i) => a + remainingOf(e, i), 0);
  const projected = elapsed + remaining;
  const projMin = Math.round(projected / 60);
  const overMin = Math.round((projected - target) / 60);
  const scale = Math.max(projected, target, 1);
  const doneLift = Math.max(0, elapsed - warmElapsed);
  const w = (sec: number) => `${Math.max(0, (sec / scale) * 100)}%`;

  // An adjustment is "in effect" while its drop is still dropped; adding the exercise back by hand counts as undone.
  const inEffect = (a: Adjustment) => !a.undone && (a.type !== 'drop' || !a.exerciseId || exs.find((e) => e.id === a.exerciseId)?.status === 'dropped');
  const activeAdj = session.adjustments.filter(inEffect);
  const inactiveAdj = session.adjustments.filter((a) => !inEffect(a));
  const reapply = (a: Adjustment) => { if (a.undone) reapplyAdjustment(a.id); else if (a.exerciseId) dropExercise(a.exerciseId, true); };

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to={back} aria-label="Close overview"><span className="ic ic-chev-down lg" aria-hidden="true" /></Link>
        <span className="title">Session overview</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 170 }}>
        <div className="card">
          <div className="grid3" style={{ gap: 4 }}>
            <div className="stack-s" style={{ gap: 2 }}><span className="lbl">Elapsed</span><span className="t-num" style={{ fontSize: 26 }} role="timer" aria-label={`Elapsed ${hms(elapsed)}`}>{Math.floor(elapsed / 60)}<small style={{ fontSize: 13 }}> min</small></span></div>
            <div className="stack-s" style={{ gap: 2 }}><span className="lbl">Projected</span><span className="t-num" style={{ fontSize: 26 }}>{projMin}<small style={{ fontSize: 13 }}> min</small></span></div>
            <div className="stack-s" style={{ gap: 2 }}><span className="lbl">Target</span><span className="t-num" style={{ fontSize: 26 }}>{session.targetMin}<small style={{ fontSize: 13 }}> min</small></span></div>
          </div>
          <div className="tl" role="img" aria-label={`Time used and planned. Projected ${projMin} of ${session.targetMin} minutes.`}>
            <span style={{ width: w(warmElapsed), background: '#FF5A1F' }} />
            <span style={{ width: w(doneLift), background: '#121212' }} />
            <span style={{ width: w(remaining - warmRemaining), background: '#B5B1A8' }} />
            {warmRemaining > 0 && <span style={{ width: w(warmRemaining), background: '#FFB594' }} />}
          </div>
          <div className="wrap small" style={{ gap: 12 }}>
            <span className="hstack" style={{ gap: 6 }}><span className="dot accent" />Warm-up {mmss(warmElapsed)}{warmOver > 0 ? ` (+${mmss(warmOver)})` : ` / ${mmss(session.warmupTargetMin * 60)}`}</span>
            <span className="hstack" style={{ gap: 6 }}><span className="dot" style={{ background: '#121212' }} />Done</span>
            <span className="hstack" style={{ gap: 6 }}><span className="dot" />Planned</span>
          </div>
        </div>

        {activeAdj.map((a) => (
          <div key={a.id} className="banner warn" role="status">
            <span className="ic ic-bolt" aria-hidden="true" />
            <div className="grow"><span className="b-t">Auto-adjusted to finish near {session.targetMin} min</span>{a.text}</div>
            <button className="banner-act" onClick={() => undoAdjustmentById(a.id)}>Undo</button>
          </div>
        ))}
        {inactiveAdj.length > 0 && overMin > 0 && (
          <div className="banner error" role="status">
            <span className="ic ic-clock" aria-hidden="true" />
            <div className="grow"><span className="b-t">Projected {overMin} min over target</span>Keeping everything. You can still drop an exercise below.</div>
            <button className="banner-act" onClick={() => inactiveAdj.forEach(reapply)}>Re-apply</button>
          </div>
        )}
        {inactiveAdj.length > 0 && overMin <= 0 && inactiveAdj.map((a) => (
          <div key={a.id} className="banner info" role="status">
            <span className="ic ic-undo" aria-hidden="true" />
            <div className="grow"><span className="b-t">Adjustment undone</span>{a.text}</div>
            <button className="banner-act" onClick={() => reapply(a)}>Re-apply</button>
          </div>
        ))}

        <div className="section-h">Exercises</div>
        {exs.length === 0 ? <p className="sub">No exercises in this session.</p> : (
          <div className="group">
            {exs.map((e, i) => {
              const upcoming = e.status === 'todo' || e.status === 'dropped';
              if (e.status === 'done') {
                const mins = e.startedAt && e.endedAt ? mmss((e.endedAt - e.startedAt) / 1000) : null;
                return (
                  <div key={e.id} className="li">
                    <span className="check sm on" aria-hidden="true"><span className="ic ic-check sm" /></span>
                    <div className="grow"><span className="li-t">{e.name}</span><span className="li-s">{rxLine(e.sets.length, e.sets[0]?.reps ?? 0, e.sets[0]?.weight ?? 0, unit, e.tracking, e.perHand)}{mins ? ` · ${mins}` : ''}{e.feedback ? ` · ${WEIGHT_LABEL[e.feedback.weight]}` : ''}</span></div>
                    {e.recommendation && <span className={`tag ${e.recommendation.kind === 'weight_up' || e.recommendation.kind === 'rep_up' || e.recommendation.kind === 'tempo' || e.recommendation.kind === 'harder' ? 'green' : e.recommendation.kind === 'hold' ? '' : 'accent'}`}>{e.recommendation.tag}</span>}
                  </div>
                );
              }
              if (e.status === 'skipped') {
                return <div key={e.id} className="li struck"><span className="tile sm"><span className="ic ic-skip sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">{e.name}</span><span className="li-s">Skipped</span></div></div>;
              }
              if (e.status === 'active' || (warm && i === session.cursor)) {
                return (
                  <Link key={e.id} className="li" to={back} style={{ background: '#FFE7DC' }}>
                    <span className="tile sm accent"><span className="ic ic-play sm" aria-hidden="true" /></span>
                    <div className="grow"><span className="li-t">{e.name}</span><span className="li-s">{warm ? `Up first · ${e.plannedSets} sets` : `Now · set ${Math.min(e.sets.length + 1, e.plannedSets)} of ${e.plannedSets}`}</span></div>
                    <span className="ic ic-chev-right chev" aria-hidden="true" />
                  </Link>
                );
              }
              if (!upcoming) return null;
              const dropped = e.status === 'dropped';
              const min = Math.max(1, Math.round(e.estSec / 60));
              return (
                <div key={e.id} className={`li ${dropped ? 'struck' : ''}`} style={{ paddingLeft: 8, gap: 8 }}>
                  <div className="ord">
                    <button aria-label={`Move ${e.name} up`} disabled={i - 1 <= session.cursor} onClick={() => moveUpcoming(e.id, -1)}><span className="ic ic-chev-up sm" aria-hidden="true" /></button>
                    <button aria-label={`Move ${e.name} down`} disabled={i + 1 >= exs.length} onClick={() => moveUpcoming(e.id, 1)}><span className="ic ic-chev-down sm" aria-hidden="true" /></button>
                  </div>
                  <div className="grow"><span className="li-t">{e.name}</span><span className="li-s">{dropped ? `Dropped to save ~${min} min` : `${rxLine(e.plannedSets, e.repTarget, e.plannedWeight, unit, e.tracking, e.perHand)}${e.tempo ? ' · 3 s tempo' : ''} · ~${min} min`}</span></div>
                  <button className="btn btn-soft btn-sm" onClick={() => dropExercise(e.id, !dropped)}>{dropped ? 'Add back' : 'Drop'}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="bottombar">
        <Link className="btn btn-primary" to={back}>Back to workout</Link>
        <Link className="btn btn-ghost" to="/session/end" style={{ minHeight: 40, fontSize: 14 }}>Finish session now</Link>
      </div>
    </div>
  );
}

