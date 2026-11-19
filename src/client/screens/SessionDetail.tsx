import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/core';
import { setSessionNote, useSettings, deleteSession } from '../store/actions';
import { exerciseSeconds, sessionDurationSec, volumeOf } from '../../shared/rules';
import { dayShort, mmss, monthShort, rxLine, toDisplay } from '../lib/format';
import type { Feedback, SessionExercise, Unit } from '../../shared/types';
import HrCard from '../components/HrCard';

const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const EFFORT: Record<Feedback['effort'], string> = { chill: 'Chill', normal: 'Normal', hard: 'Trying hard' };
const WEIGHT: Record<Feedback['weight'], string> = { light: 'too light', right: 'just right', heavy: 'too heavy' };
const VOLUME: Record<Feedback['volume'], string> = { reps: 'too many reps', sets: 'too many sets', ok: 'right amount' };
const fmtVol = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));

function tagFor(e: SessionExercise): { text: string; cls: string } | null {
  if (e.status === 'skipped') return { text: 'Skipped', cls: '' };
  if (e.status === 'dropped') return { text: 'Dropped', cls: '' };
  if (e.pr) return { text: 'PR', cls: 'green' };
  if (e.swappedFrom) return { text: 'Swap', cls: 'blue' };
  if (e.recommendation) return { text: e.recommendation.kind === 'hold' ? 'Hold' : e.recommendation.tag, cls: e.recommendation.kind === 'hold' || e.recommendation.kind.endsWith('down') ? '' : 'green' };
  return null;
}

function feedbackLine(e: SessionExercise, unit: Unit): string | null {
  if (!e.feedback && !e.recommendation) return null;
  const parts: string[] = [];
  if (e.feedback) parts.push(`${EFFORT[e.feedback.effort]} · ${WEIGHT[e.feedback.weight]} · ${VOLUME[e.feedback.volume]}`);
  let line = parts.join('');
  const r = e.recommendation;
  if (r) {
    const next = r.kind === 'hold' ? 'hold' : rxLine(r.sets, r.reps, r.weight, unit, e.tracking, e.perHand);
    line += `${line ? ' → ' : ''}${next}`;
    if (r.why) line += `. ${r.why}`;
  }
  return `Feedback: ${line}`;
}

export default function SessionDetail() {
  const { id = '' } = useParams();
  const s = useStore((st) => st.sessions[id]);
  const plan = useStore((st) => (s?.coachPlanId ? st.plans[s.coachPlanId] : undefined));
  const { unit } = useSettings();
  const [open, setOpen] = useState(0);
  const [note, setNote] = useState(s?.note ?? '');
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { setNote(s?.note ?? ''); }, [s?.id, s?.note]);

  if (!s) {
    return (
      <div className="app">
        <div className="topbar">
          <Link className="iconbtn" to="/history" aria-label="Back to History"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
          <span className="title">Session</span><span className="spacer" />
        </div>
        <div className="scroll"><div className="empty"><div className="empty-ic"><span className="ic ic-calendar xl" aria-hidden="true" /></div><p className="sub">This session isn't on this device.</p><Link className="btn btn-secondary" to="/history">Back to History</Link></div></div>
      </div>
    );
  }

  const exs = s.exercises.filter((e) => e.status !== 'todo');
  const doneExs = exs.filter((e) => e.sets.length > 0);
  const totalSets = doneExs.reduce((a, e) => a + e.sets.length, 0);
  const prs = s.exercises.filter((e) => e.pr).length;
  const volume = s.exercises.reduce((a, e) => a + volumeOf(e), 0);
  const end = s.endedAt ?? s.updatedAt;
  const dur = sessionDurationSec(s);
  const warm = s.warmupStartedAt && s.warmupEndedAt ? Math.round((s.warmupEndedAt - s.warmupStartedAt) / 1000) : 0;
  const segs = [
    ...(warm > 0 ? [{ sec: warm, color: '#FF5A1F', label: 'Warm-up' }] : []),
    ...doneExs.map((e, i) => ({ sec: Math.max(30, exerciseSeconds(e) || e.sets.length * 120), color: i % 2 ? '#3D3D3D' : '#121212', label: e.name })),
  ];
  const segTotal = segs.reduce((a, x) => a + x.sec, 0) || 1;
  const startD = new Date(s.startedAt);
  const dateStr = `${dayShort(s.startedAt).replace(/ \d+$/, '')} ${startD.getDate()} ${monthShort(s.startedAt)}`;

  const saveNote = () => { if (note !== (s.note ?? '')) { setSessionNote(s.id, note); setSaved(true); } };

  return (
    <div className="app">
      <div className="topbar">
        <Link className="iconbtn" to="/history" aria-label="Back to History"><span className="ic ic-chev-left lg" aria-hidden="true" /></Link>
        <span className="title">Session #{s.seq}</span>
        <span className="spacer" />
      </div>
      <div className="scroll" style={{ paddingTop: 4, paddingBottom: 40 }}>
        <div className="hstack" style={{ padding: '0 2px', gap: 14 }}>
          <span className={`tile lg ${s.endedEarly ? 'warm' : 'ink'}`}>{s.slot}</span>
          <div className="stack-s grow" style={{ gap: 2 }}>
            <h1 className="t-title">{s.areaName}</h1>
            <span className="sub">{dateStr} · {hhmm(s.startedAt)}–{hhmm(end)}{s.gymName ? ` · ${s.gymName}` : ''}</span>
            <span className="hstack" style={{ gap: 6, flexWrap: 'wrap' }}>
              {s.endedEarly && <span className="tag accent">Ended early</span>}
              {s.source === 'coach' && <span className="tag blue">Coach plan</span>}
            </span>
          </div>
        </div>

        <HrCard from={s.warmupStartedAt ?? s.startedAt} to={end} />

        <div className="card tight">
          <div className="between"><span className="lbl">Timeline</span><span className="small strong">{mmss(dur)}</span></div>
          <div className="tl" style={{ height: 28, borderRadius: 8 }} role="img" aria-label={`${warm ? `Warm-up ${Math.round(warm / 60)} minutes then ` : ''}${doneExs.length} exercises`}>
            {segs.map((x, i) => <span key={i} style={{ width: `${(x.sec / segTotal) * 100}%`, background: x.color }} title={x.label} />)}
          </div>
          <div className="between small sub"><span>{hhmm(s.startedAt)}</span>{warm > 0 && <span>Warm-up {mmss(warm)}</span>}<span>{hhmm(end)}</span></div>
        </div>

        <div className="grid3">
          <div className="stat"><span className="stat-v">{fmtVol(toDisplay(volume, unit))}</span><span className="stat-l">{unit} volume</span></div>
          <div className="stat"><span className="stat-v">{totalSets}</span><span className="stat-l">Sets</span></div>
          <div className="stat"><span className="stat-v">{prs}</span><span className="stat-l">PRs</span></div>
        </div>

        <div className="section-h">Exercises</div>
        {exs.length === 0 ? <p className="sub">No exercises were logged.</p> : (
          <div className="group">
            {exs.map((e, i) => {
              const tag = tagFor(e);
              const isOpen = open === i;
              const secs = exerciseSeconds(e);
              const meta = [
                e.sets.length ? rxLine(e.sets.length, e.sets[0].reps, e.sets[0].weight, unit, e.tracking, e.perHand) : 'Not performed',
                secs ? mmss(secs) : null,
                e.swappedFrom ? `swapped from ${e.swappedFrom.name}` : null,
              ].filter(Boolean).join(' · ');
              const fb = feedbackLine(e, unit);
              return (
                <div key={e.id}>
                  <button className="li" onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen}>
                    <div className="grow"><span className="li-t">{e.name}</span><span className="li-s">{meta}</span></div>
                    {tag && <span className={`tag ${tag.cls}`}>{tag.text}</span>}
                    <span className={`ic ${isOpen ? 'ic-chev-up' : 'ic-chev-down'} chev`} aria-hidden="true" />
                  </button>
                  {isOpen && (
                    <>
                      {e.sets.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr 1fr', gap: '6px 8px', fontSize: 14, padding: '4px 16px 14px' }}>
                          {['Set', e.tracking === 'weight_reps' ? unit : '', e.tracking === 'time' ? 'Time' : 'Reps', 'Rest'].map((h, k) => (
                            <b key={k} style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6B6B6B' }}>{h}</b>
                          ))}
                          {e.sets.map((set, k) => (
                            <FragmentRow key={k} n={k + 1} w={e.tracking === 'weight_reps' ? String(toDisplay(set.weight, unit)) : '—'} r={e.tracking === 'time' ? `${set.seconds ?? set.reps} s` : String(set.reps)} rest={set.restSec ? mmss(set.restSec) : '—'} />
                          ))}
                        </div>
                      )}
                      {fb && <p className="small sub" style={{ padding: '0 16px 14px' }}>{fb}</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {plan?.note && (
          <div className="card tight"><span className="lbl">Coach note</span><p style={{ fontSize: 14 }}>{plan.note}</p></div>
        )}
        <label className="card tight" style={{ display: 'flex' }}>
          <span className="lbl">Note</span>
          <textarea className="input" style={{ minHeight: 90, padding: '12px 14px', resize: 'vertical' }} placeholder="How did it feel?" value={note}
            onChange={(e) => { setNote(e.target.value); setSaved(false); }} onBlur={saveNote} />
          <span className="help" role="status" style={{ minHeight: 18 }}>{saved ? 'Saved' : ''}</span>
        </label>
        {!confirmDel && <button className="btn btn-danger-soft" onClick={() => setConfirmDel(true)}><span className="ic ic-trash" aria-hidden="true" />Delete session</button>}
        {confirmDel && (
          <div className="card" role="alertdialog" aria-label="Delete session?" style={{ gap: 12 }}>
            <h2 className="t-h">Delete this session?</h2>
            <p className="sub">It stops counting towards your weeks and stats. Progression targets already set from it are kept.</p>
            <button className="btn btn-danger" onClick={() => { deleteSession(s.id); navigate('/history', { replace: true }); }}>Delete session</button>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>Keep it</button>
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentRow({ n, w, r, rest }: { n: number; w: string; r: string; rest: string }) {
  return (
    <>
      <span className="strong">{n}</span><span>{w}</span><span>{r}</span><span className="sub">{rest}</span>
    </>
  );
}
