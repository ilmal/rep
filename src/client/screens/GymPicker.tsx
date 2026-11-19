import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { chooseGym, getPosition, previewDraftAt, useDraft, useGyms, useLibrary, useRotation, useWeek } from '../store/actions';
import { NO_EQUIPMENT_GYM_ID, NO_EQUIPMENT_LABEL, isNoEquipment, noEquipmentGym, swapPairs } from '../../shared/location';
import { equipSummary } from '../lib/format';
import { useStore } from '../store/core';
import { ago } from '../lib/format';
import { haversineM } from '../../shared/rules';
import UnknownGym from './UnknownGym';

export default function GymPicker() {
  const navigate = useNavigate();
  const gyms = useGyms();
  const library = useLibrary();
  const draft = useDraft();
  const rotation = useRotation();
  const { next } = useWeek();
  const currentId = useStore((s) => s.device.currentGymId);
  const source = useStore((s) => s.device.gymSource);
  const storedPos = useStore((s) => s.device.currentPos);
  const gpsOn = useStore((s) => s.settings.gps);
  const [livePos, setLivePos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => { if (gpsOn) void getPosition().then((p) => { if (p) setLivePos(p); }); }, [gpsOn]);
  const pos = livePos ?? storedPos;
  const geoDist = useStore((s) => s.device.geoDistanceM);
  const chosen = useStore((s) => s.device.chosenSlot);
  const prefs = useStore((s) => s.prefs);
  const progress = useStore((s) => s.progress);
  const [elsewhere, setElsewhere] = useState(false);
  const [sel, setSel] = useState<string | null>(currentId ?? gyms[0]?.id ?? null);
  const selGym = isNoEquipment(sel) ? noEquipmentGym() : gyms.find((g) => g.id === sel) ?? null;
  const slot = chosen ?? next;
  const area = rotation[slot - 1];

  const distOf = (g: (typeof gyms)[number]): number | null => {
    if (g.id === currentId && source === 'gps' && geoDist != null) return geoDist;
    if (pos && g.lat != null && g.lng != null) return haversineM(pos, { lat: g.lat, lng: g.lng });
    return null;
  };
  const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

  // Swap impact: the REAL difference between today's plan and the one the planner builds at the selected location (dry run, nothing stored),
  // each exercise that leaves paired with the best-matching one that joins.
  const swaps = useMemo(() => {
    if (!draft || !selGym || draft.gymId === selGym.id) return [] as string[];
    const next = previewDraftAt(selGym.id);
    return next ? swapPairs(draft.exercises, next.exercises, library, progress) : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, selGym?.id, library, progress, prefs]);
  const showImpact = !!draft && !!selGym;

  const close = () => navigate('/session/preview');
  const atHomeSel = isNoEquipment(sel);
  const use = () => { if (selGym) { chooseGym(selGym.id); navigate('/session/preview'); } };

  if (elsewhere) return <UnknownGym onDone={() => navigate('/session/preview')} />;

  return (
    <div className="app">
      <div className="topbar" aria-hidden="true">
        <span className="iconbtn"><span className="ic ic-chev-left lg" /></span>
        <span className="title">Session {slot} of rotation</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4 }} aria-hidden="true">
        <h1 className="t-display">{area?.name ?? 'Session'}</h1>
        <div className="card tight" style={{ height: 72 }} />
        <div className="card tight" style={{ height: 120 }} />
        <div className="card tight" style={{ height: 300 }} />
      </div>
      <button type="button" className="scrim" aria-label="Close" onClick={close} />
      <div className="sheet" role="dialog" aria-label="Choose gym">
        <div className="grabber" />
        <div className="between">
          <h2 className="t-h">Where are you training?</h2>
          <button type="button" className="iconbtn" aria-label="Close" onClick={close} style={{ marginRight: -10 }}><span className="ic ic-x" aria-hidden="true" /></button>
        </div>
        {gyms.length === 0 && <p className="sub">No gyms saved yet. Add one to plan around its equipment.</p>}
        {(
          <div className="group" role="radiogroup" aria-label="Gyms">
            {gyms.map((g) => {
              const on = sel === g.id;
              const dist = distOf(g);
              const items = Object.values(g.equipment).filter((v) => v !== 'none').length;
              const here = g.id === currentId && source === 'gps';
              const small = items > 0 && items <= 10;
              const meta = [dist != null ? fmtDist(dist) : null, small ? equipSummary(g) : `${items} items`, g.lastVisitedAt ? `last visit ${ago(g.lastVisitedAt)}` : null].filter(Boolean).join(' · ');
              return (
                <button type="button" role="radio" aria-checked={on} className="li" key={g.id} onClick={() => setSel(g.id)}>
                  <span className={`radio ${on ? 'on' : ''}`} aria-hidden="true" />
                  <div className="grow"><span className="li-t">{g.name}</span><span className="li-s">{meta}</span></div>
                  {here && <span className="tag green"><span className="ic ic-nav xs" aria-hidden="true" />Here</span>}
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={atHomeSel} className="li" onClick={() => setSel(NO_EQUIPMENT_GYM_ID)}>
              <span className={`radio ${atHomeSel ? 'on' : ''}`} aria-hidden="true" />
              <div className="grow"><span className="li-t">{NO_EQUIPMENT_LABEL}</span><span className="li-s">Always available · bodyweight only</span></div>
            </button>
          </div>
        )}
        {showImpact && swaps.length > 0 && (
          <div className="banner warn">
            <span className="ic ic-swap" aria-hidden="true" />
            <div><span className="b-t">{swaps.length} exercise{swaps.length === 1 ? '' : 's'} will be swapped</span>{swaps.join(' · ')}</div>
          </div>
        )}
        {showImpact && swaps.length === 0 && (
          <div className="banner ok">
            <span className="ic ic-check" aria-hidden="true" />
            <div><span className="b-t">Plan unchanged</span>{draft && draft.exercises.length === 1 ? 'The exercise can' : `All ${draft?.exercises.length} exercises can`} be done here.</div>
          </div>
        )}
        <div className="grid2">
          <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={() => setElsewhere(true)}>Somewhere else</button>
          <Link className="btn btn-secondary btn-sm" style={{ width: '100%' }} to="/gyms/new"><span className="ic ic-plus sm" aria-hidden="true" />New gym</Link>
        </div>
        <button type="button" className="btn btn-primary" disabled={!selGym} onClick={use}>{selGym ? `Use ${atHomeSel ? NO_EQUIPMENT_LABEL : selGym.name}` : 'Pick a gym'}</button>
      </div>
    </div>
  );
}
