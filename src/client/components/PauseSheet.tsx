import { banExercise, pauseExercise, statusOf, toggleFavorite, usePrefs } from '../store/actions';
import { DEFAULT_PREF } from '../../shared/planner';

const PAUSES: { label: string; sub: string; opt: { days?: number | null; sessions?: number } }[] = [
  { label: 'Next session', sub: 'Skipped once, then it is back', opt: { sessions: 1 } },
  { label: '1 week', sub: 'Returns automatically', opt: { days: 7 } },
  { label: '2 weeks', sub: 'Returns automatically', opt: { days: 14 } },
  { label: '1 month', sub: 'Returns automatically', opt: { days: 30 } },
  { label: 'Until I resume it', sub: 'Stays out until you bring it back', opt: { days: null } },
];

/**
 * Shared bottom sheet for exercise preferences: favourite, pause (timed), ban, resume.
 * Render inside `.app` when open. `onDone(msg)` is called after any change (use it to toast + close).
 */
export default function PauseSheet({ exerciseId, name, onClose, onDone }: { exerciseId: string; name: string; onClose: () => void; onDone?: (msg: string) => void }) {
  const prefs = usePrefs();
  const pref = prefs[exerciseId] ?? DEFAULT_PREF(exerciseId);
  const status = statusOf(pref, Date.now());
  const done = (msg: string) => { onDone?.(msg); onClose(); };
  return (
    <>
      <button className="scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`${name} preferences`}>
        <div className="grabber" />
        <h2 className="t-h">{name}</h2>
        <div className="group">
          <button className="li" onClick={() => { toggleFavorite(exerciseId); done(pref.favorite ? 'Removed from favourites' : 'Added to favourites'); }}>
            <span className="tile sm"><span className={`ic ${pref.favorite ? 'ic-star-fill' : 'ic-star'} sm`} aria-hidden="true" /></span>
            <div className="grow"><span className="li-t">{pref.favorite ? 'Remove favourite' : 'Favourite'}</span><span className="li-s">Picked first when it fits the area, gym and time</span></div>
          </button>
          {status === 'paused' || status === 'banned' ? (
            <button className="li" onClick={() => { if (pref.avoid) banExercise(exerciseId, false); pauseExercise(exerciseId, { resume: true }); done('Back in rotation'); }}>
              <span className="tile sm"><span className="ic ic-play sm" aria-hidden="true" /></span>
              <div className="grow"><span className="li-t">{status === 'banned' ? 'Unban' : 'Resume now'}</span><span className="li-s">Planned and swapped in again</span></div>
            </button>
          ) : null}
        </div>
        <span className="lbl">Pause</span>
        <div className="group">
          {PAUSES.map((p) => (
            <button key={p.label} className="li" onClick={() => { pauseExercise(exerciseId, p.opt); done(`Paused: ${p.label.toLowerCase()}`); }}>
              <span className="tile sm"><span className="ic ic-pause-c sm" aria-hidden="true" /></span>
              <div className="grow"><span className="li-t">{p.label}</span><span className="li-s">{p.sub}</span></div>
            </button>
          ))}
        </div>
        {!pref.avoid && (
          <button className="btn btn-danger-soft" onClick={() => { banExercise(exerciseId, true); done('Banned: never planned again'); }}>
            <span className="ic ic-ban" aria-hidden="true" /> Ban: never again
          </button>
        )}
      </div>
    </>
  );
}
