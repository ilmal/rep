import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getState, useStore } from '../store/core';
import { updateSettings, useGyms, useSessions, useSettings } from '../store/actions';
import { deleteAllData, logout, syncNow } from '../store/sync';
import { downloadCsv, downloadJson } from '../store/x-export';
import { completed } from '../../shared/rules';
import { statusOf } from '../../shared/planner';
import { ago } from '../lib/format';
import { useNow } from '../lib/hooks';
import SyncError from './SyncError';

const VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '1.0';

function Toggle({ label, sub, checked, onChange, tag }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; tag?: string }) {
  return (
    <label className="li">
      <div className="grow">
        {tag ? <span className="hstack" style={{ gap: 6 }}><span className="li-t">{label}</span><span className="tag blue">{tag}</span></span> : <span className="li-t">{label}</span>}
        {sub && <span className="li-s">{sub}</span>}
      </div>
      <input type="checkbox" role="switch" className="switch" checked={checked} aria-checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function Settings() {
  const s = useSettings();
  const gyms = useGyms();
  const sessions = useSessions();
  const device = useStore((st) => st.device);
  const online = useStore((st) => st.online);
  const syncing = useStore((st) => st.syncing);
  const outbox = useStore((st) => st.outbox);
  const nowMs = useNow(30_000);
  const pending = useMemo(() => Object.keys(outbox).length, [outbox]);
  const done = useMemo(() => completed(sessions), [sessions]);

  const prefs = useStore((st) => st.prefs);
  const [sheet, setSheet] = useState<null | 'delete' | 'export' | 'signout'>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const prefCounts = useMemo(() => {
    const t = Date.now(); const c = { favorite: 0, paused: 0, banned: 0 };
    for (const p of Object.values(prefs)) { const st = statusOf(p, t); if (st === 'favorite') c.favorite++; else if (st === 'paused') c.paused++; else if (st === 'banned') c.banned++; }
    return c;
  }, [prefs]);

  const first = done.reduce<number | null>((m, x) => (m == null || x.startedAt < m ? x.startedAt : m), null);
  const since = first ? new Date(first).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null;
  const initial = (s.name.trim()[0] ?? 'R').toUpperCase();
  const hasAccount = !!device.token;

  const syncText = !online ? `Offline${pending ? ` · ${pending} ${pending === 1 ? 'change' : 'changes'} waiting` : ''}`
    : syncing ? `Syncing${pending ? ` ${pending} ${pending === 1 ? 'change' : 'changes'}` : ''}…`
    : device.lastSyncError ? `Couldn’t sync${pending ? ` · ${pending} ${pending === 1 ? 'change' : 'changes'} waiting` : ''}${device.lastSyncAt ? ` · last synced ${ago(device.lastSyncAt, nowMs)}` : ''}`
    : pending ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting${device.lastSyncAt ? ` · last synced ${ago(device.lastSyncAt, nowMs)}` : ''}`
    : device.lastSyncAt ? `Up to date · ${ago(device.lastSyncAt, nowMs)}` : 'Not synced yet';

  const doExport = (kind: 'csv' | 'json') => {
    try { if (kind === 'csv') downloadCsv(); else downloadJson(); setSheet(null); setMsg(`Exported your data as ${kind.toUpperCase()}.`); }
    catch { setSheet(null); setMsg('Export failed. Try again.'); }
  };

  const signOut = async () => {
    setErr(''); setBusy(true);
    try {
      // Signing out removes local data: make sure nothing unsent is lost first.
      if (online && Object.keys(outbox).length) await syncNow();
      if (Object.keys(getState().outbox).length && getState().device.token) { setErr('Some changes haven’t been backed up yet. Try again in a moment.'); setBusy(false); return; }
      await logout();
    } finally { /* reload below */ }
    window.location.assign(`${import.meta.env.BASE_URL}welcome`);
  };

  const wipe = async (account: boolean) => {
    setBusy(true);
    try { await deleteAllData(account); } finally { window.location.reload(); }
  };

  const rest: [number, string][] = [[60, '60 s'], [90, '90 s'], [120, '2 min']];
  const unsent = pending > 0;

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/" aria-label="Back to Today"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Settings</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <span className="avatar" style={{ width: 56, height: 56, borderRadius: 28, fontSize: 22 }} aria-hidden="true">{initial}</span>
          <div className="grow stack-s" style={{ gap: 2 }}>
            <label htmlFor="pname" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Your name</label>
            <input id="pname" className="t-h" style={{ border: 0, background: 'transparent', padding: 0, font: 'inherit', fontWeight: 700, fontSize: 20, width: '100%', minHeight: 28 }} placeholder="Your name" value={s.name} onChange={(e) => updateSettings({ name: e.target.value })} />
            <span className="sub">{since ? `Member since ${since} · ` : ''}{done.length} {done.length === 1 ? 'session' : 'sessions'}</span>
          </div>
        </div>

        {msg && <div className="banner ok" role="status"><span className="ic ic-check" aria-hidden="true" /><div className="grow">{msg}</div><button className="banner-act" onClick={() => setMsg('')}>OK</button></div>}

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Training</span>
        <div className="group">
          <Link className="li" to="/plan"><div className="grow"><span className="li-t">Weekly goal &amp; rotation</span><span className="li-s">{s.weeklyGoal} sessions · {s.targetMinutes} min · {s.rotation.length} {s.rotation.length === 1 ? 'area' : 'areas'}</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
          <Link className="li" to="/library/exclusions"><div className="grow"><span className="li-t">Exercise preferences</span><span className="li-s">{prefCounts.favorite} {prefCounts.favorite === 1 ? 'favourite' : 'favourites'} · {prefCounts.paused} paused · {prefCounts.banned} banned</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
          <div className="li" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <span className="li-t">Default rest</span>
            <div className="seg c3" role="group" aria-label="Default rest">
              {rest.map(([v, l]) => <button key={v} className={s.restSec === v ? 'on' : ''} aria-pressed={s.restSec === v} onClick={() => updateSettings({ restSec: v })}>{l}</button>)}
            </div>
          </div>
          <div className="li" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <span className="li-t">Units</span>
            <div className="seg c2" role="group" aria-label="Units">
              {([['kg', 'Kilograms'], ['lb', 'Pounds']] as const).map(([v, l]) => <button key={v} className={s.unit === v ? 'on' : ''} aria-pressed={s.unit === v} onClick={() => updateSettings({ unit: v })}>{l}</button>)}
            </div>
          </div>
          <Toggle label="Rest timer sound & haptics" checked={s.sound} onChange={(v) => updateSettings({ sound: v })} />
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Notifications</span>
        <div className="group">
          <Link className="li" to="/notifications"><div className="grow"><span className="li-t">Alerts &amp; icon badge</span><span className="li-s">Rest over, session left running, streak at risk</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
          <Link className="li" to="/install"><div className="grow"><span className="li-t">Install on your home screen</span><span className="li-s">Needed for alerts on iPhone</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Location</span>
        <div className="group">
          <Toggle label="Auto-detect gym" sub="Uses GPS when you start a session" checked={s.gps} onChange={(v) => updateSettings({ gps: v })} />
          {!s.gps && <Link className="li" to="/gyms"><span className="ic ic-alert" style={{ color: '#A8360A' }} aria-hidden="true" /><div className="grow"><span className="li-t">You'll pick a gym manually</span><span className="li-s">See what changes</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>}
          <Link className="li" to="/gyms"><div className="grow"><span className="li-t">Gyms &amp; equipment</span><span className="li-s">{gyms.length} {gyms.length === 1 ? 'gym' : 'gyms'}</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Smart adjustments</span>
        <div className="group">
          <Toggle label="Fit sessions to target time" sub="Trim rest or drop an accessory, always with undo" checked={s.fitToTime} onChange={(v) => updateSettings({ fitToTime: v })} />
          <Toggle label="Auto-swap missing equipment" sub="Local matching by muscles and pattern" checked={s.suggestSwaps} onChange={(v) => updateSettings({ suggestSwaps: v })} />
          <Toggle label="AI assist" tag="Optional" sub="Smarter generation and swaps. Needs a connection. Core features work without it." checked={s.aiAssist} onChange={(v) => updateSettings({ aiAssist: v })} />
          <Link className="li" to="/settings/coach"><span className="tile sm"><span className="ic ic-sparkle sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">AI coach</span><span className="li-s">Let an agent such as Grok build and tune your workouts over MCP. Optional; the core app never needs it.</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Account</span>
        <div className="group">
          {device.email ? (
            <div className="li"><span className="tile sm green"><span className="ic ic-user sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">{device.email}</span><span className="li-s">Signed in · data is backed up</span></div></div>
          ) : (
            <Link className="li" to="/signin"><span className="tile sm blue"><span className="ic ic-cloud sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Save progress</span><span className="li-s">Sign in with your email. No password. Sync across devices and survive a lost phone.</span></div><span className="ic ic-chev-right chev" aria-hidden="true" /></Link>
          )}
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Data</span>
        <SyncError error={device.lastSyncError} queued={pending} lastSyncAt={device.lastSyncAt} syncing={syncing} onRetry={() => { void syncNow(); }} />
        <div className="group">
          <div className="li">
            <span className={`tile sm ${syncing ? 'blue' : online && !device.lastSyncError ? 'green' : ''}`}><span className={`ic ${syncing ? 'ic-refresh' : online ? 'ic-cloud' : 'ic-wifi-off'} sm ${syncing ? 'spinning' : ''}`} aria-hidden="true" /></span>
            <div className="grow"><span className="li-t">Cloud sync</span><span className="li-s" role="status">{syncText}</span></div>
            <button className="btn btn-soft btn-sm" onClick={() => { void syncNow(); }} disabled={syncing || !online}>Sync now</button>
          </div>
          <button className="li" onClick={() => setSheet('export')}><span className="tile sm"><span className="ic ic-download sm" aria-hidden="true" /></span><div className="grow"><span className="li-t">Export all data</span><span className="li-s">CSV or JSON: sessions, sets, timing, feedback</span></div></button>
          <button className="li" onClick={() => { setErr(''); setSheet('delete'); }}><span className="tile sm red"><span className="ic ic-trash sm" aria-hidden="true" /></span><div className="grow"><span className="li-t" style={{ color: '#B42318' }}>Delete all data</span></div></button>
        </div>
        {device.email && <button className="btn btn-ghost" onClick={() => { setErr(''); setSheet('signout'); }}><span className="ic ic-logout" aria-hidden="true" />Sign out</button>}
        <p className="small sub center">Version {VERSION}</p>
      </div>

      {sheet === 'export' && (
        <>
          <button className="scrim" aria-label="Close" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-label="Export all data">
            <div className="grabber" />
            <div className="between">
              <h2 className="t-h">Export all data</h2>
              <button className="iconbtn" aria-label="Close" style={{ marginRight: -10 }} onClick={() => setSheet(null)}><span className="ic ic-x" aria-hidden="true" /></button>
            </div>
            <p className="sub">Saved to this device, no connection needed. Weights are in kilograms.</p>
            <button className="btn btn-primary" onClick={() => doExport('csv')}><span className="ic ic-download" aria-hidden="true" />Download CSV</button>
            <p className="small sub">One row per set: session, exercise, weight, reps, timing and your feedback. Opens in Excel or Sheets.</p>
            <button className="btn btn-secondary" onClick={() => doExport('json')}><span className="ic ic-download" aria-hidden="true" />Download JSON</button>
            <p className="small sub">Everything, including settings, gyms, plans and preferences.</p>
          </div>
        </>
      )}

      {sheet === 'signout' && (
        <>
          <button className="scrim" aria-label="Cancel" onClick={() => setSheet(null)} />
          <div className="dialog" role="alertdialog" aria-label="Sign out">
            <h2 className="t-h center">Sign out?</h2>
            <p className="sub center">Your data stays safe in your account. It will be removed from this phone and comes back when you sign in again.</p>
            {unsent && !online && <p className="help err center" role="alert">You’re offline and {pending} {pending === 1 ? 'change hasn’t' : 'changes haven’t'} been backed up. Connect first so nothing is lost.</p>}
            {err && <p className="help err center" role="alert">{err}</p>}
            <button className="btn btn-danger" onClick={() => void signOut()} disabled={busy || (unsent && !online)}>{busy ? 'Signing out…' : 'Sign out'}</button>
            <button className="btn btn-soft" onClick={() => setSheet(null)}>Stay signed in</button>
          </div>
        </>
      )}

      {sheet === 'delete' && (
        <>
          <button className="scrim" aria-label="Cancel" onClick={() => setSheet(null)} />
          <div className="dialog" role="alertdialog" aria-label="Delete all data">
            <div className="empty-ic red" style={{ width: 64, height: 64, alignSelf: 'center' }}><span className="ic ic-trash xl" aria-hidden="true" /></div>
            <h2 className="t-h center">Delete everything?</h2>
            <p className="sub center">{done.length} {done.length === 1 ? 'session' : 'sessions'}, all sets, timing, feedback and gym maps will be removed from this phone{hasAccount ? ' and the cloud' : ''}. This can’t be undone.</p>
            {hasAccount && !online && <p className="help err center" role="alert">You’re offline. Connect to also remove the cloud copy.</p>}
            <button className="btn btn-danger" onClick={() => void wipe(false)} disabled={busy || (hasAccount && !online)}>{busy ? 'Deleting…' : 'Delete all data'}</button>
            {hasAccount && <button className="btn btn-danger-soft" onClick={() => void wipe(true)} disabled={busy || !online}>Delete all data and my account</button>}
            <button className="btn btn-soft" onClick={() => setSheet(null)}>Keep my data</button>
          </div>
        </>
      )}
    </div>
  );
}
