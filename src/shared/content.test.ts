import { describe, expect, test } from 'bun:test';
import {
  LIMITS, applyContentPatch, cleanMediaItem, newMediaId, contentFor, customisedFields, defaultContent, detectMedia, hasUserContent, hasUserMedia, isEmptyContent, parseStartSeconds,
  resetContentFields, sanitizeContent, validateContentPatch, validateMediaInput, youtubeSearchUrl,
} from './content';
import type { ExerciseContent } from './types';

const YT = 'dQw4w9WgXcQ';
describe('detectMedia', () => {
  test('YouTube forms map to the nocookie embed', () => {
    for (const u of [`https://www.youtube.com/watch?v=${YT}`, `https://youtube.com/watch?v=${YT}&feature=share`, `https://m.youtube.com/watch?v=${YT}`, `https://youtu.be/${YT}`, `https://youtu.be/${YT}?si=abc`, `https://www.youtube.com/shorts/${YT}`, `https://www.youtube.com/embed/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`, `https://www.youtube.com/live/${YT}`]) {
      const m = detectMedia(u);
      expect(m, u).toMatchObject({ kind: 'video', provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${YT}?rel=0` });
    }
  });
  test('YouTube start time', () => {
    expect(detectMedia(`https://youtu.be/${YT}?t=90`)!.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${YT}?rel=0&start=90`);
    expect(detectMedia(`https://www.youtube.com/watch?v=${YT}&t=1m30s`)!.embedUrl).toContain('&start=90');
    expect(parseStartSeconds('1h2m3s')).toBe(3723);
    expect(parseStartSeconds('')).toBe(0);
    expect(parseStartSeconds('abc')).toBe(0);
    expect(parseStartSeconds('s')).toBe(0);
    expect(parseStartSeconds(null)).toBe(0);
  });
  test('bad YouTube ids / look-alike hosts are NOT embedded', () => {
    expect(detectMedia('https://www.youtube.com/watch?v=short')).toMatchObject({ provider: 'link' });
    expect(detectMedia(`https://www.youtube.com.evil.com/watch?v=${YT}`)).toMatchObject({ provider: 'link' });
    expect(detectMedia(`https://evilyoutube.com/watch?v=${YT}`)).toMatchObject({ provider: 'link' });
    expect(detectMedia(`https://www.youtube.com/playlist?list=${YT}`)).toMatchObject({ provider: 'link' });
    expect(detectMedia(`https://youtu.be/`)).toMatchObject({ provider: 'link' });
  });
  test('Vimeo', () => {
    expect(detectMedia('https://vimeo.com/123456789')).toMatchObject({ kind: 'video', provider: 'vimeo', embedUrl: 'https://player.vimeo.com/video/123456789?dnt=1' });
    expect(detectMedia('https://player.vimeo.com/video/123456789?h=abcdef1234')!.embedUrl).toBe('https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234');
    expect(detectMedia('https://vimeo.com/123456789/abcdef1234')!.embedUrl).toBe('https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234');
    expect(detectMedia('https://vimeo.com/channels/staffpicks')).toMatchObject({ provider: 'link' });
    expect(detectMedia('https://player.vimeo.com/video/abc')).toMatchObject({ provider: 'link' });
    expect(detectMedia('https://player.vimeo.com/other/123')).toMatchObject({ provider: 'link' });
  });
  test('direct files', () => {
    expect(detectMedia('https://cdn.example.com/a/squat.mp4')).toMatchObject({ kind: 'video', provider: 'file' });
    expect(detectMedia('https://cdn.example.com/a/squat.WEBM?x=1')).toMatchObject({ kind: 'video', provider: 'file' });
    expect(detectMedia('https://cdn.example.com/squat.mov')).toMatchObject({ kind: 'video', provider: 'file' });
    expect(detectMedia('https://cdn.example.com/squat.jpg')).toMatchObject({ kind: 'image', provider: 'file' });
    expect(detectMedia('https://cdn.example.com/squat.webp#frag')).toMatchObject({ kind: 'image', provider: 'file' });
    expect(detectMedia('https://cdn.example.com/squat.png?v=2')).toMatchObject({ kind: 'image' });
    expect(detectMedia('https://cdn.example.com/squat.svg')).toMatchObject({ kind: 'image' });
  });
  test('hint decides extension-less URLs; providers win over the hint', () => {
    expect(detectMedia('https://images.example.com/photo/123', 'image')).toMatchObject({ kind: 'image', provider: 'file' });
    expect(detectMedia('https://example.com/watch/123', 'video')).toMatchObject({ kind: 'video', provider: 'link' });
    expect(detectMedia('https://example.com/watch/123')).toMatchObject({ kind: 'video', provider: 'link' });
    expect(detectMedia(`https://youtu.be/${YT}`, 'image')).toMatchObject({ kind: 'video', provider: 'youtube' });
    expect(detectMedia('https://example.com/clip.mp4', 'video')).toMatchObject({ kind: 'video', provider: 'file' });
    expect(detectMedia('https://example.com/pic.jpg', 'video')).toMatchObject({ kind: 'image', provider: 'file' });
    expect(detectMedia('https://example.com/clip.mp4', 'image')).toMatchObject({ kind: 'video', provider: 'file' });
  });
  test('rejects everything that is not a clean absolute https URL', () => {
    for (const bad of [
      'http://example.com/a.jpg', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/png;base64,AAAA', 'blob:https://x.com/1', 'file:///etc/passwd', 'ftp://x.com/a.mp4',
      '//example.com/a.jpg', '/a.jpg', 'example.com/a.jpg', 'https://user:pw@example.com/a.jpg', 'https://user@example.com/a.jpg', 'https://localhost/a.jpg', 'https://example.com/a b.jpg',
      'https://example.com/a\n.jpg', '', '   ', 'https://', `https://example.com/${'a'.repeat(LIMITS.url)}`,
    ]) expect(detectMedia(bad), JSON.stringify(bad)).toBeNull();
    for (const bad of [null, undefined, 5, {}, []]) expect(detectMedia(bad)).toBeNull();
  });
  test('trims, normalises and accepts the length limit exactly', () => {
    expect(detectMedia('  https://example.com/a.jpg  ')!.url).toBe('https://example.com/a.jpg');
    const url = 'https://example.com/' + 'a'.repeat(LIMITS.url - 'https://example.com/.jpg'.length) + '.jpg';
    expect(url.length).toBe(LIMITS.url);
    expect(detectMedia(url)).not.toBeNull();
    expect(detectMedia(url + 'x')).toBeNull();
  });
});

describe('youtubeSearchUrl', () => {
  test('searches "<name> form" and encodes it', () => {
    expect(youtubeSearchUrl('Back squat')).toBe('https://www.youtube.com/results?search_query=Back%20squat%20form');
    expect(youtubeSearchUrl('  A&B=c  ')).toBe('https://www.youtube.com/results?search_query=A%26B%3Dc%20form');
  });
});

describe('sanitizeContent (lenient)', () => {
  test('garbage in, undefined out', () => {
    for (const v of [null, undefined, 5, 'x', [], {}, { steps: 'nope' }, { media: 7 }, { steps: [1, null, '  '] }, { media: [{ url: 'javascript:1' }] }]) expect(sanitizeContent(v)).toBeUndefined();
  });
  test('keeps good parts, drops bad ones, trims, clips, drops unknown keys', () => {
    const c = sanitizeContent({
      summary: '  Hi  ', steps: ['a', '', '  b  ', 3], cues: ['x'.repeat(LIMITS.cue + 50)], goodToKnow: Array.from({ length: 30 }, (_, i) => `t${i}`), evil: 1,
      media: [{ id: 'm1', kind: 'image', url: 'https://e.com/a.jpg', title: 'T', caption: 'C', source: 'S', extra: 1 }, { url: 'http://e.com/b.jpg' }, 5],
    })!;
    expect(c.summary).toBe('Hi');
    expect(c.steps).toEqual(['a', 'b']);
    expect(c.cues![0].length).toBe(LIMITS.cue);
    expect(c.goodToKnow!.length).toBe(LIMITS.tipCount);
    expect(c.media).toEqual([{ id: 'm1', kind: 'image', url: 'https://e.com/a.jpg', title: 'T', caption: 'C', source: 'S' }]);
    expect('evil' in c).toBe(false);
  });
  test('caps counts and clips text at exact limits', () => {
    const c = sanitizeContent({ summary: 's'.repeat(LIMITS.summary + 1), steps: Array.from({ length: 20 }, () => 'a'.repeat(LIMITS.step + 1)), cues: Array.from({ length: 20 }, () => 'q'), media: Array.from({ length: 20 }, (_, i) => ({ url: `https://e.com/${i}.jpg` })) })!;
    expect(c.summary!.length).toBe(LIMITS.summary);
    expect(c.steps!.length).toBe(LIMITS.stepCount);
    expect(c.steps![0].length).toBe(LIMITS.step);
    expect(c.cues!.length).toBe(LIMITS.cueCount);
    expect(c.media!.length).toBe(LIMITS.mediaCount);
  });
  test('media ids are filled in and made unique; kind re-derived from the URL', () => {
    const c = sanitizeContent({ media: [{ url: 'https://e.com/a.mp4', kind: 'image', id: 'same' }, { url: 'https://e.com/b.jpg', id: 'same' }, { url: 'https://e.com/c.jpg', kind: 'bogus' }] })!;
    const ids = c.media!.map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((i) => i.length > 0 && i.length <= LIMITS.id)).toBe(true);
    expect(c.media![0].kind).toBe('video'); // the .mp4 extension beats a wrong "image" kind
    expect(c.media![2].kind).toBe('image');
    expect(cleanMediaItem({ url: 'https://e.com/c.jpg', id: 'x'.repeat(100) })!.id.length).toBe(LIMITS.id);
  });
});

describe('validateContentPatch / validateMediaInput (strict)', () => {
  test('accepts a valid patch; null clears; empty list clears', () => {
    expect(validateContentPatch({ summary: ' s ', steps: [' a ', 'b'], cues: [], goodToKnow: null, media: [{ url: 'https://e.com/a.jpg', caption: 'c' }] })).toMatchObject({ summary: 's', steps: ['a', 'b'], cues: null, goodToKnow: null });
    expect(validateContentPatch({ summary: null }).summary).toBeNull();
    expect(validateContentPatch({ summary: '   ' }).summary).toBeNull();
    expect(validateContentPatch({})).toEqual({});
    expect(validateContentPatch({ media: [] }).media).toBeNull();
  });
  test('errors name the field', () => {
    const msg = (v: Record<string, unknown>) => { try { validateContentPatch(v); return ''; } catch (e) { return (e as Error).message; } };
    expect(msg({ summary: 5 })).toMatch(/summary must be a string/);
    expect(msg({ summary: 'x'.repeat(LIMITS.summary + 1) })).toMatch(/summary is too long \(max 600/);
    expect(msg({ summary: 'x'.repeat(LIMITS.summary) })).toBe('');
    expect(msg({ steps: 'a' })).toMatch(/steps must be an array/);
    expect(msg({ steps: Array.from({ length: LIMITS.stepCount + 1 }, () => 'a') })).toMatch(/steps has too many items \(max 12/);
    expect(msg({ steps: Array.from({ length: LIMITS.stepCount }, () => 'a') })).toBe('');
    expect(msg({ cues: ['ok', 3] })).toMatch(/cues\[1\] must be a string/);
    expect(msg({ goodToKnow: ['x'.repeat(LIMITS.tip + 1)] })).toMatch(/goodToKnow\[0\] is too long \(max 400/);
    expect(msg({ media: 'x' })).toMatch(/media must be an array/);
    expect(msg({ media: Array.from({ length: LIMITS.mediaCount + 1 }, () => ({ url: 'https://e.com/a.jpg' })) })).toMatch(/too many items \(max 12/);
    expect(msg({ media: [{ url: 'javascript:alert(1)' }] })).toMatch(/media\[0\]\.url must be a public https/);
    expect(msg({ media: [{ url: 'http://e.com/a.jpg' }] })).toMatch(/https/);
    expect(msg({ media: [{ url: 'https://e.com/a.jpg', kind: 'gif' }] })).toMatch(/kind must be/);
    expect(msg({ media: [{ url: 'https://e.com/a.jpg', caption: 'c'.repeat(LIMITS.caption + 1) }] })).toMatch(/caption must be a string of at most 300/);
    expect(msg({ media: [{ url: 'https://e.com/a.jpg', title: 5 }] })).toMatch(/title/);
    expect(msg({ media: [5] })).toMatch(/media\[0\] must be an object/);
  });
  test('validateMediaInput returns a normalised item with an id', () => {
    const m = validateMediaInput({ url: 'https://youtu.be/' + YT, title: ' T ' });
    expect(m).toMatchObject({ kind: 'video', url: `https://youtu.be/${YT}`, title: 'T' });
    expect(m.id).toBeTruthy();
    expect(validateMediaInput({ url: 'https://e.com/x', kind: 'image' }).kind).toBe('image');
    expect(() => validateMediaInput(null)).toThrow();
    expect(() => validateMediaInput([])).toThrow();
  });
});

describe('contentFor (merge)', () => {
  const ex = { id: 'back_squat' };
  const built = contentFor(ex, null);
  test('no override = built-in', () => {
    expect(built.steps.length).toBeGreaterThan(0);
    expect(contentFor(ex, {})).toEqual(built);
    expect(contentFor(ex, { content: {} })).toEqual(built);
  });
  test('per field: the override wins, other fields keep the default', () => {
    const m = contentFor(ex, { content: { steps: ['mine'], media: [{ id: '1', kind: 'image', url: 'https://e.com/a.jpg' }] } });
    expect(m.steps).toEqual(['mine']);
    expect(m.cues).toEqual(built.cues);
    expect(m.summary).toBe(built.summary);
    expect(m.goodToKnow).toEqual(built.goodToKnow);
    expect(m.media).toHaveLength(1);
    expect(contentFor(ex, { content: { summary: 'S' } }).summary).toBe('S');
    expect(contentFor(ex, { content: { cues: ['c'] } }).cues).toEqual(['c']);
    expect(contentFor(ex, { content: { goodToKnow: ['g'] } }).goodToKnow).toEqual(['g']);
  });
  test('blank/empty overrides do not hide defaults', () => {
    const m = contentFor(ex, { content: { summary: '   ', steps: [], cues: [], goodToKnow: [], media: [] } });
    expect(m).toEqual(built);
  });
  test('custom exercise: nothing by default, legacy cue becomes steps', () => {
    expect(isEmptyContent(contentFor({ id: 'c_1' }, null))).toBe(true);
    expect(contentFor({ id: 'c_1', cue: 'Do a\n\nthen b' }, null).steps).toEqual(['Do a', 'then b']);
    expect(contentFor({ id: 'c_1', cue: 'Do a' }, { content: { steps: ['x'] } }).steps).toEqual(['x']);
    expect(defaultContent({ id: 'c_1', cue: '  ' })).toEqual({});
    expect(isEmptyContent(contentFor({ id: 'c_1' }, { content: { summary: 'x' } }))).toBe(false);
  });
  test('flags', () => {
    expect(customisedFields(undefined)).toEqual([]);
    expect(customisedFields({ content: { steps: ['a'], summary: ' ', media: [{ id: '1', kind: 'image', url: 'https://e.com/a.jpg' }] } })).toEqual(['steps', 'media']);
    expect(hasUserContent({ content: { cues: ['a'] } })).toBe(true);
    expect(hasUserContent({ content: {} })).toBe(false);
    expect(hasUserContent(null)).toBe(false);
    expect(hasUserMedia({ content: { cues: ['a'] } })).toBe(false);
    expect(hasUserMedia({ content: { media: [{ id: '1', kind: 'image', url: 'https://e.com/a.jpg' }] } })).toBe(true);
  });
});

describe('applyContentPatch / resetContentFields', () => {
  const ex = { id: 'back_squat' };
  const dflt = defaultContent(ex);
  const img = (id: string, u = `https://e.com/${id}.jpg`) => ({ id, kind: 'image' as const, url: u });
  test('replace sets, replaces and clears fields; returns undefined when empty', () => {
    let c = applyContentPatch(ex, undefined, { steps: ['a', 'b'], summary: 'S' }, 'replace');
    expect(c).toEqual({ steps: ['a', 'b'], summary: 'S' });
    c = applyContentPatch(ex, c, { steps: ['z'] }, 'replace');
    expect(c).toEqual({ steps: ['z'], summary: 'S' });
    c = applyContentPatch(ex, c, { steps: null }, 'replace');
    expect(c).toEqual({ summary: 'S' });
    expect(applyContentPatch(ex, c, { summary: null }, 'replace')).toBeUndefined();
    expect(applyContentPatch(ex, undefined, {}, 'replace')).toBeUndefined();
    expect(applyContentPatch(ex, undefined, { cues: [] }, 'replace')).toBeUndefined();
  });
  test('merge appends to the existing override, or to the default when none; summary replaces', () => {
    const c1 = applyContentPatch(ex, undefined, { goodToKnow: ['new tip'], summary: 'S' }, 'merge')!;
    expect(c1.goodToKnow).toEqual([...dflt.goodToKnow!, 'new tip']);
    expect(c1.summary).toBe('S');
    const c2 = applyContentPatch(ex, c1, { goodToKnow: ['new tip', 'another'] }, 'merge')!;
    expect(c2.goodToKnow).toEqual([...dflt.goodToKnow!, 'new tip', 'another']);
    const c3 = applyContentPatch(ex, { steps: ['mine'] }, { steps: ['more'] }, 'merge')!;
    expect(c3.steps).toEqual(['mine', 'more']);
    const capped = applyContentPatch(ex, { cues: Array.from({ length: 9 }, (_, i) => `c${i}`) }, { cues: ['x', 'y', 'z'] }, 'merge')!;
    expect(capped.cues!.length).toBe(LIMITS.cueCount);
  });
  test('merge media appends, re-ids a clashing id, caps the count; replace replaces', () => {
    const c = applyContentPatch(ex, { media: [img('a')] }, { media: [img('a', 'https://e.com/other.jpg'), img('b')] }, 'merge')!;
    expect(c.media!.map((m) => m.url)).toEqual(['https://e.com/a.jpg', 'https://e.com/other.jpg', 'https://e.com/b.jpg']);
    expect(new Set(c.media!.map((m) => m.id)).size).toBe(3);
    const full = applyContentPatch(ex, { media: Array.from({ length: 11 }, (_, i) => img(`m${i}`)) }, { media: [img('x1'), img('x2'), img('x3')] }, 'merge')!;
    expect(full.media!.length).toBe(LIMITS.mediaCount);
    expect(applyContentPatch(ex, { media: [img('a')] }, { media: [img('b')] }, 'replace')!.media!.map((m) => m.id)).toEqual(['b']);
    expect(applyContentPatch(ex, { media: [img('a')], summary: 's' }, { media: null }, 'merge')).toEqual({ summary: 's' });
  });
  test('does not mutate its input', () => {
    const cur: ExerciseContent = { steps: ['a'] };
    applyContentPatch(ex, cur, { steps: ['b'], cues: ['c'] }, 'replace');
    expect(cur).toEqual({ steps: ['a'] });
  });
  test('resetContentFields', () => {
    const cur: ExerciseContent = { steps: ['a'], cues: ['c'], summary: 's' };
    expect(resetContentFields(cur)).toBeUndefined();
    expect(resetContentFields(undefined, ['steps'])).toBeUndefined();
    expect(resetContentFields(cur, ['steps'])).toEqual({ cues: ['c'], summary: 's' });
    expect(resetContentFields({ steps: ['a'] }, ['steps'])).toBeUndefined();
    expect(cur.steps).toEqual(['a']);
  });
});

// ───────────── extra, aimed at surviving mutants (anchors, boundaries, host lists) ─────────────
describe('detectMedia: anchors and host lists', () => {
  const ID = 'dQw4w9WgXcQ';
  test('file extensions only count at the end of the path', () => {
    expect(detectMedia('https://e.com/a.jpg.html')).toMatchObject({ kind: 'video', provider: 'link' });
    expect(detectMedia('https://e.com/a.mp4/play')).toMatchObject({ provider: 'link' });
    expect(detectMedia('https://e.com/a.jpg/')).toMatchObject({ provider: 'link' });
  });
  test('YouTube ids are exactly 11 chars from the allowed set', () => {
    expect(detectMedia(`https://youtu.be/${ID}x`)).toMatchObject({ provider: 'link' });
    expect(detectMedia(`https://youtu.be/xx${ID}`)).toMatchObject({ provider: 'link' });
    expect(detectMedia('https://youtu.be/dQw4w9WgXc')).toMatchObject({ provider: 'link' });
    expect(detectMedia('https://youtu.be/dQw4w9WgX!Q')).toMatchObject({ provider: 'link' });
    expect(detectMedia('https://youtu.be/dQw4w9-gX_Q')).toMatchObject({ provider: 'youtube' });
  });
  test('every accepted YouTube host / path form, and not the neighbours', () => {
    for (const u of [`https://music.youtube.com/watch?v=${ID}`, `https://youtube-nocookie.com/embed/${ID}`, `https://www.youtube.com/v/${ID}`, `https://m.youtube.com/shorts/${ID}`, `https://youtube.com/live/${ID}`]) expect(detectMedia(u)?.provider, u).toBe('youtube');
    for (const u of [`https://www.youtube-nocookie.com/other/${ID}`, `https://www.youtube.com/channel/${ID}`, `https://www.youtube.com/user/${ID}`, `https://youtu.be.evil.com/${ID}`, `https://www.youtube-nocookie.com/${ID}`, `https://music.youtube.org/watch?v=${ID}`]) expect(detectMedia(u)?.provider, u).toBe('link');
    expect(detectMedia(`https://www.youtube.com/watch?v=${ID}&start=45`)!.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=45`);
    expect(detectMedia(`https://youtu.be/${ID}?t=10&start=45`)!.embedUrl).toContain('&start=10');
    expect(detectMedia(`https://youtu.be/${ID}?t=0`)!.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
  });
  test('start times', () => {
    expect(parseStartSeconds('12h')).toBe(43200);
    expect(parseStartSeconds('12m')).toBe(720);
    expect(parseStartSeconds('1h')).toBe(3600);
    expect(parseStartSeconds('45s')).toBe(45);
    expect(parseStartSeconds('1m')).toBe(60);
    expect(parseStartSeconds('2h5s')).toBe(7205);
    expect(parseStartSeconds('90abc')).toBe(0);
    expect(parseStartSeconds('x90')).toBe(0);
    expect(parseStartSeconds('1234567')).toBe(0);
    expect(parseStartSeconds('123456')).toBe(123456);
    expect(parseStartSeconds('0')).toBe(0);
  });
  test('Vimeo ids and hashes are validated', () => {
    expect(detectMedia('https://player.vimeo.com/video/123abc')!.provider).toBe('link');
    expect(detectMedia('https://player.vimeo.com/video/1234567890123')!.provider).toBe('link');
    expect(detectMedia('https://player.vimeo.com/video/123456789012')!.provider).toBe('vimeo');
    expect(detectMedia('https://vimeo.com/123abc')!.provider).toBe('link');
    expect(detectMedia('https://vimeo.com/1234567890123')!.provider).toBe('link');
    expect(detectMedia('https://www.vimeo.com/42')!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1');
    expect(detectMedia('https://notvimeo.com/42')!.provider).toBe('link');
    expect(detectMedia('https://player.vimeo.com/video/42?h=zz')!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1');
    expect(detectMedia('https://player.vimeo.com/video/42?h=abc-def1')!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1');
    expect(detectMedia('https://player.vimeo.com/video/42?h=abcdef')!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1&h=abcdef');
    expect(detectMedia(`https://player.vimeo.com/video/42?h=${'a'.repeat(21)}`)!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1');
    expect(detectMedia(`https://player.vimeo.com/video/42?h=${'a'.repeat(20)}`)!.embedUrl).toContain(`&h=${'a'.repeat(20)}`);
    expect(detectMedia('https://vimeo.com/42/abc')!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1');
    expect(detectMedia('https://vimeo.com/42/abc-def1')!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1');
    expect(detectMedia(`https://vimeo.com/42/${'b'.repeat(21)}`)!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1');
    expect(detectMedia('https://vimeo.com/42/abcdef12')!.embedUrl).toBe('https://player.vimeo.com/video/42?dnt=1&h=abcdef12');
  });
});

describe('ids, clipping, media items', () => {
  test('newMediaId: unique, short, url-safe, prefixed', () => {
    const ids = Array.from({ length: 3000 }, () => newMediaId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(0, 50)) expect(id).toMatch(/^m_[0-9a-z]+$/);
    expect(Math.max(...ids.map((i) => i.length))).toBeLessThanOrEqual(LIMITS.id);
  });
  test('line endings are normalised', () => {
    expect(sanitizeContent({ summary: 'a\r\nb' })!.summary).toBe('a\nb');
    expect(sanitizeContent({ summary: 'a\rb' })!.summary).toBe('a\nb');
    expect(sanitizeContent({ summary: 'a\nb' })!.summary).toBe('a\nb');
  });
  test('cleanMediaItem: kind hint, optional text, shape', () => {
    expect(cleanMediaItem({ url: 'https://e.com/photo/1', kind: 'image' })!.kind).toBe('image');
    expect(cleanMediaItem({ url: 'https://e.com/photo/1', kind: 'video' })).toMatchObject({ kind: 'video' });
    expect(cleanMediaItem({ url: 'https://e.com/photo/1', kind: 'bogus' })!.kind).toBe('video');
    expect(cleanMediaItem({ url: 'https://e.com/photo/1' })!.kind).toBe('video');
    const bare = cleanMediaItem({ url: 'https://e.com/a.jpg', title: '  ', caption: 5, source: null })!;
    expect(Object.keys(bare).sort()).toEqual(['id', 'kind', 'url']);
    expect(Object.keys(cleanMediaItem({ url: 'https://e.com/a.jpg', title: 't', caption: 'c', source: 's' })!).sort()).toEqual(['caption', 'id', 'kind', 'source', 'title', 'url']);
    for (const v of [null, undefined, 'https://e.com/a.jpg', 5, [], [{ url: 'https://e.com/a.jpg' }]]) expect(cleanMediaItem(v)).toBeNull();
  });
  test('sanitizeContent rejects non-objects', () => {
    for (const v of ['x', 5, [], [{ steps: ['a'] }], true]) expect(sanitizeContent(v)).toBeUndefined();
  });
});

describe('validate boundaries', () => {
  test('exact limits pass, trimmed length counts, blanks are dropped', () => {
    expect(validateContentPatch({ summary: ` ${'x'.repeat(LIMITS.summary)} ` }).summary).toHaveLength(LIMITS.summary);
    expect(validateContentPatch({ steps: ['x'.repeat(LIMITS.step)] }).steps![0]).toHaveLength(LIMITS.step);
    expect(validateContentPatch({ cues: ['x'.repeat(LIMITS.cue)] }).cues![0]).toHaveLength(LIMITS.cue);
    expect(validateContentPatch({ goodToKnow: [`  ${'x'.repeat(LIMITS.tip)}  `] }).goodToKnow![0]).toHaveLength(LIMITS.tip);
    expect(() => validateContentPatch({ cues: ['x'.repeat(LIMITS.cue + 1)] })).toThrow(/cues\[0\] is too long \(max 200/);
    expect(validateContentPatch({ steps: ['a', '  ', '', 'b'] }).steps).toEqual(['a', 'b']);
    expect(validateContentPatch({ steps: ['  '] }).steps).toBeNull();
    expect(validateContentPatch({ media: null }).media).toBeNull();
    const twelve = Array.from({ length: LIMITS.mediaCount }, (_, i) => ({ url: `https://e.com/${i}.jpg` }));
    expect(validateContentPatch({ media: twelve }).media).toHaveLength(LIMITS.mediaCount);
    expect(() => validateContentPatch({ media: [...twelve, { url: 'https://e.com/x.jpg' }] })).toThrow(/too many items/);
  });
  test('validateMediaInput: default label, kinds, text limits', () => {
    expect(() => validateMediaInput({ url: 'bad' })).toThrow(/^media\.url must be a public https/);
    expect(() => validateMediaInput({ url: 'bad' }, 'link')).toThrow(/^link\.url must be/);
    expect(validateMediaInput({ url: 'https://e.com/x', kind: 'image' }).kind).toBe('image');
    expect(validateMediaInput({ url: 'https://e.com/x', kind: 'video' }).kind).toBe('video');
    expect(() => validateMediaInput({ url: 'https://e.com/x', kind: 'gif' })).toThrow(/media\.kind must be "image" or "video"/);
    expect(validateMediaInput({ url: 'https://e.com/a.jpg', title: 't'.repeat(LIMITS.title) }).title).toHaveLength(LIMITS.title);
    expect(validateMediaInput({ url: 'https://e.com/a.jpg', title: ` ${'t'.repeat(LIMITS.title)} ` }).title).toHaveLength(LIMITS.title);
    expect(() => validateMediaInput({ url: 'https://e.com/a.jpg', title: 't'.repeat(LIMITS.title + 1) })).toThrow(/media\.title/);
    expect(validateMediaInput({ url: 'https://e.com/a.jpg', title: null, caption: null, source: null }).title).toBeUndefined();
    expect(validateMediaInput({ url: 'https://e.com/a.jpg', id: 'abc' }).id).toBe('abc');
    expect(() => validateMediaInput({ url: 'https://e.com/a.jpg', id: 'i'.repeat(LIMITS.id + 1) })).toThrow(/media\.id/);
    expect(() => validateMediaInput({ url: 'https://e.com/a.jpg', source: 's'.repeat(LIMITS.source + 1) })).toThrow(/media\.source/);
  });
});

describe('merged view edge cases', () => {
  test('built-in summary is served; flags tolerate empty prefs', () => {
    expect(contentFor({ id: 'back_squat' }, null).summary.length).toBeGreaterThan(10);
    expect(hasUserMedia({})).toBe(false);
    expect(hasUserMedia(null)).toBe(false);
    expect(hasUserMedia(undefined)).toBe(false);
    expect(customisedFields({})).toEqual([]);
  });
  test('merge with empty / absent current', () => {
    const ex = { id: 'c_1' };
    const img = { id: 'a', kind: 'image' as const, url: 'https://e.com/a.jpg' };
    expect(applyContentPatch(ex, undefined, { media: [] }, 'merge')).toBeUndefined();
    expect(applyContentPatch(ex, undefined, { media: [img] }, 'merge')).toEqual({ media: [img] });
    expect(applyContentPatch(ex, undefined, { steps: ['x'] }, 'merge')).toEqual({ steps: ['x'] });
    expect(applyContentPatch(ex, { steps: [] }, { cues: ['c'] }, 'merge')).toEqual({ steps: [], cues: ['c'] });
    expect(applyContentPatch(ex, { media: [img] }, { media: [] }, 'merge')).toEqual({ media: [img] });
    expect(applyContentPatch({ id: 'c_1', cue: 'one' }, undefined, { steps: ['two'] }, 'merge')).toEqual({ steps: ['one', 'two'] });
    expect(applyContentPatch(ex, undefined, { steps: ['x'] }, 'replace')).toEqual({ steps: ['x'] });
  });
});
