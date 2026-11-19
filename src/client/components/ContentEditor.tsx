// Editor for an exercise's how-to content: summary, ordered steps, cues, tips (add / remove / reorder) and media (add by URL with a
// live preview and kind detection). Controlled: the parent (ExerciseEdit) owns the state and saves the override.
import { useEffect, useRef, useState } from 'react';
import { LIMITS, detectMedia, newMediaId, validateMediaInput } from '../../shared/content';
import type { ExerciseContent, MediaItem, MediaKind } from '../../shared/types';

export interface ContentDraft { summary: string; steps: string[]; cues: string[]; goodToKnow: string[]; media: MediaItem[] }
export const draftFrom = (c: { summary?: string; steps?: string[]; cues?: string[]; goodToKnow?: string[]; media?: MediaItem[] }): ContentDraft => ({
  summary: c.summary ?? '', steps: [...(c.steps ?? [])], cues: [...(c.cues ?? [])], goodToKnow: [...(c.goodToKnow ?? [])], media: [...(c.media ?? [])],
});
export type ListKey = 'steps' | 'cues' | 'goodToKnow';
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clean = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);

/** Draft -> override: only fields that differ from the built-in default are stored (so default text updates keep flowing). */
export function overrideFrom(d: ContentDraft, dflt: ExerciseContent): ExerciseContent | undefined {
  const out: ExerciseContent = {};
  const summary = d.summary.trim();
  if (summary && summary !== (dflt.summary ?? '')) out.summary = summary;
  for (const k of ['steps', 'cues', 'goodToKnow'] as ListKey[]) {
    const v = clean(d[k]);
    if (v.length && !eq(v, dflt[k] ?? [])) out[k] = v;
  }
  if (d.media.length && !eq(d.media, dflt.media ?? [])) out.media = d.media;
  return Object.keys(out).length ? out : undefined;
}
export const draftDiffers = (d: ContentDraft, dflt: ExerciseContent, k: keyof ContentDraft): boolean =>
  k === 'summary' ? d.summary.trim() !== (dflt.summary ?? '') : k === 'media' ? !eq(d.media, dflt.media ?? []) : !eq(clean(d[k]), dflt[k] ?? []);

/** A textarea that grows with its text (no inner scrolling, so a long step is fully readable while editing). */
function AutoText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

function ListEditor({ id, title, hint, items, onChange, max, maxLen, placeholder, addLabel, item, canReset, onReset }: {
  id: string; title: string; hint: string; items: string[]; onChange: (l: string[]) => void; max: number; maxLen: number; placeholder: string; addLabel: string; item: string; canReset: boolean; onReset: () => void;
}) {
  const move = (i: number, d: number) => { const l = [...items]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; onChange(l); };
  return (
    <div className="stack-s" style={{ gap: 8 }} role="group" aria-label={title} data-testid={`edit-${id}`}>
      <div className="between"><span className="strong">{title}</span>{canReset && <button type="button" className="link small" style={{ minHeight: 44 }} onClick={onReset}>Reset to default</button>}</div>
      <span className="help" style={{ marginTop: -4 }}>{hint}</span>
      {items.map((t, i) => (
        <div className="ced-row" key={i}>
          <AutoText className="input ced-text" rows={2} maxLength={maxLen} value={t} placeholder={placeholder} aria-label={`${item} ${i + 1}`}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <div className="ced-ctl">
            <button type="button" className="iconbtn" aria-label={`Move ${item.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><span className="ic ic-chev-up sm" aria-hidden="true" /></button>
            <button type="button" className="iconbtn" aria-label={`Move ${item.toLowerCase()} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><span className="ic ic-chev-down sm" aria-hidden="true" /></button>
            <button type="button" className="iconbtn" aria-label={`Remove ${item.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><span className="ic ic-trash sm" aria-hidden="true" /></button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={items.length >= max} onClick={() => onChange([...items, ''])}><span className="ic ic-plus sm" aria-hidden="true" />{addLabel}</button>
      {items.length >= max && <span className="help">Maximum {max} reached.</span>}
    </div>
  );
}

const KIND_LABEL = { youtube: 'YouTube video (loads only when you tap play)', vimeo: 'Vimeo video (loads only when you tap play)', file: '', link: 'Web page (opens in a new tab)' } as const;

function MediaEditor({ items, onChange, canReset, onReset }: { items: MediaItem[]; onChange: (l: MediaItem[]) => void; canReset: boolean; onReset: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [asImage, setAsImage] = useState(false);
  const [err, setErr] = useState('');
  const [badPrev, setBadPrev] = useState('');
  const hint: MediaKind | undefined = asImage ? 'image' : undefined;
  const info = url.trim() ? detectMedia(url, hint) : null;
  const kindText = !url.trim() ? '' : !info ? 'Not a valid link. It must start with https://' : info.kind === 'image' ? 'Image' : info.provider === 'file' ? 'Video file' : KIND_LABEL[info.provider];
  const add = () => {
    setErr('');
    if (items.length >= LIMITS.mediaCount) { setErr(`Maximum ${LIMITS.mediaCount} items.`); return; }
    try {
      const m = validateMediaInput({ id: newMediaId(), url, kind: hint, title: title || undefined, caption: caption || undefined }, 'link');
      if (items.some((x) => x.url === m.url)) { setErr('That link is already attached.'); return; }
      onChange([...items, m]); setUrl(''); setTitle(''); setCaption(''); setAsImage(false);
    } catch (e) { setErr((e as Error).message.replace(/^link\.url/, 'The link').replace(/^link\./, '')); }
  };
  return (
    <div className="stack-s" style={{ gap: 8 }} role="group" aria-label="Photos and videos" data-testid="edit-media">
      <div className="between"><span className="strong">Photos and videos</span>{canReset && <button type="button" className="link small" style={{ minHeight: 44 }} onClick={onReset}>Reset to default</button>}</div>
      <span className="help" style={{ marginTop: -4 }}>Paste a link to an image, a video file, or a YouTube or Vimeo video. Only https links work.</span>
      {items.map((m) => {
        const i = detectMedia(m.url, m.kind);
        const label = m.title || m.caption || (i ? new URL(i.url).hostname.replace(/^www\./, '') : m.url);
        return (
          <div className="ced-media" key={m.id}>
            <span className={`ic ${m.kind === 'image' ? 'ic-image' : 'ic-play'}`} aria-hidden="true" />
            <div className="grow"><span className="li-t" style={{ overflowWrap: 'anywhere' }}>{label}</span><span className="li-s" style={{ overflowWrap: 'anywhere' }}>{m.kind === 'image' ? 'Image' : i?.provider === 'youtube' ? 'YouTube' : i?.provider === 'vimeo' ? 'Vimeo' : i?.provider === 'file' ? 'Video file' : 'Link'} · {i ? new URL(i.url).hostname.replace(/^www\./, '') : ''}</span></div>
            <button type="button" className="iconbtn" aria-label={`Remove ${label}`} onClick={() => onChange(items.filter((x) => x.id !== m.id))}><span className="ic ic-trash sm" aria-hidden="true" /></button>
          </div>
        );
      })}
      <div className="ced-add">
        <label className="field"><span className="lbl">Link</span>
          <input className="input" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://" value={url} maxLength={LIMITS.url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} aria-label="Media link" aria-invalid={!!url.trim() && !info} />
        </label>
        {kindText && <span className={`help${info ? '' : ' err'}`} data-testid="media-kind" role="status">{kindText}</span>}
        {info && (asImage || (info.provider === 'link' && info.kind === 'video')) && (
          <label className="between" style={{ minHeight: 44 }}><span className="sub">This link is an image</span><input type="checkbox" className="switch" checked={asImage} onChange={(e) => setAsImage(e.target.checked)} aria-label="This link is an image" /></label>
        )}
        {info?.kind === 'image' && (badPrev === info.url
          ? <span className="help" data-testid="prev-bad">The preview could not be loaded. You can still add the link.</span>
          : <img className="ced-prev" src={info.url} alt="Preview" decoding="async" referrerPolicy="no-referrer" onError={() => setBadPrev(info.url)} />)}
        <input className="input" placeholder="Title (optional)" aria-label="Media title" maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder="Caption (optional)" aria-label="Media caption" maxLength={LIMITS.caption} value={caption} onChange={(e) => setCaption(e.target.value)} />
        {err && <span className="help err" role="alert">{err}</span>}
        <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={!info} onClick={add}><span className="ic ic-plus sm" aria-hidden="true" />Add to exercise</button>
      </div>
    </div>
  );
}

export default function ContentEditor({ draft, setDraft, defaults }: { draft: ContentDraft; setDraft: (d: ContentDraft) => void; defaults: ExerciseContent }) {
  const set = <K extends keyof ContentDraft>(k: K, v: ContentDraft[K]) => setDraft({ ...draft, [k]: v });
  const reset = (k: keyof ContentDraft) => setDraft({ ...draft, [k]: draftFrom(defaults)[k] });
  const any = (['summary', 'steps', 'cues', 'goodToKnow', 'media'] as const).some((k) => draftDiffers(draft, defaults, k));
  return (
    <div className="card tight" id="how-to" style={{ gap: 16 }} data-testid="content-editor">
      <div className="between"><span className="t-h" style={{ fontSize: 17 }}>How to</span>{any && <button type="button" className="link small" style={{ minHeight: 44 }} onClick={() => setDraft(draftFrom(defaults))}>Reset all to default</button>}</div>
      <label className="field" style={{ gap: 8 }}>
        <span className="between"><span className="strong">Summary</span>{draftDiffers(draft, defaults, 'summary') && <button type="button" className="link small" style={{ minHeight: 44 }} onClick={(e) => { e.preventDefault(); reset('summary'); }}>Reset to default</button>}</span>
        <textarea className="input" rows={3} maxLength={LIMITS.summary} value={draft.summary} placeholder="What it trains and when to use it" onChange={(e) => set('summary', e.target.value)} style={{ padding: '12px 16px', minHeight: 80, resize: 'vertical' }} />
      </label>
      <ListEditor id="steps" title="Steps" hint="In order: setup, lowering, lifting, finish." items={draft.steps} onChange={(l) => set('steps', l)} max={LIMITS.stepCount} maxLen={LIMITS.step} placeholder="e.g. Brace your core, then lower under control" addLabel="Add step" item="Step" canReset={draftDiffers(draft, defaults, 'steps')} onReset={() => reset('steps')} />
      <ListEditor id="cues" title="Think about" hint="Short cues to keep in mind during the rep." items={draft.cues} onChange={(l) => set('cues', l)} max={LIMITS.cueCount} maxLen={LIMITS.cue} placeholder="e.g. Ribs down" addLabel="Add cue" item="Cue" canReset={draftDiffers(draft, defaults, 'cues')} onReset={() => reset('cues')} />
      <ListEditor id="tips" title="Good to know" hint="Common mistakes, setup, breathing, safety, what to do if it hurts." items={draft.goodToKnow} onChange={(l) => set('goodToKnow', l)} max={LIMITS.tipCount} maxLen={LIMITS.tip} placeholder="e.g. Keep your heels down" addLabel="Add tip" item="Tip" canReset={draftDiffers(draft, defaults, 'goodToKnow')} onReset={() => reset('goodToKnow')} />
      <MediaEditor items={draft.media} onChange={(l) => set('media', l)} canReset={draftDiffers(draft, defaults, 'media')} onReset={() => reset('media')} />
    </div>
  );
}
