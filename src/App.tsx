import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { onAuthStateChanged, signOut, updateProfile, User } from 'firebase/auth';
import {
  Map as MapIcon,
  Crosshair,
  FileCheck2,
  BookOpen,
  Camera,
  Shield,
  CheckCircle2,
  X,
  UserCheck,
  LogOut,
  Loader2,
} from 'lucide-react';
import {
  auth,
  loadOrSyncUserProfile,
  updateHunterProfile,
  getShortHunterName,
  HunterProfile,
} from './firebase';
import { AuthScreen, STANDALONE_AUTHED_KEY } from './components/AuthScreen';
import {
  HuntingParcel,
  MapLayerMode,
  FieldPin,
  PinCategory,
  PermissionStatus,
  EScoutReport,
  OwnerPublicIntel,
  TrailCamPhoto,
  CrewMember,
  CrewTask,
  HarvestRecord,
  AuditLogEntry,
  HuntSpecies,
  LiveKansasWeather,
} from './types/hunting';
import {
  INITIAL_PARCELS,
  INITIAL_PINS,
  INITIAL_TRAIL_CAMS,
  INITIAL_CREW_MEMBERS,
  INITIAL_CREW_TASKS,
  INITIAL_HARVEST_LOGS,
  INITIAL_AUDIT_LOGS,
  IMG_GATE_PERMISSION,
} from './data/kansasParcels';
import { KansasGoogleMap } from './components/KansasGoogleMap';
import { KansasFallbackMap } from './components/KansasFallbackMap';
import {
  KansasUniversalSearch,
  KansasSearchResult,
  TownBriefing,
} from './components/KansasUniversalSearch';
import { OwnerCardSheet } from './components/OwnerCardSheet';
import { HuntTodayModal } from './components/HuntTodayModal';
import { WardenSlipModal } from './components/WardenSlipModal';
import {
  PermissionsBlackBookView,
  ScoutingAndCamsView,
  CrewAndEnterpriseView,
  LegalAndSafetyView,
  CustomSpotInput,
} from './components/PermissionsAndIntelViews';
import { KansasPhoneBookView } from './components/KansasPhoneBookView';

type ActiveTab = 'MAP' | 'PERMISSIONS' | 'PHONEBOOK' | 'SCOUTING' | 'CREW' | 'LEGAL';

const WIND_SEQUENCE: { dir: string; speed: number }[] = [
  { dir: 'NW', speed: 11 },
  { dir: 'NNW', speed: 14 },
  { dir: 'W', speed: 9 },
  { dir: 'SW', speed: 12 },
  { dir: 'N', speed: 15 },
];

// Point-in-polygon ray casting on WGS84 lat/lng
function isPointInRing(pt: { lat: number; lng: number }, ring: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersect =
      yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Haversine distance in feet between two lat/lng points
function haversineFeet(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 20902231; // Earth radius in feet
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isPlaceholderOwner(name?: string, ownerNameVerified?: boolean): boolean {
  if (ownerNameVerified === false) return true;
  const s = String(name || '').trim();
  if (!s || s.length < 3) return true;
  return /^(Private (Owner|Landowner|Parcel)|Section \d+|Unknown|KDWP|KS WIHA)/i.test(s);
}

function normalizeOwnerCountyKey(ownerName?: string, county?: string): string {
  const cleanOwner = String(ownerName || '')
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
    .toUpperCase()
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

export default function App() {
  // Firebase Auth Session & Hunter Profile
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [hunterProfile, setHunterProfile] = useState<HunterProfile | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [profileNameDraft, setProfileNameDraft] = useState<string>('');
  const [profilePhoneDraft, setProfilePhoneDraft] = useState<string>('');
  const [isSavingProfile, setIsSavingProfile] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Google Maps API key loaded from env or /api/config/maps + Demo Key Quota Banner State
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [mapsKeyLoaded, setMapsKeyLoaded] = useState<boolean>(
    Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
  );
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(
    Boolean((window as any).__GMP_QUOTA_EXCEEDED__)
  );
  const [mapsBillingError, setMapsBillingError] = useState<boolean>(
    Boolean((window as any).__GMP_BILLING_ERROR__)
  );
  const [billingBannerDismissed, setBillingBannerDismissed] = useState<boolean>(false);

  // Navigation & Core State (persisted to localStorage so user-saved owners & permissions stick permanently!)
  const [activeTab, setActiveTab] = useState<ActiveTab>('MAP');
  const [crewParcels, setCrewParcels] = useState<HuntingParcel[]>(() => {
    try {
      // Purge legacy v1 example storage so old pre-loaded mock parcels never come back
      localStorage.removeItem('sectionline_ks_custom_parcels_v1');
      localStorage.removeItem('sectionline_ks_overrides_v1');
      localStorage.removeItem('sectionline_ks_pins_v1');
      const raw = localStorage.getItem('sectionline_ks_custom_parcels_v2');
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) return saved;
      }
    } catch {
      // Ignore storage errors
    }
    return INITIAL_PARCELS;
  });
  const [liveGisParcels, setLiveGisParcels] = useState<HuntingParcel[]>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_live_cache_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  });
  const [parcelOverrides, setParcelOverrides] = useState<
    Record<string, Partial<HuntingParcel>>
  >(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_overrides_v2');
      if (raw) return JSON.parse(raw) || {};
    } catch {
      // Ignore storage errors
    }
    return {};
  });
  const [deletedParcelIds, setDeletedParcelIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_deleted_parcels_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  });
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);

  // Map Camera & Layer State — Starts at z15 in Butler County KS so ALL property lines + live owners show immediately!
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({
    lat: 37.8168,
    lng: -96.7465,
  });
  const [mapZoom, setMapZoom] = useState<number>(15);
  const [mapLayer, setMapLayer] = useState<MapLayerMode>('HYBRID');
  const [is3DTilt, setIs3DTilt] = useState<boolean>(false);
  const [streetViewCoords, setStreetViewCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  // Live GIS Loading & Tap-Anywhere Point Inspection State
  const [isLoadingParcels, setIsLoadingParcels] = useState<boolean>(false);
  const [gisSourcesActive, setGisSourcesActive] = useState<string[]>([]);
  const [inspectingCoords, setInspectingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isInspectingPoint, setIsInspectingPoint] = useState<boolean>(false);
  const viewportFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live Kansas Weather, Wind & Legal Shooting Light + Manual Wind Test Override
  const [liveWeather, setLiveWeather] = useState<LiveKansasWeather | null>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_weather_v1');
      if (raw) return JSON.parse(raw);
    } catch {
      // Ignore storage errors
    }
    return null;
  });
  const lastWeatherCoordRef = useRef<{ lat: number; lng: number } | null>(null);
  const [manualWindOverrideIdx, setManualWindOverrideIdx] = useState<number | null>(null);
  const currentWind =
    manualWindOverrideIdx !== null
      ? WIND_SEQUENCE[manualWindOverrideIdx]
      : liveWeather
        ? { dir: liveWeather.windDir, speed: liveWeather.windSpeedMph }
        : WIND_SEQUENCE[0];
  const [hunterGps, setHunterGps] = useState<{ lat: number; lng: number }>({
    lat: 37.8193,
    lng: -96.7506,
  });

  // Pins, AI E-Scout, Legal Owner Public Intel
  const [pins, setPins] = useState<FieldPin[]>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_pins_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return INITIAL_PINS;
  });
  const [activePinCategoryToDrop, setActivePinCategoryToDrop] = useState<PinCategory | null>(null);
  const [escoutReports, setEscoutReports] = useState<Record<string, EScoutReport>>({});
  const [isEScoutLoading, setIsEScoutLoading] = useState<boolean>(false);
  const [publicIntelByParcel, setPublicIntelByParcel] = useState<Record<string, OwnerPublicIntel>>({});
  const [isSearchingPublicIntel, setIsSearchingPublicIntel] = useState<boolean>(false);
  const [isBatchScanningPhones, setIsBatchScanningPhones] = useState<boolean>(false);
  const autoScannedParcelIdsRef = useRef<Set<string>>(new Set());
  const autoBatchOwnerKeysRef = useRef<Set<string>>(new Set());
  const autoBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const batchScanInFlightRef = useRef<boolean>(false);

  // Trail Cams, Crew, Safety & Offline
  const [trailCams, setTrailCams] = useState<TrailCamPhoto[]>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_trailcams_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return INITIAL_TRAIL_CAMS;
  });
  const [isTaggingCam, setIsTaggingCam] = useState<boolean>(false);
  const [showCrewGps, setShowCrewGps] = useState<boolean>(true);
  const [tasks, setTasks] = useState<CrewTask[]>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_tasks_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return INITIAL_CREW_TASKS;
  });
  const [harvestLogs, setHarvestLogs] = useState<HarvestRecord[]>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_harvest_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return INITIAL_HARVEST_LOGS;
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    try {
      const raw = localStorage.getItem('sectionline_ks_audit_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return INITIAL_AUDIT_LOGS;
  });
  const [activeRole, setActiveRole] = useState<CrewMember['role']>('Crew Captain (Admin)');
  const [hidePhonesForCrewPrivacy, setHidePhonesForCrewPrivacy] = useState<boolean>(false);

  const [isOfflineDownloaded, setIsOfflineDownloaded] = useState<boolean>(true);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [cachedTileCount, setCachedTileCount] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('sectionline_ks_cached_tiles_v1') || '0') || 0;
    } catch {
      return 0;
    }
  });
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Hunt Today, Printable Warden Slip Modal, Universal Kansas Search Town Briefing & Voice Control
  const [isHuntTodayOpen, setIsHuntTodayOpen] = useState<boolean>(false);
  const [wardenSlipParcelId, setWardenSlipParcelId] = useState<string | null>(null);
  const [activeTownInfo, setActiveTownInfo] = useState<TownBriefing | null>(null);
  const [voiceToast, setVoiceToast] = useState<string | null>(null);
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [sosTriggeredAt, setSosTriggeredAt] = useState<string | null>(null);
  const [requireFreshInstallAuth, setRequireFreshInstallAuth] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('install') || params.has('download') || params.has('login')) {
        return true;
      }
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      if (isStandalone && !localStorage.getItem(STANDALONE_AUTHED_KEY)) {
        return true;
      }
    } catch {
      // Ignore storage errors
    }
    return false;
  });

  // Whenever the app is newly downloaded/installed to a device, prompt Create Account / Sign In
  useEffect(() => {
    const onAppInstalled = () => {
      try {
        localStorage.removeItem(STANDALONE_AUTHED_KEY);
      } catch {
        // Ignore storage errors
      }
      setRequireFreshInstallAuth(true);
    };
    window.addEventListener('appinstalled', onAppInstalled);
    return () => window.removeEventListener('appinstalled', onAppInstalled);
  }, []);

  // Listen for Firebase Auth session state (restores saved login automatically)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const profile = await loadOrSyncUserProfile(user);
          setHunterProfile(profile);
        } catch {
          setHunterProfile({
            uid: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || 'Kansas Hunter',
            email: user.email || '',
            role: 'hunter',
          });
        }
      } else {
        setHunterProfile(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const activeHunterName =
    hunterProfile?.displayName ||
    firebaseUser?.displayName ||
    firebaseUser?.email?.split('@')[0] ||
    'Kansas Hunter';
  const activeHunterShortName = getShortHunterName(activeHunterName);
  const activeHunterPhone = hunterProfile?.phone || '';

  const openAccountModal = () => {
    setProfileNameDraft(activeHunterName);
    setProfilePhoneDraft(activeHunterPhone);
    setProfileError(null);
    setIsAccountModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    const cleanName = profileNameDraft.trim();
    if (cleanName.length < 2) {
      setProfileError('Please enter your name (at least 2 characters).');
      return;
    }
    setIsSavingProfile(true);
    setProfileError(null);
    try {
      await updateProfile(firebaseUser, { displayName: cleanName });
      let updated: HunterProfile;
      try {
        updated = await updateHunterProfile(firebaseUser, {
          displayName: cleanName,
          phone: profilePhoneDraft.trim(),
        });
      } catch {
        updated = {
          uid: firebaseUser.uid,
          displayName: cleanName,
          email: firebaseUser.email || '',
          phone: profilePhoneDraft.trim() || undefined,
          role: 'hunter',
        };
      }
      setHunterProfile(updated);
      setIsAccountModalOpen(false);
      setVoiceToast(`Signed in as ${updated.displayName}`);
      setTimeout(() => setVoiceToast(null), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSignOut = async () => {
    try {
      localStorage.removeItem(STANDALONE_AUTHED_KEY);
    } catch {
      // Ignore storage errors
    }
    await signOut(auth);
    setHunterProfile(null);
    setIsAccountModalOpen(false);
  };

  // Listen for Demo Key Google Maps Quota Exceeded & Billing/Auth Fallback events
  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    const onBillingOrAuth = () => setMapsBillingError(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    window.addEventListener('gmp-auth-billing-error', onBillingOrAuth);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', onQuota);
      window.removeEventListener('gmp-auth-billing-error', onBillingOrAuth);
    };
  }, []);

  // Persist parcelOverrides & user-tagged parcels to localStorage (v2 clean slate)
  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_overrides_v2', JSON.stringify(parcelOverrides));
    } catch {
      // Ignore quota errors
    }
  }, [parcelOverrides]);

  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_deleted_parcels_v2', JSON.stringify(deletedParcelIds));
    } catch {
      // Ignore quota errors
    }
  }, [deletedParcelIds]);

  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_custom_parcels_v2', JSON.stringify(crewParcels.slice(0, 200)));
    } catch {
      // Ignore quota errors
    }
  }, [crewParcels]);

  // Persist pins, trailCams, tasks, harvestLogs & auditLogs to localStorage (v2)
  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_pins_v2', JSON.stringify(pins));
    } catch {
      // Ignore quota errors
    }
  }, [pins]);

  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_trailcams_v2', JSON.stringify(trailCams));
    } catch {
      // Ignore quota errors
    }
  }, [trailCams]);

  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_tasks_v2', JSON.stringify(tasks));
    } catch {
      // Ignore quota errors
    }
  }, [tasks]);

  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_harvest_v2', JSON.stringify(harvestLogs));
    } catch {
      // Ignore quota errors
    }
  }, [harvestLogs]);

  useEffect(() => {
    try {
      localStorage.setItem('sectionline_ks_audit_v2', JSON.stringify(auditLogs.slice(0, 100)));
    } catch {
      // Ignore quota errors
    }
  }, [auditLogs]);

  useEffect(() => {
    if (!liveGisParcels.length) return;
    try {
      localStorage.setItem(
        'sectionline_ks_live_cache_v1',
        JSON.stringify(liveGisParcels.slice(0, 140))
      );
    } catch {
      // Ignore quota errors
    }
  }, [liveGisParcels]);

  // Fetch live Kansas weather, wind & KDWP legal shooting light for active area
  const fetchLiveKansasWeather = useCallback(
    async (lat: number, lng: number) => {
      if (isOfflineMode) return;
      try {
        const res = await fetch(`/api/ks-weather?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`);
        if (res.ok) {
          const data: LiveKansasWeather = await res.json();
          if (data?.windDir) {
            setLiveWeather(data);
            lastWeatherCoordRef.current = { lat, lng };
            try {
              localStorage.setItem('sectionline_ks_weather_v1', JSON.stringify(data));
            } catch {
              // Ignore quota errors
            }
          }
        }
      } catch {
        // Non-blocking fallback to cached weather
      }
    },
    [isOfflineMode]
  );

  useEffect(() => {
    const prev = lastWeatherCoordRef.current;
    if (
      !prev ||
      Math.abs(prev.lat - mapCenter.lat) > 0.2 ||
      Math.abs(prev.lng - mapCenter.lng) > 0.2
    ) {
      fetchLiveKansasWeather(mapCenter.lat, mapCenter.lng);
    }
  }, [mapCenter.lat, mapCenter.lng, fetchLiveKansasWeather]);

  // Load Maps API Key from server config if not baked into Vite env
  useEffect(() => {
    if (mapsApiKey) return;
    fetch('/api/config/maps')
      .then((r) => r.json())
      .then((data) => {
        if (data?.apiKey) setMapsApiKey(data.apiKey);
      })
      .catch(() => {})
      .finally(() => setMapsKeyLoaded(true));
  }, [mapsApiKey]);

  // Merge Crew Black Book parcels + Live Kansas GIS parcels + User Overrides (filtering out user-deleted spots)
  const allParcels = useMemo(() => {
    const combined: HuntingParcel[] = [];
    const seenIds: Record<string, boolean> = {};
    const deletedSet = new Set(deletedParcelIds);

    for (const p of crewParcels) {
      if (deletedSet.has(p.id)) continue;
      seenIds[p.id] = true;
      combined.push({ ...p, ...(parcelOverrides[p.id] || {}) });
    }
    for (const p of liveGisParcels) {
      if (seenIds[p.id] || deletedSet.has(p.id)) continue;
      seenIds[p.id] = true;
      // Compute rough drive minutes from Wichita/El Dorado center
      const distMiles = Number((haversineFeet(hunterGps, p.center) / 5280).toFixed(1));
      const driveMins = Math.max(4, Math.round(distMiles * 1.35));
      combined.push({
        ...p,
        distanceMiles: distMiles,
        driveMinutes: driveMins,
        lastHuntedSummary:
          p.permissionStatus === 'PUBLIC'
            ? p.publicRules || 'Public Kansas Walk-In Hunting Access'
            : p.livesOnLand
            ? 'Owner lives on land — knockable today!'
            : 'Live Kansas county tax parcel — tap to check owner & mail letter.',
        ...(parcelOverrides[p.id] || {}),
      });
    }
    return combined;
  }, [crewParcels, liveGisParcels, parcelOverrides, deletedParcelIds, hunterGps]);

  const selectedParcel = useMemo(
    () => (selectedParcelId ? allParcels.find((p) => p.id === selectedParcelId) || null : null),
    [allParcels, selectedParcelId]
  );

  // Active signed-in hunter appears in the Crew list with real live counts (starts at 0)
  const crewMembers = useMemo<CrewMember[]>(() => {
    const permissionsSecured = allParcels.filter((p) => p.permissionStatus === 'YES').length;
    const acresScouted = allParcels
      .filter((p) => p.permissionStatus !== 'UNKNOWN' && p.permissionStatus !== 'PUBLIC')
      .reduce((sum, p) => sum + (p.acres || 0), 0);
    const doesHarvested = harvestLogs.filter((h) => /doe/i.test(h.species)).length;
    const bucksHarvested = harvestLogs.filter((h) => /buck/i.test(h.species)).length;
    return [
      {
        id: firebaseUser?.uid || 'hunter-self',
        name: activeHunterName,
        role: activeRole,
        phone: activeHunterPhone || 'On File',
        lat: hunterGps.lat,
        lng: hunterGps.lng,
        sharingLiveGps: true,
        activeParcelId: selectedParcelId || '',
        statusText: 'Active in Field',
        permissionsSecured,
        acresScouted,
        doesHarvested,
        bucksHarvested,
      },
    ];
  }, [
    firebaseUser?.uid,
    activeHunterName,
    activeRole,
    activeHunterPhone,
    hunterGps.lat,
    hunterGps.lng,
    selectedParcelId,
    allParcels,
    harvestLogs,
  ]);

  // Fetch REAL live Kansas Parcels, WIHA, Wildlife Areas & PLSS Sections as the user pans/zooms Google Maps!
  const fetchLiveKansasParcels = useCallback(
    async (bounds: google.maps.LatLngBoundsLiteral, zoom: number) => {
      if (isOfflineMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      // Only fetch when looking roughly inside Kansas bounds
      if (bounds.east < -102.5 || bounds.west > -94.2 || bounds.north < 36.7 || bounds.south > 40.3) {
        return;
      }
      setIsLoadingParcels(true);
      try {
        const params = new URLSearchParams({
          minLng: String(bounds.west),
          minLat: String(bounds.south),
          maxLng: String(bounds.east),
          maxLat: String(bounds.north),
          zoom: String(Math.round(zoom)),
        });
        const res = await fetch(`/api/ks-gis/viewport?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.parcels)) {
            setLiveGisParcels(data.parcels);
            setGisSourcesActive(data.sourcesUsed || []);
          }
        }
      } catch (err) {
        console.warn('Live KS GIS viewport unavailable:', err);
      } finally {
        setIsLoadingParcels(false);
      }
    },
    [isOfflineMode]
  );

  // Initial load for Butler County Kansas viewport on first mount
  useEffect(() => {
    fetchLiveKansasParcels(
      { west: -96.77, south: 37.795, east: -96.72, north: 37.84 },
      14
    );
  }, [fetchLiveKansasParcels]);

  const handleCameraChange = useCallback(
    (_center: { lat: number; lng: number }, zoom: number, bounds?: google.maps.LatLngBoundsLiteral) => {
      if (!bounds) return;
      if (viewportFetchTimerRef.current) clearTimeout(viewportFetchTimerRef.current);
      viewportFetchTimerRef.current = setTimeout(() => {
        fetchLiveKansasParcels(bounds, zoom);
      }, 450);
    },
    [fetchLiveKansasParcels]
  );

  // Real-time Trespass Check (Is your live blue GPS dot inside any Red NO_GO parcel?)
  const { isTrespassingRed, distanceToNearestLineFt } = useMemo(() => {
    let insideRed = false;
    let minFt = 9999;

    for (const p of allParcels) {
      const outer = p.rings?.[0];
      if (!outer || outer.length < 3) continue;
      if (p.permissionStatus === 'NO_GO' && isPointInRing(hunterGps, outer)) {
        insideRed = true;
      }
      for (const vertex of outer) {
        const d = haversineFeet(hunterGps, vertex);
        if (d < minFt) minFt = d;
      }
    }

    return {
      isTrespassingRed: insideRed,
      distanceToNearestLineFt: minFt < 9999 ? Math.round(minFt) : 45,
    };
  }, [hunterGps, allParcels]);

  // Vibrate device when walking across into Red parcel
  useEffect(() => {
    if (isTrespassingRed && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([250, 100, 250, 100, 350]);
    }
  }, [isTrespassingRed]);

  const appendAudit = (
    action: string,
    targetParcel: string,
    complianceStatus: AuditLogEntry['complianceStatus'] = 'VERIFIED LEGAL'
  ) => {
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
        actor: activeHunterName,
        role: activeRole,
        action,
        targetParcel,
        complianceStatus: isOfflineMode ? 'OFFLINE SYNC' : complianceStatus,
      },
      ...prev,
    ]);
  };

  // Mutate any parcel (whether starter black-book OR freshly tapped live Kansas GIS parcel!)
  const updateParcelField = (parcelId: string, updater: (p: HuntingParcel) => Partial<HuntingParcel>) => {
    const existing = allParcels.find((p) => p.id === parcelId);
    if (!existing) return;
    const patch = updater(existing);
    setParcelOverrides((prev) => ({
      ...prev,
      [parcelId]: { ...(prev[parcelId] || {}), ...patch },
    }));
    // Ensure saved parcels persist in crewParcels list even if user pans away!
    setCrewParcels((prev) => {
      const idx = prev.findIndex((item) => item.id === parcelId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...patch };
        return copy;
      }
      return [{ ...existing, ...patch }, ...prev];
    });
    if (isOfflineMode) setPendingSyncCount((c) => c + 1);
  };

  const handleUpdatePermissionStatus = (parcelId: string, status: PermissionStatus) => {
    updateParcelField(parcelId, () => ({ permissionStatus: status }));
    appendAudit(`Set Permission Status to ${status}`, parcelId);
  };

  const handleLogKnockVisit = (parcelId: string, outcomeNote: string) => {
    updateParcelField(parcelId, (p) => ({
      permissionStatus: p.permissionStatus === 'UNKNOWN' ? 'ASK' : p.permissionStatus,
      crewNotes: [
        {
          id: `note-${Date.now()}`,
          author: activeHunterShortName,
          role: activeRole,
          timestamp: 'Just now',
          text: outcomeNote,
          tag: 'Knock Intel',
        },
        ...p.crewNotes,
      ],
    }));
    appendAudit('Logged Doorstep Knock Intel', parcelId);
  };

  const handleAddCrewNote = (
    parcelId: string,
    noteText: string,
    tag: 'Knock Intel' | 'Access Rule' | 'Sighting' | 'Pressure Warning'
  ) => {
    updateParcelField(parcelId, (p) => ({
      crewNotes: [
        {
          id: `note-${Date.now()}`,
          author: activeHunterShortName,
          role: activeRole,
          timestamp: 'Just now',
          text: noteText,
          tag,
        },
        ...p.crewNotes,
      ],
    }));
    appendAudit(`Added Crew Note [${tag}]`, parcelId);
  };

  const handleCreatePermissionSlip = (
    parcelId: string,
    allowedSpecies: HuntSpecies[],
    maxHunters: number,
    rules: string
  ) => {
    updateParcelField(parcelId, (p) => ({
      permissionStatus: 'YES',
      permissionSlip: {
        id: `PERM-KS-2026-${Math.floor(100 + Math.random() * 899)}`,
        parcelId: p.id,
        ownerName: p.ownerName,
        hunterNames: [activeHunterName],
        grantedDate: new Date().toISOString().slice(0, 10),
        expiresDate: '2027-01-31',
        followUpDueDate: '2026-12-09',
        thankYouSent: false,
        allowedSpecies,
        maxHuntersAtOnce: maxHunters,
        weaponsAllowed: 'Archery, Shotgun & Predator Rifle per Owner Rules',
        rulesAndNotes: rules,
        gatePhotoUrl: IMG_GATE_PERMISSION,
        verificationHash: `KS-KDWPT-ESIGN-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
        ownerPhoneVerified: p.publicPhoneListing || 'Verified On File',
      },
    }));
    appendAudit('Saved Digital Game Warden Permission Slip', parcelId);
  };

  const handleSendLeaseMessage = (parcelId: string, message: string, proposedRate?: number) => {
    updateParcelField(parcelId, (p) => ({
      leaseMessages: [
        ...p.leaseMessages,
        {
          id: `msg-${Date.now()}`,
          sender: 'CREW',
          senderName: activeHunterName,
          timestamp: 'Just now',
          message,
          proposedAnnualRate: proposedRate,
        },
      ],
    }));
    appendAudit('Sent Landowner Access / Lease Message', parcelId);
  };

  const handleIncrementTrucksSeen = (parcelId: string) => {
    updateParcelField(parcelId, (p) => {
      const next = p.trucksSeenThisWeek + 1;
      return {
        trucksSeenThisWeek: next,
        pressureLevel: next >= 4 ? 'High (Hammered)' : next >= 2 ? 'Moderate' : 'Low',
      };
    });
  };

  const handleSaveOwnerPhone = (
    parcelId: string,
    phone: string,
    opts?: { asAdditional?: boolean }
  ) => {
    const cleanPhone = phone.trim();
    updateParcelField(parcelId, (p) => {
      if (!cleanPhone) {
        return {
          savedOwnerPhone: undefined,
          phoneSourceCitation: undefined,
        };
      }
      const existingDigits = new Set(
        [p.savedOwnerPhone, ...(p.savedAdditionalPhones || [])]
          .filter(Boolean)
          .map((x) => String(x).replace(/\D/g, '').slice(-10))
      );
      const newDigits = cleanPhone.replace(/\D/g, '').slice(-10);

      if (opts?.asAdditional && p.savedOwnerPhone) {
        if (existingDigits.has(newDigits)) return {};
        return {
          savedAdditionalPhones: [...(p.savedAdditionalPhones || []), cleanPhone],
          phoneSourceCitation: p.phoneSourceCitation || 'Saved by Hunting Crew',
        };
      }

      const prevPrimary = p.savedOwnerPhone;
      const nextAdditional =
        prevPrimary && prevPrimary.replace(/\D/g, '').slice(-10) !== newDigits
          ? Array.from(new Set([...(p.savedAdditionalPhones || []), prevPrimary]))
          : p.savedAdditionalPhones;

      return {
        savedOwnerPhone: cleanPhone,
        savedAdditionalPhones: nextAdditional,
        phoneSourceCitation: 'Saved by Hunting Crew',
      };
    });
    appendAudit(cleanPhone ? `Saved Confirmed Landowner Phone (${cleanPhone})` : 'Cleared Saved Phone', parcelId);
    const target = allParcels.find((p) => p.id === parcelId);
    if (cleanPhone && target && !isPlaceholderOwner(target.ownerName, target.ownerNameVerified)) {
      fetch('/api/ai/save-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerName: target.ownerName,
          county: target.county,
          propertyAddress: target.propertyAddress,
          phone: cleanPhone,
        }),
      }).catch(() => {});
    }
  };

  const handleUpdateOwnerDetails = (
    parcelId: string,
    details: {
      ownerName: string;
      propertyAddress?: string;
      taxMailingAddress?: string;
      savedOwnerPhone?: string;
      livesOnLand?: boolean;
    }
  ) => {
    updateParcelField(parcelId, (p) => {
      const cleanOwner = details.ownerName.trim();
      const cleanCounty = (p.county || 'Kansas').replace(/\(.*\)/g, '').trim();
      const cityOrCounty = cleanCounty.replace(/County,?\s*KS/i, '').trim() || 'Kansas';
      const fpsNameSlug = cleanOwner.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const fpsCitySlug = cityOrCounty.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existingTaxUrl =
        p.countyAppraiserUrl ||
        p.publicLinks.find((l) => l.label === 'County GIS Tax Roll')?.url ||
        'https://www.kansasgis.org/orka/';

      const updatedLinks: HuntingParcel['publicLinks'] = [
        {
          label: 'Phone Search',
          url: `https://www.google.com/search?q=${encodeURIComponent(`"${cleanOwner}" "${cityOrCounty}" Kansas phone number`)}`,
          complianceNote: 'Live Google public phone & directory lookup',
        },
        {
          label: 'FastPeopleSearch',
          url: `https://www.fastpeoplesearch.com/name/${fpsNameSlug}_${fpsCitySlug}-ks`,
          complianceNote: 'Free public Kansas residential phone & address directory',
        },
        {
          label: 'TruePeopleSearch',
          url: `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(cleanOwner)}&citystatezip=${encodeURIComponent(`${cityOrCounty}, KS`)}`,
          complianceNote: 'Public people & address phone directory',
        },
        {
          label: 'Whitepages',
          url: `https://www.whitepages.com/name/${encodeURIComponent(cleanOwner.replace(/\s+/g, '-'))}/KS`,
          complianceNote: 'Public Whitepages Kansas residential & landline directory',
        },
        {
          label: 'Facebook',
          url: `https://www.facebook.com/search/top/?q=${encodeURIComponent(`${cleanOwner} ${cityOrCounty} Kansas`)}`,
          complianceNote: 'Public social profile lookup',
        },
        {
          label: 'LLC Filing',
          url: 'https://www.kansas.gov/bess/flow/main?execution=e1s1',
          complianceNote: 'KS Secretary of State Business Entity & Registered Agent Search',
        },
        {
          label: 'County GIS Tax Roll',
          url: existingTaxUrl,
          complianceNote: `Official ${cleanCounty} Public Appraiser Record`,
        },
      ];

      return {
        ownerName: cleanOwner,
        ownerNameVerified: true,
        name: details.propertyAddress || `${cleanOwner} (${p.acres.toFixed(1)} ac)`,
        propertyAddress: details.propertyAddress,
        taxMailingAddress: details.taxMailingAddress || details.propertyAddress || p.taxMailingAddress,
        savedOwnerPhone: details.savedOwnerPhone,
        livesOnLand: details.livesOnLand ?? p.livesOnLand,
        homesteadNote: details.livesOnLand
          ? 'Owner confirmed on site — saved to Crew Black Book.'
          : 'Confirmed owner info saved to Crew Black Book (persisted offline & across reloads).',
        publicLinks: updatedLinks,
      };
    });
    appendAudit(`Saved Known Owner Info (${details.ownerName})`, parcelId);
    if (details.savedOwnerPhone?.trim()) {
      const pTarget = allParcels.find((p) => p.id === parcelId);
      fetch('/api/ai/save-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerName: details.ownerName,
          county: pTarget?.county || 'Kansas',
          propertyAddress: details.propertyAddress || pTarget?.propertyAddress,
          phone: details.savedOwnerPhone.trim(),
        }),
      }).catch(() => {});
    }
    setVoiceToast(`Saved ${details.ownerName} to your Crew Map & refreshed phone lookup links`);
    setTimeout(() => setVoiceToast(null), 3500);
  };

  // Integrate found verified public phones directly onto matching parcels (and persist in parcelOverrides)
  const integratePhoneResultsIntoParcels = useCallback(
    (
      intelMap: Record<string, OwnerPublicIntel>,
      sourceParcels: HuntingParcel[]
    ): number => {
      const patchesById: Record<string, Partial<HuntingParcel>> = {};
      const phoneByOwnerKey = new Map<
        string,
        { phone: string; phones: OwnerPublicIntel['publicPhones']; citation: string; intel: OwnerPublicIntel }
      >();

      for (const p of sourceParcels) {
        const intel = intelMap[p.id];
        const allFound = intel?.publicPhones || [];
        const topPhone = allFound[0];
        if (!topPhone?.number) continue;
        const citation = topPhone.source || intel.modelUsed || 'Live Public Directory';
        patchesById[p.id] = {
          publicPhoneListing: topPhone.number,
          publicPhoneListings: allFound,
          phoneSourceCitation: citation,
        };
        const oKey = normalizeOwnerCountyKey(p.ownerName, p.county);
        if (oKey && !phoneByOwnerKey.has(oKey)) {
          phoneByOwnerKey.set(oKey, { phone: topPhone.number, phones: allFound, citation, intel });
        }
      }

      // Propagate across every loaded parcel owned by that same landowner in the county
      const propagatedIntel: Record<string, OwnerPublicIntel> = {};
      if (phoneByOwnerKey.size > 0) {
        for (const p of sourceParcels) {
          if (patchesById[p.id]) continue;
          const oKey = normalizeOwnerCountyKey(p.ownerName, p.county);
          const shared = oKey ? phoneByOwnerKey.get(oKey) : undefined;
          if (shared) {
            patchesById[p.id] = {
              publicPhoneListing: shared.phone,
              publicPhoneListings: shared.phones,
              phoneSourceCitation: shared.citation,
            };
            propagatedIntel[p.id] = shared.intel;
          }
        }
      }

      const matchedIds = Object.keys(patchesById);
      if (Object.keys(propagatedIntel).length > 0) {
        setPublicIntelByParcel((prev) => ({ ...prev, ...propagatedIntel }));
      }
      if (matchedIds.length === 0) return 0;

      setParcelOverrides((prev) => {
        const next = { ...prev };
        for (const id of matchedIds) {
          next[id] = { ...(next[id] || {}), ...patchesById[id] };
        }
        return next;
      });
      setLiveGisParcels((prev) =>
        prev.map((p) => (patchesById[p.id] ? { ...p, ...patchesById[p.id] } : p))
      );
      setCrewParcels((prev) =>
        prev.map((p) => (patchesById[p.id] ? { ...p, ...patchesById[p.id] } : p))
      );
      return matchedIds.length;
    },
    []
  );

  // AI Legal Public Record & Phone Finder (Live KS Directories + Google Search Grounding)
  const handleSearchPublicIntel = useCallback(
    async (parcel: HuntingParcel, opts?: { silent?: boolean }) => {
      if (parcel.permissionStatus === 'PUBLIC') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!opts?.silent) {
          setVoiceToast('Offline mode active — direct directory links remain available');
          setTimeout(() => setVoiceToast(null), 3000);
        }
        return;
      }
      setIsSearchingPublicIntel(true);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 18000);
        const res = await fetch('/api/ai/owner-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            ownerName: parcel.ownerName,
            county: parcel.county,
            propertyAddress: parcel.propertyAddress,
            taxMailingAddress: parcel.taxMailingAddress,
            sectionCode: parcel.sectionCode,
            acres: parcel.acres,
            forceRefresh: !opts?.silent,
          }),
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.summary || Array.isArray(data?.publicPhones)) {
          const intelEntry: OwnerPublicIntel = {
            confirmedOwnerName: data.confirmedOwnerName,
            publicPhones: Array.isArray(data.publicPhones) ? data.publicPhones : [],
            matchedListings: Array.isArray(data.matchedListings) ? data.matchedListings : [],
            portfolio: data.portfolio || null,
            modelUsed: data.modelUsed,
            summary: data.summary || 'Public record check completed.',
            groundingLinks: data.groundingLinks || [],
            fetchedAt: new Date().toLocaleTimeString(),
          };
          setPublicIntelByParcel((prev) => ({
            ...prev,
            [parcel.id]: intelEntry,
          }));

          const integratedCount = integratePhoneResultsIntoParcels(
            { [parcel.id]: intelEntry },
            allParcels.some((p) => p.id === parcel.id) ? allParcels : [parcel, ...allParcels]
          );

          if (!opts?.silent) {
            if (intelEntry.publicPhones.length > 0) {
              setVoiceToast(
                `Integrated ${intelEntry.publicPhones[0].number} for ${parcel.ownerName.split('/')[0].trim()}`
              );
            } else {
              setVoiceToast('Public record scan complete — direct directory links ready');
            }
            setTimeout(() => setVoiceToast(null), 3500);
          } else if (integratedCount > 0 && intelEntry.publicPhones[0]?.number) {
            setVoiceToast(
              `Found & integrated ${intelEntry.publicPhones[0].number} (${intelEntry.publicPhones[0].source})`
            );
            setTimeout(() => setVoiceToast(null), 3500);
          }
        }
      } catch (err) {
        console.warn('Public intel lookup unavailable:', err);
      } finally {
        setIsSearchingPublicIntel(false);
      }
    },
    [allParcels, integratePhoneResultsIntoParcels]
  );

  // Batch scan & integrate public phone numbers across multiple Kansas landowners
  const handleBatchPhoneScan = useCallback(
    async (targetParcels?: HuntingParcel[], opts?: { silent?: boolean }) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!opts?.silent) {
          setVoiceToast('Offline in field — saved numbers remain clickable');
          setTimeout(() => setVoiceToast(null), 3000);
        }
        return;
      }
      if (opts?.silent && batchScanInFlightRef.current) return;

      const sourceList = targetParcels || allParcels;
      const candidates = sourceList.filter(
        (p) =>
          p.permissionStatus !== 'PUBLIC' &&
          p.permissionStatus !== 'NO_GO' &&
          !isPlaceholderOwner(p.ownerName, p.ownerNameVerified) &&
          !p.savedOwnerPhone &&
          !p.publicPhoneListing
      );

      if (!candidates.length) {
        if (!opts?.silent) {
          setVoiceToast('All verified landowners already have phones integrated or need owner names');
          setTimeout(() => setVoiceToast(null), 3200);
        }
        return;
      }

      batchScanInFlightRef.current = true;
      if (!opts?.silent) setIsBatchScanningPhones(true);
      let totalPhonesIntegrated = 0;
      let totalUniqueScanned = 0;
      let failedChunks = 0;

      const postChunkWithRetry = async (chunk: HuntingParcel[]): Promise<any | null> => {
        const bodyJson = JSON.stringify({
          parcels: chunk.map((p) => ({
            id: p.id,
            ownerName: p.ownerName,
            county: p.county,
            propertyAddress: p.propertyAddress,
            taxMailingAddress: p.taxMailingAddress,
            sectionCode: p.sectionCode,
            acres: p.acres,
          })),
        });
        for (let attempt = 0; attempt < 2; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 22000);
          try {
            const res = await fetch('/api/ai/batch-phone-lookup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: bodyJson,
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
          } catch {
            clearTimeout(timer);
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
        return null;
      };

      try {
        const capCandidates = opts?.silent ? candidates.slice(0, 64) : candidates.slice(0, 160);
        for (let i = 0; i < capCandidates.length; i += 8) {
          const chunk = capCandidates.slice(i, i + 8);
          const data = await postChunkWithRetry(chunk);
          if (!data) {
            failedChunks++;
            continue;
          }
          const rawResults = data?.results || {};
          const intelBatch: Record<string, OwnerPublicIntel> = {};
          for (const [pid, val] of Object.entries<any>(rawResults)) {
            intelBatch[pid] = {
              confirmedOwnerName: val.confirmedOwnerName,
              publicPhones: Array.isArray(val.publicPhones) ? val.publicPhones : [],
              matchedListings: Array.isArray(val.matchedListings) ? val.matchedListings : [],
              portfolio: val.portfolio || null,
              modelUsed: val.modelUsed,
              summary: val.summary || 'Public record scan complete.',
              groundingLinks: Array.isArray(val.groundingLinks) ? val.groundingLinks : [],
              fetchedAt: new Date().toLocaleTimeString(),
            };
          }
          setPublicIntelByParcel((prev) => ({ ...prev, ...intelBatch }));
          totalPhonesIntegrated += integratePhoneResultsIntoParcels(intelBatch, sourceList);
          totalUniqueScanned += Number(data?.stats?.uniqueOwners || chunk.length);
        }

        if (!opts?.silent) {
          setVoiceToast(
            totalPhonesIntegrated > 0
              ? `Scanned ${totalUniqueScanned} owners · Integrated ${totalPhonesIntegrated} verified phone numbers`
              : totalUniqueScanned > 0
                ? `Scanned ${totalUniqueScanned} owners · Direct FastPeopleSearch & Whitepages links integrated`
                : failedChunks > 0
                  ? 'Directory scan temporarily unreachable — tap any owner for direct links'
                  : 'Phone scan complete'
          );
          setTimeout(() => setVoiceToast(null), 4200);
        } else if (totalPhonesIntegrated > 0) {
          setVoiceToast(`Auto-integrated ${totalPhonesIntegrated} public phone listing(s) on map`);
          setTimeout(() => setVoiceToast(null), 3500);
        }
      } catch (err) {
        console.warn('Batch phone scan paused:', err);
      } finally {
        batchScanInFlightRef.current = false;
        if (!opts?.silent) setIsBatchScanningPhones(false);
      }
    },
    [allParcels, integratePhoneResultsIntoParcels]
  );

  // Auto-scan phone records when opening any verified private parcel card without a phone yet
  useEffect(() => {
    if (!selectedParcel) return;
    if (selectedParcel.permissionStatus === 'PUBLIC') return;
    if (isPlaceholderOwner(selectedParcel.ownerName, selectedParcel.ownerNameVerified)) return;
    if (selectedParcel.savedOwnerPhone || selectedParcel.publicPhoneListing) return;
    if (publicIntelByParcel[selectedParcel.id]) return;
    if (autoScannedParcelIdsRef.current.has(selectedParcel.id)) return;

    autoScannedParcelIdsRef.current.add(selectedParcel.id);
    handleSearchPublicIntel(selectedParcel, { silent: true });
  }, [selectedParcel, publicIntelByParcel, handleSearchPublicIntel]);

  // Gentle background phone enrichment as verified live Kansas parcels appear in viewport
  useEffect(() => {
    if (isOfflineMode || !liveGisParcels.length) return;
    const unscanned = liveGisParcels.filter((p) => {
      if (p.permissionStatus === 'PUBLIC' || p.permissionStatus === 'NO_GO') return false;
      if (isPlaceholderOwner(p.ownerName, p.ownerNameVerified)) return false;
      if (p.savedOwnerPhone || p.publicPhoneListing || parcelOverrides[p.id]?.publicPhoneListing) return false;
      const key = normalizeOwnerCountyKey(p.ownerName, p.county);
      return Boolean(key && !autoBatchOwnerKeysRef.current.has(key));
    });
    if (!unscanned.length) return;

    if (autoBatchTimerRef.current) clearTimeout(autoBatchTimerRef.current);
    autoBatchTimerRef.current = setTimeout(() => {
      for (const p of unscanned.slice(0, 64)) {
        const key = normalizeOwnerCountyKey(p.ownerName, p.county);
        if (key) autoBatchOwnerKeysRef.current.add(key);
      }
      handleBatchPhoneScan(unscanned.slice(0, 64), { silent: true });
    }, 900);

    return () => {
      if (autoBatchTimerRef.current) clearTimeout(autoBatchTimerRef.current);
    };
  }, [liveGisParcels, isOfflineMode, parcelOverrides, handleBatchPhoneScan]);

  // On-demand Public Record & Phone Scan (triggered by user click to preserve Gemini API quota)
  // Tap ANYWHERE in ALL 105 Kansas Counties -> Instant Point-In-Polygon + Live ORKA Owner Inspection!
  const handleInspectCoordinate = useCallback(
    async (
      coords: { lat: number; lng: number },
      opts?: { address?: string; pid?: string; county?: string }
    ) => {
      setInspectingCoords(coords);
      setIsInspectingPoint(true);
      try {
        const params = new URLSearchParams({
          lat: String(coords.lat),
          lng: String(coords.lng),
        });
        if (opts?.address) params.set('address', opts.address);
        if (opts?.pid) params.set('pid', opts.pid);
        if (opts?.county) params.set('county', opts.county);

        const res = await fetch(`/api/ks-gis/inspect?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.parcel) {
            const p: HuntingParcel = data.parcel;
            setLiveGisParcels((prev) => {
              const idx = prev.findIndex((item) => item.id === p.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = p;
                return next;
              }
              return [p, ...prev];
            });
            setSelectedParcelId(p.id);
          }
        }
      } catch (err) {
        console.error('Coordinate inspect failed:', err);
      } finally {
        setIsInspectingPoint(false);
      }
    },
    []
  );

  // Instant parcel selection + live on-tap owner hydration for un-hydrated statewide ORKA polygons
  const handleSelectParcel = useCallback(
    (parcel: HuntingParcel) => {
      setSelectedParcelId(parcel.id);
      if (
        parcel.permissionStatus !== 'PUBLIC' &&
        parcel.ownerNameVerified === false &&
        !parcelOverrides[parcel.id]?.ownerNameVerified &&
        (parcel.id.startsWith('orka-') || parcel.id.startsWith('ks-plss-'))
      ) {
        handleInspectCoordinate(parcel.center, {
          pid: parcel.id.startsWith('orka-') ? parcel.parcelTaxId : undefined,
          county: parcel.county,
          address: parcel.propertyAddress,
        });
      }
    },
    [handleInspectCoordinate, parcelOverrides]
  );

  // AI E-Scout with Real Lat/Lng Markers on Google Maps
  const handleRunEScout = async (parcel: HuntingParcel) => {
    setIsEScoutLoading(true);
    try {
      const res = await fetch('/api/ai/escout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcelName: parcel.name,
          acres: parcel.acres,
          landType: parcel.landType,
          windDirection: currentWind.dir,
          windSpeedMph: currentWind.speed,
          terrainNotes: parcel.terrainNotes,
          centerLat: parcel.center.lat,
          centerLng: parcel.center.lng,
        }),
      });
      const data = await res.json();
      if (data?.zones) {
        setEscoutReports((prev) => ({
          ...prev,
          [parcel.id]: {
            source: data.source || 'gemini-4-hydrogen',
            summary: data.summary,
            accessStrategy: data.accessStrategy,
            zones: data.zones,
            generatedAt: `Wind ${currentWind.dir} ${currentWind.speed} mph`,
          },
        }));
        setVoiceToast(`AI E-Scout plotted Bedding, Funnel, Food & Best Stand on ${parcel.ownerName.split('/')[0]}`);
        setTimeout(() => setVoiceToast(null), 4500);
      }
    } catch (err) {
      console.error('AI E-Scout failed:', err);
    } finally {
      setIsEScoutLoading(false);
    }
  };

  // Drop Hunting Pin at exact Lat/Lng
  const handleDropPinAt = useCallback(
    (lat: number, lng: number, category: PinCategory) => {
      const newPin: FieldPin = {
        id: `pin-${Date.now()}`,
        parcelId: selectedParcelId || 'kansas-map',
        category,
        label: `${category} Pin`,
        lat,
        lng,
        createdBy: activeHunterShortName,
        createdAt: 'Just now',
        windIdeal: currentWind.dir,
        notes: `Dropped ${category} pin (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        synced: !isOfflineMode,
      };
      setPins((prev) => [...prev, newPin]);
      setActivePinCategoryToDrop(null);
      if (isOfflineMode) setPendingSyncCount((c) => c + 1);
      setVoiceToast(`Dropped ${category} pin on map`);
      setTimeout(() => setVoiceToast(null), 3000);
    },
    [selectedParcelId, currentWind.dir, isOfflineMode, activeHunterShortName]
  );

  // Universal Kansas Search Handler (Every KS Town, Street, Exact Address, County, Owner & WIHA!)
  const handleSelectSearchResult = useCallback(
    async (result: KansasSearchResult) => {
      setActiveTab('MAP');

      if (result.parcel) {
        const foundParcel = result.parcel;
        setActiveTownInfo(null);
        setLiveGisParcels((prev) =>
          prev.some((p) => p.id === foundParcel.id) ? prev : [foundParcel, ...prev]
        );
        setMapCenter({ lat: result.lat, lng: result.lng });
        setMapZoom(result.zoom || 16);
        setSelectedParcelId(foundParcel.id);
        setInspectingCoords(null);
        setVoiceToast(`Found ${foundParcel.ownerName} (${foundParcel.acres.toFixed(1)} ac)`);
        setTimeout(() => setVoiceToast(null), 3500);
        return;
      }

      if (result.category === 'ADDRESS' || result.autoInspect) {
        setActiveTownInfo(null);
        setMapCenter({ lat: result.lat, lng: result.lng });
        setMapZoom(17);
        setVoiceToast(`Loading live Kansas owner & parcel at ${result.title}...`);
        setTimeout(() => setVoiceToast(null), 3500);
        handleInspectCoordinate(
          { lat: result.lat, lng: result.lng },
          { address: result.title, county: result.county }
        );
        return;
      }

      if (result.category === 'STREET') {
        setActiveTownInfo(null);
        setSelectedParcelId(null);
        setMapCenter({ lat: result.lat, lng: result.lng });
        setMapZoom(16);
        setInspectingCoords({ lat: result.lat, lng: result.lng });
        setVoiceToast(`Jumped to ${result.title} — Tap any bordering property line for owner info`);
        setTimeout(() => setVoiceToast(null), 4000);
        return;
      }

      // TOWN or COUNTY selection: fly there & fetch Town Scouting Info (County, nearby WIHA tracts & acres)
      setSelectedParcelId(null);
      setInspectingCoords(null);
      setMapCenter({ lat: result.lat, lng: result.lng });
      setMapZoom(result.zoom || 14);
      setVoiceToast(`Jumped to ${result.title} — Loading Kansas streets & property lines`);
      setTimeout(() => setVoiceToast(null), 3500);

      try {
        const res = await fetch(
          `/api/ks-gis/town-info?lat=${result.lat}&lng=${result.lng}&name=${encodeURIComponent(
            result.title
          )}&county=${encodeURIComponent(result.county || '')}`
        );
        if (res.ok) {
          const info: TownBriefing = await res.json();
          setActiveTownInfo(info);
        }
      } catch {
        // Non-blocking
      }
    },
    [handleInspectCoordinate]
  );

  // Hands-Free Voice Control
  const handleVoiceCommand = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const runPhrase = (phrase: string) => {
      const l = phrase.toLowerCase();
      if (l.includes('stand')) {
        handleDropPinAt(hunterGps.lat, hunterGps.lng, 'Stand');
      } else if (l.includes('yes') && selectedParcel) {
        handleUpdatePermissionStatus(selectedParcel.id, 'YES');
        setVoiceToast(`Voice: Marked ${selectedParcel.ownerName} as Permission YES`);
        setTimeout(() => setVoiceToast(null), 3500);
      } else if (l.includes('night')) {
        setMapLayer((m) => (m === 'NIGHT' ? 'HYBRID' : 'NIGHT'));
        setVoiceToast('Voice: Toggled 5AM Red Night Mode');
        setTimeout(() => setVoiceToast(null), 3500);
      } else {
        handleDropPinAt(hunterGps.lat, hunterGps.lng, 'Stand');
      }
    };

    if (!SpeechRec) {
      runPhrase('drop a stand pin here');
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = 'en-US';
      setIsListeningVoice(true);
      rec.onresult = (ev: any) => {
        setIsListeningVoice(false);
        runPhrase(ev.results?.[0]?.[0]?.transcript || 'drop stand pin');
      };
      rec.onerror = () => {
        setIsListeningVoice(false);
        runPhrase('drop stand pin');
      };
      rec.start();
    } catch {
      setIsListeningVoice(false);
      runPhrase('drop stand pin');
    }
  };

  // Trail Cam AI Upload
  const handleUploadAndTagCam = async (
    file: File,
    parcelId: string,
    notes: string,
    customSpotName?: string
  ) => {
    setIsTaggingCam(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const target = allParcels.find((p) => p.id === parcelId) || allParcels[0];
      const resolvedParcelName =
        customSpotName ||
        (target ? target.ownerName.split('/')[0].trim() || target.name : 'My Kansas Cam Spot');
      const resolvedParcelId = target?.id || `spot-${Date.now()}`;

      let tagged: any = {};
      try {
        const res = await fetch('/api/ai/tag-cam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType: file.type || 'image/jpeg',
            parcelName: resolvedParcelName,
            notes,
          }),
        });
        if (res.ok) {
          tagged = await res.json();
        }
      } catch {
        // Offline or fallback tagging
      }
      const validSpecies: TrailCamPhoto['species'] = ['Buck', 'Doe', 'Coyote', 'Turkey', 'Hog', 'Duck'].includes(
        tagged.species
      )
        ? tagged.species
        : 'Buck';

      setTrailCams((prev) => [
        {
          id: `cam-${Date.now()}`,
          parcelId: resolvedParcelId,
          parcelName: resolvedParcelName,
          imageUrl: base64,
          species: validSpecies,
          count: Number(tagged.count) || 1,
          classification: tagged.classification || 'Trail Cam Photo Sighting',
          capturedAt: 'Just Uploaded · Today',
          daysAgo: 0,
          tempF: liveWeather?.tempF || 28,
          windDir: `${currentWind.dir} ${currentWind.speed} mph`,
          moonPhase: 'Waxing Gibbous (78%)',
          tacticalTip: tagged.tacticalTip || 'Hunt downwind pinch point on next cold front.',
          aiTagged: true,
        },
        ...prev,
      ]);
      setVoiceToast(`Uploaded trail cam photo for ${resolvedParcelName}`);
      setTimeout(() => setVoiceToast(null), 3000);
    } catch (err) {
      console.error('Tag cam failed:', err);
    } finally {
      setIsTaggingCam(false);
    }
  };

  const handleAddCustomSpot = (spot: CustomSpotInput) => {
    const id = `custom-spot-${Date.now()}`;
    const dLat = 0.0025;
    const dLng = 0.0032;
    const c = mapCenter;
    const cleanPhone = spot.phone ? spot.phone.trim() : undefined;
    const newParcel: HuntingParcel = {
      id,
      source: 'Custom Saved Spot',
      sectionCode: spot.county,
      name: `${spot.ownerName} (${spot.acres} ac)`,
      ownerName: spot.ownerName,
      ownerNameVerified: true,
      ownerEntityType: 'Individual Homestead',
      acres: spot.acres,
      landType: 'Timber / Creek',
      propertyAddress: spot.propertyAddress,
      taxMailingAddress: spot.propertyAddress,
      county: spot.county,
      parcelTaxId: id,
      livesOnLand: true,
      homesteadNote: spot.notes || 'Added by hunting crew.',
      driveMinutes: 12,
      distanceMiles: 8,
      permissionStatus: spot.permissionStatus,
      bestWindDirections: ['NW', 'N', 'W'],
      idealSpecies: ['Deer', 'Turkey', 'Coyote'],
      pressureLevel: 'Low',
      trucksSeenThisWeek: 0,
      lastHuntedSummary: spot.notes || 'Custom saved hunting spot.',
      savedOwnerPhone: cleanPhone,
      publicPhoneListing: cleanPhone,
      publicPhoneListings: cleanPhone
        ? [{ number: cleanPhone, label: spot.ownerName, source: 'Saved by Hunting Crew' }]
        : [],
      publicLinks: [],
      rings: [
        [
          { lat: c.lat + dLat, lng: c.lng - dLng },
          { lat: c.lat + dLat, lng: c.lng + dLng },
          { lat: c.lat - dLat, lng: c.lng + dLng },
          { lat: c.lat - dLat, lng: c.lng - dLng },
          { lat: c.lat + dLat, lng: c.lng - dLng },
        ],
      ],
      center: { lat: c.lat, lng: c.lng },
      terrainNotes: spot.notes || 'Custom hunting spot.',
      crewNotes: spot.notes
        ? [
            {
              id: `note-${Date.now()}`,
              author: activeHunterShortName,
              role: activeRole,
              timestamp: 'Just now',
              text: spot.notes,
              tag: 'Access Rule',
            },
          ]
        : [],
      leaseMessages: [],
    };
    setCrewParcels((prev) => [newParcel, ...prev]);
    if (cleanPhone) {
      fetch('/api/ai/save-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerName: spot.ownerName,
          county: spot.county,
          propertyAddress: spot.propertyAddress,
          phone: cleanPhone,
        }),
      }).catch(() => {});
    }
    appendAudit(`Added Custom Hunting Spot (${spot.ownerName})`, id);
    setVoiceToast(`Added spot: ${spot.ownerName}`);
    setTimeout(() => setVoiceToast(null), 3000);
  };

  const handleDeleteSpot = (parcelId: string) => {
    setCrewParcels((prev) => prev.filter((p) => p.id !== parcelId));
    setLiveGisParcels((prev) => prev.filter((p) => p.id !== parcelId));
    setParcelOverrides((prev) => {
      const next = { ...prev };
      delete next[parcelId];
      return next;
    });
    setDeletedParcelIds((prev) => (prev.includes(parcelId) ? prev : [...prev, parcelId]));
    if (selectedParcelId === parcelId) {
      setSelectedParcelId(null);
    }
    setVoiceToast('Removed spot from your list');
    setTimeout(() => setVoiceToast(null), 2500);
  };

  const handleAddManualCamEntry = (entry: Omit<TrailCamPhoto, 'id'>) => {
    setTrailCams((prev) => [{ id: `cam-${Date.now()}`, ...entry }, ...prev]);
    setVoiceToast(`Added trail cam entry for ${entry.parcelName}`);
    setTimeout(() => setVoiceToast(null), 2800);
  };

  const handleDeleteTrailCam = (camId: string) => {
    setTrailCams((prev) => prev.filter((c) => c.id !== camId));
    setVoiceToast('Deleted trail cam entry');
    setTimeout(() => setVoiceToast(null), 2500);
  };

  const handleAddFieldPinFromCamPage = (pinInput: {
    label: string;
    category: PinCategory;
    parcelId: string;
    windIdeal?: string;
    notes?: string;
  }) => {
    const targetP = allParcels.find((p) => p.id === pinInput.parcelId);
    const coords = targetP?.center || mapCenter;
    const newPin: FieldPin = {
      id: `pin-${Date.now()}`,
      parcelId: pinInput.parcelId,
      category: pinInput.category,
      label: pinInput.label,
      lat: coords.lat,
      lng: coords.lng,
      createdBy: activeHunterShortName,
      createdAt: 'Just now',
      windIdeal: pinInput.windIdeal || currentWind.dir,
      notes: pinInput.notes || `${pinInput.category} pin`,
      synced: !isOfflineMode,
    };
    setPins((prev) => [newPin, ...prev]);
    setVoiceToast(`Added ${pinInput.category}: ${pinInput.label}`);
    setTimeout(() => setVoiceToast(null), 2800);
  };

  const handleDeleteFieldPin = (pinId: string) => {
    setPins((prev) => prev.filter((p) => p.id !== pinId));
    setVoiceToast('Deleted pin');
    setTimeout(() => setVoiceToast(null), 2500);
  };

  const handleDownloadOfflineCounty = async () => {
    if (downloadProgress !== null) return;
    setDownloadProgress(10);

    try {
      // 1. Snapshot live GIS parcels + pins + weather into localStorage
      try {
        localStorage.setItem(
          'sectionline_ks_live_cache_v1',
          JSON.stringify(liveGisParcels.slice(0, 160))
        );
        localStorage.setItem('sectionline_ks_pins_v2', JSON.stringify(pins));
      } catch {
        // Ignore storage quota errors
      }
      setDownloadProgress(25);

      // 2. Build Esri Satellite + Roads + Boundaries tile URLs for a 3x3 field grid at z14 & z15
      const latLngToTile = (lat: number, lng: number, z: number) => {
        const n = 2 ** z;
        const x = Math.floor(((lng + 180) / 360) * n);
        const latRad = (lat * Math.PI) / 180;
        const y = Math.floor(
          ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
        );
        return { x, y };
      };

      const urlsToCache: string[] = [
        `/api/ks-weather?lat=${mapCenter.lat.toFixed(4)}&lng=${mapCenter.lng.toFixed(4)}`,
      ];

      for (const z of [14, 15]) {
        const centerTile = latLngToTile(mapCenter.lat, mapCenter.lng, z);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const tx = centerTile.x + dx;
            const ty = centerTile.y + dy;
            urlsToCache.push(
              `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`
            );
            urlsToCache.push(
              `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${ty}/${tx}`
            );
          }
        }
      }

      let storedCount = 0;
      if (typeof window !== 'undefined' && 'caches' in window) {
        const tileCache = await caches.open('ks-offline-tiles-v1');
        const chunkSize = 6;
        for (let i = 0; i < urlsToCache.length; i += chunkSize) {
          const chunk = urlsToCache.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async (u) => {
              try {
                const resp = await fetch(u, { mode: u.startsWith('/') ? 'same-origin' : 'cors' });
                if (resp.ok || resp.type === 'opaque') {
                  await tileCache.put(u, resp.clone());
                  storedCount++;
                }
              } catch {
                // Skip individual tile failure gracefully
              }
            })
          );
          const pct = Math.min(95, 25 + Math.round(((i + chunk.length) / urlsToCache.length) * 70));
          setDownloadProgress(pct);
        }
      }

      const finalTileCount = Math.max(storedCount, cachedTileCount || 0);
      setCachedTileCount(finalTileCount);
      try {
        localStorage.setItem('sectionline_ks_cached_tiles_v1', String(finalTileCount));
      } catch {
        // Ignore storage error
      }
      setIsOfflineDownloaded(true);
      setDownloadProgress(100);
      setVoiceToast(
        `Offline Field Pack cached (${finalTileCount} tiles + ${allParcels.length} KS parcels ready)`
      );
      setTimeout(() => setVoiceToast(null), 4000);
    } finally {
      setTimeout(() => setDownloadProgress(null), 450);
    }
  };

  const handleToggleOfflineMode = () => {
    setIsOfflineMode((prev) => {
      const next = !prev;
      if (!next && pendingSyncCount > 0) {
        setPins((all) => all.map((pin) => ({ ...pin, synced: true })));
        setPendingSyncCount(0);
      }
      return next;
    });
  };

  const handleExportCloudBackup = () => {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), crewParcels, pins, trailCams, harvestLogs, auditLogs }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sectionline-ks-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const jumpToParcelOnMap = (parcelId: string) => {
    const target = allParcels.find((p) => p.id === parcelId);
    if (target) {
      setMapCenter(target.center);
      setMapZoom(15);
      setSelectedParcelId(target.id);
    }
    setActiveTab('MAP');
  };

  if (!authReady) {
    return (
      <div className="h-dvh w-screen bg-[#0c0f0a] text-[#f4f1ea] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#ea580c] flex items-center justify-center shadow-lg">
            <Crosshair className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div className="font-display text-xl font-bold">SECTIONLINE KS</div>
          <div className="text-xs text-[#b7ad96] flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#f97316]" />
            <span>Checking saved hunter session...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!firebaseUser || requireFreshInstallAuth) {
    return (
      <AuthScreen
        onAuthenticated={(user, profile) => {
          try {
            localStorage.setItem(STANDALONE_AUTHED_KEY, '1');
            const url = new URL(window.location.href);
            if (url.searchParams.has('install') || url.searchParams.has('download') || url.searchParams.has('login')) {
              url.searchParams.delete('install');
              url.searchParams.delete('download');
              url.searchParams.delete('login');
              window.history.replaceState({}, '', url.pathname + url.search + url.hash);
            }
          } catch {
            // Ignore URL/storage errors
          }
          setRequireFreshInstallAuth(false);
          setFirebaseUser(user);
          setHunterProfile(profile);
        }}
      />
    );
  }

  return (
    <div className="h-dvh w-screen flex flex-col bg-[#0c0f0a] text-[#f4f1ea] overflow-hidden relative">
      {/* MANDATORY DEMO KEY QUOTA EXCEEDED BANNER (Case A Google Maps Platform Skill) */}
      {quotaExceeded && (
        <div className="bg-[#2a1b10] border-b border-[#ea580c]/50 text-[#ffedd5] px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-[#fb923c] hover:text-white"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* NON-BLOCKING BILLING FALLBACK NOTICE (Active Esri Satellite + Regrid KS Property Lines) */}
      {mapsBillingError && !quotaExceeded && !billingBannerDismissed && (
        <div className="bg-[#182014] border-b border-[#34422c] text-[#e6e0d2] px-4 py-2 text-xs flex flex-wrap items-center justify-center gap-x-3 gap-y-1 sticky top-0 z-50 shadow-sm">
          <span>
            Using high-res Satellite + All-105-County Kansas Property Lines.{' '}
            <a
              href="https://console.cloud.google.com/project/_/billing/enable"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-[#f97316] hover:text-[#fb923c]"
            >
              Enable Google Maps Billing
            </a>
          </span>
          <button
            type="button"
            onClick={() => setBillingBannerDismissed(true)}
            className="px-2.5 py-0.5 rounded-lg bg-[#26321f] hover:bg-[#33422a] text-[#f4f1ea] text-[11px] font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* MAIN FULL-SCREEN VIEWPORT */}
      <main className="relative flex-1 min-h-0 w-full overflow-hidden">
        {activeTab === 'MAP' ? (
          <>
            {/* UNIVERSAL KANSAS SEARCH BAR + HUNTER ACCOUNT CHIP (ROW 1) */}
            <KansasUniversalSearch
              localParcels={allParcels}
              mapCenter={mapCenter}
              onSelectResult={handleSelectSearchResult}
              onVoiceCommand={handleVoiceCommand}
              isListeningVoice={isListeningVoice}
              activeTownInfo={activeTownInfo}
              onCloseTownInfo={() => setActiveTownInfo(null)}
              onZoomToPropertyLines={(coords) => {
                setMapCenter(coords);
                setMapZoom(16);
                setActiveTownInfo(null);
                setVoiceToast('Zoomed to z16 — All Kansas property lines active');
                setTimeout(() => setVoiceToast(null), 3000);
              }}
              hunterShortName={activeHunterShortName}
              hunterFullName={activeHunterName}
              onOpenAccountModal={openAccountModal}
            />

            {/* Toast Notification */}
            {voiceToast && (
              <div className="absolute top-[124px] left-1/2 -translate-x-1/2 z-40 bg-[#172512]/95 border border-[#65a30d] text-[#ecfccb] px-4 py-2 rounded-full text-xs font-semibold shadow-2xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#84cc16] shrink-0" />
                <span>{voiceToast}</span>
              </div>
            )}

            {/* GOOGLE MAPS API PROVIDER (Primary) WITH SEAMLESS ESRI+REGRID KANSAS GIS FALLBACK */}
            {mapsApiKey && !mapsBillingError ? (
              <APIProvider apiKey={mapsApiKey} language="en" region="US" libraries={['marker']}>
                <KansasGoogleMap
                  parcels={allParcels}
                  selectedParcelId={selectedParcelId}
                  onSelectParcel={handleSelectParcel}
                  mapCenter={mapCenter}
                  mapZoom={mapZoom}
                  onCameraChange={handleCameraChange}
                  mapLayer={mapLayer}
                  onChangeMapLayer={setMapLayer}
                  is3DTilt={is3DTilt}
                  onToggle3DTilt={() => setIs3DTilt((v) => !v)}
                  windDir={currentWind.dir}
                  windSpeedMph={currentWind.speed}
                  onCycleWind={() =>
                    setManualWindOverrideIdx((idx) =>
                      idx === null ? 0 : idx + 1 >= WIND_SEQUENCE.length ? null : idx + 1
                    )
                  }
                  weatherTempF={liveWeather?.tempF ?? null}
                  legalLightWindow={liveWeather?.legalShootingLight ?? null}
                  cachedTileCount={cachedTileCount}
                  hunterGps={hunterGps}
                  onMoveHunterGps={setHunterGps}
                  isTrespassingRed={isTrespassingRed}
                  distanceToNearestLineFt={distanceToNearestLineFt}
                  pins={pins}
                  activePinCategoryToDrop={activePinCategoryToDrop}
                  onSetPinCategoryToDrop={setActivePinCategoryToDrop}
                  onDropPinAt={handleDropPinAt}
                  escoutReports={escoutReports}
                  crewMembers={crewMembers}
                  showCrewGps={showCrewGps}
                  onToggleCrewGps={() => setShowCrewGps((v) => !v)}
                  isOfflineDownloaded={isOfflineDownloaded}
                  isOfflineMode={isOfflineMode}
                  onDownloadOfflineCounty={handleDownloadOfflineCounty}
                  onToggleOfflineMode={handleToggleOfflineMode}
                  downloadProgress={downloadProgress}
                  pendingSyncCount={pendingSyncCount}
                  isLoadingParcels={isLoadingParcels}
                  gisSourcesActive={gisSourcesActive}
                  streetViewCoords={streetViewCoords}
                  onOpenStreetView={setStreetViewCoords}
                  onCloseStreetView={() => setStreetViewCoords(null)}
                  onJumpToRegion={(center, zoom) => {
                    setMapCenter(center);
                    setMapZoom(zoom);
                  }}
                  onInspectCoordinate={handleInspectCoordinate}
                  inspectingCoords={inspectingCoords}
                  isInspectingPoint={isInspectingPoint}
                />
              </APIProvider>
            ) : mapsBillingError || mapsKeyLoaded ? (
              <KansasFallbackMap
                parcels={allParcels}
                selectedParcelId={selectedParcelId}
                onSelectParcel={handleSelectParcel}
                mapCenter={mapCenter}
                mapZoom={mapZoom}
                onCameraChange={handleCameraChange}
                mapLayer={mapLayer}
                onChangeMapLayer={setMapLayer}
                is3DTilt={is3DTilt}
                onToggle3DTilt={() => setIs3DTilt((v) => !v)}
                windDir={currentWind.dir}
                windSpeedMph={currentWind.speed}
                onCycleWind={() =>
                  setManualWindOverrideIdx((idx) =>
                    idx === null ? 0 : idx + 1 >= WIND_SEQUENCE.length ? null : idx + 1
                  )
                }
                weatherTempF={liveWeather?.tempF ?? null}
                legalLightWindow={liveWeather?.legalShootingLight ?? null}
                cachedTileCount={cachedTileCount}
                hunterGps={hunterGps}
                onMoveHunterGps={setHunterGps}
                isTrespassingRed={isTrespassingRed}
                distanceToNearestLineFt={distanceToNearestLineFt}
                pins={pins}
                activePinCategoryToDrop={activePinCategoryToDrop}
                onSetPinCategoryToDrop={setActivePinCategoryToDrop}
                onDropPinAt={handleDropPinAt}
                escoutReports={escoutReports}
                crewMembers={crewMembers}
                showCrewGps={showCrewGps}
                onToggleCrewGps={() => setShowCrewGps((v) => !v)}
                isOfflineDownloaded={isOfflineDownloaded}
                isOfflineMode={isOfflineMode}
                onDownloadOfflineCounty={handleDownloadOfflineCounty}
                onToggleOfflineMode={handleToggleOfflineMode}
                downloadProgress={downloadProgress}
                pendingSyncCount={pendingSyncCount}
                isLoadingParcels={isLoadingParcels}
                gisSourcesActive={gisSourcesActive}
                onJumpToRegion={(center, zoom) => {
                  setMapCenter(center);
                  setMapZoom(zoom);
                }}
                onInspectCoordinate={handleInspectCoordinate}
                inspectingCoords={inspectingCoords}
                isInspectingPoint={isInspectingPoint}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#0c0f0a] p-6 text-center">
                <div className="max-w-md space-y-2">
                  <h2 className="font-display text-2xl font-bold text-[#f4f1ea]">
                    Loading Kansas Hunting Map...
                  </h2>
                  <p className="text-xs text-[#b7ad96]">
                    Connecting to satellite imagery &amp; Kansas GIS parcel layers...
                  </p>
                </div>
              </div>
            )}

            {/* STREET VIEW EXTERNAL MODAL WHEN GOOGLE MAPS JS BILLING IS INACTIVE */}
            {mapsBillingError && streetViewCoords && (
              <div className="fixed inset-0 z-[600] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="w-full max-w-md bg-[#131810] border border-[#34422c] rounded-3xl p-5 shadow-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-xl font-bold text-[#f4f1ea]">
                      Gate &amp; Road Street View
                    </h3>
                    <button
                      type="button"
                      onClick={() => setStreetViewCoords(null)}
                      className="w-9 h-9 rounded-full bg-[#1d2518] hover:bg-[#2a3623] text-[#d6cebc] flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-[#d6cebc]">
                    Open Google Street View directly for{' '}
                    <span className="font-mono text-[#f97316]">
                      {streetViewCoords.lat.toFixed(5)}° N, {streetViewCoords.lng.toFixed(5)}° W
                    </span>{' '}
                    to inspect the farm entrance, mailbox, and road access.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setStreetViewCoords(null)}
                      className="px-4 py-2 rounded-xl bg-[#1d2518] hover:bg-[#2a3623] text-xs font-semibold text-[#e6e0d2]"
                    >
                      Close
                    </button>
                    <a
                      href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${streetViewCoords.lat},${streetViewCoords.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setStreetViewCoords(null)}
                      className="px-4 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white text-xs font-bold"
                    >
                      Open Street View
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE-UP BOTTOM OWNER CARD (Instant OnX-style drawer when you tap ANY parcel!) */}
            <OwnerCardSheet
              parcel={selectedParcel}
              pins={pins}
              onClose={() => {
                setSelectedParcelId(null);
                setInspectingCoords(null);
              }}
              onUpdatePermissionStatus={handleUpdatePermissionStatus}
              onLogKnockVisit={handleLogKnockVisit}
              onAddCrewNote={handleAddCrewNote}
              onSendLeaseMessage={handleSendLeaseMessage}
              onCreatePermissionSlip={handleCreatePermissionSlip}
              onIncrementTrucksSeen={handleIncrementTrucksSeen}
              onRunEScout={handleRunEScout}
              isEScoutLoading={isEScoutLoading}
              onOpenStreetView={setStreetViewCoords}
              onOpenWardenSlip={(p) => setWardenSlipParcelId(p.id)}
              hidePhonesForCrewPrivacy={hidePhonesForCrewPrivacy}
              onToggleHidePhones={() => setHidePhonesForCrewPrivacy((v) => !v)}
              publicIntel={selectedParcel ? publicIntelByParcel[selectedParcel.id] : undefined}
              isSearchingPublicIntel={isSearchingPublicIntel}
              onSearchPublicIntel={handleSearchPublicIntel}
              onSaveOwnerPhone={handleSaveOwnerPhone}
              onUpdateOwnerDetails={handleUpdateOwnerDetails}
              hunterName={activeHunterName}
              hunterPhone={activeHunterPhone}
            />
          </>
        ) : (
          <div className="w-full h-full overflow-y-auto touch-scroll-y bg-[#0c0f0a] pb-24">
            {activeTab === 'PERMISSIONS' && (
              <PermissionsBlackBookView
                parcels={allParcels}
                pins={pins}
                onSelectParcelOnMap={jumpToParcelOnMap}
                onOpenWardenSlip={(p) => setWardenSlipParcelId(p.id)}
                onMarkThankYouSent={(parcelId) =>
                  updateParcelField(parcelId, (p) =>
                    p.permissionSlip
                      ? { permissionSlip: { ...p.permissionSlip, thankYouSent: true } }
                      : {}
                  )
                }
                onSendLeaseMessage={handleSendLeaseMessage}
                onBatchScanAllPhones={() => handleBatchPhoneScan(allParcels)}
                isBatchScanningPhones={isBatchScanningPhones}
                onSearchSingleOwnerPhones={(p) => handleSearchPublicIntel(p)}
                isSearchingSingleOwner={isSearchingPublicIntel}
                onSaveOwnerPhone={handleSaveOwnerPhone}
                onAddCustomSpot={handleAddCustomSpot}
                onDeleteSpot={handleDeleteSpot}
                onUpdatePermissionStatus={handleUpdatePermissionStatus}
                hidePhonesForCrewPrivacy={hidePhonesForCrewPrivacy}
                publicIntelByParcel={publicIntelByParcel}
                hunterName={activeHunterName}
                hunterPhone={activeHunterPhone}
              />
            )}

            {activeTab === 'PHONEBOOK' && (
              <KansasPhoneBookView
                parcels={allParcels}
                publicIntelByParcel={publicIntelByParcel}
                mapCenter={mapCenter}
                hunterName={activeHunterName}
                isOfflineMode={isOfflineMode}
                onSelectParcelOnMap={(p) => {
                  setCrewParcels((prev) =>
                    prev.some((existing) => existing.id === p.id) ? prev : [p, ...prev]
                  );
                  jumpToParcelOnMap(p.id);
                }}
                onFlyToAddressCoords={(lat, lng, addressLabel) => {
                  setActiveTab('MAP');
                  setMapCenter({ lat, lng });
                  setMapZoom(17);
                  setVoiceToast(`Flying to ${addressLabel}`);
                  setTimeout(() => setVoiceToast(null), 3000);
                }}
                onSavePhoneForOwner={(ownerName, county, propertyAddress, phone, parcelId) => {
                  if (parcelId) {
                    handleSaveOwnerPhone(parcelId, phone);
                  } else {
                    fetch('/api/ai/save-phone', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        ownerName,
                        county,
                        propertyAddress,
                        phone,
                      }),
                    }).catch(() => {});
                  }
                }}
              />
            )}

            {activeTab === 'SCOUTING' && (
              <ScoutingAndCamsView
                trailCams={trailCams}
                parcels={allParcels}
                pins={pins}
                onUploadAndTagCam={handleUploadAndTagCam}
                onAddManualCamEntry={handleAddManualCamEntry}
                onDeleteTrailCam={handleDeleteTrailCam}
                onAddCustomSpot={handleAddCustomSpot}
                onDeleteSpot={handleDeleteSpot}
                onAddFieldPin={handleAddFieldPinFromCamPage}
                onDeleteFieldPin={handleDeleteFieldPin}
                onSelectParcelOnMap={jumpToParcelOnMap}
                isTaggingCam={isTaggingCam}
                weather={liveWeather}
              />
            )}

            {(activeTab === 'CREW' || activeTab === 'LEGAL') && (
              <div className="camo-header sticky top-0 z-20 border-b border-[#2d3826] px-4 py-3.5">
                <div className="max-w-3xl mx-auto space-y-2.5">
                  <h1 className="font-display text-2xl font-bold text-[#f4f1ea] leading-none">
                    CREW &amp; FIELD SAFETY
                  </h1>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[#0e120b]/90 border border-[#2d3826]">
                    <button
                      type="button"
                      onClick={() => setActiveTab('LEGAL')}
                      className={`py-2 rounded-xl text-xs font-bold transition-colors ${
                        activeTab === 'LEGAL'
                          ? 'bg-[#ea580c] text-white'
                          : 'text-[#b7ad96] hover:text-[#f4f1ea]'
                      }`}
                    >
                      SOS, Rules &amp; Harvest
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('CREW')}
                      className={`py-2 rounded-xl text-xs font-bold transition-colors ${
                        activeTab === 'CREW'
                          ? 'bg-[#ea580c] text-white'
                          : 'text-[#b7ad96] hover:text-[#f4f1ea]'
                      }`}
                    >
                      Crew Tasks &amp; Board
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'CREW' && (
              <CrewAndEnterpriseView
                crewMembers={crewMembers}
                tasks={tasks}
                onToggleTask={(taskId) =>
                  setTasks((prev) =>
                    prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
                  )
                }
                onAddTask={(assignee, actionType, parcelId) => {
                  const p = allParcels.find((item) => item.id === parcelId) || allParcels[0];
                  setTasks((prev) => [
                    {
                      id: `task-${Date.now()}`,
                      assignee,
                      actionType,
                      parcelId: p.id,
                      parcelName: `${p.ownerName.split('/')[0].trim()} (${p.acres.toFixed(1)} ac)`,
                      dueLabel: 'Assigned Today',
                      completed: false,
                    },
                    ...prev,
                  ]);
                }}
                parcels={allParcels}
                auditLogs={auditLogs}
                activeRole={activeRole}
                onChangeRole={setActiveRole}
                onExportCloudBackup={handleExportCloudBackup}
                loggedInHunter={{
                  displayName: activeHunterName,
                  email: firebaseUser.email || '',
                  phone: activeHunterPhone || undefined,
                }}
                onOpenAccountModal={openAccountModal}
                onSignOut={handleSignOut}
              />
            )}

            {activeTab === 'LEGAL' && (
              <LegalAndSafetyView
                parcels={allParcels}
                harvestLogs={harvestLogs}
                onAddHarvestLog={(rec) =>
                  setHarvestLogs((prev) => [{ id: `harv-${Date.now()}`, ...rec }, ...prev])
                }
                onSendEmergencySos={() => setSosTriggeredAt(new Date().toLocaleTimeString())}
                sosTriggeredAt={sosTriggeredAt}
                hunterName={activeHunterName}
              />
            )}
          </div>
        )}
      </main>

      {/* NATIVE CAMO HUNTING APP BOTTOM NAVIGATION DOCK */}
      <nav className="camo-dock z-40 h-[68px] border-t border-[#2d3826] px-1.5 flex items-center justify-around shrink-0">
        <button
          onClick={() => setActiveTab('MAP')}
          className={`flex flex-col items-center justify-center min-w-[52px] h-12 rounded-2xl transition-colors ${
            activeTab === 'MAP' ? 'text-[#f97316]' : 'text-[#9c927d] hover:text-[#f4f1ea]'
          }`}
        >
          <MapIcon className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Map</span>
        </button>

        <button
          onClick={() => setActiveTab('PERMISSIONS')}
          className={`relative flex flex-col items-center justify-center min-w-[56px] h-12 rounded-2xl transition-colors ${
            activeTab === 'PERMISSIONS' ? 'text-[#f97316]' : 'text-[#9c927d] hover:text-[#f4f1ea]'
          }`}
        >
          <FileCheck2 className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">My Spots</span>
          {(() => {
            const phoneReadyCount = allParcels.filter(
              (p) =>
                p.permissionStatus !== 'NO_GO' &&
                p.permissionStatus !== 'PUBLIC' &&
                Boolean(
                  p.savedOwnerPhone ||
                    p.publicPhoneListing ||
                    p.publicPhoneListings?.length ||
                    publicIntelByParcel[p.id]?.publicPhones?.length
                )
            ).length;
            if (!phoneReadyCount) return null;
            return (
              <span className="absolute -top-0.5 right-0 px-1.5 py-0.5 rounded-full bg-[#3f7d20] border border-[#84cc16] text-[9px] font-mono font-bold text-white leading-none">
                {phoneReadyCount}#
              </span>
            );
          })()}
        </button>

        <button
          onClick={() => setActiveTab('PHONEBOOK')}
          className={`flex flex-col items-center justify-center min-w-[62px] h-12 rounded-2xl transition-colors ${
            activeTab === 'PHONEBOOK' ? 'text-[#f97316]' : 'text-[#9c927d] hover:text-[#f4f1ea]'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Phone Book</span>
        </button>

        {/* CENTER BLAZE ORANGE HUNT BUTTON */}
        <button
          onClick={() => setIsHuntTodayOpen(true)}
          className="px-4 h-11 rounded-full bg-[#ea580c] hover:bg-[#f97316] text-white font-display font-bold text-sm tracking-wide flex items-center gap-1 shadow-[0_4px_20px_rgba(234,88,12,0.4)] border border-[#fb923c]/60 active:scale-95 transition-transform whitespace-nowrap"
        >
          <Crosshair className="w-4 h-4" />
          <span>HUNT</span>
        </button>

        <button
          onClick={() => setActiveTab('SCOUTING')}
          className={`flex flex-col items-center justify-center min-w-[50px] h-12 rounded-2xl transition-colors ${
            activeTab === 'SCOUTING' ? 'text-[#f97316]' : 'text-[#9c927d] hover:text-[#f4f1ea]'
          }`}
        >
          <Camera className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Scout</span>
        </button>

        <button
          onClick={() => setActiveTab(activeTab === 'LEGAL' ? 'CREW' : 'LEGAL')}
          className={`flex flex-col items-center justify-center min-w-[50px] h-12 rounded-2xl transition-colors ${
            activeTab === 'LEGAL' || activeTab === 'CREW'
              ? 'text-[#f97316]'
              : 'text-[#9c927d] hover:text-[#f4f1ea]'
          }`}
        >
          <Shield className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Crew</span>
        </button>
      </nav>

      {/* HUNT TODAY TOP 5 SPOTS MODAL */}
      <HuntTodayModal
        isOpen={isHuntTodayOpen}
        onClose={() => setIsHuntTodayOpen(false)}
        parcels={allParcels}
        pins={pins}
        weather={liveWeather}
        currentWindDir={currentWind.dir}
        currentWindSpeedMph={currentWind.speed}
        onSelectSpotOnMap={jumpToParcelOnMap}
        onDownloadOfflineCounty={handleDownloadOfflineCounty}
        isOfflineDownloaded={isOfflineDownloaded}
        onStartKnockRoute={jumpToParcelOnMap}
        hunterName={activeHunterName}
      />

      {/* PRINTABLE / SHAREABLE GAME WARDEN PERMISSION SLIP MODAL */}
      <WardenSlipModal
        parcel={wardenSlipParcelId ? allParcels.find((p) => p.id === wardenSlipParcelId) || null : null}
        pins={pins}
        hidePhonesForCrewPrivacy={hidePhonesForCrewPrivacy}
        hunterName={activeHunterName}
        onClose={() => setWardenSlipParcelId(null)}
      />

      {/* HUNTER ACCOUNT PROFILE / SWITCHER MODAL */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-[760] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#131810] border border-[#34422c] rounded-3xl overflow-hidden shadow-2xl">
            <div className="camo-header px-5 py-3.5 border-b border-[#2d3826] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-[#84cc16]" />
                <div>
                  <h2 className="font-display text-lg font-bold text-[#f4f1ea] leading-none">
                    HUNTER ACCOUNT
                  </h2>
                  <p className="text-[11px] font-mono text-[#b7ad96] mt-0.5 truncate max-w-[230px]">
                    {firebaseUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                aria-label="Close Account Settings"
                className="w-9 h-9 rounded-full bg-[#1d2518] hover:bg-[#2a3623] border border-[#3a4931] text-[#d6cebc] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="p-5 space-y-3 text-xs">
              {profileError && (
                <div className="p-2.5 rounded-xl bg-[#29170f] border border-[#ea580c] text-[#ffedd5]">
                  {profileError}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-mono uppercase tracking-wider text-[#b7ad96] block">
                  Your Full Name (Shown in SMS Texts &amp; Letters)
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={profileNameDraft}
                  onChange={(e) => setProfileNameDraft(e.target.value)}
                  className="w-full rounded-xl bg-[#0c0f0a] border border-[#34422c] px-3 py-2.5 text-sm text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono uppercase tracking-wider text-[#b7ad96] block">
                  Callback Phone (Optional)
                </label>
                <input
                  type="tel"
                  maxLength={32}
                  value={profilePhoneDraft}
                  onChange={(e) => setProfilePhoneDraft(e.target.value)}
                  placeholder="(316) 555-0142"
                  className="w-full rounded-xl bg-[#0c0f0a] border border-[#34422c] px-3 py-2.5 text-sm font-mono text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] disabled:opacity-60 text-white font-bold flex items-center justify-center gap-1.5"
                >
                  {isSavingProfile && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Name</span>
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="py-2.5 px-4 rounded-xl bg-[#2a1a12] hover:bg-[#3a2318] border border-[#5e3819] text-[#ffedd5] font-bold flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5 text-[#f97316]" />
                  <span>Sign Out</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
