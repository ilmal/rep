import { describe, expect, test } from 'bun:test';
import { SEED_EXERCISES } from './exercises';
import { BUILTIN_CONTENT } from './exercise-content';
import { contentFor } from './content';

describe('built-in exercise content', () => {
  test('every catalog exercise has content, and nothing extra', () => {
    const missing = SEED_EXERCISES.filter((e) => !BUILTIN_CONTENT[e.id]).map((e) => e.id);
    expect(missing).toEqual([]);
    const ids = new Set(SEED_EXERCISES.map((e) => e.id));
    expect(Object.keys(BUILTIN_CONTENT).filter((k) => !ids.has(k))).toEqual([]);
    expect(SEED_EXERCISES.length).toBeGreaterThanOrEqual(100);
  });
  test('lengths and counts are sane for every exercise', () => {
    for (const e of SEED_EXERCISES) {
      const c = BUILTIN_CONTENT[e.id]!;
      expect(c.summary && c.summary.length >= 20 && c.summary.length <= 300, `${e.id} summary`).toBe(true);
      expect(c.steps!.length >= 3 && c.steps!.length <= 6, `${e.id} steps count`).toBe(true);
      expect(c.cues!.length >= 2 && c.cues!.length <= 4, `${e.id} cues count`).toBe(true);
      expect(c.goodToKnow!.length >= 2 && c.goodToKnow!.length <= 4, `${e.id} tips count`).toBe(true);
      for (const s of c.steps!) expect(s.length >= 10 && s.length <= 300, `${e.id} step "${s}"`).toBe(true);
      for (const s of c.cues!) expect(s.length >= 4 && s.length <= 140, `${e.id} cue "${s}"`).toBe(true);
      for (const s of c.goodToKnow!) expect(s.length >= 10 && s.length <= 300, `${e.id} tip "${s}"`).toBe(true);
    }
  });
  test('every exercise ships exactly one in-app YouTube demo video; the written text has no URLs', () => {
    for (const e of SEED_EXERCISES) {
      const c = BUILTIN_CONTENT[e.id]!;
      expect(c.media?.length, e.id).toBe(1);
      expect(c.media![0]!.kind).toBe('video');
      expect(c.media![0]!.url, e.id).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
      expect(JSON.stringify({ ...c, media: undefined }), e.id).not.toMatch(/https?:|www\./i);
    }
  });
  test('content is specific per exercise: no two exercises share a summary or a first step', () => {
    const sums = SEED_EXERCISES.map((e) => BUILTIN_CONTENT[e.id]!.summary);
    expect(new Set(sums).size).toBe(sums.length);
    const first = SEED_EXERCISES.map((e) => BUILTIN_CONTENT[e.id]!.steps![0]);
    expect(new Set(first).size).toBe(first.length);
  });
  test('contentFor serves the built-in text when there is no override', () => {
    const m = contentFor({ id: 'back_squat' });
    expect(m.steps.length).toBeGreaterThanOrEqual(3);
    expect(m.media.length).toBe(1);
  });
});
