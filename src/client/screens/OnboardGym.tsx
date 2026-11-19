import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { templateCount, type GymTemplate } from '../../shared/catalog';
import { getPosition } from '../store/actions';
import { patchOnboarding, useOnboarding } from '../store/x-onboarding';

const TPLS: { key: GymTemplate; label: string }[] = [
  { key: 'full', label: 'Full gym' }, { key: 'basic', label: 'Basic' }, { key: 'home', label: 'Home' },
];
const tplLabel = (t: GymTemplate) => TPLS.find((x) => x.key === t)?.label ?? t;
const TPL_DESC: Record<string, string> = {
  full: 'racks, barbells, dumbbells to 50 kg, cables, machines.',
  basic: 'dumbbells, bench, cable station, a few machines.',
  home: 'adjustable dumbbells, bench, bands, pull-up bar.',
};
const tplHint = (t: GymTemplate) => `${templateCount(t)} items: ${TPL_DESC[t] ?? ''}`;
const SPIN_CSS = '@keyframes spin{to{transform:rotate(360deg)}}.spinner{width:22px;height:22px;border-radius:11px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;animation:spin .8s linear infinite}';

function TemplatePicker({ value, onChange }: { value: GymTemplate; onChange: (t: GymTemplate) => void }) {
  return (
    <div className="field">
      <span className="lbl">Start from</span>
      <div className="seg c3">
        {TPLS.map((t) => (
          <button type="button" key={t.key} className={value === t.key ? 'on' : ''} aria-pressed={value === t.key} onClick={() => onChange(t.key)}>{t.label}</button>
        ))}
      </div>
      <span className="help">{tplHint(value)}</span>
    </div>
  );
}

export default function OnboardGym() {
  const navigate = useNavigate();
  const o = useOnboarding();
  const [locating, setLocating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [xName, setXName] = useState('');
  const [xTpl, setXTpl] = useState<GymTemplate>('basic');

  async function locate() {
    if (locating) return;
    setLocating(true);
    const pos = await getPosition();
    setLocating(false);
    patchOnboarding({ gymStage: 'found', primary: { ...o.primary, lat: pos?.lat ?? null, lng: pos?.lng ?? null }, locationNote: pos ? '' : 'unavailable' });
  }
  function skip() {
    patchOnboarding({ gymStage: 'found', primary: { ...o.primary, lat: null, lng: null }, locationNote: '' });
  }
  function addExtra() {
    const name = xName.trim();
    if (!name) return;
    patchOnboarding({ extra: [...o.extra, { name, template: xTpl, lat: null, lng: null }] });
    setXName(''); setXTpl('basic'); setAdding(false);
  }

  const ask = o.gymStage === 'ask';
  const located = o.primary.lat != null && o.primary.lng != null;

  return (
    <div className="app">
      <style>{SPIN_CSS}</style>
      <div className="topbar">
        <Link className="iconbtn" to="/onboarding/goal" aria-label="Back"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <div className="grow" style={{ padding: '0 48px 0 8px' }}>
          <div className="segs" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}><span className="on" /><span className="on" /><span /></div>
        </div>
      </div>

      {ask ? (
        <>
          <div className="scroll" style={{ paddingTop: 16 }}>
            <div className="stack-s">
              <span className="eyebrow">Step 2 of 3</span>
              <h1 className="t-display">Where do you train?</h1>
              <p className="sub">With location on, the app knows which gym you're in when you start. You'll only get exercises that gym can do.</p>
            </div>
            <div className="map" style={{ height: 220 }} aria-hidden="true">
              <div className="road" style={{ left: 0, right: 0, top: 96, height: 14 }} />
              <div className="road" style={{ top: 0, bottom: 0, left: 150, width: 12 }} />
              <div className="fence" style={{ left: 104, top: 54, width: 104, height: 104 }} />
              <div className="mpin" style={{ left: 138, top: 70 }}><i /></div>
            </div>
            <div className="group">
              <div className="li"><span className="tile sm green"><span className="ic ic-pin sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Auto-detect your gym</span><span className="li-s">Matched when a session starts</span></div></div>
              <div className="li"><span className="tile sm blue"><span className="ic ic-dumbbell sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Equipment-aware plans</span><span className="li-s">Each gym keeps its own inventory</span></div></div>
              <div className="li"><span className="tile sm"><span className="ic ic-lock sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Only while the app is open</span><span className="li-s">Never tracked in the background</span></div></div>
            </div>
          </div>
          <div className="bottombar">
            <button type="button" className="btn btn-primary" onClick={locate} disabled={locating}>{locating && <span className="spinner" aria-hidden="true" />}{locating ? 'Finding you…' : 'Turn on location'}</button>
            <button type="button" className="btn btn-ghost" onClick={skip} disabled={locating}>Not now — I'll pick gyms manually</button>
          </div>
        </>
      ) : (
        <>
          <div className="scroll" style={{ paddingTop: 16 }}>
            <div className="stack-s">
              <span className="eyebrow">Step 2 of 3</span>
              <h1 className="t-display">Add your gyms</h1>
              <p className="sub">
                {located ? "You're near a gym. Name it and pick a starting equipment set. You can fine-tune it later." : 'Name your main gym and pick a starting equipment set. You can fine-tune it later.'}
              </p>
            </div>
            {o.locationNote === 'unavailable' && (
              <div className="banner info" role="status"><span className="ic ic-info" aria-hidden="true" /><div><span className="b-t">Couldn't get your location</span>This gym will be saved without a location, so it won't be detected automatically. You can add it later in Gyms.</div></div>
            )}
            <div className="card" style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
              {located && (
                <div className="map" style={{ height: 130, borderRadius: 0 }} aria-hidden="true">
                  <div className="road" style={{ left: 0, right: 0, top: 60, height: 12 }} />
                  <div className="road" style={{ top: 0, bottom: 0, left: 210, width: 10 }} />
                  <div className="fence" style={{ left: 160, top: 20, width: 92, height: 92 }} />
                  <div className="mpin" style={{ left: 188, top: 34 }}><i /></div>
                </div>
              )}
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label className="field">
                  <span className="lbl">Gym name</span>
                  <input className="input" value={o.primary.name} placeholder="My gym" aria-label="Gym name" maxLength={60} onChange={(e) => patchOnboarding({ primary: { ...o.primary, name: e.target.value } })} />
                </label>
                <TemplatePicker value={o.primary.template} onChange={(t) => patchOnboarding({ primary: { ...o.primary, template: t } })} />
              </div>
            </div>

            <div className="section-row"><span className="strong">Other gyms</span><span className="sub">You mentioned 2–3</span></div>
            {o.extra.map((g, i) => (
              <div className="li" key={`${g.name}-${i}`} style={{ borderRadius: 20 }}>
                <span className="tile sm"><span className="ic ic-building sm" aria-hidden="true" /></span>
                <div className="grow"><span className="li-t">{g.name}</span><span className="li-s">{tplLabel(g.template)} · added manually</span></div>
                <button type="button" className="iconbtn" aria-label={`Remove ${g.name}`} onClick={() => patchOnboarding({ extra: o.extra.filter((_, j) => j !== i) })}><span className="ic ic-x sm" aria-hidden="true" /></button>
              </div>
            ))}
            {adding ? (
              <div className="card" style={{ gap: 14 }}>
                <label className="field">
                  <span className="lbl">Gym name</span>
                  <input className="input" value={xName} maxLength={60} placeholder="e.g. Office gym" onChange={(e) => setXName(e.target.value)} />
                </label>
                <TemplatePicker value={xTpl} onChange={setXTpl} />
                <div className="grid2">
                  <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={() => setAdding(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={!xName.trim()} onClick={addExtra}>Add gym</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}><span className="ic ic-plus" aria-hidden="true" />Add another gym</button>
            )}
          </div>
          <div className="bottombar">
            <button type="button" className="btn btn-primary" onClick={() => navigate('/onboarding/areas')}>Continue</button>
          </div>
        </>
      )}
    </div>
  );
}
