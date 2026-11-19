// ONE component for every surface that shows how to do an exercise (detail page, live "Up next" sheet, pre-session sheet):
// summary, numbered steps, cues, good-to-know and the media gallery, from the merged built-in + athlete/coach content.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { detectMedia, type MediaInfo } from '../../shared/content';
import type { Exercise, MediaItem } from '../../shared/types';
import { isEmptyContent } from '../../shared/content';
import { useExerciseContent } from '../store/x-content';
import { useDialog } from './Dialog';

const mediaName = (m: MediaItem, info: MediaInfo | null, fallback: string) => m.caption || m.title || (info ? new URL(info.url).hostname.replace(/^www\./, '') : fallback);

function Lightbox({ item, alt, onClose }: { item: MediaItem; alt: string; onClose: () => void }) {
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: '.lb-close' });
  return createPortal(
    <div className="lb" role="dialog" aria-modal="true" aria-label={alt} ref={ref} data-testid="lightbox" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button type="button" className="lb-close" aria-label="Close image" onClick={onClose}><span className="ic ic-x lg" aria-hidden="true" /></button>
      <figure className="lb-fig">
        <img src={item.url} alt={alt} decoding="async" />
        {(item.caption || item.title) && <figcaption>{item.caption || item.title}{item.source ? <span className="lb-src"> · {item.source}</span> : null}</figcaption>}
      </figure>
    </div>,
    document.body,
  );
}

function ImageTile({ item, name }: { item: MediaItem; name: string }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const alt = item.caption || item.title || `${name} image`;
  return (
    <figure className="gm gm-img">
      {broken ? (
        <a className="gm-broken" href={item.url} target="_blank" rel="noopener noreferrer"><span className="ic ic-image" aria-hidden="true" /><span>Image not available right now. Open link</span></a>
      ) : (
        <button type="button" className="gm-thumb" aria-label={`Enlarge: ${alt}`} onClick={() => setOpen(true)}>
          <img src={item.url} alt={alt} loading="lazy" decoding="async" width={400} height={300} onError={() => setBroken(true)} />
        </button>
      )}
      {(item.caption || item.title) && <figcaption>{item.caption || item.title}</figcaption>}
      {open && <Lightbox item={item} alt={alt} onClose={() => setOpen(false)} />}
    </figure>
  );
}

function VideoTile({ item, info, name }: { item: MediaItem; info: MediaInfo; name: string }) {
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(false);
  const label = item.title || item.caption || `${name} video`;
  const poster = info.provider === 'youtube' ? `https://i.ytimg.com/vi/${new URL(info.embedUrl!).pathname.split('/').pop()}/hqdefault.jpg` : '';
  const host = info.provider === 'youtube' ? 'YouTube' : info.provider === 'vimeo' ? 'Vimeo' : '';
  let body: React.ReactNode;
  if (info.provider === 'file') {
    body = broken
      ? <a className="gm-broken" href={info.url} target="_blank" rel="noopener noreferrer"><span className="ic ic-play" aria-hidden="true" /><span>Video not available right now. Open link</span></a>
      : <video className="gm-video" src={info.url} controls playsInline preload="metadata" aria-label={label} onError={() => setBroken(true)} />;
  } else if (info.provider === 'link') {
    body = (
      <a className="gm-link" href={info.url} target="_blank" rel="noopener noreferrer">
        <span className="ic ic-link" aria-hidden="true" />
        <span className="grow"><span className="li-t">{item.title || mediaName(item, info, 'Link')}</span><span className="li-s">{new URL(info.url).hostname.replace(/^www\./, '')} · opens in a new tab</span></span>
        <span className="ic ic-ext sm" aria-hidden="true" />
      </a>
    );
  } else if (!playing) {
    // facade: nothing from YouTube/Vimeo is requested until the athlete asks for it
    body = (
      <button type="button" className="vfacade" style={poster ? { backgroundImage: `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)), url(${poster})` } : undefined} onClick={() => setPlaying(true)} aria-label={`Play video: ${label}`}>
        <span className="vplay"><span className="ic ic-play lg" aria-hidden="true" /></span>
        <span className="vtitle">{label}</span>
        <span className="vhint">Tap to play</span>
      </button>
    );
  } else {
    body = (
      <div className="vframe">
        <iframe
          src={`${info.embedUrl}${info.embedUrl!.includes('?') ? '&' : '?'}autoplay=1&playsinline=1`} title={label} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          allow="encrypted-media; picture-in-picture; fullscreen; autoplay"
        />
      </div>
    );
  }
  return (
    <figure className="gm gm-video-wrap" data-provider={info.provider}>
      {body}
      {(item.caption || (item.title && info.provider === 'file')) && <figcaption>{item.caption || item.title}</figcaption>}
      {playing && (info.provider === 'youtube' || info.provider === 'vimeo') && <a className="link small gm-open" href={info.url} target="_blank" rel="noopener noreferrer">Open on {host}</a>}
    </figure>
  );
}

export function MediaGallery({ items, name }: { items: MediaItem[]; name: string }) {
  const rows = items.map((m) => ({ m, info: detectMedia(m.url, m.kind) })).filter((x): x is { m: MediaItem; info: MediaInfo } => !!x.info);
  if (!rows.length) return null;
  return (
    <div className="gallery" data-testid="media-gallery">
      {rows.map(({ m, info }) => (info.kind === 'image' ? <ImageTile key={m.id} item={m} name={name} /> : <VideoTile key={m.id} item={m} info={info} name={name} />))}
    </div>
  );
}

/** The guide body. `showEdit` adds an "Edit how-to" link (off during a live session so a tap can never leave the workout). */
export function ExerciseGuide({ ex, showEdit = true }: { ex: Exercise; showEdit?: boolean }) {
  const { merged, userContent } = useExerciseContent(ex);
  const empty = isEmptyContent(merged);
  return (
    <div className="guide" data-testid="exercise-guide" data-custom={userContent ? '1' : '0'}>
      {empty && <p className="sub">No how-to for this exercise yet. Add your own notes and links, or ask your coach AI to write the most important parts for you.</p>}
      {merged.summary && <p className="guide-summary">{merged.summary}</p>}
      {merged.media.length > 0 && (
        <section aria-labelledby={`g-media-${ex.id}`}>
          <h3 className="guide-h" id={`g-media-${ex.id}`}>Watch it done</h3>
          <MediaGallery items={merged.media} name={ex.name} />
        </section>
      )}
      {merged.steps.length > 0 && (
        <section aria-labelledby={`g-steps-${ex.id}`}>
          <h3 className="guide-h" id={`g-steps-${ex.id}`}>Steps</h3>
          <ol className="guide-steps">{merged.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </section>
      )}
      {merged.cues.length > 0 && (
        <section aria-labelledby={`g-cues-${ex.id}`}>
          <h3 className="guide-h" id={`g-cues-${ex.id}`}>Think about</h3>
          <ul className="guide-cues">{merged.cues.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </section>
      )}
      {merged.goodToKnow.length > 0 && (
        <section aria-labelledby={`g-tips-${ex.id}`}>
          <h3 className="guide-h" id={`g-tips-${ex.id}`}>Good to know</h3>
          <ul className="guide-tips">{merged.goodToKnow.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </section>
      )}
      <div className="guide-actions">
        {showEdit && <Link className="btn btn-secondary btn-sm" to={`/exercise/${ex.id}/edit#how-to`}><span className="ic ic-edit sm" aria-hidden="true" />Edit how-to</Link>}
      </div>
    </div>
  );
}

/** Bottom sheet with the guide. Render inside `.app` (like PauseSheet). Escape, the scrim, and the close button all close it. */
export function GuideSheet({ ex, onClose, showEdit = true }: { ex: Exercise; onClose: () => void; showEdit?: boolean }) {
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: '.guide-close' });
  return (
    <>
      <button type="button" className="scrim" tabIndex={-1} aria-label="Close how-to" onClick={onClose} />
      <div className="sheet guide-sheet" role="dialog" aria-modal="true" aria-label={`How to do ${ex.name}`} ref={ref} data-testid="guide-sheet">
        <div className="grabber" />
        <div className="between">
          <div className="stack-s" style={{ gap: 2, minWidth: 0 }}><span className="eyebrow">How to do it</span><h2 className="t-h">{ex.name}</h2></div>
          <button type="button" className="iconbtn guide-close" aria-label="Close how-to" onClick={onClose} style={{ marginRight: -10 }}><span className="ic ic-x" aria-hidden="true" /></button>
        </div>
        <ExerciseGuide ex={ex} showEdit={showEdit} />
      </div>
    </>
  );
}
