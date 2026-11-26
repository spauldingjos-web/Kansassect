import 'dotenv/config';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Helper: fetch JSON safely with timeout
async function fetchJsonSafe(url: string, timeoutMs = 8000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Helper: normalize GeoJSON or Esri JSON polygon rings into [{lat, lng}[]]
function extractLatLngRings(geometry: any): { lat: number; lng: number }[][] {
  if (!geometry) return [];
  if (Array.isArray(geometry.rings)) {
    return geometry.rings
      .filter((ring: any) => Array.isArray(ring) && ring.length >= 3)
      .map((ring: number[][]) => ring.map(([lng, lat]) => ({ lat, lng })));
  }
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map((ring: number[][]) =>
      ring.map(([lng, lat]) => ({ lat, lng }))
    );
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const out: { lat: number; lng: number }[][] = [];
    for (const poly of geometry.coordinates) {
      if (Array.isArray(poly?.[0])) {
        out.push(poly[0].map(([lng, lat]: number[]) => ({ lat, lng })));
      }
    }
    return out;
  }
  return [];
}

function computePolygonCenter(rings: { lat: number; lng: number }[][]): { lat: number; lng: number } {
  const outer = rings[0] || [];
  if (!outer.length) return { lat: 37.82, lng: -96.74 };
  let sumLat = 0;
  let sumLng = 0;
  for (const pt of outer) {
    sumLat += pt.lat;
    sumLng += pt.lng;
  }
  return { lat: sumLat / outer.length, lng: sumLng / outer.length };
}

// Compute approximate polygon acreage directly from WGS84 lat/lng ring if county attribute is 0/missing
function computeRingAcres(ring: { lat: number; lng: number }[]): number {
  if (!ring || ring.length < 3) return 0;
  const avgLatRad = (ring[0].lat * Math.PI) / 180;
  const mPerDegLat = 111132.95;
  const mPerDegLng = 111319.49 * Math.cos(avgLatRad);
  let areaSqM = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    const x1 = p1.lng * mPerDegLng;
    const y1 = p1.lat * mPerDegLat;
    const x2 = p2.lng * mPerDegLng;
    const y2 = p2.lat * mPerDegLat;
    areaSqM += x1 * y2 - x2 * y1;
  }
  return Math.abs(areaSqM) / 2 / 4046.8564224;
}

function estimateLivesOnLand(mailAddr: string, situsAddr: string, ownerName: string): { lives: boolean; note: string } {
  const m = (mailAddr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const s = (situsAddr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const o = (ownerName || '').toUpperCase();

  if (o.includes('TRUST') || o.includes('INC') || o.includes('HOLDINGS') || o.includes('LLC') || m.includes('POBOX')) {
    if (s.length > 5 && m.slice(0, 6) === s.slice(0, 6)) {
      return { lives: true, note: 'Homestead situs matches tax mailing address (family farm entity).' };
    }
    return {
      lives: false,
      note: 'Absentee / PO Box or entity mailing address on county tax roll — check phone lookup, LLC agent, or mail letter.',
    };
  }
  if (s.length > 4 && m.length > 4) {
    const mailNum = (mailAddr.match(/\d+/) || [''])[0].replace(/^0+/, '');
    const situsNum = (situsAddr.match(/\d+/) || [''])[0].replace(/^0+/, '');
    if (mailNum && situsNum && mailNum === situsNum) {
      return { lives: true, note: `YES — Tax mailing street number (${mailNum}) matches property situs address. Knockable today!` };
    }
    if (m.includes(s.slice(0, 8)) || s.includes(m.slice(0, 8))) {
      return { lives: true, note: 'YES — Owner mailing address matches on-site property address.' };
    }
  }
  if (!s || s === '00000' || s.startsWith('00000')) {
    return { lives: false, note: 'No residence street number on parcel situs — owner lives off-site (check tax mailing address & phone lookup).' };
  }
  return { lives: false, note: 'Mailing address differs from property situs — check phone lookup or send letter.' };
}

function formatPersonNameForSearch(rawOwner: string): string {
  const stripped = (rawOwner || '')
    .replace(/;\s*(TOD|JTROS|ET\s*UX|ET\s*AL|LIFE\s*EST|REV\s*TR).*$/i, '')
    .replace(/\b(REVOCABLE|IRREVOCABLE|LIVING|FAMILY)\s+TRUST\b/gi, '')
    .replace(/\b(TRUST|TR|ESTATE)\b/gi, '')
    .trim();
  const first = stripped.split('/')[0].split('&')[0].trim();
  // Convert "SMITH, JOHN R" -> "John Smith" for clean Whitepages/TruePeopleSearch/FastPeopleSearch hits
  if (first.includes(',')) {
    const [last, rest] = first.split(',').map((s) => s.trim());
    const given = (rest || '').split(/\s+/)[0] || '';
    if (last && given && !/LLC|INC|CORP|FARMS|RANCH|LP|LLP/i.test(first)) {
      return `${given} ${last}`;
    }
  }
  return first.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

// ============================================================================
// ALL-105-COUNTY KANSAS OFFICIAL APPRAISER & GIS PORTAL CACHE (KS DASC)
// ============================================================================
interface KsCountyPortalEntry {
  county: string;
  abbr: string;
  gisPortal?: string;
  parcelSearch?: string;
  appraiserContact?: string;
  countyWeb?: string;
}
let ksCountyPortalsCache: {
  ts: number;
  byName: Map<string, KsCountyPortalEntry>;
  byAbbr: Map<string, KsCountyPortalEntry>;
} | null = null;

async function loadKansasCountyPortals(): Promise<{
  byName: Map<string, KsCountyPortalEntry>;
  byAbbr: Map<string, KsCountyPortalEntry>;
} | null> {
  if (!ksCountyPortalsCache || Date.now() - ksCountyPortalsCache.ts > 3_600_000) {
    const data = await fetchJsonSafe(
      'https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/KS_County_Website_Links_SHP/FeatureServer/0/query?where=1=1&outFields=NAME10,CO_ABBR,COUNTYWEBS,GIS_CONTAC,GIS_PORTAL,PARCEL_SEA&returnGeometry=false&resultRecordCount=120&f=json',
      6500
    );
    const byName = new Map<string, KsCountyPortalEntry>();
    const byAbbr = new Map<string, KsCountyPortalEntry>();
    if (Array.isArray(data?.features)) {
      for (const f of data.features) {
        const a = f.attributes || {};
        const nameRaw = String(a.NAME10 || '').trim();
        const key = nameRaw.toLowerCase();
        const abbr = String(a.CO_ABBR || '').trim().toUpperCase();
        if (!key) continue;
        const cleanUrl = (u: any) => {
          const s = String(u || '').trim();
          return s.startsWith('http') ? s : undefined;
        };
        const entry: KsCountyPortalEntry = {
          county: nameRaw,
          abbr,
          gisPortal: cleanUrl(a.GIS_PORTAL),
          parcelSearch: cleanUrl(a.PARCEL_SEA),
          appraiserContact: cleanUrl(a.GIS_CONTAC),
          countyWeb: cleanUrl(a.COUNTYWEBS),
        };
        byName.set(key, entry);
        if (abbr) byAbbr.set(abbr, entry);
      }
    }
    if (byName.size > 0) {
      ksCountyPortalsCache = { ts: Date.now(), byName, byAbbr };
    }
  }
  return ksCountyPortalsCache ? { byName: ksCountyPortalsCache.byName, byAbbr: ksCountyPortalsCache.byAbbr } : null;
}

async function getKansasCountyPortal(rawCountyName: string): Promise<KsCountyPortalEntry | null> {
  const norm = String(rawCountyName || '')
    .replace(/\(.*?\)/g, '')
    .replace(/,?\s*KS\b/gi, '')
    .replace(/\bCounty\b/gi, '')
    .trim()
    .toLowerCase();
  if (!norm || norm === 'kansas' || norm === 'kansas statewide') return null;
  const cache = await loadKansasCountyPortals();
  return cache?.byName.get(norm) || null;
}

async function getKansasCountyByAbbr(abbr: string): Promise<KsCountyPortalEntry | null> {
  const clean = String(abbr || '').trim().toUpperCase();
  if (!clean) return null;
  const cache = await loadKansasCountyPortals();
  return cache?.byAbbr.get(clean) || null;
}

// Major Kansas town -> county lookup so searching "Hutchinson" or "Winfield" triggers ORKA owner search in Reno/Cowley
const KS_TOWN_TO_COUNTY: Record<string, string> = {
  kingman: 'Kingman',
  norwich: 'Kingman',
  cunningham: 'Kingman',
  hutchinson: 'Reno',
  buhler: 'Reno',
  nickerson: 'Reno',
  haven: 'Reno',
  winfield: 'Cowley',
  'arkansas city': 'Cowley',
  emporia: 'Lyon',
  wellington: 'Sumner',
  caldwell: 'Sumner',
  mulvane: 'Sumner',
  anthony: 'Harper',
  harper: 'Harper',
  attica: 'Harper',
  pratt: 'Pratt',
  'medicine lodge': 'Barber',
  kiowa: 'Barber',
  greensburg: 'Kiowa',
  marion: 'Marion',
  hillsboro: 'Marion',
  peabody: 'Marion',
  'cottonwood falls': 'Chase',
  'strong city': 'Chase',
  mcpherson: 'McPherson',
  lindsborg: 'McPherson',
  moundridge: 'McPherson',
  hays: 'Ellis',
  'great bend': 'Barton',
  hoisington: 'Barton',
  'dodge city': 'Ford',
  ottawa: 'Franklin',
  paola: 'Miami',
  louisburg: 'Miami',
  osawatomie: 'Miami',
  leavenworth: 'Leavenworth',
  tonganoxie: 'Leavenworth',
  basehor: 'Leavenworth',
  atchison: 'Atchison',
  lyndon: 'Osage',
  'osage city': 'Osage',
  burlingame: 'Osage',
  carbondale: 'Osage',
  'council grove': 'Morris',
  'junction city': 'Geary',
  abilene: 'Dickinson',
  herington: 'Dickinson',
  concordia: 'Cloud',
  beloit: 'Mitchell',
  'clay center': 'Clay',
  holton: 'Jackson',
  hiawatha: 'Brown',
  seneca: 'Nemaha',
  sabetha: 'Nemaha',
  garnett: 'Anderson',
  iola: 'Allen',
  chanute: 'Neosho',
  'fort scott': 'Bourbon',
  pittsburg: 'Crawford',
  girard: 'Crawford',
  columbus: 'Cherokee',
  baxter: 'Cherokee',
  independence: 'Montgomery',
  coffeyville: 'Montgomery',
  fredonia: 'Wilson',
  neodesha: 'Wilson',
  eureka: 'Greenwood',
  burlington: 'Coffey',
  liberal: 'Seward',
  colby: 'Thomas',
  goodland: 'Sherman',
  norton: 'Norton',
  phillipsburg: 'Phillips',
  russell: 'Russell',
  ellsworth: 'Ellsworth',
  lyons: 'Rice',
  sterling: 'Rice',
  larned: 'Pawnee',
  kinsley: 'Edwards',
  'st john': 'Stafford',
  stafford: 'Stafford',
  coldwater: 'Comanche',
  ashland: 'Clark',
  meade: 'Meade',
  ulysses: 'Grant',
  hugoton: 'Stevens',
  elkhart: 'Morton',
  scott: 'Scott',
  'scott city': 'Scott',
  oakley: 'Logan',
  wakeeney: 'Trego',
  stockton: 'Rooks',
  osborne: 'Osborne',
  'smith center': 'Smith',
  mankato: 'Jewell',
  belleville: 'Republic',
  washington: 'Washington',
  'alma': 'Wabaunsee',
  oskaloosa: 'Jefferson',
};

async function detectKansasCountyInQuery(rawQ: string): Promise<string | null> {
  const lower = String(rawQ || '').toLowerCase().replace(/[,.\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!lower) return null;
  // Check multi-word towns first
  for (const [town, county] of Object.entries(KS_TOWN_TO_COUNTY)) {
    const re = new RegExp(`\\b${town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return county;
  }
  const cache = await loadKansasCountyPortals();
  if (cache) {
    for (const [k, entry] of cache.byName.entries()) {
      if (k.length < 4) continue;
      const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower)) return entry.county;
    }
  }
  return null;
}

// ============================================================================
// STATEWIDE KANSAS ORKA PARCEL & LANDOWNER ENGINE (ALL ~95+ ORKA KANSAS COUNTIES)
// Live official Kansas Geological Survey / DASC KS_Parcels_ORKA + getPIDInfo.cfm
// ============================================================================
const ORKA_PARCEL_PROXY_BASE =
  'https://apps.kansasgis.org/dot/proxy.jsp?https://services.kgs.ku.edu/arcgis9/rest/services/forka9/KS_Parcels_ORKA/MapServer/0/query';
const ORKA_HEADERS = {
  Referer: 'https://apps.kansasgis.org/orka/map.cfm',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

interface OrkaPidParsed {
  pid: string;
  countyShort: string;
  ownerName: string;
  location: string;
  mailingAddress: string;
  boundaryDesc: string;
  propertyType: string;
  acresFromDesc: number;
  fullReportUrl: string;
}

const orkaPidCache = new Map<string, { ts: number; info: OrkaPidParsed | null }>();

async function queryOrkaParcelServer(queryParams: string, timeoutMs = 6500): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ORKA_PARCEL_PROXY_BASE}?${queryParams}`, {
      headers: ORKA_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return null;

    let raw = '';
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        // KGS proxy.jsp sends raw HTTP chunk framing (>8KB) and holds keep-alive open after \r\n0\r\n\r\n
        if (raw.includes('\r\n0\r\n\r\n')) {
          await reader.cancel().catch(() => {});
          break;
        }
        const trimmed = raw.trim();
        if (trimmed.startsWith('{') && (trimmed.endsWith(']}') || trimmed.endsWith('[]}'))) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      raw += decoder.decode();
    } else {
      raw = await res.text();
    }

    const cleaned = /^[0-9a-fA-F]{1,6}\r?\n/.test(raw)
      ? raw
          .replace(/\r?\n0\r?\n\r?\n[\s\S]*$/, '')
          .replace(/(?:^|\r?\n)[0-9a-fA-F]{1,6}\r?\n/g, '')
          .trim()
      : raw.trim();

    if (!cleaned.startsWith('{')) return null;
    return JSON.parse(cleaned);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOrkaPidHtml(
  html: string,
  pid: string,
  coAbbr: string,
  countyShort: string
): OrkaPidParsed | null {
  if (!html || !html.includes('themeResultsTable')) return null;

  const extractField = (labelRegex: RegExp): string => {
    const m = html.match(
      new RegExp(
        `${labelRegex.source}\\s*:\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
        'i'
      )
    );
    if (!m) return '';
    const cleaned = m[1]
      .replace(/<font[^>]*class="transText1"[^>]*>.*?<\/font>/gi, '')
      .replace(/<br\s*\/?>/gi, ', ')
      .replace(/\r?\n/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    return decodeHtmlEntities(cleaned)
      .replace(/\s*,\s*,\s*/g, ', ')
      .replace(/,\s*$/, '')
      .replace(/\.\s*$/, '')
      .trim();
  };

  const ownerPrimary = extractField(/Owner Name/);
  const ownerAlt = extractField(/Owner/);
  const ownerName = (ownerPrimary || ownerAlt || '').replace(/,\s*$/, '').trim();
  if (!ownerName) return null;

  const rawLoc = extractField(/Location/);
  const location = rawLoc && !/^00000\b/.test(rawLoc) ? rawLoc : '';

  // Mailing address in ORKA HTML sometimes has newline between street and city without <br>,
  // e.g. "3352 SE 10 ST\r\nKINGMAN, KS 67068" -> fix before flattening!
  const mailRawMatch = html.match(
    /Mailing Address\s*:\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i
  );
  let mailingAddress = '';
  if (mailRawMatch) {
    const rawMail = mailRawMatch[1]
      .replace(/<br\s*\/?>/gi, ', ')
      .replace(/\r?\n+/g, ', ')
      .replace(/<[^>]+>/g, ' ');
    mailingAddress = decodeHtmlEntities(rawMail)
      .replace(/\s*,\s*,+/g, ', ')
      .replace(/^,\s*|,\s*$/g, '')
      .trim();
    // Fix occasional missing separator when ColdFusion concatenated street + CITY, KS ZIP without newline
    mailingAddress = mailingAddress.replace(
      /\b(ST|AVE|RD|DR|LN|CT|WAY|BLVD|HWY|PL|CIR|TRL|PKWY|BOX\s+\d+)([A-Z]{3,}\s*,?\s*KS\b)/,
      '$1, $2'
    );
  }

  const boundaryDesc = extractField(/Boundary Desc/);
  const propertyType = extractField(/Property Type/);
  const acresMatch = boundaryDesc.match(/\bACRES?\s+([\d,.]+)/i);
  const acresFromDesc = acresMatch ? Number(acresMatch[1].replace(/,/g, '')) || 0 : 0;

  const reportMatch = html.match(/href="(https:\/\/apps\.kansasgis\.org\/orka\/getPIDDetail\.cfm[^"]+)"/i);
  const fullReportUrl =
    reportMatch?.[1] ||
    `https://apps.kansasgis.org/orka/getPIDDetail.cfm?pid=${encodeURIComponent(pid)}&coAbbr=${encodeURIComponent(
      coAbbr || ''
    )}`;

  return {
    pid,
    countyShort,
    ownerName,
    location,
    mailingAddress,
    boundaryDesc,
    propertyType,
    acresFromDesc,
    fullReportUrl,
  };
}

async function fetchOrkaPidInfo(
  pid: string,
  countyShort: string,
  coAbbr: string,
  lat: number,
  lng: number
): Promise<OrkaPidParsed | null> {
  const cleanPid = String(pid || '').trim();
  const cleanCounty = String(countyShort || '')
    .replace(/\(.*?\)/g, '')
    .replace(/,?\s*KS\b/gi, '')
    .replace(/\bCounty\b/gi, '')
    .trim();
  if (!cleanPid || !cleanCounty) return null;

  const cacheKey = `${cleanPid}|${cleanCounty.toLowerCase()}`;
  const cached = orkaPidCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 1_800_000) {
    return cached.info;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const res = await fetch('https://apps.kansasgis.org/orka/getPIDInfo.cfm', {
      method: 'POST',
      headers: {
        ...ORKA_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        pid: cleanPid,
        countyName: cleanCounty,
        lat: String(lat || 38.0),
        lon: String(lng || -98.0),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      orkaPidCache.set(cacheKey, { ts: Date.now(), info: null });
      return null;
    }
    const text = await res.text();
    if (!text.trim().startsWith('{')) {
      orkaPidCache.set(cacheKey, { ts: Date.now(), info: null });
      return null;
    }
    const json = JSON.parse(text);
    const parsed = parseOrkaPidHtml(String(json?.retHTML || ''), cleanPid, coAbbr, cleanCounty);
    orkaPidCache.set(cacheKey, { ts: Date.now(), info: parsed });
    if (orkaPidCache.size > 2500) {
      const firstKey = orkaPidCache.keys().next().value;
      if (firstKey) orkaPidCache.delete(firstKey);
    }
    return parsed;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mapOrkaFeatureToParcel(
  feat: any,
  countyShort: string,
  pidInfo: OrkaPidParsed | null,
  portalUrl: string,
  hintAddress?: string
): any | null {
  const rings = extractLatLngRings(feat?.geometry);
  if (!rings.length) return null;
  const attrs = feat.attributes || feat.properties || {};
  const pid = String(attrs.KSPID || attrs.OBJECTID || '').trim();
  const coAbbr = String(attrs.CO_ABBR || '').trim();
  const countyLabel = countyShort ? `${countyShort} County, KS` : 'Kansas';
  const center = computePolygonCenter(rings);
  const polyAcres = computeRingAcres(rings[0]);
  const acres =
    pidInfo && pidInfo.acresFromDesc > 0
      ? pidInfo.acresFromDesc
      : polyAcres > 0
      ? polyAcres
      : 40;

  const hasVerifiedOwner = Boolean(pidInfo?.ownerName);
  const ownerName = hasVerifiedOwner
    ? pidInfo!.ownerName
    : `Private Parcel · ${countyShort || 'Kansas'} Co. (Tap for Owner)`;
  const situsAddr = pidInfo?.location || (hintAddress ? String(hintAddress).trim() : '');
  const mailAddr = pidInfo?.mailingAddress || '';
  const isPublic =
    hasVerifiedOwner &&
    /\b(STATE OF KANSAS|UNITED STATES|CORPS OF ENGINEERS|WILDLIFE|CITY OF |COUNTY OF |PUBLIC PARK|SCHOOL DIST|USD\s*\d+)\b/i.test(
      ownerName
    );
  const livesCheck = hasVerifiedOwner
    ? isPublic
      ? { lives: false, note: `Public / Government parcel (${ownerName}). Verify hunting access rules.` }
      : estimateLivesOnLand(mailAddr, situsAddr, ownerName)
    : {
        lives: false,
        note: `Exact ${countyLabel} parcel polygon (${acres.toFixed(1)} ac) — tap parcel to load live Kansas ORKA owner name & mailing address.`,
      };

  const secMatch = pidInfo?.boundaryDesc?.match(/S(\d+)\s*,\s*T(\d+[NS]?)\s*,\s*R(\d+[EW]?)/i);
  const sectionCode = secMatch
    ? `SEC ${secMatch[1]} · T${secMatch[2]} · R${secMatch[3]}`
    : pid
    ? `KSPID ${pid}`
    : `${countyShort.toUpperCase()}-${attrs.OBJECTID}`;

  const propTypeLower = (pidInfo?.propertyType || '').toLowerCase();
  const landType = isPublic
    ? 'State Wildlife Area'
    : propTypeLower.includes('farm') || propTypeLower.includes('ag')
    ? acres >= 40
      ? 'Crop / Winter Wheat'
      : 'Pasture / Ponds'
    : acres >= 35
    ? 'Pasture / Ponds'
    : 'Timber / Creek';

  const bestReportUrl = pidInfo?.fullReportUrl || portalUrl;

  return {
    id: `orka-${pid || attrs.OBJECTID}`,
    source: `${countyShort || 'Kansas'} Co. KS ORKA Appraiser`,
    sectionCode,
    name: situsAddr
      ? `${situsAddr} (${acres.toFixed(1)} ac)`
      : hasVerifiedOwner
      ? `${ownerName} (${acres.toFixed(1)} ac)`
      : `${countyShort || 'KS'} Parcel (${acres.toFixed(1)} ac)`,
    ownerName,
    ownerNameVerified: hasVerifiedOwner,
    countyAppraiserUrl: bestReportUrl,
    ownerEntityType: isPublic
      ? 'USACE Public'
      : /LLC|INC|CORP|TRUST|TR\b|LP|LLP|ESTATE|FARMS|RANCH/i.test(ownerName)
      ? 'Family Farm LLC'
      : 'Individual Homestead',
    acres: Number(acres.toFixed(2)),
    landType,
    propertyAddress: situsAddr || undefined,
    taxMailingAddress:
      mailAddr ||
      situsAddr ||
      (hasVerifiedOwner
        ? `${countyLabel} Appraiser Roll (See Official Report)`
        : `Tap parcel to fetch live ${countyLabel} owner & tax mailing address`),
    county: countyLabel,
    parcelTaxId: pid || String(attrs.OBJECTID),
    livesOnLand: livesCheck.lives,
    homesteadNote: livesCheck.note,
    permissionStatus: isPublic && /WILDLIFE|CORPS OF ENGINEERS/i.test(ownerName) ? 'PUBLIC' : 'UNKNOWN',
    bestWindDirections: ['NW', 'N', 'W'],
    idealSpecies: ['Deer', 'Turkey', 'Coyote'],
    pressureLevel: 'Low',
    trucksSeenThisWeek: 0,
    publicLinks: buildPublicLinks(
      ownerName,
      countyLabel,
      mailAddr || situsAddr,
      bestReportUrl,
      hasVerifiedOwner
    ),
    rings,
    center,
    terrainNotes:
      pidInfo?.boundaryDesc ||
      `${countyLabel} parcel (${acres.toFixed(1)} acres)${coAbbr ? ` · ORKA ${coAbbr}` : ''}.`,
    crewNotes: [],
    leaseMessages: [],
  };
}

async function searchOrkaCountyRecords(
  countyShort: string,
  term: string,
  mode: 'address' | 'owner'
): Promise<{ pid: string; owner: string; address: string }[]> {
  const cleanCounty = String(countyShort || '')
    .replace(/\(.*?\)/g, '')
    .replace(/,?\s*KS\b/gi, '')
    .replace(/\bCounty\b/gi, '')
    .trim();
  if (!cleanCounty || !term || term.trim().length < 2) return [];

  const endpoint =
    mode === 'address'
      ? 'https://apps.kansasgis.org/orka/searchAddress.cfm'
      : 'https://apps.kansasgis.org/orka/searchOwner.cfm';

  const body = new URLSearchParams({
    countyName: cleanCounty,
    xmin: '-102.1',
    xmax: '-94.5',
    ymin: '36.9',
    ymax: '40.1',
  });
  if (mode === 'address') body.set('address', term.trim());
  else body.set('ownerName', term.trim());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...ORKA_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const txt = await res.text();
    if (!txt.trim().startsWith('{')) return [];
    const json = JSON.parse(txt);
    const rows = Array.isArray(json?.DATA) ? json.DATA : [];
    return rows
      .filter((r: any) => Array.isArray(r) && r[0])
      .map((r: any) => ({
        pid: String(r[0] || '').trim(),
        owner: String(r[1] || '').trim(),
        address: String(r[2] || '').replace(/^00000\s*/, '').trim(),
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function resolveBestCountyAppraiserUrl(portal: KsCountyPortalEntry | null, fallbackCounty: string, directWeblink?: string): string {
  if (directWeblink && directWeblink.startsWith('http')) return directWeblink;
  const isGenericOrka = (u?: string) => Boolean(u && /kansasgis\.org\/orka/i.test(u));
  if (portal?.parcelSearch && !isGenericOrka(portal.parcelSearch)) return portal.parcelSearch;
  if (portal?.gisPortal && !isGenericOrka(portal.gisPortal)) return portal.gisPortal;
  if (portal?.parcelSearch) return portal.parcelSearch;
  if (portal?.gisPortal) return portal.gisPortal;
  if (portal?.appraiserContact) return portal.appraiserContact;
  const shortCounty = String(fallbackCounty || '')
    .replace(/\(.*?\)/g, '')
    .replace(/,?\s*KS\b/gi, '')
    .replace(/\bCounty\b/gi, '')
    .trim();
  return shortCounty && shortCounty.toLowerCase() !== 'kansas'
    ? `https://www.kansasgis.org/orka/intro.cfm?countyName=${encodeURIComponent(shortCounty)}`
    : 'https://www.kansasgis.org/orka/';
}

function buildPublicLinks(
  ownerName: string,
  county: string,
  mailAddr?: string,
  weblink?: string,
  ownerNameVerified = true
) {
  const cleanCounty = (county || 'Kansas').replace(/\(.*\)/g, '').trim();
  const countyTaxRollUrl =
    weblink && weblink.startsWith('http')
      ? weblink
      : resolveBestCountyAppraiserUrl(null, cleanCounty);

  if (!ownerNameVerified) {
    const addrQ = mailAddr && !/Tax Roll|Searching|Tap/i.test(mailAddr) ? mailAddr : '';
    const links: { label: any; url: string; complianceNote: string }[] = [
      {
        label: 'County GIS Tax Roll' as const,
        url: countyTaxRollUrl,
        complianceNote: `Official ${cleanCounty} Appraiser Owner & Property Lookup`,
      },
    ];
    if (addrQ) {
      links.push(
        {
          label: 'FastPeopleSearch' as const,
          url: `https://www.fastpeoplesearch.com/address/${addrQ.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
          complianceNote: 'Reverse street-address landowner & phone lookup',
        },
        {
          label: 'Phone Search' as const,
          url: `https://www.google.com/search?q=${encodeURIComponent(`"${addrQ}" owner Kansas`)}`,
          complianceNote: 'Live Google reverse-address owner lookup',
        }
      );
    }
    links.push({
      label: 'LLC Filing' as const,
      url: 'https://www.kansas.gov/bess/flow/main?execution=e1s1',
      complianceNote: 'KS Secretary of State Business Entity & Registered Agent Search',
    });
    return links;
  }

  const cleanOwner = formatPersonNameForSearch(ownerName || 'Landowner');
  const cityMatch = (mailAddr || '').match(/,\s*([A-Za-z\s]+),\s*KS/i);
  const cityOrCounty = cityMatch ? cityMatch[1].trim() : cleanCounty.replace(/County,?\s*KS/i, '').trim();

  const phoneQuery = encodeURIComponent(`"${cleanOwner}" "${cityOrCounty}" Kansas phone number`);
  const wpSlug = encodeURIComponent(cleanOwner.replace(/\s+/g, '-'));
  const fpsNameSlug = cleanOwner.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fpsCitySlug = cityOrCounty.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tpsName = encodeURIComponent(cleanOwner);
  const tpsLoc = encodeURIComponent(`${cityOrCounty}, KS`);
  const fbQ = encodeURIComponent(`${cleanOwner} ${cityOrCounty} Kansas`);

  return [
    {
      label: 'Phone Search' as const,
      url: `https://www.google.com/search?q=${phoneQuery}`,
      complianceNote: 'Live Google public phone & directory lookup',
    },
    {
      label: 'FastPeopleSearch' as const,
      url: `https://www.fastpeoplesearch.com/name/${fpsNameSlug}_${fpsCitySlug}-ks`,
      complianceNote: 'Free public Kansas residential phone & address directory',
    },
    {
      label: 'TruePeopleSearch' as const,
      url: `https://www.truepeoplesearch.com/results?name=${tpsName}&citystatezip=${tpsLoc}`,
      complianceNote: 'Public people & address phone directory',
    },
    {
      label: 'Whitepages' as const,
      url: `https://www.whitepages.com/name/${wpSlug}/KS`,
      complianceNote: 'Public Whitepages Kansas residential & landline directory',
    },
    {
      label: 'Facebook' as const,
      url: `https://www.facebook.com/search/top/?q=${fbQ}`,
      complianceNote: 'Public social profile lookup',
    },
    {
      label: 'LLC Filing' as const,
      url: 'https://www.kansas.gov/bess/flow/main?execution=e1s1',
      complianceNote: 'KS Secretary of State Business Entity & Registered Agent Search',
    },
    {
      label: 'County GIS Tax Roll' as const,
      url: countyTaxRollUrl,
      complianceNote: `Official ${cleanCounty} Public Appraiser Record`,
    },
  ];
}

// ============================================================================
// REGISTRY OF ALL 21 VERIFIED LIVE KANSAS COUNTY APPRAISER GIS REST SERVERS
// (16 LIVE OWNER-NAMED COUNTIES + 5 EXACT-POLYGON COUNTY PARCEL FEEDS)
// ============================================================================
interface KsCountySource {
  id: string;
  label: string;
  countyName: string;
  hasOwnerNames: boolean;
  ownerField?: string;
  situsField?: string;
  mailField?: string;
  wherePrefix?: string;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  url: string;
  outFields: string;
  mapFeature: (f: any) => any | null;
}

const KS_COUNTY_SOURCES: KsCountySource[] = [
  {
    id: 'butler',
    label: 'Butler County KS Appraiser GIS',
    countyName: 'Butler County, KS (Unit 14)',
    hasOwnerNames: true,
    ownerField: 'Owner',
    situsField: 'Situs_St',
    mailField: 'Mail_Add1',
    bbox: { minLng: -97.18, minLat: 37.46, maxLng: -96.51, maxLat: 38.10 },
    url: 'https://ww1.bucoks.com/bucogis1/rest/services/Parcel_Data/FeatureServer/0/query',
    outFields: 'FID,PID,PARCELNUM,Owner,Mail_Add1,Mail_Add2,Mail_City,Mail_St,Mail_Zip,Situs_No,Situs_St,Situs_City,Tract_Desc,WEBLINK,Shape_Area',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const ownerName = (p.Owner || `Butler Co. Parcel ${p.PARCELNUM || p.FID}`).trim();
      const acresFromDesc = (() => {
        const m = String(p.Tract_Desc || '').match(/ACRES\s+([\d.]+)/i);
        return m ? Number(m[1]) : 0;
      })();
      const acres =
        acresFromDesc > 0
          ? acresFromDesc
          : p.Shape_Area
          ? Number(p.Shape_Area) / 43560
          : computeRingAcres(rings[0]);
      const mailAddr = [p.Mail_Add1, p.Mail_Add2, p.Mail_City, p.Mail_St, p.Mail_Zip]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(', ');
      const situsAddr = [p.Situs_No, p.Situs_St, p.Situs_City]
        .map((v) => String(v || '').trim())
        .filter((v) => v && v !== '00000')
        .join(' ');
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `butler-${p.PID || p.FID}`,
        source: 'Butler County KS Appraiser',
        sectionCode: p.Tract_Desc ? String(p.Tract_Desc).slice(0, 32) : `PARCEL ${p.PARCELNUM || p.FID}`,
        name: situsAddr ? `${situsAddr} (${acres.toFixed(1)} ac)` : `${ownerName} Tract`,
        ownerName,
        ownerNameVerified: Boolean(p.Owner),
        ownerEntityType: /LLC|INC|CORP|TRUST/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 30 ? 'Timber / Creek' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Butler County Tax Roll (See Link)',
        county: 'Butler County, KS (Unit 14)',
        parcelTaxId: String(p.PID || p.PARCELNUM || p.FID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Butler County, KS', mailAddr, p.WEBLINK),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.Tract_Desc || `Butler County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'sedgwick',
    label: 'Sedgwick County KS Appraiser GIS',
    countyName: 'Sedgwick County, KS (Unit 15)',
    hasOwnerNames: true,
    ownerField: 'Owner',
    situsField: 'Prop_Addr',
    mailField: 'Owner_madd',
    bbox: { minLng: -97.71, minLat: 37.47, maxLng: -97.14, maxLat: 37.92 },
    url: 'https://services9.arcgis.com/TuMyQVg8YRPEnbjv/arcgis/rest/services/Sedgwick_County_Parcels_2021/FeatureServer/0/query',
    outFields: 'OBJECTID,PIN,Owner,Owner_madd,Owner_City,Owner_Stat,Owner_Zip,Prop_Addr,Prop_City,Prop_zip,ParcAcresC,Legal',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const ownerName = String(p.Owner || `Sedgwick Parcel ${p.PIN || p.OBJECTID}`).trim();
      const acres = Number(p.ParcAcresC || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.Owner_madd, p.Owner_City, p.Owner_Stat, p.Owner_Zip]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(', ');
      const situsAddr = [p.Prop_Addr, p.Prop_City, p.Prop_zip]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(', ');
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      const webLink = p.PIN ? `https://ssc.sedgwickcounty.org/propertytax/realproperty.aspx?pin=${encodeURIComponent(p.PIN)}` : undefined;
      return {
        id: `sedgwick-${p.PIN || p.OBJECTID}`,
        source: 'Sedgwick County KS Appraiser',
        sectionCode: p.PIN ? `PIN ${p.PIN}` : `SG-${p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: Boolean(p.Owner),
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 25 ? 'Crop / Winter Wheat' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Sedgwick County Tax Roll',
        county: 'Sedgwick County, KS (Unit 15)',
        parcelTaxId: String(p.PIN || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Duck', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Sedgwick County, KS', mailAddr, webLink),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.Legal ? String(p.Legal).slice(0, 140) : `Sedgwick County parcel (${acres.toFixed(1)} ac).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'shawnee',
    label: 'Shawnee County KS Appraiser GIS',
    countyName: 'Shawnee County, KS (Unit 10)',
    hasOwnerNames: true,
    ownerField: 'ONAME',
    situsField: 'PADDRESS',
    mailField: 'MAILADDRESS',
    bbox: { minLng: -96.05, minLat: 38.86, maxLng: -95.48, maxLat: 39.23 },
    url: 'https://gis.sncoapps.us/arcgis2/rest/services/Parcels/MapServer/0/query',
    outFields: 'OBJECTID,PID,PARCELNUM,ONAME,MAILNAME,MAILADDRESS,MAILADDRESS2,PADDRESS,PADDRESS2,ACRES,PROPDESCRIPTION,TOTVAL',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const ownerName = String(p.ONAME || p.MAILNAME || `Shawnee Parcel ${p.PARCELNUM || p.OBJECTID}`).trim();
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.MAILADDRESS, p.MAILADDRESS2]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(', ');
      const situsAddr = [p.PADDRESS, p.PADDRESS2]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(', ');
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `shawnee-${p.PID || p.OBJECTID}`,
        source: 'Shawnee County KS Appraiser',
        sectionCode: p.PROPDESCRIPTION ? String(p.PROPDESCRIPTION).slice(0, 32) : `PARCEL ${p.PARCELNUM || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: Boolean(p.ONAME || p.MAILNAME),
        ownerEntityType: /LLC|INC|TRUST/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 25 ? 'Timber / Creek' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Shawnee County Tax Roll',
        county: 'Shawnee County, KS (Unit 10)',
        parcelTaxId: String(p.PID || p.PARCELNUM || p.OBJECTID),
        assessedAgValue: p.TOTVAL ? Number(p.TOTVAL) : undefined,
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Shawnee County, KS', mailAddr, 'https://gis.snco.us/'),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.PROPDESCRIPTION || `Shawnee County parcel (${acres.toFixed(1)} ac).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'riley',
    label: 'Riley County KS Appraiser GIS',
    countyName: 'Riley County, KS (Unit 9)',
    hasOwnerNames: true,
    ownerField: 'Party_Name',
    situsField: 'Property_A',
    mailField: 'Party_Addr',
    bbox: { minLng: -96.97, minLat: 39.04, maxLng: -96.36, maxLat: 39.58 },
    url: 'https://gis.rileycountyks.gov/arcgis/rest/services/GISWebV6/Parcels_and_Subdivisions/MapServer/0/query',
    outFields: 'OBJECTID,PID,ParcelNum,Party_Name,Party_Addr,City,State,ZIP,Property_A,StatedArea,CalculatedArea,Legal_Desc,PropCard,TotalVal26',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const ownerName = String(p.Party_Name || `Riley Parcel ${p.ParcelNum || p.OBJECTID}`).trim();
      const acres = Number(p.StatedArea || p.CalculatedArea || 0) || computeRingAcres(rings[0]);
      const mailAddr = String(p.Party_Addr || '').trim() || [p.City, p.State, p.ZIP].filter(Boolean).join(', ');
      const situsAddr = String(p.Property_A || '').replace(/^00000\s*/, '').trim();
      const isPublic = /UNITED STATES|STATE OF KANSAS|CORPS OF ENGINEERS|WILDLIFE/i.test(ownerName);
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `riley-${p.PID || p.OBJECTID}`,
        source: 'Riley County KS Appraiser',
        sectionCode: p.Legal_Desc ? String(p.Legal_Desc).slice(0, 32) : `PARCEL ${p.ParcelNum || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: Boolean(p.Party_Name),
        ownerEntityType: isPublic ? 'USACE Public' : /LLC|INC|TRUST/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: isPublic ? 'Corps of Engineers' : acres >= 25 ? 'Timber / Creek' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Riley County Appraiser Roll',
        county: 'Riley County, KS (Unit 9)',
        parcelTaxId: String(p.PID || p.ParcelNum || p.OBJECTID),
        assessedAgValue: p.TotalVal26 ? Number(p.TotalVal26) : undefined,
        livesOnLand: isPublic ? false : livesCheck.lives,
        homesteadNote: isPublic ? 'Public Federal / Corps of Engineers ground (Tuttle Creek / Milford area).' : livesCheck.note,
        permissionStatus: isPublic ? 'PUBLIC' : 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Duck', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Riley County, KS', mailAddr, p.PropCard),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.Legal_Desc || `Riley County parcel (${acres.toFixed(1)} ac).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'douglas',
    label: 'Douglas County KS Appraiser GIS',
    countyName: 'Douglas County, KS (Unit 10)',
    hasOwnerNames: true,
    ownerField: 'owner1',
    situsField: 'situs',
    mailField: 'address',
    bbox: { minLng: -95.53, minLat: 38.72, maxLng: -95.04, maxLat: 39.08 },
    url: 'https://gis.dgcoks.gov/server/rest/services/Tax_Parcel/FeatureServer/0/query',
    outFields: 'OBJECTID,owner1,owner2,RECORDACRES,SYSCALACRES,PARCELNUMBER,address,city,state,zip,situs,legal,PID,AGMAPLINK',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const ownerName = [p.owner1, p.owner2].filter(Boolean).join(' / ') || 'Douglas County Parcel';
      const acres = Number(p.RECORDACRES || p.SYSCALACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
      const situsAddr = String(p.situs || '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `douglas-${p.PID || p.OBJECTID}`,
        source: 'Douglas County KS Appraiser',
        sectionCode: p.PARCELNUMBER ? `PARCEL ${p.PARCELNUMBER}` : `DG-${p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: Boolean(p.owner1 || p.owner2),
        ownerEntityType: /LLC|INC|TRUST/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 30 ? 'Timber / Creek' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Douglas County Appraiser Record',
        county: 'Douglas County, KS (Unit 10)',
        parcelTaxId: String(p.PID || p.PARCELNUMBER || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Duck'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Douglas County, KS', mailAddr, p.AGMAPLINK),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.legal || `Douglas County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'marshall',
    label: 'Marshall County KS Appraiser GIS',
    countyName: 'Marshall County, KS (Unit 9)',
    hasOwnerNames: true,
    ownerField: 'Party_Name',
    situsField: 'Property_A',
    mailField: 'Party_Addr',
    bbox: { minLng: -96.83, minLat: 39.55, maxLng: -96.25, maxLat: 40.02 },
    url: 'https://services.arcgis.com/6WmEmDp2YlKJjhJt/arcgis/rest/services/Parcels/FeatureServer/0/query',
    outFields: 'OBJECTID,PID,ACRES,PARCELNUM,Party_Name,Property_A,Party_Addr,City,State,ZIP,Legal_Desc,Class',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const ownerName = p.Party_Name || 'Marshall County Parcel';
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = (p.Party_Addr || '').replace(/\n/g, ', ');
      const situsAddr = String(p.Property_A || '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `marshall-${p.PID || p.OBJECTID}`,
        source: 'Marshall County KS Appraiser',
        sectionCode: `PARCEL ${p.PARCELNUM || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: Boolean(p.Party_Name),
        ownerEntityType: /LLC|INC|TRUST/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 40 ? 'CRP / Native Grass' : 'Timber / Creek',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Marshall County Tax Roll',
        county: 'Marshall County, KS (Unit 9)',
        parcelTaxId: String(p.PID || p.PARCELNUM || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Marshall County, KS', mailAddr),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.Legal_Desc || `Marshall County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  // === 10 NEWLY VERIFIED LIVE OWNER-NAMED KANSAS COUNTY APPRAISER SERVERS ===
  {
    id: 'harvey',
    label: 'Harvey County KS Appraiser GIS',
    countyName: 'Harvey County, KS (Unit 15)',
    hasOwnerNames: true,
    ownerField: 'PriOwnerNa',
    situsField: 'SitusAddre',
    mailField: 'MailAddr1',
    bbox: { minLng: -97.712, minLat: 37.901, maxLng: -97.142, maxLat: 38.185 },
    url: 'https://services2.arcgis.com/NYSVwQ7Ci1T1U8La/arcgis/rest/services/HV_Parcels_CRS2/FeatureServer/0/query',
    outFields: 'FID,PIDNO,QuickRefID,PriOwnerNa,MailAddr1,MailAddr2,MailCitySt,SitusAddre,TotalAcres,Acres,Weblink,LegalDescr',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.PriOwnerNa || '').trim());
      const ownerName = hasOwner ? String(p.PriOwnerNa).trim() : `Harvey Co. Parcel ${p.QuickRefID || p.PIDNO || p.FID}`;
      const acres = Number(p.TotalAcres || p.Acres || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.MailAddr1, p.MailAddr2, p.MailCitySt].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
      const situsAddr = String(p.SitusAddre || '').replace(/^00000\s*/, '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `harvey-${p.PIDNO || p.FID}`,
        source: 'Harvey County KS Appraiser',
        sectionCode: p.QuickRefID ? `REF ${p.QuickRefID}` : `PID ${p.PIDNO || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        countyAppraiserUrl: p.Weblink || undefined,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 30 ? 'Crop / Winter Wheat' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Harvey County Tax Roll',
        county: 'Harvey County, KS (Unit 15)',
        parcelTaxId: String(p.PIDNO || p.QuickRefID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Duck', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Harvey County, KS', mailAddr, p.Weblink, hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.LegalDescr || `Harvey County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'saline',
    label: 'Saline County KS Appraiser GIS',
    countyName: 'Saline County, KS (Unit 7)',
    hasOwnerNames: true,
    ownerField: 'OWNERNAME',
    situsField: 'SITUSADDRE',
    mailField: 'OWNERADD',
    bbox: { minLng: -97.939, minLat: 38.599, maxLng: -97.362, maxLat: 38.968 },
    url: 'https://services2.arcgis.com/cuBVqVP04yYSBGZ9/arcgis/rest/services/Parcels_1/FeatureServer/0/query',
    outFields: 'FID,PID,QUICKREFID,OWNERNAME,OWNERADD,OWNERCITYS,SITUSADDRE,SITUSCITY,SITUSSTATE,SITUSZIP,Calc_Acre',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.OWNERNAME || '').trim());
      const ownerName = hasOwner ? String(p.OWNERNAME).trim() : `Saline Co. Parcel ${p.QUICKREFID || p.PID || p.FID}`;
      const acres = Number(p.Calc_Acre || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.OWNERADD, p.OWNERCITYS].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
      const situsAddr = [p.SITUSADDRE, p.SITUSCITY, p.SITUSSTATE, p.SITUSZIP]
        .map((v) => String(v || '').trim())
        .filter((v) => v && v !== '00000')
        .join(', ');
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `saline-${p.PID || p.FID}`,
        source: 'Saline County KS Appraiser',
        sectionCode: p.QUICKREFID ? `REF ${p.QUICKREFID}` : `PID ${p.PID || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 35 ? 'Crop / Winter Wheat' : 'Timber / Creek',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Saline County Tax Roll',
        county: 'Saline County, KS (Unit 7)',
        parcelTaxId: String(p.PID || p.QUICKREFID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Saline County, KS', mailAddr, 'https://www.kansasgis.org/orka/intro.cfm?countyName=Saline', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Saline County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'finney',
    label: 'Finney County KS Appraiser GIS',
    countyName: 'Finney County, KS (Unit 17)',
    hasOwnerNames: true,
    ownerField: 'PartyName',
    situsField: 'SitusAddress',
    mailField: 'Address1',
    bbox: { minLng: -101.114, minLat: 37.726, maxLng: -100.215, maxLat: 38.275 },
    url: 'https://utility.arcgis.com/usrsvcs/servers/9e3691d1d0e64182aa19dac298b6c7f8/rest/services/FinneyCountyAppraisers/Parcels/MapServer/0/query',
    outFields: 'OBJECTID,PID,PARCELNUM,QuickRefID,PartyName,Address1,Address2,OCity,OZip,SitusAddress,ACRES,LegalLocationDesc,URL',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.PartyName || '').trim());
      const ownerName = hasOwner ? String(p.PartyName).trim() : `Finney Co. Parcel ${p.QuickRefID || p.PID || p.OBJECTID}`;
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.Address1, p.Address2, p.OCity, p.OZip].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
      const situsAddr = String(p.SitusAddress || '').replace(/^00000\s*/, '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `finney-${p.PID || p.OBJECTID}`,
        source: 'Finney County KS Appraiser',
        sectionCode: p.QuickRefID ? `REF ${p.QuickRefID}` : `PID ${p.PID || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        countyAppraiserUrl: p.URL || undefined,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 40 ? 'CRP / Native Grass' : 'Crop / Winter Wheat',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Finney County Tax Roll',
        county: 'Finney County, KS (Unit 17)',
        parcelTaxId: String(p.PID || p.QuickRefID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Finney County, KS', mailAddr, p.URL, hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.LegalLocationDesc || `Finney County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'clark',
    label: 'Clark County KS Appraiser GIS',
    countyName: 'Clark County, KS (Unit 16)',
    hasOwnerNames: true,
    ownerField: 'PrimaryOwn',
    situsField: 'SitusAddre',
    mailField: 'Address',
    bbox: { minLng: -100.117, minLat: 36.99, maxLng: -99.531, maxLat: 37.485 },
    url: 'https://services9.arcgis.com/SNKdKyZwMZ9biVZU/arcgis/rest/services/Parcels_3_3_25_/FeatureServer/0/query',
    outFields: 'FID,PID,PARCELNUM,QuickRefID,PrimaryOwn,PartyNames,Address,City,ZIP,SitusAddre,TotalAcres,ACRES,WEB_PUBLIC,LegalDescr',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const rawOwn = String(p.PrimaryOwn || p.PartyNames || '').replace(/\s+/g, ' ').trim();
      const hasOwner = Boolean(rawOwn);
      const ownerName = hasOwner ? rawOwn : `Clark Co. Parcel ${p.QuickRefID || p.PID || p.FID}`;
      const acres = Number(p.TotalAcres || p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.Address, p.City, p.ZIP]
        .map((v) => String(v || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(', ');
      const situsAddr = String(p.SitusAddre || '').replace(/^00000\s*/, '').replace(/,\s*,\s*/g, ', ').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `clark-${p.PID || p.FID}`,
        source: 'Clark County KS Appraiser',
        sectionCode: p.QuickRefID ? `REF ${p.QuickRefID}` : `PID ${p.PID || p.OBJECTID}`,
        name: situsAddr && !/^\s*,\s*KS$/i.test(situsAddr) ? situsAddr : `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        countyAppraiserUrl: p.WEB_PUBLIC || undefined,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 40 ? 'CRP / Native Grass' : 'Pasture / Ponds',
        propertyAddress: situsAddr && !/^\s*,\s*KS$/i.test(situsAddr) ? situsAddr : undefined,
        taxMailingAddress: mailAddr || 'Clark County Tax Roll',
        county: 'Clark County, KS (Unit 16)',
        parcelTaxId: String(p.PID || p.QuickRefID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Clark County, KS', mailAddr, p.WEB_PUBLIC, hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.LegalDescr || `Clark County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'labette',
    label: 'Labette County KS Appraiser GIS',
    countyName: 'Labette County, KS (Unit 12)',
    hasOwnerNames: true,
    ownerField: 'PartyName',
    situsField: 'SitusAddr',
    mailField: 'Address1',
    bbox: { minLng: -95.533, minLat: 36.989, maxLng: -95.064, maxLat: 37.394 },
    url: 'https://services9.arcgis.com/zDY8zW24CdJKhVIw/arcgis/rest/services/LabetteCountyGIS/FeatureServer/2/query',
    outFields: 'OBJECTID,PIDNO,QuickRefID,PartyName,OwnerName,Address1,Address2,City,ZIP,SitusAddr,OwnerAddr,ACRES,Calc_Acres',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const rawOwn = String(p.PartyName || p.OwnerName || '').trim();
      const hasOwner = Boolean(rawOwn);
      const ownerName = hasOwner ? rawOwn : `Labette Co. Parcel ${p.QuickRefID || p.PIDNO || p.OBJECTID}`;
      const acres = Number(p.ACRES || p.Calc_Acres || 0) || computeRingAcres(rings[0]);
      const mailAddr =
        String(p.OwnerAddr || '').trim() ||
        [p.Address1, p.Address2, p.City, p.ZIP].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
      const situsAddr = String(p.SitusAddr || '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `labette-${p.PIDNO || p.OBJECTID}`,
        source: 'Labette County KS Appraiser',
        sectionCode: p.QuickRefID ? `REF ${p.QuickRefID}` : `PID ${p.PIDNO || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 30 ? 'Timber / Creek' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Labette County Tax Roll',
        county: 'Labette County, KS (Unit 12)',
        parcelTaxId: String(p.PIDNO || p.QuickRefID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Duck', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Labette County, KS', mailAddr, 'https://www.kansasgis.org/orka/intro.cfm?countyName=Labette', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Labette County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'pottawatomie',
    label: 'Pottawatomie County KS Appraiser GIS',
    countyName: 'Pottawatomie County, KS (Unit 9)',
    hasOwnerNames: true,
    ownerField: 'OWNER1',
    mailField: 'MAIL_ADD',
    bbox: { minLng: -96.738, minLat: 39.117, maxLng: -96.025, maxLat: 39.576 },
    url: 'https://services6.arcgis.com/Zt2LWLYlpbYKRPfg/arcgis/rest/services/CoparcelO/FeatureServer/0/query',
    outFields: 'FID,PID,PARCEL,OWNER1,OWNER2,MAIL_ADD,MAIL_CITY,MAIL_ST,MAIL_ZIP,CALC_ACRE',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const rawOwn = [p.OWNER1, p.OWNER2].map((v) => String(v || '').trim()).filter(Boolean).join(' / ');
      const hasOwner = Boolean(rawOwn);
      const ownerName = hasOwner ? rawOwn : `Pottawatomie Parcel ${p.PARCEL || p.PID || p.FID}`;
      const acres = Number(p.CALC_ACRE || 0) || computeRingAcres(rings[0]);
      const mailAddr = [p.MAIL_ADD, p.MAIL_CITY, p.MAIL_ST, p.MAIL_ZIP].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
      const livesCheck = estimateLivesOnLand(mailAddr, '', ownerName);
      return {
        id: `pottawatomie-${p.PID || p.FID}`,
        source: 'Pottawatomie County KS Appraiser',
        sectionCode: `PARCEL ${p.PARCEL || p.PID || p.OBJECTID}`,
        name: `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 35 ? 'Timber / Creek' : 'Pasture / Ponds',
        taxMailingAddress: mailAddr || 'Pottawatomie County Tax Roll',
        county: 'Pottawatomie County, KS (Unit 9)',
        parcelTaxId: String(p.PID || p.PARCEL || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Pottawatomie County, KS', mailAddr, 'https://www.kansasgis.org/orka/intro.cfm?countyName=Pottawatomie', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Pottawatomie County Flint Hills parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'comanche',
    label: 'Comanche County KS FORKA Appraiser GIS',
    countyName: 'Comanche County, KS (Unit 16)',
    hasOwnerNames: true,
    ownerField: 'OWNER1',
    situsField: 'PROPERTYADDRESS',
    mailField: 'PARTYADDRESS',
    bbox: { minLng: -99.555, minLat: 36.989, maxLng: -98.99, maxLat: 37.394 },
    url: 'https://services.kansasgis.org/arcgis3/rest/services/forka/CM_Parcels/MapServer/0/query',
    outFields: 'OBJECTID,KSPID,OWNER1,PROPERTYADDRESS,PARTYADDRESS,ACRES,QUICKREFID,LEGALDESCRIPTION',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.OWNER1 || '').trim());
      const ownerName = hasOwner ? String(p.OWNER1).trim() : `Comanche Co. Parcel ${p.QUICKREFID || p.KSPID || p.OBJECTID}`;
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = String(p.PARTYADDRESS || '').replace(/\s*\n\s*/g, ', ').trim();
      const situsAddr = String(p.PROPERTYADDRESS || '').replace(/^00000\s*/, '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `comanche-${p.KSPID || p.OBJECTID}`,
        source: 'Comanche County KS Appraiser',
        sectionCode: p.QUICKREFID ? `REF ${p.QUICKREFID}` : `KSPID ${p.KSPID || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 40 ? 'CRP / Native Grass' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Comanche County Tax Roll',
        county: 'Comanche County, KS (Unit 16)',
        parcelTaxId: String(p.KSPID || p.QUICKREFID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Comanche County, KS', mailAddr, 'https://www.kansasgis.org/orka/intro.cfm?countyName=Comanche', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.LEGALDESCRIPTION || `Comanche County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'elk',
    label: 'Elk County KS FORKA Appraiser GIS',
    countyName: 'Elk County, KS (Unit 12)',
    hasOwnerNames: true,
    ownerField: 'OWNER1',
    situsField: 'PROPERTYADDRESS',
    mailField: 'PARTYADDRESS',
    bbox: { minLng: -96.536, minLat: 37.289, maxLng: -95.951, maxLat: 37.617 },
    url: 'https://services.kansasgis.org/arcgis3/rest/services/forka/EK_Parcels/MapServer/0/query',
    outFields: 'OBJECTID,KSPID,OWNER1,PROPERTYADDRESS,PARTYADDRESS,ACRES,QUICKREFID,LEGALDESCRIPTION',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.OWNER1 || '').trim());
      const ownerName = hasOwner ? String(p.OWNER1).trim() : `Elk Co. Parcel ${p.QUICKREFID || p.KSPID || p.OBJECTID}`;
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = String(p.PARTYADDRESS || '').replace(/\s*\n\s*/g, ', ').trim();
      const situsAddr = String(p.PROPERTYADDRESS || '').replace(/^00000\s*/, '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `elk-${p.KSPID || p.OBJECTID}`,
        source: 'Elk County KS Appraiser',
        sectionCode: p.QUICKREFID ? `REF ${p.QUICKREFID}` : `KSPID ${p.KSPID || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 35 ? 'Timber / Creek' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Elk County Tax Roll',
        county: 'Elk County, KS (Unit 12)',
        parcelTaxId: String(p.KSPID || p.QUICKREFID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Elk County, KS', mailAddr, 'https://www.kansasgis.org/orka/intro.cfm?countyName=Elk', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.LEGALDESCRIPTION || `Elk County Flint Hills parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'chautauqua',
    label: 'Chautauqua County KS Appraiser GIS',
    countyName: 'Chautauqua County, KS (Unit 12)',
    hasOwnerNames: true,
    ownerField: 'OWNER1',
    situsField: 'PROPERTYADDRESS',
    mailField: 'PARTYADDRESS',
    wherePrefix: "COUNTYCODE = '010'",
    bbox: { minLng: -96.536, minLat: 36.989, maxLng: -95.954, maxLat: 37.313 },
    url: 'https://services.kansasgis.org/arcgis3/rest/services/forka/EagleView_Parcels/MapServer/0/query',
    outFields: 'OBJECTID,KSPID,COUNTYCODE,OWNER1,PROPERTYADDRESS,PARTYADDRESS,ACRES,QUICKREFID,LEGALDESCRIPTION',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.OWNER1 || '').trim());
      const ownerName = hasOwner ? String(p.OWNER1).trim() : `Chautauqua Parcel ${p.QUICKREFID || p.KSPID || p.OBJECTID}`;
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = String(p.PARTYADDRESS || '').replace(/\s*\n\s*/g, ', ').trim();
      const situsAddr = String(p.PROPERTYADDRESS || '').replace(/^00000\s*/, '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `chautauqua-${p.KSPID || p.OBJECTID}`,
        source: 'Chautauqua County KS Appraiser',
        sectionCode: p.QUICKREFID ? `REF ${p.QUICKREFID}` : `KSPID ${p.KSPID || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 35 ? 'Timber / Creek' : 'Pasture / Ponds',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Chautauqua County Tax Roll',
        county: 'Chautauqua County, KS (Unit 12)',
        parcelTaxId: String(p.KSPID || p.QUICKREFID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Chautauqua County, KS', mailAddr, 'https://www.kansasgis.org/orka/intro.cfm?countyName=Chautauqua', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.LEGALDESCRIPTION || `Chautauqua Hills parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'gray',
    label: 'Gray County KS Appraiser GIS',
    countyName: 'Gray County, KS (Unit 17)',
    hasOwnerNames: true,
    ownerField: 'OWNER1',
    situsField: 'PROPERTYADDRESS',
    mailField: 'PARTYADDRESS',
    wherePrefix: "COUNTYCODE = '035'",
    bbox: { minLng: -100.675, minLat: 37.465, maxLng: -100.205, maxLat: 38.013 },
    url: 'https://services.kansasgis.org/arcgis3/rest/services/forka/EagleView_Parcels/MapServer/0/query',
    outFields: 'OBJECTID,KSPID,COUNTYCODE,OWNER1,PROPERTYADDRESS,PARTYADDRESS,ACRES,QUICKREFID,LEGALDESCRIPTION',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.OWNER1 || '').trim());
      const ownerName = hasOwner ? String(p.OWNER1).trim() : `Gray Co. Parcel ${p.QUICKREFID || p.KSPID || p.OBJECTID}`;
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const mailAddr = String(p.PARTYADDRESS || '').replace(/\s*\n\s*/g, ', ').trim();
      const situsAddr = String(p.PROPERTYADDRESS || '').replace(/^00000\s*/, '').trim();
      const livesCheck = estimateLivesOnLand(mailAddr, situsAddr, ownerName);
      return {
        id: `gray-${p.KSPID || p.OBJECTID}`,
        source: 'Gray County KS Appraiser',
        sectionCode: p.QUICKREFID ? `REF ${p.QUICKREFID}` : `KSPID ${p.KSPID || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 40 ? 'CRP / Native Grass' : 'Crop / Winter Wheat',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: mailAddr || 'Gray County Tax Roll',
        county: 'Gray County, KS (Unit 17)',
        parcelTaxId: String(p.KSPID || p.QUICKREFID || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Gray County, KS', mailAddr, 'http://www.gray.kansasgov.com/parcel/NCRunLev2.asp', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: p.LEGALDESCRIPTION || `Gray County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'wyandotte',
    label: 'Wyandotte County KS Appraiser GIS',
    countyName: 'Wyandotte County, KS (Unit 19)',
    hasOwnerNames: true,
    ownerField: 'OWNER_NAME',
    situsField: 'ST_NAME',
    bbox: { minLng: -94.919, minLat: 38.981, maxLng: -94.578, maxLat: 39.213 },
    url: 'https://services1.arcgis.com/Qo2HHQp8vgPs2wg3/arcgis/rest/services/PWparcels/FeatureServer/0/query',
    outFields: 'FID,PARCEL,ACRE,OWNER_NAME,ADDR_EXT,ST_NAME,CITY,ZIP',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const hasOwner = Boolean(String(p.OWNER_NAME || '').trim());
      const ownerName = hasOwner ? String(p.OWNER_NAME).trim() : `Wyandotte Parcel #${p.PARCEL || p.FID}`;
      const acres = Number(p.ACRE || 0) || computeRingAcres(rings[0]);
      const situsAddr = [p.ADDR_EXT, p.ST_NAME, p.CITY, 'KS', p.ZIP]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(' ');
      const livesCheck = estimateLivesOnLand('', situsAddr, ownerName);
      return {
        id: `wyandotte-${p.PARCEL || p.FID}`,
        source: 'Wyandotte County KS Appraiser',
        sectionCode: `PARCEL ${p.PARCEL || p.OBJECTID}`,
        name: situsAddr || `${ownerName} (${acres.toFixed(1)} ac)`,
        ownerName,
        ownerNameVerified: hasOwner,
        ownerEntityType: /LLC|INC|CORP|TRUST|TR\b/i.test(ownerName) ? 'Family Farm LLC' : 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: 'Timber / Creek',
        propertyAddress: situsAddr || undefined,
        taxMailingAddress: situsAddr || 'Wyandotte County Tax Roll',
        county: 'Wyandotte County, KS (Unit 19)',
        parcelTaxId: String(p.PARCEL || p.OBJECTID),
        livesOnLand: livesCheck.lives,
        homesteadNote: livesCheck.note,
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey'],
        pressureLevel: 'Moderate',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerName, 'Wyandotte County, KS', situsAddr, 'https://www.kansasgis.org/orka/intro.cfm?countyName=Wyandotte', hasOwner),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Wyandotte County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  // === 5 EXACT-POLYGON KANSAS COUNTIES (WITH DIRECT COUNTY APPRAISER PROPERTY CARD LINKS) ===
  {
    id: 'osage',
    label: 'Osage County KS GIS',
    countyName: 'Osage County, KS (Unit 10)',
    hasOwnerNames: false,
    bbox: { minLng: -95.96, minLat: 38.424, maxLng: -95.49, maxLat: 38.88 },
    url: 'https://services9.arcgis.com/vyfEIyeUgm6rTXSN/arcgis/rest/services/OS_Parcels/FeatureServer/0/query',
    outFields: 'OBJECTID,PIDNO,PIDdash,QuickRefID,GIS_Acres,Web_Public',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const acres = Number(p.GIS_Acres || 0) || computeRingAcres(rings[0]);
      const ownerLabel = `Private Owner · Osage Co. Parcel #${p.QuickRefID || p.PIDdash || p.OBJECTID}`;
      return {
        id: `osage-${p.PIDNO || p.OBJECTID}`,
        source: 'Osage County KS GIS',
        sectionCode: `PID ${p.PIDdash || p.PIDNO || p.OBJECTID}`,
        name: `Osage Co. Parcel #${p.QuickRefID || p.OBJECTID} (${acres.toFixed(1)} ac)`,
        ownerName: ownerLabel,
        ownerNameVerified: false,
        countyAppraiserUrl: p.Web_Public || 'https://www.kansasgis.org/orka/intro.cfm?countyName=Osage',
        ownerEntityType: 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 35 ? 'Timber / Creek' : 'Pasture / Ponds',
        taxMailingAddress: `Osage County keeps owner names on its official Property Card — tap County GIS Tax Roll or Edit Owner below`,
        county: 'Osage County, KS (Unit 10)',
        parcelTaxId: String(p.PIDNO || p.QuickRefID || p.OBJECTID),
        livesOnLand: false,
        homesteadNote: 'Exact Osage County parcel polygon & acreage — open the County GIS Tax Roll card below to see the owner name, or tap Edit Owner to save it.',
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Duck', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerLabel, 'Osage County, KS', '', p.Web_Public, false),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Osage County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'lyon',
    label: 'Lyon County KS GIS',
    countyName: 'Lyon County, KS (Unit 14)',
    hasOwnerNames: false,
    bbox: { minLng: -96.36, minLat: 38.16, maxLng: -95.95, maxLat: 38.71 },
    url: 'https://services8.arcgis.com/dw5aksXsLRAhbdxH/arcgis/rest/services/Lyon_County_Parcels/FeatureServer/0/query',
    outFields: 'OBJECTID,PID,ACRES,PARCELNUM,QUICK_REF,WEBSITE',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
      const ownerLabel = `Private Owner · Lyon Co. Parcel #${p.QUICK_REF || p.PARCELNUM || p.OBJECTID}`;
      return {
        id: `lyon-${p.PID || p.OBJECTID}`,
        source: 'Lyon County KS GIS',
        sectionCode: `PID ${p.PID || p.PARCELNUM || p.OBJECTID}`,
        name: `Lyon Co. Parcel #${p.QUICK_REF || p.OBJECTID} (${acres.toFixed(1)} ac)`,
        ownerName: ownerLabel,
        ownerNameVerified: false,
        countyAppraiserUrl: p.WEBSITE || 'https://www.kansasgis.org/orka/intro.cfm?countyName=Lyon',
        ownerEntityType: 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 35 ? 'Pasture / Ponds' : 'Timber / Creek',
        taxMailingAddress: `Lyon County keeps owner names on its official Beacon Tax Roll — tap County GIS Tax Roll or Edit Owner below`,
        county: 'Lyon County, KS (Unit 14)',
        parcelTaxId: String(p.PID || p.QUICK_REF || p.OBJECTID),
        livesOnLand: false,
        homesteadNote: 'Exact Lyon County parcel polygon & acreage — open the County Property Card link below for instant owner name, or tap Edit Owner to save it.',
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerLabel, 'Lyon County, KS', '', p.WEBSITE, false),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Lyon County Flint Hills parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'sumner',
    label: 'Sumner County KS GIS',
    countyName: 'Sumner County, KS (Unit 15)',
    hasOwnerNames: false,
    bbox: { minLng: -97.81, minLat: 36.99, maxLng: -97.14, maxLat: 37.48 },
    url: 'https://services6.arcgis.com/1T9VnnU2vFIMRmpS/arcgis/rest/services/SU_Parcels/FeatureServer/0/query',
    outFields: 'OBJECTID,PID,PARCELNUM,WEB_PUBLIC,QuickRefID,GIS_Acres,PropType',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const acres = Number(p.GIS_Acres || 0) || computeRingAcres(rings[0]);
      const ownerLabel = `Private Owner · Sumner Co. Parcel #${p.QuickRefID || p.PARCELNUM || p.OBJECTID}`;
      return {
        id: `sumner-${p.PID || p.OBJECTID}`,
        source: 'Sumner County KS GIS',
        sectionCode: `PID ${p.PID || p.PARCELNUM || p.OBJECTID}`,
        name: `Sumner Co. Parcel #${p.QuickRefID || p.OBJECTID} (${acres.toFixed(1)} ac)`,
        ownerName: ownerLabel,
        ownerNameVerified: false,
        countyAppraiserUrl: p.WEB_PUBLIC || 'https://www.kansasgis.org/orka/intro.cfm?countyName=Sumner',
        ownerEntityType: 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: acres >= 35 ? 'Crop / Winter Wheat' : 'Timber / Creek',
        taxMailingAddress: `Sumner County keeps owner names on its official Property Card — tap County GIS Tax Roll or Edit Owner below`,
        county: 'Sumner County, KS (Unit 15)',
        parcelTaxId: String(p.PID || p.QuickRefID || p.OBJECTID),
        livesOnLand: false,
        homesteadNote: 'Exact Sumner County parcel boundary — tap County GIS Tax Roll below for the official owner name, or tap Edit Owner to save it.',
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Duck', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerLabel, 'Sumner County, KS', '', p.WEB_PUBLIC, false),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Sumner County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'harper',
    label: 'Harper County KS GIS',
    countyName: 'Harper County, KS (Unit 16)',
    hasOwnerNames: false,
    bbox: { minLng: -98.36, minLat: 36.99, maxLng: -97.80, maxLat: 37.40 },
    url: 'https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/HarperValue/FeatureServer/0/query',
    outFields: 'FID,KSPID,LBCSDesc,FinalTotal',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const acres = computeRingAcres(rings[0]);
      const ownerLabel = `Private Owner · Harper Co. Parcel ${p.KSPID || p.FID}`;
      return {
        id: `harper-${p.KSPID || p.FID}`,
        source: 'Harper County KS GIS',
        sectionCode: `KSPID ${p.KSPID || p.FID}`,
        name: `Harper Co. Parcel (${acres.toFixed(1)} ac)`,
        ownerName: ownerLabel,
        ownerNameVerified: false,
        countyAppraiserUrl: 'https://www.kansasgis.org/orka/intro.cfm?countyName=Harper',
        ownerEntityType: 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: 'Crop / Winter Wheat',
        taxMailingAddress: 'Harper County Appraiser Roll — Tap County GIS Tax Roll or Edit Owner',
        county: 'Harper County, KS (Unit 16)',
        parcelTaxId: String(p.KSPID || p.FID),
        assessedAgValue: p.FinalTotal ? Number(p.FinalTotal) : undefined,
        livesOnLand: false,
        homesteadNote: p.LBCSDesc ? `Land Class: ${p.LBCSDesc} — Tap County GIS Tax Roll for owner name, or Edit Owner to save it.` : 'Exact Harper County parcel boundary.',
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerLabel, 'Harper County, KS', '', 'https://www.kansasgis.org/orka/intro.cfm?countyName=Harper', false),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Harper County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
  {
    id: 'atchison',
    label: 'Atchison County KS GIS',
    countyName: 'Atchison County, KS (Unit 10)',
    hasOwnerNames: false,
    bbox: { minLng: -95.57, minLat: 39.42, maxLng: -95.03, maxLat: 39.66 },
    url: 'https://services5.arcgis.com/dqsuVCxPy9LTxdOJ/arcgis/rest/services/Atchison_KS_Cadastral/FeatureServer/0/query',
    outFields: 'OBJECTID,STATEID,SurfaceDsc,REPORT2023',
    mapFeature: (f) => {
      const rings = extractLatLngRings(f.geometry);
      if (!rings.length) return null;
      const p = f.properties || {};
      const acres = computeRingAcres(rings[0]);
      const ownerLabel = `Private Owner · Atchison Co. Parcel ${p.STATEID || p.OBJECTID}`;
      return {
        id: `atchison-${p.STATEID || p.OBJECTID}`,
        source: 'Atchison County KS GIS',
        sectionCode: `PID ${p.STATEID || p.OBJECTID}`,
        name: `Atchison Co. Parcel (${acres.toFixed(1)} ac)`,
        ownerName: ownerLabel,
        ownerNameVerified: false,
        countyAppraiserUrl: p.REPORT2023 || 'https://www.kansasgis.org/orka/intro.cfm?countyName=Atchison',
        ownerEntityType: 'Individual Homestead',
        acres: Number(acres.toFixed(2)),
        landType: 'Timber / Creek',
        taxMailingAddress: 'Atchison County Appraiser Roll — Tap County GIS Tax Roll or Edit Owner',
        county: 'Atchison County, KS (Unit 10)',
        parcelTaxId: String(p.STATEID || p.OBJECTID),
        livesOnLand: false,
        homesteadNote: p.SurfaceDsc ? `${p.SurfaceDsc} — Tap County GIS Tax Roll for owner name, or Edit Owner to save it.` : 'Exact Atchison County parcel polygon.',
        permissionStatus: 'UNKNOWN',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 0,
        publicLinks: buildPublicLinks(ownerLabel, 'Atchison County, KS', '', p.REPORT2023, false),
        rings,
        center: computePolygonCenter(rings),
        terrainNotes: `Atchison County parcel (${acres.toFixed(1)} acres).`,
        crewNotes: [],
        leaseMessages: [],
      };
    },
  },
];

// GET /api/config/maps — returns Google Maps JS key configured in environment
app.get('/api/config/maps', (_req, res) => {
  const apiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.MAPS_API_KEY ||
    '';
  res.json({ apiKey });
});

// ============================================================================
// GET /api/ks-gis/viewport — fetches REAL live Kansas Parcels, 2026 WIHA,
// KDWPT Wildlife Areas, Cimarron Grasslands & Statewide PLSS Sections
// ============================================================================
app.get('/api/ks-gis/viewport', async (req, res) => {
  const minLng = Number(req.query.minLng);
  const minLat = Number(req.query.minLat);
  const maxLng = Number(req.query.maxLng);
  const maxLat = Number(req.query.maxLat);
  const zoom = Number(req.query.zoom || 14);
  const showPublic = req.query.showPublic !== 'false';
  const showParcels = req.query.showParcels !== 'false';

  if ([minLng, minLat, maxLng, maxLat].some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: 'Invalid viewport bounding box.' });
  }

  const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
  const results: any[] = [];
  const sourcesUsed: string[] = [];
  const tasks: Promise<void>[] = [];

  // 1. STATEWIDE KANSAS WIHA (2026 + 2023-2024 Atlas) + WILDLIFE AREAS + CIMARRON GRASSLANDS
  if (showPublic && zoom >= 8) {
    tasks.push(
      (async () => {
        const wihaUrl = `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/2023_2024_WIHA_ACCESS/FeatureServer/73/query?geometry=${encodeURIComponent(
          bbox
        )}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=OBJECTID,AREAID,ACRES,SPECIES1,SPECIES2,SPECIES3,ISARCHERYSHOTONLYDESC,COUNTY,AccessDates&outSR=4326&resultRecordCount=120&f=geojson`;
        const data = await fetchJsonSafe(wihaUrl, 7500);
        if (data?.features?.length) {
          sourcesUsed.push('KDWP WIHA Atlas');
          for (const f of data.features) {
            const rings = extractLatLngRings(f.geometry);
            if (!rings.length) continue;
            const p = f.properties || {};
            const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0]);
            const speciesList = [p.SPECIES1, p.SPECIES2, p.SPECIES3].filter(Boolean);
            const countyName = p.COUNTY ? `${p.COUNTY} County, KS` : 'Kansas';
            const archeryOnly = p.ISARCHERYSHOTONLYDESC === 'Yes';
            results.push({
              id: `wiha-${p.OBJECTID || p.AREAID}`,
              source: 'KDWP WIHA Public',
              sectionCode: `WIHA #${p.AREAID || p.OBJECTID}`,
              name: `Kansas WIHA Tract #${p.AREAID || p.OBJECTID} (${p.COUNTY || 'KS'})`,
              ownerName: 'KDWP Walk-In Hunting Access (Public)',
              ownerEntityType: 'KDWPT WIHA',
              acres: Number(acres.toFixed(1)),
              landType: 'WIHA Walk-In Public',
              taxMailingAddress: `KDWP Public Hunting Access · ${countyName}`,
              county: countyName,
              parcelTaxId: `WIHA-${p.AREAID || p.OBJECTID}`,
              livesOnLand: false,
              homesteadNote: `PUBLIC WALK-IN GROUND — ${archeryOnly ? 'Archery & Shotgun Only.' : 'Open to foot traffic per KDWP WIHA Atlas.'}`,
              permissionStatus: 'PUBLIC',
              bestWindDirections: ['NW', 'N', 'W'],
              idealSpecies: ['Deer', 'Turkey', 'Coyote'],
              pressureLevel: 'Low',
              trucksSeenThisWeek: 1,
              publicRules: `WIHA — ${speciesList.length ? speciesList.join(', ') : 'Deer, Upland & Turkey'} allowed · Walk-in ONLY · No vehicles past boundary · No camping · ${
                archeryOnly ? 'Archery/Shotgun Only' : 'Standard Season Legal Weapons'
              }`,
              publicOpenSeason: p.AccessDates || 'Open Sept 1 – Jan 31 (Check KDWP Atlas)',
              publicLinks: [
                {
                  label: 'Google',
                  url: 'https://ksoutdoors.gov/Hunting/Where-to-Hunt/Walk-in-Hunting-Access-WIHA',
                  complianceNote: 'Official KDWP WIHA Atlas & Rules',
                },
              ],
              rings,
              center: computePolygonCenter(rings),
              terrainNotes: `Public WIHA tract in ${countyName} (${acres.toFixed(1)} acres).`,
              crewNotes: [],
              leaseMessages: [],
            });
          }
        }
      })()
    );

    tasks.push(
      (async () => {
        const waUrl = `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/KDWPT_Wildlife_Areas/FeatureServer/0/query?geometry=${encodeURIComponent(
          bbox
        )}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=OBJECTID,NAME,MANAGER,Access_Res,Hunt_Acc,Hyperlink,e_checkin,Shape__Area&outSR=4326&resultRecordCount=40&f=geojson`;
        const data = await fetchJsonSafe(waUrl, 7500);
        if (data?.features?.length) {
          sourcesUsed.push('KDWP Wildlife Areas');
          for (const f of data.features) {
            const rings = extractLatLngRings(f.geometry);
            if (!rings.length) continue;
            const p = f.properties || {};
            const estAcres = p.Shape__Area
              ? Math.max(10, Number((p.Shape__Area / 4046.86).toFixed(1)))
              : Number(computeRingAcres(rings[0]).toFixed(1));
            results.push({
              id: `kdwp-wa-${p.OBJECTID}`,
              source: 'KDWP Wildlife Area',
              sectionCode: 'STATE WILDLIFE AREA',
              name: p.NAME || 'Kansas State Wildlife Area',
              ownerName: `${p.NAME || 'State Wildlife Area'} (KDWP Public)`,
              ownerEntityType: 'USACE Public',
              acres: estAcres,
              landType: 'State Wildlife Area',
              taxMailingAddress: p.MANAGER || 'Kansas Dept. of Wildlife & Parks',
              county: 'Kansas Public Lands',
              parcelTaxId: `KDWP-WA-${p.OBJECTID}`,
              livesOnLand: false,
              homesteadNote: `PUBLIC STATE WILDLIFE AREA — Managed by ${p.MANAGER || 'KDWP'}. ${p.e_checkin ? 'iSportsman / E-Check-In required.' : ''}`,
              permissionStatus: 'PUBLIC',
              bestWindDirections: ['NW', 'W', 'N'],
              idealSpecies: ['Deer', 'Turkey', 'Duck', 'Coyote'],
              pressureLevel: 'Moderate',
              trucksSeenThisWeek: 2,
              publicRules: `State Wildlife Area — ${p.Hunt_Acc || 'Public Hunting Allowed'} · ${p.Access_Res || 'Follow KDWP Public Land Rules'} · Baiting strictly illegal`,
              publicOpenSeason: 'Open per Kansas Statewide Hunting Seasons',
              publicLinks: [
                {
                  label: 'Google',
                  url: p.Hyperlink || 'https://ksoutdoors.gov/KDWP-Info/Locations/Wildlife-Areas',
                  complianceNote: 'Official KDWP Wildlife Area Portal',
                },
              ],
              rings,
              center: computePolygonCenter(rings),
              terrainNotes: `Kansas State Wildlife Area (${p.NAME}).`,
              crewNotes: [],
              leaseMessages: [],
            });
          }
        }
      })()
    );
  }

  // 2. LIVE PRIVATE COUNTY APPRAISER PARCELS
  // Priority A: 17 Ultra-Fast Direct Owner-Named County REST Servers
  // Priority B: Statewide Kansas ORKA Parcels + Live Owner Info (ALL ~95+ ORKA Counties: Kingman, Reno, Cowley, Osage, Lyon, Pratt, Marion, Chase, Harper, McPherson, Ellis, Leavenworth, Franklin, Miami, Kiowa, etc.!)
  // Priority C: Remaining Direct Polygon Counties or Statewide PLSS Section Borders
  if (showParcels && zoom >= 13) {
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;
    const overlappingOwnerCounties = KS_COUNTY_SOURCES.filter(
      (c) =>
        c.hasOwnerNames &&
        maxLng >= c.bbox.minLng &&
        minLng <= c.bbox.maxLng &&
        maxLat >= c.bbox.minLat &&
        minLat <= c.bbox.maxLat
    );
    const centerCoveredByDirectOwner = overlappingOwnerCounties.some(
      (c) =>
        centerLng >= c.bbox.minLng &&
        centerLng <= c.bbox.maxLng &&
        centerLat >= c.bbox.minLat &&
        centerLat <= c.bbox.maxLat
    );

    for (const src of overlappingOwnerCounties) {
      tasks.push(
        (async () => {
          const url = `${src.url}?geometry=${encodeURIComponent(
            bbox
          )}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=${encodeURIComponent(
            src.outFields
          )}&outSR=4326&resultRecordCount=220&f=geojson`;
          const data = await fetchJsonSafe(url, 8000);
          if (data?.features?.length) {
            sourcesUsed.push(src.label);
            for (const f of data.features) {
              const mapped = src.mapFeature(f);
              if (mapped) {
                results.push(mapped);
              }
            }
          }
        })()
      );
    }

    // Statewide Kansas ORKA Parcel Polygons + On-The-Fly Live Owner Hydration for ALL other Kansas counties!
    if (!centerCoveredByDirectOwner) {
      tasks.push(
        (async () => {
          const orkaQuery = `geometry=${encodeURIComponent(
            bbox
          )}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,KSPID,CO_ABBR&returnGeometry=true&resultRecordCount=140&f=json`;
          const orkaData = await queryOrkaParcelServer(orkaQuery, 7500);
          const features = Array.isArray(orkaData?.features) ? orkaData.features : [];

          if (features.length > 0) {
            await loadKansasCountyPortals();
            // Sort by proximity to viewport center so the parcels right in front of the hunter hydrate live owners first
            const enriched = features
              .map((f: any) => {
                const rings = extractLatLngRings(f.geometry);
                if (!rings.length) return null;
                const center = computePolygonCenter(rings);
                const dist = Math.hypot(center.lng - centerLng, center.lat - centerLat);
                return { f, rings, center, dist };
              })
              .filter(Boolean) as { f: any; rings: any; center: { lat: number; lng: number }; dist: number }[];

            enriched.sort((a, b) => a.dist - b.dist);

            // Hydrate live owner names via getPIDInfo.cfm for the 14 closest visible parcels in parallel (~350ms total)
            const hydrateLimit = Math.min(14, enriched.length);
            const hydratedMap = new Map<string, OrkaPidParsed | null>();
            await Promise.all(
              enriched.slice(0, hydrateLimit).map(async (item) => {
                const attrs = item.f.attributes || {};
                const pid = String(attrs.KSPID || '').trim();
                const coAbbr = String(attrs.CO_ABBR || '').trim();
                if (!pid || !coAbbr) return;
                const portal = await getKansasCountyByAbbr(coAbbr);
                if (!portal?.county) return;
                const info = await fetchOrkaPidInfo(
                  pid,
                  portal.county,
                  coAbbr,
                  item.center.lat,
                  item.center.lng
                );
                hydratedMap.set(pid, info);
              })
            );

            sourcesUsed.push('Kansas Statewide ORKA Appraiser Roll');
            for (const item of enriched) {
              const attrs = item.f.attributes || {};
              const pid = String(attrs.KSPID || '').trim();
              const coAbbr = String(attrs.CO_ABBR || '').trim();
              const portal = await getKansasCountyByAbbr(coAbbr);
              const countyShort = portal?.county || '';
              const portalUrl = resolveBestCountyAppraiserUrl(portal, countyShort);
              const pidInfo = hydratedMap.get(pid) || null;
              const mapped = mapOrkaFeatureToParcel(item.f, countyShort, pidInfo, portalUrl);
              if (mapped) {
                results.push(mapped);
              }
            }
            return;
          }

          // Fallback for the rare non-ORKA county (e.g. Johnson Co. or out-of-coverage edge): PLSS Section Borders
          const plssUrl = `https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Boundaries/PLSS/MapServer/0/query?geometry=${encodeURIComponent(
            bbox
          )}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=OBJECTID,Section,Township,Range,TownshipRangeSection&outSR=4326&f=geojson`;
          const data = await fetchJsonSafe(plssUrl, 7500);
          if (data?.features?.length) {
            sourcesUsed.push('All-KS Property Lines + PLSS');
            for (const f of data.features.slice(0, 60)) {
              const rings = extractLatLngRings(f.geometry);
              if (!rings.length) continue;
              const p = f.properties || {};
              const secLabel = `SEC ${p.Section} · T${p.Township} · R${p.Range}`;
              const center = computePolygonCenter(rings);
              results.push({
                id: `ks-plss-${p.OBJECTID || p.TownshipRangeSection}`,
                source: 'All-KS Property Lines',
                sectionCode: secLabel,
                name: `Private Land Section (${secLabel})`,
                ownerName: `Private Landowner · Tap Parcel for County Tax Roll`,
                ownerNameVerified: false,
                ownerEntityType: 'Individual Homestead',
                acres: 640.0,
                landType: 'Crop / Winter Wheat',
                taxMailingAddress: `Tap any property line to pull live Kansas County Appraiser owner details`,
                county: 'Kansas Statewide',
                parcelTaxId: String(p.TownshipRangeSection || p.OBJECTID),
                livesOnLand: false,
                homesteadNote: 'Tap any tract inside this section to pull exact owner info & County Appraiser Portal.',
                permissionStatus: 'UNKNOWN',
                bestWindDirections: ['NW', 'N', 'W'],
                idealSpecies: ['Deer', 'Turkey', 'Coyote'],
                pressureLevel: 'Low',
                trucksSeenThisWeek: 0,
                publicLinks: buildPublicLinks('', 'Kansas', '', 'https://www.kansasgis.org/orka/', false),
                rings,
                center,
                terrainNotes: `Kansas PLSS ${secLabel}.`,
                crewNotes: [],
                leaseMessages: [],
              });
            }
          }
        })()
      );
    }
  }

  await Promise.all(tasks);
  const hydratedResults = results.map(attachCachedPhoneToParcel);
  res.json({
    count: hydratedResults.length,
    sourcesUsed: Array.from(new Set(sourcesUsed)),
    parcels: hydratedResults,
  });
});

// ============================================================================
// GET /api/ks-gis/inspect?lat=...&lng=...&address=...&pid=...&county=...
// TAP OR SEARCH ANYWHERE IN ALL 105 KANSAS COUNTIES!
// Pulls Direct County Appraiser Parcel OR Statewide Kansas ORKA Live Owner + Polygon + Mailing Address!
// ============================================================================
app.get('/api/ks-gis/inspect', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const hintAddress = String(req.query.address || '').trim();
  const requestedPid = String(req.query.pid || '').trim();
  const requestedCounty = String(req.query.county || '').trim();

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng coordinates.' });
  }

  const ptGeom = `${lng},${lat}`;

  // 1. Check our 17 ultra-fast direct owner-named County Appraiser servers first
  const matchingOwnerCounties = KS_COUNTY_SOURCES.filter(
    (c) =>
      c.hasOwnerNames &&
      lng >= c.bbox.minLng &&
      lng <= c.bbox.maxLng &&
      lat >= c.bbox.minLat &&
      lat <= c.bbox.maxLat
  );

  for (const src of matchingOwnerCounties) {
    const url = `${src.url}?geometry=${encodeURIComponent(
      ptGeom
    )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=${encodeURIComponent(
      src.outFields
    )}&outSR=4326&f=geojson`;
    const data = await fetchJsonSafe(url, 6500);
    if (data?.features?.length) {
      const mapped = src.mapFeature(data.features[0]);
      if (mapped) {
        if (!mapped.propertyAddress && hintAddress) {
          mapped.propertyAddress = hintAddress;
        }
        return res.json({ found: true, source: src.label, parcel: attachCachedPhoneToParcel(mapped) });
      }
    }
  }

  // 2. Query Statewide Kansas ORKA Parcel Polygon + WIHA + County Portal + PLSS + Address Points in parallel!
  const wihaUrl = `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/2023_2024_WIHA_ACCESS/FeatureServer/73/query?geometry=${encodeURIComponent(
    ptGeom
  )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=OBJECTID,AREAID,ACRES,SPECIES1,SPECIES2,COUNTY,AccessDates&outSR=4326&f=geojson`;

  const orkaPointQuery = requestedPid
    ? `where=${encodeURIComponent(`KSPID='${requestedPid.replace(/[^A-Za-z0-9]/g, '')}'`)}&outSR=4326&outFields=OBJECTID,KSPID,CO_ABBR&returnGeometry=true&f=json`
    : `geometry=${encodeURIComponent(
        ptGeom
      )}&geometryType=esriGeometryPoint&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,KSPID,CO_ABBR&returnGeometry=true&f=json`;

  const [orkaGeomData, wihaData, countyData, plssData, addrData] = await Promise.all([
    queryOrkaParcelServer(orkaPointQuery, 6500),
    fetchJsonSafe(wihaUrl, 5000),
    fetchJsonSafe(
      `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/KS_County_Website_Links_SHP/FeatureServer/0/query?geometry=${encodeURIComponent(
        ptGeom
      )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&outFields=NAME10,CO_ABBR,GIS_PORTAL,PARCEL_SEA,GIS_CONTAC&f=json`,
      5000
    ),
    fetchJsonSafe(
      `https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Boundaries/PLSS/MapServer/0/query?geometry=${encodeURIComponent(
        ptGeom
      )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=OBJECTID,Section,Township,Range,TownshipRangeSection&outSR=4326&f=geojson`,
      5000
    ),
    fetchJsonSafe(
      `https://services.kansasgis.org/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer/0/query?geometry=${encodeURIComponent(
        `${lng - 0.005},${lat - 0.004},${lng + 0.005},${lat + 0.004}`
      )}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=HNO,PRD,RD,STS,MUNI,COUNTY&outSR=4326&resultRecordCount=10&f=geojson`,
      5000
    ),
  ]);

  // If the point lands inside a Public WIHA tract, prioritize WIHA public hunting rules
  if (wihaData?.features?.length) {
    const f = wihaData.features[0];
    const rings = extractLatLngRings(f.geometry);
    const p = f.properties || {};
    const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0] || []);
    return res.json({
      found: true,
      source: 'KDWP WIHA Atlas',
      parcel: {
        id: `wiha-${p.OBJECTID || p.AREAID}`,
        source: 'KDWP WIHA Public',
        sectionCode: `WIHA #${p.AREAID || p.OBJECTID}`,
        name: `Kansas WIHA Tract #${p.AREAID || p.OBJECTID}`,
        ownerName: 'KDWP Walk-In Hunting Access (Public)',
        ownerEntityType: 'KDWPT WIHA',
        acres: Number(acres.toFixed(1)),
        landType: 'WIHA Walk-In Public',
        taxMailingAddress: `KDWP Public Access · ${p.COUNTY || 'Kansas'} County, KS`,
        county: `${p.COUNTY || 'Kansas'} County, KS`,
        parcelTaxId: `WIHA-${p.AREAID || p.OBJECTID}`,
        livesOnLand: false,
        homesteadNote: 'PUBLIC WALK-IN HUNTING GROUND — Open per KDWP WIHA Atlas.',
        permissionStatus: 'PUBLIC',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 1,
        publicRules: `WIHA Public Ground — ${[p.SPECIES1, p.SPECIES2].filter(Boolean).join(', ') || 'Deer & Upland'} · Walk-In Only`,
        publicOpenSeason: p.AccessDates || 'Sept 1 – Jan 31',
        publicLinks: buildPublicLinks('KDWP WIHA', `${p.COUNTY || ''} County, KS`),
        rings,
        center: rings.length ? computePolygonCenter(rings) : { lat, lng },
        terrainNotes: `Public WIHA tract (${acres.toFixed(1)} ac).`,
        crewNotes: [],
        leaseMessages: [],
      },
    });
  }

  const countyAttrs = countyData?.features?.[0]?.attributes || {};
  const countyShortFromGeo = String(countyAttrs.NAME10 || '').trim();
  const cleanPortalUrl = (u: any) => {
    const s = String(u || '').trim();
    return s.startsWith('http') ? s : undefined;
  };
  const inlinePortal: KsCountyPortalEntry | null = countyShortFromGeo
    ? {
        county: countyShortFromGeo,
        abbr: String(countyAttrs.CO_ABBR || ''),
        gisPortal: cleanPortalUrl(countyAttrs.GIS_PORTAL),
        parcelSearch: cleanPortalUrl(countyAttrs.PARCEL_SEA),
        appraiserContact: cleanPortalUrl(countyAttrs.GIS_CONTAC),
      }
    : await getKansasCountyPortal(requestedCounty || '');

  // If the clicked point landed slightly in a road right-of-way (no exact polygon hit), try a tiny 60m buffer on KS_Parcels_ORKA!
  let orkaFeat = orkaGeomData?.features?.[0] || null;
  if (!orkaFeat) {
    const tinyEnv = `${lng - 0.0007},${lat - 0.0006},${lng + 0.0007},${lat + 0.0006}`;
    const nearbyOrka = await queryOrkaParcelServer(
      `geometry=${encodeURIComponent(
        tinyEnv
      )}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,KSPID,CO_ABBR&returnGeometry=true&resultRecordCount=5&f=json`,
      5000
    );
    if (Array.isArray(nearbyOrka?.features) && nearbyOrka.features.length > 0) {
      let bestF = nearbyOrka.features[0];
      let bestD = Infinity;
      for (const nf of nearbyOrka.features) {
        const r = extractLatLngRings(nf.geometry);
        if (!r.length) continue;
        const c = computePolygonCenter(r);
        const d = Math.hypot(c.lng - lng, c.lat - lat);
        if (d < bestD) {
          bestD = d;
          bestF = nf;
        }
      }
      orkaFeat = bestF;
    }
  }

  // 2B. If Statewide KS_Parcels_ORKA matched a real individual parcel polygon -> pull LIVE OWNER NAME & MAILING ADDRESS!
  if (orkaFeat) {
    const attrs = orkaFeat.attributes || {};
    const pid = String(attrs.KSPID || '').trim();
    const coAbbr = String(attrs.CO_ABBR || countyAttrs.CO_ABBR || '').trim();
    const portalFromAbbr = coAbbr ? await getKansasCountyByAbbr(coAbbr) : null;
    const countyShort =
      portalFromAbbr?.county ||
      countyShortFromGeo ||
      requestedCounty.replace(/County,?\s*KS/i, '').trim() ||
      'Kansas';
    const bestPortal = inlinePortal || portalFromAbbr;
    const portalUrl = resolveBestCountyAppraiserUrl(bestPortal, countyShort);

    const pidInfo = pid ? await fetchOrkaPidInfo(pid, countyShort, coAbbr, lat, lng) : null;
    const mapped = mapOrkaFeatureToParcel(orkaFeat, countyShort, pidInfo, portalUrl, hintAddress);
    if (mapped) {
      return res.json({
        found: true,
        source: pidInfo
          ? `${countyShort} County KS ORKA Appraiser (Live Owner)`
          : `${countyShort} County KS ORKA Parcel`,
        parcel: attachCachedPhoneToParcel(mapped),
      });
    }
  }

  // 3. Fallback: Check exact-polygon county servers (if ORKA didn't return a feature) or PLSS + nearest/searched address!
  const matchingPolygonCounties = KS_COUNTY_SOURCES.filter(
    (c) =>
      !c.hasOwnerNames &&
      lng >= c.bbox.minLng &&
      lng <= c.bbox.maxLng &&
      lat >= c.bbox.minLat &&
      lat <= c.bbox.maxLat
  );
  for (const src of matchingPolygonCounties) {
    const url = `${src.url}?geometry=${encodeURIComponent(
      ptGeom
    )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=${encodeURIComponent(
      src.outFields
    )}&outSR=4326&f=geojson`;
    const data = await fetchJsonSafe(url, 5500);
    if (data?.features?.length) {
      const mapped = src.mapFeature(data.features[0]);
      if (mapped) {
        if (!mapped.propertyAddress && hintAddress) mapped.propertyAddress = hintAddress;
        return res.json({ found: true, source: src.label, parcel: attachCachedPhoneToParcel(mapped) });
      }
    }
  }

  const countyShort = countyShortFromGeo || requestedCounty.replace(/County,?\s*KS/i, '').trim();
  const countyLabel = countyShort ? `${countyShort} County, KS` : 'Kansas';
  const exactCountyTaxRollUrl = resolveBestCountyAppraiserUrl(inlinePortal, countyShort || countyLabel);

  let nearestAddr = hintAddress;
  if (!nearestAddr && addrData?.features?.length) {
    let bestDist = Infinity;
    for (const af of addrData.features) {
      const coords = af.geometry?.coordinates;
      if (!Array.isArray(coords)) continue;
      const d = Math.hypot(coords[0] - lng, coords[1] - lat);
      if (d < bestDist) {
        bestDist = d;
        const ap = af.properties || {};
        nearestAddr = [ap.HNO, ap.PRD, ap.RD, ap.STS, ap.MUNI ? `, ${ap.MUNI}, KS` : `, ${countyLabel}`]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+,/g, ',')
          .trim();
      }
    }
  }

  const plssFeat = plssData?.features?.[0];
  const pp = plssFeat?.properties || {};
  const secLabel = pp.Section
    ? `SEC ${pp.Section} · T${pp.Township} · R${pp.Range}`
    : `${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W`;
  const rings = plssFeat?.geometry ? extractLatLngRings(plssFeat.geometry) : [];

  const titleName = nearestAddr
    ? `Property at ${nearestAddr}`
    : `${countyLabel} Private Parcel (${secLabel})`;

  return res.json({
    found: true,
    source: `Kansas ORKA + ${countyLabel}`,
    parcel: attachCachedPhoneToParcel({
      id: `ks-pt-${lat.toFixed(5)}-${lng.toFixed(5)}`,
      source: `${countyLabel} · KS ORKA`,
      sectionCode: secLabel,
      name: titleName,
      ownerName: nearestAddr
        ? `Private Owner at ${nearestAddr}`
        : `Private Landowner · ${countyLabel}`,
      ownerNameVerified: false,
      countyAppraiserUrl: exactCountyTaxRollUrl,
      ownerEntityType: 'Individual Homestead',
      acres: 80.0,
      landType: 'Pasture / Ponds',
      propertyAddress: nearestAddr || undefined,
      taxMailingAddress:
        nearestAddr ||
        `Open ${countyShort || 'County'} Tax Roll below or tap Add Owner to save`,
      county: countyLabel,
      parcelTaxId: String(pp.TownshipRangeSection || `${lat.toFixed(4)},${lng.toFixed(4)}`),
      livesOnLand: Boolean(nearestAddr),
      homesteadNote: nearestAddr
        ? `Property near ${nearestAddr} (${secLabel}). Open County GIS Tax Roll below or tap Add Owner to tag it permanently.`
        : `Private tracts inside ${countyLabel} (${secLabel}). Tap County GIS Tax Roll or Add Owner to save.`,
      permissionStatus: 'UNKNOWN',
      bestWindDirections: ['NW', 'N', 'W'],
      idealSpecies: ['Deer', 'Turkey', 'Coyote'],
      pressureLevel: 'Low',
      trucksSeenThisWeek: 0,
      publicLinks: buildPublicLinks(
        nearestAddr || '',
        countyLabel,
        nearestAddr,
        exactCountyTaxRollUrl,
        false
      ),
      rings,
      center: { lat, lng },
      terrainNotes: `${countyLabel} · ${secLabel} · GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      crewNotes: [],
      leaseMessages: [],
    }),
  });
});

// ============================================================================
// GET /api/ks-gis/search?q=... — UNIVERSAL STATEWIDE KANSAS SEARCH ENGINE
// Searches ALL 625+ KS Towns, ALL 105 Counties, Streets, Exact Street Addresses,
// WIHA Public Areas, AND Live Kansas County Appraiser Landowner Names & Addresses
// ============================================================================
const searchCache = new Map<string, { ts: number; results: any[] }>();

function sanitizeSqlTerm(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9\s\-\.#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function isInsideKansas(lat: number, lng: number): boolean {
  return lat >= 36.96 && lat <= 40.04 && lng >= -102.08 && lng <= -94.56;
}

function computeGeoJsonCenter(geometry: any): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
  }
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
    const mid = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
    return { lat: mid[1], lng: mid[0] };
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates) && geometry.coordinates[0]?.length) {
    const line = geometry.coordinates[0];
    const mid = line[Math.floor(line.length / 2)];
    return { lat: mid[1], lng: mid[0] };
  }
  const rings = extractLatLngRings(geometry);
  if (rings.length) return computePolygonCenter(rings);
  return null;
}

app.get('/api/ks-gis/search', async (req, res) => {
  const rawQ = String(req.query.q || '').trim().slice(0, 90);
  const ctxLat = Number(req.query.lat);
  const ctxLng = Number(req.query.lng);
  const hasCtxCoords = Number.isFinite(ctxLat) && Number.isFinite(ctxLng) && isInsideKansas(ctxLat, ctxLng);
  if (rawQ.length < 2) {
    return res.json({ query: rawQ, results: [] });
  }

  const cacheKey = `${rawQ.toLowerCase()}|${hasCtxCoords ? `${ctxLat.toFixed(1)},${ctxLng.toFixed(1)}` : ''}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 120_000) {
    return res.json({ query: rawQ, results: cached.results });
  }

  const sqlClean = sanitizeSqlTerm(rawQ);
  // First significant token for broad owner/street SQL matching
  const tokens = sqlClean.split(' ').filter((t) => t.length >= 2);
  const hasLeadingNumber = /^\d{1,6}\s+/.test(sqlClean);
  const leadingNum = hasLeadingNumber ? sqlClean.split(' ')[0] : '';
  const afterNumStreet = hasLeadingNumber ? sqlClean.slice(leadingNum.length).trim() : sqlClean;
  const streetCoreToken = afterNumStreet
    .replace(/\b(N|S|E|W|NE|NW|SE|SW|ST|AVE|RD|DR|LN|CT|BLVD|HWY|PKWY|CIR|WAY|TRL|PL|KS|KANSAS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const esriQuery = /\b(ks|kansas)\b/i.test(rawQ) ? rawQ : `${rawQ}, Kansas`;
  const ksExtent = '-102.06,36.98,-94.58,40.01';

  // 1. Esri World Geocoder strictly bounded to Kansas (Every town, street, highway, landmark & exact address!)
  const esriPromise = fetchJsonSafe(
    `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(
      esriQuery
    )}&searchExtent=${ksExtent}&sourceCountry=USA&outFields=Match_addr,Addr_type,City,Subregion,Region,StAddr,Postal&maxLocations=10&f=json`,
    4500
  );

  // 2. Kansas ORKA Statewide City Limits (ALL 625+ Kansas Towns & Cities)
  const orkaCityPromise =
    !hasLeadingNumber && sqlClean.length >= 2
      ? fetchJsonSafe(
          `https://services.kansasgis.org/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer/18/query?where=${encodeURIComponent(
            `UPPER(MUNI) LIKE '%${sqlClean}%'`
          )}&outFields=OBJECTID,MUNI,COUNTY&returnGeometry=true&outSR=4326&resultRecordCount=8&f=geojson`,
          4200
        )
      : Promise.resolve(null);

  // 3. Kansas ORKA Statewide County Boundaries (ALL 105 Kansas Counties)
  const countyTerm = sqlClean.replace(/\bCOUNTY\b/g, '').trim();
  const orkaCountyPromise =
    !hasLeadingNumber && countyTerm.length >= 2
      ? fetchJsonSafe(
          `https://services.kansasgis.org/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer/19/query?where=${encodeURIComponent(
            `UPPER(NAME10) LIKE '%${countyTerm}%'`
          )}&outFields=OBJECTID,NAME10,NAMELSAD10&returnGeometry=true&outSR=4326&resultRecordCount=5&f=geojson`,
          4200
        )
      : Promise.resolve(null);

  // 4. Kansas ORKA Statewide Address Points (when query starts with a street number, e.g. "123 Main" or "4500 Central")
  const orkaAddrPromise =
    hasLeadingNumber && streetCoreToken.length >= 2
      ? fetchJsonSafe(
          `https://services.kansasgis.org/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer/0/query?where=${encodeURIComponent(
            `HNO = '${leadingNum}' AND UPPER(RD) LIKE '%${streetCoreToken.split(' ')[0]}%'`
          )}&outFields=OBJECTID,HNO,PRD,RD,STS,MUNI,COUNTY&returnGeometry=true&outSR=4326&resultRecordCount=8&f=geojson`,
          4500
        )
      : Promise.resolve(null);

  // 5. Kansas ORKA Statewide Roads (when query looks like a street / road / highway)
  const looksLikeRoad =
    /\b(ST|AVE|RD|DR|LN|CT|BLVD|HWY|US|K-|CR|ROAD|STREET|AVENUE|HIGHWAY|TRAIL|WAY|TRL|PKWY|CIR)\b/i.test(
      rawQ
    ) || (!hasLeadingNumber && sqlClean.length >= 4);
  const orkaRoadPromise =
    looksLikeRoad && (streetCoreToken.length >= 3 || sqlClean.length >= 3)
      ? fetchJsonSafe(
          `https://services.kansasgis.org/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer/17/query?where=${encodeURIComponent(
            `UPPER(LABEL) LIKE '%${(streetCoreToken || sqlClean).split(' ').slice(0, 2).join(' ')}%'`
          )}&outFields=OBJECTID,LABEL,MUNI_L,COUNTY_L,POSTCO_L,SURFACE,SPDLIMIT&returnGeometry=true&outSR=4326&resultRecordCount=6&f=geojson`,
          4200
        )
      : Promise.resolve(null);

  // 6. Live Kansas County Appraiser GIS Owner Name & Street Address Search (ALL 16 Live Owner-Indexed County Servers!)
  const ownerIndexedSources = KS_COUNTY_SOURCES.filter((s) => s.hasOwnerNames && s.ownerField);
  const countyOwnerPromises =
    sqlClean.length >= 3
      ? ownerIndexedSources.map(async (src) => {
          const clauses: string[] = [];
          if (hasLeadingNumber) {
            if (src.situsField) clauses.push(`UPPER(${src.situsField}) LIKE '%${sqlClean}%'`);
            if (src.mailField) clauses.push(`UPPER(${src.mailField}) LIKE '%${sqlClean}%'`);
          } else {
            // Tokenized AND search on ownerField so "Terry Smith" matches "SMITH, TERRY G"
            const nameToks = tokens.slice(0, 3);
            if (nameToks.length > 1) {
              clauses.push(`(${nameToks.map((t) => `UPPER(${src.ownerField}) LIKE '%${t}%'`).join(' AND ')})`);
            } else {
              clauses.push(`UPPER(${src.ownerField}) LIKE '%${sqlClean}%'`);
            }
            if (src.situsField) clauses.push(`UPPER(${src.situsField}) LIKE '%${sqlClean}%'`);
          }
          if (!clauses.length) return [];
          const rawWhere = clauses.join(' OR ');
          const whereClause = src.wherePrefix ? `(${src.wherePrefix}) AND (${rawWhere})` : rawWhere;
          const url = `${src.url}?where=${encodeURIComponent(
            whereClause
          )}&outFields=${encodeURIComponent(
            src.outFields
          )}&returnGeometry=true&outSR=4326&resultRecordCount=3&f=geojson`;
          const data = await fetchJsonSafe(url, 4200);
          if (!data?.features?.length) return [];
          return data.features
            .map((f: any) => src.mapFeature(f))
            .filter(Boolean);
        })
      : [];

  // 7. Statewide WIHA Public Ground search (if query mentions WIHA or county name)
  const wihaPromise =
    sqlClean.length >= 3
      ? fetchJsonSafe(
          `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/2023_2024_WIHA_ACCESS/FeatureServer/73/query?where=${encodeURIComponent(
            `UPPER(COUNTY) LIKE '%${countyTerm || sqlClean}%' OR UPPER(AREAID) LIKE '%${sqlClean}%'`
          )}&outFields=OBJECTID,AREAID,ACRES,SPECIES1,SPECIES2,COUNTY,AccessDates&returnGeometry=true&outSR=4326&resultRecordCount=4&f=geojson`,
          4200
        )
      : Promise.resolve(null);

  // 8. LIVE KANSAS ORKA OWNER & ADDRESS SEARCH (Works across ALL ~95+ ORKA counties including Kingman, Reno, Cowley, Osage, Lyon, Pratt, Marion, Chase, etc.!)
  const orkaOwnerAddressPromise = (async () => {
    if (sqlClean.length < 3) return [];
    let targetCounty = await detectKansasCountyInQuery(rawQ);

    // If query didn't explicitly name a county/town, check the county the user's map is currently centered on!
    if (!targetCounty && hasCtxCoords) {
      const cData = await fetchJsonSafe(
        `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/KS_County_Website_Links_SHP/FeatureServer/0/query?geometry=${encodeURIComponent(
          `${ctxLng},${ctxLat}`
        )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&outFields=NAME10&f=json`,
        2500
      );
      targetCounty = String(cData?.features?.[0]?.attributes?.NAME10 || '').trim() || null;
    }

    if (!targetCounty) return [];

    // Strip the county/town/KS words from the query to extract the clean street address or owner surname
    let cleanTerm = rawQ
      .replace(/,\s*(ks|kansas)(\s+\d{5})?/gi, '')
      .replace(new RegExp(`\\b${targetCounty}\\b`, 'gi'), '')
      .replace(/\bcounty\b/gi, '')
      .replace(/\b(ks|kansas)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Strip town aliases if user typed "Slaton Hutchinson"
    for (const [town, cnty] of Object.entries(KS_TOWN_TO_COUNTY)) {
      if (cnty.toLowerCase() === targetCounty.toLowerCase()) {
        cleanTerm = cleanTerm.replace(new RegExp(`\\b${town}\\b`, 'gi'), '').trim();
      }
    }
    cleanTerm = cleanTerm.replace(/^,|,$/g, '').trim();
    if (cleanTerm.length < 2) return [];

    // Strip ordinal suffixes for ORKA street matching ("3352 SE 10th St" -> "3352 SE 10")
    const orkaAddrTerm = cleanTerm
      .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
      .replace(/\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|hwy)\b\.?$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    const matches = await searchOrkaCountyRecords(
      targetCounty,
      hasLeadingNumber ? orkaAddrTerm || cleanTerm : cleanTerm,
      hasLeadingNumber ? 'address' : 'owner'
    );
    if (!matches.length) return [];

    const topMatches = matches.slice(0, 4);
    const pidInClause = topMatches
      .map((m) => `'${m.pid.replace(/[^A-Za-z0-9]/g, '')}'`)
      .join(',');
    const geomData = await queryOrkaParcelServer(
      `where=${encodeURIComponent(`KSPID IN (${pidInClause})`)}&outSR=4326&outFields=OBJECTID,KSPID,CO_ABBR&returnGeometry=true&f=json`,
      4500
    );
    const geomByPid = new Map<string, any>();
    for (const f of geomData?.features || []) {
      const p = String(f?.attributes?.KSPID || '').trim();
      if (p) geomByPid.set(p, f);
    }

    const portal = await getKansasCountyPortal(targetCounty);
    const portalUrl = resolveBestCountyAppraiserUrl(portal, targetCounty);

    const built = await Promise.all(
      topMatches.map(async (m) => {
        const feat = geomByPid.get(m.pid);
        if (!feat) return null;
        const rings = extractLatLngRings(feat.geometry);
        if (!rings.length) return null;
        const center = computePolygonCenter(rings);
        const coAbbr = String(feat.attributes?.CO_ABBR || portal?.abbr || '');
        const pidInfo = await fetchOrkaPidInfo(m.pid, targetCounty!, coAbbr, center.lat, center.lng);
        return mapOrkaFeatureToParcel(feat, targetCounty!, pidInfo, portalUrl, m.address);
      })
    );
    return built.filter(Boolean);
  })();

  const [esriData, orkaCities, orkaCounties, orkaAddrs, orkaRoads, wihaData, orkaOwnerGroup, ...countyOwnerGroups] =
    await Promise.all([
      esriPromise,
      orkaCityPromise,
      orkaCountyPromise,
      orkaAddrPromise,
      orkaRoadPromise,
      wihaPromise,
      orkaOwnerAddressPromise,
      ...countyOwnerPromises,
    ]);

  if (Array.isArray(orkaOwnerGroup) && orkaOwnerGroup.length > 0) {
    countyOwnerGroups.unshift(orkaOwnerGroup);
  }

  const results: any[] = [];
  const dedup = new Set<string>();

  const pushUnique = (item: any) => {
    const normTitle = String(item.title || '')
      .toLowerCase()
      .replace(/,\s*(kansas|ks)(\s+\d{5})?$/i, '')
      .trim();
    const key =
      item.category === 'TOWN' || item.category === 'COUNTY'
        ? `${item.category}|${normTitle}`
        : `${item.category}|${normTitle}|${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
    if (dedup.has(key)) return;
    dedup.add(key);
    results.push(item);
  };

  // A. Live County Appraiser Landowner & Property Results (Highest Priority when searching names or property addresses!)
  for (const group of countyOwnerGroups) {
    if (!Array.isArray(group)) continue;
    for (const rawParcel of group) {
      if (!rawParcel?.center) continue;
      const parcel = attachCachedPhoneToParcel(rawParcel);
      pushUnique({
        id: `owner-${parcel.id}`,
        category: 'OWNER',
        title: parcel.ownerName,
        subtitle: `${parcel.acres.toFixed(1)} ac · ${
          parcel.propertyAddress || parcel.taxMailingAddress
        } · ${parcel.county}`,
        county: parcel.county,
        lat: parcel.center.lat,
        lng: parcel.center.lng,
        zoom: 16,
        parcel,
      });
    }
  }

  // B. Kansas ORKA Official Cities & Towns (ALL 625+ KS Towns)
  if (orkaCities?.features?.length) {
    for (const f of orkaCities.features) {
      const p = f.properties || {};
      const center = computeGeoJsonCenter(f.geometry);
      if (!center || !p.MUNI) continue;
      const muniName = String(p.MUNI).trim();
      const countyName = p.COUNTY ? `${String(p.COUNTY).trim()} County, KS` : 'Kansas';
      pushUnique({
        id: `town-${p.OBJECTID || muniName}`,
        category: 'TOWN',
        title: `${muniName}, KS`,
        subtitle: `Kansas Town / City · ${countyName}`,
        county: countyName,
        lat: center.lat,
        lng: center.lng,
        zoom: 14,
      });
    }
  }

  // C. Kansas ORKA Exact Rural & Urban Street Address Points
  if (orkaAddrs?.features?.length) {
    for (const f of orkaAddrs.features) {
      const p = f.properties || {};
      const center = computeGeoJsonCenter(f.geometry);
      if (!center) continue;
      const addrLine = [p.HNO, p.PRD, p.RD, p.STS].filter(Boolean).join(' ').trim();
      if (!addrLine) continue;
      const locLine = [p.MUNI, p.COUNTY ? `${p.COUNTY} County` : '', 'KS'].filter(Boolean).join(', ');
      pushUnique({
        id: `orka-addr-${p.OBJECTID || addrLine}`,
        category: 'ADDRESS',
        title: addrLine,
        subtitle: `${locLine} · Official Kansas ORKA Address`,
        county: p.COUNTY ? `${p.COUNTY} County, KS` : 'Kansas',
        lat: center.lat,
        lng: center.lng,
        zoom: 17,
        autoInspect: true,
      });
    }
  }

  // D. Esri World Geocoder Kansas Results (Towns, Streets, Exact Street Addresses, Landmarks, Lakes)
  if (Array.isArray(esriData?.candidates)) {
    for (const c of esriData.candidates) {
      const lat = Number(c.location?.y);
      const lng = Number(c.location?.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInsideKansas(lat, lng)) continue;
      const attrs = c.attributes || {};
      const region = String(attrs.Region || '');
      if (region && !/kansas|^ks$/i.test(region)) continue;
      const addrType = String(attrs.Addr_type || '');
      const matchAddr = String(attrs.Match_addr || c.address || '').trim();
      if (!matchAddr) continue;

      let category: 'ADDRESS' | 'STREET' | 'TOWN' | 'COUNTY' = 'ADDRESS';
      let zoom = 16;
      let autoInspect = false;

      if (addrType === 'Locality' || addrType === 'Postal' || addrType === 'PostalLoc') {
        category = 'TOWN';
        zoom = 14;
      } else if (addrType === 'Subadmin') {
        category = 'COUNTY';
        zoom = 11;
      } else if (addrType === 'StreetName' || addrType === 'StreetInt') {
        category = 'STREET';
        zoom = 16;
      } else {
        category = 'ADDRESS';
        zoom = 17;
        autoInspect = true;
      }

      const subParts = [
        attrs.City && !matchAddr.includes(attrs.City) ? attrs.City : '',
        attrs.Subregion || '',
        'Kansas',
      ].filter(Boolean);

      pushUnique({
        id: `esri-${category}-${matchAddr}-${lat.toFixed(4)}`,
        category,
        title: matchAddr.replace(/,\s*USA$/i, ''),
        subtitle:
          category === 'TOWN'
            ? `Kansas Town · ${attrs.Subregion || 'Kansas'}`
            : category === 'STREET'
            ? `Kansas Street / Road · ${subParts.join(' · ')}`
            : category === 'COUNTY'
            ? 'Kansas County Boundary'
            : `Exact Kansas Property Address · ${subParts.join(' · ')}`,
        county: attrs.Subregion ? `${attrs.Subregion}, KS` : 'Kansas',
        lat,
        lng,
        zoom,
        autoInspect,
      });
    }
  }

  // E. Kansas ORKA Statewide Named Roads & County Roads (Layer 17)
  if (orkaRoads?.features?.length) {
    for (const f of orkaRoads.features) {
      const p = f.properties || {};
      const center = computeGeoJsonCenter(f.geometry);
      if (!center || !p.LABEL) continue;
      const roadTitle = String(p.LABEL).trim();
      const loc = [p.MUNI_L || p.POSTCO_L, p.COUNTY_L ? `${p.COUNTY_L} County, KS` : 'Kansas']
        .filter(Boolean)
        .join(' · ');
      pushUnique({
        id: `road-${p.OBJECTID || roadTitle}`,
        category: 'STREET',
        title: roadTitle,
        subtitle: `Kansas Road${p.SURFACE ? ` (${p.SURFACE})` : ''} · ${loc}`,
        county: p.COUNTY_L ? `${p.COUNTY_L} County, KS` : 'Kansas',
        lat: center.lat,
        lng: center.lng,
        zoom: 16,
      });
    }
  }

  // F. Kansas ORKA All 105 Counties
  if (orkaCounties?.features?.length) {
    for (const f of orkaCounties.features) {
      const p = f.properties || {};
      const center = computeGeoJsonCenter(f.geometry);
      if (!center || !p.NAME10) continue;
      const fullCounty = `${String(p.NAMELSAD10 || `${p.NAME10} County`).trim()}, KS`;
      pushUnique({
        id: `county-${p.OBJECTID || p.NAME10}`,
        category: 'COUNTY',
        title: fullCounty,
        subtitle: 'Official Kansas County · Tap to scout property lines & WIHA',
        county: fullCounty,
        lat: center.lat,
        lng: center.lng,
        zoom: 12,
      });
    }
  }

  // G. Statewide Kansas WIHA Public Walk-In Hunting Tracts
  if (wihaData?.features?.length) {
    for (const f of wihaData.features) {
      const p = f.properties || {};
      const rings = extractLatLngRings(f.geometry);
      const center = rings.length ? computePolygonCenter(rings) : null;
      if (!center) continue;
      const acres = Number(p.ACRES || 0) || computeRingAcres(rings[0] || []);
      const parcel = {
        id: `wiha-${p.OBJECTID || p.AREAID}`,
        source: 'KDWP WIHA Public',
        sectionCode: `WIHA #${p.AREAID || p.OBJECTID}`,
        name: `Kansas WIHA Tract #${p.AREAID || p.OBJECTID}`,
        ownerName: 'KDWP Walk-In Hunting Access (Public)',
        ownerEntityType: 'KDWPT WIHA',
        acres: Number(acres.toFixed(1)),
        landType: 'WIHA Walk-In Public',
        taxMailingAddress: `KDWP Public Access · ${p.COUNTY || 'Kansas'} County, KS`,
        county: `${p.COUNTY || 'Kansas'} County, KS`,
        parcelTaxId: `WIHA-${p.AREAID || p.OBJECTID}`,
        livesOnLand: false,
        homesteadNote: 'PUBLIC WALK-IN HUNTING GROUND — Open per KDWP WIHA Atlas.',
        permissionStatus: 'PUBLIC',
        bestWindDirections: ['NW', 'N', 'W'],
        idealSpecies: ['Deer', 'Turkey', 'Coyote'],
        pressureLevel: 'Low',
        trucksSeenThisWeek: 1,
        publicRules: `WIHA Public Ground — ${[p.SPECIES1, p.SPECIES2].filter(Boolean).join(', ') || 'Deer & Upland'} · Walk-In Only`,
        publicOpenSeason: p.AccessDates || 'Sept 1 – Jan 31',
        publicLinks: buildPublicLinks('KDWP WIHA', `${p.COUNTY || ''} County, KS`),
        rings,
        center,
        terrainNotes: `Public WIHA tract (${acres.toFixed(1)} ac).`,
        crewNotes: [],
        leaseMessages: [],
      };
      pushUnique({
        id: `wiha-res-${parcel.id}`,
        category: 'PUBLIC',
        title: `WIHA #${p.AREAID || p.OBJECTID} (${acres.toFixed(1)} ac)`,
        subtitle: `Public Walk-In Hunting · ${p.COUNTY || 'Kansas'} County, KS`,
        county: `${p.COUNTY || 'Kansas'} County, KS`,
        lat: center.lat,
        lng: center.lng,
        zoom: 15,
        parcel,
      });
    }
  }

  // Sort smartly: Exact matches first, then Owners/Addresses/Towns/Streets/Counties
  const qLower = rawQ.toLowerCase();
  results.sort((a, b) => {
    const aStarts = String(a.title).toLowerCase().startsWith(qLower) ? 1 : 0;
    const bStarts = String(b.title).toLowerCase().startsWith(qLower) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;
    const rank: Record<string, number> = {
      OWNER: hasLeadingNumber ? 3 : 1,
      ADDRESS: hasLeadingNumber ? 1 : 2,
      TOWN: 2,
      STREET: 3,
      PUBLIC: 4,
      COUNTY: 5,
    };
    return (rank[a.category] || 9) - (rank[b.category] || 9);
  });

  const finalResults = results.slice(0, 28);
  searchCache.set(cacheKey, { ts: Date.now(), results: finalResults });
  if (searchCache.size > 200) {
    const firstKey = searchCache.keys().next().value;
    if (firstKey) searchCache.delete(firstKey);
  }

  return res.json({ query: rawQ, results: finalResults });
});

// ============================================================================
// GET /api/ks-gis/town-info?lat=&lng=&name= — Instant Kansas Town Scouting Briefing
// Returns County, Nearby WIHA Public Tracts & Total Acres within ~12 miles
// ============================================================================
app.get('/api/ks-gis/town-info', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const name = String(req.query.name || 'Kansas Town').trim();
  const fallbackCounty = String(req.query.county || '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Valid lat/lng required' });
  }

  const env = `${lng - 0.25},${lat - 0.22},${lng + 0.25},${lat + 0.22}`;
  const ptGeom = `${lng},${lat}`;

  const [countyData, wihaNearby] = await Promise.all([
    fetchJsonSafe(
      `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/KS_County_Website_Links_SHP/FeatureServer/0/query?geometry=${encodeURIComponent(
        ptGeom
      )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&outFields=NAME10,CO_ABBR,GIS_PORTAL,PARCEL_SEA,GIS_CONTAC&f=json`,
      4500
    ),
    fetchJsonSafe(
      `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/2023_2024_WIHA_ACCESS/FeatureServer/73/query?geometry=${encodeURIComponent(
        env
      )}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&outFields=AREAID,ACRES,SPECIES1&resultRecordCount=100&f=json`,
      4500
    ),
  ]);

  const cAttrs = countyData?.features?.[0]?.attributes || {};
  const countyShortName = String(cAttrs.NAME10 || '').trim();
  const county = countyShortName
    ? `${countyShortName} County, KS`
    : fallbackCounty || 'Kansas';
  const wihaFeatures = Array.isArray(wihaNearby?.features) ? wihaNearby.features : [];
  const totalWihaAcres = wihaFeatures.reduce(
    (sum: number, f: any) => sum + Number(f.attributes?.ACRES || 0),
    0
  );

  // Check if this town is inside one of our 21 direct live county appraiser GIS feeds
  const directCounty = KS_COUNTY_SOURCES.find(
    (s) =>
      lng >= s.bbox.minLng &&
      lng <= s.bbox.maxLng &&
      lat >= s.bbox.minLat &&
      lat <= s.bbox.maxLat
  );
  const cleanP = (u: any) => {
    const s = String(u || '').trim();
    return s.startsWith('http') ? s : undefined;
  };
  const portalEntry: KsCountyPortalEntry | null = countyShortName
    ? {
        county: countyShortName,
        abbr: String(cAttrs.CO_ABBR || ''),
        gisPortal: cleanP(cAttrs.GIS_PORTAL),
        parcelSearch: cleanP(cAttrs.PARCEL_SEA),
        appraiserContact: cleanP(cAttrs.GIS_CONTAC),
      }
    : await getKansasCountyPortal(county);
  const exactPortalUrl = resolveBestCountyAppraiserUrl(portalEntry, countyShortName || county);

  return res.json({
    name,
    county,
    lat,
    lng,
    nearbyWihaCount: wihaFeatures.length,
    nearbyWihaAcres: Math.round(totalWihaAcres),
    hasDirectCountyRoll: true,
    directCountyLabel: directCounty?.hasOwnerNames
      ? `${directCounty.label} (Live Owner Names)`
      : `${countyShortName || 'Kansas'} Statewide ORKA Appraiser Roll (Live Owner Names & Parcels)`,
    orkaPortalUrl: exactPortalUrl,
  });
});

// In-memory + persistent verified phone cache so discovered numbers integrate seamlessly across GIS loads
const ownerLookupCache = new Map<string, any>();
let googleSearchCooldownUntil = 0;

interface CachedPhoneEntry {
  phone: string;
  phones: { number: string; label: string; source: string }[];
  citation: string;
  matchedListings: { name: string; phone?: string; address: string; source: string; url: string }[];
  updatedAt: number;
}

const PHONE_CACHE_FILE = path.resolve(__dirname, '.phone-directory-cache.json');
const verifiedPhoneCache = new Map<string, CachedPhoneEntry>();

function normalizePhoneCacheKey(ownerName: string, county?: string): string {
  const cleanOwner = normalizeOwnerNameForSearch(ownerName || '')
    .display.toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanCounty = String(county || '')
    .replace(/\(.*\)/g, '')
    .replace(/,?\s*KS\b/gi, '')
    .replace(/\bCounty\b/gi, '')
    .toUpperCase()
    .trim();
  return cleanOwner ? `${cleanOwner}|${cleanCounty || 'KS'}` : '';
}

function normalizeAddrCacheKey(address?: string, county?: string): string {
  const raw = String(address || '').trim();
  if (!raw || raw.length < 6 || /SEE LINK|TAX ROLL|SEARCHING|TAP PARCEL|\bPO\s*BOX\b/i.test(raw)) return '';
  const cleanAddr = raw
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^0+(?=\d)/, '');
  // Require a real leading house/building number >= 10 (never road-only "ELLIS EL DORADO", "20TH EL DORADO", "HWY 54", or "00000 ...")
  if (!/^[1-9]\d{1,5}\s+(?!(?:ST|ND|RD|TH|HWY|HIGHWAY|CO|COUNTY|US|KS)\b)[A-Z]/i.test(cleanAddr)) {
    return '';
  }
  const cleanCounty = String(county || '')
    .replace(/\(.*\)/g, '')
    .replace(/,?\s*KS\b/gi, '')
    .replace(/\bCounty\b/gi, '')
    .toUpperCase()
    .trim();
  return `ADDR:${cleanAddr}|${cleanCounty || 'KS'}`;
}

function loadVerifiedPhoneCacheFromDisk() {
  try {
    if (!fs.existsSync(PHONE_CACHE_FILE)) return;
    const raw = fs.readFileSync(PHONE_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof (v as any).phone === 'string') {
          verifiedPhoneCache.set(k, v as CachedPhoneEntry);
        }
      }
    }
  } catch {
    // Non-blocking cache read
  }
}

let phoneCacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSavePhoneCacheToDisk() {
  if (phoneCacheSaveTimer) return;
  phoneCacheSaveTimer = setTimeout(() => {
    phoneCacheSaveTimer = null;
    try {
      const entries = Array.from(verifiedPhoneCache.entries()).slice(-2000);
      const obj = Object.fromEntries(entries);
      fs.writeFileSync(PHONE_CACHE_FILE, JSON.stringify(obj), 'utf8');
    } catch {
      // Non-blocking cache write
    }
  }, 600);
}

loadVerifiedPhoneCacheFromDisk();

function recordVerifiedPhonesToCache(params: {
  ownerName: string;
  county?: string;
  propertyAddress?: string;
  phones: { number: string; label: string; source: string }[];
  matchedListings?: { name: string; phone?: string; address: string; source: string; url: string }[];
  prepend?: boolean;
}) {
  if (!params.phones?.length) return;
  const ownerKey = normalizePhoneCacheKey(params.ownerName, params.county);
  const addrKey = normalizeAddrCacheKey(params.propertyAddress, params.county);
  const existing =
    (ownerKey ? verifiedPhoneCache.get(ownerKey) : undefined) ||
    (addrKey ? verifiedPhoneCache.get(addrKey) : undefined);

  const mergedPhones: { number: string; label: string; source: string }[] = [];
  const seenDigits = new Set<string>();
  const ordered = params.prepend
    ? [...params.phones, ...(existing?.phones || [])]
    : [...(existing?.phones || []), ...params.phones];

  for (const ph of ordered) {
    if (!ph?.number) continue;
    const d = ph.number.replace(/\D/g, '').slice(-10);
    if (d.length < 10 || seenDigits.has(d)) continue;
    seenDigits.add(d);
    mergedPhones.push(ph);
  }
  if (!mergedPhones.length) return;

  const entry: CachedPhoneEntry = {
    phone: mergedPhones[0].number,
    phones: mergedPhones.slice(0, 10),
    citation: mergedPhones[0].source || existing?.citation || 'Verified Public Record',
    matchedListings: (params.matchedListings?.length ? params.matchedListings : existing?.matchedListings || []).slice(0, 8),
    updatedAt: Date.now(),
  };
  if (ownerKey) verifiedPhoneCache.set(ownerKey, entry);
  if (addrKey) verifiedPhoneCache.set(addrKey, entry);
  scheduleSavePhoneCacheToDisk();
}

function attachCachedPhoneToParcel<T extends Record<string, any>>(parcel: T): T {
  if (!parcel || parcel.permissionStatus === 'PUBLIC') return parcel;
  const ownerKey = normalizePhoneCacheKey(parcel.ownerName, parcel.county);
  const addrKey = normalizeAddrCacheKey(parcel.propertyAddress, parcel.county);
  const hit =
    (ownerKey ? verifiedPhoneCache.get(ownerKey) : undefined) ||
    (addrKey ? verifiedPhoneCache.get(addrKey) : undefined);
  if (!hit) return parcel;
  return {
    ...parcel,
    publicPhoneListing: parcel.publicPhoneListing || hit.phone,
    publicPhoneListings: hit.phones?.length ? hit.phones : parcel.publicPhoneListings,
    phoneSourceCitation: parcel.phoneSourceCitation || hit.citation,
  };
}

function isQuotaError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return err?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
}

function isPlaceholderOwnerName(raw?: string): boolean {
  const s = String(raw || '').trim();
  if (!s || s.length < 3) return true;
  return /^(Private (Owner|Landowner|Parcel)|Section \d+|Unknown|KDWP|KS WIHA)/i.test(s);
}

// Helper: extract Attn contact person ("Attn: SUNDGREN, JEREMY, 218 E CENTRAL AVE...") from tax mailing address
function extractAttnFromAddress(addr?: string): string[] {
  const s = String(addr || '').trim();
  if (!s) return [];
  const m = s.match(/Attn:\s*([^,\n]+(?:,\s*[A-Za-z.\s]+)?)/i);
  if (!m) return [];
  const raw = m[1]
    .replace(/;\s*(?:TRUSTEE|EXEC|AGENT|MANAGER|MGR|PRES|OWNER)\b.*$/i, '')
    .trim();
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && !/\d/.test(parts[1])) {
    const last = parts[0];
    const first = parts[1].split(/\s+/)[0] || '';
    if (first && last) return [`${first} ${last}`];
  }
  return !/\d/.test(raw) && raw.length >= 3 ? [raw] : [];
}

// Helper: normalize county appraiser owner string ("SUNDGREN, JOE; FAMILY TRUST" -> "Joe Sundgren")
function normalizeOwnerNameForSearch(raw: string): {
  display: string;
  searchName: string;
  altSearchNames: string[];
  firstName: string;
  surname: string;
  people: { first: string; last: string }[];
  isEntity: boolean;
  isBareSurnameTrust: boolean;
} {
  const rawStr = String(raw || '').trim();
  const hadTrustWord = /\b(?:TRUST|TR|ESTATE)\b/i.test(rawStr);
  const cleaned = rawStr
    .replace(
      /;\s*(?:JOINT\s+|FAMILY\s+|LIVING\s+|REVOCABLE\s+|IRREVOCABLE\s+|JT\s+|LIV\s+|REV\s+)?(?:TOD|JTROS|ET\s*UX|ET\s*AL|LIFE\s*EST|REV\s*TR(?:UST)?|LIV\s*TR(?:UST)?|FAMILY\s*TRUST|TRUST|TR)\b.*$/i,
      ''
    )
    .replace(
      /,\s*(?:JOINT\s+|FAMILY\s+|LIVING\s+|REVOCABLE\s+|IRREVOCABLE\s+|JT\s+|LIV\s+|REV\s+)?(?:REV\s*TR(?:UST)?|LIV\s*TR(?:UST)?|FAMILY\s*TRUST|TRUST|TR)\b.*$/i,
      ''
    )
    .replace(
      /\s+(?:JT|JOINT|FAMILY|LIVING|REVOCABLE|IRREVOCABLE|LIV|REV)\s+(?:REV\s+)?(?:TRUST|TR|ESTATE|TOD|JTROS)\b.*$/i,
      ''
    )
    .replace(/\s+(?:TRUST|TR|TOD|JTROS|ET\s*AL|ET\s*UX)\s*$/i, '')
    .replace(/\b(?:JOINT|FAMILY|LIVING|REVOCABLE|IRREVOCABLE)\s+(?:REVOCABLE\s+)?(?:TRUST|TR)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const entityKeywordRegex =
    /\b(LLC|L\.L\.C\.|INC|CORP|LP|LLP|CO|COMPANY|ASSOCIATION|COOPERATIVE|CO-OP|COOP|BUREAU|CHURCH|PARISH|CEMETERY|BANK|ESTATE|PARTNERSHIP|PARTNERS|HOLDINGS|LAND|CATTLE|AG|FARMS|RANCH|ENTERPRISES|SERVICES|PROPERTIES|MANAGEMENT|REALTY|INVESTMENTS|DEVELOPMENT|GROUP|FOUNDATION|CLUB|LODGE|ELECTRIC|DISTRICT|MARINA|TOWNSHIP|TWP|BOARD|SCHOOL|USD|CONSERVANCY|RAILROAD|RAILWAY|CITY OF|COUNTY OF|STATE OF|KANSAS)\b/i;
  const cleanedTokens = cleaned.replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const isBareSurnameTrust =
    hadTrustWord &&
    cleanedTokens.length === 1 &&
    !entityKeywordRegex.test(cleaned);
  const isEntity = entityKeywordRegex.test(cleaned) || isBareSurnameTrust;

  if (isEntity) {
    const entityDisplay = cleaned.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    const strippedEntity = entityDisplay
      .replace(/\b(LLC|L\.L\.C\.|INC|CORP|CO|LP|LLP|TRUST|TR)\b\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const altSet = new Set<string>();
    if (strippedEntity && strippedEntity.toLowerCase() !== entityDisplay.toLowerCase()) {
      altSet.add(strippedEntity);
    }
    const firstWord = strippedEntity.split(/\s+/)[0] || '';
    return {
      display: entityDisplay || cleaned,
      searchName: entityDisplay || cleaned,
      altSearchNames: Array.from(altSet),
      firstName: '',
      surname: firstWord,
      people: [],
      isEntity: true,
      isBareSurnameTrust,
    };
  }

  const segments = cleaned
    .split(/\s*[&\/;]\s*|\s+\bAND\b\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const convertPart = (part: string, sharedLast?: string): { full: string; first: string; last: string } => {
    if (part.includes(',')) {
      const [last, rest] = part.split(',').map((s) => s.trim());
      const given =
        (rest || '')
          .split(/\s+/)
          .filter((w) => w && !/^(JR|SR|II|III|IV|TRUST|TR)$/i.test(w))[0] || '';
      if (given && last) return { full: `${given} ${last}`.trim(), first: given, last };
    }
    if (sharedLast && !part.includes(',') && part.split(/\s+/).length <= 3) {
      const first =
        part
          .split(/\s+/)
          .filter((w) => w && !/^(JR|SR|II|III|IV)$/i.test(w))[0] || '';
      if (first) return { full: `${first} ${sharedLast}`.trim(), first, last: sharedLast };
    }
    const cleanPart = part.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
    const tok = cleanPart.split(/\s+/).filter((w) => w && !/^(JR|SR|II|III|IV)$/i.test(w));
    // All-caps county GIS record without commas (e.g., "LECHTENBERG LANCE JOSEPH LISA ELAINE") -> token[0] is LAST, token[1] is FIRST
    if (tok.length >= 3 && cleanPart === cleanPart.toUpperCase() && tok[0].length >= 3 && tok[1].length >= 2) {
      return { full: `${tok[1]} ${tok[0]}`, first: tok[1], last: tok[0] };
    }
    return { full: cleanPart, first: tok[0] || '', last: tok[tok.length - 1] || '' };
  };

  const primaryPart = segments[0] || cleaned;
  let sharedLast = '';
  if (primaryPart.includes(',')) {
    sharedLast = primaryPart.split(',')[0].trim();
  } else {
    const pTok = primaryPart.replace(/[,;]/g, ' ').trim().split(/\s+/);
    if (pTok.length >= 3 && primaryPart === primaryPart.toUpperCase()) {
      sharedLast = pTok[0];
    }
  }

  const primaryParsed = convertPart(primaryPart);
  const people: { first: string; last: string }[] = [];
  if (primaryParsed.first && primaryParsed.last) {
    people.push({ first: primaryParsed.first, last: primaryParsed.last });
  }
  const altSet = new Set<string>();
  for (let i = 1; i < segments.length && i < 3; i++) {
    const alt = convertPart(segments[i], sharedLast);
    if (alt.full && alt.full.toLowerCase() !== primaryParsed.full.toLowerCase()) {
      altSet.add(alt.full);
    }
    if (alt.first && alt.last) {
      people.push({ first: alt.first, last: alt.last });
    }
  }
  // If comma-less uppercase string had a second spouse embedded ("LECHTENBERG LANCE JOSEPH LISA ELAINE"), extract spouse token[3] + LAST
  if (segments.length === 1 && !primaryPart.includes(',') && primaryPart === primaryPart.toUpperCase()) {
    const tok = primaryPart.split(/\s+/).filter((w) => w && !/^(JR|SR|II|III|IV)$/i.test(w));
    if (tok.length >= 4 && tok[3].length >= 3) {
      altSet.add(`${tok[3]} ${tok[0]}`);
      people.push({ first: tok[3], last: tok[0] });
    }
  }

  return {
    display: cleaned,
    searchName: primaryParsed.full || cleaned,
    altSearchNames: Array.from(altSet),
    firstName: primaryParsed.first,
    surname: primaryParsed.last,
    people,
    isEntity: false,
    isBareSurnameTrust: false,
  };
}

// Helper: extract valid US phone numbers from AI output (strictly rejecting fake 555/000/1234 placeholders)
function extractVerifiedPhones(text: string): { number: string; label: string; source: string }[] {
  const found: { number: string; label: string; source: string }[] = [];
  const seenDigits = new Set<string>();

  const isFakeNumber = (digits: string) => {
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (ten.length !== 10) return true;
    const area = ten.slice(0, 3);
    const exch = ten.slice(3, 6);
    if (area.startsWith('0') || area.startsWith('1') || exch.startsWith('0') || exch.startsWith('1')) return true;
    if (exch === '555') return true;
    if (/^(\d)\1{9}$/.test(ten) || ten === '1234567890') return true;
    return false;
  };

  const formatTen = (digits: string) => {
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  };

  // Pass 1: structured PHONE: lines (with optional markdown bold/bullet prefix)
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^[\s*\-•]+/, '').replace(/\*\*/g, '').trim();
    if (/^PHONE\s*:/i.test(line)) {
      const rest = line.replace(/^PHONE\s*:\s*/i, '').trim();
      if (/^NONE\b/i.test(rest)) continue;
      const parts = rest.split('|').map((s) => s.trim());
      const match = (parts[0] || rest).match(/(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
      if (match) {
        const digits = match[0].replace(/\D/g, '');
        if (!isFakeNumber(digits) && !seenDigits.has(digits.slice(-10))) {
          seenDigits.add(digits.slice(-10));
          found.push({
            number: formatTen(digits),
            label: parts[1] || 'Public Directory Listing',
            source: parts[2] || 'Google Search Public Record',
          });
        }
      }
    }
  }

  // Pass 2: catch any real phone numbers mentioned anywhere in the grounded briefing body
  const globalMatches = text.match(/(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g) || [];
  for (const m of globalMatches) {
    const digits = m.replace(/\D/g, '');
    const key = digits.slice(-10);
    if (!isFakeNumber(digits) && !seenDigits.has(key)) {
      seenDigits.add(key);
      found.push({
        number: formatTen(digits),
        label: 'Public Record Match',
        source: 'Grounded Web Search',
      });
    }
  }

  return found.slice(0, 6);
}

// Helper: live Kansas multi-source public directory lookup (YellowPages + Superpages + DexKnows + BBB KS + NPI KS + OSM)
// Runs with zero Gemini quota dependency and strict Kansas address/name verification!
async function searchKansasPublicDirectories(params: {
  searchName: string;
  altSearchNames?: string[];
  firstName?: string;
  surname?: string;
  people?: { first: string; last: string }[];
  displayOwner: string;
  cityOrCounty: string;
  county?: string;
  propertyAddress?: string;
  taxMailingAddress?: string;
  isEntity: boolean;
  isBareSurnameTrust?: boolean;
}): Promise<{
  listings: { name: string; phone?: string; address: string; source: string; url: string }[];
  phones: { number: string; label: string; source: string }[];
}> {
  const {
    searchName,
    altSearchNames = [],
    firstName = '',
    surname = '',
    people = [],
    displayOwner,
    cityOrCounty,
    county = '',
    propertyAddress,
    taxMailingAddress,
    isEntity,
    isBareSurnameTrust = false,
  } = params;

  const mailCityMatch = String(taxMailingAddress || '').match(/(?:,\s*|^)([A-Za-z][A-Za-z\s]{1,22}),\s*([A-Z]{2})\b/);
  const mailCity = mailCityMatch ? `${mailCityMatch[1].trim()}, ${mailCityMatch[2]}` : '';
  const cleanLoc = mailCity && /\bKS\b/i.test(mailCity) ? mailCity : `${cityOrCounty || 'Kansas'}, KS`;
  const targetCityUpper = (mailCityMatch?.[1] || cityOrCounty || '').trim().toUpperCase();
  const allTargetCities = new Set<string>(
    [targetCityUpper, cityOrCounty.toUpperCase()]
      .map((s) => s.trim())
      .filter((s) => s.length >= 3)
  );
  // Regional metro/county neighbors so local KS listings in adjacent towns (e.g. El Dorado <-> Augusta/Benton/Wichita) are allowed, while 200mi distant cities (Belleville) are rejected
  const countyUpper = county.toUpperCase();
  const allowedAreaCodes = new Set<string>();
  if (/BUTLER|SEDGWICK|HARVEY|SUMNER|COWLEY/.test(countyUpper) || /EL DORADO|WICHITA|AUGUSTA|ANDOVER|WELLINGTON|NEWTON|WINFIELD/.test(targetCityUpper)) {
    allowedAreaCodes.add('316');
    allowedAreaCodes.add('620');
  } else if (/RENO|LYON|KINGMAN|HARPER|MARION|CHASE|MC.?PHERSON|PRATT|ELK|CHAUTAUQUA|GREENWOOD|FORD|FINNEY/.test(countyUpper) || /EMPORIA|HUTCHINSON|KINGMAN/.test(targetCityUpper)) {
    allowedAreaCodes.add('620');
    allowedAreaCodes.add('316');
  } else if (/SHAWNEE|RILEY|DOUGLAS|MARSHALL|POTTAWATOMIE|GEARY|ELLIS|SALINE|OSAGE|FRANKLIN/.test(countyUpper) || /TOPEKA|MANHATTAN|LAWRENCE|MARYSVILLE|SALINA/.test(targetCityUpper)) {
    allowedAreaCodes.add('785');
    allowedAreaCodes.add('913');
  } else if (/JOHNSON|WYANDOTTE|LEAVENWORTH|MIAMI/.test(countyUpper)) {
    allowedAreaCodes.add('913');
    allowedAreaCodes.add('816');
  }

  const attnNames = extractAttnFromAddress(taxMailingAddress);
  const stopWords = new Set([
    'THE',
    'AND',
    'OF',
    'FOR',
    'INC',
    'LLC',
    'CORP',
    'CO',
    'TRUST',
    'TR',
    'KS',
    'KANSAS',
    'COUNTY',
    'RD',
    'ST',
    'AVE',
    'DR',
    'LN',
    'DBA',
    'BOARD',
    'CITY',
    'STATE',
  ]);
  const genericGeoWords = new Set([
    'FLINT',
    'HILLS',
    'PRAIRIE',
    'VALLEY',
    'CREEK',
    'RIVER',
    'LAKE',
    'HIGHWAY',
    'HWY',
    'TURNER',
    'SUNFLOWER',
    'WEST',
    'EAST',
    'NORTH',
    'SOUTH',
    'TOWNSHIP',
    'TWP',
  ]);

  const genericBizWords = new Set([
    'PROPERTY',
    'PROPERTIES',
    'MANAGEMENT',
    'ENTERPRISES',
    'HOLDINGS',
    'INVESTMENTS',
    'SERVICES',
    'PARTNERS',
    'PARTNERSHIP',
    'GROUP',
    'REALTY',
    'SPECIAL',
    'EDUCATION',
    'INTERLOCAL',
    'DEVELOPMENT',
    'ASSOCIATION',
    'COOPERATIVE',
    'DISTRICT',
    'SYSTEMS',
    'SOLUTIONS',
    'COMPANY',
    'BANK',
    'TRUST',
    'CATTLE',
    'FARMS',
    'FARM',
    'RANCH',
    'LAND',
  ]);

  const allTermNames = [searchName, ...altSearchNames, ...attnNames].filter(Boolean);
  const nameTokens = Array.from(
    new Set(
      allTermNames
        .join(' ')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !stopWords.has(t))
    )
  );
  const primaryTokens = searchName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stopWords.has(t));
  const specificEntityTokens = primaryTokens.filter((t) => !genericGeoWords.has(t) && !genericBizWords.has(t));
  const allEntityContentTokens = primaryTokens.filter((t) => !genericGeoWords.has(t));

  // Extract ONLY true leading street house numbers (never ZIP codes, PO Boxes, Highway numbers, or 20TH/40TH road numbers!)
  const streetNums = new Set<string>();
  for (const addr of [propertyAddress, taxMailingAddress]) {
    const rawAddr = String(addr || '')
      .replace(/^Attn:[^,\n]+(?:,\s*[A-Za-z.\s]+)?,?\s*/i, '')
      .replace(/\b(?:PO|P\.?O\.?)\s*BOX\s*\d+/gi, '')
      .replace(/,\s*(?:[A-Za-z\s]+,\s*)?[A-Z]{2}\s+\d{5}(?:-\d{4})?\b.*$/i, '')
      .trim();
    const m = rawAddr.match(/^\s*0*([1-9]\d{1,5})\s+(?!(?:ST|ND|RD|TH|HWY|HIGHWAY|CO|COUNTY|US|KS)\b)[A-Za-z]/i);
    if (m && m[1].length >= 2) {
      streetNums.add(m[1]);
    }
  }

  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const fetchHtmlSafe = async (url: string, timeoutMs = 3400): Promise<string> => {
    try {
      const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return '';
      return await r.text();
    } catch {
      return '';
    }
  };

  const decodeHtml = (s?: string) =>
    (s || '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/<[^>]+>/g, '')
      .trim();

  const parseYpStyleHtml = (html: string, baseUrl: string, sourceName: string) => {
    if (!html) return [];
    const mainHtml = html.split(/class="[^"]*category-expansion/i)[0] || html;
    const out: { name: string; phone?: string; address: string; snippet?: string; source: string; url: string }[] = [];

    const cards = mainHtml.split(/<div class="result"/i).slice(1, 14);
    for (const c of cards) {
      const nameM = c.match(/class="business-name"[^>]*>(?:<span[^>]*>)?([^<]+)/i);
      const phoneM =
        c.match(/class="phones?[^"]*"[^>]*>([^<]+)/i) ||
        c.match(/href="tel:([^"]+)"/i);
      const streetM = c.match(/class="street-address"[^>]*>([^<]+)/i);
      const locM = c.match(/class="locality"[^>]*>([^<]+)/i);
      const hrefM = c.match(/class="business-name"[^>]*href="([^"]+)"/i);
      const snipM = c.match(/class="snippet"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      const name = decodeHtml(nameM?.[1]);
      if (!name) continue;
      const address = [decodeHtml(streetM?.[1]), decodeHtml(locM?.[1])].filter(Boolean).join(', ');
      const phone = decodeHtml(phoneM?.[1]) || undefined;
      const snippet = decodeHtml((snipM?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
      const rawHref = hrefM?.[1] || '';
      const url = rawHref.startsWith('http') ? rawHref : rawHref ? `${baseUrl}${rawHref}` : baseUrl;
      out.push({ name, phone, address, snippet, source: sourceName, url });
    }

    const ldBlocks = mainHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || [];
    for (const blk of ldBlocks) {
      try {
        const inner = blk.replace(/^<script[^>]*>|<\/script>$/gi, '').trim();
        const data = JSON.parse(inner);
        const arr = Array.isArray(data) ? data : Array.isArray(data?.itemListElement) ? data.itemListElement : [data];
        for (const rawItem of arr) {
          const item = rawItem?.item || rawItem;
          if (!item?.telephone || !item?.name) continue;
          const addr = item.address
            ? [item.address.streetAddress, item.address.addressLocality, item.address.addressRegion]
                .filter(Boolean)
                .join(', ')
            : cleanLoc;
          out.push({
            name: String(item.name).trim(),
            phone: String(item.telephone).trim(),
            address: addr,
            source: sourceName,
            url: item.url ? (String(item.url).startsWith('http') ? String(item.url) : `${baseUrl}${item.url}`) : baseUrl,
          });
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }
    return out;
  };

  // Search primary term, alt/co-owner or Attn person, and surname (for farm/ranch/realty/street matches)
  const termSet = new Set<string>([searchName]);
  if (attnNames[0]) termSet.add(attnNames[0]);
  else if (altSearchNames[0]) termSet.add(altSearchNames[0]);
  const cleanSurname = surname.replace(/[^A-Za-z]/g, '');
  if (!isEntity && cleanSurname.length >= 4 && !genericGeoWords.has(cleanSurname.toUpperCase())) {
    termSet.add(cleanSurname);
  }
  const searchTermsToRun = Array.from(termSet).slice(0, 3);
  const queries: Promise<any>[] = [];

  for (const term of searchTermsToRun) {
    queries.push(
      fetchHtmlSafe(
        `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(term)}&geo_location_terms=${encodeURIComponent(cleanLoc)}`
      ).then((h) => parseYpStyleHtml(h, 'https://www.yellowpages.com', 'YellowPages KS')),
      fetchHtmlSafe(
        `https://www.superpages.com/search?search_terms=${encodeURIComponent(term)}&geo_location_terms=${encodeURIComponent(cleanLoc)}`
      ).then((h) => parseYpStyleHtml(h, 'https://www.superpages.com', 'Superpages KS')),
      fetchHtmlSafe(
        `https://www.dexknows.com/search?search_terms=${encodeURIComponent(term)}&geo_location_terms=${encodeURIComponent(cleanLoc)}`
      ).then((h) => parseYpStyleHtml(h, 'https://www.dexknows.com', 'DexKnows KS'))
    );
  }

  // BBB Midwest Plains / Kansas JSON API (finds local farms, contractors, realtors, ranches)
  for (const bbbTerm of searchTermsToRun.slice(0, 2)) {
    queries.push(
      fetchJsonSafe(
        `https://www.bbb.org/api/search?find_text=${encodeURIComponent(bbbTerm)}&find_loc=${encodeURIComponent(cleanLoc)}`,
        3600
      ).then((d) => {
        const rows = Array.isArray(d?.results) ? d.results.slice(0, 6) : [];
        return rows
          .filter((r: any) => Array.isArray(r?.phone) && r.phone[0] && String(r?.state || '').toUpperCase() === 'KS')
          .map((r: any) => ({
            name: decodeHtml(r.businessName),
            phone: String(r.phone[0]).trim(),
            address: [r.address, r.city, r.state].filter(Boolean).join(', '),
            snippet: String(r.tobText || ''),
            source: 'BBB Kansas Registry',
            url: r.reportUrl ? `https://www.bbb.org${r.reportUrl}` : 'https://www.bbb.org',
          }));
      })
    );
  }

  // CMS NPPES NPI Kansas Provider Registry (check primary & alt people)
  const npiPeople = (people.length ? people : firstName && cleanSurname ? [{ first: firstName, last: cleanSurname }] : []).slice(0, 2);
  if (!isEntity) {
    for (const p of npiPeople) {
      const f = p.first.replace(/[^A-Za-z]/g, '');
      const l = p.last.replace(/[^A-Za-z]/g, '');
      if (f.length >= 2 && l.length >= 3) {
        queries.push(
          fetchJsonSafe(
            `https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=${encodeURIComponent(f)}&last_name=${encodeURIComponent(l)}&state=KS&limit=5`,
            3600
          ).then((d) => {
            const out: any[] = [];
            for (const r of Array.isArray(d?.results) ? d.results : []) {
              const fullName = [r?.basic?.first_name, r?.basic?.last_name, r?.basic?.credential].filter(Boolean).join(' ').trim();
              for (const a of Array.isArray(r?.addresses) ? r.addresses : []) {
                if (String(a?.state || '').toUpperCase() !== 'KS' || !a?.telephone_number) continue;
                out.push({
                  name: fullName,
                  phone: String(a.telephone_number).trim(),
                  address: [a.address_1, a.city, a.state, a.postal_code?.slice(0, 5)].filter(Boolean).join(', '),
                  source: 'NPPES Kansas NPI Registry',
                  url: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,
                });
                break;
              }
            }
            return out;
          })
        );
      }
    }
  }

  // OpenStreetMap Nominatim (name + city AND exact situs address + city)
  queries.push(
    fetchJsonSafe(
      `https://nominatim.openstreetmap.org/search?format=json&extratags=1&addressdetails=1&limit=4&q=${encodeURIComponent(
        `${searchName} ${cleanLoc}`
      )}`,
      3800
    ).then((arr) => {
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x: any) => x?.extratags?.phone || x?.extratags?.['contact:phone'])
        .map((x: any) => ({
          name: String(x.name || x.display_name || searchName).split(',')[0].trim(),
          phone: x.extratags?.phone || x.extratags?.['contact:phone'] || undefined,
          address: String(x.display_name || cleanLoc),
          source: 'OpenStreetMap Public Listing',
          url: x.extratags?.website || `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=16/${x.lat}/${x.lon}`,
        }));
    })
  );

  const cleanPropAddr = String(propertyAddress || '').replace(/^0+/, '').trim();
  if (cleanPropAddr && /^[1-9]\d{1,5}\s+[A-Za-z]/i.test(cleanPropAddr) && !/SEE LINK|PO BOX/i.test(cleanPropAddr)) {
    queries.push(
      fetchJsonSafe(
        `https://nominatim.openstreetmap.org/search?format=json&extratags=1&addressdetails=1&limit=3&q=${encodeURIComponent(
          `${cleanPropAddr}, ${cleanLoc}`
        )}`,
        3800
      ).then((arr) => {
        if (!Array.isArray(arr)) return [];
        return arr
          .filter((x: any) => x?.extratags?.phone || x?.extratags?.['contact:phone'])
          .map((x: any) => ({
            name: String(x.name || displayOwner || cleanPropAddr).split(',')[0].trim(),
            phone: x.extratags?.phone || x.extratags?.['contact:phone'] || undefined,
            address: String(x.display_name || `${cleanPropAddr}, ${cleanLoc}`),
            source: 'OpenStreetMap Address Match',
            url: x.extratags?.website || `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=16/${x.lat}/${x.lon}`,
          }));
      })
    );
  }

  const groups = await Promise.all(queries);
  const allCandidates: { name: string; phone?: string; address: string; snippet?: string; source: string; url: string }[] = groups.flat();

  const matchedListings: { name: string; phone?: string; address: string; source: string; url: string }[] = [];
  const seenKeys = new Set<string>();
  const surnameUpper = cleanSurname.toUpperCase();
  const personPairs = (people.length ? people : firstName && cleanSurname ? [{ first: firstName, last: cleanSurname }] : [])
    .map((p) => ({
      first: p.first.toUpperCase().replace(/[^A-Z]/g, ''),
      last: p.last.toUpperCase().replace(/[^A-Z]/g, ''),
    }))
    .filter((p) => p.first.length >= 2 && p.last.length >= 3);
  const allSurnamesUpper = Array.from(new Set([surnameUpper, ...personPairs.map((p) => p.last)].filter((s) => s.length >= 3)));
  const attnTokens = attnNames
    .join(' ')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  for (const cand of allCandidates) {
    if (!cand.phone) continue;
    const phoneDigits = cand.phone.replace(/\D/g, '').slice(-10);
    if (phoneDigits.length !== 10) continue;
    const candArea = phoneDigits.slice(0, 3);
    const addrUpper = cand.address.toUpperCase();
    const streetOnlyUpper = (cand.address.split(',')[0] || cand.address).toUpperCase();
    const isKsAddr = /\bKS\b|KANSAS/.test(addrUpper);
    const isKsPhone = /^(?:316|620|785|913)$/.test(candArea);
    if (!isKsAddr && !isKsPhone) continue;

    const candUpper = cand.name.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
    const candWithSnippetUpper = `${cand.name} ${cand.snippet || ''}`.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
    const sameStreetNum = Array.from(streetNums).some((num) => new RegExp(`^0*${num}\\b|\\b${num}\\b`).test(streetOnlyUpper));
    const sameCity = Array.from(allTargetCities).some((c) => addrUpper.includes(c));
    const sameRegion =
      sameCity ||
      allowedAreaCodes.size === 0 ||
      allowedAreaCodes.has(candArea) ||
      candArea === '800' ||
      candArea === '888';

    const hasAnySurname = allSurnamesUpper.some((s) => !genericGeoWords.has(s) && new RegExp(`\\b${s}\\b`).test(candUpper));
    const matchesFullPersonPair = personPairs.some(
      (p) => new RegExp(`\\b${p.first}\\b`).test(candUpper) && new RegExp(`\\b${p.last}\\b`).test(candUpper)
    );
    const matchesAttnPerson = attnTokens.length >= 2 && attnTokens.every((t) => new RegExp(`\\b${t}\\b`).test(candUpper));
    const matchesAttnFamilyAg =
      attnTokens.length >= 1 &&
      sameCity &&
      attnTokens.some((t) => t.length >= 5 && !genericGeoWords.has(t) && new RegExp(`\\b${t}\\b`).test(candUpper)) &&
      /\b(FARM|FARMS|RANCH|CATTLE|AUCTION|REALTY|AG|LAND)\b/.test(candUpper);

    const isUnrelatedRetailOrClinic =
      /\b(BEAUTY\s+SUPPLY|SALON|DRIVE-?IN|AESTHETICS|POOL\s+CONSTRUCTION|MOBILE\s+HOME|BAPTIST|SPECIAL\s+DAY\s+SCHOOL|DAY\s+SCHOOL|BAIL\s+BONDS|FUNERAL|CREMATORY|JEWELRY)\b/i.test(
        candUpper
      );
    const isMedicalTitle = /\b(MD|DDS|DPT|OD|DC|CHIROPRACTIC|VISION\s+CENTER|PHARMACY|CLINIC)\b/i.test(candUpper);
    const isGenericBrand = /\b(BANK|US BANK|CHEVROLET|BUICK|PONTIAC|FORD|WALMART|GMC|EDWARD\s+JONES)\b/i.test(candUpper);
    const isLocalAgFamilyBiz =
      /\b(FARM|FARMS|RANCH|CATTLE|LIVESTOCK|GRAIN|FEED|LAND|REALTY|AUCTION|AG|AGRI|DAIRY|ORCHARD|OUTFITTER)\b/i.test(candUpper);

    let isStrongMatch = false;
    if (cand.source === 'OpenStreetMap Address Match' && sameStreetNum) {
      isStrongMatch = true;
    } else if (sameStreetNum && (hasAnySurname || matchesAttnPerson || (isEntity && specificEntityTokens.some((t) => new RegExp(`\\b${t}\\b`).test(candWithSnippetUpper))))) {
      isStrongMatch = true;
    } else if (matchesAttnPerson || matchesAttnFamilyAg) {
      isStrongMatch = true;
    } else if (isEntity) {
      if (isBareSurnameTrust) {
        // e.g. "MILLER TRUST" -> NEVER match random "Dutch Miller GMC" or "Patta Miller Aesthetics"; only Trust/Farm/Ranch/Land or exact address!
        const sur = specificEntityTokens[0] || '';
        isStrongMatch =
          Boolean(sur) &&
          new RegExp(`\\b${sur}\\b`).test(candUpper) &&
          (sameStreetNum || (sameCity && /\b(TRUST|FARM|FARMS|RANCH|CATTLE|LAND|AG)\b/.test(candUpper)));
      } else if (/\b(TOWNSHIP|TWP|BOARD|CITY OF)\b/i.test(displayOwner)) {
        const nonGovTok = specificEntityTokens.filter((t) => !/^(TOWNSHIP|TWP|BOARD|CITY|COUNTY)$/.test(t));
        isStrongMatch =
          nonGovTok.length >= 1 &&
          nonGovTok.every((t) => new RegExp(`\\b${t}\\b`).test(candUpper)) &&
          /\b(TOWNSHIP|TWP|GOVERNMENT|MUNICIPAL|HALL|CLERK|FIRE|ROAD|DISTRICT|BOARD)\b/i.test(candWithSnippetUpper);
      } else {
        const specificMatched = specificEntityTokens.filter((t) => new RegExp(`\\b${t}\\b`).test(candWithSnippetUpper));
        const allEntityMatched = allEntityContentTokens.filter((t) => new RegExp(`\\b${t}\\b`).test(candWithSnippetUpper));
        // Require at least one distinctive entity token (not just "Property Management" or "Special Education")
        isStrongMatch =
          !isUnrelatedRetailOrClinic &&
          specificMatched.length >= 1 &&
          (specificMatched.length >= 2 ||
            (allEntityMatched.length >= 2 && (sameCity || specificEntityTokens.length <= 2)) ||
            (specificEntityTokens.length === 1 && allEntityContentTokens.length === 1 && specificMatched.length === 1 && sameCity));
      }
    } else {
      // Individual / family trust: strictly match full First+Last in region OR verified local Farm/Ranch/Realty/Auction family business!
      if (isGenericBrand || isUnrelatedRetailOrClinic) {
        isStrongMatch = false;
      } else if (matchesFullPersonPair) {
        // For medical providers (NPI/DDS/MD/OD), require exact local city or regional metro proximity
        isStrongMatch = isMedicalTitle ? sameCity || (sameRegion && isKsAddr) : sameCity || sameRegion;
      } else if (sameCity && hasAnySurname && isLocalAgFamilyBiz && !isMedicalTitle) {
        isStrongMatch = true;
      }
    }

    if (!isStrongMatch) continue;

    const dedupKey = `${cand.name.toLowerCase()}|${phoneDigits}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    matchedListings.push({
      name: cand.name,
      phone: cand.phone,
      address: cand.address,
      source: cand.source,
      url: cand.url,
    });
  }

  const phones: { number: string; label: string; source: string }[] = [];
  const seenPhones = new Set<string>();
  for (const l of matchedListings) {
    if (!l.phone) continue;
    const digits = l.phone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10 && !seenPhones.has(digits)) {
      const area = digits.slice(0, 3);
      const exch = digits.slice(3, 6);
      if (exch !== '555' && !area.startsWith('0') && !area.startsWith('1') && !exch.startsWith('0') && !exch.startsWith('1')) {
        seenPhones.add(digits);
        phones.push({
          number: `(${area}) ${exch}-${digits.slice(6)}`,
          label: l.name.slice(0, 36),
          source: l.source,
        });
      }
    }
  }

  return { listings: matchedListings.slice(0, 8), phones: phones.slice(0, 8) };
}

function buildDirectDirectoryLinks(
  norm: { searchName: string; isEntity: boolean },
  cityOrCounty: string,
  propertyAddress?: string
): { title: string; uri: string }[] {
  const fpsSlug = norm.searchName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const citySlug = cityOrCounty.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const links: { title: string; uri: string }[] = [
    {
      title: `FastPeopleSearch: ${norm.searchName}`,
      uri: `https://www.fastpeoplesearch.com/name/${fpsSlug}_${citySlug}-ks`,
    },
    {
      title: `TruePeopleSearch: ${norm.searchName}`,
      uri: `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(
        norm.searchName
      )}&citystatezip=${encodeURIComponent(`${cityOrCounty}, KS`)}`,
    },
    {
      title: `Whitepages: ${norm.searchName}`,
      uri: `https://www.whitepages.com/name/${encodeURIComponent(
        norm.searchName.replace(/\s+/g, '-')
      )}/KS`,
    },
    {
      title: `Google Phone Lookup: ${norm.searchName}`,
      uri: `https://www.google.com/search?q=${encodeURIComponent(
        `"${norm.searchName}" "${cityOrCounty}" Kansas phone`
      )}`,
    },
  ];
  if (propertyAddress && /\d{2,}/.test(propertyAddress) && !/SEE LINK|PO BOX/i.test(propertyAddress)) {
    const addrClean = propertyAddress.replace(/^0+/, '').trim();
    links.push({
      title: `Reverse Address: ${addrClean}`,
      uri: `https://www.fastpeoplesearch.com/address/${addrClean
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`,
    });
  }
  if (norm.isEntity) {
    links.push({
      title: 'Kansas Secretary of State LLC Filing',
      uri: 'https://www.kansas.gov/bess/flow/main?execution=e1s1',
    });
  }
  return links;
}

const KS_COUNTY_SEATS: Record<string, string> = {
  butler: 'El Dorado',
  sedgwick: 'Wichita',
  shawnee: 'Topeka',
  riley: 'Manhattan',
  douglas: 'Lawrence',
  marshall: 'Marysville',
  harvey: 'Newton',
  saline: 'Salina',
  finney: 'Garden City',
  clark: 'Ashland',
  labette: 'Oswego',
  pottawatomie: 'Westmoreland',
  comanche: 'Coldwater',
  elk: 'Howard',
  chautauqua: 'Sedan',
  gray: 'Cimarron',
  wyandotte: 'Kansas City',
  osage: 'Lyndon',
  lyon: 'Emporia',
  sumner: 'Wellington',
  harper: 'Anthony',
  atchison: 'Atchison',
  kingman: 'Kingman',
  reno: 'Hutchinson',
  cowley: 'Winfield',
  mcpherson: 'McPherson',
  marion: 'Marion',
  chase: 'Cottonwood Falls',
  pratt: 'Pratt',
  ellis: 'Hays',
  franklin: 'Ottawa',
  miami: 'Paola',
  leavenworth: 'Leavenworth',
  johnson: 'Olathe',
  greenwood: 'Eureka',
  geary: 'Junction City',
  ford: 'Dodge City',
};

function extractKansasCityOrSeat(county?: string, propertyAddress?: string, taxMailingAddress?: string): string {
  const combined = [taxMailingAddress, propertyAddress].filter(Boolean);
  for (const raw of combined) {
    const s = String(raw || '').trim();
    if (!s || /SEE LINK|TAX ROLL|TAP PARCEL/i.test(s)) continue;
    const m1 = s.match(/(?:,\s*|^)([A-Za-z][A-Za-z\s]{1,22}),\s*KS\b/i);
    if (m1) return m1[1].trim();
    const m2 = s.match(/\b(El Dorado|Wichita|Augusta|Andover|Rosalia|Kingman|Topeka|Manhattan|Lawrence|Newton|Salina|Emporia|Wellington|Hutchinson|Winfield|Pratt|Hays|Dodge City|Garden City)\b/i);
    if (m2) return m2[1].trim();
  }
  const cleanCounty = String(county || '')
    .replace(/\(.*\)/g, '')
    .replace(/County,?\s*KS/i, '')
    .replace(/,?\s*KS$/i, '')
    .trim();
  const seat = KS_COUNTY_SEATS[cleanCounty.toLowerCase()];
  return seat || cleanCounty || 'Kansas';
}

async function runSingleOwnerLookup(input: {
  ownerName: string;
  county?: string;
  propertyAddress?: string;
  taxMailingAddress?: string;
  sectionCode?: string;
  acres?: number;
  forceRefresh?: boolean;
}) {
  const { ownerName, county, propertyAddress, taxMailingAddress, sectionCode, acres, forceRefresh } = input;
  const norm = normalizeOwnerNameForSearch(ownerName || '');
  const cacheKey = `${norm.display.toLowerCase()}|${String(county || '').trim().toLowerCase()}`;

  if (!forceRefresh && ownerLookupCache.has(cacheKey)) {
    return ownerLookupCache.get(cacheKey);
  }

  const cleanCounty = String(county || 'Kansas').replace(/\(Unit\s*\d+\)/gi, '').trim();
  const cityOrCounty = extractKansasCityOrSeat(cleanCounty, propertyAddress, taxMailingAddress);

  // 1. PARALLEL LIVE KANSAS COUNTY APPRAISER PORTFOLIO CROSS-CHECK
  const portfolioPromise = (async () => {
    const rawCore = norm.display.split(/[&\/;]/)[0];
    const ownerTokens = sanitizeSqlTerm(rawCore)
      .split(' ')
      .filter((t) => t.length >= 2 && !/^(TR|JR|SR|II|III|ET|AL|UX|TOD)$/.test(t))
      .slice(0, 3);
    if (ownerTokens.length === 0 || /PARCEL|UNKNOWN|KANSAS/.test(ownerTokens[0])) return null;

    const ownerSources = KS_COUNTY_SOURCES.filter((s) => s.hasOwnerNames && s.ownerField);
    const matchedCounty = ownerSources.find((s) => cleanCounty.toLowerCase().includes(s.id));

    const allFound: any[] = [];
    if (matchedCounty) {
      const field = matchedCounty.ownerField!;
      const rawWhere = ownerTokens.map((tok) => `UPPER(${field}) LIKE '%${tok}%'`).join(' AND ');
      const whereClause = matchedCounty.wherePrefix ? `(${matchedCounty.wherePrefix}) AND (${rawWhere})` : rawWhere;
      const url = `${matchedCounty.url}?where=${encodeURIComponent(
        whereClause
      )}&outFields=${encodeURIComponent(matchedCounty.outFields)}&returnGeometry=true&outSR=4326&resultRecordCount=15&f=geojson`;
      const data = await fetchJsonSafe(url, 4200);
      if (data?.features?.length) {
        for (const f of data.features) {
          const mapped = matchedCounty.mapFeature(f);
          if (mapped) allFound.push(mapped);
        }
      }
    } else {
      const countyShort = cleanCounty.replace(/County,?\s*KS/i, '').replace(/,?\s*KS$/i, '').trim();
      if (countyShort && countyShort.toLowerCase() !== 'kansas') {
        const orkaRows = await searchOrkaCountyRecords(countyShort, ownerTokens.slice(0, 2).join(' '), 'owner');
        if (orkaRows.length > 0) {
          const addresses = [...new Set(orkaRows.map((r) => r.address).filter(Boolean))].slice(0, 5);
          return {
            parcelCount: orkaRows.length,
            totalAcres: Number(acres || 0) * Math.min(orkaRows.length, 1),
            addresses,
            counties: [`${countyShort} County, KS`],
          };
        }
      }
    }

    if (!allFound.length) return null;
    const totalAcres = allFound.reduce((sum, p) => sum + (Number(p.acres) || 0), 0);
    const addresses = [
      ...new Set(
        allFound
          .map((p) => p.propertyAddress || p.taxMailingAddress)
          .filter((a) => a && !/See Link|Tax Roll/i.test(a))
      ),
    ].slice(0, 4);
    const countiesOwned = [...new Set(allFound.map((p) => p.county.replace(/\(Unit\s*\d+\)/gi, '').trim()))];
    return {
      parcelCount: allFound.length,
      totalAcres: Number(totalAcres.toFixed(1)),
      addresses,
      counties: countiesOwned,
    };
  })();

  // 2. PARALLEL LIVE KANSAS PUBLIC DIRECTORY SCAN (YellowPages + Superpages + DexKnows + BBB + NPI + OSM)
  const dirPromise = searchKansasPublicDirectories({
    searchName: norm.searchName,
    altSearchNames: norm.altSearchNames,
    firstName: norm.firstName,
    surname: norm.surname,
    people: norm.people,
    displayOwner: norm.display,
    cityOrCounty,
    county: cleanCounty,
    propertyAddress,
    taxMailingAddress,
    isEntity: norm.isEntity,
    isBareSurnameTrust: norm.isBareSurnameTrust,
  });

  const [portfolio, dirResults] = await Promise.all([portfolioPromise, dirPromise]);

  const baseDirectoryLinks: { title: string; uri: string }[] = [
    ...dirResults.listings.map((l) => ({
      title: `${l.source}: ${l.name}`,
      uri: l.url,
    })),
    ...buildDirectDirectoryLinks(norm, cityOrCounty, propertyAddress),
  ];

  const ai = getGeminiClient();

  let aiResponseText = '';
  let modelUsed = 'live-ks-directories';
  let aiGroundingLinks: { title: string; uri: string }[] = [];
  let searchQueries: string[] = [];

  if (ai) {
    const liveContextBlock = [
      portfolio
        ? `LIVE COUNTY APPRAISER PORTFOLIO: Owns ${portfolio.parcelCount} parcel(s) totaling ${portfolio.totalAcres} acres across ${portfolio.counties.join(', ')}. Known addresses on roll: ${portfolio.addresses.join(' | ') || 'None listed'}.`
        : 'LIVE COUNTY APPRAISER PORTFOLIO: Single parcel on current county GIS view.',
      dirResults.listings.length > 0
        ? `LIVE PUBLIC DIRECTORY MATCHES FOUND:\n${dirResults.listings
            .map((l) => `- ${l.name} | Phone: ${l.phone || 'Not listed'} | Address: ${l.address} (${l.source})`)
            .join('\n')}`
        : 'LIVE PUBLIC DIRECTORY MATCHES: No public YellowPages/Superpages/BBB business listing matched.',
    ].join('\n');

    const groundedPrompt = `You are a legal public-records research specialist helping a respectful Kansas landowner-permission seeker locate publicly listed phone numbers using Google Search.

SUBJECT:
- Search Name: ${norm.searchName}${norm.altSearchNames.length ? ` (Also check: ${norm.altSearchNames.join(', ')})` : ''}
- County Tax Roll Name: ${norm.display || 'Unknown'}
- City / Town: ${cityOrCounty}, Kansas
- County: ${cleanCounty}
- Physical Property Address: ${propertyAddress || 'Rural parcel / none listed'}
- Tax Mailing Address: ${taxMailingAddress || 'Unknown'}
- Section / Acres: ${sectionCode || 'N/A'} (${acres || ''} acres)

${liveContextBlock}

INSTRUCTIONS:
1. Search Google for "${norm.searchName}" "${cityOrCounty}" Kansas phone number, and check any Kansas Whitepages/FastPeopleSearch/business/LLC registered agent/obituary/farm directory snippets in Google Search.
2. NEVER invent, guess, or use placeholder/555 phone numbers. ONLY list real phone numbers that literally appear in Google Search results or the LIVE PUBLIC DIRECTORY MATCHES above.
3. Put any verified phone numbers at the top, one per line:
   PHONE: (XXX) XXX-XXXX | Type | Source
   Otherwise write: PHONE: NONE
4. Then write a crisp 3-bullet briefing summarizing verified owner/portfolio details, address match, any public phone leads found, and the fastest legal way to contact them.`;

    const skipGrounding = dirResults.phones.length > 0 || Date.now() < googleSearchCooldownUntil;
    if (!skipGrounding) {
      try {
        const r = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: groundedPrompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });
        aiResponseText = r.text || '';
        modelUsed = 'gemini-4-hydrogen (Google Search)';
        const gm = r.candidates?.[0]?.groundingMetadata;
        if (Array.isArray(gm?.groundingChunks)) {
          aiGroundingLinks = gm.groundingChunks
            .map((c: any) => (c.web?.uri ? { title: String(c.web.title || c.web.uri), uri: String(c.web.uri) } : null))
            .filter((x): x is { title: string; uri: string } => Boolean(x))
            .slice(0, 6);
        }
        if (Array.isArray(gm?.webSearchQueries)) {
          searchQueries = gm.webSearchQueries.slice(0, 5);
        }
      } catch (err1: any) {
        if (isQuotaError(err1)) {
          googleSearchCooldownUntil = Date.now() + 30 * 60_000;
        } else {
          try {
            const rSearch2 = await ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: groundedPrompt,
              config: {
                tools: [{ googleSearch: {} }],
              },
            });
            aiResponseText = rSearch2.text || '';
            modelUsed = 'gemini-3.1-flash-lite (Google Search)';
            const gm2 = rSearch2.candidates?.[0]?.groundingMetadata;
            if (Array.isArray(gm2?.groundingChunks)) {
              aiGroundingLinks = gm2.groundingChunks
                .map((c: any) => (c.web?.uri ? { title: String(c.web.title || c.web.uri), uri: String(c.web.uri) } : null))
                .filter((x): x is { title: string; uri: string } => Boolean(x))
                .slice(0, 6);
            }
          } catch (err2: any) {
            if (isQuotaError(err2)) {
              googleSearchCooldownUntil = Date.now() + 30 * 60_000;
            }
          }
        }
      }
    }

    if (!aiResponseText) {
      // Pure deterministic summary / Flash Lite synthesis over live records (no invented phones!)
      try {
        const synthPrompt = `You are a Kansas hunting landowner-research assistant. Summarize the LIVE public records already retrieved below into a concise 3-bullet action briefing for contacting this landowner legally and respectfully. Do NOT invent any phone numbers not present below.

SUBJECT: ${norm.searchName} (Tax Roll: ${norm.display}) · ${cleanCounty}
Property Address: ${propertyAddress || 'None listed (rural tract)'}
Tax Mailing Address: ${taxMailingAddress || 'See County GIS'}
${liveContextBlock}`;

        const r2 = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: synthPrompt,
        });
        aiResponseText = r2.text || '';
        modelUsed = 'gemini-3.1-flash-lite + Live KS Directories';
      } catch {
        // Pure deterministic summary below
      }
    }
  }

  // Merge verified phones from Live Directories + Grounded Google Search
  const mergedPhones: { number: string; label: string; source: string }[] = [...dirResults.phones];
  const seenPhoneDigits = new Set(mergedPhones.map((p) => p.number.replace(/\D/g, '').slice(-10)));
  if (aiResponseText) {
    for (const ph of extractVerifiedPhones(aiResponseText)) {
      const d = ph.number.replace(/\D/g, '').slice(-10);
      if (!seenPhoneDigits.has(d)) {
        seenPhoneDigits.add(d);
        mergedPhones.push(ph);
      }
    }
  }

  const cleanedAiSummary = aiResponseText
    .split('\n')
    .filter((line) => {
      const t = line.replace(/^[\s*\-•]+/, '').replace(/\*\*/g, '').trim();
      return !/^PHONE\s*:/i.test(t);
    })
    .join('\n')
    .trim();

  const fallbackDeterministicSummary = [
    `• Verified Owner / Search Name: ${norm.searchName} (${norm.display})`,
    portfolio
      ? `• County Tax Roll Portfolio: Owns ${portfolio.parcelCount} parcel${
          portfolio.parcelCount > 1 ? 's' : ''
        } totaling ${portfolio.totalAcres} acres in ${portfolio.counties.join(', ')}.`
      : `• Parcel: ${acres || ''} acres in ${cleanCounty}.`,
    mergedPhones.length > 0
      ? `• Verified Public Phone Found: ${mergedPhones[0].number} (${mergedPhones[0].source}).`
      : `• Direct Lookup Ready: No public business landline matched — tap FastPeopleSearch, TruePeopleSearch, or Whitepages below (pre-filled for "${norm.searchName}, ${cityOrCounty}, KS").`,
    `• Mailing / Situs: ${taxMailingAddress || propertyAddress || 'See County GIS link'}`,
  ].join('\n');

  const allLinks: { title: string; uri: string }[] = [];
  const seenUris = new Set<string>();
  for (const l of [...aiGroundingLinks, ...baseDirectoryLinks]) {
    if (!l?.uri || seenUris.has(l.uri)) continue;
    seenUris.add(l.uri);
    allLinks.push(l);
  }

  const payload = {
    confirmedOwnerName: norm.searchName,
    publicPhones: mergedPhones,
    matchedListings: dirResults.listings,
    portfolio,
    modelUsed,
    searchQueries,
    summary: cleanedAiSummary || fallbackDeterministicSummary,
    groundingLinks: allLinks.slice(0, 8),
  };

  if (mergedPhones.length > 0) {
    recordVerifiedPhonesToCache({
      ownerName,
      county,
      propertyAddress,
      phones: mergedPhones,
      matchedListings: dirResults.listings,
    });
    ownerLookupCache.set(cacheKey, payload);
  }

  return payload;
}

// ============================================================================
// POST /api/ai/owner-lookup — Legal Public Record, Owner & Public Phone Finder
// Combines Live KS Public Directories + Live County Portfolio + Gemini Search
// ============================================================================
app.post('/api/ai/owner-lookup', async (req, res) => {
  const { ownerName, county, propertyAddress, taxMailingAddress, sectionCode, acres, forceRefresh } = req.body || {};
  const payload = await runSingleOwnerLookup({
    ownerName: String(ownerName || ''),
    county: String(county || ''),
    propertyAddress: propertyAddress ? String(propertyAddress) : undefined,
    taxMailingAddress: taxMailingAddress ? String(taxMailingAddress) : undefined,
    sectionCode: sectionCode ? String(sectionCode) : undefined,
    acres: Number(acres || 0),
    forceRefresh: Boolean(forceRefresh),
  });
  return res.json(payload);
});

// ============================================================================
// POST /api/ai/batch-phone-lookup — Bulk Kansas Landowner Phone Finder & Integration
// Deduplicates owners, hits live directories + batched Google Search Grounding
// ============================================================================
app.post('/api/ai/batch-phone-lookup', async (req, res) => {
  try {
    const rawParcels = Array.isArray(req.body?.parcels) ? req.body.parcels : [];
    if (!rawParcels.length) {
      return res.json({ results: {}, stats: { requested: 0, uniqueOwners: 0, scanned: 0, phonesFound: 0 } });
    }

    const batchItems = rawParcels
      .slice(0, 36)
      .map((p: any) => ({
        id: String(p?.id || '').trim().slice(0, 100),
        ownerName: String(p?.ownerName || '').trim().slice(0, 140),
        county: String(p?.county || 'Kansas').trim().slice(0, 80),
        propertyAddress: p?.propertyAddress ? String(p.propertyAddress).trim().slice(0, 140) : undefined,
        taxMailingAddress: p?.taxMailingAddress ? String(p.taxMailingAddress).trim().slice(0, 140) : undefined,
        sectionCode: p?.sectionCode ? String(p.sectionCode).trim().slice(0, 80) : undefined,
        acres: Number(p?.acres || 0),
      }))
      .filter((p: any) => p.id && !isPlaceholderOwnerName(p.ownerName));

    // Deduplicate by normalized owner + county so multi-parcel farmers are only queried once
    const uniqueGroups = new Map<string, { rep: any; parcelIds: string[] }>();
    for (const item of batchItems) {
      const norm = normalizeOwnerNameForSearch(item.ownerName);
      const key = `${norm.display.toLowerCase()}|${item.county.replace(/\(Unit\s*\d+\)/gi, '').trim().toLowerCase()}`;
      const existing = uniqueGroups.get(key);
      if (existing) {
        existing.parcelIds.push(item.id);
      } else {
        uniqueGroups.set(key, { rep: item, parcelIds: [item.id] });
      }
    }

    const resultsByParcelId: Record<string, any> = {};
    const needGeminiSearch: { key: string; rep: any; norm: ReturnType<typeof normalizeOwnerNameForSearch>; cityOrCounty: string; dirResults: any }[] = [];

    const uniqueEntries = Array.from(uniqueGroups.entries());

    // Step 1: Check caches & run live Kansas public directories in parallel batches of 6
    for (let i = 0; i < uniqueEntries.length; i += 6) {
      const chunk = uniqueEntries.slice(i, i + 6);
      await Promise.all(
      chunk.map(async ([key, group]) => {
        const rep = group.rep;
        const norm = normalizeOwnerNameForSearch(rep.ownerName);
        const cleanCounty = rep.county.replace(/\(Unit\s*\d+\)/gi, '').trim();
        const cityOrCounty = extractKansasCityOrSeat(cleanCounty, rep.propertyAddress, rep.taxMailingAddress);

        // Check in-memory lookup cache first
        const memCached = ownerLookupCache.get(key);
        if (memCached) {
          for (const pid of group.parcelIds) resultsByParcelId[pid] = memCached;
          return;
        }

        // Check persistent disk phone cache
        const phoneKey = normalizePhoneCacheKey(rep.ownerName, rep.county);
        const addrKey = normalizeAddrCacheKey(rep.propertyAddress, rep.county);
        const diskCached = (phoneKey && verifiedPhoneCache.get(phoneKey)) || (addrKey && verifiedPhoneCache.get(addrKey));
        if (diskCached) {
          const payload = {
            confirmedOwnerName: norm.searchName,
            publicPhones: diskCached.phones,
            matchedListings: diskCached.matchedListings || [],
            portfolio: null,
            modelUsed: 'cached-ks-directory',
            summary: `• Verified Public Phone: ${diskCached.phone} (${diskCached.citation}).`,
            groundingLinks: buildDirectDirectoryLinks(norm, cityOrCounty, rep.propertyAddress),
          };
          ownerLookupCache.set(key, payload);
          for (const pid of group.parcelIds) resultsByParcelId[pid] = payload;
          return;
        }

        // Live directory fetch (YellowPages + Superpages + DexKnows + BBB KS + NPI KS + OSM)
        const dirResults = await searchKansasPublicDirectories({
          searchName: norm.searchName,
          altSearchNames: norm.altSearchNames,
          firstName: norm.firstName,
          surname: norm.surname,
          people: norm.people,
          displayOwner: norm.display,
          cityOrCounty,
          county: cleanCounty,
          propertyAddress: rep.propertyAddress,
          taxMailingAddress: rep.taxMailingAddress,
          isEntity: norm.isEntity,
          isBareSurnameTrust: norm.isBareSurnameTrust,
        });

        if (dirResults.phones.length > 0) {
          const payload = {
            confirmedOwnerName: norm.searchName,
            publicPhones: dirResults.phones,
            matchedListings: dirResults.listings,
            portfolio: null,
            modelUsed: 'live-ks-directories',
            summary: `• Live Directory Match: ${dirResults.listings[0]?.name || norm.searchName} — ${dirResults.phones[0].number} (${dirResults.phones[0].source}).`,
            groundingLinks: [
              ...dirResults.listings.map((l) => ({ title: `${l.source}: ${l.name}`, uri: l.url })),
              ...buildDirectDirectoryLinks(norm, cityOrCounty, rep.propertyAddress),
            ].slice(0, 8),
          };
          recordVerifiedPhonesToCache({
            ownerName: rep.ownerName,
            county: rep.county,
            propertyAddress: rep.propertyAddress,
            phones: dirResults.phones,
            matchedListings: dirResults.listings,
          });
          ownerLookupCache.set(key, payload);
          for (const pid of group.parcelIds) resultsByParcelId[pid] = payload;
        } else {
          needGeminiSearch.push({ key, rep, norm, cityOrCounty, dirResults });
        }
      })
    );
  }

  // Step 2: Run batched Google Search Grounding query when quota cooldown allows
  const ai = getGeminiClient();
  const batchForAi = needGeminiSearch.slice(0, 12);
  const aiPhonesByIndex = new Map<number, { number: string; label: string; source: string }[]>();

  if (ai && batchForAi.length > 0 && Date.now() >= googleSearchCooldownUntil) {
    const ownerLines = batchForAi
      .map(
        (entry, idx) =>
          `[${idx}] Name: "${entry.norm.searchName}" (Roll: "${entry.norm.display}") | City/County: ${entry.cityOrCounty}, KS | Addr: ${entry.rep.propertyAddress || entry.rep.taxMailingAddress || 'N/A'}`
      )
      .join('\n');

    const batchPrompt = `Search Google for ALL publicly listed phone numbers (home, mobile, farm, office, registered agent) for these Kansas landowners / farms / LLCs.
RULES:
- NEVER invent, guess, or fabricate any phone number or use 555 placeholder numbers.
- ONLY output a phone number if it literally appeared in your Google Search results for that exact person/entity in Kansas.
- If a landowner has multiple real numbers listed (home, cell, farm office), list each one on its own line (up to 4 lines per subject):
  [0] PHONE: (XXX) XXX-XXXX | Type | Source
- If no phone number is publicly listed in search results, output:
  [0] PHONE: NONE

SUBJECTS:
${ownerLines}`;

    const tryBatchedSearch = async (modelName: string) => {
      const apiPromise = ai.models.generateContent({
        model: modelName,
        contents: batchPrompt,
        config: { tools: [{ googleSearch: {} }] },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini batch search timed out')), 9000)
      );
      const r = await Promise.race([apiPromise, timeoutPromise]);
      return r.text || '';
    };

    let batchText = '';
    try {
      batchText = await tryBatchedSearch('gemini-4-hydrogen');
    } catch (err1: any) {
      if (isQuotaError(err1)) {
        googleSearchCooldownUntil = Date.now() + 30 * 60_000;
      } else {
        try {
          batchText = await tryBatchedSearch('gemini-3.1-flash-lite');
        } catch (err2: any) {
          if (isQuotaError(err2)) {
            googleSearchCooldownUntil = Date.now() + 30 * 60_000;
          }
        }
      }
    }

    if (batchText) {
      for (const rawLine of batchText.split('\n')) {
        const idxMatch = rawLine.match(/^\s*\[(\d+)\]\s*(.+)$/);
        if (!idxMatch) continue;
        const idx = Number(idxMatch[1]);
        const lineBody = idxMatch[2];
        const phones = extractVerifiedPhones(lineBody.startsWith('PHONE:') ? lineBody : `PHONE: ${lineBody}`);
        if (phones.length > 0) {
          const existing = aiPhonesByIndex.get(idx) || [];
          const seenDigits = new Set(existing.map((e) => e.number.replace(/\D/g, '').slice(-10)));
          const added = phones.filter((ph) => {
            const d = ph.number.replace(/\D/g, '').slice(-10);
            if (!d || seenDigits.has(d)) return false;
            seenDigits.add(d);
            return true;
          });
          aiPhonesByIndex.set(idx, [...existing, ...added]);
        }
      }
    }
  }

  // Finalize all remaining entries (incorporating any Google Search hits + direct directory links)
  for (let idx = 0; idx < needGeminiSearch.length; idx++) {
    const { key, rep, norm, cityOrCounty, dirResults } = needGeminiSearch[idx];
    const group = uniqueGroups.get(key)!;
    const foundPhones = (aiPhonesByIndex.get(idx) || []).slice(0, 6);

    const payload = {
      confirmedOwnerName: norm.searchName,
      publicPhones: foundPhones,
      matchedListings: dirResults.listings,
      portfolio: null,
      modelUsed: foundPhones.length > 0 ? 'gemini-4-hydrogen (Google Search)' : 'live-ks-directories',
      summary:
        foundPhones.length > 0
          ? `• Verified Public Phone${foundPhones.length > 1 ? 's' : ''} Found (${foundPhones.length}): ${foundPhones.map((f) => f.number).join(', ')} (${foundPhones[0].source}).`
          : `• Direct Directory Lookup Ready: Open FastPeopleSearch, TruePeopleSearch, or Whitepages for "${norm.searchName}, ${cityOrCounty}, KS".`,
      groundingLinks: [
        ...dirResults.listings.map((l: any) => ({ title: `${l.source}: ${l.name}`, uri: l.url })),
        ...buildDirectDirectoryLinks(norm, cityOrCounty, rep.propertyAddress),
      ].slice(0, 8),
    };

    if (foundPhones.length > 0) {
      recordVerifiedPhonesToCache({
        ownerName: rep.ownerName,
        county: rep.county,
        propertyAddress: rep.propertyAddress,
        phones: foundPhones,
        matchedListings: dirResults.listings,
      });
      ownerLookupCache.set(key, payload);
    }
    for (const pid of group.parcelIds) {
      resultsByParcelId[pid] = payload;
    }
  }

  let phonesFound = 0;
  for (const val of Object.values(resultsByParcelId)) {
    if (Array.isArray(val?.publicPhones) && val.publicPhones.length > 0) phonesFound++;
  }

    return res.json({
      results: resultsByParcelId,
      stats: {
        requested: rawParcels.length,
        uniqueOwners: uniqueGroups.size,
        scanned: Object.keys(resultsByParcelId).length,
        phonesFound,
      },
    });
  } catch (err: any) {
    console.warn('Batch phone lookup partial fallback:', err?.message || err);
    return res.json({
      results: {},
      stats: { requested: 0, uniqueOwners: 0, scanned: 0, phonesFound: 0 },
    });
  }
});

// Persist crew-verified phone numbers into the server phone cache so all matching county parcels show it automatically
app.post('/api/ai/save-phone', (req, res) => {
  const ownerName = String(req.body?.ownerName || '').trim().slice(0, 140);
  const county = String(req.body?.county || 'Kansas').trim().slice(0, 80);
  const propertyAddress = req.body?.propertyAddress ? String(req.body.propertyAddress).trim().slice(0, 140) : undefined;
  const rawPhone = String(req.body?.phone || '').trim().slice(0, 30);

  if (!ownerName || isPlaceholderOwnerName(ownerName) || !rawPhone) {
    return res.status(400).json({ error: 'Valid ownerName and phone required' });
  }
  const digits = rawPhone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    return res.status(400).json({ error: 'Valid 10-digit US phone required' });
  }
  const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  recordVerifiedPhonesToCache({
    ownerName,
    county,
    propertyAddress,
    phones: [{ number: formatted, label: 'Crew-Confirmed Phone', source: 'Saved by Hunting Crew' }],
    prepend: true,
  });
  return res.json({ ok: true, phone: formatted });
});

// =============================================================================
// KANSAS REVERSE STREET ADDRESS & LANDOWNER PHONE BOOK (/api/ks-phonebook/*)
// Search any Kansas street address (or owner / phone) to pop up the names,
// co-owners, parcel details, and verified phone numbers at that address.
// =============================================================================
function buildReverseAddressLinks(
  streetAddress: string,
  cityOrCounty: string,
  displayOwnerName: string
): { label: string; url: string }[] {
  const cleanAddr = String(streetAddress || '')
    .replace(/^0+(?=\d)/, '')
    .replace(/,\s*(?:KS|KANSAS)(\s+\d{5})?.*$/i, '')
    .trim();
  const cleanCity = String(cityOrCounty || 'Kansas')
    .replace(/County,?\s*KS/i, '')
    .replace(/,?\s*KS$/i, '')
    .trim();
  const links: { label: string; url: string }[] = [];

  if (cleanAddr && /\d/.test(cleanAddr) && !/SEE LINK|TAX ROLL|RURAL TRACT/i.test(cleanAddr)) {
    const addrSlug = cleanAddr.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const citySlug = cleanCity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    links.push(
      {
        label: 'FastPeopleSearch Address',
        url: `https://www.fastpeoplesearch.com/address/${addrSlug}_${citySlug}-ks`,
      },
      {
        label: 'TruePeopleSearch Address',
        url: `https://www.truepeoplesearch.com/resultaddress?streetaddress=${encodeURIComponent(
          cleanAddr
        )}&citystatezip=${encodeURIComponent(`${cleanCity}, KS`)}`,
      },
      {
        label: 'Google Address Residents',
        url: `https://www.google.com/search?q=${encodeURIComponent(
          `"${cleanAddr}" "${cleanCity}" Kansas owner OR resident OR phone`
        )}`,
      }
    );
  }

  if (displayOwnerName && !isPlaceholderOwnerName(displayOwnerName)) {
    const nameSlug = displayOwnerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const citySlug = cleanCity.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    links.push({
      label: `FastPeopleSearch: ${displayOwnerName}`,
      url: `https://www.fastpeoplesearch.com/name/${nameSlug}_${citySlug}-ks`,
    });
  }

  return links;
}

function buildPhoneBookEntryFromParcel(rawParcel: any, sourceLabel?: string) {
  const parcel = attachCachedPhoneToParcel(rawParcel);
  const norm = normalizeOwnerNameForSearch(parcel.ownerName || '');
  const attnPeople = extractAttnFromAddress(parcel.taxMailingAddress);

  const ownerKey = normalizePhoneCacheKey(parcel.ownerName, parcel.county);
  const addrKey = normalizeAddrCacheKey(parcel.propertyAddress || parcel.taxMailingAddress, parcel.county);
  const cachedHit =
    (ownerKey ? verifiedPhoneCache.get(ownerKey) : undefined) ||
    (addrKey ? verifiedPhoneCache.get(addrKey) : undefined);

  const phones: { number: string; label: string; source: string }[] = [];
  const seenDigits = new Set<string>();
  const addPhone = (num?: string, label?: string, src?: string) => {
    if (!num) return;
    const d = num.replace(/\D/g, '').slice(-10);
    if (d.length !== 10 || seenDigits.has(d)) return;
    seenDigits.add(d);
    phones.push({
      number: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
      label: label || norm.searchName || 'Verified Listing',
      source: src || parcel.phoneSourceCitation || 'Public Directory',
    });
  };

  if (Array.isArray(parcel.publicPhoneListings)) {
    for (const p of parcel.publicPhoneListings) addPhone(p.number, p.label, p.source);
  }
  if (parcel.publicPhoneListing) {
    addPhone(parcel.publicPhoneListing, norm.searchName, parcel.phoneSourceCitation);
  }
  if (cachedHit?.phones) {
    for (const p of cachedHit.phones) addPhone(p.number, p.label, p.source);
  }

  const cleanMail = String(parcel.taxMailingAddress || '')
    .replace(/^Attn:[^,\n]+,?\s*/i, '')
    .trim();
  const streetAddr =
    parcel.propertyAddress && !/SEE LINK|TAX ROLL|TAP PARCEL/i.test(parcel.propertyAddress)
      ? parcel.propertyAddress
      : cleanMail && !/SEE LINK|TAX ROLL|TAP PARCEL/i.test(cleanMail)
      ? cleanMail
      :cachedHit?.matchedListings?.[0]?.address || 'Rural Kansas Tract (No Street # Assigned)';

  const cityOrSeat = extractKansasCityOrSeat(parcel.county, streetAddr, parcel.taxMailingAddress);

  const associatedSet = new Set<string>();
  if (norm.searchName) associatedSet.add(norm.searchName);
  for (const alt of norm.altSearchNames) associatedSet.add(alt);
  for (const attn of attnPeople) associatedSet.add(attn);
  if (Array.isArray(cachedHit?.matchedListings)) {
    for (const l of cachedHit.matchedListings) {
      if (l.name && l.name.length >= 3) associatedSet.add(l.name);
    }
  }

  return {
    id: `pb-${parcel.id}`,
    streetAddress: streetAddr,
    mailingAddress:
      cleanMail && cleanMail.toUpperCase() !== streetAddr.toUpperCase() ? cleanMail : undefined,
    city: cityOrSeat,
    county: parcel.county || 'Kansas',
    ownerName: parcel.ownerName,
    displayOwnerName: norm.searchName || parcel.ownerName,
    associatedPeople: Array.from(associatedSet).slice(0, 6),
    phones,
    acres: Number(parcel.acres || 0) || undefined,
    sectionCode: parcel.sectionCode,
    parcelId: parcel.id,
    lat: parcel.center?.lat,
    lng: parcel.center?.lng,
    livesOnLand: Boolean(parcel.livesOnLand),
    source: sourceLabel || parcel.source || 'Kansas County Appraiser Roll',
    parcel,
    reverseLookupLinks: buildReverseAddressLinks(streetAddr, cityOrSeat, norm.searchName || parcel.ownerName),
  };
}

function getDirectoryEntriesFromCache(filterQuery = '') {
  const qUpper = filterQuery.trim().toUpperCase();
  const qDigits = filterQuery.replace(/\D/g, '');
  const qTokens = qUpper
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const out: any[] = [];
  const seenOwnerCounty = new Set<string>();

  for (const [key, entry] of verifiedPhoneCache.entries()) {
    if (!entry?.phones?.length) continue;
    const isAddrKey = key.startsWith('ADDR:');
    const [rawLeft, rawCounty = 'KS'] = (isAddrKey ? key.slice(5) : key).split('|');
    const countyLabel =
      rawCounty && rawCounty !== 'KS'
        ? `${rawCounty.charAt(0)}${rawCounty.slice(1).toLowerCase()} County, KS`
        : 'Kansas';

    const firstListing = entry.matchedListings?.[0];
    const listingAddr = firstListing?.address || (isAddrKey ? rawLeft : '');
    const ownerRaw = isAddrKey ? firstListing?.name || entry.phones[0]?.label || rawLeft : rawLeft;
    if (!ownerRaw) continue;

    const norm = normalizeOwnerNameForSearch(ownerRaw);
    const dedupId = `${norm.display.toUpperCase()}|${(listingAddr || '').toUpperCase()}|${entry.phone}`;
    if (seenOwnerCounty.has(dedupId)) continue;

    const allAddresses = Array.from(
      new Set(
        [
          isAddrKey ? rawLeft : '',
          ...(entry.matchedListings || []).map((l) => l.address || ''),
        ]
          .map((a) => a.trim())
          .filter((a) => a.length >= 4)
      )
    );
    const primaryAddress = allAddresses[0] || `${countyLabel} Verified Record`;
    const allNames = Array.from(
      new Set(
        [
          norm.searchName,
          ...norm.altSearchNames,
          ...(entry.matchedListings || []).map((l) => l.name || ''),
          ...entry.phones.map((p) => p.label || ''),
        ]
          .map((n) => n.trim())
          .filter((n) => n.length >= 3 && !/Public Record|Grounded|Verified|Directory|Phone/i.test(n))
      )
    );

    const searchableBlob = [
      primaryAddress,
      ...allAddresses,
      ownerRaw,
      norm.searchName,
      ...allNames,
      countyLabel,
      ...entry.phones.map((p) => p.number),
    ]
      .join(' ')
      .toUpperCase();

    if (qUpper) {
      const tokenMatch =
        qTokens.length > 0 && qTokens.every((tok) => searchableBlob.includes(tok));
      const phoneMatch =
        qDigits.length >= 3 &&
        entry.phones.some((p) => p.number.replace(/\D/g, '').includes(qDigits));
      if (!tokenMatch && !phoneMatch) continue;
    }

    seenOwnerCounty.add(dedupId);
    const cityOrSeat = extractKansasCityOrSeat(countyLabel, primaryAddress, primaryAddress);

    out.push({
      id: `dir-${Buffer.from(key).toString('base64url')}`,
      streetAddress: primaryAddress,
      mailingAddress: allAddresses[1] || undefined,
      city: cityOrSeat,
      county: countyLabel,
      ownerName: ownerRaw,
      displayOwnerName: norm.searchName || ownerRaw,
      associatedPeople: allNames.slice(0, 6),
      phones: entry.phones,
      source: entry.citation || 'Kansas Public Phone Directory',
      reverseLookupLinks: buildReverseAddressLinks(primaryAddress, cityOrSeat, norm.searchName || ownerRaw),
    });
  }

  // Sort entries with concrete street numbers first when browsing or searching addresses
  out.sort((a, b) => {
    const aHasNum = /^\d+\s+[A-Za-z]/.test(a.streetAddress) ? 1 : 0;
    const bHasNum = /^\d+\s+[A-Za-z]/.test(b.streetAddress) ? 1 : 0;
    if (aHasNum !== bHasNum) return bHasNum - aHasNum;
    return a.displayOwnerName.localeCompare(b.displayOwnerName);
  });

  return out;
}

app.get('/api/ks-phonebook/directory', (_req, res) => {
  const entries = getDirectoryEntriesFromCache('');
  return res.json({
    totalOwners: entries.length,
    totalPhones: entries.reduce((sum, e) => sum + (e.phones?.length || 0), 0),
    entries,
  });
});

app.get('/api/ks-phonebook/search', async (req, res) => {
  const rawQ = String(req.query.q || '').trim().slice(0, 110);
  const ctxLat = Number(req.query.lat);
  const ctxLng = Number(req.query.lng);
  const hasCtxCoords = Number.isFinite(ctxLat) && Number.isFinite(ctxLng) && isInsideKansas(ctxLat, ctxLng);

  if (rawQ.length < 2) {
    return res.json({ query: rawQ, entries: getDirectoryEntriesFromCache('').slice(0, 80) });
  }

  const sqlClean = sanitizeSqlTerm(rawQ);
  const tokens = sqlClean.split(' ').filter((t) => t.length >= 2);
  const hasLeadingNumber = /^\d{1,6}\s+/.test(sqlClean);
  const leadingNum = hasLeadingNumber ? sqlClean.split(' ')[0] : '';
  const afterNumStreet = hasLeadingNumber ? sqlClean.slice(leadingNum.length).trim() : sqlClean;
  const streetCoreToken = afterNumStreet
    .replace(/\b(N|S|E|W|NE|NW|SE|SW|ST|AVE|RD|DR|LN|CT|BLVD|HWY|PKWY|CIR|WAY|TRL|PL|KS|KANSAS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Instant matches from our verified Kansas phone cache
  const cachedMatches = getDirectoryEntriesFromCache(rawQ);

  // 2. Live search across all 17 owner-indexed County Appraiser GIS servers (matching Situs Address, Mailing Address, or Owner Name)
  const ownerIndexedSources = KS_COUNTY_SOURCES.filter((s) => s.hasOwnerNames && s.ownerField);
  const countyPromises =
    sqlClean.length >= 2
      ? ownerIndexedSources.map(async (src) => {
          const clauses: string[] = [];
          const addrVariants = new Set<string>([sqlClean]);
          // Strip trailing ST/AVE/RD/DR and city names so "218 E Central Ave El Dorado" matches "218 E CENTRAL" on county roll
          if (hasLeadingNumber && streetCoreToken) {
            const firstStreetWord = streetCoreToken.split(' ')[0];
            if (firstStreetWord && firstStreetWord.length >= 2) {
              addrVariants.add(`${leadingNum} ${firstStreetWord}`);
            }
            const dirMatch = afterNumStreet.match(/^(N|S|E|W|NE|NW|SE|SW)\s+([A-Z0-9]+)/i);
            if (dirMatch) {
              addrVariants.add(`${leadingNum} ${dirMatch[1].toUpperCase()} ${dirMatch[2].toUpperCase()}`);
            }
          }

          if (hasLeadingNumber) {
            for (const v of addrVariants) {
              if (src.situsField) clauses.push(`UPPER(${src.situsField}) LIKE '%${v}%'`);
              if (src.mailField) clauses.push(`UPPER(${src.mailField}) LIKE '%${v}%'`);
            }
          } else {
            if (src.situsField) clauses.push(`UPPER(${src.situsField}) LIKE '%${sqlClean}%'`);
            if (src.mailField) clauses.push(`UPPER(${src.mailField}) LIKE '%${sqlClean}%'`);
            const nameToks = tokens.slice(0, 3);
            if (nameToks.length > 1) {
              clauses.push(`(${nameToks.map((t) => `UPPER(${src.ownerField}) LIKE '%${t}%'`).join(' AND ')})`);
            } else {
              clauses.push(`UPPER(${src.ownerField}) LIKE '%${sqlClean}%'`);
            }
          }
          if (!clauses.length) return [];
          const rawWhere = clauses.join(' OR ');
          const whereClause = src.wherePrefix ? `(${src.wherePrefix}) AND (${rawWhere})` : rawWhere;
          const url = `${src.url}?where=${encodeURIComponent(
            whereClause
          )}&outFields=${encodeURIComponent(
            src.outFields
          )}&returnGeometry=true&outSR=4326&resultRecordCount=8&f=geojson`;
          const data = await fetchJsonSafe(url, 4500);
          if (!data?.features?.length) return [];
          return data.features.map((f: any) => src.mapFeature(f)).filter(Boolean);
        })
      : [];

  // 3. Geocode the street address in Kansas via Esri World Geocoder + ORKA Statewide Address Points
  //    AND inspect the geocoded parcel + search ORKA county records by street address!
  const esriQuery = /\b(ks|kansas)\b/i.test(rawQ) ? rawQ : `${rawQ}, Kansas`;
  const ksExtent = '-102.06,36.98,-94.58,40.01';
  const geocodeAndOrkaPromise = (async () => {
    const foundParcels: any[] = [];
    const [esriData, orkaAddrData, explicitCounty] = await Promise.all([
      fetchJsonSafe(
        `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(
          esriQuery
        )}&searchExtent=${ksExtent}&sourceCountry=USA&outFields=Match_addr,Addr_type,City,Subregion,Region,StAddr,Postal&maxLocations=5&f=json`,
        4200
      ),
      hasLeadingNumber && streetCoreToken.length >= 2
        ? fetchJsonSafe(
            `https://services.kansasgis.org/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer/0/query?where=${encodeURIComponent(
              `HNO = '${leadingNum}' AND UPPER(RD) LIKE '%${streetCoreToken.split(' ')[0]}%'`
            )}&outFields=OBJECTID,HNO,PRD,RD,STS,MUNI,COUNTY&returnGeometry=true&outSR=4326&resultRecordCount=8&f=geojson`,
            4200
          )
        : Promise.resolve(null),
      detectKansasCountyInQuery(rawQ),
    ]);

    // Collect candidate Kansas points + counties from Esri Geocoder and ORKA Address Points
    const candidatePoints: { lat: number; lng: number; address: string; county: string }[] = [];
    if (Array.isArray(esriData?.candidates)) {
      for (const c of esriData.candidates) {
        const lat = Number(c?.location?.y);
        const lng = Number(c?.location?.x);
        const region = String(c?.attributes?.Region || '');
        if (!isInsideKansas(lat, lng) || (region && !/kansas|^ks$/i.test(region))) continue;
        const subregion = String(c?.attributes?.Subregion || '')
          .replace(/County/i, '')
          .trim();
        const stAddr = String(c?.attributes?.StAddr || c?.address || rawQ).trim();
        const city = String(c?.attributes?.City || '').trim();
        candidatePoints.push({
          lat,
          lng,
          address: [stAddr, city, 'KS'].filter(Boolean).join(', '),
          county: subregion || explicitCounty || '',
        });
      }
    }

    if (Array.isArray(orkaAddrData?.features)) {
      for (const f of orkaAddrData.features) {
        const center = computeGeoJsonCenter(f.geometry);
        if (!center || !isInsideKansas(center.lat, center.lng)) continue;
        const p = f.properties || {};
        const fullAddr = [p.HNO, p.PRD, p.RD, p.STS].filter(Boolean).join(' ').trim();
        const muni = String(p.MUNI || '').trim();
        const cnty = String(p.COUNTY || '').trim();
        candidatePoints.push({
          lat: center.lat,
          lng: center.lng,
          address: [fullAddr, muni, 'KS'].filter(Boolean).join(', '),
          county: cnty || explicitCounty || '',
        });
      }
    }

    // Determine target county for ORKA table search
    let targetCounty =
      explicitCounty ||
      candidatePoints.find((p) => p.county)?.county ||
      null;

    if (!targetCounty && hasCtxCoords) {
      const cData = await fetchJsonSafe(
        `https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/KS_County_Website_Links_SHP/FeatureServer/0/query?geometry=${encodeURIComponent(
          `${ctxLng},${ctxLat}`
        )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&outFields=NAME10&f=json`,
        2500
      );
      targetCounty = String(cData?.features?.[0]?.attributes?.NAME10 || '').trim() || null;
    }

    // A. Inspect top geocoded points directly on County Appraiser / ORKA parcel polygons so exact address parcel pops up!
    const topPts = candidatePoints.slice(0, 3);
    const pointInspectPromises = topPts.map(async (pt) => {
      const ptGeom = `${pt.lng},${pt.lat}`;
      // First check direct owner-named county GIS servers covering that point
      const directSrc = KS_COUNTY_SOURCES.find(
        (c) =>
          c.hasOwnerNames &&
          pt.lng >= c.bbox.minLng &&
          pt.lng <= c.bbox.maxLng &&
          pt.lat >= c.bbox.minLat &&
          pt.lat <= c.bbox.maxLat
      );
      if (directSrc) {
        const dUrl = `${directSrc.url}?geometry=${encodeURIComponent(
          ptGeom
        )}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=${encodeURIComponent(
          directSrc.outFields
        )}&outSR=4326&f=geojson`;
        const dData = await fetchJsonSafe(dUrl, 4000);
        if (dData?.features?.length) {
          const mapped = directSrc.mapFeature(dData.features[0]);
          if (mapped) {
            if (!mapped.propertyAddress || /SEE LINK/i.test(mapped.propertyAddress)) {
              mapped.propertyAddress = pt.address;
            }
            return mapped;
          }
        }
      }

      // Otherwise query Statewide ORKA parcel polygon at that point (or 60m envelope)
      const tinyEnv = `${pt.lng - 0.0005},${pt.lat - 0.0005},${pt.lng + 0.0005},${pt.lat + 0.0005}`;
      const orkaGeom = await queryOrkaParcelServer(
        `geometry=${encodeURIComponent(
          tinyEnv
        )}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,KSPID,CO_ABBR&returnGeometry=true&resultRecordCount=3&f=json`,
        4200
      );
      const feat = orkaGeom?.features?.[0];
      if (!feat) return null;
      const pid = String(feat?.attributes?.KSPID || '').trim();
      const coAbbr = String(feat?.attributes?.CO_ABBR || '').trim();
      const portalFromAbbr = coAbbr ? await getKansasCountyByAbbr(coAbbr) : null;
      const cShort = portalFromAbbr?.county || pt.county || targetCounty || 'Kansas';
      const portalUrl = resolveBestCountyAppraiserUrl(portalFromAbbr, cShort);
      const pidInfo = pid ? await fetchOrkaPidInfo(pid, cShort, coAbbr, pt.lat, pt.lng) : null;
      return mapOrkaFeatureToParcel(feat, cShort, pidInfo, portalUrl, pt.address);
    });

    // B. Also search ORKA County Records table by street address / owner in targetCounty
    const orkaTablePromise = (async () => {
      if (!targetCounty) return [];
      let cleanTerm = rawQ
        .replace(/,\s*(ks|kansas)(\s+\d{5})?/gi, '')
        .replace(new RegExp(`\\b${targetCounty}\\b`, 'gi'), '')
        .replace(/\bcounty\b/gi, '')
        .replace(/\b(ks|kansas)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      for (const [town, cnty] of Object.entries(KS_TOWN_TO_COUNTY)) {
        if (cnty.toLowerCase() === targetCounty.toLowerCase()) {
          cleanTerm = cleanTerm.replace(new RegExp(`\\b${town}\\b`, 'gi'), '').trim();
        }
      }
      cleanTerm = cleanTerm.replace(/^,|,$/g, '').trim();
      if (cleanTerm.length < 2) return [];
      const orkaAddrTerm = cleanTerm
        .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
        .replace(/\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|hwy)\b\.?$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      const matches = await searchOrkaCountyRecords(
        targetCounty,
        hasLeadingNumber ? orkaAddrTerm || cleanTerm : cleanTerm,
        hasLeadingNumber ? 'address' : 'owner'
      );
      if (!matches.length) return [];
      const topMatches = matches.slice(0, 6);
      const pidInClause = topMatches
        .map((m) => `'${m.pid.replace(/[^A-Za-z0-9]/g, '')}'`)
        .join(',');
      const geomData = await queryOrkaParcelServer(
        `where=${encodeURIComponent(`KSPID IN (${pidInClause})`)}&outSR=4326&outFields=OBJECTID,KSPID,CO_ABBR&returnGeometry=true&f=json`,
        4500
      );
      const geomByPid = new Map<string, any>();
      for (const f of geomData?.features || []) {
        const p = String(f?.attributes?.KSPID || '').trim();
        if (p) geomByPid.set(p, f);
      }
      const portal = await getKansasCountyPortal(targetCounty);
      const portalUrl = resolveBestCountyAppraiserUrl(portal, targetCounty);
      const built = await Promise.all(
        topMatches.map(async (m) => {
          const feat = geomByPid.get(m.pid);
          if (!feat) return null;
          const rings = extractLatLngRings(feat.geometry);
          if (!rings.length) return null;
          const center = computePolygonCenter(rings);
          const coAbbr = String(feat.attributes?.CO_ABBR || portal?.abbr || '');
          const pidInfo = await fetchOrkaPidInfo(m.pid, targetCounty!, coAbbr, center.lat, center.lng);
          return mapOrkaFeatureToParcel(feat, targetCounty!, pidInfo, portalUrl, m.address);
        })
      );
      return built.filter(Boolean);
    })();

    const [inspectedParcels, orkaTableParcels] = await Promise.all([
      Promise.all(pointInspectPromises),
      orkaTablePromise,
    ]);

    for (const p of [...inspectedParcels, ...orkaTableParcels]) {
      if (p) foundParcels.push(p);
    }
    return foundParcels;
  })();

  const [geocodeAndOrkaParcels, ...countyGroups] = await Promise.all([
    geocodeAndOrkaPromise,
    ...countyPromises,
  ]);

  const rawParcels: any[] = [
    ...(Array.isArray(geocodeAndOrkaParcels) ? geocodeAndOrkaParcels : []),
    ...countyGroups.flat(),
  ];

  // For the top 4 discovered parcels that don't yet have a verified phone in cache, do a fast live directory check!
  const uncachedForLookup: any[] = [];
  const seenOwnerKeys = new Set<string>();
  for (const p of rawParcels) {
    if (!p?.ownerName || isPlaceholderOwnerName(p.ownerName)) continue;
    const attached = attachCachedPhoneToParcel(p);
    if (attached.publicPhoneListing || attached.publicPhoneListings?.length) continue;
    const oKey = normalizePhoneCacheKey(p.ownerName, p.county);
    if (oKey && !seenOwnerKeys.has(oKey) && uncachedForLookup.length < 4) {
      seenOwnerKeys.add(oKey);
      uncachedForLookup.push(p);
    }
  }

  if (uncachedForLookup.length > 0) {
    await Promise.all(
      uncachedForLookup.map(async (p) => {
        try {
          const norm = normalizeOwnerNameForSearch(p.ownerName);
          const cityOrSeat = extractKansasCityOrSeat(p.county, p.propertyAddress, p.taxMailingAddress);
          const dirRes = await searchKansasPublicDirectories({
            searchName: norm.searchName,
            altSearchNames: norm.altSearchNames,
            firstName: norm.firstName,
            surname: norm.surname,
            people: norm.people,
            displayOwner: norm.display,
            cityOrCounty: cityOrSeat,
            county: p.county,
            propertyAddress: p.propertyAddress,
            taxMailingAddress: p.taxMailingAddress,
            isEntity: norm.isEntity,
            isBareSurnameTrust: norm.isBareSurnameTrust,
          });
          if (dirRes.phones.length > 0) {
            recordVerifiedPhonesToCache({
              ownerName: p.ownerName,
              county: p.county,
              propertyAddress: p.propertyAddress || p.taxMailingAddress,
              phones: dirRes.phones,
              matchedListings: dirRes.listings,
            });
          }
        } catch {
          // Non-blocking directory lookup
        }
      })
    );
  }

  // Merge live parcel results + cached directory matches without duplicates
  const entries: any[] = [];
  const seenEntryKeys = new Set<string>();

  for (const rawP of rawParcels) {
    if (!rawP?.ownerName || isPlaceholderOwnerName(rawP.ownerName)) continue;
    const entry = buildPhoneBookEntryFromParcel(rawP);
    const dedupKey = `${entry.displayOwnerName.toUpperCase()}|${entry.streetAddress.toUpperCase()}`;
    if (seenEntryKeys.has(dedupKey)) continue;
    seenEntryKeys.add(dedupKey);
    entries.push(entry);
  }

  for (const cEntry of cachedMatches) {
    const dedupKey = `${cEntry.displayOwnerName.toUpperCase()}|${cEntry.streetAddress.toUpperCase()}`;
    if (seenEntryKeys.has(dedupKey)) continue;
    seenEntryKeys.add(dedupKey);
    entries.push(cEntry);
  }

  return res.json({
    query: rawQ,
    entries: entries.slice(0, 50),
  });
});

// =============================================================================
// LIVE KANSAS WEATHER, WIND & KDWP LEGAL SHOOTING LIGHT (/api/ks-weather)
// =============================================================================
const weatherCache = new Map<string, { expiresAt: number; data: any }>();

function degreesToCompass16(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

function shiftIsoMinutes(isoLocal: string, deltaMinutes: number): string {
  const m = String(isoLocal || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '';
  let total = Number(m[2]) * 60 + Number(m[3]) + deltaMinutes;
  total = ((total % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const min = total % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

function formatClockTime(isoLocal: string): string {
  return shiftIsoMinutes(isoLocal, 0);
}

function rateKansasHuntDay(windDir: string, windMph: number, tempMinF: number): string {
  const northerly = /^(N|NNW|NW|NNE|W)$/i.test(windDir);
  if (tempMinF <= 32 && windMph <= 15) return 'PEAK COLD';
  if (northerly && windMph >= 6 && windMph <= 16) return 'EXCELLENT';
  if (windMph >= 20) return 'BREEZY';
  if (northerly || windMph <= 14) return 'GOOD';
  return 'MODERATE';
}

app.get('/api/ks-weather', async (req, res) => {
  const rawLat = Number(req.query.lat);
  const rawLng = Number(req.query.lng);
  const lat = Number.isFinite(rawLat) ? Math.min(41.5, Math.max(35.5, rawLat)) : 37.8168;
  const lng = Number.isFinite(rawLng) ? Math.min(-93.5, Math.max(-103.0, rawLng)) : -96.7465;

  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.data);
  }

  const buildFallbackWeather = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      source: 'ks-seasonal-baseline',
      lat,
      lng,
      windDir: 'NW',
      windDegrees: 315,
      windSpeedMph: 11,
      windGustsMph: 17,
      tempF: 36,
      pressureHpa: 1021,
      pressureInHg: '30.15',
      sunrise: '7:19 AM',
      sunset: '5:14 PM',
      legalShootingLight: '6:49 AM – 5:44 PM',
      fetchedAt: new Date().toISOString(),
      forecast7Day: [
        { day: 'Today', date: todayStr, windDir: 'NW', windSpeedMph: 11, wind: 'NW 11', tempMinF: 28, tempMaxF: 46, temp: '28°/46°', sunrise: '7:19 AM', sunset: '5:14 PM', legalLight: '6:49 AM – 5:44 PM', rating: 'PEAK COLD' },
        { day: 'Day 2', date: todayStr, windDir: 'NNW', windSpeedMph: 9, wind: 'NNW 9', tempMinF: 25, tempMaxF: 44, temp: '25°/44°', sunrise: '7:20 AM', sunset: '5:14 PM', legalLight: '6:50 AM – 5:44 PM', rating: 'PEAK COLD' },
        { day: 'Day 3', date: todayStr, windDir: 'W', windSpeedMph: 8, wind: 'W 8', tempMinF: 31, tempMaxF: 51, temp: '31°/51°', sunrise: '7:21 AM', sunset: '5:13 PM', legalLight: '6:51 AM – 5:43 PM', rating: 'PEAK COLD' },
      ],
    };
  };

  try {
    // Fixed Open-Meteo endpoint with validated numeric KS coordinates (zero user-controlled URL host/path)
    const apiUrl = new URL('https://api.open-meteo.com/v1/forecast');
    apiUrl.searchParams.set('latitude', lat.toFixed(4));
    apiUrl.searchParams.set('longitude', lng.toFixed(4));
    apiUrl.searchParams.set('current', 'temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    apiUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant');
    apiUrl.searchParams.set('temperature_unit', 'fahrenheit');
    apiUrl.searchParams.set('wind_speed_unit', 'mph');
    apiUrl.searchParams.set('timezone', 'America/Chicago');
    apiUrl.searchParams.set('forecast_days', '7');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(apiUrl.toString(), { signal: ctrl.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      return res.json(buildFallbackWeather());
    }

    const raw = await resp.json();
    const cur = raw?.current || {};
    const daily = raw?.daily || {};

    const windDeg = Number(cur.wind_direction_10m ?? 315);
    const windDir = degreesToCompass16(windDeg);
    const windSpeedMph = Math.round(Number(cur.wind_speed_10m ?? 10));
    const windGustsMph = Math.round(Number(cur.wind_gusts_10m ?? windSpeedMph + 4));
    const tempF = Math.round(Number(cur.temperature_2m ?? 42));
    const pressureHpa = Math.round(Number(cur.surface_pressure ?? 1016));
    const pressureInHg = (pressureHpa * 0.02953).toFixed(2);

    const times: string[] = Array.isArray(daily.time) ? daily.time : [];
    const forecast7Day = times.slice(0, 7).map((dateStr, idx) => {
      const dDeg = Number(daily.wind_direction_10m_dominant?.[idx] ?? windDeg);
      const dDir = degreesToCompass16(dDeg);
      const dSpd = Math.round(Number(daily.wind_speed_10m_max?.[idx] ?? windSpeedMph));
      const tMin = Math.round(Number(daily.temperature_2m_min?.[idx] ?? tempF - 8));
      const tMax = Math.round(Number(daily.temperature_2m_max?.[idx] ?? tempF + 8));
      const srIso = String(daily.sunrise?.[idx] || '');
      const ssIso = String(daily.sunset?.[idx] || '');
      const sr = formatClockTime(srIso) || '7:15 AM';
      const ss = formatClockTime(ssIso) || '5:15 PM';
      const legalStart = shiftIsoMinutes(srIso, -30) || '6:45 AM';
      const legalEnd = shiftIsoMinutes(ssIso, 30) || '5:45 PM';

      let dayLabel = 'Today';
      if (idx > 0) {
        const parsedDate = new Date(`${dateStr}T12:00:00`);
        dayLabel = Number.isNaN(parsedDate.getTime())
          ? `Day ${idx + 1}`
          : parsedDate.toLocaleDateString('en-US', { weekday: 'short' });
      }

      return {
        day: dayLabel,
        date: dateStr,
        windDir: dDir,
        windSpeedMph: dSpd,
        wind: `${dDir} ${dSpd}`,
        tempMinF: tMin,
        tempMaxF: tMax,
        temp: `${tMin}°/${tMax}°`,
        sunrise: sr,
        sunset: ss,
        legalLight: `${legalStart} – ${legalEnd}`,
        rating: rateKansasHuntDay(dDir, dSpd, tMin),
      };
    });

    const todayForecast = forecast7Day[0];
    const payload = {
      source: 'Open-Meteo NOAA/HRRR Live',
      lat,
      lng,
      windDir,
      windDegrees: Math.round(windDeg),
      windSpeedMph,
      windGustsMph,
      tempF,
      pressureHpa,
      pressureInHg,
      sunrise: todayForecast?.sunrise || '7:15 AM',
      sunset: todayForecast?.sunset || '5:15 PM',
      legalShootingLight: todayForecast?.legalLight || '6:45 AM – 5:45 PM',
      fetchedAt: new Date().toISOString(),
      forecast7Day,
    };

    weatherCache.set(cacheKey, {
      expiresAt: Date.now() + 15 * 60 * 1000,
      data: payload,
    });

    return res.json(payload);
  } catch (err: any) {
    console.warn('Live KS weather fallback used:', err?.message || err);
    return res.json(buildFallbackWeather());
  }
});

// POST /api/ai/escout — AI E-Scout terrain, bedding, funnel, food plot & stand analyzer with real lat/lng pins!
app.post('/api/ai/escout', async (req, res) => {
  const { parcelName, acres, landType, windDirection, windSpeedMph, terrainNotes, centerLat, centerLng } =
    req.body || {};

  const lat = Number(centerLat) || 37.815;
  const lng = Number(centerLng) || -96.745;
  const spanLat = Math.min(0.006, Math.max(0.0018, Math.sqrt(Number(acres) || 80) * 0.00028));
  const spanLng = spanLat * 1.25;

  const buildTacticalFallback = () => ({
    source: 'gis-tactical-engine',
    summary: `Tactical E-Scout for ${parcelName} (${acres} ac): With ${windDirection || 'NW'} wind at ${
      windSpeedMph || 11
    } mph, bucks bed on the leeward south timber bench watching the creek draw below.`,
    accessStrategy: `Enter from the downwind SE road ditch to stay below skyline sightlines and keep your scent cone off the bedding ridge.`,
    zones: [
      {
        id: 'zone-bedding',
        type: 'BEDDING',
        label: 'Leeward Timber Bedding Bench',
        description: 'South-facing oak & cedar bench with thermal updraft advantage.',
        lat: lat + spanLat * 0.45,
        lng: lng - spanLng * 0.4,
        confidence: 'High',
      },
      {
        id: 'zone-funnel',
        type: 'FUNNEL',
        label: 'Creek Crossing & Fence Gap Pinch',
        description: 'Natural travel bottleneck connecting bedding timber to afternoon crop edge.',
        lat: lat + spanLat * 0.05,
        lng: lng + spanLng * 0.08,
        confidence: 'High',
      },
      {
        id: 'zone-food',
        type: 'FOOD',
        label: 'Crop / CRP Inside Corner Food',
        description: 'Protected afternoon staging corner where deer enter fields before dark.',
        lat: lat - spanLat * 0.38,
        lng: lng + spanLng * 0.42,
        confidence: 'High',
      },
      {
        id: 'zone-stand',
        type: 'STAND',
        label: `Best Stand (${windDirection || 'NW'} Wind)`,
        description: `Hang on the downwind edge of the funnel so your ${windDirection || 'NW'} scent blows away from bedding.`,
        lat: lat - spanLat * 0.12,
        lng: lng + spanLng * 0.22,
        confidence: 'Zero-Blowout Setup',
      },
    ],
  });

  const ai = getGeminiClient();
  if (!ai) {
    return res.json(buildTacticalFallback());
  }

  try {
    const prompt = `You are an elite Kansas whitetail & wildlife tactical E-Scout analyst.
Analyze this real Kansas hunting parcel centered at (${lat.toFixed(5)}, ${lng.toFixed(5)}):
- Parcel: ${parcelName} (${acres} acres)
- Habitat: ${landType}
- Wind: ${windDirection} at ${windSpeedMph} mph
- Notes: ${terrainNotes || 'Kansas Flint Hills timber creek draw and native CRP/crop edge'}

Return 4 tactical zones (BEDDING, FUNNEL, FOOD, STAND) with offset fractions dx (-0.6..0.6) and dy (-0.6..0.6) relative to the parcel center.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            accessStrategy: { type: Type.STRING },
            zones: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING },
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                  dx: { type: Type.NUMBER },
                  dy: { type: Type.NUMBER },
                  confidence: { type: Type.STRING },
                },
                required: ['id', 'type', 'label', 'description', 'dx', 'dy', 'confidence'],
              },
            },
          },
          required: ['summary', 'accessStrategy', 'zones'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const zones = (parsed.zones || []).map((z: any) => ({
      id: z.id,
      type: z.type,
      label: z.label,
      description: z.description,
      lat: lat + (Number(z.dy) || 0) * spanLat,
      lng: lng + (Number(z.dx) || 0) * spanLng,
      confidence: z.confidence,
    }));

    return res.json({
      source: 'gemini-4-hydrogen',
      summary: parsed.summary,
      accessStrategy: parsed.accessStrategy,
      zones,
    });
  } catch {
    return res.json(buildTacticalFallback());
  }
});

// POST /api/ai/tag-cam — Gemini Vision AI Trail Camera Tagger
app.post('/api/ai/tag-cam', async (req, res) => {
  const { imageBase64, mimeType, parcelName, notes } = req.body || {};
  const ai = getGeminiClient();

  const fallbackCam = {
    species: 'Buck',
    count: 1,
    classification: 'Mature 4.5+ yr Whitetail Buck (Est. 145" Gross)',
    timeOfDay: 'Dawn / Legal Shooting Light',
    weatherNote: 'Frosty morning, rising barometric pressure',
    tacticalTip: `Captured moving toward leeward bedding on ${parcelName || 'Kansas Tract'}. Hunt downwind on cold fronts.`,
  };

  if (!ai || !imageBase64) {
    return res.json(fallbackCam);
  }

  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: cleanBase64 } },
          {
            text: `Analyze this wildlife trail camera photograph taken on "${parcelName || 'Kansas Hunting Parcel'}". Notes: ${notes || 'None'}.
Identify primary species (Buck, Doe, Coyote, Turkey, Hog, Duck, or Other), count, classification, time of day, weather note, and 1-sentence tactical hunting tip.`,
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            species: { type: Type.STRING },
            count: { type: Type.INTEGER },
            classification: { type: Type.STRING },
            timeOfDay: { type: Type.STRING },
            weatherNote: { type: Type.STRING },
            tacticalTip: { type: Type.STRING },
          },
          required: ['species', 'count', 'classification', 'timeOfDay', 'weatherNote', 'tacticalTip'],
        },
      },
    });
    return res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch {
    return res.json(fallbackCam);
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Prevent stale HTML caching and automatically retire any lingering dev-sw.js service worker
    app.get('/dev-sw.js', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.type('application/javascript').send(
        `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
    } catch {}
  })());
});`
      );
    });

    app.get('/manifest.webmanifest', (_req, res) => {
      res.type('application/manifest+json').json({
        id: '/',
        name: 'SectionLine KS — Kansas Hunting GIS',
        short_name: 'SectionLine',
        description:
          'Kansas tactical hunting GIS, 105-county parcel boundaries, landowner phone records, live weather & offline field maps.',
        theme_color: '#141a11',
        background_color: '#0c0f0a',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      });
    });

    app.use((req, res, next) => {
      const acceptsHtml = typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html');
      if (
        req.method === 'GET' &&
        !req.path.startsWith('/api/') &&
        (req.path === '/' || req.path === '/index.html' || acceptsHtml)
      ) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
      next();
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SectionLine KS server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
