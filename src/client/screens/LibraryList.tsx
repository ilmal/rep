import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NO_EQUIPMENT_GYM_ID, resolveGym } from '../../shared/location';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { dateShort } from '../lib/format';
import { hasUserContent, hasUserMedia } from '../../shared/content';
import { scoreAll, statusOf, prefOf, type ScoreBreakdown } from '../../shared/planner';
import { availableEquipment, isAvailable } from '../../shared/rules';
import type { Exercise } from '../../shared/types';
import { draftAddExercise, saveArea, setPref, pauseExercise, banExercise, useCurrentGym, useDraft, useGyms, useLibrary, usePrefs, useSessions, useSettings } from '../store/actions';
import { useStore } from '../store/core';
import {
  LEVEL_LABELS, LIB_GROUPS, activeFilterCount, bulkBan, bulkFavourite, bulkPause, bulkResume, equipLabels, filterExercises, groupOf,
  pausedUntilText, resetFilter, restorePrefs, setFilter, snapshotPrefs, useLibFilter, type LibFilter,
} from '../store/x-library';

const PAUSE_OPTS: { label: string; opt: { days?: number | null; sessions?: number }; sub: (n: number) => string; msg: (n: number) => string }[] = [
  { label: 'Next session only', opt: { sessions: 1 }, sub: () => 'Back after one session', msg: () => 'after next session' },
  { label: '1 week', opt: { days: 7 }, sub: (n) => `Until ${dateShort(n + 7 * 864e5)}`, msg: (n) => `until ${dateShort(n + 7 * 864e5)}` },
  { label: '2 weeks', opt: { days: 14 }, sub: (n) => `Until ${dateShort(n + 14 * 864e5)}`, msg: (n) => `until ${dateShort(n + 14 * 864e5)}` },
  { label: '1 month', opt: { days: 30 }, sub: (n) => `Until ${dateShort(n + 30 * 864e5)}`, msg: (n) => `until ${dateShort(n + 30 * 864e5)}` },
  { label: 'Until I resume it', opt: { days: null }, sub: () => 'Stays paused until you turn it back on', msg: () => 'until you resume' },
];
/** Score chip; the planner total can dip below 0 while cooling down, so clamp what we display. */
function Chip({ s }: { s: ScoreBreakdown | undefined }) {
  if (!s) return null;
  const n = Math.max(0, Math.round(s.total));
  if (s.coolingDown) return <span className="tag blue" title={`Score ${n}, cooling down`}><span className="ic ic-clock sm" aria-hidden="true" />Cooling · {n}</span>;
  return <span className={`tag ${n >= 65 ? 'green' : n >= 40 ? 'accent' : ''}`} title={`Planner score ${n}`}>{n}</span>;
}
const TABS: { key: LibFilter['tab']; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'ready', label: 'Ready' }, { key: 'paused', label: 'Paused' }, { key: 'banned', label: 'Banned' }];

export default function LibraryList() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const addMode = params.get('add') === '1';
  const addToArea = params.get('addToArea');
  const modeSearch = addMode ? '?add=1' : addToArea ? `?addToArea=${encodeURIComponent(addToArea)}` : '';
  const area = useStore((s) => (addToArea ? s.areas[addToArea] : undefined));
  const draft = useDraft();
  const lib = useLibrary();
  const prefs = usePrefs();
  const sessions = useSessions();
  const settings = useSettings();
  const gym = useCurrentGym();
  const gyms = useGyms();
  const f = useLibFilter();

  // Arriving from the browse screen: apply its preset (group / equipment / status / favourites) from a clean slate.
  useLayoutEffect(() => {
    if (params.get('reset') === '1') {
      const keep: Partial<LibFilter> = {};
      const g = params.get('group'); if (g && (LIB_GROUPS as readonly string[]).includes(g)) keep.group = g as LibFilter['group'];
      const eq = params.get('eq'); if (eq) keep.eq = [eq];
      const tab = params.get('tab'); if (tab === 'ready' || tab === 'paused' || tab === 'banned') keep.tab = tab;
      if (params.get('fav') === '1') keep.fav = true;
      if (params.get('gym') === NO_EQUIPMENT_GYM_ID) keep.gymId = NO_EQUIPMENT_GYM_ID; // "Browse" from the at-home banner: only what needs no equipment
      resetFilter(keep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<'main' | 'pause'>('main');
  const [toast, setToast] = useState<{ msg: string; undo: ReturnType<typeof snapshotPrefs> } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const now = useMemo(() => Date.now(), [prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const scores = useMemo(() => {
    const list = scoreAll({ library: lib, prefs, sessions, planner: settings.planner, now: Date.now(), area: area ?? null });
    return new Map<string, ScoreBreakdown>(list.map((s) => [s.exerciseId, s]));
  }, [lib, prefs, sessions, settings.planner, area]);

  const viewGym = f.gymId ? resolveGym(gyms, f.gymId) ?? gym : gym;
  const viewAvail = useMemo(() => availableEquipment(viewGym), [viewGym]);

  const counts = useMemo(() => {
    const c = { all: lib.length, ready: 0, paused: 0, banned: 0 };
    for (const e of lib) { const st = statusOf(prefOf(prefs, e.id), now); if (st === 'paused') c.paused++; else if (st === 'banned') c.banned++; else c.ready++; }
    return c;
  }, [lib, prefs, now]);

  const list = useMemo(() => filterExercises(lib, f, { prefs, gyms, now }), [lib, f, prefs, gyms, now]);
  const sections = useMemo(() => {
    const by = new Map<string, Exercise[]>();
    for (const e of list) { const g = groupOf(e); (by.get(g) ?? by.set(g, []).get(g)!).push(e); }
    return LIB_GROUPS.filter((g) => by.has(g)).map((g) => ({ name: g, items: by.get(g)!.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [list]);

  const picking = addMode || !!area;
  const active = activeFilterCount(f);
  const anyNarrowing = !!f.q.trim() || f.tab !== 'all' || f.group !== 'All' || active > 0;
  const title = addMode ? 'Add exercise' : area ? `Add to ${area.name}` : selecting ? (sel.length ? `${sel.length} selected` : 'Select exercises') : f.group === 'All' ? 'All exercises' : f.group;
  const hereOn = !!gym && f.gymId === gym.id;

  const emptyMap = { paused: { ic: 'ic-pause-c', t: 'Nothing paused', s: 'Pause an exercise to take a break from it. It comes back on its own.' }, banned: { ic: 'ic-ban', t: 'Nothing banned', s: 'Banned exercises are never planned or swapped in.' } } as const;
  const em = (f.tab === 'paused' || f.tab === 'banned') && !f.q.trim() && f.group === 'All' && !f.fav && !active ? emptyMap[f.tab] : { ic: 'ic-search', t: 'No matches', s: 'Nothing matches these filters.' };

  const showToast = (msg: string, undo: ReturnType<typeof snapshotPrefs>) => {
    setToast({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };
  const apply = (ids: string[], fn: () => void, msg: string) => {
    const snap = snapshotPrefs(ids);
    fn();
    setSheet(null); setSheetMode('main'); setSel([]); setSelecting(false);
    showToast(msg, snap);
  };
  const undo = () => { if (toast) { restorePrefs(toast.undo); setToast(null); } };

  const pick = (e: Exercise) => {
    if (addMode) { draftAddExercise(e.id); nav(-1); return; }
    if (area) {
      if (!area.poolExerciseIds.includes(e.id)) saveArea({ ...area, poolExerciseIds: [...area.poolExerciseIds, e.id] });
      nav(-1);
    }
  };
  const inSession = (id: string) => !!draft?.exercises.some((x) => x.exerciseId === id);
  const inPool = (id: string) => !!area?.poolExerciseIds.includes(id);
  const toggleSel = (id: string) => setSel((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const sheetEx = sheet ? lib.find((e) => e.id === sheet) : undefined;
  const sheetPref = sheet ? prefOf(prefs, sheet) : undefined;
  const sheetStatus = sheetPref ? statusOf(sheetPref, now) : 'ready';
  const selBlocked = sel.some((id) => { const s = statusOf(prefOf(prefs, id), now); return s === 'paused' || s === 'banned'; });

  const row = (e: Exercise) => {
    const pref = prefOf(prefs, e.id);
    const st = statusOf(pref, now);
    const blocked = st === 'paused' || st === 'banned';
    const missing = !!viewGym && !isAvailable(e, viewAvail);
    const already = (addMode && inSession(e.id)) || (!!area && inPool(e.id));
    const selected = sel.includes(e.id);
    let tag: { cls: string; icon: string; text: string } | null = null;
    if (st === 'paused') tag = { cls: 'accent', icon: 'ic-pause-c', text: `Paused ${pausedUntilText(pref, dateShort)}`.trim() };
    else if (st === 'banned') tag = { cls: 'red', icon: 'ic-ban', text: 'Banned' };
    else if (missing) tag = { cls: '', icon: 'ic-pin', text: `Not at ${viewGym!.name}` };
    const score = scores.get(e.id);
    const main = (
      <>
        <span className="hstack" style={{ gap: 6 }}>
          <span className="li-t">{e.name}</span>
          {pref.favorite && <span className="ic ic-star-fill xs star-on" role="img" aria-label="Favourite" />}
          {hasUserContent(pref) && <span className={`ic ${hasUserMedia(pref) ? 'ic-image' : 'ic-book'} xs gx`} role="img" aria-label={hasUserMedia(pref) ? 'Has your photos or videos' : 'Has your how-to notes'} data-testid="has-howto" />}
          {e.isCustom && <span className="tag blue" style={{ padding: '1px 7px' }}>Custom</span>}
        </span>
        <span className="exmeta">
          <span>{e.primary.join(', ')}</span><span>·</span><span>{equipLabels(e).join(', ')}</span>
          <span className="lvl" role="img" aria-label={LEVEL_LABELS[e.difficulty - 1]}>{[0, 1, 2].map((i) => <i key={i} className={i < e.difficulty ? 'on' : ''} />)}</span>
        </span>
        {(tag || already || (!blocked && score)) && (
          <span className="hstack" style={{ gap: 6, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
            {tag && <span className={`tag ${tag.cls}`}><span className={`ic ${tag.icon} xs`} aria-hidden="true" />{tag.text}</span>}
            {already && <span className="tag green">{addMode ? 'In session' : 'In pool'}</span>}
            {!blocked && <Chip s={score} />}
          </span>
        )}
      </>
    );
    return (
      <div className={`exrow${blocked ? ' dim' : ''}`} key={e.id} data-status={st}>
        {selecting && (
          <button type="button" className={`sel${selected ? ' on' : ''}`} aria-label={`Select ${e.name}`} aria-pressed={selected} onClick={() => toggleSel(e.id)}>
            <span className="ic ic-check xs" aria-hidden="true" />
          </button>
        )}
        {selecting
          ? <button type="button" className="exmain" onClick={() => toggleSel(e.id)}>{main}</button>
          : picking
            ? <button type="button" className="exmain" aria-label={`${already ? 'Already added: ' : 'Add '}${e.name}`} onClick={() => pick(e)}>{main}</button>
            : <Link className="exmain" to={`/library/${e.id}`}>{main}</Link>}
        {!selecting && !picking && (
          <button type="button" className="iconbtn" aria-label={`Options for ${e.name}`} onClick={() => { setSheet(e.id); setSheetMode('main'); }}><span className="ic ic-more" aria-hidden="true" /></button>
        )}
      </div>
    );
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="topbar">
        {picking
          ? <button type="button" className="iconbtn" aria-label="Back" onClick={() => nav(-1)}><span className="ic ic-chev-left lg" aria-hidden="true" /></button>
          : <Link className="iconbtn" to="/library" aria-label="Back to library"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>}
        <span className="title">{title}</span>
        {picking
          ? <Link className="iconbtn" to="/exercise/new" aria-label="Create exercise"><span className="ic ic-plus lg" aria-hidden="true" /></Link>
          : <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={() => { setSelecting(!selecting); setSel([]); }}>{selecting ? 'Cancel' : 'Select'}</button>}
      </div>
      <div style={{ padding: '0 18px 8px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        <label className="search">
          <span className="ic ic-search" aria-hidden="true" />
          <input className="input" type="search" placeholder={`Search ${lib.length} exercises`} aria-label="Search exercises" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} />
        </label>
        <div className="seg c4 on-bg" role="group" aria-label="Status">
          {TABS.map((t) => (
            <button type="button" key={t.key} className={f.tab === t.key ? 'on' : ''} aria-pressed={f.tab === t.key} onClick={() => setFilter({ tab: t.key })} style={{ minHeight: 38, fontSize: '13px' }}>{`${t.label} ${counts[t.key]}`}</button>
          ))}
        </div>
        <div className="hscroll" role="group" aria-label="Filters">
          <Link className={`chip${active ? ' on' : ''}`} to={`/library/filters${modeSearch}`} aria-label={active ? `Filters, ${active} active` : 'Filters'} style={{ flexShrink: 0 }}>
            <span className="ic ic-filter sm" aria-hidden="true" />Filters{active > 0 && <span className="fcount">{active}</span>}
          </Link>
          <button type="button" className={`chip${f.fav ? ' on' : ''}`} aria-pressed={f.fav} onClick={() => setFilter({ fav: !f.fav })} style={{ flexShrink: 0 }}><span className="ic ic-star sm" aria-hidden="true" />Favourites</button>
          {gym && <button type="button" className={`chip${hereOn ? ' on' : ''}`} aria-pressed={hereOn} onClick={() => setFilter({ gymId: hereOn ? '' : gym.id })} style={{ flexShrink: 0 }}><span className="ic ic-pin sm" aria-hidden="true" />{gym.name}</button>}
          {(['All', ...LIB_GROUPS] as const).map((g) => (
            <button type="button" key={g} className={`chip${f.group === g ? ' on' : ''}`} aria-pressed={f.group === g} onClick={() => setFilter({ group: g })} style={{ flexShrink: 0 }}>{g}</button>
          ))}
        </div>
      </div>
      <div className="scroll" style={{ paddingTop: 0, paddingBottom: selecting ? 120 : 40, gap: 0 }}>
        <span className="eyebrow" style={{ padding: '2px 2px 4px' }}>{`${list.length} of ${lib.length} exercises`}</span>
        {sections.map((sec) => (
          <div key={sec.name}>
            <div className="sechead"><span className="strong">{sec.name}</span><span className="small sub">{`${sec.items.length} ${sec.items.length === 1 ? 'exercise' : 'exercises'}`}</span></div>
            <div className="group">{sec.items.map(row)}</div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="empty">
            <div className="empty-ic"><span className={`ic ${em.ic} xl`} aria-hidden="true" /></div>
            <h2 className="t-h">{em.t}</h2>
            <p className="sub">{em.s}</p>
            {anyNarrowing && <button type="button" className="btn btn-secondary btn-sm" onClick={() => resetFilter()}>Clear search &amp; filters</button>}
            {f.q.trim() && <Link className="btn btn-primary btn-sm" to={`/exercise/new?name=${encodeURIComponent(f.q.trim())}`}>{`Create “${f.q.trim()}”`}</Link>}
          </div>
        )}
      </div>

      {selecting && (
        <div className="bottombar" style={{ flexDirection: 'row', gap: 8 }}>
          <button type="button" className="btn btn-secondary" disabled={!sel.length} style={{ flex: 1, padding: '0 8px' }}
            onClick={() => apply(sel, () => bulkFavourite(sel), `${sel.length} added to favourites`)}><span className="ic ic-star sm" aria-hidden="true" />Favourite</button>
          <button type="button" className="btn btn-secondary" disabled={!sel.length} style={{ flex: 1, padding: '0 8px' }}
            onClick={() => apply(sel, () => bulkPause(sel, 14), `${sel.length} paused for 2 weeks`)}><span className="ic ic-pause-c sm" aria-hidden="true" />Pause</button>
          <button type="button" className="btn btn-danger-soft" disabled={!sel.length} style={{ flex: 1, padding: '0 8px' }}
            onClick={() => apply(sel, () => bulkBan(sel), `${sel.length} banned`)}><span className="ic ic-ban sm" aria-hidden="true" />Ban</button>
          {selBlocked && <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '0 8px' }}
            onClick={() => apply(sel, () => bulkResume(sel), `${sel.length} back in rotation`)}><span className="ic ic-play sm" aria-hidden="true" />Resume</button>}
        </div>
      )}

      {sheet && sheetEx && (
        <>
          <button type="button" className="scrim" aria-label="Close" onClick={() => { setSheet(null); setSheetMode('main'); }} />
          <div className="sheet" role="dialog" aria-label="Exercise options">
            <div className="grabber" />
            <div className="stack-s" style={{ gap: 2 }}>
              <h2 className="t-h">{sheetEx.name}</h2>
              <span className="sub">{`${sheetEx.primary.join(', ')} · ${equipLabels(sheetEx).join(', ')} · ${LEVEL_LABELS[sheetEx.difficulty - 1]}`}</span>
            </div>
            {sheetMode === 'main' ? (
              <div className="group">
                <button type="button" className="menu-i" onClick={() => { const on = !!sheetPref?.favorite; apply([sheetEx.id], () => setPref(sheetEx.id, { favorite: !on }), on ? 'Removed from favourites' : `${sheetEx.name} is a favourite`); }}>
                  <span className="tile sm warm"><span className={`ic ${sheetPref?.favorite ? 'ic-star-fill' : 'ic-star'} sm`} aria-hidden="true" /></span>
                  <span className="grow">{sheetPref?.favorite ? 'Remove from favourites' : 'Add to favourites'}<small>Favourites are picked first when they fit</small></span>
                </button>
                {(sheetStatus === 'paused' || sheetStatus === 'banned') && (
                  <button type="button" className="menu-i" onClick={() => apply([sheetEx.id], () => bulkResume([sheetEx.id]), `${sheetEx.name} ${sheetStatus === 'banned' ? 'unbanned' : 'resumed'}`)}>
                    <span className="tile sm green"><span className="ic ic-play sm" aria-hidden="true" /></span>
                    <span className="grow">{sheetStatus === 'banned' ? 'Unban' : 'Resume now'}<small>Back in plans and swaps from the next session</small></span>
                  </button>
                )}
                {sheetStatus !== 'paused' && sheetStatus !== 'banned' && (
                  <button type="button" className="menu-i" onClick={() => setSheetMode('pause')}>
                    <span className="tile sm"><span className="ic ic-pause-c sm" aria-hidden="true" /></span>
                    <span className="grow">Pause for a while<small>Temporarily unavailable, then comes back on its own</small></span>
                    <span className="ic ic-chev-right chev" aria-hidden="true" />
                  </button>
                )}
                {sheetStatus !== 'banned' && (
                  <button type="button" className="menu-i" style={{ color: '#B42318' }} onClick={() => apply([sheetEx.id], () => banExercise(sheetEx.id, true), `${sheetEx.name} banned`)}>
                    <span className="tile sm red"><span className="ic ic-ban sm" aria-hidden="true" /></span>
                    <span className="grow">Ban this exercise<small>Never planned or swapped in. History is kept.</small></span>
                  </button>
                )}
                <Link className="menu-i" to={`/library/${sheetEx.id}`}>
                  <span className="tile sm"><span className="ic ic-info sm" aria-hidden="true" /></span>
                  <span className="grow">Details, how-to &amp; history</span>
                  <span className="ic ic-chev-right chev" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <>
                <div className="group">
                  {PAUSE_OPTS.map((p) => (
                    <button type="button" key={p.label} className="menu-i" onClick={() => apply([sheetEx.id], () => pauseExercise(sheetEx.id, p.opt), `${sheetEx.name} paused ${p.msg(Date.now())}`)}>
                      <span className="grow">{p.label}<small>{p.sub(Date.now())}</small></span>
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setSheetMode('main')}>Back</button>
              </>
            )}
          </div>
        </>
      )}

      {toast && (
        <div className="toast" role="status" style={{ bottom: selecting ? 110 : 28 }}>
          <span className="ic ic-check" aria-hidden="true" /><span className="grow">{toast.msg}</span>
          <button type="button" className="banner-act" onClick={undo}>Undo</button>
        </div>
      )}
    </div>
  );
}

const CSS = `
.hscroll{display:flex;gap:8px;overflow-x:auto;margin:0 -18px;padding:2px 18px 4px;scrollbar-width:none}
.hscroll::-webkit-scrollbar{display:none}
.exrow{display:flex;align-items:center;gap:10px;min-height:64px;padding:10px 6px 10px 14px;background:#fff}
.exrow + .exrow{border-top:1px solid #E6E4DF}
.exrow.dim .li-t{color:#6B6B6B}
.exmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;text-align:left;min-height:44px;justify-content:center}
.exmeta{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12px;color:#6B6B6B}
.lvl{display:inline-flex;gap:2px;align-items:center}
.lvl i{width:6px;height:6px;border-radius:3px;background:#D6D3CC}
.lvl i.on{background:#121212}
.sel{width:26px;height:26px;border-radius:13px;box-shadow:inset 0 0 0 2px #D6D3CC;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:transparent;position:relative}
.sel::after{content:'';position:absolute;inset:-9px}
.sel.on{background:#121212;box-shadow:none;color:#fff}
.sechead{display:flex;justify-content:space-between;align-items:baseline;padding:10px 2px 6px}
.menu-i{display:flex;align-items:center;gap:14px;min-height:58px;padding:10px 16px;width:100%;text-align:left;font-weight:600;font-size:16px;background:#fff}
.menu-i + .menu-i{border-top:1px solid #E6E4DF}
.menu-i small{display:block;font-size:13px;font-weight:500;color:#6B6B6B;margin-top:1px}
.star-on{color:#FF5A1F}
.fcount{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#fff;color:#121212;font-size:11px;font-weight:700}
`;
