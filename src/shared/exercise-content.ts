// Built-in how-to content for every catalog exercise, keyed by exercise id: written text plus one demo video that plays inside the app.
// The athlete or their coach AI can attach more or replace media as an override on the exercise's pref, see content.ts.
// The four parts live in content-data/; src/shared/exercise-content.test.ts asserts every catalog id is covered and lengths are sane.
import type { ExerciseContent } from './types';
import { CONTENT_LOWER } from './content-data/lower';
import { CONTENT_UPPER } from './content-data/upper';
import { CONTENT_CORE } from './content-data/core';
import { CONTENT_BODYWEIGHT } from './content-data/bodyweight';

import { VIDEOS } from './content-data/videos';

const TEXT: Record<string, ExerciseContent> = { ...CONTENT_LOWER, ...CONTENT_UPPER, ...CONTENT_CORE, ...CONTENT_BODYWEIGHT };

/** Text plus one in-app demo video per exercise (YouTube, played inline via the tap-to-load player; see content-data/videos.ts). */
export const BUILTIN_CONTENT: Readonly<Record<string, ExerciseContent>> = Object.fromEntries(
  Object.entries(TEXT).map(([id, c]) => {
    const v = VIDEOS[id];
    return [id, v ? { ...c, media: [{ id: `v_${id}`, kind: 'video' as const, url: `https://www.youtube.com/watch?v=${v.v}`, title: v.t, source: `YouTube / ${v.c}` }] } : c];
  }),
);
