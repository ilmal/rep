import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PauseSheet from '../components/PauseSheet';
import { banExercise, pauseExercise, toggleFavorite, useAllLibrary, useAreas, usePrefs } from '../store/actions';
import { mutate } from '../store/core';
import { restorePrefKeepingContent } from '../store/x-content';
import { useNow } from '../lib/hooks';
import { dateShort } from '../lib/format';
import { PAUSE_FOREVER, isPaused } from '../../shared/planner';
import type { Exercise, ExercisePref } from '../../shared/types';

type Tab = 'paused' | 'banned' | 'fav';
const TABS: Tab[] = ['paused', 'banned', 'fav'];
const META: Record<Tab, { label: string; act: string; done: string; icon: string; cls: string; info: string; empty: [string, string]; add: string }> = {
  paused: { label: 'Paused', act: 'Resume', done: ' resumed', icon: 'ic-pause-c', cls: 'warn', info: 'Temporarily unavailable. Not planned or swapped in until the date, then they come back on their own.', empty: ['Nothing paused', 'Pause an exercise from the library or mid-session when you need a break from it.'], add: 'Pause an exercise' },
  banned: { label: 'Banned', act: 'Unban', done: ' unbanned', icon: 'ic-ban', cls: 'error', info: 'Never planned, generated or offered as a swap. Your past history with them is kept.', empty: ['Nothing banned', 'Ban exercises you never want to see.'], add: 'Ban an exercise' },
  fav: { label: 'Favourites', act: 'Remove', done: ' removed from favourites', icon: 'ic-star', cls: 'ok', info: 'Picked first whenever they fit the area, your gym and the time you have.', empty: ['No favourites', 'Star the exercises you enjoy and they’ll show up more often.'], add: 'Add favourites' },
};

interface Row { id: string; name: string; sub: string; pref: ExercisePref }

function pauseText(p: ExercisePref, now: number): string {
  if (p.pausedUntil != null && p.pausedUntil > now) {
    if (p.pausedUntil >= PAUSE_FOREVER) return 'Until resumed';
    return `Until ${dateShort(p.pausedUntil)}`;
  }
  const n = p.pausedSessions ?? 0;
  return n <= 1 ? 'Next session' : `Next ${n} sessions`;
}
const joinList = (a: string[]) => a.join(', ');

export default function Exclusions() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'paused';
  const prefs = usePrefs();
  const lib = useAllLibrary();
  const areas = useAreas();
  const now = useNow(15000);
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(null);
  const [sheet, setSheet] = useState<Row | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const lists = useMemo(() => {
    const byId = new Map<string, Exercise>(lib.map((e) => [e.id, e]));
    const out: Record<Tab, Row[]> = { paused: [], banned: [], fav: [] };
    for (const p of Object.values(prefs)) {
      const ex = byId.get(p.exerciseId);
      if (!ex || ex.archived) continue;
      const note = p.notes ? ` · ${p.notes}` : '';
      if (p.avoid) out.banned.push({ id: ex.id, name: ex.name, sub: `Banned${p.updatedAt ? ` ${dateShort(p.updatedAt)}` : ''}${note}`, pref: p });
      else if (isPaused(p, now)) out.paused.push({ id: ex.id, name: ex.name, sub: `${pauseText(p, now)}${note}`, pref: p });
      if (p.favorite) {
        const inAreas = areas.filter((a) => a.poolExerciseIds.includes(ex.id) || a.pinnedExerciseIds.includes(ex.id)).map((a) => a.name);
        out.fav.push({ id: ex.id, name: ex.name, sub: `${ex.primary.join(', ')}${inAreas.length ? ` · ${joinList(inAreas)}` : ''}`, pref: p });
      }
    }
    for (const k of TABS) out[k].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [prefs, lib, areas, now]);

  const m = META[tab];
  const items = lists[tab];

  const show = (msg: string, undo: () => void) => {
    setToast({ msg, undo });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3000);
  };
  const act = (r: Row) => {
    const prev = r.pref;
    if (tab === 'paused') pauseExercise(r.id, { resume: true });
    else if (tab === 'banned') banExercise(r.id, false);
    else toggleFavorite(r.id);
    show(r.name + m.done, () => { mutate((s) => { restorePrefKeepingContent(s, r.id, prev); }); setToast(null); });
  };

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/library" aria-label="Back to library"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Your exercise preferences</span>
        <span className="spacer" />
      </div>
      <div style={{ padding: '0 18px 10px', flexShrink: 0 }}>
        <div className="seg c3 on-bg" role="group" aria-label="Preference">
          {TABS.map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} aria-pressed={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}>{META[k].label} {lists[k].length}</button>
          ))}
        </div>
      </div>
      <div className="scroll" style={{ paddingTop: 0, paddingBottom: 40 }}>
        <div className={`banner ${m.cls}`}><span className={`ic ${m.icon}`} aria-hidden="true" /><div>{m.info}</div></div>
        {items.length > 0 && (
          <div className="group" data-testid="rows">
            {items.map((r) => (
              <div className="li" key={r.id} data-testid="row" data-id={r.id}>
                <Link className="grow stack-s" to={`/library/${r.id}`} style={{ gap: 2 }}><span className="li-t">{r.name}</span><span className="li-s">{r.sub}</span></Link>
                {tab === 'paused' && (
                  <button className="iconbtn" aria-label={`Change pause for ${r.name}`} onClick={() => setSheet(r)}><span className="ic ic-more" aria-hidden="true" /></button>
                )}
                <button className="btn btn-soft btn-sm" aria-label={`${m.act} ${r.name}`} onClick={() => act(r)}>{m.act}</button>
              </div>
            ))}
          </div>
        )}
        {items.length === 0 && (
          <div className="empty">
            <div className="empty-ic"><span className={`ic ${m.icon} xl`} aria-hidden="true" /></div>
            <h2 className="t-h">{m.empty[0]}</h2>
            <p className="sub">{m.empty[1]}</p>
          </div>
        )}
        <Link className="btn btn-secondary" to="/library/all"><span className="ic ic-plus" aria-hidden="true" />{m.add}</Link>
      </div>
      {toast && (
        <div className="toast" role="status" style={{ bottom: 28 }}><span className="ic ic-check" aria-hidden="true" /><span className="grow">{toast.msg}</span><button className="banner-act" onClick={toast.undo}>Undo</button></div>
      )}
      {sheet && <PauseSheet exerciseId={sheet.id} name={sheet.name} onClose={() => setSheet(null)} onDone={(msg) => show(msg, () => { mutate((s) => { restorePrefKeepingContent(s, sheet.id, sheet.pref); }); setToast(null); })} />}
    </div>
  );
}
