import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { chooseGym, chooseNoEquipment, updateGym, useGyms, useWeek } from '../store/actions';
import { useStore } from '../store/core';
import { startFlow } from '../store/x-onboarding';
import { haversineM } from '../../shared/rules';

type Opt = 'new' | 'existing' | 'none';

/** Rendered in place by PreSession when GPS finds no saved gym nearby. */
export default function UnknownGym({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const gyms = useGyms();
  const { next } = useWeek();
  const chosen = useStore((s) => s.device.chosenSlot);
  const pos = useStore((s) => s.device.currentPos);
  const [opt, setOpt] = useState<Opt>('new');
  const [upd, setUpd] = useState(true);

  const ranked = pos ? gyms.filter((g) => g.lat != null && g.lng != null).map((g) => ({ id: g.id, m: haversineM(pos, { lat: g.lat as number, lng: g.lng as number }) })).sort((a, b) => a.m - b.m) : [];
  const nearest = ranked[0]?.m;
  const [gid, setGid] = useState<string>(ranked[0]?.id ?? gyms[0]?.id ?? '');
  const dist = nearest == null ? null : nearest < 1000 ? `${Math.round(nearest)} m` : `${(nearest / 1000).toFixed(1)} km`;

  const done = () => { startFlow.confirmed = true; if (onDone) onDone(); else navigate('/session/preview'); };
  function go() {
    if (opt === 'new') { startFlow.confirmed = true; navigate('/gyms/new'); return; }
    if (opt === 'existing') {
      if (!gid) return;
      chooseGym(gid);
      if (upd && pos) updateGym(gid, { lat: pos.lat, lng: pos.lng });
      done();
      return;
    }
    chooseNoEquipment(); // the built-in "At home · no equipment" location, same as the preview toggle
    done();
  }

  const opts: { key: Opt; title: string; sub: string; icon: string; tile: string }[] = [
    { key: 'new', title: 'Save as a new gym', sub: 'Map its equipment once and it’s detected from now on', icon: 'ic-plus', tile: 'ink' },
    ...(gyms.length ? [{ key: 'existing' as Opt, title: 'It’s one of my gyms', sub: 'GPS was off target', icon: 'ic-building', tile: '' }] : []),
    { key: 'none', title: 'No gym: bodyweight only', sub: 'Plan uses bodyweight and bands. Hotel room, park…', icon: 'ic-user', tile: 'warm' },
  ];
  const selGym = gyms.find((g) => g.id === gid);
  const cta = opt === 'new' ? 'Set up this gym' : opt === 'existing' ? (selGym ? `Continue at ${selGym.name}` : 'Pick a gym') : 'Continue with bodyweight plan';

  return (
    <div className="app">
      <style>{`.opt{display:flex;gap:12px;align-items:flex-start;padding:16px;border-radius:20px;background:#fff;text-align:left;width:100%;box-shadow:0 1px 2px rgba(18,18,18,.04),0 8px 24px rgba(18,18,18,.05)}
.opt.on{box-shadow:inset 0 0 0 2px #121212}`}</style>
      <div className="topbar">
        <Link className="iconbtn" to="/" aria-label="Back"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Start session {chosen ?? next}</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 0, paddingBottom: 130 }}>
        <div className="map" style={{ height: 150 }} aria-hidden="true">
          <div className="road" style={{ left: 0, right: 0, top: 76, height: 12 }} />
          <div className="road" style={{ top: 0, bottom: 0, left: 110, width: 10 }} />
          <div className="mpin" style={{ left: 159, top: 44, background: '#FF5A1F' }}><i /></div>
        </div>
        <div className="stack-s" style={{ padding: '4px 2px' }}>
          <h1 className="t-title">You're somewhere new</h1>
          <p className="sub">{dist ? `Nearest saved gym is ${dist} away.` : "This spot doesn't match a saved gym."} Where are you training?</p>
        </div>
        <div role="radiogroup" aria-label="Where are you training" style={{ display: 'contents' }}>
          {opts.map((o) => {
            const on = opt === o.key;
            return (
              <button type="button" role="radio" aria-checked={on} key={o.key} className={`opt ${on ? 'on' : ''}`} onClick={() => setOpt(o.key)}>
                <span className={`tile sm ${o.tile}`}><span className={`ic ${o.icon} sm`} aria-hidden="true" /></span>
                <span className="grow stack-s" style={{ gap: 2 }}><span className="li-t">{o.title}</span><span className="li-s">{o.sub}</span></span>
                <span className={`radio ${on ? 'on' : ''}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {opt === 'existing' && (
          <div className="group">
            {gyms.map((g) => {
              const on = gid === g.id;
              return (
                <button type="button" className="li" key={g.id} aria-pressed={on} onClick={() => setGid(g.id)}>
                  <span className={`radio ${on ? 'on' : ''}`} aria-hidden="true" /><span className="grow li-t">{g.name}</span>
                </button>
              );
            })}
            {pos && (
              <label className="li">
                <div className="grow"><span className="li-t">Update its location to here</span><span className="li-s">Next time it's detected automatically</span></div>
                <input type="checkbox" className="switch" checked={upd} onChange={(e) => setUpd(e.target.checked)} />
              </label>
            )}
          </div>
        )}
      </div>
      <div className="bottombar">
        <button type="button" className="btn btn-primary" onClick={go} disabled={opt === 'existing' && !gid}>{cta}</button>
      </div>
    </div>
  );
}
