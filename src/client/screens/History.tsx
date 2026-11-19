import { goalForWeek } from '../../shared/streak';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAreas, useSessions, useSettings } from '../store/actions';
import { completed, isoWeek, sessionDurationSec, weekStart } from '../../shared/rules';
import { dayShort, monthShort } from '../lib/format';

const DAY = 86400000;

function weekLabel(start: number, nowMs: number): string {
  const wk = isoWeek(start + 3600_000);
  if (start === weekStart(nowMs)) return `This week · W${wk}`;
  const a = new Date(start);
  const b = new Date(start); b.setDate(b.getDate() + 6);
  const from = a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${monthShort(start)}`;
  return `W${wk} · ${from}–${b.getDate()} ${monthShort(b.getTime())}`;
}

export default function History() {
  const sessions = useSessions();
  const areas = useAreas();
  const settings = useSettings();
  const [filter, setFilter] = useState('All');
  const nowMs = useMemo(() => Date.now(), []);

  const done = useMemo(() => completed(sessions).sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)), [sessions]);
  const names = useMemo(() => {
    const set = new Set<string>();
    for (const a of areas) set.add(a.name);
    for (const s of done) set.add(s.areaName);
    return ['All', ...set];
  }, [areas, done]);

  const weeks = useMemo(() => {
    const m = new Map<number, typeof done>();
    for (const s of done) {
      const k = weekStart(s.endedAt ?? s.startedAt);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([start, all]) => ({
      start, all, items: all.filter((s) => filter === 'All' || s.areaName === filter),
    })).filter((w) => w.items.length);
  }, [done, filter]);

  return (
    <div className="app">
      <style>{'.hscroll{display:flex;gap:8px;overflow-x:auto;margin:0 -18px;padding:2px 18px 4px;scrollbar-width:none}.hscroll::-webkit-scrollbar{display:none}'}</style>
      <div className="topbar">
        <Link className="iconbtn" to="/progress" aria-label="Back to Progress"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">History</span>
        <span className="spacer" />
      </div>
      <div style={{ padding: '0 18px 8px', flexShrink: 0 }}>
        <div className="hscroll" role="group" aria-label="Filter by area">
          {names.map((n) => (
            <button key={n} className={`chip ${filter === n ? 'on' : ''}`} aria-pressed={filter === n} onClick={() => setFilter(n)}>{n}</button>
          ))}
        </div>
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        {weeks.map((w) => (
          <div key={w.start} className="stack-s" style={{ gap: 8 }}>
            <div className="between" style={{ padding: '8px 2px 0' }}>
              <span className="strong">{weekLabel(w.start, nowMs)}</span>
              <span className={`tag ${w.all.length >= goalForWeek(settings, w.start + 3600_000) ? 'green' : ''}`}>{w.all.length} / {goalForWeek(settings, w.start + 3600_000)}</span>
            </div>
            <div className="group">
              {w.items.map((s) => {
                const dur = sessionDurationSec(s);
                const meta = [dayShort(s.endedAt ?? s.startedAt), dur ? `${Math.round(dur / 60)} min` : null, s.gymName || null, s.endedEarly ? 'ended early' : null].filter(Boolean).join(' · ');
                return (
                  <Link key={s.id} className="li" to={`/history/${s.id}`}>
                    <span className={`tile sm ${s.endedEarly ? 'warm' : 'ink'}`}>{s.slot}</span>
                    <div className="grow"><span className="li-t">{s.areaName}</span><span className="li-s">{meta}</span></div>
                    <span className="small sub">#{s.seq}</span>
                    <span className="ic ic-chev-right chev" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {weeks.length === 0 && (
          <div className="empty">
            <div className="empty-ic"><span className="ic ic-calendar xl" aria-hidden="true" /></div>
            <p className="sub">{done.length === 0 ? 'No sessions yet. Finished sessions show up here.' : `No ${filter} sessions in the last 4 weeks.`}</p>
          </div>
        )}
      </div>
    </div>
  );
}
