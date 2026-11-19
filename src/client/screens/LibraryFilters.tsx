import { useMemo } from 'react';
import { NO_EQUIPMENT_GYM_ID, NO_EQUIPMENT_LABEL } from '../../shared/location';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { statusOf, prefOf } from '../../shared/planner';
import { useGyms, useLibrary, usePrefs } from '../store/actions';
import { EQUIP_FILTERS, LEVEL_LABELS, PATTERN_FILTERS, filterExercises, resetSheetFilters, setFilter, toggleIn, useLibFilter } from '../store/x-library';

export default function LibraryFilters() {
  const nav = useNavigate();
  const loc = useLocation();
  const modeSearch = new URLSearchParams(loc.search);
  const keep = new URLSearchParams();
  if (modeSearch.get('add') === '1') keep.set('add', '1');
  if (modeSearch.get('addToArea')) keep.set('addToArea', modeSearch.get('addToArea')!);
  const back = `/library/all${keep.toString() ? `?${keep}` : ''}`;
  const lib = useLibrary();
  const prefs = usePrefs();
  const gyms = useGyms();
  const f = useLibFilter();

  const now = useMemo(() => Date.now(), [prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = useMemo(() => filterExercises(lib, f, { prefs, gyms, now }).length, [lib, f, prefs, gyms, now]);
  const pausedCount = useMemo(() => lib.filter((e) => statusOf(prefOf(prefs, e.id), now) === 'paused').length, [lib, prefs, now]);
  const bannedCount = useMemo(() => lib.filter((e) => statusOf(prefOf(prefs, e.id), now) === 'banned').length, [lib, prefs, now]);

  const chip = (key: string, label: string, on: boolean, pick: () => void) => (
    <button type="button" key={key} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={pick}>{label}</button>
  );

  return (
    <div className="app">
      <div className="topbar" aria-hidden="true"><span className="iconbtn"><span className="ic ic-chev-left lg" /></span><span className="title">All exercises</span><span className="spacer" /></div>
      <div className="scroll" aria-hidden="true" style={{ paddingTop: 0 }}><div className="card" style={{ height: 50 }} /><div className="card" style={{ height: 600 }} /></div>
      <Link className="scrim" to={back} aria-label="Close" />
      <div className="sheet" role="dialog" aria-label="Filter exercises" style={{ maxHeight: '92%', paddingBottom: 0 }}>
        <div className="grabber" />
        <div className="between"><h2 className="t-h">Filters</h2><button type="button" className="link" style={{ minHeight: 44, padding: '0 4px' }} onClick={resetSheetFilters}>Reset</button></div>
        <div className="stack-s" style={{ gap: 8 }}>
          <span className="lbl">Can do at</span>
          <div className="wrap">
            {chip('any', 'Any gym', !f.gymId, () => setFilter({ gymId: '' }))}
            {gyms.map((g) => chip(g.id, g.name, f.gymId === g.id, () => setFilter({ gymId: g.id })))}
            {chip(NO_EQUIPMENT_GYM_ID, NO_EQUIPMENT_LABEL, f.gymId === NO_EQUIPMENT_GYM_ID, () => setFilter({ gymId: NO_EQUIPMENT_GYM_ID }))}
          </div>
        </div>
        <div className="stack-s" style={{ gap: 8 }}>
          <span className="lbl">Equipment</span>
          <div className="wrap">{EQUIP_FILTERS.map((o) => chip(o, o, f.eq.includes(o), () => setFilter({ eq: toggleIn(f.eq, o) })))}</div>
        </div>
        <div className="stack-s" style={{ gap: 8 }}>
          <span className="lbl">Movement</span>
          <div className="wrap">{PATTERN_FILTERS.map((o) => chip(o, o, f.pat.includes(o), () => setFilter({ pat: toggleIn(f.pat, o) })))}</div>
        </div>
        <div className="stack-s" style={{ gap: 8 }}>
          <span className="lbl">Difficulty</span>
          <div className="seg c4 on-bg" role="group" aria-label="Difficulty">
            {['Any', 'Beginner', 'Mid', 'Advanced'].map((l, i) => (
              <button type="button" key={l} className={f.lvl === i ? 'on' : ''} aria-pressed={f.lvl === i} aria-label={i ? LEVEL_LABELS[i - 1] : 'Any difficulty'} onClick={() => setFilter({ lvl: i })} style={{ fontSize: '13px' }}>{l}</button>
            ))}
          </div>
        </div>
        <div className="group" style={{ boxShadow: 'none' }}>
          <label className="li"><div className="grow"><span className="li-t">Favourites only</span></div><input type="checkbox" className="switch" checked={f.fav} onChange={(e) => setFilter({ fav: e.target.checked })} /></label>
          <label className="li"><div className="grow"><span className="li-t">Show paused</span><span className="li-s">{pausedCount} paused</span></div><input type="checkbox" className="switch" checked={f.showPaused} onChange={(e) => setFilter({ showPaused: e.target.checked })} /></label>
          <label className="li"><div className="grow"><span className="li-t">Show banned</span><span className="li-s">{bannedCount} banned</span></div><input type="checkbox" className="switch" checked={f.showBanned} onChange={(e) => setFilter({ showBanned: e.target.checked })} /></label>
        </div>
        <div style={{ position: 'sticky', bottom: 0, background: '#F7F6F3', padding: '10px 0 28px', marginTop: 'auto' }}>
          <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={!n} onClick={() => nav(back)}>{n ? `Show ${n} ${n === 1 ? 'exercise' : 'exercises'}` : 'No exercises match'}</button>
        </div>
      </div>
    </div>
  );
}
