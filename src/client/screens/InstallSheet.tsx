import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useStore } from '../store/core';
import { promptInstall, requestPersistence, setSheetFlag, useInstallState } from '../pwa/install';

const STEPS = [
  ['Tap Share', 'The square with an arrow, in Safari’s bottom bar. On iPad it’s at the top.'],
  ['Tap Add to Home Screen', 'Scroll down the share menu if you don’t see it.'],
  ['Tap Add', 'Then open Gym Tracker from your home screen. You’ll pick up right here.'],
];
const OTHER_STEP1 = 'The square with an arrow, in the address bar. If you don’t see it, open this page in Safari.';
const BROWSER = { safari: 'Safari', chrome: 'Chrome', firefox: 'Firefox', other: 'your browser' } as const;

const CSS = `
.demo{background:#ECEBE7;border-radius:24px;height:230px;position:relative;overflow:hidden;display:flex;align-items:flex-end;justify-content:center}
.sbar{position:absolute;left:0;right:0;bottom:0;height:62px;background:rgba(250,250,250,.96);border-top:1px solid #DDD;display:flex;justify-content:space-around;align-items:center;color:#1D44A8}
.hl{box-shadow:0 0 0 3px #FF5A1F;border-radius:12px;animation:pulse 1.4s ease-in-out infinite}
.urlbar{position:absolute;left:14px;right:14px;top:14px;height:38px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;color:#3D3D3D;gap:6px}
.ssheet{position:absolute;left:12px;right:12px;bottom:0;background:#fff;border-radius:18px 18px 0 0;padding:10px 0;display:flex;flex-direction:column}
.ssheet div{display:flex;justify-content:space-between;align-items:center;padding:11px 16px;font-size:14px;color:#121212}
.ssheet div + div{border-top:1px solid #EEE}
.addbox{position:absolute;left:20px;right:20px;top:24px;background:#fff;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:12px}
.dlg{position:absolute;left:24px;right:24px;top:40px;background:#fff;border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.15)}
`;

type Dev = 'ios' | 'android';
type And = 'idle' | 'dialog' | 'done';
const ICON = `${import.meta.env.BASE_URL}icon-192.png`;

export default function InstallSheet() {
  const inst = useInstallState();
  const onboarded = useStore((s) => s.settings.onboarded);
  const [dev, setDev] = useState<Dev>(inst.platform === 'android' ? 'android' : 'ios');
  const [step, setStep] = useState(1);
  const [and, setAnd] = useState<And>('idle');
  const host = typeof location !== 'undefined' ? location.host : '';

  useEffect(() => { if (inst.installed) { setAnd('done'); void requestPersistence(); } }, [inst.installed]);

  // Never show install UI in the installed app.
  if (inst.standalone) return <Navigate to="/" replace />;

  const st = STEPS[step - 1];
  const detected = dev === inst.platform;
  const browser = inst.platform === 'ios' ? BROWSER[inst.iosBrowser] : 'Safari';
  const iosHead = detected ? `detected ${browser} on iPhone` : 'Safari on iPhone';
  const stepText = step === 1 && detected && inst.iosBrowser !== 'safari' ? OTHER_STEP1 : st[1];
  const canInstall = inst.canPromptInstall && and === 'idle';
  const install = async () => {
    if (!inst.canPromptInstall) return;
    setAnd('dialog');
    const r = await promptInstall();
    setAnd(r === 'accepted' ? 'done' : 'idle');
    if (r === 'accepted') void requestPersistence();
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="scroll" style={{ paddingTop: 28, paddingBottom: 160 }}>
        <div className="hstack" style={{ gap: 14 }}>
          <img src={ICON} alt="" style={{ width: 60, height: 60, borderRadius: 16 }} />
          <div className="stack-s" style={{ gap: 2 }}><h1 className="t-title">Gym Tracker</h1><span className="sub">{host}</span></div>
        </div>
        <div className="stack-s" style={{ gap: 6, paddingTop: 6 }}>
          <h2 className="t-h" style={{ fontSize: 24 }}>Add it to your Home Screen</h2>
          <p className="sub">Opens full screen, works offline in the gym, and keeps your data safe. Takes 20 seconds.</p>
        </div>
        <div className="seg c2 on-bg" role="group" aria-label="Your phone">
          {([['ios', 'iPhone'], ['android', 'Android']] as const).map(([k, label]) => (
            <button key={k} className={dev === k ? 'on' : ''} aria-pressed={dev === k} onClick={() => setDev(k)}>{label}</button>
          ))}
        </div>

        {dev === 'ios' && (
          <div className="card" style={{ gap: 14 }}>
            <div className="between"><span className="eyebrow">Step {step} of 3 · {iosHead}</span></div>
            <span className="t-h">{st[0]}</span>
            <div className="demo" aria-hidden="true">
              <div className="urlbar"><span className="ic ic-lock xs" />{host}</div>
              {step === 1 && (
                <div className="sbar">
                  <span className="ic ic-chev-left" /><span className="ic ic-chev-right" style={{ opacity: 0.4 }} />
                  <span className="hl" style={{ padding: 8, display: 'flex' }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8" /></svg></span>
                  <span className="ic ic-list" /><span className="ic ic-calendar" />
                </div>
              )}
              {step === 2 && (
                <div className="ssheet">
                  <div><span>Copy</span><span className="ic ic-link sm" /></div>
                  <div><span>Add to Favourites</span><span className="ic ic-star sm" /></div>
                  <div className="hl" style={{ margin: '0 6px' }}><b>Add to Home Screen</b><span className="ic ic-plus sm" /></div>
                  <div><span>Find on Page</span><span className="ic ic-search sm" /></div>
                </div>
              )}
              {step === 3 && (
                <div className="addbox">
                  <div className="between small"><span style={{ color: '#1D44A8' }}>Cancel</span><b>Add to Home Screen</b><span className="hl" style={{ color: '#1D44A8', fontWeight: 700, padding: '2px 8px' }}>Add</span></div>
                  <div className="hstack"><img src={ICON} alt="" style={{ width: 52, height: 52, borderRadius: 12 }} /><div className="stack-s" style={{ gap: 0 }}><b>Gym Tracker</b><span className="small sub">{host}</span></div></div>
                </div>
              )}
            </div>
            <p className="sub">{stepText}</p>
            <div className="grid2">
              <button className={`btn btn-soft${step === 1 ? ' disabled' : ''}`} disabled={step === 1} onClick={() => setStep(Math.max(1, step - 1))}>Back</button>
              <button className="btn btn-primary" onClick={() => setStep(step === 3 ? 1 : step + 1)}>{step === 3 ? 'Start over' : 'Next step'}</button>
            </div>
          </div>
        )}

        {dev === 'android' && (
          <div className="card" style={{ gap: 14 }}>
            <span className="eyebrow">{detected ? 'Detected Chrome on Android' : 'Chrome on Android'}</span>
            <div className="demo" aria-hidden="true">
              {and === 'dialog' && (
                <div className="dlg">
                  <b style={{ fontSize: 17 }}>Install app?</b>
                  <div className="hstack"><img src={ICON} alt="" style={{ width: 44, height: 44, borderRadius: 10 }} /><div className="stack-s" style={{ gap: 0 }}><b>Gym Tracker</b><span className="small sub">{host}</span></div></div>
                  <div className="hstack" style={{ justifyContent: 'flex-end', gap: 18, color: '#1D44A8', fontWeight: 700, fontSize: 14 }}><span>Cancel</span><span className="hl" style={{ padding: '4px 10px' }}>Install</span></div>
                </div>
              )}
              {and === 'done' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <img src={ICON} alt="" style={{ width: 64, height: 64, borderRadius: 16 }} /><b>Installed</b><span className="small sub">Find it on your home screen</span>
                </div>
              )}
              {and === 'idle' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center' }}>
                  <span className="sub">{inst.canPromptInstall ? 'One tap. Chrome asks to confirm.' : 'Open Chrome’s ⋮ menu and tap Install app (or Add to Home screen).'}</span>
                </div>
              )}
            </div>
            <button className={`btn btn-primary${canInstall ? '' : ' disabled'}`} disabled={!canInstall} onClick={install}>
              <span className="ic ic-download" aria-hidden="true" />{and === 'dialog' ? 'Confirm in the Chrome dialog' : and === 'done' ? 'Installed' : 'Install app'}
            </button>
          </div>
        )}

        <div className="banner info"><span className="ic ic-info" aria-hidden="true" /><div>On iPhone, Safari can clear a website’s data after a week without visits. Installing, or adding an email later, keeps your training history safe.</div></div>
      </div>
      <div className="bottombar">
        <Link className="btn btn-ghost" to={onboarded ? '/' : '/welcome'} onClick={() => setSheetFlag('dismissed')}>Continue in the browser for now</Link>
      </div>
    </div>
  );
}
