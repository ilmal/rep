import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TabBar from '../components/TabBar';
import { useStore } from '../store/core';
import { chooseNoEquipment, getPosition, setEquipStatus, updateGym, useCurrentGym, useGyms, useLibrary } from '../store/actions';
import { bodyweightExercises } from '../../shared/location';
import { EQUIP_BY_ID } from '../../shared/catalog';
import { haversineM } from '../../shared/rules';
import { dayShort, equipSummary, monthShort } from '../lib/format';
import type { Gym } from '../../shared/types';

const countItems = (g: Gym) => Object.values(g.equipment).filter((s) => s === 'ok' || s === 'broken').length;
const brokenIds = (g: Gym) => Object.entries(g.equipment).filter(([id, s]) => s === 'broken' && EQUIP_BY_ID[id]).map(([id]) => id);
const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Last-visited label like the design: weekday within the last week, then "N weeks ago". */
function visited(t: number | undefined, nowMs = Date.now()): string {
  if (!t) return 'not visited yet';
  const startOf = (x: number) => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOf(nowMs) - startOf(t)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return WD[new Date(t).getDay()];
  if (days < 14) return '1 week ago';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export default function Gyms() {
  const gyms = useGyms();
  const library = useLibrary();
  const bwCount = bodyweightExercises(library).length;
  const current = useCurrentGym();
  const device = useStore((s) => s.device);
  const gpsOn = useStore((s) => s.settings.gps);
  const [livePos, setLivePos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!gpsOn) return;
    let live = true;
    getPosition().then((p) => { if (live && p) setLivePos(p); });
    return () => { live = false; };
  }, [gpsOn]);
  const [undo, setUndo] = useState<{ gymId: string; equipId: string; equipment: Gym['equipment']; brokenSince: Gym['brokenSince'] } | null>(null);

  const totalItems = gyms.reduce((a, g) => a + countItems(g), 0);
  const broken = gyms.flatMap((g) => brokenIds(g).map((id) => ({ gym: g, id })));
  const firstBroken = broken[0];

  const fix = () => {
    if (!firstBroken) return;
    const { gym, id } = firstBroken;
    setUndo({ gymId: gym.id, equipId: id, equipment: gym.equipment, brokenSince: gym.brokenSince });
    setEquipStatus(gym.id, id, 'ok');
  };
  const doUndo = () => {
    if (!undo) return;
    setEquipStatus(undo.gymId, undo.equipId, 'broken');
    updateGym(undo.gymId, { brokenSince: undo.brokenSince }); // keep the original "since" date
    setUndo(null);
  };

  const pos = livePos ?? device.currentPos;
  const here = current && (device.geo === 'matched' || device.gymSource === 'gps');
  const undoGym = undo ? gyms.find((g) => g.id === undo.gymId) : undefined;

  return (
    <div className="app">
      <div className="scroll" style={{ paddingTop: 24 }}>
        <div className="between" style={{ padding: '0 2px 4px' }}>
          <div className="stack-s" style={{ gap: 4 }}>
            <span className="eyebrow">{gyms.length} {gyms.length === 1 ? 'gym' : 'gyms'} · {totalItems} items mapped</span>
            <h1 className="t-display">Gyms</h1>
          </div>
          <Link className="iconbtn filled" to="/gyms/new" aria-label="Add gym"><span className="ic ic-plus lg" aria-hidden="true" /></Link>
        </div>

        {current && (
          <div className="card" style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
            <div className="map" style={{ height: 140, borderRadius: 0 }} aria-hidden="true">
              <div className="road" style={{ left: 0, right: 0, top: 70, height: 12 }} />
              <div className="road" style={{ top: 0, bottom: 0, left: 90, width: 10 }} />
              <div className="road" style={{ top: 0, bottom: 0, left: 270, width: 8 }} />
              <div className="fence" style={{ left: 'calc(50% - 48px)', top: 24, width: 96, height: 96 }} />
              <div className="mpin" style={{ left: 'calc(50% - 18px)', top: 40 }}><i /></div>
            </div>
            <div className="hstack" style={{ padding: '14px 16px' }}>
              <span className="tile sm green"><span className="ic ic-nav sm" aria-hidden="true" /></span>
              <div className="grow stack-s" style={{ gap: 2 }}>
                <span className="li-t">{here ? `You're at ${current.name}` : `Training at ${current.name}`}</span>
                <span className="li-s">
                  {here
                    ? `GPS${device.geoAccuracyM != null ? ` ±${device.geoAccuracyM} m` : ''} · inside ${current.radiusM} m geofence`
                    : 'Selected manually'}
                </span>
              </div>
            </div>
          </div>
        )}

        {firstBroken && (
          <div className="banner warn">
            <span className="ic ic-wrench" aria-hidden="true" />
            <div className="grow">
              <span className="b-t">{EQUIP_BY_ID[firstBroken.id].name} marked broken</span>
              {firstBroken.gym.name}
              {firstBroken.gym.brokenSince[firstBroken.id] ? ` · since ${dayShort(firstBroken.gym.brokenSince[firstBroken.id])} ${monthShort(firstBroken.gym.brokenSince[firstBroken.id])}` : ''}
              . Hidden from plans there.{broken.length > 1 ? ` ${broken.length - 1} more broken.` : ''}
            </div>
            <button className="banner-act" onClick={fix}>Mark fixed</button>
          </div>
        )}
        {undo && undoGym && (
          <div className="banner ok">
            <span className="ic ic-check" aria-hidden="true" />
            <div className="grow"><span className="b-t">Back in rotation</span>{EQUIP_BY_ID[undo.equipId]?.name} is available at {undoGym.name} again.</div>
            <button className="banner-act" onClick={doUndo}>Undo</button>
          </div>
        )}

        {(() => {
          const target = current ?? gyms[0];
          const inner = (
            <>
              <span className="ic ic-info" aria-hidden="true" />
              <div className="grow"><span className="b-t">Plans only use what a gym has</span>Turn off missing equipment once and it's never suggested there again.</div>
              {target && <span className="ic ic-chev-right" aria-hidden="true" />}
            </>
          );
          return target
            ? <Link className="banner info" to={`/gyms/${target.id}`} style={{ alignItems: 'center' }}>{inner}</Link>
            : <div className="banner info" style={{ alignItems: 'center' }}>{inner}</div>;
        })()}

        <div className="section-h">Your gyms</div>
        {gyms.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><span className="ic ic-building xl" aria-hidden="true" /></div>
            <p className="sub">No gyms yet. Add one so plans match the equipment you have.</p>
          </div>
        ) : (
          <div className="group">
            {gyms.map((g) => {
              const isHere = current?.id === g.id;
              const b = brokenIds(g).length;
              const parts = [`${countItems(g)} items`];
              if (b) parts.push(`${b} broken`);
              if (isHere && here && device.geoDistanceM != null) parts.push(`${Math.round(device.geoDistanceM)} m away`);
              else if (countItems(g) > 0 && countItems(g) <= 10) parts.push(equipSummary(g)); // a small gym reads better as what it has
              else {
                if (pos && g.lat != null && g.lng != null) parts.push(dist(haversineM(pos, { lat: g.lat, lng: g.lng })));
                parts.push(visited(g.lastVisitedAt));
              }
              return (
                <Link key={g.id} className="li" to={`/gyms/${g.id}`}>
                  <span className={`tile ${isHere ? 'ink' : ''}`}><span className="ic ic-building" aria-hidden="true" /></span>
                  <div className="grow"><span className="li-t">{g.name}</span><span className="li-s">{parts.join(' · ')}</span></div>
                  {isHere && <span className="tag green">{here ? 'Here' : 'Current'}</span>}
                  <span className="ic ic-chev-right chev" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
        <div className="group">
          <Link className="li" to="/session/preview" onClick={chooseNoEquipment}>
            <span className="tile warm"><span className="ic ic-user" aria-hidden="true" /></span>
            <div className="grow"><span className="li-t">No equipment</span><span className="li-s">Built in · always available · {bwCount} bodyweight exercises</span></div>
            <span className="tag">Built in</span>
          </Link>
        </div>
        <Link className="btn btn-secondary" to="/gyms/new"><span className="ic ic-plus" aria-hidden="true" />Add gym</Link>
      </div>
      <TabBar />
    </div>
  );
}
