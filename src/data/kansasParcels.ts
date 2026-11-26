import {
  HuntingParcel,
  FieldPin,
  TrailCamPhoto,
  CrewMember,
  CrewTask,
  HarvestRecord,
  AuditLogEntry,
  HuntSpecies,
} from '../types/hunting';

export const IMG_TRAILCAM_BUCK = '/src/assets/images/trailcam_whitetail_buck_1795634029037.jpg';
export const IMG_TRAILCAM_DOES = '/src/assets/images/trailcam_doe_group_1795634030930.jpg';
export const IMG_TRAILCAM_COYOTE = '/src/assets/images/trailcam_coyote_creek_1795634031569.jpg';
export const IMG_GATE_PERMISSION = '/src/assets/images/landowner_gate_permission_1795634033954.jpg';

export interface KansasQuickRegion {
  id: string;
  label: string;
  sublabel: string;
  center: { lat: number; lng: number };
  zoom: number;
}

export const KANSAS_QUICK_REGIONS: KansasQuickRegion[] = [
  {
    id: 'butler',
    label: 'Butler (Flint Hills)',
    sublabel: 'Live Owners + Parcels',
    center: { lat: 37.8165, lng: -96.745 },
    zoom: 15,
  },
  {
    id: 'sedgwick',
    label: 'Sedgwick (Wichita)',
    sublabel: 'Live Owners + Parcels',
    center: { lat: 37.742, lng: -97.535 },
    zoom: 15,
  },
  {
    id: 'shawnee',
    label: 'Shawnee (Topeka)',
    sublabel: 'Live Owners + Parcels',
    center: { lat: 39.085, lng: -95.815 },
    zoom: 15,
  },
  {
    id: 'riley',
    label: 'Riley (Tuttle Creek)',
    sublabel: 'Live Owners + Parcels',
    center: { lat: 39.295, lng: -96.645 },
    zoom: 15,
  },
  {
    id: 'douglas',
    label: 'Douglas (Clinton)',
    sublabel: 'Live Owners + Parcels',
    center: { lat: 38.894, lng: -95.302 },
    zoom: 15,
  },
  {
    id: 'marshall',
    label: 'Marshall (Blue Rapids)',
    sublabel: 'Live Owners + Parcels',
    center: { lat: 39.685, lng: -96.652 },
    zoom: 15,
  },
  {
    id: 'lyon',
    label: 'Lyon (Emporia)',
    sublabel: 'Live Parcels + WIHA',
    center: { lat: 38.435, lng: -96.165 },
    zoom: 15,
  },
  {
    id: 'sumner',
    label: 'Sumner (Wellington)',
    sublabel: 'Live Parcels + WIHA',
    center: { lat: 37.268, lng: -97.415 },
    zoom: 15,
  },
  {
    id: 'statewide',
    label: 'All 105 KS Counties',
    sublabel: 'Statewide WIHA + Lines',
    center: { lat: 38.5266, lng: -98.38 },
    zoom: 7,
  },
];

// Clean slate: no pre-populated example parcels, pins, trail cams, tasks, harvests, or audit logs
export const INITIAL_PARCELS: HuntingParcel[] = [];

export const INITIAL_PINS: FieldPin[] = [];

export const INITIAL_TRAIL_CAMS: TrailCamPhoto[] = [];

export const INITIAL_CREW_MEMBERS: CrewMember[] = [];

export const INITIAL_CREW_TASKS: CrewTask[] = [];

export const INITIAL_HARVEST_LOGS: HarvestRecord[] = [];

export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [];

export interface SeasonRegulation {
  state: string;
  species: HuntSpecies;
  method: 'Archery' | 'Firearms / Rifle' | 'Muzzleloader' | 'Shotgun / Waterfowl';
  dates: string;
  shootingHours: string;
  tagsRequired: string;
  orangeRequirement: string;
  baitingRule: string;
  specialNotes: string;
}

export const KANSAS_REGULATIONS: SeasonRegulation[] = [
  {
    state: 'Kansas (Unit 14 — Flint Hills)',
    species: 'Deer',
    method: 'Archery',
    dates: 'Sept 14, 2026 – Dec 31, 2026',
    shootingHours: '1/2 hr before sunrise (6:41 AM) to 1/2 hr after sunset (5:48 PM)',
    tagsRequired: 'KS Either-Sex Archery Permit + Antlerless Whitetail Tag + Hunting License',
    orangeRequirement: 'NONE outside firearm season. MUST wear blaze orange hat + 200 sq in chest/back during Regular Firearm Season (Dec 2–13).',
    baitingRule: 'ILLEGAL on all WIHA, State, and Federal public lands. Legal on private land with landowner permission.',
    specialNotes: 'Notch carcass tag or validate KDWP e-tag immediately upon harvest.',
  },
  {
    state: 'Kansas (Unit 14 — Flint Hills)',
    species: 'Deer',
    method: 'Firearms / Rifle',
    dates: 'Dec 2, 2026 – Dec 13, 2026 (Extended Antlerless: Jan 1–10, 2027)',
    shootingHours: '1/2 hr before sunrise to 1/2 hr after sunset',
    tagsRequired: 'KS Unit 14 Firearm Whitetail Permit + Hunting License',
    orangeRequirement: 'MANDATORY: Blaze orange hat + 200 sq in orange on chest & back.',
    baitingRule: 'ILLEGAL on WIHA & Public Wildlife Areas.',
    specialNotes: 'Verify private landowner weapon rules on your digital permission slip.',
  },
  {
    state: 'Kansas (Unit 14 — Flint Hills)',
    species: 'Turkey',
    method: 'Archery',
    dates: 'Spring Season: April 1 – May 31',
    shootingHours: '1/2 hr before sunrise to sunset',
    tagsRequired: 'Unit 14 Spring Turkey Permit (1 Bearded Turkey)',
    orangeRequirement: 'None required; avoid red, white, or blue.',
    baitingRule: 'ILLEGAL statewide within 200 yards of bait.',
    specialNotes: 'Mark winter creek roosts now for spring.',
  },
  {
    state: 'Kansas (Low Plains Late Zone)',
    species: 'Duck',
    method: 'Shotgun / Waterfowl',
    dates: 'Nov 7, 2026 – Jan 3, 2027 & Jan 16 – Jan 24, 2027',
    shootingHours: '1/2 hr before sunrise to sunset',
    tagsRequired: 'Federal Duck Stamp + KS Waterfowl Stamp + HIP + Hunting License',
    orangeRequirement: 'None required.',
    baitingRule: 'STRICTLY ILLEGAL under Federal Migratory Bird Treaty Act.',
    specialNotes: 'Non-toxic steel/bismuth shot mandatory. Daily bag: 6 ducks.',
  },
  {
    state: 'Kansas (Statewide)',
    species: 'Coyote',
    method: 'Firearms / Rifle',
    dates: 'Open Year-Round (No Closed Season)',
    shootingHours: 'Daylight; Night thermal/NVG legal Jan 1 – Mar 31 with KS Night Vision Permit',
    tagsRequired: 'Valid Kansas Hunting License',
    orangeRequirement: 'Required only during open deer firearm dates.',
    baitingRule: 'Legal on private land with landowner consent.',
    specialNotes: 'Night thermal hunting is prohibited on public WIHA.',
  },
  {
    state: 'Kansas (Private Land Depredation)',
    species: 'Hog',
    method: 'Firearms / Rifle',
    dates: 'LANDOWNER / WRITTEN AGENT DEPREDATION ONLY',
    shootingHours: '24/7 for landowner or authorized depredation agent on private land',
    tagsRequired: 'Written Landowner Depredation Authorization',
    orangeRequirement: 'Recommended during daylight.',
    baitingRule: 'Allowed for landowner eradication.',
    specialNotes: 'Sport hunting feral swine is prohibited by KS law to stop illegal transport.',
  },
];
