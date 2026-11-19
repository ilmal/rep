import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/core';
import { deleteGym, getPosition, setEquipStatus, updateGym } from '../store/actions';
import { EQUIPMENT, EQUIP_CATEGORIES } from '../../shared/catalog';
import { dayShort, monthShort } from '../lib/format';
import { mergeLibrary } from '../../shared/exercises';
import { availableEquipment, isAvailable } from '../../shared/rules';
import type { EquipStatus } from '../../shared/types';

const RADII = [100, 150, 250];

const CSS = `.li.off .li-t,.li.broken .li-t{color:#6B6B6B}
.li.broken .li-s{color:#A8360A}
.brk{min-height:44px;min-width:44px;border-radius:999px;border:0;background:#ECEBE7;color:#6B6B6B;font-size:12px;font-weight:700;padding:0 12px;margin-right:8px;cursor:pointer}
.brk[aria-pressed=true]{background:#FFE7DC;color:#A8360A}`;

export default function GymDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const gym = useStore((s) => s.gyms[id]);
  const [q, setQ] = useState('');
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [sheet, setSheet] = useState<null | 'add' | 'rename' | 'delete'>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [loc, setLoc] = useState<'idle' | 'locating' | 'denied' | 'done'>('idle');

  const status = (eid: string): EquipStatus => gym?.equipment[eid] ?? 'none';

  const exercises = useStore((s) => s.exercises);
  const library = useMemo(() => mergeLibrary(Object.values(exercises)).filter((e) => !e.archived), [exercises]);
  const uses = useMemo(() => {
    const u: Record<string, number> = {};
    for (const e of library) for (const id of e.equipment) u[id] = (u[id] ?? 0) + 1;
    return u;
  }, [library]);
  const okCount = gym ? EQUIPMENT.filter((e) => gym.equipment[e.id] === 'ok').length : 0;
  const exCount = useMemo(() => {
    const av = availableEquipment(gym);
    return library.filter((e) => isAvailable(e, av)).length;
  }, [gym, library]);
  const [toast, setToast] = useState('');
  const tt = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(tt.current), []);
  const say = (m: string) => { setToast(m); clearTimeout(tt.current); tt.current = setTimeout(() => setToast(''), 2200); };

  if (!gym || gym.deleted) {
    return (
      <div className="app">
        <div className="topbar">
          <Link className="iconbtn" to="/gyms" aria-label="Back to Gyms"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
          <span className="title">Gym</span><span className="spacer" />
        </div>
        <div className="scroll"><div className="empty"><div className="empty-ic"><span className="ic ic-building xl" aria-hidden="true" /></div><p className="sub">This gym doesn't exist any more.</p><Link className="btn btn-secondary" to="/gyms">Back to Gyms</Link></div></div>
      </div>
    );
  }

  const query = q.trim().toLowerCase();
  const visible = (eid: string) => status(eid) !== 'none' || touched.has(eid);
  const cats = EQUIP_CATEGORIES.map((name) => ({
    name,
    items: EQUIPMENT.filter((e) => e.category === name && (query ? e.name.toLowerCase().includes(query) : visible(e.id))),
  })).filter((c) => c.items.length);

  const touch = (eid: string) => setTouched((t) => new Set(t).add(eid));
  const toggle = (eid: string, name: string) => {
    const on = status(eid) === 'ok';
    setEquipStatus(gym.id, eid, on ? 'none' : 'ok');
    touch(eid);
    const n = uses[eid] ?? 0;
    say(on ? `${name} off: ${n} exercises hidden here` : `${name} on: ${n} exercises back`);
  };
  const toggleBroken = (eid: string, name: string) => {
    const broken = status(eid) === 'broken';
    setEquipStatus(gym.id, eid, broken ? 'ok' : 'broken');
    const n = uses[eid] ?? 0;
    say(broken ? `${name} fixed: ${n} exercises back` : `${name} broken: ${n} exercises hidden here`);
  };
  const addItem = (eid: string) => {
    setEquipStatus(gym.id, eid, 'ok');
    setTouched((t) => new Set(t).add(eid));
    say(`${EQUIPMENT.find((e) => e.id === eid)?.name} on: ${uses[eid] ?? 0} exercises back`);
  };
  const noteFor = (eid: string, note?: string) => {
    const st = status(eid);
    const n = uses[eid] ?? 0;
    if (st === 'broken') {
      const t = gym.brokenSince[eid];
      return `${t ? `Since ${dayShort(t)} ${monthShort(t)}` : 'Broken'}: ${n} exercises hidden`;
    }
    if (st === 'none') return `Not here: ${n} exercises hidden`;
    return gym.notes[eid] || note || `Used by ${n} exercises`;
  };

  const d = gym.radiusM <= 100 ? 64 : gym.radiusM <= 150 ? 90 : 128;
  const addable = EQUIPMENT.filter((e) => status(e.id) === 'none');

  const updateLoc = async () => {
    setLoc('locating');
    const p = await getPosition();
    if (!p) { setLoc('denied'); return; }
    updateGym(gym.id, { lat: p.lat, lng: p.lng });
    setLoc('done');
  };
  const rename = () => {
    const n = nameDraft.trim();
    if (!n) return;
    updateGym(gym.id, { name: n });
    setSheet(null);
  };
  const remove = () => { deleteGym(gym.id); nav('/gyms', { replace: true }); };

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="topbar">
        <Link className="iconbtn" to="/gyms" aria-label="Back to Gyms"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">{gym.name}</span>
        <button className="iconbtn" aria-label="Rename gym" onClick={() => { setNameDraft(gym.name); setSheet('rename'); }}><span className="ic ic-edit" aria-hidden="true" /></button>
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <div className="grid2">
          <div className="stat"><span className="stat-v">{okCount}</span><span className="stat-l">Available here</span></div>
          <div className="stat"><span className="stat-v">{exCount}</span><span className="stat-l">Exercises you can do here</span></div>
        </div>
        <label className="search">
          <span className="ic ic-search" aria-hidden="true" />
          <input className="input" type="search" placeholder="Search equipment" aria-label="Search equipment" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <p className="small sub" style={{ padding: '0 2px' }}>Turn off anything this gym doesn't have. Exercises that need it won't be planned here.</p>
        {cats.length === 0 && <p className="sub center">{query ? 'No equipment matches.' : 'No equipment yet. Tap Add equipment.'}</p>}
        {cats.map((c) => (
          <div key={c.name} className="stack-s" style={{ gap: 8 }}>
            <div className="between" style={{ padding: '6px 2px 0' }}><span className="lbl">{c.name}</span><span className="small sub">{c.items.filter((i) => status(i.id) === 'ok').length} of {c.items.length}</span></div>
            <div className="group">
              {c.items.map((it) => {
                const st = status(it.id);
                return (
                  <label key={it.id} className={`li ${st === 'ok' ? '' : st === 'none' ? 'off' : 'broken'}`} style={{ minHeight: 56 }}>
                    <div className="grow"><span className="li-t">{it.name}</span><span className="li-s">{noteFor(it.id, it.note)}</span></div>
                    {st !== 'none' && <button type="button" className="brk" aria-pressed={st === 'broken'} aria-label={`${it.name} broken`} onClick={() => toggleBroken(it.id, it.name)}>Broken</button>}
                    <input type="checkbox" className="switch" checked={st === 'ok'} onChange={() => toggle(it.id, it.name)} aria-label={`${it.name} available`} />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <button className="btn btn-secondary" onClick={() => setSheet('add')}><span className="ic ic-plus" aria-hidden="true" />Add equipment</button>

        <div className="section-h">Location</div>
        <div className="card tight">
          <div className="map" style={{ height: 120 }} aria-hidden="true">
            <div className="road" style={{ left: 0, right: 0, top: 54, height: 10 }} />
            <div className="fence" style={{ left: 166 - d / 2, top: 46 - d / 2, width: d, height: d }} />
            <div className="mpin" style={{ left: 148, top: 30 }}><i /></div>
          </div>
          <span className="small sub">
            {gym.lat != null && gym.lng != null ? `${gym.lat.toFixed(4)}, ${gym.lng.toFixed(4)}` : "No location set. This gym can't be detected automatically."}
          </span>
          <button className="btn btn-soft" onClick={updateLoc} disabled={loc === 'locating'}>
            <span className="ic ic-nav" aria-hidden="true" />{loc === 'locating' ? 'Locating…' : 'Update location to here'}
          </button>
          {loc === 'denied' && <span className="help err" role="alert">Couldn't get your location. Check that location access is allowed.</span>}
          {loc === 'done' && <span className="help" role="status">Location updated.</span>}
          <div className="stack-s" style={{ gap: 8 }}>
            <span className="strong">Detection radius</span>
            <div className="seg c3">
              {RADII.map((r) => (
                <button key={r} className={gym.radiusM === r ? 'on' : ''} aria-pressed={gym.radiusM === r} onClick={() => updateGym(gym.id, { radiusM: r })}>{r} m</button>
              ))}
            </div>
          </div>
        </div>
        <button className="btn btn-danger-soft" onClick={() => setSheet('delete')}><span className="ic ic-trash" aria-hidden="true" />Delete gym</button>
      </div>

      {toast && <div className="toast" role="status" style={{ bottom: 28 }}><span className="ic ic-info" aria-hidden="true" /><span className="grow">{toast}</span></div>}

      {sheet === 'add' && (
        <>
          <button className="scrim" aria-label="Close" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-label="Add equipment">
            <div className="grabber" />
            <div className="between">
              <h2 className="t-h">Add equipment</h2>
              <button className="iconbtn" aria-label="Close" style={{ marginRight: -10 }} onClick={() => setSheet(null)}><span className="ic ic-x" aria-hidden="true" /></button>
            </div>
            {addable.length === 0 ? <p className="sub">Everything in the catalog is already at this gym.</p> : EQUIP_CATEGORIES.map((cat) => {
              const items = addable.filter((e) => e.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat} className="stack-s" style={{ gap: 8 }}>
                  <span className="lbl">{cat}</span>
                  <div className="group">
                    {items.map((it) => (
                      <div key={it.id} className="li" style={{ minHeight: 56 }}>
                        <div className="grow"><span className="li-t">{it.name}</span></div>
                        <button className="btn btn-soft btn-sm" onClick={() => addItem(it.id)} aria-label={`Add ${it.name}`}><span className="ic ic-plus sm" aria-hidden="true" />Add</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <button className="btn btn-primary" onClick={() => setSheet(null)}>Done</button>
          </div>
        </>
      )}

      {sheet === 'rename' && (
        <>
          <button className="scrim" aria-label="Cancel" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-label="Rename gym">
            <div className="grabber" />
            <h2 className="t-h">Rename gym</h2>
            <label className="field">
              <span className="lbl">Name</span>
              <input className="input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') rename(); }} />
            </label>
            <button className="btn btn-primary" onClick={rename} disabled={!nameDraft.trim()}>Save</button>
            <button className="btn btn-soft" onClick={() => setSheet(null)}>Cancel</button>
          </div>
        </>
      )}

      {sheet === 'delete' && (
        <>
          <button className="scrim" aria-label="Cancel" onClick={() => setSheet(null)} />
          <div className="dialog" role="alertdialog" aria-label="Delete gym">
            <div className="empty-ic red" style={{ width: 64, height: 64, alignSelf: 'center' }}><span className="ic ic-trash xl" aria-hidden="true" /></div>
            <h2 className="t-h center">Delete {gym.name}?</h2>
            <p className="sub center">Its equipment map will be removed. Past sessions stay in your history.</p>
            <button className="btn btn-danger" onClick={remove}>Delete gym</button>
            <button className="btn btn-soft" onClick={() => setSheet(null)}>Keep gym</button>
          </div>
        </>
      )}
    </div>
  );
}
