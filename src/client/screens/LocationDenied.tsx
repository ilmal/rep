import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { chooseGym, useGyms, useWeek } from '../store/actions';
import { useStore } from '../store/core';
import { startFlow } from '../store/x-onboarding';
import { ago } from '../lib/format';

/** Rendered in place by PreSession when geolocation is denied. */
export default function LocationDenied({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const gyms = useGyms();
  const { next } = useWeek();
  const chosen = useStore((s) => s.device.chosenSlot);
  const [sel, setSel] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const selGym = gyms.find((g) => g.id === sel);

  const done = () => { startFlow.confirmed = true; if (onDone) onDone(); else navigate('/session/preview'); };
  const confirm = (id: string) => { chooseGym(id); done(); };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/" aria-label="Back"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Start session {chosen ?? next}</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 0, paddingBottom: 130 }}>
        <div className="empty" style={{ padding: '16px 12px 8px' }}>
          <div className="empty-ic blue"><span className="ic ic-pin xxl" aria-hidden="true" /></div>
          <h1 className="t-title">Location is off</h1>
          <p className="sub">We can't detect your gym, so pick it yourself. Plans will only include exercises that gym's equipment supports.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHint(true)}><span className="ic ic-gear sm" aria-hidden="true" />Turn on in phone settings</button>
        </div>
        <span className="lbl" style={{ padding: '6px 2px 0' }}>Where are you?</span>
        <div className="group" role="radiogroup" aria-label="Gym">
          {gyms.map((g) => {
            const on = sel === g.id;
            return (
              <button type="button" role="radio" aria-checked={on} className="li" key={g.id} onClick={() => setSel(g.id)}>
                <span className={`radio ${on ? 'on' : ''}`} aria-hidden="true" />
                <div className="grow"><span className="li-t">{g.name}</span><span className="li-s">{g.lastVisitedAt ? `Last used ${ago(g.lastVisitedAt)}` : 'Not used yet'}</span></div>
              </button>
            );
          })}
        </div>
        <Link className="btn btn-ghost" to="/gyms/new"><span className="ic ic-plus" aria-hidden="true" />Somewhere new</Link>
      </div>
      <div className="bottombar">
        <button type="button" className="btn btn-primary" disabled={!selGym} onClick={() => selGym && confirm(selGym.id)}>{selGym ? `Continue at ${selGym.name}` : 'Pick a gym to continue'}</button>
      </div>
      {hint && (
        <div className="toast" role="status"><span className="ic ic-info" aria-hidden="true" /><span className="grow">{ios ? 'Opens iOS Settings › Gym Tracker › Location' : "Open your phone's Settings, then this app's Location permission."}</span><button type="button" className="banner-act" onClick={() => setHint(false)}>OK</button></div>
      )}
    </div>
  );
}
