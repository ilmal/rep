// Shared domain types — used by client (offline) and server (sync validation).

export type Muscle =
  | 'Chest' | 'Lats' | 'Upper back' | 'Delts' | 'Rear delts' | 'Biceps' | 'Triceps' | 'Forearms'
  | 'Quads' | 'Hamstrings' | 'Glutes' | 'Calves' | 'Adductors' | 'Hip flexors'
  | 'Lower back' | 'Core' | 'Rotator cuff';

export type Pattern = 'push' | 'pull' | 'squat' | 'hinge' | 'lunge' | 'carry' | 'core' | 'mobility';
export type Tracking = 'weight_reps' | 'reps' | 'time';
export type EquipStatus = 'ok' | 'broken' | 'none';
export type EquipCategory = 'Free weights' | 'Racks & benches' | 'Machines' | 'Cables' | 'Other';
export type FilterGroup = 'Legs' | 'Back' | 'Chest' | 'Shoulders' | 'Arms' | 'Core' | 'Prehab';

export interface EquipItem {
  id: string;
  name: string;
  category: EquipCategory;
  note?: string;
}

export interface Exercise {
  id: string;
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  /** ALL of these must be available at the gym. Empty = bodyweight / no equipment. */
  equipment: string[];
  pattern: Pattern;
  /** 1 easy, 2 medium, 3 advanced */
  difficulty: 1 | 2 | 3;
  tracking: Tracking;
  /** kg per progression step (reps: +1 rep, time: +5 s are implicit) */
  weightStep: number;
  repMin: number;
  repMax: number;
  defaultSets: number;
  /** weight is per hand (dumbbells) */
  perHand?: boolean;
  /** shown in Prehab filter */
  prehab?: boolean;
  isCustom?: boolean;
  /** soft-deleted custom exercise */
  archived?: boolean;
  /** free-text how-to cue */
  cue?: string;
  tags?: string[];
  /** bodyweight progression: id of the next-harder variation (reps → tempo or time → this) */
  harder?: string;
  updatedAt?: number;
}

export type MediaKind = 'image' | 'video';
/** One image or video attached to an exercise. `video` covers direct files, YouTube/Vimeo embeds and plain links (see shared/content.ts detectMedia). */
export interface MediaItem {
  id: string;
  kind: MediaKind;
  /** https only */
  url: string;
  title?: string;
  caption?: string;
  /** where it came from, e.g. "YouTube / Squat University" */
  source?: string;
}
/**
 * How-to content for an exercise (read before performing it). Built-ins ship defaults (shared/exercise-content.ts);
 * the athlete / their coach AI stores overrides on the exercise's ExercisePref. Per field, a user value wins over the default.
 */
export interface ExerciseContent {
  summary?: string;
  /** how to do it, ordered */
  steps?: string[];
  /** coaching cues: what to think about while doing it */
  cues?: string[];
  /** tips, safety, setup, breathing, common mistakes, variations */
  goodToKnow?: string[];
  media?: MediaItem[];
}

/** Per-exercise user/coach preferences. Applies to built-in and custom exercises alike. */
export interface ExercisePref {
  exerciseId: string;
  favorite: boolean;
  /** banned: never planned, generated or swapped in (history kept, reversible) */
  avoid: boolean;
  /** paused until this epoch-ms (PAUSE_FOREVER = until resumed). Returns automatically. */
  pausedUntil?: number;
  /** paused for the next N completed sessions */
  pausedSessions?: number;
  /** 0–100, how relevant this exercise is to the current plan. Default 50. Tuned by you / your coach. */
  relevance: number;
  /** override planner cooldown: skip if done within the last N sessions */
  cooldownSessions?: number;
  /** override planner: minimum days between performances */
  minDaysBetween?: number;
  notes?: string;
  /** user / coach authored how-to content overriding the built-in defaults per field (absent = all defaults). Never affects planning. */
  content?: ExerciseContent;
  updatedAt?: number;
}

/** Every knob of the exercise-selection algorithm. */
export interface PlannerConfig {
  /** weights (relative importance) */
  wRelevance: number;
  wRecency: number;
  wFrequency: number;
  wCoverage: number;
  wVariety: number;
  wFavorite: number;
  /** don't repeat an exercise within the last N completed sessions */
  cooldownSessions: number;
  /** ...nor within N days */
  minDaysBetween: number;
  /** days until an exercise counts as fully "fresh" */
  freshDays: number;
  /** window for frequency + muscle coverage */
  windowDays: number;
  /** muscle is "overdue" after this many days (coverage saturates) */
  muscleOverdueDays: number;
  /** 0 = deterministic, higher = more random variety in ties */
  jitter: number;
}

export type CoachPlanStatus = 'pending' | 'used' | 'cancelled';
export interface CoachPlanItem {
  exerciseId: string;
  sets?: number;
  reps?: number;
  weight?: number;
  restSec?: number;
  note?: string;
}
/** A workout authored by a coach (e.g. Grok via MCP) that the app uses for the next matching session. */
export interface CoachPlan {
  id: string;
  title: string;
  note?: string;
  /** apply to this rotation slot (1-based) … */
  slot?: number;
  /** … or this area; if neither, the next session of any kind */
  areaId?: string;
  exercises: CoachPlanItem[];
  status: CoachPlanStatus;
  createdBy: string;
  createdAt: number;
  usedBySessionId?: string;
  updatedAt?: number;
}

export type AreaMode = 'auto' | 'fixed';

export interface Area {
  id: string;
  name: string;
  desc?: string;
  focusMuscles: Muscle[];
  exercisesPerSession: number;
  mode: AreaMode;
  pinnedExerciseIds: string[];
  poolExerciseIds: string[];
  updatedAt?: number;
}

export interface GymEquipment {
  /** equipment id -> status. Absent / 'none' = not at this gym. */
  [equipId: string]: EquipStatus;
}

export interface Gym {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
  equipment: GymEquipment;
  /** per-item free-text notes e.g. "Broken since Tue" */
  notes: Record<string, string>;
  /** ms epoch when each broken item was marked */
  brokenSince: Record<string, number>;
  lastVisitedAt?: number;
  createdAt: number;
  deleted?: boolean;
  updatedAt?: number;
}

export interface Feedback {
  effort: 'chill' | 'normal' | 'hard';
  weight: 'light' | 'right' | 'heavy';
  volume: 'reps' | 'sets' | 'ok';
}

export interface Recommendation {
  weight: number;
  reps: number;
  sets: number;
  kind: 'weight_up' | 'weight_down' | 'rep_up' | 'hold' | 'volume_down' | 'tempo' | 'harder';
  /** short tag, e.g. "+2.5 kg" */
  tag: string;
  /** kind 'harder': the exercise id to progress to */
  harderId?: string;
  /** bodyweight stage after this rec: reps are done with a slow 3 s tempo */
  tempo?: boolean;
  why: string;
  ruleVersion: number;
}

export interface SetLog {
  weight: number;
  reps: number;
  seconds?: number;
  startedAt?: number;
  doneAt: number;
  restSec?: number;
}

export interface SessionExercise {
  id: string;
  exerciseId: string;
  name: string;
  order: number;
  tracking: Tracking;
  perHand?: boolean;
  weightStep: number;
  repMin: number;
  repMax: number;
  plannedSets: number;
  repTarget: number;
  plannedWeight: number;
  /** bodyweight progression: do the reps with a slow 3 s lowering */
  tempo?: boolean;
  restSec: number;
  estSec: number;
  status: 'todo' | 'active' | 'done' | 'skipped' | 'dropped';
  startedAt?: number;
  endedAt?: number;
  swappedFrom?: { exerciseId: string; name: string; reason: 'busy' | 'broken' | 'gone' | 'dont' | 'pain' };
  sets: SetLog[];
  feedback?: Feedback;
  recommendation?: Recommendation;
  /** set once the athlete taps 'Start set 1' (before that the live screen shows 'Up next') */
  begunAt?: number;
  /** set when 'go lighter' (it hurts) reduced the remaining load */
  lighterAt?: number;
  /** true if pinned in area (never auto-dropped first) */
  pinned?: boolean;
  /** PR flag computed on completion */
  pr?: boolean;
}

export interface Adjustment {
  id: string;
  at: number;
  type: 'trim_rest' | 'drop' | 'warmup_overrun';
  exerciseId?: string;
  savedSec: number;
  undone?: boolean;
  /** previous restSec, so undo can restore */
  prevRestSec?: Record<string, number>;
  text: string;
}

export type SessionStatus = 'planned' | 'active' | 'completed' | 'discarded';

export interface Session {
  id: string;
  seq: number;
  slot: number;
  areaId: string;
  areaName: string;
  gymId: string | null;
  gymName: string;
  status: SessionStatus;
  /** wall-clock ms */
  startedAt: number;
  warmupStartedAt?: number;
  warmupEndedAt?: number;
  warmupItems?: { name: string; meta: string; done: boolean }[];
  endedAt?: number;
  endedEarly?: boolean;
  targetMin: number;
  warmupTargetMin: number;
  exercises: SessionExercise[];
  adjustments: Adjustment[];
  busyEquip: string[];
  /** index into exercises[] of the exercise in progress */
  cursor: number;
  /** current phase for resume */
  phase: 'warmup' | 'set' | 'rest' | 'fb' | 'done';
  restEndsAt?: number;
  restTotalSec?: number;
  note?: string;
  source?: 'auto' | 'coach';
  coachPlanId?: string;
  /** ended early and the athlete wants this same slot again next time (pointer does not advance) */
  repeatNext?: boolean;
  /** optional reasons chosen when ending early */
  endReason?: string[];
  updatedAt: number;
}

export type Unit = 'kg' | 'lb';

export interface Settings {
  name: string;
  onboarded: boolean;
  weeklyGoal: number;
  targetMinutes: number;
  warmupTargetMinutes: number;
  restSec: number;
  unit: Unit;
  sound: boolean;
  gps: boolean;
  fitToTime: boolean;
  suggestSwaps: boolean;
  aiAssist: boolean;
  /** area ids by rotation position (index 0 = slot 1) */
  rotation: string[];
  planner: PlannerConfig;
  /** free text about goals, injuries, preferences: read & written by you and your coach */
  profileNotes: string;
  /**
   * Streak: weekly goal over time, ascending by `from` (week-start ms, local Monday 00:00; 0 = since forever). A change of
   * `weeklyGoal` appends an entry effective NEXT Monday (see applyGoalChange in streak.ts). Absent = `weeklyGoal` for every week.
   */
  goalHistory?: { from: number; goal: number }[];
  /** Streak: week-start ms of weeks covered by a manual freeze (refunded by replay if the goal is still hit). */
  manualFreezeWeeks?: number[];
  /** Streak: week-start ms of the last week whose StreakCelebrate screen was shown (so it shows once per week). */
  streakLastCelebrated?: number;
  updatedAt: number;
}

/** Per-exercise progression state: what to do next time. */
export interface ProgressEntry {
  exerciseId: string;
  weight: number;
  reps: number;
  sets: number;
  /** bodyweight progression stage: reps hit the ceiling, now doing them with a slow 3 s tempo */
  tempo?: boolean;
  lastRec?: Recommendation;
  updatedAt: number;
}

// ---- Sync wire format ----
export type EntityType = 'settings' | 'gym' | 'area' | 'exercise' | 'progress' | 'session' | 'pref' | 'plan';

export interface EntityChange {
  type: EntityType;
  id: string;
  /** client wall-clock at the time of the edit (used for LWW) */
  updatedAt: number;
  deleted?: boolean;
  data: unknown;
}

export interface AppEvent {
  id: string;
  at: number;
  kind: string;
  sessionId?: string;
  payload?: unknown;
}
