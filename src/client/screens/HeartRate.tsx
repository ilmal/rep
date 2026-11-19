import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/core';
import { updateSettings, useSettings } from '../store/actions';
import { ensureAccount } from '../store/sync';
import { createHrKey, fetchHrKeyStatus, revokeHrKey, type HrKeyStatus } from '../store/x-hr';
import { useNow } from '../lib/hooks';
import { DEFAULT_HR, INTERVAL_CHOICES, agoText, estimateMaxHr, isStale } from '../../shared/heartrate';

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
  }
}

export default function HeartRate() {
  const nav = useNavigate();
  const settings = useSettings();
  const online = useStore((s) => s.online);
  const hr = { ...DEFAULT_HR, ...(settings.heartRate ?? {}) };
  const now = useNow(30_000);
  const [status, setStatus] = useState<HrKeyStatus | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const [age, setAge] = useState('');
  const url = `${location.origin}/api/hr/ingest`;

  const load = useCallback(async () => { const s = await fetchHrKeyStatus(); if (s) setStatus(s); }, []);
  // while this screen is open, check every 5 s so a first reading shows up right after the iPhone is set up
  useEffect(() => { if (!online) return; void load(); const t = setInterval(() => { void load(); }, 5000); return () => clearInterval(t); }, [online, load]);

  const set = (patch: Partial<typeof hr>) => updateSettings({ heartRate: { ...hr, ...patch } });
  const makeKey = async () => {
    setErr(''); setBusy(true);
    try {
      if (!(await ensureAccount())) { setErr('Couldn’t reach the server. Connect to the internet and try again.'); return; }
      const k = await createHrKey();
      if (!k) { setErr('The server didn’t create a key. Try again.'); return; }
      setFresh(k); await load();
    } finally { setBusy(false); }
  };
  const revoke = async () => { setBusy(true); await revokeHrKey(); setFresh(null); await load(); setBusy(false); };
  const doCopy = async (k: string, t: string) => { if (await copy(t)) { setCopied(k); setTimeout(() => setCopied(''), 1800); } };
  useEffect(() => { setAge(status?.lastSampleAt ? agoText(now, status.lastSampleAt) : ''); }, [status, now]);

  const stale = isStale(now, status?.lastSampleAt, hr.intervalMin);
  const ready = status?.hasKey;

  return (
    <div className="app">
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={() => nav(-1)}><span className="ic ic-chev-left lg" aria-hidden="true" /></button>
        <span className="title">Heart rate</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <div className="card tight">
          <div className="hstack" style={{ gap: 12 }}><span className="tile red"><span className="ic ic-heart-pulse" aria-hidden="true" /></span><h1 className="t-h grow">Track your pulse</h1></div>
          <p className="sub">See your heart rate on the workout screen and in each session summary, and let your coach use it. Your iPhone sends readings from Apple Health (AirPods Pro or Apple Watch) in the background. Rep itself can’t read AirPods or run in the background on iOS, so a small automation on your iPhone does the sending.</p>
        </div>

        <div className="card tight stack-s" style={{ gap: 14 }}>
          <label className="li" style={{ gap: 12 }}>
            <div className="grow"><span className="li-t">Show heart rate</span><span className="li-s">Pulse on the workout screen and session summaries</span></div>
            <input type="checkbox" role="switch" className="switch" checked={hr.enabled} aria-checked={hr.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          </label>
          <div>
            <span className="lbl">Reading every (outside workouts)</span>
            <div className="chips" role="group" aria-label="Reading interval" style={{ marginTop: 8 }}>
              {INTERVAL_CHOICES.map((m) => <button key={m} type="button" aria-pressed={hr.intervalMin === m} onClick={() => set({ intervalMin: m })}>{m} min</button>)}
            </div>
            <p className="small" style={{ marginTop: 8 }}>Set the same interval in the iPhone automation below. During a workout, readings should come about every minute.</p>
          </div>
          <label className="stack-s" style={{ gap: 6 }}>
            <span className="lbl">Max heart rate (optional)</span>
            <input className="input" inputMode="numeric" aria-label="Max heart rate" placeholder="e.g. 190" value={hr.maxHr ?? ''} style={{ minHeight: 48 }}
              onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); set({ maxHr: n >= 120 && n <= 230 ? n : undefined }); }} />
            <span className="small">Used to colour your pulse by zone. Leave empty to skip zones. A rough guess for age 30 is {estimateMaxHr(30)}.</span>
          </label>
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Status</span>
        <div className="card tight" data-testid="hr-status">
          {!online ? <span className="sub">You’re offline. Status will show when you’re back online.</span>
            : !status ? <span className="sub">Checking…</span>
            : !ready ? <span className="sub">Not connected yet. Create a key below, then set up your iPhone.</span>
            : status.lastSampleAt ? (
              <div className="stack-s" style={{ gap: 4 }}>
                <span className="t-h">Last reading {age}</span>
                <span className="sub">{status.count} readings stored{stale ? ' · nothing recent: check that the automation on your iPhone is still running' : ' · looking good'}</span>
              </div>
            ) : <span className="sub">Key created. Waiting for the first reading from your iPhone…</span>}
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Connect your iPhone</span>
        <div className="card tight stack-s" style={{ gap: 12 }}>
          <p className="sub">Create a key that can only send heart-rate readings to your account. It can’t read anything.</p>
          {fresh && (
            <div className="banner info" role="status" data-testid="hr-fresh-key">
              <span className="ic ic-lock" aria-hidden="true" />
              <div className="grow stack-s" style={{ gap: 6 }}>
                <span className="b-t">Copy your key now. It’s shown once.</span>
                <code className="hr-key">{fresh}</code>
                <button className="btn btn-secondary btn-sm" onClick={() => doCopy('key', fresh)}>{copied === 'key' ? 'Copied' : 'Copy key'}</button>
              </div>
            </div>
          )}
          {err && <div className="banner warn" role="alert"><span className="ic ic-alert" aria-hidden="true" /><div>{err}</div></div>}
          <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !online} onClick={makeKey}>{ready ? 'Create a new key' : 'Create key'}</button>
            {ready && <button className="btn btn-ghost btn-sm" disabled={busy || !online} onClick={revoke}>Turn off sending</button>}
          </div>
          {ready && <span className="small">Current key starts with <code>{status?.prefix}</code>. Creating a new key stops the old one.</span>}

          <span className="lbl">Address</span>
          <code className="hr-key" data-testid="hr-url">{url}</code>
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => doCopy('url', url)}>{copied === 'url' ? 'Copied' : 'Copy address'}</button>

          <span className="t-h" style={{ marginTop: 6 }}>Option A: Health Auto Export (automatic)</span>
          <ol className="hr-steps sub">
            <li>Install <b>Health Auto Export</b> from the App Store and allow it to read Heart Rate.</li>
            <li>Create an <b>Automation</b> of type <b>REST API</b> with the address above.</li>
            <li>Add the header <code>Authorization</code> with the value <code>Bearer {fresh ? '(your key)' : '<your key>'}</code>.</li>
            <li>Choose the metric <b>Heart Rate</b>, format <b>JSON</b>, and sync every <b>{hr.intervalMin} minutes</b>.</li>
            <li>Turn the automation on. Readings show up here within a few minutes.</li>
          </ol>
          <span className="t-h" style={{ marginTop: 6 }}>Option B: Shortcuts (free)</span>
          <ol className="hr-steps sub">
            <li>In <b>Shortcuts</b>, create a shortcut: <b>Find Health Samples</b> (Heart Rate, latest first, limit 1).</li>
            <li>Add <b>Get Contents of URL</b>: the address above, method <b>POST</b>, header <code>Authorization: Bearer &lt;your key&gt;</code>, request body JSON with <code>bpm</code> set to the sample’s value.</li>
            <li>Under <b>Automation</b>, run it at the times you want, and when you open or close the <b>Workout</b> app.</li>
          </ol>
          <p className="small">AirPods Pro measure heart rate during workouts, so Apple Health may have few readings from them outside a workout. An Apple Watch records all day.</p>
        </div>
      </div>
    </div>
  );
}
