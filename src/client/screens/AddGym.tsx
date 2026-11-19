import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addGym, getPosition } from '../store/actions';
import { TEMPLATE_META, templateCount, type GymTemplate } from '../../shared/catalog';

const RADII = [100, 150, 250];
const TPLS: GymTemplate[] = ['full', 'basic', 'home', 'empty'];
const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;

export default function AddGym() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<'idle' | 'locating' | 'denied'>('idle');
  const [skipLoc, setSkipLoc] = useState(false);
  const [radius, setRadius] = useState(150);
  const [tpl, setTpl] = useState<GymTemplate>('basic');
  const [tried, setTried] = useState(false);

  const nameErr = tried && !name.trim();
  const locErr = tried && !pos && !skipLoc;

  const useHere = async () => {
    setGeo('locating');
    const p = await getPosition();
    if (p) { setPos(p); setGeo('idle'); setSkipLoc(false); } else setGeo('denied');
  };

  const save = () => {
    setTried(true);
    if (!name.trim() || (!pos && !skipLoc)) return;
    const id = addGym({ name, template: tpl, lat: pos?.lat ?? null, lng: pos?.lng ?? null, radiusM: radius });
    nav(`/gyms/${id}`, { replace: true });
  };

  const d = radius === 100 ? 60 : radius === 150 ? 84 : 120;

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/gyms" aria-label="Cancel"><span className="ic ic-x lg" aria-hidden="true" /></Link>
        <span className="title">Add gym</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 130 }}>
        <label className="field">
          <span className="lbl" style={{ paddingLeft: 2 }}>Name</span>
          <input className={`input ${nameErr ? 'err' : ''}`} placeholder="e.g. Hotel gym Gothenburg" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={nameErr} />
          {nameErr && <span className="help err">Name the gym so you can tell them apart.</span>}
        </label>

        <div className="card tight">
          <span className="strong">Location</span>
          {!pos ? (
            <>
              <button className="btn btn-soft" onClick={useHere} disabled={geo === 'locating'}>
                <span className="ic ic-nav" aria-hidden="true" />{geo === 'locating' ? 'Locating…' : 'Use my current location'}
              </button>
              {geo === 'denied' && (
                <div className="banner warn" role="alert">
                  <span className="ic ic-alert" aria-hidden="true" />
                  <div className="grow"><span className="b-t">Couldn't get your location</span>Allow location access for this site in your browser settings and try again, or skip it and pick this gym manually when you train.</div>
                </div>
              )}
              {locErr && <span className="help err">Set a location. It's how the gym is detected.</span>}
              <button className="link" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => setSkipLoc((v) => !v)} aria-pressed={skipLoc}>
                {skipLoc ? 'Saving without a location (undo)' : 'Skip location for now'}
              </button>
            </>
          ) : (
            <>
              <div className="map" style={{ height: 140 }} aria-hidden="true">
                <div className="road" style={{ left: 0, right: 0, top: 64, height: 12 }} />
                <div className="road" style={{ top: 0, bottom: 0, left: 230, width: 10 }} />
                <div className="fence" style={{ left: `calc(50% - ${d / 2}px)`, top: 56 - d / 2, width: d, height: d }} />
                <div className="mpin" style={{ left: 'calc(50% - 18px)', top: 40 }}><i /></div>
              </div>
              <div className="between small">
                <span className="sub">{coord(pos.lat, 'N', 'S')}, {coord(pos.lng, 'E', 'W')}</span>
                <button className="link" style={{ minHeight: 44 }} onClick={() => setPos(null)}>Change</button>
              </div>
              <div className="seg c3">
                {RADII.map((r) => (
                  <button key={r} className={radius === r ? 'on' : ''} aria-pressed={radius === r} onClick={() => setRadius(r)}>{r} m</button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card tight">
          <div className="stack-s" style={{ gap: 2 }}><span className="strong">Equipment</span><span className="sub">Start from a template, then fine-tune</span></div>
          <div className="group" style={{ boxShadow: 'none', background: '#F3F2EF' }} role="radiogroup" aria-label="Equipment template">
            {TPLS.map((t) => (
              <button key={t} className="li" style={{ background: 'transparent' }} role="radio" aria-checked={tpl === t} onClick={() => setTpl(t)}>
                <span className={`radio ${tpl === t ? 'on' : ''}`} aria-hidden="true" />
                <div className="grow"><span className="li-t">{TEMPLATE_META[t].label}</span><span className="li-s">{t === 'empty' ? TEMPLATE_META[t].hint.replace(/\.$/, '') : `${templateCount(t)} items`}</span></div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="bottombar">
        <button className="btn btn-primary" onClick={save}>Save and review equipment</button>
      </div>
    </div>
  );
}
