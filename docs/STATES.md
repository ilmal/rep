# STATES: every piece of state in Rep, its owner, invariants and transitions

Source of truth: `src/shared/types.ts`, `src/client/store/{core,actions,sync}.ts`, `src/shared/{rules,planner}.ts`.
Every claim below is exercised by `src/client/store/state.*.test.ts` (run `bun test src/client/store`).
Harness: `src/client/store/state-kit.ts` (browser stubs, clock, scripted geolocation, in-memory fake `/api` server, `invariants()`).

## 0. How state is held

| Layer | What | Persisted | Synced |
|---|---|---|---|
| Domain entities (`State.settings/gyms/areas/exercises/progress/sessions/prefs/plans`) | the user's data | IndexedDB key `rep-state-v1` (localStorage fallback) | yes, through the outbox |
| `outbox` (`type:id` -> `EntityChange`) | pending writes | yes | drained by `syncNow` |
| `events` (`AppEvent[]`, max 5000) | audit log | yes | drained by `syncNow` (first 1500/round) |
| `device` | per-device state (auth, cursor, gym, geo, draft...) | yes, except `geo` -> `idle` and `resumeShown` -> `false` on hydrate | never |
| `hydrated`, `online`, `syncing` | runtime flags | no | no |
| `x-onboarding.ts` wizard, `x-library.ts` filter | screen-local UI state | sessionStorage / memory | no |

Write rule: **every domain mutation goes through `putEntity` (inside `mutate`)**, which stamps `updatedAt` and writes the
entity and its outbox entry atomically. `updatedAt` is strictly increasing per entity (core.ts, see Fixes). Deleting an
entity removes it from its collection and queues `{deleted:true}`. Gyms are soft-deleted (`gym.deleted`) and stay in `gyms`.
A no-op action must not call `putEntity` (no `updatedAt` bump, no outbox entry, no event).

## 1. Persisted state

### 1.1 Settings (`state.settings`, entity `settings:settings`, owner: `updateSettings`, `updatePlanner`, `setRotation`, `deleteArea`, `completeOnboarding`)
| Field | Values | Notes |
|---|---|---|
| `onboarded` | boolean | set only by `completeOnboarding`; false after logout / delete |
| `weeklyGoal` | int | streak/week-goal; default 4 |
| `targetMinutes`, `warmupTargetMinutes`, `restSec` | numbers | planning inputs |
| `unit` | `'kg' \| 'lb'` | **display only**: all stored weights are kg, switching unit rewrites nothing |
| `sound`, `gps`, `fitToTime`, `suggestSwaps`, `aiAssist` | boolean | `gps=false` -> detection stays `idle`; `fitToTime=false` disables auto-adjust |
| `rotation` | area ids by slot (index 0 = slot 1) | invariant: every id exists in `areas` (`setRotation` drops unknown ids, `deleteArea` removes the id) |
| `planner` | `PlannerConfig` | merged key-by-key with defaults (`withDefaults`) |
| `profileNotes`, `name` | string | |
| `goalHistory?` | `{from: weekStart ms, goal}[]` ascending | streak: goal per week. `updateSettings` / MCP `update_settings` append `{from: next Monday, goal}` when `weeklyGoal` changes (seeded with `{from:0, goal: old}`); a 2nd change the same week replaces the pending entry; immediate (no history) for onboarding and for athletes who never finished a session. Absent = `weeklyGoal` for every week |
| `manualFreezeWeeks?` | weekStart ms[] | streak: weeks covered by a manual freeze (max 52 kept). Written by `freezeThisWeek`, removed by `undoFreezeThisWeek` / MCP `use_streak_freeze` / `undo_streak_freeze` |
| `streakLastCelebrated?` | weekStart ms of the last celebrated week | StreakCelebrate shows once per week (`markStreakCelebrated`). NOT a streak length, so it survives resets |
Invariant: changing `rotation/planner/restSec/targetMinutes/warmupTargetMinutes/suggestSwaps` clears the draft.

### 1.2 Gyms (`gyms`, owner: `completeOnboarding`, `addGym`, `updateGym`, `deleteGym`, `setEquipStatus`, `swapCurrent`, `applyCompletion`)
`equipment[equipId] = 'ok' | 'broken'`; absent = `none`. `brokenSince[equipId]` exists **iff** the item is `broken`.
`lastVisitedAt` set when a session at that gym completes. `deleted` is a soft-delete flag.

Equipment status cycle (`setEquipStatus`; unknown gym or unknown equipment id = no-op; clears the draft if `draft.gymId === gymId`):

| from \ to | ok | broken | none |
|---|---|---|---|
| ok | stays ok, `brokenSince` cleared | `equipment=broken`, `brokenSince=now` | `equipment` key deleted |
| broken | `equipment=ok`, `brokenSince` deleted | stays broken, **original `brokenSince` kept** | key deleted, `brokenSince` deleted |
| none | `equipment=ok` | `equipment=broken`, `brokenSince=now` | stays none |
`swapCurrent('broken')` is the same as `ok -> broken`; `swapCurrent('gone')` is `* -> none` (also deletes `brokenSince`); `'busy'` touches only the session.

#### 1.2a Built-in "At home · no equipment" location (`src/shared/location.ts`)
A pseudo gym with id `NO_EQUIPMENT_GYM_ID = 'none'`: always available, NEVER stored in `gyms` and never synced as a gym. Equipment = bodyweight, the floor (catalog id `mat`) and a wall, so it can do every exercise whose `equipment` is empty or only `mat`.
`device.currentGymId === 'none'` selects it (`chooseNoEquipment`, `toggleNoEquipment`, `leaveNoEquipment`; `device.homeReturn` remembers the gym to go back to; `useAtHome()`). Always resolve gym ids with `resolveGym(gyms, id)`, never `gyms[id]`.
`generateSession` there plans bodyweight versions of the SAME area: the area pool plus library bodyweight exercises that hit the area's focus muscles (advanced variations only once earned), no `hiddenNames`. Sessions record `gymId: 'none'`, `gymName: 'No equipment'`; they count for streak and rotation as normal, but not for the "3 gyms" badge and never set `lastVisitedAt`.
Bodyweight progression (`recommend(..., { tempo, harder })`): +1 rep (+5 s) to the ceiling, then a slow 3 s tempo (reps exercises; `rec.tempo` → `progress.tempo` → `SessionExercise.tempo`), then the exercise's `harder` variation (`rec.kind === 'harder'`, `harderId`); the planner then plans the variation instead. All counts shown in the UI (bodyweight exercises, exercises, minutes) are computed.

### 1.3 Areas (`areas`, owner: `saveArea`, `deleteArea`, onboarding). Deleting an area removes it from `rotation` (one entity delete + one settings write) and clears the draft. `deleteArea` of an unknown id is a no-op.

### 1.4 Custom exercises (`exercises`, owner: `saveExercise`, `archiveExercise`)
Only custom exercises are stored; the library is `mergeLibrary(custom)`. `archived` hides it. Editing an existing exercise or archiving clears the draft.

### 1.5 Exercise preferences (`prefs[exerciseId]`, owner: `setPref`, `toggleFavorite`, `pauseExercise`, `banExercise`, `applyCompletion`)
Fields: `favorite`, `avoid` (banned), `pausedUntil` (epoch ms, `PAUSE_FOREVER` = 8.64e15), `pausedSessions` (int >= 0), `relevance` (default 50), cooldown overrides, `notes`.
Derived status: `statusOf(pref, now)` = **banned** (avoid) > **paused** (`pausedUntil > now` or `pausedSessions > 0`) > **favorite** > **ready**.
`pausedUntil` and `pausedSessions` are mutually exclusive (set by `pauseExercise`; the other is deleted). `{sessions:0}` is a resume (not "forever").
Any `setPref` that changes more than `notes` clears the draft (`pauseExercise` always does).

### 1.5.1 Exercise how-to content (`prefs[exerciseId].content`, owner: `x-content.ts`: `saveExerciseContent`, `patchExerciseContent`, `addExerciseMedia`, `removeExerciseMedia`, `resetExerciseContent`; MCP: `set_exercise_content`, `add_exercise_media`, `remove_exercise_media`, `reset_exercise_content`, content fields of `create_exercise` / `update_exercise`)
Every exercise (built-in or custom) can have a guide the athlete reads before performing it: `ExerciseContent = { summary?, steps?[], cues?[], goodToKnow?[], media?[] }` (`MediaItem = { id, kind: 'image'|'video', url, title?, caption?, source? }`).
- **Where it lives (decision).** Built-in text ships in `src/shared/exercise-content.ts` (+ `content-data/*`, one entry per catalog id, NO media / URLs; a test enforces coverage and lengths). The athlete's / coach's text is an **override stored on the exercise's `ExercisePref`** (`pref.content`), not on the `Exercise` entity. Why: (1) built-ins cannot be mutated and an `exercise` entity with a built-in id is a *label* override that also changes planning (equipment, muscles); (2) the pref is already keyed by exercise id for built-in and custom alike, synced, LWW and hydrated; (3) it survives archiving or re-creating a custom exercise; (4) the MCP already merges prefs field by field, so `set_exercise_pref` never drops content (and vice versa).
- **Merge.** `contentFor(exercise, pref)` (shared/content.ts): per field, a non-empty override wins over the built-in default; blank / empty overrides never hide a default. Custom exercises have no default except their legacy one-line `cue`, which reads as `steps` until real steps exist. Clearing a field means "back to the default" (reset); a built-in text cannot be blanked out. The editor stores only fields that differ from the default.
- **Never planning-relevant.** Content writes do not clear the session draft and are not an `invalidator` in 3.x; a remote `pref` change that differs only in `content`/`updatedAt` keeps the draft (`sync.ts onlyContentChanged`). Any planning field change on the same pref still clears it. `statusOf`, scores, exclusions and `blockedIds` ignore `content`.
- **No-op rule.** An unchanged save writes nothing (no `updatedAt` bump, no outbox entry).
- **Hardening.** Every entry point re-sanitises (`sanitizeContent`): hydrate (`sanitizeSaved` -> `cleanPrefs`), remote pulls (`applyRemote`), the sync API on push (`api.ts cleanPref`, so the server copy that the MCP and other devices read is clean), `loadData` on read, and the renderer (`detectMedia` again at render). Malformed fields vanish, the rest of the pref survives. Rules: media URLs are absolute `https://` only (no `http:`, `javascript:`, `data:`, `blob:`, credentials or whitespace; <= 2000 chars); text is trimmed and clipped; unknown keys are dropped. Caps: summary 600, steps <= 12 x 400, cues <= 10 x 200, goodToKnow <= 12 x 400, media <= 12 (title 120, caption 300, source 120). The strict path (MCP / editor) throws a readable error naming the field instead of clipping.
- **Old data.** A pref without `content` is the old shape and stays valid; nothing migrates.
- **Media rendering** (`components/ExerciseGuide.tsx`): images `<img loading=lazy>` with alt from caption/title and a lightbox; direct video files (`.mp4 .webm .mov .m4v .ogv`) `<video controls playsinline preload=metadata>`; YouTube (watch, youtu.be, shorts, embed, live) and Vimeo become a **click-to-load facade** (nothing from YouTube/Vimeo is requested until the tap) that then mounts a sandboxed iframe on `youtube-nocookie.com` / `player.vimeo.com`; any other https URL is a plain link (`rel=noopener noreferrer`, new tab). A failed image/video degrades to a link. "Find a video" is a link to a YouTube search for `<name> form`, opened only on tap.
- **Surfaces.** One `<ExerciseGuide/>` everywhere: detail (`How to` card), live "Up next" (`How to do it` button -> bottom sheet; the set screen shows none of it), PreSession row info button (same sheet, with an Edit link), editor (`ContentEditor`, also for built-ins: saves only the override, and no label copy when the labels are untouched). Library rows show a book (own text) or image (own media) indicator when the pref has content.
- **Security headers.** The server sets a partial CSP on `/app/*` (`security.ts`): `img-src 'self' data: blob: https:`, `media-src 'self' blob: https:`, `frame-src` YouTube-nocookie + Vimeo player only, `object-src 'none'`, `base-uri 'self'`. No script/style directive (the app shell is unchanged). Service worker: cross-origin images are cached stale-while-revalidate in `rep-exercise-images` (40 entries, 60 days, purge on quota); videos are never cached; text is local state and always offline.

Preference status machine:

| from | event | to |
|---|---|---|
| ready | `toggleFavorite` / `setPref{favorite:true}` | favorite |
| favorite | `toggleFavorite` | ready |
| ready/favorite | `pauseExercise{days:n}` | paused (until now+n d) |
| ready/favorite | `pauseExercise{days:null}` | paused (forever) |
| ready/favorite | `pauseExercise{sessions:n>0}` | paused (n sessions) |
| paused(until) | clock passes `pausedUntil` | ready/favorite (**derived, no write**) |
| paused(sessions n) | a session completes (`finishSession` or `endEarly('save')`) | paused(n-1); at 0 -> ready/favorite |
| paused | `pauseExercise{resume:true}` or `{sessions:0}` | ready/favorite |
| any | `banExercise(id)` | banned (hides the paused/favorite state underneath) |
| banned | `banExercise(id,false)` | the underlying paused/favorite/ready |
Discarding a session never counts down `pausedSessions`. Banned or paused ids are never generated, listed as alternatives or swapped in (`blockedIds`).

### 1.6 Progress (`progress[exerciseId]`: `weight` kg, `reps`, `sets`, `lastRec`)
Written **only** by `applyCompletion` for rows with `status==='done' && recommendation` of a **completed** session (finish or `endEarly('save')`). Never by discard, never rewound by `deleteSession`.
Invariant: `weight >= 0` and finite, `reps >= 1`, `sets >= 1`.

### 1.7 Coach plans (`plans`) - status machine
| from | event | to |
|---|---|---|
| (remote) | created by coach via sync | pending |
| pending | draft built (variant 0, matching slot/area) | pending (a plan is only *referenced*: `draft.coachPlanId`) |
| pending | `newMix` (variant > 0) | pending, draft no longer coach-sourced |
| pending | session started from it, then `finishSession` / `endEarly('save')` | **used** (`usedBySessionId` = session id) |
| pending | session started from it, then `endEarly('discard')` | pending |
| pending | coach cancels (remote) | cancelled (a later completion does **not** overwrite it) |
| used / cancelled | any | terminal; never picked again |
`pickCoachPlan`: only pending; precedence slot > area > any; oldest first. Invariant: `usedBySessionId` set **iff** status `used`.

### 1.8 Sessions (`sessions`, owner: session lifecycle actions in actions.ts + `x-session-end.ts`, `x-swap.ts`)
`status`: `active | completed | discarded` (`planned` exists in the type but is never produced). At most **one** `active`.
Counted sessions = `completed` only (`weekCount`, `nextSlot`, history, progress).

#### Session lifecycle
| state | event | next | guard / effect |
|---|---|---|---|
| (none) | `beginSession` | active/warmup | needs a draft with >= 1 exercise and no active session (else returns null, no-op). cursor 0, all rows `todo`, seq = max+1. Draft is kept until the session ends. |
| active/warmup | `endWarmup` | active/set | row 0 -> `active`, `warmupEndedAt`; auto-adjust may trim/drop (cursor protected) |
| active/warmup | `toggleWarmupItem(i)` | same | flips checklist item |
| active/set | `logSet(w,r)` (finite, >= 0) | active/rest if sets < planned, else active/fb | sets `restEndsAt = now + restSec`, `restTotalSec`; last set sets `endedAt` |
| active/rest | `endRest(auto?)` | active/set | records actual rest on last set; manual logs `rest_skipped` |
| active/rest | `adjustRest(d)` | same | `restEndsAt >= now+1s` |
| active/rest, fb | `undoLastSet` | active/set | removes the last set, clears `restEndsAt`/`endedAt`; no-op in set/warmup/done |
| active/fb | `saveFeedback(fb)` | active/set (next todo) or active/done | row -> `done` with recommendation + PR flag; then auto-adjust |
| active/set, rest | `skipCurrent` | active/set (next todo) or active/done | row -> `skipped` (partial sets kept) |
| active/set, rest | `swapCurrent(reason, id)` | active/set | see swap table |
| active/set, rest | `addSetToCurrent` / `removeSetFromCurrent` | same | planned sets 1..12; never below logged+1 |
| active/* | `dropExercise`, `moveUpcoming`, `undoAdjustmentById`, `reapplyAdjustment` | same | only touch rows after the cursor; restoring a `todo` row in phase `done` revives the session onto it |
| active/* (any) | `finishSession(note?)` | completed | unfinished rows resolved like `endEarly` and `endedEarly=true`; progress applied; draft + `chosenSlot` cleared |
| active/* | `endEarly('save', {repeatNext})` | completed (`endedEarly`) | `todo/active` rows with sets -> `done`, without -> `skipped`; progress applied; `repeatNext` keeps the pointer |
| active/* | `endEarly('discard')` | discarded | **no** progress, no pause countdown, no plan use, no gym visit, not counted; draft + `chosenSlot` cleared |
| completed/discarded | `deleteSession` | (removed, `deleted` queued) | clears draft; progress not rewound |
| active | `deleteSession` | (refused) | |
Illegal events (anything not listed for the current phase, no session, a second `beginSession`, `finishSession`/`endEarly` after the end) are **no-ops**: no state, outbox or event change.

Phase invariants (checked by `invariants()` on every random step):
`warmup`: cursor 0, no `active` row, no row with sets. `set|rest|fb`: cursor row is `active` and is the **only** `active` row, `warmupEndedAt` set.
`set`: cursor sets < planned. `rest`: 1 <= sets < planned and `restEndsAt` set. `fb`: sets >= planned, no `restEndsAt`. `done`: no `todo`/`active` row. `restEndsAt` only in `rest`.
Completed sessions: `phase==='done'`, `endedAt >= startedAt`, no `todo/active` rows. Row `order` is 0..n-1 and ids unique.

#### Exercise (row) lifecycle
| from | event | to |
|---|---|---|
| todo | `endWarmup` (row 0) / `advance` (next todo, wraps to an earlier todo) | active |
| active | `saveFeedback` | done |
| active | `skipCurrent` | skipped |
| active | `swapCurrent` (no sets logged) | replaced by a new `active` row (`swappedFrom`) |
| active | `swapCurrent` (sets logged) | skipped (sets kept) + new active row inserted after it |
| todo | `dropExercise(id)` / auto-adjust drop | dropped |
| dropped | `dropExercise(id,false)` / `undoAdjustmentById` | todo |
| todo/active | `finishSession` / `endEarly('save')` | done (if it has sets) else skipped |
| done / skipped / dropped(active session) | everything else | unchanged |
Row invariants: `todo`/`dropped` have no sets; `done` has >= 1 set; weights finite and >= 0; `plannedSets` 1..12.

#### Swap (`swapCurrent(reason, newId)`; refused outside set/rest, for unknown id, or to the same exercise)
| reason | session | gym | other |
|---|---|---|---|
| busy | `busyEquip += limitingEquipment` | untouched | alternatives exclude busy equipment |
| broken | - | `equipment[eq]='broken'`, `brokenSince[eq]=now` | gym queued |
| gone | - | `equipment[eq]` and `brokenSince[eq]` deleted | gym queued |
| dont (x-swap) | - | - | writes a pref (today = 1 session pause, 2 weeks, never = ban) |
Always: `cursor` row replaced (no sets) or kept as `skipped` with the new row after it (cursor +1), `phase='set'`, `restEndsAt` cleared, `order` re-indexed, event `exercise_swapped`.

#### Rest timer (inside `phase==='rest'`)
`logSet` -> `restEndsAt = t + restSec*1000`. `adjustRest(+/-s)` moves it (floor now+1000). `endRest` (timer expiry = `auto`, tap = manual) -> `set`. All values are wall-clock timestamps: a suspended/killed app resumes correctly.

#### Auto-adjust / undo
Triggered by `endWarmup` (text prefixed "Warm-up ran long.") and after every `saveFeedback` that does not end the session, only when `settings.fitToTime`. If projected end > target + 5 min: trim rest (min 60 s, up to 30 s per row) then drop the lowest-priority todo rows; the cursor row is never dropped.
`undoAdjustmentById(id)`: restores rests/rows, `undone=true`; undoing twice or an unknown id is a no-op. `reapplyAdjustment(id)`: re-drops / re-trims only if `undone`.

### 1.9 Outbox / events
`outbox[type:id]` holds the latest unsent change for each entity. Invariant (no sync running): **every** entity in a collection has an outbox entry with the same `updatedAt` and the same object; every outbox deletion has no entity. After sync: entries sent and not re-edited are removed.

## 2. Device state (`state.device`, never synced)
| Field | Values | Owner |
|---|---|---|
| `token`, `userId`, `email` | auth | `ensureAccount`, `register`, `login`, `logout`, `resetLocal`, 401 handler, `verifyLink` |
| `cursor` | server sync cursor (int) | `syncNow`; 0 after login/delete |
| `lastSyncAt`, `lastSyncError` | timestamp / `no_account` / `sync <status>` / network message | `syncNow` |
| `currentGymId`, `gymSource` | gym id or null; `gps \| manual \| last \| none` | onboarding (`last`/`none`), `addGym` (first gym, `manual`), `chooseGym` (`manual`), `detectGym` (`gps`), `deleteGym` (null/`none`) |
| `geo`, `geoDistanceM`, `currentPos` | see geo machine | `detectGym` |
| `chosenSlot` | null or an integer in 1..N, never equal to the pointer | `chooseSlot`; cleared by finish/endEarly. A stale out-of-range value is ignored by `effectiveSlot` |
| `draft` | null or a `Draft` | see draft machine |
| `resumeShown` | boolean | App/PreSession; reset on hydrate |

### Geo detection machine (`detectGym`)
| from | event | to | effect |
|---|---|---|---|
| any | gps setting off | idle | |
| any | no `navigator.geolocation` | unavailable | |
| any | `detectGym()` | locating | |
| locating | position inside a fence (nearest; fence = radius + min(accuracy,50); deleted gyms and gyms without coordinates never match) | matched | `currentGymId`, `gymSource='gps'`, `geoDistanceM`; draft cleared only if its gym differs; event `gym_detected` |
| locating | position outside every fence | nomatch | `currentPos`; current gym unchanged; event `gym_unknown_location` |
| locating | error code 1 | denied | |
| locating | error code 2/3 | unavailable | |
| terminal | `detectGym()` again | locating | |
| (reload) | hydrate | idle | |

### Draft machine
| from | event | to |
|---|---|---|
| none | `prepareDraft()` (slot has an area) | prepared |
| prepared | `prepareDraft()` with same slot + gym, < 6 h old | unchanged (same object) |
| prepared | `prepareDraft(true)`, other slot, other gym, age > 6 h | rebuilt (variant 0) |
| prepared | `newMix` | rebuilt, variant+1, same target minutes (coach plan not used) |
| prepared | `draftMove/Remove/SetTarget(20..150)/AddExercise/Swap` | edited (order re-indexed, unknown ids/indices no-op) |
| prepared/edited | `beginSession` | still present while the session is active |
| any | **invalidators** (how-to `content` edits are NOT one, see 1.5.1): equipment change at the draft gym, `updateGym{equipment}`, `deleteGym`, `chooseGym`/`detectGym` to another gym, `saveArea`, `deleteArea`, `setRotation`, planning settings/planner change, any `setPref` except notes, `pauseExercise`, `banExercise`, `toggleFavorite`, `archiveExercise`, custom exercise edit, `chooseSlot`, `finishSession`, `endEarly`, `deleteSession`, remote change of a `plan/pref/gym/area/exercise` | none |
| any | keepers: pref notes, name/sound/unit, equipment at another gym, `chooseGym` to the same gym, gym rename, `beginSession` | unchanged |
Invariants: `draft.gymId === currentGymId`, `draft.slot` in 1..N, exercise `order` 0..n-1, no NaN.

### Sync / online machine
| state | event | next |
|---|---|---|
| any | `syncNow` before hydrate | no-op |
| any | `syncNow` while `navigator.onLine=false` | `online=false`, nothing sent, **in-flight guard released** (stall regression) |
| online, no token | `ensureAccount` ok | token + userId stored |
| online, no token | account request fails | `lastSyncError='no_account'`, outbox kept |
| online | round trip | `syncing=true`; on success outbox/events drained, remote changes applied, `cursor`, `lastSyncAt` set, error cleared; loops until `!more` and the outbox is empty (max 20 rounds, 400 changes/round) |
| syncing | 401 | token/userId/email cleared, outbox kept; the next sync creates a new anonymous account |
| syncing | other HTTP error / network error | `lastSyncError`, outbox kept, `syncing=false` |
| any | `online`/`offline` events, visibility, 60 s timer, outbox growth | `syncNow` (debounced 1.5 s) |
A push is "sent" only if the outbox entry still has the same `updatedAt` after the response; later edits stay queued (stamps are strictly increasing per entity, so even a same-millisecond edit is distinguishable).

`applyRemote` (last-write-wins):
1. a pending outbox change with `updatedAt` **greater** than the remote one wins (remote ignored)
2. else a local copy with greater `updatedAt` wins
3. `settings`: remote replaces local only if `updatedAt >=` local; deletions of settings are ignored; planner merged with defaults
4. other types: `deleted` removes the entity, otherwise replaces it
5. remote `plan/pref/gym/area/exercise` changes clear the draft
Known gaps (sync.ts, not editable here; see tests marked `test.failing` / `test.todo`): equal timestamps with a pending local edit apply the remote data while the local change stays queued (divergence); remote `settings` changes (rotation/planner) do not clear the draft; two devices starting sessions offline yield two `active` sessions.

### Auth machine
| from | event | to |
|---|---|---|
| anonymous, no token | first `syncNow`/`ensureAccount` online | anonymous + token |
| anonymous | `register(email,pw)` | account (`email` lower-cased), local data kept |
| anonymous/account | magic link `verifyLink` | account; local data re-queued (`requeueAllLocal`), cursor 0 |
| any | `login` ok | account: **local data replaced** by the account's (`resetLocal`, cursor 0, sync); wrong credentials/offline leave local data untouched |
| any | `logout` | no token, no data, `hydrated` stays true, `onboarded=false` (token revoked server-side when online) |
| any | `deleteAllData(false)` | auth kept, data wiped, cursor 0 |
| any | `deleteAllData(true)` | auth dropped too |
| any | 401 during sync | anonymous, no token |
Caveats: `logout`/`login` discard unsynced outbox entries by design; a sync that is in flight during `resetLocal` can re-populate state (race, not guarded).

## 3. Derived state (never stored)
| Value | Definition |
|---|---|
| `weekCount(sessions, now)` | completed sessions whose `endedAt ?? startedAt` is in the local Mon 00:00 - next Mon 00:00 week. Discarded/active never count |
| rotation pointer `nextSlot(sessions, N)` | newest completed session by `endedAt`: `repeatNext` -> same slot, else `(slot mod N)+1`; no sessions -> 1. Always in 1..N, independent of the week |
| `pointerSlot` / `effectiveSlot` | pointer / valid `chosenSlot` else pointer |
| `nextSeq` | max seq + 1 (deleting the newest session frees its number) |
| `streakWeeks(sessions, goal, now)` | consecutive weeks meeting the goal, the current week may still be in progress |
| `computeStreak(sessions, settings, now, {tz?})` | the whole streak/rewards view, see section 3.1 |
| `weeklyCounts`, `warmupMedianSec`, `estimateExerciseSec`, `isPR`, `topWeight`, `volumeOf` | pure functions of completed sessions |
| `statusOf`, `isPaused`, `blockedIds` | pure functions of prefs and the clock |
| `getActiveSession` | first session with `status==='active'` |

### 3.1 Streak and rewards (`src/shared/streak.ts`, store `x-streak.ts`, MCP `get_streak`)
Everything is derived by deterministic replay from completed sessions + `weeklyGoal`/`goalHistory`/`manualFreezeWeeks`; no streak number is ever stored,
so every device, the MCP and the push sweep agree (tests: `streak.test.ts`, `streak.property.test.ts`: order-independent, `current <= best`, freezes 0..2, `open` only on the last week).

Week statuses: `hit` (done >= goal) / `repaired` / `frozen` / `missed` / `open` (only the current week, until secured).

| State (what the UI shows) | Derived when | Transition out |
|---|---|---|
| **none** | `current == 0`, no `lost`, no repair | first secured week -> `current 1`, Spark |
| **on pace / tight / last chance** (`currentWeek.pace`) | left = target - done, days = days left incl. today: `onpace` left <= days-2, `tight` left == days-1, `lastchance` left == days | `secured` at left 0 |
| **secured** | `currentWeek.secured` (done >= target) | week ends -> `hit`; `celebrate` becomes non-null (kind `week`/`repair`/`milestone`) |
| **at risk** (`atRisk`) | pace tight/lastchance/repair, left > 0, not frozen, `current > 0` | train; or `freezeThisWeek()` -> frozen |
| **repair** (`repairOffer`) | last week missed by 1-2 while a streak was running (deficit 3+ never offers). Target = goal + deficit. The missed week stays `missed` (+ `repairTarget`) and is NOT in `current` until repaired | reached -> missed week `repaired`, repair week `hit`, `current` += 2. Week ends short -> auto freeze covers the missed week (`frozen`, streak continues) or, with no freeze, streak resets (`lost`) |
| **frozen** (`frozenThisWeek`) | manual freeze on the open week, or (repair open) on the MISSED week (`freezeTarget` `current` / `missed`) | refunded if the goal is still hit; `undoFreezeThisWeek()` (`undoFreezeWeek`) |
| **auto freeze** | a week missed by 3+, or a failed repair, with a freeze held: week `frozen`, `freezeKind: 'auto'` | - |
| **lost** (`lost`, `lostStreak`) | the streak was reset at the end of LAST week (no repair possible, no freeze): gentle "New streak starts today. Your best is N". `best` is kept | any new secured week, or one more week passes |
| **celebrate** (`celebrate.unseen`) | `unseen` until `markStreakCelebrated()`; kept non-null for the rest of the week | next week |

Freezes: +1 per 4 counted (hit/repaired) weeks of the running streak (`countedWeeks`, `weeksUntilFreeze`, `nextFreezeAtWeek`), max 2 (an earn at the cap is `freezeWasted`); the counter restarts on reset. Tiers: Spark 1-3, Flame 4-11, Blaze 12-25, Inferno 26+. Milestone badges at 2/4/8/12/26/52; 18 badges in total (`badges`).
Weeks and "today" use the device zone (client) or the zone stored with the push subscription (server: MCP + push), as a fixed UTC offset (a DST change between the phone and the server's last tz refresh can shift a boundary by an hour at most).
`streakWeeks()` in rules.ts (plain consecutive goal weeks, constant goal) is kept for older callers; `computeStreak().current >= streakWeeks()` for a constant goal and no manual freezes (property test).

Push reminders (`push.ts`, pref `streak`, default on, one local day = at most one): Monday 08:00+ repair ("Save your streak. Do 5 this week and your 7 weeks stay."), Monday 08:00+ lost ("New streak starts today. Your best is 9." opens `/app/streak`), last chance (08:00+ while left == days left), tight pace (from the learned training hour, default 17:00). Never 21:00-07:00 local; evaluated at most every 15 min per user; the day is claimed in `push_streak` before sending.
**Not push:** "goal hit / repaired / milestone on finishing the session" is client-triggered (StreakCelebrate opens in the app); no server notification is sent for it. Not done: a per-user *learned* training time beyond the median start hour of the last 8 weeks, and the weekly Friday nudge and streak reminders are independent (a user can get both on the same day).

## 3.2 Heart rate (server-side, not in the offline store)

- **Settings.heartRate** `{enabled, intervalMin (5/10/15/30/60, default 15), maxHr?}` is an ordinary synced setting. Absent = off.
- **Readings** live in the server table `heart_rate(user_id, at, source, bpm, min, max)`, written by `POST /api/hr/ingest` with a
  write-only key (`rephr_...`, one per user, shown once, rotating invalidates the old one). Sources: the Health Auto Export app's REST
  automation, or an iPhone Shortcut. Formats and limits: `src/shared/heartrate.ts` (bpm 25-250, at <= now+5 min, <= 400 days old, 5000/request).
- **Read path**: the app asks `GET /api/hr/latest` every 15 s while a session is open and the tab is visible, and `GET /api/hr?from&to` for a
  finished session's card. Nothing is cached offline: offline / signed out / nothing connected renders `--` (live) or no card (summary).
- **Freshness**: live chip shows a number only for a reading <= 5 min old. Settings status calls a source stale after
  max(10 min, 2.5 x interval).
- **Privacy**: deleted by "Delete my data" and account deletion, included in `/api/export`, readable by the coach via `get_heart_rate` /
  `get_session_heart_rate` (read scope).

## 4. Fixes made while writing the tests (actions.ts / core.ts)
See the task report; each is covered by a test that fails on the old code.
