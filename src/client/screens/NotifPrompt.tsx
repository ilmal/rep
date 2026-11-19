import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/core';
import { selectStreak } from '../store/x-streak';
import { detectPlatform } from '../pwa/install';
import { disablePush, enablePush, loadPrefs, pushStatus, pushSupport, savePrefsEverywhere, permissionState, type PushPrefs, type PushStatus } from '../push';

const ICON = `${import.meta.env.BASE_URL}icon-192.png`;
const CSS = `
.badgeicon{position:relative;width:72px;height:72px}
.badgeicon img{width:72px;height:72px;border-radius:18px}
.badgeicon b{position:absolute;top:-8px;right:-8px;min-width:28px;height:28px;border-radius:14px;background:#FF3B30;color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;padding:0 7px;box-shadow:0 0 0 3px #F3F2EF}
.lockprev{background:#16181C;border-radius:24px;padding:14px;display:flex;flex-direction:column;gap:10px;color:#fff}
.lockprev .notif{width:100%;display:flex;gap:12px;align-items:flex-start;background:rgba(255,255,255,.14);border-radius:24px;padding:14px 16px;text-align:left;color:#fff}
.lockprev .notif img{width:38px;height:38px;border-radius:10px;flex-shrink:0}
.lockprev .notif .h{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:#C9C9C9;font-weight:600}
.lockprev .notif b{display:block;font-size:16px;margin-top:2px}
.lockprev .notif span.t{display:block;font-size:15px;color:#E6E6E6;line-height:1.35}
.lockprev .notif.dim{opacity:.55}
.switch:disabled{opacity:.45;cursor:default}
.linkbtn{background:none;border:0;padding:0;font-family:inherit;cursor:pointer;text-align:left;min-height:44px;display:inline-flex;align-items:center}
`;

type View = PushStatus | 'asking' | 'enabled' | 'offline' | 'error';

const ROWS: { key: keyof PushPrefs; tile: string; icon: string; t: string; s: string }[] = [
  { key: 'rest', tile: 'tile sm warm', icon: 'ic-timer', t: 'Rest is over', s: 'Next set and weight, on the lock screen' },
  { key: 'left', tile: 'tile sm', icon: 'ic-clock', t: 'Session left running', s: 'After 30 min with nothing logged' },
  { key: 'streak', tile: 'tile sm warm', icon: 'ic-flame', t: 'Streak reminders', s: 'Only when your streak is at risk. Max one a day, never after 21:00' },
  // legacy: the design merged the weekly nudge into the streak reminders, so this row only shows for people who already turned it on
  { key: 'nudge', tile: 'tile sm', icon: 'ic-calendar', t: 'Weekly nudge', s: 'Friday morning, only if behind. Never guilt.' },
  { key: 'badge', tile: 'tile sm', icon: 'ic-target', t: 'Icon badge', s: 'Sessions left this week' },
];

function initialView(): View {
  const sup = pushSupport();
  if (sup !== 'ok') return sup;
  return permissionState() === 'denied' ? 'denied' : 'idle';
}

export default function NotifPrompt() {
  const navigate = useNavigate();
  const loc = useLocation();
  const sessions = useStore((s) => s.sessions);
  const settings = useStore((s) => s.settings);
  const [view, setView] = useState<View>(initialView);
  const [prefs, setPrefs] = useState<PushPrefs>(loadPrefs);
  const [preview, setPreview] = useState(false);
  const [existing, setExisting] = useState(false); // already on when the screen opened (vs. just enabled here)
  const ios = detectPlatform() === 'ios';

  useEffect(() => {
    let live = true;
    void pushStatus().then((r) => { if (!live) return; if (r.status === 'on') setExisting(true); setView((v) => (v === 'idle' || v === 'on' ? r.status : v)); setPrefs(r.prefs); });
    return () => { live = false; };
  }, []);

  const left = useMemo(() => selectStreak().currentWeek.left, [sessions, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { if (loc.key !== 'default') navigate(-1); else navigate('/', { replace: true }); };

  const toggle = (k: keyof PushPrefs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const p = { ...prefs, [k]: e.target.checked };
    setPrefs(p);
    void savePrefsEverywhere(p);
  };
  const ask = async () => {
    setView('asking');
    const r = await enablePush(prefs);
    if (r.ok) { setView('enabled'); return; }
    setView(r.reason === 'denied' ? 'denied' : r.reason === 'dismissed' ? 'idle' : r.reason === 'offline' ? 'offline' : r.reason === 'unsupported' || r.reason === 'ios-install' ? r.reason : 'error');
  };
  const turnOff = async () => { await disablePush(); setExisting(false); setView('idle'); };

  const on = view === 'on' || view === 'enabled';
  const locked = view === 'unsupported' || view === 'ios-install' || view === 'denied';
  const asking = view === 'asking';

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="topbar">
        <button type="button" className="iconbtn" aria-label="Close" onClick={next}><span className="ic ic-x lg" aria-hidden="true" /></button>
        <span className="title" /><span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 0, paddingBottom: 160 }}>
        <div className="hstack" style={{ gap: 18, padding: '4px 2px' }}>
          <div className="badgeicon"><img src={ICON} alt="" />{left > 0 && <b aria-label={`${left} sessions left this week`}>{left}</b>}</div>
          <div className="stack-s" style={{ gap: 4 }}><h1 className="t-title">A tap on the shoulder</h1><span className="sub">The icon badge shows sessions left this week.</span></div>
        </div>
        <p className="sub" style={{ fontSize: 16 }}>Your phone can tell you when rest is over, even with the screen locked. You choose which alerts you get.</p>
        <div className="group">
          {ROWS.filter((r) => r.key !== 'nudge' || prefs.nudge).map((r) => (
            <label className="li" key={r.key}>
              <span className={r.tile}><span className={`ic ${r.icon} sm`} aria-hidden="true" /></span>
              <div className="grow"><span className="li-t">{r.t}</span><span className="li-s">{r.s}</span></div>
              <input type="checkbox" className="switch" checked={prefs[r.key]} onChange={toggle(r.key)} disabled={locked || asking} />
            </label>
          ))}
        </div>
        <button type="button" className="link small linkbtn" aria-expanded={preview} onClick={() => setPreview((p) => !p)}>{preview ? 'Hide the lock screen preview' : 'See how they look on the lock screen'}</button>
        {preview && (
          <div className="lockprev" aria-label="Lock screen preview">
            <div className="notif"><img src={ICON} alt="" /><div><div className="h"><span>GYM TRACKER</span><span>now</span></div><b>Rest over: set 3 of 4</b><span className="t">Back squat · 82.5 kg × 6. Let’s go.</span></div></div>
            <div className="notif"><img src={ICON} alt="" /><div><div className="h"><span>GYM TRACKER</span><span>Yesterday 19:58</span></div><b>Session 2 is still running</b><span className="t">Last set logged 19:21. Tap to finish and save it.</span></div></div>
            <div className="notif"><img src={ICON} alt="" /><div><div className="h"><span>GYM TRACKER</span><span>Wed 17:30</span></div><b>Your 7-week streak is at risk</b><span className="t">4 sessions, 5 days left. Tap to plan the week.</span></div></div>
          </div>
        )}
        {on && <div className="banner ok" role="status"><span className="ic ic-check" aria-hidden="true" /><div><span className="b-t">Notifications on</span>Change them any time in Settings.</div></div>}
        {view === 'denied' && <div className="banner warn" role="status"><span className="ic ic-info" aria-hidden="true" /><div><span className="b-t">Notifications are off</span>The app works the same. To turn them on later: {ios ? 'iPhone Settings › Notifications › Gym Tracker' : 'your browser’s site settings › Notifications › Gym Tracker'}.</div></div>}
        {view === 'ios-install' && <div className="banner info" role="status"><span className="ic ic-info" aria-hidden="true" /><div><span className="b-t">Add Gym Tracker to your Home Screen first</span>On iPhone, notifications only work in the installed app. It takes a few taps, then come back here.</div></div>}
        {view === 'unsupported' && <div className="banner warn" role="status"><span className="ic ic-info" aria-hidden="true" /><div><span className="b-t">Notifications aren’t available here</span>This browser can’t send them. The app works the same, and rest still ends with a sound and buzz while it’s open.</div></div>}
        {view === 'offline' && <div className="banner warn" role="alert"><span className="ic ic-info" aria-hidden="true" /><div><span className="b-t">You’re offline</span>Connect and try again. Notifications need a connection to switch on.</div></div>}
        {view === 'error' && <div className="banner warn" role="alert"><span className="ic ic-info" aria-hidden="true" /><div><span className="b-t">Couldn’t turn on notifications</span>Something went wrong on our side. Try again in a moment.</div></div>}
      </div>
      <div className="bottombar">
        {(view === 'idle' || asking || view === 'offline' || view === 'error') && <button type="button" className="btn btn-primary" onClick={ask} disabled={asking} aria-busy={asking}>Turn on notifications</button>}
        {view === 'ios-install' && <Link className="btn btn-primary" to="/install">Show me how</Link>}
        {(on || view === 'denied' || view === 'unsupported') && <button type="button" className="btn btn-primary" onClick={next}>Done</button>}
        {on && existing && <button type="button" className="btn btn-ghost" style={{ minHeight: 40, fontSize: 14 }} onClick={turnOff}>Turn off notifications</button>}
        {view !== 'unsupported' && !(on && existing) && <button type="button" className="btn btn-ghost" style={{ minHeight: 40, fontSize: 14 }} onClick={next}>Not now</button>}
      </div>
    </div>
  );
}
