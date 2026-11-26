import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Mic,
  X,
  Loader2,
  User,
  Home,
  Signpost,
  Building2,
  Map as MapIcon,
  Trees,
  ExternalLink,
  ZoomIn,
  UserCheck,
} from 'lucide-react';
import { HuntingParcel } from '../types/hunting';

export type SearchCategory = 'OWNER' | 'ADDRESS' | 'STREET' | 'TOWN' | 'COUNTY' | 'PUBLIC';

export interface KansasSearchResult {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle: string;
  county?: string;
  lat: number;
  lng: number;
  zoom: number;
  autoInspect?: boolean;
  parcel?: HuntingParcel;
}

export interface TownBriefing {
  name: string;
  county: string;
  lat: number;
  lng: number;
  nearbyWihaCount: number;
  nearbyWihaAcres: number;
  hasDirectCountyRoll: boolean;
  directCountyLabel: string;
  orkaPortalUrl: string;
}

interface KansasUniversalSearchProps {
  localParcels: HuntingParcel[];
  mapCenter?: { lat: number; lng: number };
  onSelectResult: (result: KansasSearchResult) => void;
  onVoiceCommand: () => void;
  isListeningVoice: boolean;
  activeTownInfo: TownBriefing | null;
  onCloseTownInfo: () => void;
  onZoomToPropertyLines: (coords: { lat: number; lng: number }) => void;
  hunterShortName?: string;
  hunterFullName?: string;
  onOpenAccountModal?: () => void;
}

type FilterTab = 'ALL' | 'OWNER' | 'ADDRESS' | 'STREET' | 'TOWN' | 'COUNTY';

const CATEGORY_META: Record<
  SearchCategory,
  { label: string; iconTile: string; tagText: string; Icon: React.FC<{ className?: string }> }
> = {
  OWNER: {
    label: 'OWNER',
    iconTile: 'bg-[#192814] text-[#84cc16] border-[#355528]',
    tagText: 'text-[#84cc16]',
    Icon: User,
  },
  ADDRESS: {
    label: 'ADDRESS',
    iconTile: 'bg-[#2a1b10] text-[#f97316] border-[#663918]',
    tagText: 'text-[#f97316]',
    Icon: Home,
  },
  STREET: {
    label: 'STREET',
    iconTile: 'bg-[#251f15] text-[#c29b6c] border-[#4e3f28]',
    tagText: 'text-[#c29b6c]',
    Icon: Signpost,
  },
  TOWN: {
    label: 'TOWN',
    iconTile: 'bg-[#1e2719] text-[#d6cebc] border-[#3d4d34]',
    tagText: 'text-[#d6cebc]',
    Icon: Building2,
  },
  COUNTY: {
    label: 'COUNTY',
    iconTile: 'bg-[#1d2318] text-[#b7ad96] border-[#384430]',
    tagText: 'text-[#b7ad96]',
    Icon: MapIcon,
  },
  PUBLIC: {
    label: 'WIHA',
    iconTile: 'bg-[#261830] text-purple-300 border-purple-500/40',
    tagText: 'text-purple-300',
    Icon: Trees,
  },
};

export const KansasUniversalSearch: React.FC<KansasUniversalSearchProps> = ({
  localParcels,
  mapCenter,
  onSelectResult,
  onVoiceCommand,
  isListeningVoice,
  activeTownInfo,
  onCloseTownInfo,
  onZoomToPropertyLines,
  hunterShortName,
  hunterFullName,
  onOpenAccountModal,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [remoteResults, setRemoteResults] = useState<KansasSearchResult[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');
  const [highlightIdx, setHighlightIdx] = useState(0);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemoteResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (mapCenter && Number.isFinite(mapCenter.lat) && Number.isFinite(mapCenter.lng)) {
          params.set('lat', mapCenter.lat.toFixed(4));
          params.set('lng', mapCenter.lng.toFixed(4));
        }
        const res = await fetch(`/api/ks-gis/search?${params.toString()}`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results)) {
            setRemoteResults(data.results);
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Search request failed:', err);
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 240);

    return () => clearTimeout(timer);
  }, [query, mapCenter?.lat, mapCenter?.lng]);

  const localMatches = useMemo<KansasSearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches: KansasSearchResult[] = [];
    for (const p of localParcels) {
      const hay = [
        p.ownerName,
        p.name,
        p.propertyAddress || '',
        p.taxMailingAddress,
        p.sectionCode,
        p.county,
      ]
        .join(' ')
        .toLowerCase();
      if (hay.includes(q)) {
        matches.push({
          id: `local-${p.id}`,
          category: p.permissionStatus === 'PUBLIC' ? 'PUBLIC' : 'OWNER',
          title: p.ownerName,
          subtitle: `${p.acres.toFixed(1)} ac · ${
            p.propertyAddress || p.taxMailingAddress
          } · ${p.county}`,
          county: p.county,
          lat: p.center.lat,
          lng: p.center.lng,
          zoom: 16,
          parcel: p,
        });
      }
      if (matches.length >= 6) break;
    }
    return matches;
  }, [query, localParcels]);

  const combinedResults = useMemo(() => {
    const seen = new Set<string>();
    const out: KansasSearchResult[] = [];
    for (const item of [...localMatches, ...remoteResults]) {
      const k = `${item.category}|${item.title.toLowerCase()}|${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }, [localMatches, remoteResults]);

  const filteredResults = useMemo(() => {
    if (activeFilter === 'ALL') return combinedResults;
    return combinedResults.filter((r) => r.category === activeFilter);
  }, [combinedResults, activeFilter]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [filteredResults.length, activeFilter]);

  const handleChoose = (item: KansasSearchResult) => {
    setQuery(item.title);
    setIsOpen(false);
    onSelectResult(item);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    if (filteredResults.length > 0) {
      handleChoose(filteredResults[Math.min(highlightIdx, filteredResults.length - 1)]);
      return;
    }

    setIsSearching(true);
    setIsOpen(true);
    try {
      const res = await fetch(`/api/ks-gis/search?q=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data = await res.json();
        const items: KansasSearchResult[] = Array.isArray(data.results) ? data.results : [];
        setRemoteResults(items);
        if (items.length > 0) {
          handleChoose(items[0]);
        }
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => (filteredResults.length ? (i + 1) % filteredResults.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) =>
        filteredResults.length ? (i - 1 + filteredResults.length) % filteredResults.length : 0
      );
    }
  };

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = {
      ALL: combinedResults.length,
      OWNER: 0,
      ADDRESS: 0,
      STREET: 0,
      TOWN: 0,
      COUNTY: 0,
    };
    for (const r of combinedResults) {
      if (r.category in c) {
        c[r.category as FilterTab] += 1;
      }
    }
    return c;
  }, [combinedResults]);

  return (
    <div ref={wrapperRef} className="absolute top-2.5 left-2.5 right-2.5 z-30 pointer-events-none">
      {/* ROW 1: NATIVE APP FLOATING SEARCH PILL + HUNTER ACCOUNT CHIP */}
      <div className="flex items-center gap-2 max-w-2xl pointer-events-auto">
        <form
          onSubmit={handleFormSubmit}
          className="flex-1 min-w-0 flex items-center bg-[#12170f]/95 backdrop-blur-xl border border-[#34422c] focus-within:border-[#ea580c] rounded-full pl-3.5 pr-1.5 py-0.5 shadow-[0_8px_28px_rgba(0,0,0,0.65)] transition-colors"
        >
          {isSearching ? (
            <Loader2 className="w-4 h-4 text-[#f97316] animate-spin shrink-0 mr-2" />
          ) : (
            <Search className="w-4 h-4 text-[#f97316] shrink-0 mr-2" />
          )}
          <input
            type="text"
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search KS owner, address, street, town..."
            className="flex-1 bg-transparent text-xs sm:text-sm text-[#f4f1ea] placeholder-[#8f9982] focus:outline-none py-1.5 min-w-0"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setRemoteResults([]);
                setActiveFilter('ALL');
              }}
              className="p-1.5 text-[#9c927d] hover:text-[#f4f1ea]"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onVoiceCommand}
            title="Voice Command: 'Drop stand pin' / 'Mark permission yes' / 'Night mode'"
            className={`ml-1 w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
              isListeningVoice
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-[#1f2919] hover:bg-[#2c3924] text-[#f97316] border border-[#36452d]'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
          </button>
        </form>

        {hunterShortName && onOpenAccountModal && (
          <button
            type="button"
            onClick={onOpenAccountModal}
            title={`Signed in as ${hunterFullName || hunterShortName} — tap to edit or switch account`}
            className="shrink-0 h-10 px-3 rounded-full bg-[#12170f]/95 hover:bg-[#1c2418] backdrop-blur-xl border border-[#34422c] hover:border-[#84cc16] text-xs font-semibold text-[#f4f1ea] flex items-center gap-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.65)] transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5 text-[#84cc16] shrink-0" />
            <span className="max-w-[96px] sm:max-w-[140px] truncate">{hunterShortName}</span>
          </button>
        )}
      </div>

      {/* NATIVE SEARCH RESULTS SHEET */}
      {isOpen && (
        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="pointer-events-auto mt-2 max-w-lg bg-[#131810]/98 backdrop-blur-xl border border-[#34422c] rounded-3xl shadow-2xl overflow-hidden max-h-[68dvh] flex flex-col min-h-0 animate-sheet-up"
        >
          {query.trim().length < 2 ? (
            <div className="p-4 text-xs text-[#b7ad96]">
              Type at least 2 characters to search any Kansas landowner, street address, town, or county.
            </div>
          ) : (
            <>
              {/* CATEGORY FILTER SEGMENTED ROW */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-[#25301f] overflow-x-auto shrink-0 bg-[#10150d]">
                {(
                  [
                    { id: 'ALL', label: 'All' },
                    { id: 'OWNER', label: 'Owners' },
                    { id: 'ADDRESS', label: 'Addresses' },
                    { id: 'STREET', label: 'Streets' },
                    { id: 'TOWN', label: 'Towns' },
                    { id: 'COUNTY', label: 'Counties' },
                  ] as { id: FilterTab; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-colors ${
                      activeFilter === tab.id
                        ? 'bg-[#ea580c] text-white'
                        : 'bg-[#1a2216] text-[#b7ad96] hover:text-[#f4f1ea]'
                    }`}
                  >
                    {tab.label}
                    {counts[tab.id] > 0 && (
                      <span className="ml-1 opacity-80">({counts[tab.id]})</span>
                    )}
                  </button>
                ))}
              </div>

              {/* RESULTS TAP LIST */}
              <div className="overflow-y-auto min-h-0 flex-1 touch-scroll-y divide-y divide-[#25301f]">
                {isSearching && filteredResults.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-[#b7ad96] flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#f97316]" />
                    <span>Searching all 105 Kansas counties &amp; owners...</span>
                  </div>
                ) : filteredResults.length === 0 ? (
                  <div className="px-4 py-5 text-center text-xs text-[#b7ad96]">
                    No Kansas matches for &ldquo;{query}&rdquo; in this tab. Try &ldquo;All&rdquo;.
                  </div>
                ) : (
                  filteredResults.map((item, idx) => {
                    const meta = CATEGORY_META[item.category] || CATEGORY_META.ADDRESS;
                    const IconComp = meta.Icon;
                    const isHighlighted = idx === highlightIdx;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleChoose(item)}
                        onMouseEnter={() => setHighlightIdx(idx)}
                        className={`w-full text-left px-3.5 py-3 flex items-center gap-3 transition-colors ${
                          isHighlighted ? 'bg-[#1f2919]' : 'hover:bg-[#192115]'
                        }`}
                      >
                        <div
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${meta.iconTile}`}
                        >
                          <IconComp className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs sm:text-sm font-bold text-[#f4f1ea] truncate">
                              {item.title}
                            </span>
                            <span className={`text-[10px] font-mono font-bold shrink-0 ${meta.tagText}`}>
                              {meta.label}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#b7ad96] truncate mt-0.5">
                            {item.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* COMPACT TOWN SCOUTING POPUP */}
      {!isOpen && activeTownInfo && (
        <div className="pointer-events-auto mt-[76px] max-w-lg camo-header border border-[#3a4931] rounded-3xl p-3.5 shadow-2xl text-xs space-y-2.5 animate-sheet-up">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-[#f97316] shrink-0" />
                <span className="font-display text-lg font-bold text-[#f4f1ea] leading-none">
                  {activeTownInfo.name}
                </span>
              </div>
              <p className="text-[11px] text-[#b7ad96] mt-0.5">
                {activeTownInfo.county} · {activeTownInfo.directCountyLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={onCloseTownInfo}
              className="w-8 h-8 rounded-full bg-[#1d2518] hover:bg-[#2a3623] text-[#b7ad96] hover:text-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#d6cebc] bg-[#10150d]/85 rounded-2xl px-3 py-2 border border-[#2d3826]">
            <span>
              Nearby WIHA:{' '}
              <strong className="font-mono text-purple-300">
                {activeTownInfo.nearbyWihaCount} tracts ({activeTownInfo.nearbyWihaAcres.toLocaleString()} ac)
              </strong>
            </span>
            <span className="font-mono text-[#84cc16] font-bold">Lines Active</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onZoomToPropertyLines({ lat: activeTownInfo.lat, lng: activeTownInfo.lng })
              }
              className="flex-1 py-2.5 px-3 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center justify-center gap-1.5"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Zoom to Property Lines</span>
            </button>
            <a
              href={activeTownInfo.orkaPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#f4f1ea] font-semibold text-xs flex items-center gap-1"
            >
              <span>Tax Roll</span>
              <ExternalLink className="w-3 h-3 text-[#c29b6c]" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
