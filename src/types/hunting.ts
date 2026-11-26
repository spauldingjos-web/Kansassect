export type PermissionStatus = 'YES' | 'ASK' | 'NO_GO' | 'UNKNOWN' | 'PUBLIC' | 'LEASED';

export type LandType =
  | 'Timber / Creek'
  | 'CRP / Native Grass'
  | 'Pasture / Ponds'
  | 'Crop / Winter Wheat'
  | 'WIHA Walk-In Public'
  | 'State Wildlife Area'
  | 'Corps of Engineers';

export type MapLayerMode = 'HYBRID' | 'SATELLITE' | 'TOPO' | 'ROADMAP' | 'NIGHT';

export type PinCategory =
  | 'Stand'
  | 'Blind'
  | 'Camera'
  | 'Rub'
  | 'Scrape'
  | 'Bedding'
  | 'Water'
  | 'Gate'
  | 'Parking'
  | 'Blood Trail';

export type HuntSpecies = 'Deer' | 'Turkey' | 'Duck' | 'Coyote' | 'Hog';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface EScoutZone {
  id: string;
  type: 'BEDDING' | 'FUNNEL' | 'FOOD' | 'STAND';
  label: string;
  description: string;
  lat: number;
  lng: number;
  confidence: string;
}

export interface EScoutReport {
  source: string;
  summary: string;
  accessStrategy: string;
  zones: EScoutZone[];
  generatedAt: string;
}

export interface PublicPhoneMatch {
  number: string;
  label: string;
  source: string;
}

export interface OwnerPublicIntel {
  confirmedOwnerName?: string;
  confirmedMailingAddress?: string;
  publicPhones: PublicPhoneMatch[];
  matchedListings?: {
    name: string;
    phone?: string;
    address: string;
    source: string;
    url: string;
  }[];
  portfolio?: {
    parcelCount: number;
    totalAcres: number;
    addresses: string[];
    counties: string[];
  } | null;
  modelUsed?: string;
  summary: string;
  groundingLinks: { title: string; uri: string }[];
  fetchedAt: string;
}

export interface CrewNote {
  id: string;
  author: string;
  role: string;
  timestamp: string;
  text: string;
  tag?: 'Knock Intel' | 'Access Rule' | 'Sighting' | 'Pressure Warning';
}

export interface DigitalPermissionSlip {
  id: string;
  parcelId: string;
  ownerName: string;
  hunterNames: string[];
  grantedDate: string;
  expiresDate: string;
  followUpDueDate: string;
  thankYouSent: boolean;
  allowedSpecies: HuntSpecies[];
  maxHuntersAtOnce: number;
  weaponsAllowed: string;
  rulesAndNotes: string;
  gatePhotoUrl: string;
  verificationHash: string;
  ownerPhoneVerified: string;
}

export interface LeaseMessage {
  id: string;
  sender: 'CREW' | 'LANDOWNER';
  senderName: string;
  timestamp: string;
  message: string;
  proposedAnnualRate?: number;
}

export interface PublicRecordLink {
  label:
    | 'Phone Search'
    | 'FastPeopleSearch'
    | 'Whitepages'
    | 'TruePeopleSearch'
    | 'Facebook'
    | 'Google'
    | 'LLC Filing'
    | 'County GIS Tax Roll'
    | 'Ag Opt-In Directory';
  url: string;
  complianceNote: string;
}

export interface HuntingParcel {
  id: string;
  source?: string;
  sectionCode: string;
  name: string;
  ownerName: string;
  ownerNameVerified?: boolean;
  countyAppraiserUrl?: string;
  ownerEntityType: 'Individual Homestead' | 'Family Farm LLC' | 'Absentee Trust' | 'KDWPT WIHA' | 'USACE Public';
  acres: number;
  landType: LandType;
  propertyAddress?: string;
  taxMailingAddress: string;
  county: string;
  parcelTaxId: string;
  assessedAgValue?: number;
  annualPropertyTax?: number;
  livesOnLand: boolean;
  homesteadNote: string;
  driveMinutes: number;
  distanceMiles: number;
  permissionStatus: PermissionStatus;
  bestWindDirections: string[];
  idealSpecies: HuntSpecies[];
  pressureLevel: 'Low' | 'Moderate' | 'High (Hammered)';
  trucksSeenThisWeek: number;
  lastHuntedSummary: string;
  publicRules?: string;
  publicOpenSeason?: string;
  parkingLotCoords?: { lat: number; lng: number; label: string };
  publicPhoneListing?: string;
  publicPhoneListings?: PublicPhoneMatch[];
  savedOwnerPhone?: string;
  savedAdditionalPhones?: string[];
  phoneSourceCitation?: string;
  publicLinks: PublicRecordLink[];
  // Real WGS84 geographic coordinates for Google Maps Polygons
  rings: LatLngPoint[][];
  center: LatLngPoint;
  terrainNotes: string;
  crewNotes: CrewNote[];
  permissionSlip?: DigitalPermissionSlip;
  leaseMessages: LeaseMessage[];
}

export interface FieldPin {
  id: string;
  parcelId: string;
  category: PinCategory;
  label: string;
  lat: number;
  lng: number;
  createdBy: string;
  createdAt: string;
  windIdeal?: string;
  notes: string;
  synced: boolean;
}

export interface TrailCamPhoto {
  id: string;
  parcelId: string;
  parcelName: string;
  imageUrl: string;
  species: 'Buck' | 'Doe' | 'Coyote' | 'Turkey' | 'Hog' | 'Duck';
  count: number;
  classification: string;
  capturedAt: string;
  daysAgo: number;
  tempF: number;
  windDir: string;
  moonPhase: string;
  tacticalTip: string;
  aiTagged: boolean;
}

export interface CrewMember {
  id: string;
  name: string;
  role: 'Crew Captain (Admin)' | 'Outfitter Manager' | 'Field Scout' | 'Landowner Guest';
  phone: string;
  activeParcelId: string | null;
  statusText: string;
  lat: number;
  lng: number;
  sharingLiveGps: boolean;
  permissionsSecured: number;
  doesHarvested: number;
  bucksHarvested: number;
  acresScouted: number;
}

export interface CrewTask {
  id: string;
  assignee: string;
  actionType: 'KNOCK' | 'MAIL LETTER' | 'SCOUT WIHA' | 'HANG CAM' | 'THANK OWNER';
  parcelId: string;
  parcelName: string;
  dueLabel: string;
  completed: boolean;
}

export interface HarvestRecord {
  id: string;
  hunterName: string;
  species: string;
  details: string;
  parcelId: string;
  parcelName: string;
  date: string;
  wind: string;
  weightLbs: number;
  landownerThanked: boolean;
  photoUrl: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  targetParcel: string;
  complianceStatus: 'VERIFIED LEGAL' | 'PRIVACY GUARD' | 'SAFETY ALERT' | 'OFFLINE SYNC';
}

export interface KansasWeatherDay {
  day: string;
  date: string;
  windDir: string;
  windSpeedMph: number;
  wind: string;
  tempMinF: number;
  tempMaxF: number;
  temp: string;
  sunrise: string;
  sunset: string;
  legalLight: string;
  rating: string;
}

export interface LiveKansasWeather {
  source: string;
  lat: number;
  lng: number;
  windDir: string;
  windDegrees: number;
  windSpeedMph: number;
  windGustsMph: number;
  tempF: number;
  pressureHpa: number;
  pressureInHg: string;
  sunrise: string;
  sunset: string;
  legalShootingLight: string;
  fetchedAt: string;
  forecast7Day: KansasWeatherDay[];
}

export interface PhoneBookEntry {
  id: string;
  streetAddress: string;
  mailingAddress?: string;
  city?: string;
  county: string;
  ownerName: string;
  displayOwnerName: string;
  associatedPeople: string[];
  phones: PublicPhoneMatch[];
  acres?: number;
  sectionCode?: string;
  parcelId?: string;
  lat?: number;
  lng?: number;
  livesOnLand?: boolean;
  source: string;
  parcel?: HuntingParcel;
  reverseLookupLinks: { label: string; url: string }[];
}

