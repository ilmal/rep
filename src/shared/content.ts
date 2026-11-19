// Exercise how-to content: limits, strict media URL handling, sanitising, and the merged view.
// Pure (no DOM, no I/O) so the client, the sync API and the MCP server share one definition (and it is mutation-testable).
import type { Exercise, ExerciseContent, ExercisePref, MediaItem, MediaKind } from './types';
import { BUILTIN_CONTENT } from './exercise-content';

export const LIMITS = {
  summary: 600,
  stepCount: 12, step: 400,
  cueCount: 10, cue: 200,
  tipCount: 12, tip: 400,
  mediaCount: 12, url: 2000, title: 120, caption: 300, source: 120, id: 40,
} as const;

export type ListField = 'steps' | 'cues' | 'goodToKnow';
export type ContentField = 'summary' | ListField | 'media';
export const CONTENT_FIELDS: ContentField[] = ['summary', 'steps', 'cues', 'goodToKnow', 'media'];
const LIST_LIMITS: Record<ListField, { count: number; len: number }> = {
  steps: { count: LIMITS.stepCount, len: LIMITS.step },
  cues: { count: LIMITS.cueCount, len: LIMITS.cue },
  goodToKnow: { count: LIMITS.tipCount, len: LIMITS.tip },
};

// ───────────── media URLs ─────────────
export type MediaProvider = 'file' | 'youtube' | 'vimeo' | 'link';
export interface MediaInfo {
  kind: MediaKind;
  provider: MediaProvider;
  /** normalised https URL */
  url: string;
  /** privacy-respecting iframe src (youtube-nocookie / player.vimeo.com), only for youtube/vimeo */
  embedUrl?: string;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** Seconds from `t=90`, `t=1m30s`, `start=90`; 0 when absent/invalid. */
export function parseStartSeconds(v: string | null): number {
  if (!v) return 0;
  if (/^\d{1,6}$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || !(m[1] || m[2] || m[3])) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'youtu.be') id = parts[0];
  else if (host === 'www.youtube-nocookie.com' || host === 'youtube-nocookie.com') id = parts[0] === 'embed' ? parts[1] : undefined;
  else if (YT_HOSTS.has(host)) {
    if (parts[0] === 'watch') id = u.searchParams.get('v') ?? undefined;
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') id = parts[1];
  }
  return id && YT_ID.test(id) ? id : null;
}

function vimeoRef(u: URL): { id: string; hash?: string } | null {
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'player.vimeo.com') {
    if (parts[0] !== 'video' || !/^\d{1,12}$/.test(parts[1] ?? '')) return null;
    const h = u.searchParams.get('h');
    return { id: parts[1], hash: h && /^[A-Za-z0-9]{6,20}$/.test(h) ? h : undefined };
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    if (!/^\d{1,12}$/.test(parts[0] ?? '')) return null;
    const h = parts[1] && /^[A-Za-z0-9]{6,20}$/.test(parts[1]) ? parts[1] : undefined;
    return { id: parts[0], hash: h };
  }
  return null;
}

/**
 * Classify a media URL. Returns null for anything that is not an absolute https URL (http:, javascript:, data:, blob:,
 * relative, credentials in the URL, over-long). A recognised provider (YouTube, Vimeo) or file extension decides the kind;
 * `hint` only decides for URLs whose type cannot be read from the address ("image" = show it as an <img>).
 */
export function detectMedia(raw: unknown, hint?: MediaKind): MediaInfo | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > LIMITS.url || /[\u0000-\u001f\u007f\s]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
  const url = u.toString();

  const yt = youtubeId(u);
  if (yt) {
    const start = parseStartSeconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
    return { kind: 'video', provider: 'youtube', url, embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?rel=0${start ? `&start=${start}` : ''}` };
  }
  const vm = vimeoRef(u);
  if (vm) return { kind: 'video', provider: 'vimeo', url, embedUrl: `https://player.vimeo.com/video/${vm.id}?dnt=1${vm.hash ? `&h=${vm.hash}` : ''}` };

  const path = u.pathname;
  if (IMAGE_EXT.test(path)) return { kind: 'image', provider: 'file', url };
  if (VIDEO_EXT.test(path)) return { kind: 'video', provider: 'file', url };
  if (hint === 'image') return { kind: 'image', provider: 'file', url };
  return { kind: 'video', provider: 'link', url };
}

/** YouTube search for an exercise's form: the only third-party URL the app generates itself, and only when the user taps it. */
export const youtubeSearchUrl = (name: string): string => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name.trim()} form`)}`;

let mediaSeq = 0;
export const newMediaId = (): string => `m_${Date.now().toString(36)}${(mediaSeq++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ───────────── sanitising / validating ─────────────
const clipStr = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\r\n?/g, '\n').trim();
  return t ? t.slice(0, max) : undefined;
};
const cleanList = (v: unknown, f: ListField): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const { count, len } = LIST_LIMITS[f];
  const out = v.map((x) => clipStr(x, len)).filter((x): x is string => !!x).slice(0, count);
  return out.length ? out : undefined;
};

/** One media item or null when it is unusable (bad URL). Kind is re-derived from the URL when `kind` is missing/invalid. */
export function cleanMediaItem(v: unknown): MediaItem | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const hint = o.kind === 'image' || o.kind === 'video' ? o.kind : undefined;
  const info = detectMedia(o.url, hint);
  if (!info) return null;
  const id = clipStr(o.id, LIMITS.id) ?? newMediaId();
  const item: MediaItem = { id, kind: info.kind, url: info.url };
  const title = clipStr(o.title, LIMITS.title); if (title) item.title = title;
  const caption = clipStr(o.caption, LIMITS.caption); if (caption) item.caption = caption;
  const source = clipStr(o.source, LIMITS.source); if (source) item.source = source;
  return item;
}

function cleanMedia(v: unknown): MediaItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const x of v) {
    const m = cleanMediaItem(x);
    if (!m) continue;
    while (seen.has(m.id)) m.id = newMediaId();
    seen.add(m.id);
    out.push(m);
    if (out.length >= LIMITS.mediaCount) break;
  }
  return out.length ? out : undefined;
}

/**
 * Lenient sanitiser for data that already exists somewhere (IndexedDB, sync pull, sync push): never throws, drops unusable
 * parts, clips over-long text and over-long lists. Returns undefined when nothing usable is left. Unknown keys are dropped.
 */
export function sanitizeContent(v: unknown): ExerciseContent | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: ExerciseContent = {};
  const summary = clipStr(o.summary, LIMITS.summary); if (summary) out.summary = summary;
  const steps = cleanList(o.steps, 'steps'); if (steps) out.steps = steps;
  const cues = cleanList(o.cues, 'cues'); if (cues) out.cues = cues;
  const tips = cleanList(o.goodToKnow, 'goodToKnow'); if (tips) out.goodToKnow = tips;
  const media = cleanMedia(o.media); if (media) out.media = media;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Strict validation for a write coming from an AI/API client: throws `Error(message)` naming the offending field instead of
 * silently clipping. Returns a clean content object (fields that are absent in `v` stay absent; an empty value clears nothing here:
 * callers decide merge vs replace). `null` for a field means "clear this field".
 */
export function validateContentPatch(v: Record<string, unknown>): { [K in ContentField]?: ExerciseContent[K] | null } {
  const out: { [K in ContentField]?: ExerciseContent[K] | null } = {};
  if (v.summary !== undefined) {
    if (v.summary === null) out.summary = null;
    else {
      if (typeof v.summary !== 'string') throw new Error('summary must be a string.');
      if (v.summary.trim().length > LIMITS.summary) throw new Error(`summary is too long (max ${LIMITS.summary} characters).`);
      out.summary = v.summary.trim() || null;
    }
  }
  for (const f of ['steps', 'cues', 'goodToKnow'] as ListField[]) {
    const val = v[f];
    if (val === undefined) continue;
    if (val === null) { out[f] = null; continue; }
    if (!Array.isArray(val)) throw new Error(`${f} must be an array of strings.`);
    const { count, len } = LIST_LIMITS[f];
    if (val.length > count) throw new Error(`${f} has too many items (max ${count}).`);
    const items: string[] = [];
    val.forEach((x, i) => {
      if (typeof x !== 'string') throw new Error(`${f}[${i}] must be a string.`);
      const t = x.trim();
      if (t.length > len) throw new Error(`${f}[${i}] is too long (max ${len} characters).`);
      if (t) items.push(t);
    });
    out[f] = items.length ? items : null;
  }
  if (v.media !== undefined) {
    if (v.media === null) out.media = null;
    else {
      if (!Array.isArray(v.media)) throw new Error('media must be an array.');
      if (v.media.length > LIMITS.mediaCount) throw new Error(`media has too many items (max ${LIMITS.mediaCount}).`);
      const items = v.media.map((m, i) => validateMediaInput(m, `media[${i}]`));
      out.media = items.length ? items : null;
    }
  }
  return out;
}

/** Strict single media input: https URL required, text fields length-checked. Kind is auto-detected unless given. */
export function validateMediaInput(v: unknown, label = 'media'): MediaItem {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label} must be an object with a url.`);
  const o = v as Record<string, unknown>;
  if (o.kind !== undefined && o.kind !== 'image' && o.kind !== 'video') throw new Error(`${label}.kind must be "image" or "video".`);
  const info = detectMedia(o.url, o.kind as MediaKind | undefined);
  if (!info) throw new Error(`${label}.url must be a public https:// URL (http, javascript:, data: and relative URLs are not allowed; max ${LIMITS.url} characters).`);
  for (const [k, max] of [['title', LIMITS.title], ['caption', LIMITS.caption], ['source', LIMITS.source], ['id', LIMITS.id]] as const) {
    const x = o[k];
    if (x !== undefined && x !== null && (typeof x !== 'string' || x.trim().length > max)) throw new Error(`${label}.${k} must be a string of at most ${max} characters.`);
  }
  const item = cleanMediaItem({ ...o, kind: info.kind, url: info.url });
  return item!;
}

// ───────────── merged view ─────────────
/** Built-in defaults for an exercise: the shipped content, plus a custom exercise's legacy one-line `cue` as steps when it has no steps. */
export function defaultContent(ex: Pick<Exercise, 'id' | 'cue'>): ExerciseContent {
  const base = BUILTIN_CONTENT[ex.id];
  if (base) return base;
  const lines = (ex.cue ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? { steps: lines } : {};
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : false);

/** Which fields the athlete/coach has customised (non-empty override present). */
export function customisedFields(pref?: Pick<ExercisePref, 'content'> | null): ContentField[] {
  const c = pref?.content;
  return c ? CONTENT_FIELDS.filter((f) => has(c[f])) : [];
}
export const hasUserContent = (pref?: Pick<ExercisePref, 'content'> | null): boolean => customisedFields(pref).length > 0;
/** True when the override adds something worth flagging in lists: any media, or any customised text. */
export const hasUserMedia = (pref?: Pick<ExercisePref, 'content'> | null): boolean => has(pref?.content?.media);

/** Per field, the user's override wins over the built-in default. Always returns arrays/strings (possibly empty). */
export interface MergedContent { summary: string; steps: string[]; cues: string[]; goodToKnow: string[]; media: MediaItem[] }
export function contentFor(ex: Pick<Exercise, 'id' | 'cue'>, pref?: Pick<ExercisePref, 'content'> | null): MergedContent {
  const d = defaultContent(ex);
  const u = pref?.content;
  return {
    summary: has(u?.summary) ? u!.summary! : d.summary ?? '',
    steps: has(u?.steps) ? u!.steps! : d.steps ?? [],
    cues: has(u?.cues) ? u!.cues! : d.cues ?? [],
    goodToKnow: has(u?.goodToKnow) ? u!.goodToKnow! : d.goodToKnow ?? [],
    media: has(u?.media) ? u!.media! : d.media ?? [],
  };
}
export const isEmptyContent = (c: MergedContent): boolean => !c.summary && !c.steps.length && !c.cues.length && !c.goodToKnow.length && !c.media.length;

/**
 * Apply a validated patch to an override. `replace`: a given field replaces the stored one (null clears it).
 * `merge`: list fields are appended to the stored override (a field with no override yet starts from the built-in default, so
 * "add a tip" does not discard the shipped ones), media is appended; `summary` always replaces. Returns undefined when nothing is left.
 */
export function applyContentPatch(
  ex: Pick<Exercise, 'id' | 'cue'>,
  current: ExerciseContent | undefined,
  patch: { [K in ContentField]?: ExerciseContent[K] | null },
  mode: 'merge' | 'replace',
): ExerciseContent | undefined {
  const next: ExerciseContent = { ...(current ?? {}) };
  const dflt = defaultContent(ex);
  const set = <K extends ContentField>(k: K, v: ExerciseContent[K] | undefined) => { if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v; };
  for (const f of CONTENT_FIELDS) {
    const p = patch[f];
    if (p === undefined) continue;
    if (p === null) { delete next[f]; continue; }
    if (f === 'summary') { set('summary', p as string); continue; }
    if (mode === 'replace') { set(f, p as never); continue; }
    if (f === 'media') {
      const ids = new Set((current?.media ?? []).map((m) => m.id));
      const add = (p as MediaItem[]).map((m) => (ids.has(m.id) ? { ...m, id: newMediaId() } : m));
      set('media', [...(current?.media ?? []), ...add].slice(0, LIMITS.mediaCount));
    } else {
      const base = (current?.[f] && current[f]!.length ? current[f]! : dflt[f] ?? []) as string[];
      set(f, [...base, ...(p as string[]).filter((x) => !base.includes(x))].slice(0, LIST_LIMITS[f].count) as never);
    }
  }
  return Object.keys(next).length ? next : undefined;
}

/** Remove the given fields from an override (all of them when `fields` is omitted). */
export function resetContentFields(current: ExerciseContent | undefined, fields?: ContentField[]): ExerciseContent | undefined {
  if (!current || !fields) return undefined;
  const next = { ...current };
  for (const f of fields) delete next[f];
  return Object.keys(next).length ? next : undefined;
}
