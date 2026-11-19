import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getState, useStore } from '../store/core';
import { updateSettings, useSettings } from '../store/actions';
import { api, ensureAccount, type ApiTokenRow } from '../store/sync';
import { ago } from '../lib/format';

// Names and meanings mirror the server's MCP tool list (src/server/mcp.ts); the e2e test cross-checks them against a live tools/list.
const READ_TOOLS: [string, string][] = [
  ['get_overview', 'Your week, rotation, goal, planner settings and profile notes'],
  ['list_sessions', 'Every session with sets, weights and feedback'],
  ['get_session', 'Raw per-set detail of one session'],
  ['get_exercise_history', 'Every time one exercise was done, with its trend'],
  ['list_exercises', 'The library with preferences and planner scores'],
  ['get_exercise', 'One exercise with its score breakdown and its how-to (steps, cues, tips, media)'],
  ['explain_score', 'Why an exercise scores what it does'],
  ['list_areas', 'Training areas, pools, pinned exercises and rotation'],
  ['list_gyms', 'Gyms with per-item equipment status'],
  ['list_equipment_catalog', 'All equipment ids'],
  ['get_settings', 'Settings, planner weights and profile notes'],
  ['get_muscle_report', 'Which muscles are overdue or well covered'],
  ['get_stats', 'Volume, duration, streaks and recent PRs'],
  ['get_streak', 'Streak, freezes, pace, repair offer and badges'],
  ['get_heart_rate', 'Your heart-rate readings (latest, summary, buckets)'],
  ['get_session_heart_rate', 'Pulse during one session: avg, max, min'],
  ['preview_next_session', 'Dry-run: what would be generated next'],
  ['list_coach_plans', 'Queued, used and cancelled coach plans'],
  ['list_events', 'The raw event stream'],
  ['export_all', 'Everything in one export'],
];
const WRITE_TOOLS: [string, string][] = [
  ['create_exercise', 'Add a custom exercise'],
  ['update_exercise', 'Edit an exercise (labels and how-to)'],
  ['archive_exercise', 'Hide or restore an exercise'],
  ['set_exercise_pref', 'Favorite, ban, pause for days or sessions (or resume), set relevance and overrides'],
  ['set_exercise_content', 'Write the how-to you read before an exercise: summary, steps, cues and tips'],
  ['add_exercise_media', 'Attach an image or video (YouTube, Vimeo, file) to an exercise'],
  ['remove_exercise_media', 'Remove one image or video from an exercise'],
  ['reset_exercise_content', 'Go back to the built-in how-to text'],
  ['bulk_set_exercise_prefs', 'Set preferences for many exercises at once'],
  ['set_next_prescription', 'Override the next weight, reps and sets for an exercise'],
  ['create_area', 'Create a training area'],
  ['update_area', 'Edit an area’s focus, pool and pinned exercises'],
  ['delete_area', 'Delete an area'],
  ['set_rotation', 'Reorder the area rotation'],
  ['update_settings', 'Tune planner weights, goals and profile notes'],
  ['reset_planner', 'Reset planner weights to defaults'],
  ['use_streak_freeze', 'Use a streak freeze on this week (or last week’s miss)'],
  ['undo_streak_freeze', 'Take a manual streak freeze back'],
  ['update_gym_equipment', 'Mark equipment ok, broken or missing at a gym'],
  ['create_coach_plan', 'Queue a workout for your next session'],
  ['cancel_coach_plan', 'Cancel a pending coach plan'],
  ['add_session_note', 'Add a coach note to a past session'],
];

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, wordBreak: 'break-all' as const, whiteSpace: 'pre-wrap' as const };

export default function ConnectCoach() {
  const nav = useNavigate();
  const settings = useSettings();
  const online = useStore((s) => s.online);
  const [tokens, setTokens] = useState<ApiTokenRow[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [name, setName] = useState('Grok');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const [revoke, setRevoke] = useState<ApiTokenRow | null>(null);
  const [notes, setNotes] = useState(settings.profileNotes);
  const [dirty, setDirty] = useState(false);

  const url = `${location.origin}/mcp`;

  useEffect(() => { if (!dirty) setNotes(settings.profileNotes); }, [settings.profileNotes, dirty]);

  const load = useCallback(async () => {
    if (!getState().device.token) { setTokens([]); setLoadErr(''); return; } // no account yet: nothing to list
    try {
      const r = await api<{ tokens?: ApiTokenRow[] }>('/tokens');
      if (!r.ok) throw new Error(String(r.status));
      setTokens(r.data.tokens ?? []); setLoadErr('');
    } catch { setLoadErr('Couldn’t load your tokens.'); }
  }, []);
  useEffect(() => { if (online && navigator.onLine) void load(); else setTokens((t) => t ?? []); }, [online, load]);

  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(''), 1800); };
  const doCopy = async (k: string, t: string) => { if (await copy(t)) flash(k); };

  const create = async () => {
    setCreateErr(''); setCreating(true);
    try {
      if (!(await ensureAccount())) { setCreateErr('Couldn’t reach the server. Connect to the internet and try again.'); return; }
      const r = await api<{ token?: string; error?: string }>('/tokens', { body: { name: name.trim() || 'Coach', scope } });
      if (!r.data.token) { setCreateErr(r.data.error === 'too_many_tokens' ? 'You have 10 active tokens. Revoke one first.' : 'The server didn’t create a token. Try again.'); return; }
      setFresh(r.data.token);
      await load();
    } catch { setCreateErr('Couldn’t create the token. Try again.'); } finally { setCreating(false); }
  };

  const doRevoke = async () => {
    if (!revoke) return;
    try { await api(`/tokens/${revoke.id}`, { method: 'DELETE' }); } catch { /* shown by reload */ }
    setRevoke(null); await load();
  };

  const snippet = `{
  "type": "url",
  "url": "${url}",
  "authorization": "Bearer ${fresh ?? '<your token>'}"
}`;

  return (
    <div className="app">
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={() => nav(-1)}><span className="ic ic-chev-left lg" aria-hidden="true" /></button>
        <span className="title">Connect a coach</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <div className="card tight">
          <div className="hstack" style={{ gap: 12 }}><span className="tile blue"><span className="ic ic-link" aria-hidden="true" /></span><h1 className="t-h grow">Let a coach agent help</h1></div>
          <p className="sub">A coach agent (for example Grok) can connect through MCP and read <b>all</b> your data. With read &amp; write access it can also edit exercises, favorites, relevance scores, areas, rotation and planner settings, and queue coach plans for your next session.</p>
        </div>

        {!online && <div className="banner info" role="status"><span className="ic ic-wifi-off" aria-hidden="true" /><div className="grow"><span className="b-t">You’re offline</span>Connect to the internet to create or revoke tokens.</div></div>}

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Server URL</span>
        <div className="card tight">
          <code style={mono}>{url}</code>
          <button className="btn btn-soft btn-sm" onClick={() => void doCopy('url', url)}><span className="ic ic-link sm" aria-hidden="true" />{copied === 'url' ? 'Copied' : 'Copy URL'}</button>
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Create a token</span>
        <div className="card tight">
          <label className="field"><span className="small sub">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grok" maxLength={40} /></label>
          <div className="stack-s" style={{ gap: 8 }}>
            <span className="small sub">Access</span>
            <div className="seg c2" role="group" aria-label="Access">
              <button className={scope === 'read' ? 'on' : ''} aria-pressed={scope === 'read'} onClick={() => setScope('read')}>Read-only</button>
              <button className={scope === 'write' ? 'on' : ''} aria-pressed={scope === 'write'} onClick={() => setScope('write')}>Read &amp; write</button>
            </div>
          </div>
          {createErr && <span className="help err" role="alert">{createErr}</span>}
          <button className="btn btn-primary" onClick={create} disabled={creating || !online}>{creating ? 'Creating…' : 'Create token'}</button>
        </div>

        {fresh && (
          <div className="card tight" style={{ boxShadow: 'inset 0 0 0 2px var(--accent)', background: 'var(--accent-soft)' }} role="status">
            <span className="strong">Your new token</span>
            <code style={mono}>{fresh}</code>
            <div className="banner warn"><span className="ic ic-alert" aria-hidden="true" /><div>Copy it now. It’s shown <b>only once</b> and can’t be retrieved later.</div></div>
            <div className="grid2">
              <button className="btn btn-primary btn-sm" onClick={() => void doCopy('tok', fresh)}>{copied === 'tok' ? 'Copied' : 'Copy token'}</button>
              <button className="btn btn-soft btn-sm" onClick={() => setFresh(null)}>I’ve saved it</button>
            </div>
          </div>
        )}

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Your tokens</span>
        {loadErr && <span className="help err" role="alert">{loadErr}</span>}
        {tokens && tokens.length === 0 && <p className="sub">No tokens yet.</p>}
        {tokens && tokens.length > 0 && (
          <div className="group">
            {tokens.map((t) => (
              <div key={t.id} className="li" style={{ minHeight: 64 }}>
                <div className="grow">
                  <span className="hstack" style={{ gap: 6 }}><span className="li-t">{t.name}</span><span className={`tag ${t.scope === 'write' ? 'accent' : ''}`}>{t.scope === 'write' ? 'Read & write' : 'Read-only'}</span></span>
                  <span className="li-s">rep_{t.prefix.replace(/^rep_/, '')}… · created {ago(t.createdAt)} · {t.lastUsed ? `used ${ago(t.lastUsed)}` : 'never used'}</span>
                </div>
                <button className="btn btn-danger-soft btn-sm" onClick={() => setRevoke(t)} disabled={!online} aria-label={`Revoke ${t.name}`}>Revoke</button>
              </div>
            ))}
          </div>
        )}

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Client config</span>
        <div className="card tight">
          <p className="small sub">Paste into your MCP client. The exact config format differs per client; the three values are the server URL, transport type and a Bearer token.</p>
          <code style={mono}>{snippet}</code>
          <button className="btn btn-soft btn-sm" onClick={() => void doCopy('cfg', snippet)}>{copied === 'cfg' ? 'Copied' : 'Copy config'}</button>
        </div>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>What the coach can read</span>
        <div className="group" aria-label="Read tools">
          {READ_TOOLS.map(([t, d]) => (
            <div key={t} className="li" style={{ minHeight: 52 }}><div className="grow"><code style={{ ...mono, fontWeight: 600 }}>{t}</code><span className="li-s">{d}</span></div></div>
          ))}
        </div>
        <span className="lbl" style={{ padding: '8px 2px 0' }}>What it can change (read &amp; write)</span>
        <div className="group" aria-label="Write tools">
          {WRITE_TOOLS.map(([t, d]) => (
            <div key={t} className="li" style={{ minHeight: 52 }}><div className="grow"><code style={{ ...mono, fontWeight: 600 }}>{t}</code><span className="li-s">{d}</span></div></div>
          ))}
        </div>
        <p className="small sub">Read-only tokens can use the read tools only. Banned and paused exercises are never planned or swapped in, and paused ones return on their own. Revoke a token any time to cut access.</p>

        <span className="lbl" style={{ padding: '8px 2px 0' }}>Profile notes</span>
        <div className="card tight">
          <label className="field">
            <span className="small sub">Goals, injuries, preferences. You and your coach can both read and edit this.</span>
            <textarea className="input" style={{ minHeight: 130, padding: '12px 14px', resize: 'vertical' }} value={notes} placeholder="e.g. Goal: stronger squat. Left shoulder is cranky: avoid heavy overhead press."
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              onBlur={() => { if (dirty) { updateSettings({ profileNotes: notes }); setDirty(false); } }} />
          </label>
        </div>
      </div>

      {revoke && (
        <>
          <button className="scrim" aria-label="Cancel" onClick={() => setRevoke(null)} />
          <div className="dialog" role="alertdialog" aria-label="Revoke token">
            <h2 className="t-h center">Revoke “{revoke.name}”?</h2>
            <p className="sub center">Anything using this token loses access immediately.</p>
            <button className="btn btn-danger" onClick={() => void doRevoke()}>Revoke token</button>
            <button className="btn btn-soft" onClick={() => setRevoke(null)}>Keep token</button>
          </div>
        </>
      )}
    </div>
  );
}
