import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  CheckCircle2,
  ExternalLink,
  Home,
  Loader2,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Plus,
  Search,
  Sparkles,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { HuntingParcel, OwnerPublicIntel, PhoneBookEntry, PublicPhoneMatch } from '../types/hunting';
import { buildPermissionSmsHref, formatPhoneDigits } from '../utils/phoneUtils';

function formatDisplayPhone(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '').slice(-10);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

interface KansasPhoneBookViewProps {
  parcels: HuntingParcel[];
  publicIntelByParcel: Record<string, OwnerPublicIntel>;
  mapCenter: { lat: number; lng: number };
  hunterName?: string;
  isOfflineMode?: boolean;
  onSelectParcelOnMap: (parcel: HuntingParcel) => void;
  onFlyToAddressCoords: (lat: number, lng: number, addressLabel: string) => void;
  onSavePhoneForOwner: (ownerName: string, county: string, propertyAddress: string, phone: string, parcelId?: string) => void;
}

type FilterMode = 'ALL' | 'STREET_ONLY' | 'WITH_PHONE';

export const KansasPhoneBookView: React.FC<KansasPhoneBookViewProps> = ({
  parcels,
  publicIntelByParcel,
  mapCenter,
  hunterName,
  isOfflineMode = false,
  onSelectParcelOnMap,
  onFlyToAddressCoords,
  onSavePhoneForOwner,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
  const [directoryEntries, setDirectoryEntries] = useState<PhoneBookEntry[]>(() => {
    try {
      localStorage.removeItem('sectionline_ks_phonebook_cache_v1');
      const raw = localStorage.getItem('sectionline_ks_phonebook_cache_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage error
    }
    return [];
  });
  const [liveSearchEntries, setLiveSearchEntries] = useState<PhoneBookEntry[]>([]);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState<boolean>(false);
  const [isSearchingAddress, setIsSearchingAddress] = useState<boolean>(false);
  const [scanningEntryId, setScanningEntryId] = useState<string | null>(null);
  const [addingPhoneEntryId, setAddingPhoneEntryId] = useState<string | null>(null);
  const [manualPhoneDraft, setManualPhoneDraft] = useState<string>('');

  // Load full verified Kansas phone directory on mount and cache to localStorage for offline use
  useEffect(() => {
    if (isOfflineMode) return;
    let cancelled = false;
    setIsLoadingDirectory(true);
    fetch('/api/ks-phonebook/directory')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.entries)) return;
        setDirectoryEntries(data.entries);
        try {
          localStorage.setItem(
            'sectionline_ks_phonebook_cache_v2',
            JSON.stringify(data.entries.slice(0, 400))
          );
        } catch {
          // Ignore quota error
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingDirectory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOfflineMode]);

  // Run live statewide reverse street address & owner lookup when user types >= 2 chars
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setLiveSearchEntries([]);
      setIsSearchingAddress(false);
      return;
    }
    if (isOfflineMode) {
      setLiveSearchEntries([]);
      return;
    }

    let cancelled = false;
    setIsSearchingAddress(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q,
          lat: String(mapCenter.lat),
          lng: String(mapCenter.lng),
        });
        const res = await fetch(`/api/ks-phonebook/search?${params.toString()}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.entries)) {
            setLiveSearchEntries(data.entries);
          }
        }
      } catch {
        // Offline or network error falls back to local directory + map parcels
      } finally {
        if (!cancelled) setIsSearchingAddress(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, mapCenter.lat, mapCenter.lng, isOfflineMode]);

  // Convert currently loaded map parcels into PhoneBookEntry items so offline/viewport parcels are always searchable by street address
  const localParcelEntries = useMemo<PhoneBookEntry[]>(() => {
    const out: PhoneBookEntry[] = [];
    for (const p of parcels) {
      if (p.permissionStatus === 'PUBLIC') continue;
      if (!p.ownerName || /^(Private|Section \d+|Unknown)/i.test(p.ownerName)) continue;

      const intel = publicIntelByParcel[p.id];
      const phones: PublicPhoneMatch[] = [];
      const seenDigits = new Set<string>();
      const pushPh = (num?: string, label?: string, source?: string) => {
        if (!num) return;
        const d = num.replace(/\D/g, '').slice(-10);
        if (d.length !== 10 || seenDigits.has(d)) return;
        seenDigits.add(d);
        phones.push({
          number: formatDisplayPhone(num),
          label: label || p.ownerName,
          source: source || p.phoneSourceCitation || 'Verified Listing',
        });
      };

      if (p.savedOwnerPhone) pushPh(p.savedOwnerPhone, 'Saved Owner Phone', 'Crew Saved');
      if (Array.isArray(p.savedAdditionalPhones)) {
        for (const extra of p.savedAdditionalPhones) pushPh(extra, 'Saved Phone', 'Crew Saved');
      }
      if (Array.isArray(p.publicPhoneListings)) {
        for (const ph of p.publicPhoneListings) pushPh(ph.number, ph.label, ph.source);
      }
      if (p.publicPhoneListing) pushPh(p.publicPhoneListing, p.ownerName, p.phoneSourceCitation);
      if (Array.isArray(intel?.publicPhones)) {
        for (const ph of intel.publicPhones) pushPh(ph.number, ph.label, ph.source);
      }

      const cleanMail = String(p.taxMailingAddress || '').replace(/^Attn:[^,\n]+,?\s*/i, '').trim();
      const streetAddress =
        p.propertyAddress && !/SEE LINK|TAX ROLL|TAP PARCEL/i.test(p.propertyAddress)
          ? p.propertyAddress
          : cleanMail && !/SEE LINK|TAX ROLL|TAP PARCEL/i.test(cleanMail)
          ? cleanMail
          : 'Rural Kansas Parcel (No Street #)';

      const cleanAddrForUrl = streetAddress.replace(/,\s*(?:KS|KANSAS).*$/i, '').trim();
      const addrSlug = cleanAddrForUrl.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      out.push({
        id: `local-${p.id}`,
        streetAddress,
        mailingAddress:
          cleanMail && cleanMail.toUpperCase() !== streetAddress.toUpperCase() ? cleanMail : undefined,
        county: p.county,
        ownerName: p.ownerName,
        displayOwnerName: p.ownerName,
        associatedPeople: [p.ownerName],
        phones,
        acres: p.acres,
        sectionCode: p.sectionCode,
        parcelId: p.id,
        lat: p.center.lat,
        lng: p.center.lng,
        livesOnLand: p.livesOnLand,
        source: p.source || 'Loaded Map Parcel',
        parcel: p,
        reverseLookupLinks:
          /\d/.test(cleanAddrForUrl) && !/Rural Kansas/i.test(cleanAddrForUrl)
            ? [
                {
                  label: 'FastPeopleSearch Address',
                  url: `https://www.fastpeoplesearch.com/address/${addrSlug}_ks`,
                },
                {
                  label: 'TruePeopleSearch Address',
                  url: `https://www.truepeoplesearch.com/resultaddress?streetaddress=${encodeURIComponent(
                    cleanAddrForUrl
                  )}&citystatezip=${encodeURIComponent(p.county)}`,
                },
              ]
            : [],
      });
    }
    return out;
  }, [parcels, publicIntelByParcel]);

  // Combine live search entries + local parcel entries + cached directory entries
  const displayedEntries = useMemo<PhoneBookEntry[]>(() => {
    const q = searchQuery.trim().toUpperCase();
    const qDigits = searchQuery.replace(/\D/g, '');
    const qTokens = q
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    const matchesFilterQuery = (entry: PhoneBookEntry) => {
      if (!q) return true;
      const blob = [
        entry.streetAddress,
        entry.mailingAddress || '',
        entry.displayOwnerName,
        entry.ownerName,
        ...entry.associatedPeople,
        entry.county,
        entry.city || '',
        ...entry.phones.map((p) => p.number),
      ]
        .join(' ')
        .toUpperCase();

      const tokenHit = qTokens.length > 0 && qTokens.every((t) => blob.includes(t));
      const phoneHit =
        qDigits.length >= 3 &&
        entry.phones.some((p) => p.number.replace(/\D/g, '').includes(qDigits));
      return tokenHit || phoneHit;
    };

    const combined: PhoneBookEntry[] = [];
    const seen = new Set<string>();
    const seenIds = new Set<string>();

    const pushUnique = (entry: PhoneBookEntry) => {
      const key = `${entry.displayOwnerName.toUpperCase()}|${entry.streetAddress.toUpperCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      let uniqueId = entry.id;
      if (seenIds.has(uniqueId)) {
        uniqueId = `${entry.id}-${combined.length}`;
      }
      seenIds.add(uniqueId);
      combined.push(uniqueId === entry.id ? entry : { ...entry, id: uniqueId });
    };

    if (q.length >= 2) {
      for (const e of liveSearchEntries) pushUnique(e);
    }
    for (const e of localParcelEntries) {
      if (matchesFilterQuery(e)) pushUnique(e);
    }
    for (const e of directoryEntries) {
      if (matchesFilterQuery(e)) pushUnique(e);
    }

    return combined.filter((e) => {
      if (filterMode === 'STREET_ONLY') {
        return /^\d+\s+[A-Za-z0-9]/.test(e.streetAddress.trim());
      }
      if (filterMode === 'WITH_PHONE') {
        return e.phones.length > 0;
      }
      return true;
    });
  }, [searchQuery, liveSearchEntries, localParcelEntries, directoryEntries, filterMode]);

  const handleScanPhonesForEntry = async (entry: PhoneBookEntry) => {
    if (scanningEntryId) return;
    setScanningEntryId(entry.id);
    try {
      const res = await fetch('/api/ai/owner-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerName: entry.ownerName,
          county: entry.county,
          propertyAddress: entry.streetAddress,
          taxMailingAddress: entry.mailingAddress || entry.streetAddress,
          sectionCode: entry.sectionCode,
          acres: entry.acres,
          forceRefresh: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const foundPhones: PublicPhoneMatch[] = Array.isArray(data?.publicPhones)
          ? data.publicPhones
          : [];
        const extraNames: string[] = Array.isArray(data?.matchedListings)
          ? data.matchedListings.map((l: any) => String(l?.name || '').trim()).filter(Boolean)
          : [];

        if (foundPhones.length > 0 || extraNames.length > 0) {
          const updateList = (list: PhoneBookEntry[]) =>
            list.map((item) =>
              item.id === entry.id
                ? {
                    ...item,
                    phones: foundPhones.length > 0 ? foundPhones : item.phones,
                    associatedPeople: Array.from(
                      new Set([...item.associatedPeople, ...extraNames])
                    ).slice(0, 8),
                  }
                : item
            );
          setLiveSearchEntries(updateList);
          setDirectoryEntries(updateList);
        }
      }
    } catch {
      // Ignore network errors
    } finally {
      setScanningEntryId(null);
    }
  };

  const handleSaveManualPhone = (entry: PhoneBookEntry) => {
    const digits = manualPhoneDraft.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return;
    const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    onSavePhoneForOwner(
      entry.ownerName,
      entry.county,
      entry.streetAddress,
      formatted,
      entry.parcelId
    );
    const newPhone: PublicPhoneMatch = {
      number: formatted,
      label: entry.displayOwnerName,
      source: 'Saved by Hunting Crew',
    };
    const updateList = (list: PhoneBookEntry[]) =>
      list.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              phones: [
                newPhone,
                ...item.phones.filter((p) => p.number.replace(/\D/g, '') !== digits),
              ],
            }
          : item
      );
    setLiveSearchEntries(updateList);
    setDirectoryEntries(updateList);
    setAddingPhoneEntryId(null);
    setManualPhoneDraft('');
  };

  const totalPhonesCount = useMemo(
    () => displayedEntries.reduce((sum, e) => sum + e.phones.length, 0),
    [displayedEntries]
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      {/* HEADER & REVERSE STREET ADDRESS SEARCH BAR */}
      <div className="camo-panel rounded-2xl border border-[#34422c] p-4 space-y-3.5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#f97316]" />
              <h1 className="font-display text-2xl font-bold text-[#f4f1ea] tracking-wide">
                KANSAS ADDRESS &amp; PHONE BOOK
              </h1>
            </div>
            <p className="text-xs text-[#b7ad96] mt-0.5">
              Search any Kansas street address to pop up the landowner &amp; resident names, tax roll records, and verified phone numbers.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#11160e] border border-[#2d3826] text-xs font-mono text-[#84cc16]">
            <Phone className="w-3.5 h-3.5" />
            <span>
              {displayedEntries.length} Addresses · {totalPhonesCount} Phones
            </span>
          </div>
        </div>

        {/* STREET ADDRESS INPUT */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#f97316] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search street address (e.g. 218 E Central Ave, 15957 SW 20th) or name..."
            className="w-full rounded-xl bg-[#0b0e09] border-2 border-[#3b4a32] focus:border-[#ea580c] pl-10 pr-24 py-3 text-sm text-[#f4f1ea] placeholder-[#7f7765] focus:outline-none transition-colors"
          />
          {isSearchingAddress && (
            <div className="absolute right-10 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] font-mono text-[#f97316]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>GIS</span>
            </div>
          )}
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-[#9c927d] hover:text-[#f4f1ea] hover:bg-[#1e2619]"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* FILTER TABS */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                filterMode === 'ALL'
                  ? 'bg-[#ea580c] text-white'
                  : 'bg-[#12170f] text-[#b7ad96] border border-[#2d3826] hover:text-[#f4f1ea]'
              }`}
            >
              All ({displayedEntries.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('STREET_ONLY')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 ${
                filterMode === 'STREET_ONLY'
                  ? 'bg-[#ea580c] text-white'
                  : 'bg-[#12170f] text-[#b7ad96] border border-[#2d3826] hover:text-[#f4f1ea]'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Street Addresses</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('WITH_PHONE')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 ${
                filterMode === 'WITH_PHONE'
                  ? 'bg-[#3f7d20] text-white border border-[#84cc16]'
                  : 'bg-[#12170f] text-[#b7ad96] border border-[#2d3826] hover:text-[#f4f1ea]'
              }`}
            >
              <Phone className="w-3.5 h-3.5" />
              <span>With Phone #</span>
            </button>
          </div>

          <span className="text-[11px] font-mono text-[#9c927d]">
            {isOfflineMode
              ? 'Offline Cached Directory Active'
              : 'Live KS Appraiser + 105-County ORKA + Public Directory'}
          </span>
        </div>
      </div>

      {/* RESULTS LIST */}
      {isLoadingDirectory && displayedEntries.length === 0 ? (
        <div className="rounded-2xl bg-[#141a11] border border-[#2d3826] p-8 text-center space-y-2">
          <Loader2 className="w-7 h-7 text-[#f97316] animate-spin mx-auto" />
          <p className="text-sm font-bold text-[#f4f1ea]">Loading Kansas Address &amp; Phone Book...</p>
        </div>
      ) : displayedEntries.length === 0 ? (
        <div className="rounded-2xl bg-[#141a11] border border-[#2d3826] p-8 text-center space-y-2">
          <Home className="w-8 h-8 text-[#9c927d] mx-auto" />
          <p className="text-sm font-bold text-[#f4f1ea]">
            No Kansas street address or owner matched &ldquo;{searchQuery}&rdquo;
          </p>
          <p className="text-xs text-[#9c927d] max-w-md mx-auto">
            Try typing the house number and street name (for example, <span className="text-[#f4f1ea] font-mono">218 E Central</span> or <span className="text-[#f4f1ea] font-mono">SW 20th</span>) or include the town or county name.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedEntries.map((entry) => {
            const hasConcreteStreet = /^\d+\s+[A-Za-z0-9]/.test(entry.streetAddress.trim());
            const isScanning = scanningEntryId === entry.id;
            const isAddingManual = addingPhoneEntryId === entry.id;

            // Build dummy or real parcel for SMS helper so text template includes address/county/hunterName
            const smsTargetParcel: HuntingParcel = entry.parcel || {
              id: entry.parcelId || entry.id,
              sectionCode: entry.sectionCode || entry.county,
              name: entry.streetAddress,
              ownerName: entry.displayOwnerName,
              ownerEntityType: 'Individual Homestead',
              acres: entry.acres || 80,
              landType: 'Timber / Creek',
              propertyAddress: entry.streetAddress,
              taxMailingAddress: entry.mailingAddress || entry.streetAddress,
              county: entry.county,
              parcelTaxId: entry.id,
              livesOnLand: Boolean(entry.livesOnLand),
              homesteadNote: '',
              driveMinutes: 15,
              distanceMiles: 10,
              permissionStatus: 'UNKNOWN',
              bestWindDirections: ['NW'],
              idealSpecies: ['Deer'],
              pressureLevel: 'Low',
              trucksSeenThisWeek: 0,
              lastHuntedSummary: '',
              publicLinks: [],
              rings: [],
              center: { lat: entry.lat || mapCenter.lat, lng: entry.lng || mapCenter.lng },
              terrainNotes: '',
              crewNotes: [],
              leaseMessages: [],
            };

            return (
              <div
                key={entry.id}
                className="rounded-2xl bg-[#141a11] border border-[#2d3826] hover:border-[#4b5e40] p-4 space-y-3 transition-colors shadow-md"
              >
                {/* TOP ROW: STREET ADDRESS HEADLINE + COUNTY / ACRES BADGE */}
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#25301f] pb-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ea580c]/20 border border-[#ea580c]/50 text-[10px] font-mono font-bold uppercase text-[#fb923c]">
                        <MapPin className="w-3 h-3" />
                        {hasConcreteStreet ? 'Street Address' : 'Property / Tax Location'}
                      </span>
                      <span className="text-xs font-mono text-[#b7ad96]">{entry.county}</span>
                      {entry.acres ? (
                        <span className="px-2 py-0.5 rounded-md bg-[#1c2417] border border-[#34422c] text-[11px] font-mono text-[#84cc16]">
                          {entry.acres.toFixed(1)} ac
                        </span>
                      ) : null}
                      {entry.livesOnLand && (
                        <span className="px-2 py-0.5 rounded-md bg-[#3f7d20]/25 border border-[#84cc16]/50 text-[10px] font-mono font-bold text-[#84cc16]">
                          HOMESTEAD · LIVES ON LAND
                        </span>
                      )}
                    </div>
                    <h2 className="text-base sm:text-lg font-bold text-[#f4f1ea] leading-snug">
                      {entry.streetAddress}
                    </h2>
                    {entry.mailingAddress && (
                      <p className="text-xs text-[#9c927d]">
                        Tax Mailing Address: <span className="text-[#d6ceb8]">{entry.mailingAddress}</span>
                      </p>
                    )}
                  </div>

                  {/* VIEW ON MAP BUTTON */}
                  {(entry.parcel || (entry.lat && entry.lng)) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (entry.parcel) {
                          onSelectParcelOnMap(entry.parcel);
                        } else if (entry.lat && entry.lng) {
                          onFlyToAddressCoords(entry.lat, entry.lng, entry.streetAddress);
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[#1f291a] hover:bg-[#2b3824] border border-[#3f5236] text-xs font-bold text-[#f4f1ea] flex items-center gap-1.5 shrink-0 transition-colors"
                    >
                      <Navigation className="w-3.5 h-3.5 text-[#f97316]" />
                      <span>View on Map</span>
                    </button>
                  )}
                </div>

                {/* POP-UP NAMES AT THIS ADDRESS BOX */}
                <div className="rounded-xl bg-[#0e130c] border border-[#2d3826] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#84cc16] flex items-center gap-1.5 font-bold">
                      <Users className="w-3.5 h-3.5" />
                      Names Registered at This Address
                    </span>
                    <span className="text-[10px] font-mono text-[#9c927d]">{entry.source}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#192214] border border-[#455939]">
                      <UserCheck className="w-4 h-4 text-[#84cc16] shrink-0" />
                      <div>
                        <div className="text-sm font-bold text-[#f4f1ea]">
                          {entry.displayOwnerName}
                        </div>
                        {entry.ownerName !== entry.displayOwnerName && (
                          <div className="text-[11px] font-mono text-[#9c927d]">
                            Tax Roll: {entry.ownerName}
                          </div>
                        )}
                      </div>
                    </div>

                    {entry.associatedPeople
                      .filter(
                        (person) =>
                          person.toLowerCase() !== entry.displayOwnerName.toLowerCase() &&
                          person.toLowerCase() !== entry.ownerName.toLowerCase()
                      )
                      .map((person, idx) => (
                        <span
                          key={`${entry.id}-p-${idx}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#141b11] border border-[#2d3826] text-xs font-semibold text-[#d6ceb8]"
                        >
                          <Building2 className="w-3.5 h-3.5 text-[#c29b6c]" />
                          {person}
                        </span>
                      ))}
                  </div>
                </div>

                {/* VERIFIED PHONE NUMBERS & CALL / TEXT ACTIONS */}
                <div className="space-y-2">
                  {entry.phones.length > 0 ? (
                    <div className="space-y-1.5">
                      {entry.phones.map((ph, idx) => (
                        <div
                          key={`${entry.id}-ph-${idx}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#11170e] border border-[#2d3826] px-3 py-2"
                        >
                          <div className="flex items-center gap-2.5">
                            <CheckCircle2 className="w-4 h-4 text-[#84cc16] shrink-0" />
                            <div>
                              <div className="text-sm font-mono font-bold text-[#f4f1ea]">
                                {formatDisplayPhone(ph.number)}
                              </div>
                              <div className="text-[11px] text-[#9c927d]">
                                {ph.label} · <span className="text-[#84cc16]">{ph.source}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <a
                              href={`tel:${formatPhoneDigits(ph.number)}`}
                              className="px-3 py-1.5 rounded-xl bg-[#3f7d20] hover:bg-[#4d9628] text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              <span>Call</span>
                            </a>
                            <a
                              href={buildPermissionSmsHref(
                                ph.number,
                                smsTargetParcel,
                                undefined,
                                undefined,
                                hunterName
                              )}
                              className="px-3 py-1.5 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              <span>Text</span>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#11160e] border border-[#2d3826] px-3 py-2.5">
                      <span className="text-xs text-[#9c927d]">
                        No cached phone number on file yet for this street address.
                      </span>
                      <button
                        type="button"
                        disabled={isScanning || isOfflineMode}
                        onClick={() => handleScanPhonesForEntry(entry)}
                        className="px-3 py-1.5 rounded-xl bg-[#ea580c] hover:bg-[#f97316] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        {isScanning ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Scanning Public Records...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Find Phone # for Address</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* ADD MANUAL PHONE + REVERSE ADDRESS WEB LINKS */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {entry.reverseLookupLinks.map((lnk, i) => (
                        <a
                          key={`${entry.id}-rev-${i}`}
                          href={lnk.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#182014] hover:bg-[#222d1c] border border-[#2d3826] text-[11px] font-medium text-[#b7ad96] hover:text-[#f4f1ea] transition-colors"
                        >
                          <span>{lnk.label}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ))}
                    </div>

                    {!isAddingManual ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAddingPhoneEntryId(entry.id);
                          setManualPhoneDraft('');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#182014] hover:bg-[#222d1c] border border-[#34422c] text-[11px] font-bold text-[#84cc16]"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add / Save Phone #</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="tel"
                          value={manualPhoneDraft}
                          onChange={(e) => setManualPhoneDraft(e.target.value)}
                          placeholder="(316) 555-0199"
                          className="w-36 rounded-lg bg-[#0b0e09] border border-[#455939] px-2.5 py-1 text-xs font-mono text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveManualPhone(entry)}
                          className="px-2.5 py-1 rounded-lg bg-[#3f7d20] text-white text-xs font-bold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingPhoneEntryId(null)}
                          className="px-2 py-1 rounded-lg bg-[#1c2317] text-[#9c927d] text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
