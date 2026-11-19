import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import OfflineBanner from '../components/OfflineBanner';
import Toast from '../components/Toast';
import { restOverAlert } from '../lib/alerts';
import { useNow, useToast } from '../lib/hooks';
import { endRest, undoAdjustmentById, undoLastSet, useActiveSession, useSettings } from '../store/actions';
import { defaultsFor, draftKey, isIntro, useDraft } from '../store/x-live';
import type { Session } from '../../shared/types';
import Done from './live/Done';
import FeedbackScreen from './live/FeedbackScreen';
import Intro from './live/Intro';
import LiveTopbar from './live/LiveTopbar';
import OptionsSheet, { type MenuView } from './live/OptionsSheet';
import Rest from './live/Rest';
import SetScreen from './live/SetScreen';
import '../styles/session.css';
import '../styles/live.css';

const ADJUST_BANNER_MS = 5 * 60_000;
/** Beep/vibrate only when the rest really just ended; waking up minutes later is silent. */
const ALERT_WINDOW_MS = 30_000;

export default function Live() {
  const session = useActiveSession();
  if (!session) return null; // App guard redirects home (or we are navigating to the summary)
  if (session.phase === 'warmup') return <Navigate to="/session/warmup" replace />;
  return <LiveInner session={session} />;
}

function LiveInner({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const unit = useSettings().unit;
  const phase = session.phase;
  const now = useNow(phase === 'rest' ? 250 : 1000);
  const [toast, flash] = useToast();
  const [menu, setMenu] = useState<MenuView | null>(null);
  const draft = useDraft();
  const ex = session.exercises[session.cursor];

  // toast handed over from the swap screen
  useEffect(() => {
    const t = (location.state as { toast?: string } | null)?.toast;
    if (t) { flash(t); navigate(location.pathname, { replace: true, state: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rest -> end exactly once when the timestamp is reached (also after backgrounding / reload)
  const restEndsAt = phase === 'rest' ? session.restEndsAt : undefined;
  const firedFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (restEndsAt == null || now < restEndsAt || firedFor.current === restEndsAt) return;
    firedFor.current = restEndsAt;
    if (now - restEndsAt < ALERT_WINDOW_MS) { restOverAlert(); flash('Rest over. Go!'); }
    endRest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, restEndsAt]);

  // the sheet belongs to the exercise it was opened on
  const exId = ex?.id;
  useEffect(() => { setMenu(null); }, [exId, phase]);

  const lastAdj = useMemo(() => [...session.adjustments].reverse().find((a) => !a.undone), [session.adjustments]);
  const adjBanner = lastAdj && now - lastAdj.at < ADJUST_BANNER_MS ? lastAdj : null;
  const visible = useMemo(() => session.exercises.filter((e) => e.status !== 'dropped'), [session.exercises]);

  if (!ex) return <Navigate to="/session/plan" replace />;
  const exN = Math.max(1, visible.findIndex((e) => e.id === ex.id) + 1);
  const key = draftKey(session.id, ex);
  const cur = draft && draft.key === key ? draft : { key, ...defaultsFor(ex) };
  const intro = isIntro(session, ex);
  const props = { session, ex, now, unit, flash, exN, exCount: visible.length };

  const fbScreen = phase === 'fb';
  const header = (
    <>
      <OfflineBanner />
      <LiveTopbar session={session} now={now} onBack={fbScreen ? () => undoLastSet() : undefined} />
      <div style={{ padding: '0 20px 6px', flexShrink: 0 }}>
        <div className="segs" style={{ gridTemplateColumns: `repeat(${Math.max(1, visible.length)}, minmax(0, 1fr))` }} role="img" aria-label={`Exercise ${exN} of ${visible.length}`}>
          {visible.map((e, j) => (
            <span key={e.id} className={e.status === 'done' || e.status === 'skipped' ? 'on' : (e.id === ex.id && phase !== 'done' ? 'now' : '')} data-i={j} />
          ))}
        </div>
      </div>
      {adjBanner && (
        <div className="live-adj" style={{ padding: '4px 20px 0', flexShrink: 0 }}>
          <div className="banner info" role="status" style={{ alignItems: 'center' }}>
            <span className="ic ic-bolt" aria-hidden="true" />
            <div className="grow"><span className="b-t">Plan adjusted</span>{adjBanner.text}</div>
            <button className="banner-act" onClick={() => undoAdjustmentById(adjBanner.id)}>Undo</button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="app">
      {header}
      {phase === 'done' ? <Done {...props} />
        : phase === 'fb' ? <FeedbackScreen {...props} />
        : phase === 'rest' ? <Rest {...props} cur={cur} />
        : intro ? <Intro {...props} openSwap={() => setMenu('swap')} />
        : <SetScreen {...props} cur={cur} openMenu={() => setMenu('main')} />}
      {menu && (phase === 'set') && <OptionsSheet {...props} view={menu} setView={setMenu} onClose={() => setMenu(null)} />}
      <Toast msg={menu ? '' : toast} bottom={fbScreen ? 150 : 120} />
    </div>
  );
}
