import type { Exercise, Muscle, Pattern, Tracking, FilterGroup, Area } from './types';

type Row = {
  id: string; name: string; p: Muscle[]; s?: Muscle[]; eq: string[]; pat: Pattern; d: 1 | 2 | 3;
  t?: Tracking; step?: number; reps?: [number, number]; sets?: number; each?: boolean; pre?: boolean; cue?: string; harder?: string;
};

const R: Row[] = [
  // ---- Lower body
  { id: 'back_squat', name: 'Back squat', p: ['Quads', 'Glutes'], s: ['Hamstrings', 'Core', 'Lower back'], eq: ['barbell', 'squat_rack'], pat: 'squat', d: 3, step: 2.5, reps: [5, 8], sets: 4, cue: 'Brace, sit between the hips, knees track over toes.' },
  { id: 'front_squat', name: 'Front squat', p: ['Quads'], s: ['Glutes', 'Core'], eq: ['barbell', 'squat_rack'], pat: 'squat', d: 3, step: 2.5, reps: [5, 8], sets: 4 },
  { id: 'smith_squat', name: 'Smith machine squat', p: ['Quads', 'Glutes'], s: ['Hamstrings'], eq: ['smith'], pat: 'squat', d: 2, step: 2.5, reps: [6, 10], sets: 4 },
  { id: 'leg_press', name: 'Leg press', p: ['Quads', 'Glutes'], s: ['Hamstrings'], eq: ['leg_press'], pat: 'squat', d: 1, step: 5, reps: [8, 12], sets: 3 },
  { id: 'hack_squat', name: 'Hack squat', p: ['Quads'], s: ['Glutes'], eq: ['hack_squat'], pat: 'squat', d: 2, step: 5, reps: [6, 10], sets: 3 },
  { id: 'goblet_squat', name: 'Goblet squat', p: ['Quads', 'Glutes'], s: ['Core'], eq: ['dumbbells'], pat: 'squat', d: 1, step: 2, reps: [8, 12], sets: 3 },
  { id: 'bulgarian_split', name: 'Bulgarian split squat', p: ['Quads', 'Glutes'], s: ['Hamstrings', 'Adductors'], eq: ['dumbbells', 'flat_bench'], pat: 'lunge', d: 2, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'walking_lunge', name: 'Walking lunge', p: ['Quads', 'Glutes'], s: ['Hamstrings'], eq: ['dumbbells'], pat: 'lunge', d: 2, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'reverse_lunge', name: 'Dumbbell reverse lunge', p: ['Quads', 'Glutes'], s: ['Hamstrings'], eq: ['dumbbells'], pat: 'lunge', d: 2, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'step_up', name: 'Step-up', p: ['Quads', 'Glutes'], s: [], eq: ['dumbbells', 'box'], pat: 'lunge', d: 1, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'leg_ext', name: 'Leg extension', p: ['Quads'], s: [], eq: ['leg_ext'], pat: 'squat', d: 1, step: 5, reps: [10, 15], sets: 3 },
  { id: 'rdl', name: 'Romanian deadlift', p: ['Hamstrings', 'Glutes'], s: ['Lower back'], eq: ['barbell'], pat: 'hinge', d: 2, step: 2.5, reps: [6, 10], sets: 3 },
  { id: 'db_rdl', name: 'Dumbbell RDL', p: ['Hamstrings', 'Glutes'], s: ['Lower back'], eq: ['dumbbells'], pat: 'hinge', d: 1, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'deadlift', name: 'Deadlift', p: ['Hamstrings', 'Glutes', 'Lower back'], s: ['Lats', 'Upper back', 'Quads', 'Forearms'], eq: ['barbell'], pat: 'hinge', d: 3, step: 5, reps: [3, 6], sets: 4 },
  { id: 'trap_deadlift', name: 'Trap bar deadlift', p: ['Quads', 'Glutes', 'Hamstrings'], s: ['Upper back', 'Lower back'], eq: ['trap_bar'], pat: 'hinge', d: 2, step: 5, reps: [4, 8], sets: 4 },
  { id: 'hip_thrust', name: 'Hip thrust', p: ['Glutes'], s: ['Hamstrings'], eq: ['barbell', 'flat_bench'], pat: 'hinge', d: 2, step: 5, reps: [8, 12], sets: 3 },
  { id: 'glute_bridge', name: 'Glute bridge', p: ['Glutes'], s: ['Hamstrings'], eq: [], pat: 'hinge', d: 1, t: 'reps', reps: [12, 20], sets: 3, harder: 'glute_bridge_march' },
  { id: 'cable_pullthrough', name: 'Cable pull-through', p: ['Glutes', 'Hamstrings'], s: ['Lower back'], eq: ['cable_station'], pat: 'hinge', d: 1, step: 2.5, reps: [10, 15], sets: 3 },
  { id: 'back_extension', name: '45° back extension', p: ['Lower back', 'Glutes'], s: ['Hamstrings'], eq: ['back_ext'], pat: 'hinge', d: 1, step: 2.5, reps: [10, 15], sets: 3 },
  { id: 'seated_leg_curl', name: 'Seated leg curl', p: ['Hamstrings'], s: [], eq: ['seated_leg_curl'], pat: 'hinge', d: 1, step: 5, reps: [10, 15], sets: 3 },
  { id: 'lying_leg_curl', name: 'Lying leg curl', p: ['Hamstrings'], s: ['Calves'], eq: ['lying_leg_curl'], pat: 'hinge', d: 1, step: 5, reps: [10, 15], sets: 3 },
  { id: 'nordic_curl', name: 'Nordic curl', p: ['Hamstrings'], s: ['Glutes'], eq: ['nordic_bench'], pat: 'hinge', d: 3, t: 'reps', reps: [3, 8], sets: 3, pre: true },
  { id: 'swiss_curl', name: 'Swiss-ball leg curl', p: ['Hamstrings', 'Glutes'], s: ['Core'], eq: ['stability_ball'], pat: 'hinge', d: 2, t: 'reps', reps: [8, 15], sets: 3 },
  { id: 'calf_raise_standing', name: 'Standing calf raise', p: ['Calves'], s: [], eq: ['calf_machine'], pat: 'push', d: 1, step: 5, reps: [10, 20], sets: 3 },
  { id: 'calf_raise_bw', name: 'Single-leg calf raise', p: ['Calves'], s: [], eq: [], pat: 'push', d: 1, t: 'reps', reps: [12, 20], sets: 3 },
  { id: 'hip_abduction', name: 'Hip abduction machine', p: ['Glutes'], s: ['Adductors'], eq: ['hip_abductor'], pat: 'push', d: 1, step: 5, reps: [12, 20], sets: 3 },
  { id: 'kb_swing', name: 'Kettlebell swing', p: ['Glutes', 'Hamstrings'], s: ['Core', 'Lower back'], eq: ['kettlebells'], pat: 'hinge', d: 2, step: 4, reps: [10, 20], sets: 4 },

  // ---- Push
  { id: 'bench_press', name: 'Bench press', p: ['Chest'], s: ['Triceps', 'Delts'], eq: ['barbell', 'flat_bench'], pat: 'push', d: 3, step: 2.5, reps: [5, 8], sets: 4 },
  { id: 'incline_db_press', name: 'Incline DB press', p: ['Chest'], s: ['Delts', 'Triceps'], eq: ['dumbbells', 'adj_bench'], pat: 'push', d: 2, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'db_bench', name: 'Dumbbell bench press', p: ['Chest'], s: ['Triceps', 'Delts'], eq: ['dumbbells', 'flat_bench'], pat: 'push', d: 2, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'chest_press_machine', name: 'Chest press machine', p: ['Chest'], s: ['Triceps', 'Delts'], eq: ['chest_press_m'], pat: 'push', d: 1, step: 5, reps: [8, 12], sets: 3 },
  { id: 'pushup', name: 'Push-ups', p: ['Chest'], s: ['Triceps', 'Delts', 'Core'], eq: [], pat: 'push', d: 1, t: 'reps', reps: [8, 20], sets: 3, harder: 'diamond_pushup' },
  { id: 'dips', name: 'Dips', p: ['Chest', 'Triceps'], s: ['Delts'], eq: ['dip_station'], pat: 'push', d: 3, t: 'reps', reps: [6, 12], sets: 3 },
  { id: 'ohp', name: 'Overhead press', p: ['Delts'], s: ['Triceps', 'Core'], eq: ['barbell'], pat: 'push', d: 3, step: 2.5, reps: [5, 8], sets: 3 },
  { id: 'db_shoulder_press', name: 'Dumbbell shoulder press', p: ['Delts'], s: ['Triceps'], eq: ['dumbbells', 'adj_bench'], pat: 'push', d: 2, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'shoulder_press_machine', name: 'Shoulder press machine', p: ['Delts'], s: ['Triceps'], eq: ['shoulder_press_m'], pat: 'push', d: 1, step: 5, reps: [8, 12], sets: 3 },
  { id: 'landmine_press', name: 'Landmine press', p: ['Delts', 'Chest'], s: ['Triceps', 'Core'], eq: ['landmine', 'barbell'], pat: 'push', d: 2, step: 2.5, reps: [8, 12], sets: 3 },
  { id: 'lateral_raise', name: 'Lateral raise', p: ['Delts'], s: [], eq: ['dumbbells'], pat: 'push', d: 1, step: 1, reps: [12, 20], sets: 3, each: true },
  { id: 'cable_lateral', name: 'Cable lateral raise', p: ['Delts'], s: [], eq: ['cable_station'], pat: 'push', d: 1, step: 2.5, reps: [12, 20], sets: 3 },
  { id: 'pec_fly', name: 'Pec deck fly', p: ['Chest'], s: ['Delts'], eq: ['pec_deck'], pat: 'push', d: 1, step: 5, reps: [10, 15], sets: 3 },
  { id: 'cable_fly', name: 'Cable fly', p: ['Chest'], s: ['Delts'], eq: ['cable_station'], pat: 'push', d: 1, step: 2.5, reps: [10, 15], sets: 3 },
  { id: 'tricep_pushdown', name: 'Triceps pushdown', p: ['Triceps'], s: [], eq: ['cable_station'], pat: 'push', d: 1, step: 2.5, reps: [10, 15], sets: 3 },
  { id: 'skullcrusher', name: 'EZ-bar skullcrusher', p: ['Triceps'], s: [], eq: ['ez_bar', 'flat_bench'], pat: 'push', d: 2, step: 2.5, reps: [8, 12], sets: 3 },
  { id: 'db_triceps_ext', name: 'Overhead triceps extension', p: ['Triceps'], s: [], eq: ['dumbbells'], pat: 'push', d: 1, step: 2, reps: [10, 15], sets: 3 },

  // ---- Pull
  { id: 'pullup', name: 'Pull-ups', p: ['Lats'], s: ['Biceps', 'Upper back'], eq: ['pullup_bar'], pat: 'pull', d: 3, t: 'reps', reps: [4, 10], sets: 3 },
  { id: 'assisted_pullup', name: 'Assisted pull-up', p: ['Lats'], s: ['Biceps'], eq: ['assisted_pullup'], pat: 'pull', d: 2, step: 5, reps: [6, 10], sets: 3 },
  { id: 'lat_pulldown', name: 'Lat pulldown', p: ['Lats'], s: ['Biceps', 'Upper back'], eq: ['lat_pulldown'], pat: 'pull', d: 1, step: 5, reps: [8, 12], sets: 3 },
  { id: 'barbell_row', name: 'Barbell row', p: ['Upper back', 'Lats'], s: ['Biceps', 'Lower back', 'Rear delts'], eq: ['barbell'], pat: 'pull', d: 3, step: 2.5, reps: [6, 10], sets: 4 },
  { id: 'db_row', name: 'One-arm dumbbell row', p: ['Lats', 'Upper back'], s: ['Biceps'], eq: ['dumbbells', 'flat_bench'], pat: 'pull', d: 1, step: 2, reps: [8, 12], sets: 3, each: true },
  { id: 'seated_row', name: 'Seated cable row', p: ['Upper back', 'Lats'], s: ['Biceps', 'Rear delts'], eq: ['seated_row'], pat: 'pull', d: 1, step: 5, reps: [8, 12], sets: 3 },
  { id: 'chest_supported_row', name: 'Chest-supported row', p: ['Upper back', 'Lats'], s: ['Biceps', 'Rear delts'], eq: ['row_machine'], pat: 'pull', d: 1, step: 5, reps: [8, 12], sets: 3 },
  { id: 'face_pull', name: 'Cable face pull', p: ['Rear delts', 'Rotator cuff'], s: ['Upper back'], eq: ['cable_station'], pat: 'pull', d: 1, step: 2.5, reps: [12, 20], sets: 3, pre: true },
  { id: 'reverse_fly', name: 'Reverse fly machine', p: ['Rear delts'], s: ['Upper back'], eq: ['pec_deck'], pat: 'pull', d: 1, step: 2.5, reps: [12, 20], sets: 3 },
  { id: 'db_rear_delt', name: 'Bent-over rear delt raise', p: ['Rear delts'], s: ['Upper back'], eq: ['dumbbells'], pat: 'pull', d: 1, step: 1, reps: [12, 20], sets: 3, each: true },
  { id: 'band_pullapart', name: 'Band pull-apart', p: ['Rear delts', 'Upper back'], s: ['Rotator cuff'], eq: ['bands'], pat: 'mobility', d: 1, t: 'reps', reps: [15, 25], sets: 3, pre: true },
  { id: 'db_curl', name: 'Dumbbell curl', p: ['Biceps'], s: ['Forearms'], eq: ['dumbbells'], pat: 'pull', d: 1, step: 1, reps: [8, 12], sets: 3, each: true },
  { id: 'ez_curl', name: 'EZ-bar curl', p: ['Biceps'], s: ['Forearms'], eq: ['ez_bar'], pat: 'pull', d: 1, step: 2.5, reps: [8, 12], sets: 3 },
  { id: 'cable_curl', name: 'Cable curl', p: ['Biceps'], s: [], eq: ['cable_station'], pat: 'pull', d: 1, step: 2.5, reps: [10, 15], sets: 3 },
  { id: 'hammer_curl', name: 'Hammer curl', p: ['Biceps', 'Forearms'], s: [], eq: ['dumbbells'], pat: 'pull', d: 1, step: 1, reps: [8, 12], sets: 3, each: true },
  { id: 'shrug', name: 'Dumbbell shrug', p: ['Upper back'], s: ['Forearms'], eq: ['dumbbells'], pat: 'pull', d: 1, step: 2, reps: [10, 15], sets: 3, each: true },

  // ---- Carry / core
  { id: 'farmer_carry', name: 'Farmer carry', p: ['Forearms', 'Core'], s: ['Upper back', 'Glutes'], eq: ['dumbbells'], pat: 'carry', d: 1, t: 'time', step: 2, reps: [30, 60], sets: 3, each: true },
  { id: 'plank', name: 'Plank', p: ['Core'], s: ['Delts'], eq: [], pat: 'core', d: 1, t: 'time', reps: [30, 90], sets: 3, harder: 'plank_tap' },
  { id: 'side_plank', name: 'Side plank', p: ['Core'], s: ['Glutes'], eq: [], pat: 'core', d: 1, t: 'time', reps: [20, 60], sets: 3, pre: true },
  { id: 'dead_bug', name: 'Dead bug', p: ['Core'], s: ['Hip flexors'], eq: ['mat'], pat: 'core', d: 1, t: 'reps', reps: [8, 14], sets: 3, pre: true },
  { id: 'cable_crunch', name: 'Cable crunch', p: ['Core'], s: [], eq: ['cable_station'], pat: 'core', d: 1, step: 2.5, reps: [10, 15], sets: 3 },
  { id: 'hanging_knee_raise', name: 'Hanging knee raise', p: ['Core', 'Hip flexors'], s: ['Forearms'], eq: ['pullup_bar'], pat: 'core', d: 2, t: 'reps', reps: [8, 15], sets: 3 },
  { id: 'ab_rollout', name: 'Ab wheel rollout', p: ['Core'], s: ['Lats'], eq: ['ab_wheel'], pat: 'core', d: 3, t: 'reps', reps: [6, 12], sets: 3 },
  { id: 'pallof_press', name: 'Pallof press', p: ['Core'], s: ['Delts'], eq: ['cable_station'], pat: 'core', d: 1, step: 2.5, reps: [10, 15], sets: 3, pre: true },
  { id: 'copenhagen', name: 'Copenhagen plank', p: ['Adductors', 'Core'], s: [], eq: ['flat_bench'], pat: 'core', d: 2, t: 'time', reps: [15, 40], sets: 3, pre: true },
  { id: 'bird_dog', name: 'Bird dog', p: ['Core', 'Lower back'], s: ['Glutes'], eq: ['mat'], pat: 'core', d: 1, t: 'reps', reps: [8, 14], sets: 3, pre: true },

  // ---- Prehab / mobility
  { id: 'hip_9090', name: '90/90 hip switch', p: ['Hip flexors', 'Glutes'], s: [], eq: ['mat'], pat: 'mobility', d: 1, t: 'reps', reps: [6, 12], sets: 2, pre: true },
  { id: 'cuban_press', name: 'Cuban press', p: ['Rotator cuff', 'Rear delts'], s: ['Delts'], eq: ['dumbbells'], pat: 'mobility', d: 2, step: 1, reps: [8, 12], sets: 3, pre: true },
  { id: 'ext_rotation', name: 'Band external rotation', p: ['Rotator cuff'], s: ['Rear delts'], eq: ['bands'], pat: 'mobility', d: 1, t: 'reps', reps: [12, 20], sets: 2, pre: true },
  { id: 'cable_ext_rotation', name: 'Cable external rotation', p: ['Rotator cuff'], s: ['Rear delts'], eq: ['cable_station'], pat: 'mobility', d: 1, step: 1, reps: [12, 20], sets: 2, pre: true },
  { id: 'cat_cow', name: 'Cat-cow', p: ['Lower back', 'Core'], s: [], eq: ['mat'], pat: 'mobility', d: 1, t: 'reps', reps: [8, 12], sets: 2, pre: true },
  { id: 'thoracic_roll', name: 'Thoracic foam roll', p: ['Upper back'], s: [], eq: ['foam_roller'], pat: 'mobility', d: 1, t: 'time', reps: [30, 60], sets: 2, pre: true },
  { id: 'couch_stretch', name: 'Couch stretch', p: ['Hip flexors', 'Quads'], s: [], eq: ['mat'], pat: 'mobility', d: 1, t: 'time', reps: [30, 60], sets: 2, pre: true },
  { id: 'tibialis_raise', name: 'Tibialis raise', p: ['Calves'], s: [], eq: [], pat: 'mobility', d: 1, t: 'reps', reps: [15, 25], sets: 3, pre: true },
  { id: 'sled_push', name: 'Sled push', p: ['Quads', 'Glutes'], s: ['Calves', 'Core'], eq: ['sled'], pat: 'push', d: 2, t: 'time', step: 10, reps: [15, 30], sets: 4 },
  { id: 'bike_intervals', name: 'Bike intervals', p: ['Quads'], s: ['Calves', 'Glutes'], eq: ['bike'], pat: 'carry', d: 2, t: 'time', reps: [30, 60], sets: 6 },

  // ---- Bodyweight (no equipment: floor and wall only). Progression: reps → tempo or time → `harder` variation.
  { id: 'wall_pushup', name: 'Wall push-up', p: ['Chest'], s: ['Triceps', 'Delts'], eq: [], pat: 'push', d: 1, t: 'reps', reps: [10, 25], sets: 3, harder: 'pushup', cue: 'Hands on a wall, body in one line, chest to the wall.' },
  { id: 'diamond_pushup', name: 'Diamond push-up', p: ['Triceps', 'Chest'], s: ['Delts', 'Core'], eq: [], pat: 'push', d: 2, t: 'reps', reps: [6, 15], sets: 3, harder: 'archer_pushup', cue: 'Thumbs and index fingers touching under the chest.' },
  { id: 'archer_pushup', name: 'Archer push-up', p: ['Chest', 'Triceps'], s: ['Delts', 'Core'], eq: [], pat: 'push', d: 3, t: 'reps', reps: [3, 10], sets: 3, cue: 'Wide hands, lower over one arm while the other stays straight.' },
  { id: 'pike_pushup', name: 'Pike push-up', p: ['Delts'], s: ['Triceps', 'Upper back'], eq: [], pat: 'push', d: 2, t: 'reps', reps: [6, 15], sets: 3, harder: 'wall_handstand', cue: 'Hips high, head moves between the hands.' },
  { id: 'wall_handstand', name: 'Wall handstand hold', p: ['Delts'], s: ['Triceps', 'Core'], eq: [], pat: 'push', d: 3, t: 'time', reps: [15, 45], sets: 3, cue: 'Kick up facing the wall, stack the body, press the floor away.' },
  { id: 'chair_dips', name: 'Chair dips', p: ['Triceps'], s: ['Chest', 'Delts'], eq: [], pat: 'push', d: 2, t: 'reps', reps: [8, 20], sets: 3, cue: 'Hands on a sturdy chair or the edge of a sofa.' },
  { id: 'plank_tap', name: 'Plank shoulder tap', p: ['Core'], s: ['Delts'], eq: [], pat: 'core', d: 2, t: 'reps', reps: [12, 30], sets: 3, harder: 'hollow_hold', cue: 'Keep the hips still while each hand taps the opposite shoulder.' },
  { id: 'towel_row', name: 'Towel row', p: ['Lats', 'Upper back'], s: ['Biceps', 'Rear delts'], eq: [], pat: 'pull', d: 2, t: 'reps', reps: [8, 15], sets: 3, cue: 'Towel around a door handle, lean back and row yourself to the door.' },
  { id: 'superman', name: 'Superman hold', p: ['Lower back', 'Upper back'], s: ['Glutes'], eq: [], pat: 'pull', d: 1, t: 'time', reps: [20, 45], sets: 3 },
  { id: 'prone_y', name: 'Prone Y raise', p: ['Rear delts', 'Upper back'], s: ['Rotator cuff'], eq: [], pat: 'pull', d: 1, t: 'reps', reps: [10, 15], sets: 3, pre: true },
  { id: 'wall_slide', name: 'Wall slide', p: ['Rotator cuff', 'Upper back'], s: ['Delts'], eq: [], pat: 'mobility', d: 1, t: 'reps', reps: [8, 15], sets: 2, pre: true, cue: 'Back and arms against the wall, slide the arms up and down.' },
  { id: 'towel_curl', name: 'Isometric towel curl', p: ['Biceps'], s: ['Forearms'], eq: [], pat: 'pull', d: 1, t: 'time', reps: [20, 40], sets: 3, cue: 'Stand on a towel, pull up on the ends as if curling, hold.' },
  { id: 'bw_good_morning', name: 'Hip hinge good morning', p: ['Hamstrings', 'Glutes'], s: ['Lower back'], eq: [], pat: 'hinge', d: 1, t: 'reps', reps: [10, 20], sets: 3, harder: 'single_leg_rdl', cue: 'Hands behind the head, hinge at the hips with a flat back.' },
  { id: 'bw_squat', name: 'Bodyweight squat', p: ['Quads', 'Glutes'], s: ['Core'], eq: [], pat: 'squat', d: 1, t: 'reps', reps: [12, 25], sets: 3, harder: 'tempo_squat' },
  { id: 'tempo_squat', name: 'Tempo squat', p: ['Quads', 'Glutes'], s: ['Core', 'Hamstrings'], eq: [], pat: 'squat', d: 2, t: 'reps', reps: [10, 20], sets: 4, harder: 'pistol_squat', cue: '3 seconds down, pause at the bottom, stand up fast.' },
  { id: 'pistol_squat', name: 'Pistol squat', p: ['Quads', 'Glutes'], s: ['Core', 'Adductors'], eq: [], pat: 'squat', d: 3, t: 'reps', reps: [3, 8], sets: 3, each: true },
  { id: 'single_leg_rdl', name: 'Single-leg RDL', p: ['Hamstrings', 'Glutes'], s: ['Lower back', 'Core'], eq: [], pat: 'hinge', d: 2, t: 'reps', reps: [8, 12], sets: 3, each: true },
  { id: 'bw_reverse_lunge', name: 'Reverse lunge', p: ['Quads', 'Glutes'], s: ['Hamstrings'], eq: [], pat: 'lunge', d: 1, t: 'reps', reps: [8, 15], sets: 3, each: true, harder: 'split_squat' },
  { id: 'split_squat', name: 'Split squat', p: ['Quads', 'Glutes'], s: ['Hamstrings', 'Adductors'], eq: [], pat: 'lunge', d: 2, t: 'reps', reps: [8, 15], sets: 3, each: true, harder: 'pistol_squat' },
  { id: 'lateral_lunge', name: 'Lateral lunge', p: ['Quads', 'Adductors', 'Glutes'], s: ['Hamstrings'], eq: [], pat: 'lunge', d: 2, t: 'reps', reps: [8, 12], sets: 3, each: true },
  { id: 'glute_bridge_march', name: 'Glute bridge march', p: ['Glutes'], s: ['Hamstrings', 'Core'], eq: [], pat: 'hinge', d: 2, t: 'reps', reps: [12, 24], sets: 3, harder: 'sl_glute_bridge' },
  { id: 'sl_glute_bridge', name: 'Single-leg glute bridge', p: ['Glutes', 'Hamstrings'], s: ['Core'], eq: [], pat: 'hinge', d: 2, t: 'reps', reps: [8, 15], sets: 3, each: true },
  { id: 'wall_sit', name: 'Wall sit', p: ['Quads'], s: ['Glutes'], eq: [], pat: 'squat', d: 1, t: 'time', reps: [30, 90], sets: 3, cue: 'Back flat on the wall, thighs parallel to the floor.' },
  { id: 'jump_squat', name: 'Squat jumps', p: ['Quads', 'Glutes'], s: ['Calves', 'Core'], eq: [], pat: 'squat', d: 2, t: 'reps', reps: [8, 15], sets: 3, cue: 'Soft landing, reset between reps.' },
  { id: 'squat_to_pressup', name: 'Squat to press-up', p: ['Quads', 'Chest'], s: ['Glutes', 'Triceps', 'Core'], eq: [], pat: 'push', d: 2, t: 'reps', reps: [6, 12], sets: 3, harder: 'burpee' },
  { id: 'burpee', name: 'Burpee', p: ['Quads', 'Chest'], s: ['Core', 'Glutes', 'Delts'], eq: [], pat: 'carry', d: 3, t: 'reps', reps: [6, 15], sets: 3 },
  { id: 'hollow_hold', name: 'Hollow hold', p: ['Core'], s: ['Hip flexors'], eq: [], pat: 'core', d: 2, t: 'time', reps: [15, 45], sets: 3 },
  { id: 'mountain_climber', name: 'Mountain climber', p: ['Core', 'Hip flexors'], s: ['Delts', 'Quads'], eq: [], pat: 'core', d: 1, t: 'time', reps: [20, 45], sets: 3, harder: 'hollow_hold' },
];

const bodyweightish = (t: Tracking) => t !== 'weight_reps';

export const SEED_EXERCISES: Exercise[] = R.map((r) => ({
  id: r.id,
  name: r.name,
  primary: r.p,
  secondary: r.s ?? [],
  equipment: r.eq,
  pattern: r.pat,
  difficulty: r.d,
  tracking: r.t ?? 'weight_reps',
  weightStep: bodyweightish(r.t ?? 'weight_reps') ? 0 : (r.step ?? 2.5),
  repMin: r.reps?.[0] ?? 8,
  repMax: r.reps?.[1] ?? 12,
  defaultSets: r.sets ?? 3,
  perHand: r.each,
  prehab: r.pre,
  cue: r.cue,
  harder: r.harder,
}));

export const SEED_BY_ID: Record<string, Exercise> = Object.fromEntries(SEED_EXERCISES.map((e) => [e.id, e]));

export const FILTER_GROUPS: FilterGroup[] = ['Legs', 'Back', 'Chest', 'Shoulders', 'Arms', 'Core', 'Prehab'];

const MUSCLE_GROUP: Partial<Record<Muscle, FilterGroup>> = {
  Quads: 'Legs', Hamstrings: 'Legs', Glutes: 'Legs', Calves: 'Legs', Adductors: 'Legs', 'Hip flexors': 'Legs',
  Lats: 'Back', 'Upper back': 'Back', 'Lower back': 'Back', 'Rear delts': 'Back',
  Chest: 'Chest', Delts: 'Shoulders', 'Rotator cuff': 'Shoulders',
  Biceps: 'Arms', Triceps: 'Arms', Forearms: 'Arms', Core: 'Core',
};

export function exerciseGroups(e: Exercise): FilterGroup[] {
  const g = new Set<FilterGroup>();
  for (const m of e.primary) {
    const x = MUSCLE_GROUP[m];
    if (x) g.add(x);
  }
  if (e.prehab) g.add('Prehab');
  return [...g];
}

// ---- Default areas (used by onboarding and as pick-list) ----
export interface AreaTemplate {
  name: string;
  desc: string;
  focus: Muscle[];
  count: number;
  pinned: string[];
  pool: string[];
}

export const AREA_TEMPLATES: AreaTemplate[] = [
  {
    name: 'Upper body', desc: 'Chest, back, shoulders, arms', count: 5,
    focus: ['Chest', 'Lats', 'Upper back', 'Delts', 'Biceps', 'Triceps'],
    pinned: ['bench_press', 'seated_row'],
    pool: ['bench_press', 'incline_db_press', 'db_bench', 'chest_press_machine', 'ohp', 'db_shoulder_press', 'shoulder_press_machine', 'lat_pulldown', 'seated_row', 'barbell_row', 'db_row', 'chest_supported_row', 'pullup', 'face_pull', 'lateral_raise', 'db_curl', 'tricep_pushdown', 'dips', 'pec_fly', 'cable_fly'],
  },
  {
    name: 'Lower body', desc: 'Quads, hamstrings, glutes, calves', count: 5,
    focus: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
    pinned: ['back_squat'],
    pool: ['back_squat', 'front_squat', 'smith_squat', 'leg_press', 'hack_squat', 'goblet_squat', 'rdl', 'db_rdl', 'hip_thrust', 'walking_lunge', 'bulgarian_split', 'reverse_lunge', 'step_up', 'leg_ext', 'seated_leg_curl', 'lying_leg_curl', 'calf_raise_standing', 'calf_raise_bw', 'back_extension'],
  },
  {
    name: 'Prehab & mobility', desc: 'Shoulders, hips, core stability', count: 5,
    focus: ['Rotator cuff', 'Rear delts', 'Core', 'Glutes', 'Adductors'],
    pinned: [],
    pool: ['band_pullapart', 'face_pull', 'cuban_press', 'ext_rotation', 'cable_ext_rotation', 'copenhagen', 'side_plank', 'dead_bug', 'bird_dog', 'pallof_press', 'hip_9090', 'cat_cow', 'thoracic_roll', 'couch_stretch', 'tibialis_raise', 'nordic_curl'],
  },
  {
    name: 'Full body', desc: 'Big compound lifts', count: 5,
    focus: ['Quads', 'Hamstrings', 'Chest', 'Lats', 'Core'],
    pinned: ['deadlift'],
    pool: ['deadlift', 'trap_deadlift', 'back_squat', 'goblet_squat', 'incline_db_press', 'bench_press', 'pullup', 'lat_pulldown', 'db_row', 'ohp', 'rdl', 'walking_lunge', 'farmer_carry', 'plank', 'kb_swing', 'pushup'],
  },
  {
    name: 'Push', desc: 'Chest, shoulders, triceps', count: 5,
    focus: ['Chest', 'Delts', 'Triceps'],
    pinned: ['bench_press'],
    pool: ['bench_press', 'incline_db_press', 'db_bench', 'chest_press_machine', 'ohp', 'db_shoulder_press', 'shoulder_press_machine', 'landmine_press', 'lateral_raise', 'cable_lateral', 'pec_fly', 'cable_fly', 'tricep_pushdown', 'skullcrusher', 'db_triceps_ext', 'dips', 'pushup'],
  },
  {
    name: 'Pull', desc: 'Back, biceps, rear delts', count: 5,
    focus: ['Lats', 'Upper back', 'Rear delts', 'Biceps'],
    pinned: ['lat_pulldown'],
    pool: ['pullup', 'assisted_pullup', 'lat_pulldown', 'barbell_row', 'db_row', 'seated_row', 'chest_supported_row', 'face_pull', 'reverse_fly', 'db_rear_delt', 'db_curl', 'ez_curl', 'cable_curl', 'hammer_curl', 'shrug'],
  },
  {
    name: 'Core', desc: 'Abs, obliques, anti-rotation', count: 4,
    focus: ['Core'],
    pinned: [],
    pool: ['plank', 'side_plank', 'dead_bug', 'cable_crunch', 'hanging_knee_raise', 'ab_rollout', 'pallof_press', 'copenhagen', 'bird_dog'],
  },
  {
    name: 'Conditioning', desc: 'Intervals and carries', count: 3,
    focus: ['Core', 'Quads', 'Glutes'],
    pinned: [],
    pool: ['farmer_carry', 'kb_swing', 'sled_push', 'bike_intervals', 'walking_lunge', 'pushup'],
  },
];

export const DEFAULT_ROTATION_NAMES = ['Upper body', 'Lower body', 'Prehab & mobility', 'Full body'];

export function areaFromTemplate(t: AreaTemplate, id: string): Area {
  return {
    id,
    name: t.name,
    desc: t.desc,
    focusMuscles: t.focus,
    exercisesPerSession: t.count,
    mode: 'auto',
    pinnedExerciseIds: t.pinned,
    poolExerciseIds: t.pool,
  };
}

/** Built-in exercises overlaid with the user's custom ones. A custom entry with a built-in id overrides it. */
export function mergeLibrary(custom: Exercise[]): Exercise[] {
  const map = new Map<string, Exercise>(SEED_EXERCISES.map((e) => [e.id, e]));
  for (const c of custom) map.set(c.id, c);
  return [...map.values()];
}

export const ALL_MUSCLES: Muscle[] = [
  'Chest', 'Lats', 'Upper back', 'Delts', 'Rear delts', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes',
  'Calves', 'Adductors', 'Hip flexors', 'Lower back', 'Core', 'Rotator cuff',
];
export const ALL_PATTERNS: Pattern[] = ['push', 'pull', 'squat', 'hinge', 'lunge', 'carry', 'core', 'mobility'];
