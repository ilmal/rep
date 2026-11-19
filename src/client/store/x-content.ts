// Exercise how-to content (steps, cues, tips, media): the athlete's / coach AI's override lives on the exercise's synced pref
// (`ExercisePref.content`), so it works for built-in and custom exercises, rides the existing pref LWW + outbox, and survives
// a custom exercise being archived. Content never affects planning, so none of these actions clears the session draft.
import { useMemo } from 'react';
import { prefOf } from '../../shared/planner';
import {
  applyContentPatch, contentFor, hasUserContent, hasUserMedia, resetContentFields, sanitizeContent, validateContentPatch,
  type ContentField, type MergedContent,
} from '../../shared/content';
import type { Exercise, ExerciseContent, ExercisePref, MediaItem } from '../../shared/types';
import { mutate, putEntity, useStore, type State } from './core';

type Patch = Parameters<typeof applyContentPatch>[2];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Write `content` (already sanitised, or undefined to clear) as the pref's override. A no-op write changes nothing (no updatedAt bump, no outbox entry). */
export function writeContentOverride(s: State, exerciseId: string, content: ExerciseContent | undefined): boolean {
  const cur = prefOf(s.prefs, exerciseId);
  if (same(cur.content, content)) return false;
  const next: ExercisePref = { ...cur, exerciseId };
  if (content) next.content = content; else delete next.content;
  putEntity(s, 'pref', exerciseId, next);
  return true;
}

/** Replace the whole override (used by the editor). Input is sanitised; an empty result clears the override. */
export function saveExerciseContent(exerciseId: string, content: ExerciseContent | undefined): void {
  const clean = sanitizeContent(content);
  mutate((s) => { writeContentOverride(s, exerciseId, clean); });
}

/** Partial update: validated like the MCP tools (throws Error with a readable message). */
export function patchExerciseContent(ex: Pick<Exercise, 'id' | 'cue'>, input: Record<string, unknown>, mode: 'merge' | 'replace' = 'replace'): void {
  const patch = validateContentPatch(input) as Patch;
  mutate((s) => { writeContentOverride(s, ex.id, applyContentPatch(ex, prefOf(s.prefs, ex.id).content, patch, mode)); });
}

export function addExerciseMedia(ex: Pick<Exercise, 'id' | 'cue'>, item: MediaItem): void {
  patchExerciseContent(ex, { media: [item] }, 'merge');
}
export function removeExerciseMedia(exerciseId: string, mediaId: string): void {
  mutate((s) => {
    const cur = prefOf(s.prefs, exerciseId).content;
    if (!cur?.media?.some((m) => m.id === mediaId)) return;
    const media = cur.media.filter((m) => m.id !== mediaId);
    const next = { ...cur }; if (media.length) next.media = media; else delete next.media;
    writeContentOverride(s, exerciseId, Object.keys(next).length ? next : undefined);
  });
}
/** Back to the built-in text: some fields, or everything (including media) when `fields` is omitted. */
export function resetExerciseContent(exerciseId: string, fields?: ContentField[]): void {
  mutate((s) => { writeContentOverride(s, exerciseId, resetContentFields(prefOf(s.prefs, exerciseId).content, fields)); });
}

/** The merged view for one exercise plus what is customised. Re-renders only when that exercise's pref changes. */
export function useExerciseContent(ex: Pick<Exercise, 'id' | 'cue'>): { merged: MergedContent; pref: ExercisePref | undefined; userContent: boolean; userMedia: boolean } {
  const pref = useStore((s) => s.prefs[ex.id]);
  return useMemo(() => ({ merged: contentFor(ex, pref), pref, userContent: hasUserContent(pref), userMedia: hasUserMedia(pref) }), [ex, pref]);
}

/** Undo helper for pref snapshots: put `prev` back but keep the how-to content as it is NOW (an undo must not roll back text edited since). */
export function restorePrefKeepingContent(s: State, exerciseId: string, prev: ExercisePref): void {
  const next: ExercisePref = { ...prev };
  const cur = s.prefs[exerciseId]?.content;
  if (cur) next.content = cur; else delete next.content;
  putEntity(s, 'pref', exerciseId, next);
}
