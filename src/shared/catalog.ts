import type { EquipItem, EquipCategory, GymEquipment } from './types';

const i = (id: string, name: string, category: EquipCategory, note?: string): EquipItem => ({ id, name, category, note });

export const EQUIPMENT: EquipItem[] = [
  // Free weights
  i('barbell', 'Barbell (20 kg)', 'Free weights'),
  i('dumbbells', 'Dumbbells', 'Free weights'),
  i('kettlebells', 'Kettlebells', 'Free weights'),
  i('ez_bar', 'EZ curl bar', 'Free weights'),
  i('trap_bar', 'Trap bar', 'Free weights'),
  i('plates', 'Weight plates', 'Free weights'),
  // Racks & benches
  i('squat_rack', 'Squat rack', 'Racks & benches'),
  i('flat_bench', 'Flat bench', 'Racks & benches'),
  i('adj_bench', 'Adjustable bench', 'Racks & benches'),
  i('nordic_bench', 'Nordic bench', 'Racks & benches'),
  i('pullup_bar', 'Pull-up bar', 'Racks & benches'),
  i('dip_station', 'Dip station', 'Racks & benches'),
  i('smith', 'Smith machine', 'Racks & benches'),
  i('landmine', 'Landmine', 'Racks & benches'),
  i('box', 'Step / plyo box', 'Racks & benches'),
  // Machines
  i('leg_press', 'Leg press', 'Machines'),
  i('seated_leg_curl', 'Seated leg curl', 'Machines'),
  i('lying_leg_curl', 'Lying leg curl', 'Machines'),
  i('leg_ext', 'Leg extension', 'Machines'),
  i('hack_squat', 'Hack squat', 'Machines'),
  i('calf_machine', 'Calf raise machine', 'Machines'),
  i('chest_press_m', 'Chest press machine', 'Machines'),
  i('shoulder_press_m', 'Shoulder press machine', 'Machines'),
  i('pec_deck', 'Pec deck / reverse fly', 'Machines'),
  i('row_machine', 'Chest-supported row', 'Machines'),
  i('back_ext', '45° back extension', 'Machines'),
  i('hip_abductor', 'Hip abductor / adductor', 'Machines'),
  i('assisted_pullup', 'Assisted pull-up', 'Machines'),
  // Cables
  i('cable_station', 'Cable station', 'Cables', 'Dual, adjustable'),
  i('lat_pulldown', 'Lat pulldown', 'Cables'),
  i('seated_row', 'Seated row', 'Cables'),
  // Other
  i('bands', 'Resistance bands', 'Other'),
  i('stability_ball', 'Stability ball', 'Other'),
  i('ab_wheel', 'Ab wheel', 'Other'),
  i('mat', 'Mat', 'Other'),
  i('foam_roller', 'Foam roller', 'Other'),
  i('bike', 'Bike / cardio machine', 'Other'),
  i('sled', 'Sled', 'Other'),
];

export const EQUIP_BY_ID: Record<string, EquipItem> = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));
export const EQUIP_CATEGORIES: EquipCategory[] = ['Free weights', 'Racks & benches', 'Machines', 'Cables', 'Other'];

export type GymTemplate = 'full' | 'basic' | 'home' | 'empty';

const BASIC = [
  'barbell', 'dumbbells', 'plates', 'flat_bench', 'adj_bench', 'squat_rack', 'pullup_bar', 'cable_station',
  'lat_pulldown', 'seated_row', 'leg_press', 'leg_ext', 'seated_leg_curl', 'calf_machine', 'mat', 'bike', 'bands',
  'kettlebells', 'chest_press_m', 'shoulder_press_m', 'pec_deck', 'ez_bar', 'foam_roller', 'box',
];
const HOME = ['dumbbells', 'adj_bench', 'bands', 'pullup_bar', 'mat', 'kettlebells', 'foam_roller', 'box'];

export const TEMPLATE_META: Record<GymTemplate, { label: string; ids: string[]; hint: string }> = {
  full: { label: 'Full commercial gym', ids: EQUIPMENT.map((e) => e.id), hint: 'Racks, barbells, dumbbells, cables and a full machine floor.' },
  basic: { label: 'Basic / hotel gym', ids: BASIC, hint: 'Dumbbells, bench, cable station, a few machines.' },
  home: { label: 'Home gym', ids: HOME, hint: 'Adjustable dumbbells, bench, bands, pull-up bar.' },
  empty: { label: 'Start empty', ids: [], hint: 'Add items one by one.' },
};

export function templateEquipment(t: GymTemplate): GymEquipment {
  const eq: GymEquipment = {};
  for (const id of TEMPLATE_META[t].ids) eq[id] = 'ok';
  return eq;
}

export function templateCount(t: GymTemplate): number {
  return TEMPLATE_META[t].ids.length;
}
