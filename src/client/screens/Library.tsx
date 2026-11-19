import { useMemo } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { availableEquipment, isAvailable } from '../../shared/rules';
import { prefOf, statusOf } from '../../shared/planner';
import { useCurrentGym, useLibrary, usePrefs } from '../store/actions';
import { EQUIP_FILTERS, LIB_GROUPS, equipLabels, groupOf } from '../store/x-library';

const CSS = `
.fakesearch{display:flex;align-items:center;gap:10px;min-height:52px;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1px #E6E4DF;padding:0 14px;color:#6B6B6B;font-size:16px}
.mgroup{background:#fff;border-radius:20px;padding:14px;display:flex;flex-direction:column;gap:2px;min-height:92px;box-shadow:0 1px 2px rgba(18,18,18,.04),0 8px 24px rgba(18,18,18,.05)}
.mgroup b{font-family:'Inter Tight',Inter,sans-serif;font-size:28px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.hscroll{display:flex;gap:10px;overflow-x:auto;margin:0 -18px;padding:2px 18px 6px;scrollbar-width:none}
.hscroll::-webkit-scrollbar{display:none}
.favcard{flex:0 0 150px;background:#fff;border-radius:18px;padding:12px;display:flex;flex-direction:column;gap:6px;box-shadow:0 1px 2px rgba(18,18,18,.04),0 8px 24px rgba(18,18,18,.05)}
.pref{background:#fff;border-radius:18px;padding:12px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 2px rgba(18,18,18,.04),0 8px 24px rgba(18,18,18,.05);min-height:44px}
`;

export default function Library() {
  const loc = useLocation();
  const lib = useLibrary();
  const prefs = usePrefs();
  const gym = useCurrentGym();
  const picking = /[?&](add=1|addToArea=)/.test(loc.search);

  const data = useMemo(() => {
    const now = Date.now();
    const avail = availableEquipment(gym);
    const groups = LIB_GROUPS.map((g) => ({ name: g, n: 0, ready: 0, paused: 0, banned: 0, notHere: 0 }));
    const gi = new Map(groups.map((g) => [g.name, g]));
    const equip = new Map<string, number>();
    const favs = [];
    let fav = 0, paused = 0, banned = 0;
    for (const e of lib) {
      const p = prefOf(prefs, e.id);
      const st = statusOf(p, now);
      const g = gi.get(groupOf(e))!;
      g.n++;
      if (st === 'paused') { g.paused++; paused++; } else if (st === 'banned') { g.banned++; banned++; }
      else if (gym && !isAvailable(e, avail)) g.notHere++;
      else g.ready++;
      if (p.favorite) { fav++; favs.push(e); }
      for (const l of equipLabels(e)) equip.set(l, (equip.get(l) ?? 0) + 1);
    }
    return { groups, equip: EQUIP_FILTERS.filter((x) => equip.has(x)).map((x) => ({ name: x, n: equip.get(x)! })), favs, fav, paused, banned };
  }, [lib, prefs, gym]);

  // Add flows (PreSession add / area pool) pick from the full list, so go straight there.
  if (picking) return <Navigate to={`/library/all${loc.search}`} replace />;

  const sub = (g: (typeof data.groups)[number]) => {
    const parts = [`${g.ready} ready${g.paused || g.banned || g.notHere ? '' : gym ? ' here' : ''}`];
    if (g.paused) parts.push(`${g.paused} paused`);
    if (g.banned) parts.push(`${g.banned} banned`);
    if (g.notHere) parts.push(`${g.notHere} not here`);
    return parts.join(' · ');
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="topbar">
        <Link className="iconbtn" to="/plan" aria-label="Back to Plan"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Exercise library</span>
        <Link className="iconbtn" to="/exercise/new" aria-label="Create exercise"><span className="ic ic-plus lg" aria-hidden="true" /></Link>
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <Link className="fakesearch" to="/library/all?reset=1"><span className="ic ic-search" aria-hidden="true" />{`Search ${lib.length} exercises`}</Link>

        <div className="grid3">
          <Link className="pref" to="/library/exclusions"><span className="ic ic-star-fill" style={{ color: '#FF5A1F' }} aria-hidden="true" /><span className="t-num" style={{ fontSize: 24 }}>{data.fav}</span><span className="small sub">Favourites</span></Link>
          <Link className="pref" to="/library/exclusions"><span className="ic ic-pause-c" style={{ color: '#A8360A' }} aria-hidden="true" /><span className="t-num" style={{ fontSize: 24 }}>{data.paused}</span><span className="small sub">Paused</span></Link>
          <Link className="pref" to="/library/exclusions"><span className="ic ic-ban" style={{ color: '#B42318' }} aria-hidden="true" /><span className="t-num" style={{ fontSize: 24 }}>{data.banned}</span><span className="small sub">Banned</span></Link>
        </div>
        <div className="banner info"><span className="ic ic-info" aria-hidden="true" /><div>Plans and swaps only use <b>ready</b> exercises your gym can do, favourites first. Paused ones return on their date. Banned never appear.</div></div>

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>By muscle</span><Link className="link" to="/library/all?reset=1">See all</Link></div>
        <div className="grid2">
          {data.groups.filter((g) => g.n > 0).map((g) => (
            <Link key={g.name} className="mgroup" to={`/library/all?reset=1&group=${encodeURIComponent(g.name)}`}>
              <span className="strong">{g.name}</span>
              <b>{g.n}</b>
              <span className="small sub">{sub(g)}</span>
            </Link>
          ))}
        </div>

        <div className="section-h">By equipment</div>
        <div className="wrap">
          {data.equip.map((e) => <Link key={e.name} className="chip" to={`/library/all?reset=1&eq=${encodeURIComponent(e.name)}`}>{e.name} <span className="sub small">{e.n}</span></Link>)}
        </div>

        <div className="section-row"><span className="section-h" style={{ margin: 0 }}>Favourites</span><Link className="link" to="/library/exclusions">Manage</Link></div>
        {data.favs.length > 0 ? (
          <div className="hscroll">
            {data.favs.map((e) => (
              <Link key={e.id} className="favcard" to={`/library/${e.id}`}>
                <span className="ic ic-star-fill sm" style={{ color: '#FF5A1F' }} aria-hidden="true" />
                <span className="li-t">{e.name}</span>
                <span className="small sub">{`${e.primary[0] ?? ''} · ${equipLabels(e)[0].toLowerCase()}`}</span>
              </Link>
            ))}
          </div>
        ) : <p className="small sub" style={{ margin: 0 }}>No favourites yet. Star the exercises you want planned first.</p>}
        <Link className="btn btn-secondary" to="/exercise/new"><span className="ic ic-plus" aria-hidden="true" />Create your own exercise</Link>
      </div>
    </div>
  );
}
