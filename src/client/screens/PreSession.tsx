import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  alternativesFor, beginSession, chooseNoEquipment, detectGym, draftMove, draftRemove, draftSetTarget, draftSwap, leaveNoEquipment, newMix, prepareDraft,
  useAtHome, useCurrentGym, useDraft, useLibrary, useRotation, useSettings, useWeek,
} from '../store/actions';
import { setState, useStore } from '../store/core';
import { startFlow } from '../store/x-onboarding';
import { rxLine } from '../lib/format';
import { prefOf, statusOf } from '../../shared/planner';
import { totalPlannedSec } from '../../shared/rules';
import { NO_EQUIPMENT_LABEL, bodyweightExercises } from '../../shared/location';
import { GuideSheet } from '../components/ExerciseGuide';
import LocationDenied from './LocationDenied';
import UnknownGym from './UnknownGym';

const COLORS = ['#121212', '#3D3D3D', '#5C5C5C', '#7A7A7A', '#969696', '#ABABAB'];
const joinNames = (n: string[]) => (n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
const STYLE = `.ord{display:flex;flex-direction:column;gap:2px}
.ord button{width:32px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#6B6B6B}
.ord button:active{background:#ECEBE7}
.budget{display:flex;height:12px;border-radius:6px;overflow:hidden;gap:2px;background:#ECEBE7}
.budget > span{height:100%}`;

export default function PreSession() {
  const navigate = useNavigate();
  const settings = useSettings();
  const draft = useDraft();
  const gym = useCurrentGym();
  const atHome = useAtHome();
  const rotation = useRotation();
  const { next } = useWeek();
  const geo = useStore((s) => s.device.geo);
  const gymSource = useStore((s) => s.device.gymSource);
  const distM = useStore((s) => s.device.geoDistanceM);
  const chosen = useStore((s) => s.device.chosenSlot);
  const [, setTick] = useState(0);
  const prefs = useStore((s) => s.prefs);
  const library = useLibrary();
  const [swapId, setSwapId] = useState<string | null>(null);
  const [guideId, setGuideId] = useState<string | null>(null);

  const slot = Math.min(chosen ?? next, Math.max(1, rotation.length));
  const gymId = useStore((s) => s.device.currentGymId);

  useEffect(() => {
    if (settings.gps && gymSource !== 'manual' && !startFlow.detected) { startFlow.detected = true; void detectGym(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (rotation.length) prepareDraft(); }, [slot, gymId, rotation.length]);

  const needsGym = !startFlow.confirmed && gymSource !== 'manual';
  if (needsGym && geo === 'denied') return <LocationDenied onDone={() => setTick((t) => t + 1)} />;
  if (needsGym && geo === 'nomatch') return <UnknownGym onDone={() => setTick((t) => t + 1)} />;

  const area = rotation[slot - 1];
  const d = draft && draft.slot === slot ? draft : null;
  const exs = d?.exercises ?? [];
  const warm = settings.warmupTargetMinutes;
  const target = d?.targetMin ?? settings.targetMinutes;
  const total = d ? Math.round(totalPlannedSec(exs, warm) / 60) : warm;
  const scale = Math.max(total, target, 1);
  const over = total - target;
  const fitCls = over > 5 ? 'red' : over > 0 ? 'accent' : 'green';
  const fitLabel = over > 5 ? `Over by ${over} min. Remove one?` : over > 0 ? `Tight, +${over} min` : `Fits, ${-over} min spare`;
  const area_ = area;
  const nowMs = Date.now();
  const poolEx = area_ ? library.filter((e) => !e.archived && (area_.poolExerciseIds.length ? area_.poolExerciseIds.includes(e.id) : e.primary.some((m) => area_.focusMuscles.includes(m)))) : [];
  const bannedNames = poolEx.filter((e) => statusOf(prefOf(prefs, e.id), nowMs) === 'banned').map((e) => e.name);
  const pausedNames = poolEx.filter((e) => statusOf(prefOf(prefs, e.id), nowMs) === 'paused').map((e) => e.name);
  const leftOut = [...(d?.hiddenNames ?? []), ...bannedNames, ...pausedNames];
  const items = gym ? Object.values(gym.equipment).filter((v) => v !== 'none').length : 0;
  const bwCount = bodyweightExercises(library).length;
  const sourceText = gymSource === 'gps' ? `Detected by GPS${distM != null ? ` · ${distM} m away` : ''}` : gymSource === 'manual' ? 'Chosen by you' : 'Last used';
  const swapEx = swapId ? exs.find((e) => e.id === swapId) : undefined;
  const alts = swapEx ? alternativesFor(swapEx.exerciseId, exs.map((e) => e.exerciseId)) : [];

  function start() {
    if (!d || exs.length === 0) return;
    // Mark "resume" as already offered so the route guard doesn't bounce us once the session exists.
    setState((s) => { s.device = { ...s.device, resumeShown: true }; });
    if (beginSession()) navigate('/session/warmup');
  }

  return (
    <div className="app">
      <style>{STYLE}</style>
      <div className="topbar">
        <Link className="iconbtn" to="/" aria-label="Back to Today"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Session {slot} of rotation</span>
        <button type="button" className="iconbtn" aria-label="New mix of exercises" onClick={() => newMix()} disabled={!d}><span className="ic ic-shuffle" aria-hidden="true" /></button>
      </div>
      <div className="scroll" style={{ paddingTop: 4 }}>
        <div className="stack-s" style={{ padding: '0 2px' }}>
          <h1 className="t-display">{area?.name ?? 'Session'}</h1>
          {area && area.focusMuscles.length > 0 && <p className="sub">{area.focusMuscles.slice(0, 5).join(' · ')}. Picked for today from your area pool.</p>}
        </div>

        <div className="seg c2 on-bg" role="group" aria-label="Where are you training">
          {([[false, 'At a gym', 'ic-building'], [true, 'At home, no equipment', 'ic-home']] as const).map(([home, label, icon]) => {
            const on = atHome === home;
            return (
              <button type="button" key={label} className={on ? 'on' : ''} aria-pressed={on} onClick={() => { if (!on) (home ? chooseNoEquipment : leaveNoEquipment)(); }}>
                <span className={`ic ${icon} sm`} aria-hidden="true" style={{ marginRight: 6 }} />{label}
              </button>
            );
          })}
        </div>
        <Link className="card tight" to="/session/gym" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <span className={`tile sm ${atHome ? 'warm' : 'green'}`}><span className={`ic ${atHome ? 'ic-home' : 'ic-pin'} sm`} aria-hidden="true" /></span>
          <div className="grow stack-s" style={{ gap: 2 }}>
            <span className="li-t">{atHome ? NO_EQUIPMENT_LABEL : gym?.name ?? 'No gym selected'}</span>
            <span className="li-s">{atHome ? 'Bodyweight only · a floor and a wall' : geo === 'locating' ? 'Finding your gym…' : gym ? `${sourceText} · ${items} items` : 'Bodyweight and bands only'}</span>
          </div>
          <span className="small strong">Change</span>
        </Link>

        <div className="card tight">
          <div className="between">
            <div className="stack-s" style={{ gap: 2 }}>
              <span className="lbl">Time budget</span>
              <span className="t-num" style={{ fontSize: 26 }}>{total} <span className="unit">/ {target} min</span></span>
            </div>
            <div className="hstack" style={{ gap: 6 }}>
              <button type="button" className="stepbtn sm on-white" aria-label="Less time" disabled={!d} onClick={() => draftSetTarget(target - 5)}><span className="ic ic-minus sm" aria-hidden="true" /></button>
              <button type="button" className="stepbtn sm on-white" aria-label="More time" disabled={!d} onClick={() => draftSetTarget(target + 5)}><span className="ic ic-plus sm" aria-hidden="true" /></button>
            </div>
          </div>
          <div className="budget" role="img" aria-label={`Planned ${total} of ${target} minutes`}>
            <span style={{ width: `${(warm / scale) * 100}%`, background: '#B5B1A8' }} />
            {exs.map((e, i) => <span key={e.id} style={{ width: `${(e.estSec / 60 / scale) * 100}%`, background: COLORS[i % COLORS.length] }} />)}
          </div>
          <div className="between small">
            <span className="hstack" style={{ gap: 6 }}><span className="dot" />Warm-up {warm} min</span>
            {d && <span className={`tag ${fitCls}`}>{fitLabel}</span>}
          </div>
        </div>

        {d && d.coachNote && (
          <div className="banner info"><span className="ic ic-sparkle" aria-hidden="true" /><div className="grow"><span className="b-t">Note from your coach</span>{d.coachNote}</div></div>
        )}
        {atHome && (
          <div className="banner warn">
            <span className="ic ic-home" aria-hidden="true" />
            <div className="grow"><span className="b-t">Switched to bodyweight versions</span>Same muscles, no equipment. Progress is tracked by reps, tempo and time, then harder variations.&nbsp;<Link className="banner-act" to="/library/all?reset=1&gym=none" aria-label={`Browse ${bwCount} bodyweight exercises`}>Browse</Link></div>
          </div>
        )}
        {!atHome && leftOut.length > 0 && (
          <div className="banner info">
            <span className="ic ic-eye-off" aria-hidden="true" />
            <div className="grow"><span className="b-t">{leftOut.length} exercise{leftOut.length === 1 ? '' : 's'} left out</span>
              {d && d.hiddenNames.length > 0 && <>{joinNames(d.hiddenNames)} {d.hiddenNames.length === 1 ? 'needs' : 'need'} equipment {gym?.name ?? 'this gym'} doesn't have. </>}
              {bannedNames.length > 0 && <>{joinNames(bannedNames)} {bannedNames.length === 1 ? 'is' : 'are'} banned by you. </>}
              {pausedNames.length > 0 && <>{joinNames(pausedNames)} {pausedNames.length === 1 ? 'is' : 'are'} paused. </>}
              <Link className="banner-act" to="/library/exclusions">Manage</Link></div>
          </div>
        )}

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>{exs.length} exercise{exs.length === 1 ? '' : 's'}</span><span className="sub">Reorder freely</span></div>
        {d && exs.length === 0 && <p className="sub" style={{ padding: '0 2px' }}>Nothing to plan yet. Add an exercise or try a new mix.</p>}
        {exs.length > 0 && (
          <div className="group">
            {exs.map((e, i) => (
              <div className="li" key={e.id} style={{ paddingLeft: 8, gap: 8 }}>
                <div className="ord">
                  <button type="button" aria-label={`Move ${e.name} up`} disabled={i === 0} onClick={() => draftMove(i, -1)}><span className="ic ic-chev-up sm" aria-hidden="true" /></button>
                  <button type="button" aria-label={`Move ${e.name} down`} disabled={i === exs.length - 1} onClick={() => draftMove(i, 1)}><span className="ic ic-chev-down sm" aria-hidden="true" /></button>
                </div>
                <div className="grow"><span className="li-t">{e.name}</span><span className="li-s">{rxLine(e.plannedSets, e.repTarget, e.plannedWeight, settings.unit, e.tracking, e.perHand)}{e.tempo ? ' · 3 s tempo' : ''} · ~{Math.max(1, Math.round(e.estSec / 60))} min</span></div>
                <button type="button" className="iconbtn" aria-label={`How to do ${e.name}`} onClick={() => setGuideId(e.exerciseId)}><span className="ic ic-info sm" aria-hidden="true" /></button>
                <button type="button" className="iconbtn" aria-label={`Swap ${e.name}`} onClick={() => setSwapId(e.id)}><span className="ic ic-swap sm" aria-hidden="true" /></button>
                <button type="button" className="iconbtn" aria-label={`Remove ${e.name}`} onClick={() => draftRemove(e.id)} style={{ marginRight: -8 }}><span className="ic ic-x sm" aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid2">
          <Link className="btn btn-secondary btn-sm" to="/library?add=1" style={{ width: '100%' }}><span className="ic ic-plus sm" aria-hidden="true" />Add exercise</Link>
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }} disabled={!d} onClick={() => newMix()}><span className="ic ic-shuffle sm" aria-hidden="true" />New mix</button>
        </div>
      </div>
      <div className="bottombar">
        <button type="button" className="btn btn-accent" disabled={!d || exs.length === 0} onClick={start}><span className="ic ic-play" aria-hidden="true" />{atHome ? 'Start at home' : "I'm at the gym — start"}</button>
      </div>

      {guideId && library.find((x) => x.id === guideId) && <GuideSheet ex={library.find((x) => x.id === guideId)!} onClose={() => setGuideId(null)} />}
      {swapEx && (
        <>
          <button type="button" className="scrim" aria-label="Close" onClick={() => setSwapId(null)} />
          <div className="sheet" role="dialog" aria-label={`Swap ${swapEx.name}`}>
            <div className="grabber" />
            <div className="between">
              <h2 className="t-h">Swap {swapEx.name}</h2>
              <button type="button" className="iconbtn" aria-label="Close" onClick={() => setSwapId(null)} style={{ marginRight: -10 }}><span className="ic ic-x" aria-hidden="true" /></button>
            </div>
            {alts.length === 0 ? (
              <p className="sub">No close alternatives are available {atHome ? 'without equipment' : "with this gym's equipment"}.</p>
            ) : (
              <div className="group">
                {alts.map((a) => (
                  <button type="button" className="li" key={a.exercise.id} onClick={() => { draftSwap(swapEx.id, a.exercise.id); setSwapId(null); }}>
                    <div className="grow"><span className="li-t">{a.exercise.name}</span><span className="li-s">{a.exercise.primary.slice(0, 3).join(', ')}</span></div>
                    <span className="tag green">{a.match}% match</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
