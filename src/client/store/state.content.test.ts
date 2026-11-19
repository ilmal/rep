// Exercise how-to content lives on the synced pref: save / reset / patch, no draft side effects, no-op writes, sync round trip
// (incl. a remote edit that must NOT invalidate the planned session), hydrate hardening for corrupt content, old data without content.
import { describe, expect, test } from 'bun:test';
import { localStorageData, onboard, ready, S, server, useHarness, queued, invariants, clearOutbox } from './state-kit';
import * as A from './actions';
import { hydrate, persistNow, sanitizeSaved, setState } from './core';
import { syncNow } from './sync';
import { addExerciseMedia, patchExerciseContent, removeExerciseMedia, resetExerciseContent, saveExerciseContent } from './x-content';
import { contentFor } from '../../shared/content';
import { BUILTIN_CONTENT } from '../../shared/exercise-content';
useHarness();

const ID = 'back_squat';
const ex = { id: ID, cue: undefined as string | undefined };
const IMG = 'https://cdn.example.com/a.jpg';
const pref = () => S().prefs[ID];

describe('saveExerciseContent / patch / reset', () => {
  test('writes only `content` on the pref, stamps + queues it once, keeps every other pref field', () => {
    onboard();
    A.setPref(ID, { favorite: true, relevance: 80, notes: 'n' });
    const before = pref().updatedAt!;
    saveExerciseContent(ID, { steps: ['  one ', 'two'], summary: ' S ' });
    expect(pref()).toMatchObject({ exerciseId: ID, favorite: true, relevance: 80, notes: 'n', content: { steps: ['one', 'two'], summary: 'S' } });
    expect(pref().updatedAt!).toBeGreaterThan(before);
    expect(queued('pref', ID).data).toBe(pref());
    expect(contentFor(ex, pref()).steps).toEqual(['one', 'two']);
    expect(contentFor(ex, pref()).cues).toEqual(BUILTIN_CONTENT[ID].cues!);
  });
  test('works for a built-in that has no pref yet (defaults filled in) and for a custom id', () => {
    onboard();
    saveExerciseContent('c_custom', { cues: ['x'] });
    expect(S().prefs.c_custom).toEqual(expect.objectContaining({ exerciseId: 'c_custom', favorite: false, avoid: false, relevance: 50, content: { cues: ['x'] } }));
  });
  test('a no-op save does not bump updatedAt, queue an outbox entry or log anything', () => {
    onboard();
    saveExerciseContent(ID, { steps: ['a'] }); clearOutbox();
    const t = pref().updatedAt, ev = S().events.length;
    saveExerciseContent(ID, { steps: ['a'] });
    saveExerciseContent(ID, { steps: [' a '] });
    resetExerciseContent('rdl');
    saveExerciseContent('rdl', undefined);
    expect(pref().updatedAt).toBe(t);
    expect(Object.keys(S().outbox)).toEqual([]);
    expect(S().events.length).toBe(ev);
    expect(S().prefs.rdl).toBeUndefined(); // clearing a pref that never existed creates nothing
  });
  test('garbage input is sanitised; an empty result clears the override', () => {
    onboard();
    saveExerciseContent(ID, { steps: ['a'], media: [{ id: 'x', kind: 'image', url: 'javascript:alert(1)' }], evil: 1 } as never);
    expect(pref().content).toEqual({ steps: ['a'] });
    saveExerciseContent(ID, { steps: ['  '], summary: '' });
    expect(pref().content).toBeUndefined();
    expect('content' in pref()).toBe(false);
  });
  test('content edits never touch or clear the session draft', () => {
    ready(); A.prepareDraft(true);
    expect(S().device.draft).not.toBeNull();
    saveExerciseContent(ID, { steps: ['a'] });
    patchExerciseContent(ex, { cues: ['c'] });
    addExerciseMedia(ex, { id: 'm', kind: 'image', url: IMG });
    resetExerciseContent(ID, ['cues']);
    expect(S().device.draft).not.toBeNull();
    A.setPref(ID, { relevance: 70 }); // a planning pref change still does
    expect(S().device.draft).toBeNull();
    expect(pref().content).toBeDefined(); // ...and keeps the content
  });
  test('planning-field actions keep the content (favourite, pause, ban)', () => {
    onboard();
    saveExerciseContent(ID, { steps: ['a'] });
    A.toggleFavorite(ID); A.pauseExercise(ID, { days: 3 }); A.banExercise(ID, true); A.pauseExercise(ID, { resume: true });
    expect(pref().content).toEqual({ steps: ['a'] });
  });
  test('every other pref writer keeps the content: bulk favourite/pause/ban/resume, swap "dont", session completion countdown, undo', async () => {
    const { bulkFavourite, bulkPause, bulkBan, bulkResume, snapshotPrefs, restorePrefs } = await import('./x-library');
    const { restorePrefKeepingContent } = await import('./x-content');
    onboard();
    saveExerciseContent(ID, { steps: ['keep me'] });
    const snap = snapshotPrefs([ID]);
    bulkFavourite([ID]); bulkPause([ID], 7); bulkBan([ID]); bulkResume([ID]);
    restorePrefs(snap);
    expect(pref().content).toEqual({ steps: ['keep me'] });
    A.pauseExercise(ID, { sessions: 1 });
    expect(pref().content).toEqual({ steps: ['keep me'] });
    // undo of a snapshot taken before the text was edited must not roll the text back
    A.setPref('rdl', { favorite: true });
    const old = { ...pref(), content: undefined };
    saveExerciseContent(ID, { steps: ['newer text'] });
    setState((s) => { restorePrefKeepingContent(s, ID, old as never); });
    expect(pref().content).toEqual({ steps: ['newer text'] });
  });
  test('patch: validated like the MCP tools (throws, writes nothing); merge appends', () => {
    onboard();
    expect(() => patchExerciseContent(ex, { steps: 'x' })).toThrow(/steps must be an array/);
    expect(() => patchExerciseContent(ex, { media: [{ url: 'http://x.com/a.jpg' }] })).toThrow(/https/);
    expect(pref()).toBeUndefined();
    patchExerciseContent(ex, { goodToKnow: ['new'] }, 'merge');
    expect(pref().content!.goodToKnow).toEqual([...BUILTIN_CONTENT[ID].goodToKnow!, 'new']);
  });
  test('media add / remove / reset', () => {
    onboard();
    addExerciseMedia(ex, { id: 'm1', kind: 'image', url: IMG });
    addExerciseMedia(ex, { id: 'm2', kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'T' });
    expect(pref().content!.media!.map((m) => m.id)).toEqual(['m1', 'm2']);
    removeExerciseMedia(ID, 'nope'); // unknown id: nothing changes
    expect(pref().content!.media).toHaveLength(2);
    removeExerciseMedia(ID, 'm1');
    expect(pref().content!.media!.map((m) => m.id)).toEqual(['m2']);
    saveExerciseContent(ID, { ...pref().content, steps: ['a'] });
    resetExerciseContent(ID, ['media']);
    expect(pref().content).toEqual({ steps: ['a'] });
    resetExerciseContent(ID);
    expect(pref().content).toBeUndefined();
    removeExerciseMedia(ID, 'm1'); // no content at all: no-op
    expect(invariants(S())).toEqual([]);
  });
});

describe('sync round trip', () => {
  test('content is pushed in the pref entity and a second device pulls it (sanitised)', async () => {
    onboard(); await syncNow();
    saveExerciseContent(ID, { steps: ['one'], media: [{ id: 'm', kind: 'image', url: IMG }] });
    await syncNow();
    const uid = S().device.userId!;
    const stored = server.entity(uid, 'pref', ID)!.data as any;
    expect(stored.content).toEqual({ steps: ['one'], media: [{ id: 'm', kind: 'image', url: IMG }] });
    expect(stored.favorite).toBe(false);
  });
  test('a coach/other-device content edit arrives, wins by LWW, and does NOT invalidate the planned session', async () => {
    ready(); await syncNow();
    const uid = S().device.userId!;
    A.prepareDraft(true);
    expect(S().device.draft).not.toBeNull();
    const cur = pref() ?? { exerciseId: ID, favorite: false, avoid: false, relevance: 50 };
    const t = Date.now() + 10_000;
    server.putRemote(uid, { type: 'pref', id: ID, updatedAt: t, data: { ...cur, updatedAt: t, content: { summary: 'from coach', steps: ['x'], media: [{ id: 'm', kind: 'image', url: 'javascript:alert(1)' }, { id: 'n', kind: 'image', url: IMG }] } } });
    await syncNow();
    expect(pref().content).toEqual({ summary: 'from coach', steps: ['x'], media: [{ id: 'n', kind: 'image', url: IMG }] }); // bad media dropped on the way in
    expect(S().device.draft).not.toBeNull(); // content-only: nothing the planner reads changed
    const t2 = t + 10_000;
    server.putRemote(uid, { type: 'pref', id: ID, updatedAt: t2, data: { ...pref(), updatedAt: t2, favorite: true } });
    await syncNow();
    expect(pref().favorite).toBe(true);
    expect(S().device.draft).toBeNull(); // a planning field changed: stale draft dropped as before
  });
  test('a newer local content edit survives an older remote one; an unsent edit is not overwritten', async () => {
    onboard(); await syncNow();
    const uid = S().device.userId!;
    saveExerciseContent(ID, { steps: ['mine'] });
    server.putRemote(uid, { type: 'pref', id: ID, updatedAt: 1, data: { exerciseId: ID, favorite: false, avoid: false, relevance: 50, updatedAt: 1, content: { steps: ['old remote'] } } });
    await syncNow();
    expect(pref().content!.steps).toEqual(['mine']);
    expect((server.entity(uid, 'pref', ID)!.data as any).content.steps).toEqual(['mine']);
  });
  test('a remote pref with garbage content keeps the pref but drops the content', async () => {
    onboard(); await syncNow();
    const uid = S().device.userId!;
    const t = Date.now() + 5000;
    server.putRemote(uid, { type: 'pref', id: ID, updatedAt: t, data: { exerciseId: ID, favorite: true, avoid: false, relevance: 90, updatedAt: t, content: 'nonsense' } });
    await syncNow();
    expect(pref()).toMatchObject({ favorite: true, relevance: 90 });
    expect('content' in pref()).toBe(false);
  });
});

describe('hydrate hardening / old data', () => {
  const stored = (prefs: unknown) => ({ settings: { onboarded: true }, gyms: {}, areas: {}, exercises: {}, progress: {}, sessions: {}, prefs, plans: {}, device: {}, outbox: {}, events: [] });
  test('old prefs without content load untouched', async () => {
    localStorageData.set('rep-state-v1', JSON.stringify(stored({ rdl: { exerciseId: 'rdl', favorite: true, avoid: false, relevance: 60, updatedAt: 5 } })));
    setState((s) => { s.hydrated = false; });
    await hydrate();
    expect(S().prefs.rdl).toEqual({ exerciseId: 'rdl', favorite: true, avoid: false, relevance: 60, updatedAt: 5 });
  });
  test('corrupt / hostile content is cleaned, the rest of the pref and other prefs survive; the store stays healthy', async () => {
    localStorageData.set('rep-state-v1', JSON.stringify(stored({
      a: { exerciseId: 'a', favorite: true, avoid: false, relevance: 50, content: { summary: 7, steps: { 0: 'x' }, cues: [null, 3], goodToKnow: 'str', media: 'str' } },
      b: { exerciseId: 'b', favorite: false, avoid: false, relevance: 50, content: { steps: ['ok'], media: [{ id: '1', kind: 'image', url: 'javascript:alert(1)' }, { id: '2', kind: 'video', url: 'data:text/html,x' }, { id: '3', kind: 'image', url: IMG }] } },
      c: { exerciseId: 'c', favorite: false, avoid: false, relevance: 50, content: ['array'] },
      d: { exerciseId: 'd', favorite: false, avoid: false, relevance: 50, content: { steps: Array.from({ length: 50 }, (_, i) => 'x'.repeat(5000) + i) } },
    })));
    setState((s) => { s.hydrated = false; });
    await hydrate();
    expect(S().hydrated).toBe(true);
    expect('content' in S().prefs.a).toBe(false);
    expect(S().prefs.a.favorite).toBe(true);
    expect(S().prefs.b.content).toEqual({ steps: ['ok'], media: [{ id: '3', kind: 'image', url: IMG }] });
    expect('content' in S().prefs.c).toBe(false);
    expect(S().prefs.d.content!.steps!.length).toBe(12);
    expect(S().prefs.d.content!.steps![0].length).toBe(400);
    expect(contentFor({ id: 'a' }, S().prefs.a).steps).toEqual([]); // renders as "no content" instead of crashing
  });
  test('sanitizeSaved: non-object prefs are dropped, objects kept', () => {
    const c = sanitizeSaved({ prefs: { x: 5, y: null, z: { exerciseId: 'z', content: { steps: ['a'] } } } });
    expect(Object.keys(c.prefs)).toEqual(['z']);
    expect(c.prefs.z.content).toEqual({ steps: ['a'] });
  });
  test('persist -> reset -> hydrate keeps the content', async () => {
    onboard();
    saveExerciseContent(ID, { steps: ['kept'], media: [{ id: 'm', kind: 'image', url: IMG }] });
    await persistNow();
    setState((s) => { Object.assign(s, { prefs: {}, hydrated: false }); });
    await hydrate();
    expect(pref().content).toEqual({ steps: ['kept'], media: [{ id: 'm', kind: 'image', url: IMG }] });
  });
});
