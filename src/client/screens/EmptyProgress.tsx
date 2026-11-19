import { Link } from 'react-router-dom';
import TabBar from '../components/TabBar';
import { useRotation, useWeek } from '../store/actions';

export default function EmptyProgress() {
  const rotation = useRotation();
  const { next } = useWeek();
  const area = rotation[(next - 1) % Math.max(1, rotation.length)];
  return (
    <div className="app">
      <style>{'.ghost{display:flex;align-items:flex-end;gap:8px;height:110px}.ghost i{flex:1;border-radius:6px 6px 3px 3px;background:#ECEBE7}'}</style>
      <div className="scroll" style={{ paddingTop: 24 }}>
        <div className="stack-s" style={{ gap: 4, padding: '0 2px 4px' }}><span className="eyebrow">Nothing logged yet</span><h1 className="t-display">Progress</h1></div>
        <div className="card" style={{ gap: 18 }}>
          <div className="ghost" aria-hidden="true">
            {[30, 55, 40, 70, 50, 85, 65, 95].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          </div>
          <div className="stack-s" style={{ alignItems: 'center', textAlign: 'center', gap: 6 }}>
            <h2 className="t-h">Your stats start with session 1</h2>
            <p className="sub">Every set, timer and bit of feedback you log ends up here.</p>
          </div>
        </div>
        <span className="lbl" style={{ padding: '8px 2px 0' }}>What unlocks</span>
        <div className="group">
          <div className="li"><span className="tile sm warm">1</span><div className="grow"><span className="li-t">Weekly sessions chart</span><span className="li-s">After your first session</span></div></div>
          <div className="li"><span className="tile sm">2</span><div className="grow"><span className="li-t">Lift progress &amp; next-time targets</span><span className="li-s">After an exercise is done twice</span></div></div>
          <div className="li"><span className="tile sm">3</span><div className="grow"><span className="li-t">Timing insights &amp; auto-adjust</span><span className="li-s">After 3 sessions with warm-up timed</span></div></div>
        </div>
        <Link className="btn btn-accent" to="/session/preview" style={{ marginTop: 4 }}>
          <span className="ic ic-play" aria-hidden="true" />Start session 1{area ? ` · ${area.name}` : ''}
        </Link>
      </div>
      <TabBar />
    </div>
  );
}
