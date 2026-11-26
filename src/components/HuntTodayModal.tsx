import React, { useState, useMemo } from 'react';
import {
  Crosshair,
  Wind,
  Home,
  Navigation,
  Download,
  Route,
  X,
  CheckCircle2,
  Sun,
  PhoneCall,
  MessageSquare,
} from 'lucide-react';
import { HuntingParcel, HuntSpecies, FieldPin, LiveKansasWeather } from '../types/hunting';
import { resolveParcelGateDestination } from './WardenSlipModal';
import { getAllParcelPhones, formatPhoneDigits, buildPermissionSmsHref } from '../utils/phoneUtils';

interface HuntTodayModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcels: HuntingParcel[];
  pins?: FieldPin[];
  weather?: LiveKansasWeather | null;
  currentWindDir: string;
  currentWindSpeedMph: number;
  onSelectSpotOnMap: (parcelId: string) => void;
  onDownloadOfflineCounty: () => void;
  isOfflineDownloaded: boolean;
  onStartKnockRoute: (parcelId: string) => void;
  hunterName: string;
}

const SPECIES_LIST: HuntSpecies[] = ['Deer', 'Turkey', 'Duck', 'Coyote', 'Hog'];
const DRIVE_LIMITS: { label: string; maxMinutes: number }[] = [
  { label: '30m', maxMinutes: 30 },
  { label: '1 hr', maxMinutes: 60 },
  { label: '2 hr', maxMinutes: 120 },
];
const GROUND_TYPES: { label: string; value: 'BOTH' | 'PUBLIC' | 'PRIVATE' }[] = [
  { label: 'All Ground', value: 'BOTH' },
  { label: 'Private', value: 'PRIVATE' },
  { label: 'WIHA Public', value: 'PUBLIC' },
];

export const HuntTodayModal: React.FC<HuntTodayModalProps> = ({
  isOpen,
  onClose,
  parcels,
  pins = [],
  weather,
  currentWindDir,
  currentWindSpeedMph,
  onSelectSpotOnMap,
  onDownloadOfflineCounty,
  isOfflineDownloaded,
  onStartKnockRoute,
  hunterName,
}) => {
  const [selectedSpecies, setSelectedSpecies] = useState<HuntSpecies>('Deer');
  const [maxDriveMinutes, setMaxDriveMinutes] = useState<number>(30);
  const [groundFilter, setGroundFilter] = useState<'BOTH' | 'PUBLIC' | 'PRIVATE'>('BOTH');
  const [knockRouteStartedFor, setKnockRouteStartedFor] = useState<string | null>(null);

  const rankedTop5 = useMemo(() => {
    const candidates = parcels.filter((p) => {
      if (p.permissionStatus === 'NO_GO') return false;
      if (p.driveMinutes > maxDriveMinutes) return false;
      if (groundFilter === 'PUBLIC' && p.permissionStatus !== 'PUBLIC') return false;
      if (groundFilter === 'PRIVATE' && p.permissionStatus === 'PUBLIC') return false;
      return true;
    });

    const scored = candidates.map((p) => {
      let score = 0;
      const windMatches = p.bestWindDirections.includes(currentWindDir);
      const speciesMatches = p.idealSpecies.includes(selectedSpecies);

      if (windMatches) score += 35;
      if (speciesMatches) score += 25;
      if (p.permissionStatus === 'YES') score += 30;
      else if (p.permissionStatus === 'PUBLIC' && p.pressureLevel === 'Low') score += 22;
      else if (p.permissionStatus === 'ASK' && p.livesOnLand) score += 20;
      if (p.livesOnLand) score += 12;
      if (p.pressureLevel === 'Low') score += 15;
      if (p.pressureLevel === 'High (Hammered)') score -= 25;
      score -= Math.round(p.driveMinutes * 0.4);

      return {
        parcel: p,
        score,
        windMatches,
        speciesMatches,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5);
  }, [parcels, selectedSpecies, maxDriveMinutes, groundFilter, currentWindDir]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
      <div
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="animate-sheet-up bg-[#131810] border-t sm:border border-[#34422c] rounded-t-3xl sm:rounded-3xl w-full max-w-2xl max-h-[88dvh] flex flex-col overflow-hidden min-h-0 shadow-2xl"
      >
        {/* Camo Native App Header */}
        <div className="camo-header px-5 pt-2.5 pb-4 border-b border-[#2d3826] shrink-0">
          <div className="flex justify-center mb-2 sm:hidden">
            <div className="w-10 h-1.5 rounded-full bg-[#4a5a3f]" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#ea580c] text-white flex items-center justify-center shadow-lg">
                <Crosshair className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-bold text-[#f4f1ea] leading-none">
                  HUNT TODAY — TOP 5 SPOTS
                </h2>
                <p className="text-xs text-[#b7ad96] mt-1 flex flex-wrap items-center gap-x-2">
                  <span>
                    Wind:{' '}
                    <strong className="font-mono text-[#f97316]">
                      {currentWindDir} {currentWindSpeedMph} mph
                    </strong>
                    {weather ? ` · ${weather.tempF}°F` : ''}
                  </span>
                  {weather?.legalShootingLight && (
                    <span className="inline-flex items-center gap-1 font-mono text-[#84cc16]">
                      <Sun className="w-3 h-3" />
                      {weather.legalShootingLight}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-[#1d2518] hover:bg-[#2a3623] border border-[#3a4931] text-[#d6cebc] hover:text-white flex items-center justify-center shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Compact Native Segmented Filters */}
        <div className="px-4 py-3 bg-[#0f130c] border-b border-[#25301f] space-y-2.5 shrink-0">
          {/* Species Row */}
          <div className="grid grid-cols-5 gap-1.5">
            {SPECIES_LIST.map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setSelectedSpecies(sp)}
                className={`py-2 rounded-xl text-xs font-bold transition-colors ${
                  selectedSpecies === sp
                    ? 'bg-[#ea580c] text-white'
                    : 'bg-[#1a2216] border border-[#2d3826] text-[#b7ad96] hover:text-[#f4f1ea]'
                }`}
              >
                {sp}
              </button>
            ))}
          </div>

          {/* Drive & Ground Row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#161c12] border border-[#2d3826]">
              {DRIVE_LIMITS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setMaxDriveMinutes(d.maxMinutes)}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                    maxDriveMinutes === d.maxMinutes
                      ? 'bg-[#3f7d20] text-white'
                      : 'text-[#b7ad96] hover:text-[#f4f1ea]'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#161c12] border border-[#2d3826]">
              {GROUND_TYPES.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGroundFilter(g.value)}
                  className={`py-1.5 rounded-lg text-[11px] font-bold truncate transition-colors ${
                    groundFilter === g.value
                      ? 'bg-[#3f7d20] text-white'
                      : 'text-[#b7ad96] hover:text-[#f4f1ea]'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Ranked Top 5 Spots Tap-List */}
        <div className="overflow-y-auto divide-y divide-[#25301f] flex-1 min-h-0 touch-scroll-y">
          {rankedTop5.map((item, idx) => {
            const p = item.parcel;
            return (
              <div key={p.id} className="p-4 space-y-2.5 hover:bg-[#182014] transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-[#9c927d]">
                      <span className="font-bold text-[#f97316]">#{idx + 1}</span>
                      <span>·</span>
                      <span>{p.acres.toFixed(1)} ac</span>
                      <span>·</span>
                      <span>{p.driveMinutes}m drive</span>
                      <span>·</span>
                      <span
                        className={
                          p.permissionStatus === 'YES'
                            ? 'text-[#84cc16] font-bold'
                            : p.permissionStatus === 'PUBLIC'
                              ? 'text-purple-400 font-bold'
                              : 'text-[#f97316] font-bold'
                        }
                      >
                        {p.permissionStatus}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-[#f4f1ea] mt-0.5 truncate">
                      {p.ownerName}
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectSpotOnMap(p.id);
                      onClose();
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center gap-1.5 shrink-0"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Go</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#b7ad96]">
                  <span className="inline-flex items-center gap-1">
                    <Wind className="w-3.5 h-3.5 text-[#f97316]" />
                    <span className={item.windMatches ? 'text-[#84cc16] font-semibold' : ''}>
                      {item.windMatches
                        ? `${currentWindDir} wind ideal`
                        : `Best: ${p.bestWindDirections.join('/')}`}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Home className="w-3.5 h-3.5 text-[#c29b6c]" />
                    {p.livesOnLand ? 'Lives on land' : 'Absentee / Public'}
                  </span>
                  <span>
                    Pressure: <strong className="text-[#f4f1ea]">{p.pressureLevel}</strong>
                  </span>
                </div>

                {(() => {
                  const ownerPhones = getAllParcelPhones(p);
                  if (!ownerPhones.length) return null;
                  return (
                    <div className="space-y-1">
                      {ownerPhones.map((ph, pIdx) => {
                        const digits = formatPhoneDigits(ph.number);
                        const smsUrl = buildPermissionSmsHref(
                          ph.number,
                          p,
                          undefined,
                          undefined,
                          hunterName
                        );
                        return (
                          <div
                            key={`${digits}-${pIdx}`}
                            className="flex items-center justify-between gap-2 bg-[#0e120b] border border-[#283421] rounded-xl px-2.5 py-1.5 text-xs"
                          >
                            <span className="font-mono font-bold text-[#84cc16] truncate">
                              {ph.number}
                              <span className="font-sans font-normal text-[10px] text-[#9c927d] ml-1.5">
                                ({ph.label})
                              </span>
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`tel:${digits}`}
                                className="px-2.5 py-1 rounded-lg bg-[#2f6619] hover:bg-[#3f7d20] text-white font-bold text-[11px] flex items-center gap-1"
                              >
                                <PhoneCall className="w-3 h-3" />
                                <span>Call</span>
                              </a>
                              <a
                                href={smsUrl}
                                className="px-2.5 py-1 rounded-lg bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-[11px] flex items-center gap-1"
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span>Text</span>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-3 gap-2 pt-0.5">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${resolveParcelGateDestination(p, pins).lat},${resolveParcelGateDestination(p, pins).lng}&travelmode=driving`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2 px-2.5 rounded-xl bg-[#2f6619] hover:bg-[#3f7d20] text-white font-semibold text-xs flex items-center justify-center gap-1"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Drive Gate</span>
                  </a>
                  <button
                    type="button"
                    onClick={onDownloadOfflineCounty}
                    className="py-2 px-2.5 rounded-xl bg-[#1d2518] hover:bg-[#283322] border border-[#323f2a] text-[#d6cebc] font-semibold text-xs flex items-center justify-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5 text-[#84cc16]" />
                    <span>{isOfflineDownloaded ? 'Offline Ready' : 'Cache'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKnockRouteStartedFor(p.name);
                      onStartKnockRoute(p.id);
                    }}
                    className="py-2 px-2.5 rounded-xl bg-[#1d2518] hover:bg-[#283322] border border-[#323f2a] text-[#d6cebc] font-semibold text-xs flex items-center justify-center gap-1"
                  >
                    <Route className="w-3.5 h-3.5 text-[#c29b6c]" />
                    <span>Knock</span>
                  </button>
                </div>
              </div>
            );
          })}

          {knockRouteStartedFor && (
            <div className="p-4 bg-[#182613] flex items-center justify-between gap-2 text-xs text-[#d9f99d]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#84cc16] shrink-0" />
                <span>
                  Knock route queued for <strong>{knockRouteStartedFor}</strong>.
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-xl bg-[#3f7d20] text-white font-bold shrink-0"
              >
                Open Map
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
