import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TabBar from '../components/TabBar';
import EmptyProgress from './EmptyProgress';
import { useSessions, useSettings } from '../store/actions';
import { useNow } from '../lib/hooks';
import { completed } from '../../shared/rules';
import { useStreak } from '../store/x-streak';
import { mmss, toDisplay } from '../lib/format';
import {
  avgSessionMin, chartFor, chartScale, countPRs, fmtVol, gymShares, inRange, liftProgress, swapStats,
  topProgress, volumePerWeek, warmupNudge, warmupStats, type Range,
} from '../store/x-progress';

const GYM_COLORS = ['#121212', '#FF5A1F', '#B5B1A8', '#6B6B6B'];

export default function Progress() {
  const sessions = useSessions();
  const settings = useSettings();
  const now = useNow(60_000);
  const [range, setRange] = useState<Range>('w8');
  const done = useMemo(() => completed(sessions), [sessions]);
  const goal = settings.weeklyGoal;
  const streakView = useStreak(); // weeks in a row incl. repaired / frozen weeks: the same number as Today and the Streak page

  const data = useMemo(() => {
    const chart = chartFor(done, range, now, goal);
    const xs = inRange(done, chart.start);
    return {
      chart, xs,
      scale: chartScale(chart.vals, goal),
      avgMin: avgSessionMin(xs),
      wu: warmupStats(xs),
      vol: volumePerWeek(done, chart.start, now),
      prs: countPRs(xs),
      swaps: swapStats(xs),
      shares: gymShares(xs),
      top: topProgress(liftProgress(xs)),
    };
  }, [done, range, now, goal]);

  if (done.length === 0) return <EmptyProgress />;

  const { chart, xs, scale, wu, vol, swaps, shares, top } = data;
  const nudge = warmupNudge(wu, settings.warmupTargetMinutes);
  const wuDelta = wu ? Math.round(wu.medianSec - settings.warmupTargetMinutes * 60) : null;
  const sign = (n: number) => `${n >= 0 ? '+' : '\u2212'}${mmss(Math.abs(n))}`;
  const unit = settings.unit;

  return (
    <div className="app">
      <style>{`.chart{position:relative;height:150px;display:flex;align-items:flex-end;gap:6px;padding-top:10px}
.chart .col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end;position:relative;z-index:1}
.chart .col i{display:block;width:100%;border-radius:6px 6px 3px 3px;background:#121212}
.chart .col.under i{background:#D6D3CC}
.chart .col.now i{background:#FF5A1F}
.chart .col span{font-size:10px;color:#6B6B6B;font-weight:600}
.chart .goal{position:absolute;left:0;right:0;border-top:2px dashed #FF5A1F;z-index:2}
.chart .goal b{position:absolute;right:0;top:-20px;font-size:11px;color:#A8360A;background:#fff;padding:0 4px}
.psplit{display:flex;height:12px;border-radius:6px;overflow:hidden;gap:2px}`}</style>
      <div className="scroll" style={{ paddingTop: 24 }}>
        <div className="between" style={{ padding: '0 2px 4px' }}>
          <div className="stack-s" style={{ gap: 4 }}><span className="eyebrow">{chart.label}</span><h1 className="t-display">Progress</h1></div>
          <Link className="btn btn-secondary btn-sm" to="/history"><span className="ic ic-calendar sm" aria-hidden="true" />History</Link>
        </div>
        <div className="seg c3 on-bg" role="group" aria-label="Range">
          {([['w8', '8 weeks'], ['m6', '6 months'], ['y1', 'Year']] as [Range, string][]).map(([k, l]) => (
            <button key={k} className={range === k ? 'on' : ''} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>

        <div className="card">
          <div className="between" style={{ alignItems: 'baseline' }}><span className="strong">Sessions per week</span><span className="tag green">{chart.hit}</span></div>
          <div className="chart" role="img" aria-label={`Sessions per week, ${chart.label}: ${chart.vals.map((v, i) => `${chart.labels[i]} ${v}`).join(', ')}`}>
            <div className="goal" style={{ bottom: `${scale.goalPos}%` }}><b>Goal {goal}</b></div>
            {chart.vals.map((v, i) => {
              const isNow = chart.lastIsNow && i === chart.vals.length - 1;
              return (
                <div key={i} className={`col ${isNow ? 'now' : v < goal ? 'under' : ''}`} data-testid="col">
                  <i style={{ height: `${scale.barH(v)}%` }} /><span>{chart.labels[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid2">
          <div className="stat"><span className="stat-l">Avg session</span><span className="stat-v">{data.avgMin != null ? `${data.avgMin} min` : '\u2014'}</span><span className="small sub">Target {settings.targetMinutes}</span></div>
          <div className="stat"><span className="stat-l">Avg warm-up</span><span className="stat-v">{wu ? mmss(wu.medianSec) : '\u2014'}</span>
            {wuDelta != null ? <span className="tag accent" style={{ alignSelf: 'flex-start' }}>{sign(wuDelta)} vs plan</span> : <span className="small sub">Not timed yet</span>}</div>
          <div className="stat"><span className="stat-l">Volume / week</span><span className="stat-v">{fmtVol(toDisplay(vol.perWeek, unit))}</span><span className="small sub">{unit}{vol.deltaPct != null ? ` \u00b7 ${vol.deltaPct >= 0 ? '+' : '\u2212'}${Math.abs(vol.deltaPct)}%` : ''}</span></div>
          <div className="stat"><span className="stat-l">PRs</span><span className="stat-v">{data.prs}</span><span className="small sub">in {xs.length} {xs.length === 1 ? 'session' : 'sessions'}</span></div>
          <div className="stat"><span className="stat-l">Swaps</span><span className="stat-v">{swaps.count}</span><span className="small sub">{swaps.topGym ? `${swaps.topGym.n} at ${swaps.topGym.name}` : 'None'}</span></div>
          <Link className="stat" to="/streak" aria-label={`Streak, ${streakView.current} ${streakView.current === 1 ? 'week' : 'weeks'} at goal. Open your streak`}><span className="stat-l">Streak</span><span className="stat-v">{streakView.current}</span><span className="small sub">{streakView.current === 1 ? 'week' : 'weeks'} at goal</span></Link>
        </div>

        {nudge && (
          <div className="banner info">
            <span className="ic ic-bolt" aria-hidden="true" />
            <div>
              <span className="b-t">{nudge.title}</span>
              {nudge.body}{' '}
              <Link className="banner-act" to="/plan">Adjust</Link>
            </div>
          </div>
        )}

        {top.length > 0 && (
          <>
            <div className="section-h">Top progress</div>
            <div className="group">
              {top.map((l) => (
                <Link key={l.id} className="li" to={`/library/${l.id}`}>
                  <span className={`tile sm ${l.pct > 0 ? 'green' : ''}`}><span className={`ic ${l.pct > 0 ? 'ic-arrow-up' : 'ic-minus'} sm`} aria-hidden="true" /></span>
                  <div className="grow"><span className="li-t">{l.name}</span><span className="li-s">{l.pct > 0 ? `${toDisplay(l.first, unit)} \u2192 ${toDisplay(l.last, unit)} ${unit}` : `${l.pct === 0 ? 'Held at' : 'Now'} ${toDisplay(l.last, unit)} ${unit}${l.heavy ? ` \u00b7 ${l.heavy} \u00d7 too heavy` : ''}`}</span></div>
                  {l.pct > 0 ? <span className="tag green">+{l.pct}%</span> : <span className="tag">Stalled</span>}
                </Link>
              ))}
            </div>
          </>
        )}

        {shares.length > 0 && (
          <div className="card tight">
            <span className="strong">Where you trained</span>
            <div className="psplit" role="img" aria-label={shares.map((g) => `${g.name} ${g.pct}%`).join(', ')}>
              {shares.map((g, i) => <span key={g.name} style={{ width: `${g.pct}%`, background: GYM_COLORS[i] }} />)}
            </div>
            <div className="between small" style={{ flexWrap: 'wrap', gap: 8 }}>
              {shares.map((g, i) => <span key={g.name} className="hstack" style={{ gap: 6 }}><span className="dot" style={{ background: GYM_COLORS[i] }} />{g.name} {g.pct}%</span>)}
            </div>
          </div>
        )}
      </div>
      <TabBar />
    </div>
  );
}
