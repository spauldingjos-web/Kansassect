import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  MapCameraChangedEvent,
  MapMouseEvent,
} from '@vis.gl/react-google-maps';
import {
  Layers,
  Moon,
  Mountain,
  Crosshair,
  Wind,
  Plus,
  Users,
  ShieldAlert,
  WifiOff,
  Wifi,
  Compass,
  Eye,
  X,
  MapPin,
  Loader2,
  LocateFixed,
} from 'lucide-react';
import {
  HuntingParcel,
  MapLayerMode,
  FieldPin,
  PinCategory,
  PermissionStatus,
  EScoutReport,
  CrewMember,
} from '../types/hunting';
import { KANSAS_QUICK_REGIONS } from '../data/kansasParcels';
import { OfflineIndicator, PWAInstallButton } from './PWAInstallButton';

interface KansasGoogleMapProps {
  parcels: HuntingParcel[];
  selectedParcelId: string | null;
  onSelectParcel: (parcel: HuntingParcel) => void;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  onCameraChange: (center: { lat: number; lng: number }, zoom: number, bounds?: google.maps.LatLngBoundsLiteral) => void;
  mapLayer: MapLayerMode;
  onChangeMapLayer: (layer: MapLayerMode) => void;
  is3DTilt: boolean;
  onToggle3DTilt: () => void;
  windDir: string;
  windSpeedMph: number;
  onCycleWind: () => void;
  hunterGps: { lat: number; lng: number };
  onMoveHunterGps: (coords: { lat: number; lng: number }) => void;
  isTrespassingRed: boolean;
  distanceToNearestLineFt: number;
  pins: FieldPin[];
  activePinCategoryToDrop: PinCategory | null;
  onSetPinCategoryToDrop: (cat: PinCategory | null) => void;
  onDropPinAt: (lat: number, lng: number, category: PinCategory) => void;
  escoutReports: Record<string, EScoutReport>;
  crewMembers: CrewMember[];
  showCrewGps: boolean;
  onToggleCrewGps: () => void;
  isOfflineDownloaded: boolean;
  isOfflineMode: boolean;
  onDownloadOfflineCounty: () => void;
  onToggleOfflineMode: () => void;
  downloadProgress: number | null;
  pendingSyncCount: number;
  isLoadingParcels: boolean;
  gisSourcesActive: string[];
  streetViewCoords: { lat: number; lng: number } | null;
  onOpenStreetView: (coords: { lat: number; lng: number }) => void;
  onCloseStreetView: () => void;
  onJumpToRegion: (center: { lat: number; lng: number }, zoom: number) => void;
  onInspectCoordinate: (coords: { lat: number; lng: number }) => void;
  inspectingCoords: { lat: number; lng: number } | null;
  isInspectingPoint: boolean;
  weatherTempF?: number | null;
  legalLightWindow?: string | null;
  cachedTileCount?: number;
}

const STATUS_STYLE: Record<
  PermissionStatus,
  { stroke: string; fill: string; fillOpacity: number; selectedOpacity: number; label: string }
> = {
  YES: {
    stroke: '#65a30d',
    fill: '#4d7c0f',
    fillOpacity: 0.24,
    selectedOpacity: 0.44,
    label: 'Permission: YES',
  },
  ASK: {
    stroke: '#f97316',
    fill: '#ea580c',
    fillOpacity: 0.22,
    selectedOpacity: 0.42,
    label: 'Ask / Knock',
  },
  NO_GO: {
    stroke: '#ef4444',
    fill: '#dc2626',
    fillOpacity: 0.28,
    selectedOpacity: 0.48,
    label: 'NO GO (Red)',
  },
  UNKNOWN: {
    stroke: '#e7e5dc',
    fill: '#6c7761',
    fillOpacity: 0.06,
    selectedOpacity: 0.28,
    label: 'Private Parcel',
  },
  PUBLIC: {
    stroke: '#c084fc',
    fill: '#a855f7',
    fillOpacity: 0.25,
    selectedOpacity: 0.44,
    label: 'Public / WIHA',
  },
  LEASED: {
    stroke: '#c29b6c',
    fill: '#9a7248',
    fillOpacity: 0.24,
    selectedOpacity: 0.42,
    label: 'Leased',
  },
};

const PIN_CATEGORIES: { category: PinCategory; color: string; short: string }[] = [
  { category: 'Stand', color: '#84cc16', short: 'STN' },
  { category: 'Blind', color: '#4d7c0f', short: 'BLD' },
  { category: 'Camera', color: '#f97316', short: 'CAM' },
  { category: 'Rub', color: '#c29b6c', short: 'RUB' },
  { category: 'Scrape', color: '#ea580c', short: 'SCR' },
  { category: 'Bedding', color: '#a855f7', short: 'BED' },
  { category: 'Water', color: '#65a30d', short: 'WTR' },
  { category: 'Gate', color: '#fb923c', short: 'GTE' },
  { category: 'Parking', color: '#d6cebc', short: 'PRK' },
  { category: 'Blood Trail', color: '#ef4444', short: 'TRL' },
];

// Helper subcomponent: draws ALL-105-County Regrid Parcel Boundaries Tile Overlay + Clickable County Polygons + 50ft GPS Circle
const ParcelAndGpsOverlays: React.FC<{
  parcels: HuntingParcel[];
  selectedParcelId: string | null;
  onSelectParcel: (parcel: HuntingParcel) => void;
  hunterGps: { lat: number; lng: number };
  isTrespassingRed: boolean;
  activePinCategoryToDrop: PinCategory | null;
  onDropPinAt: (lat: number, lng: number, category: PinCategory) => void;
  showAllKansasLines: boolean;
}> = ({
  parcels,
  selectedParcelId,
  onSelectParcel,
  hunterGps,
  isTrespassingRed,
  activePinCategoryToDrop,
  onDropPinAt,
  showAllKansasLines,
}) => {
  const map = useMap();
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const circleRef = useRef<google.maps.Circle | null>(null);

  // Mount Statewide Regrid Nationwide Parcel Boundaries Tile Layer (EVERY property line in ALL 105 KS counties!)
  useEffect(() => {
    if (!map || typeof google === 'undefined') return;
    if (!showAllKansasLines) return;

    const regridParcelTileLayer = new google.maps.ImageMapType({
      name: 'All Kansas Property Lines',
      tileSize: new google.maps.Size(256, 256),
      opacity: 0.92,
      minZoom: 15,
      maxZoom: 17,
      getTileUrl: (coord, zoom) => {
        if (!coord || zoom < 15 || zoom > 17) return '';
        const maxTile = 1 << zoom;
        if (coord.y < 0 || coord.y >= maxTile) return '';
        const x = ((coord.x % maxTile) + maxTile) % maxTile;
        return `https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/${zoom}/${coord.y}/${x}`;
      },
    });

    map.overlayMapTypes.push(regridParcelTileLayer);

    return () => {
      const idx = map.overlayMapTypes.getArray().indexOf(regridParcelTileLayer);
      if (idx >= 0) map.overlayMapTypes.removeAt(idx);
    };
  }, [map, showAllKansasLines]);

  // Render bright, crisp clickable property boundary polygons for loaded Kansas County & WIHA parcels
  useEffect(() => {
    if (!map || typeof google === 'undefined') return;

    polygonsRef.current.forEach((poly) => poly.setMap(null));
    polygonsRef.current = [];

    const created: google.maps.Polygon[] = [];

    for (const parcel of parcels) {
      if (!parcel.rings?.length) continue;
      const isSelected = parcel.id === selectedParcelId;
      const st = STATUS_STYLE[parcel.permissionStatus] || STATUS_STYLE.UNKNOWN;

      const poly = new google.maps.Polygon({
        paths: parcel.rings,
        strokeColor: isSelected ? '#f97316' : st.stroke,
        strokeOpacity: 0.96,
        strokeWeight: isSelected ? 4.5 : parcel.permissionStatus === 'UNKNOWN' ? 1.8 : 3.2,
        fillColor: st.fill,
        fillOpacity: isSelected ? st.selectedOpacity : st.fillOpacity,
        zIndex: isSelected ? 50 : parcel.permissionStatus === 'PUBLIC' ? 20 : 10,
        clickable: true,
        map,
      });

      poly.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (activePinCategoryToDrop && e.latLng) {
          onDropPinAt(e.latLng.lat(), e.latLng.lng(), activePinCategoryToDrop);
          return;
        }
        onSelectParcel(parcel);
      });

      created.push(poly);
    }

    polygonsRef.current = created;

    return () => {
      created.forEach((poly) => poly.setMap(null));
    };
  }, [map, parcels, selectedParcelId, onSelectParcel, activePinCategoryToDrop, onDropPinAt]);

  // Render live 50ft (15.24 meter) GPS accuracy circle around your live blue dot
  useEffect(() => {
    if (!map || typeof google === 'undefined') return;
    if (!circleRef.current) {
      circleRef.current = new google.maps.Circle({
        map,
        radius: 15.24, // Exact 50 feet in meters!
        clickable: false,
        zIndex: 80,
      });
    }
    circleRef.current.setCenter(hunterGps);
    circleRef.current.setOptions({
      strokeColor: isTrespassingRed ? '#ef4444' : '#f97316',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: isTrespassingRed ? '#ef4444' : '#ea580c',
      fillOpacity: isTrespassingRed ? 0.35 : 0.2,
    });

    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, [map, hunterGps, isTrespassingRed]);

  return null;
};

// Helper subcomponent: smoothly flies Google Map camera when user picks a region or Hunt Today spot
const CameraController: React.FC<{
  targetCenter: { lat: number; lng: number };
  targetZoom: number;
  is3DTilt: boolean;
}> = ({ targetCenter, targetZoom, is3DTilt }) => {
  const map = useMap();
  const prevTargetRef = useRef<string>('');

  useEffect(() => {
    if (!map) return;
    const key = `${targetCenter.lat.toFixed(5)},${targetCenter.lng.toFixed(5)},${targetZoom}`;
    if (prevTargetRef.current !== key) {
      prevTargetRef.current = key;
      map.panTo(targetCenter);
      map.setZoom(targetZoom);
    }
  }, [map, targetCenter, targetZoom]);

  useEffect(() => {
    if (!map) return;
    map.setTilt(is3DTilt ? 45 : 0);
  }, [map, is3DTilt]);

  return null;
};

// Real Google Maps Street View Panorama Overlay (inspect the farm gate & mailbox before knocking!)
const StreetViewOverlay: React.FC<{
  coords: { lat: number; lng: number };
  onClose: () => void;
}> = ({ coords, onClose }) => {
  const panoContainerRef = useRef<HTMLDivElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('Locating nearest road Street View to parcel gate...');

  useEffect(() => {
    if (!panoContainerRef.current || typeof google === 'undefined') return;
    const svService = new google.maps.StreetViewService();
    svService.getPanorama(
      { location: coords, radius: 1200, preference: google.maps.StreetViewPreference.NEAREST },
      (data, status) => {
        if (status === google.maps.StreetViewStatus.OK && data?.location?.latLng && panoContainerRef.current) {
          setStatusMsg('');
          new google.maps.StreetViewPanorama(panoContainerRef.current, {
            position: data.location.latLng,
            pov: { heading: 0, pitch: 0 },
            zoom: 1,
            addressControl: true,
            fullscreenControl: false,
          });
        } else {
          setStatusMsg('No Google Street View imagery within 0.75 miles of this remote rural section road.');
        }
      }
    );
  }, [coords]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl h-[75vh] bg-[#131810] border border-[#34422c] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
        <div className="camo-header px-4 py-3 border-b border-[#2d3826] flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-[#f4f1ea]">
              Gate &amp; Homestead Street View
            </h3>
            <p className="text-xs text-[#b7ad96] font-mono">
              {coords.lat.toFixed(5)}° N, {coords.lng.toFixed(5)}° W
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-[#1d2518] hover:bg-[#2a3623] border border-[#3a4931] text-[#f4f1ea] text-xs font-bold flex items-center gap-1"
          >
            <X className="w-4 h-4" />
            <span>Back</span>
          </button>
        </div>
        <div className="relative flex-1 bg-[#0c0f0a]">
          <div ref={panoContainerRef} className="w-full h-full" />
          {statusMsg && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center bg-[#0c0f0a]/90 text-[#d6cebc] text-sm">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const KansasGoogleMap: React.FC<KansasGoogleMapProps> = ({
  parcels,
  selectedParcelId,
  onSelectParcel,
  mapCenter,
  mapZoom,
  onCameraChange,
  mapLayer,
  onChangeMapLayer,
  is3DTilt,
  onToggle3DTilt,
  windDir,
  windSpeedMph,
  onCycleWind,
  hunterGps,
  onMoveHunterGps,
  isTrespassingRed,
  distanceToNearestLineFt,
  pins,
  activePinCategoryToDrop,
  onSetPinCategoryToDrop,
  onDropPinAt,
  escoutReports,
  crewMembers,
  showCrewGps,
  onToggleCrewGps,
  isOfflineDownloaded,
  isOfflineMode,
  onDownloadOfflineCounty,
  onToggleOfflineMode,
  downloadProgress,
  pendingSyncCount,
  isLoadingParcels,
  gisSourcesActive,
  streetViewCoords,
  onOpenStreetView,
  onCloseStreetView,
  onJumpToRegion,
  onInspectCoordinate,
  inspectingCoords,
  isInspectingPoint,
  weatherTempF,
  legalLightWindow,
  cachedTileCount = 0,
}) => {
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showPinMenu, setShowPinMenu] = useState(false);
  const [showAllKansasLines, setShowAllKansasLines] = useState(true);
  const [currentZoomDisplay, setCurrentZoomDisplay] = useState(mapZoom);

  // Map layer mapping to native Google Maps mapTypeId
  const googleMapTypeId: string =
    mapLayer === 'SATELLITE'
      ? 'satellite'
      : mapLayer === 'TOPO'
      ? 'terrain'
      : mapLayer === 'ROADMAP'
      ? 'roadmap'
      : 'hybrid'; // HYBRID & NIGHT both use crisp satellite + roads + labels

  const handleCameraChanged = useCallback(
    (ev: MapCameraChangedEvent) => {
      const { center, zoom, bounds } = ev.detail;
      setCurrentZoomDisplay(Math.round(zoom));
      onCameraChange(center, zoom, bounds);
    },
    [onCameraChange]
  );

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      if (!ev.detail.latLng) return;
      const { lat, lng } = ev.detail.latLng;
      if (activePinCategoryToDrop) {
        onDropPinAt(lat, lng, activePinCategoryToDrop);
        return;
      }
      // Tap ANYWHERE in Kansas to inspect that exact parcel & landowner!
      onInspectCoordinate({ lat, lng });
    },
    [activePinCategoryToDrop, onDropPinAt, onInspectCoordinate]
  );

  const handleLocateMe = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          onMoveHunterGps(coords);
          onJumpToRegion(coords, 15);
        },
        () => {
          // Fallback to Butler Co KS stand if geolocation denied in iframe
          onJumpToRegion(hunterGps, 15);
        }
      );
    } else {
      onJumpToRegion(hunterGps, 15);
    }
  };

  const activeEScout = selectedParcelId ? escoutReports[selectedParcelId] : undefined;

  return (
    <div className="relative w-full h-full bg-[#0c0f0a] overflow-hidden">
      {/* FULL-SCREEN RED TRESPASS ALERT BANNER WHEN CROSSING INTO RED PARCEL */}
      {isTrespassingRed && (
        <div
          role="alert"
          className="absolute top-16 left-4 right-4 z-40 bg-red-600/95 text-white px-4 py-3 rounded-2xl border-2 border-red-200 shadow-2xl flex flex-wrap items-center justify-between gap-3 animate-pulse"
        >
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-6 h-6 shrink-0" />
            <div>
              <p className="text-sm font-bold">
                TRESPASS ALERT — YOU CROSSED INTO A RED (NO GO) PARCEL!
              </p>
              <p className="text-xs text-red-100">
                Posted Purple Paint Boundary · Head North immediately to return to legal hunting ground.
              </p>
            </div>
          </div>
          <button
            onClick={() => onMoveHunterGps({ lat: 37.8193, lng: -96.7506 })}
            className="px-3.5 py-2 bg-white text-red-700 font-bold text-xs rounded-xl hover:bg-red-50 whitespace-nowrap"
          >
            Step Back to Legal Stand
          </button>
        </div>
      )}

      {/* REAL INTERACTIVE GOOGLE MAP OF KANSAS (Full 100% Width & Height) */}
      <div className={`w-full h-full ${mapLayer === 'NIGHT' ? 'night-vision-filter' : ''}`}>
        <GoogleMap
          defaultCenter={mapCenter}
          defaultZoom={mapZoom}
          mapTypeId={googleMapTypeId}
          mapId="DEMO_MAP_ID"
          gestureHandling="greedy"
          disableDefaultUI={true}
          clickableIcons={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          onCameraChanged={handleCameraChanged}
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%' }}
        >
          <CameraController
            targetCenter={mapCenter}
            targetZoom={mapZoom}
            is3DTilt={is3DTilt}
          />

          {/* Bright, Thick Kansas Parcel & WIHA Boundary Polygons + All-KS Regrid Lines + 50ft GPS Ring */}
          <ParcelAndGpsOverlays
            parcels={parcels}
            selectedParcelId={selectedParcelId}
            onSelectParcel={onSelectParcel}
            hunterGps={hunterGps}
            isTrespassingRed={isTrespassingRed}
            activePinCategoryToDrop={activePinCategoryToDrop}
            onDropPinAt={onDropPinAt}
            showAllKansasLines={showAllKansasLines}
          />

          {/* Tap-Anywhere Inspection Crosshair Marker */}
          {inspectingCoords && (
            <AdvancedMarker position={inspectingCoords} zIndex={110}>
              <div className="flex flex-col items-center">
                <div className="px-2.5 py-0.5 rounded-full bg-[#ea580c] text-white font-bold text-[10px] shadow-xl flex items-center gap-1 whitespace-nowrap">
                  {isInspectingPoint && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{isInspectingPoint ? 'Pulling Owner...' : 'Selected Spot'}</span>
                </div>
                <div className="w-3.5 h-3.5 rounded-full bg-[#f97316] border-2 border-white shadow-lg mt-0.5" />
              </div>
            </AdvancedMarker>
          )}

          {/* In-Parcel Owner & Acreage Labels (Visible when zoomed in >= 14; prioritize parcels with phones) */}
          {currentZoomDisplay >= 14 &&
            [...parcels]
              .filter((p) => {
                const hasPhone = Boolean(p.savedOwnerPhone || p.publicPhoneListing || p.publicPhoneListings?.length);
                return currentZoomDisplay >= 15 || p.acres >= 10 || p.id === selectedParcelId || hasPhone;
              })
              .sort((a, b) => {
                const aHas = Number(Boolean(a.savedOwnerPhone || a.publicPhoneListing || a.publicPhoneListings?.length));
                const bHas = Number(Boolean(b.savedOwnerPhone || b.publicPhoneListing || b.publicPhoneListings?.length));
                return bHas - aHas || (b.acres || 0) - (a.acres || 0);
              })
              .slice(0, 75)
              .map((p) => (
                <AdvancedMarker
                  key={`lbl-${p.id}`}
                  position={p.center}
                  onClick={() => onSelectParcel(p)}
                >
                  <div
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold leading-tight text-center pointer-events-auto cursor-pointer shadow-md border ${
                      p.id === selectedParcelId
                        ? 'bg-[#ea580c] text-white border-white scale-105'
                        : p.permissionStatus === 'PUBLIC'
                        ? 'bg-purple-950/92 text-purple-100 border-purple-400/70'
                        : p.permissionStatus === 'YES'
                        ? 'bg-[#182912]/92 text-[#d9f99d] border-[#65a30d]/80'
                        : p.permissionStatus === 'NO_GO'
                        ? 'bg-red-950/92 text-red-100 border-red-400/70'
                        : 'bg-[#131810]/90 text-[#f4f1ea] border-[#48593d]'
                    }`}
                  >
                    <div className="max-w-[125px] truncate">{p.ownerName.split('/')[0].trim()}</div>
                    <div className="font-mono text-[9px] opacity-90">
                      {p.acres > 0 ? `${p.acres.toFixed(1)} ac` : p.permissionStatus}
                      {p.livesOnLand ? ' · LIVES HERE' : ''}
                    </div>
                    {(() => {
                      const primaryPhone =
                        p.savedOwnerPhone || p.publicPhoneListing || p.publicPhoneListings?.[0]?.number;
                      if (!primaryPhone) return null;
                      const phoneCount = Math.max(p.publicPhoneListings?.length || 0, 1);
                      return (
                        <div className="font-mono text-[9px] text-[#84cc16] font-bold mt-0.5">
                          {`${primaryPhone}${phoneCount > 1 ? ` +${phoneCount - 1}` : ''}`}
                        </div>
                      );
                    })()}
                  </div>
                </AdvancedMarker>
              ))}

          {/* LIVE BLAZE GPS DOT (Draggable to test walking across property lines!) */}
          <AdvancedMarker
            position={hunterGps}
            draggable={true}
            onDragEnd={(e) => {
              if (e.latLng) {
                onMoveHunterGps({ lat: e.latLng.lat(), lng: e.latLng.lng() });
              }
            }}
            zIndex={100}
            title="Your Live GPS (Drag to simulate walking across property lines)"
          >
            <div className="relative flex items-center justify-center">
              <div
                className={`w-5 h-5 rounded-full border-[3px] border-white shadow-lg ${
                  isTrespassingRed ? 'bg-red-600' : 'bg-[#ea580c]'
                }`}
              />
            </div>
          </AdvancedMarker>

          {/* CREW LIVE BUDDY MARKERS */}
          {showCrewGps &&
            crewMembers
              .filter((m) => m.sharingLiveGps && m.id !== 'crew-josh')
              .map((buddy) => (
                <AdvancedMarker
                  key={buddy.id}
                  position={{ lat: buddy.lat, lng: buddy.lng }}
                  zIndex={90}
                >
                  <div className="flex flex-col items-center">
                    <div className="px-2 py-0.5 rounded-lg bg-[#162411]/95 border border-[#84cc16] text-[10px] font-bold text-[#ecfccb] shadow-lg whitespace-nowrap">
                      {buddy.name.split(' ')[0]} · Hunting
                    </div>
                    <div className="w-3 h-3 rounded-full bg-[#84cc16] border-2 border-white mt-0.5" />
                  </div>
                </AdvancedMarker>
              ))}

          {/* DROPPED FIELD PINS */}
          {pins.map((pin) => {
            const meta = PIN_CATEGORIES.find((c) => c.category === pin.category) || PIN_CATEGORIES[0];
            return (
              <AdvancedMarker
                key={pin.id}
                position={{ lat: pin.lat, lng: pin.lng }}
                zIndex={85}
                title={`${pin.category}: ${pin.label}`}
              >
                <div
                  className="px-1.5 py-0.5 rounded-full bg-[#11150e]/95 border-2 text-[9px] font-mono font-bold shadow-lg"
                  style={{ borderColor: meta.color, color: meta.color }}
                >
                  {meta.short}
                </div>
              </AdvancedMarker>
            );
          })}

          {/* AI E-SCOUT TACTICAL OVERLAY MARKERS */}
          {activeEScout &&
            activeEScout.zones.map((z) => {
              const colorMap: Record<string, string> = {
                BEDDING: '#a855f7',
                FUNNEL: '#f97316',
                FOOD: '#84cc16',
                STAND: '#c29b6c',
              };
              const c = colorMap[z.type] || '#f97316';
              return (
                <AdvancedMarker
                  key={z.id}
                  position={{ lat: z.lat, lng: z.lng }}
                  zIndex={95}
                >
                  <div
                    className="px-2 py-1 rounded-xl bg-[#11150e]/95 border-2 text-[10px] font-bold text-[#f4f1ea] shadow-xl max-w-[150px]"
                    style={{ borderColor: c }}
                  >
                    <span className="font-mono" style={{ color: c }}>
                      AI {z.type}
                    </span>
                    <div className="truncate font-normal text-[#d6cebc]">{z.label}</div>
                  </div>
                </AdvancedMarker>
              );
            })}
        </GoogleMap>
      </div>

      {/* TOP HUD ROWS 2 & 3 (BELOW SEARCH BAR): WEATHER/STATUS STRIP + COUNTY QUICK-JUMP BAR */}
      <div className="absolute top-[52px] left-2.5 right-2.5 z-20 flex flex-col items-start gap-1.5 pointer-events-none">
        {/* ROW 2: WIND / TEMP + PARCEL BORDERS + OFFLINE CACHE + INSTALL */}
        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5"
        >
          <button
            onClick={onCycleWind}
            title={legalLightWindow ? `Legal Shooting Light: ${legalLightWindow}` : 'Tap to test wind setups'}
            className="shrink-0 px-3 py-1.5 rounded-2xl bg-[#12170f]/95 backdrop-blur-md border border-[#323f2a] hover:border-[#ea580c] text-[11px] font-mono text-[#f97316] font-bold flex items-center gap-1.5 shadow-xl whitespace-nowrap"
          >
            <Wind className="w-3.5 h-3.5 text-[#f97316] shrink-0" />
            <span>
              {windDir} {windSpeedMph} mph
              {weatherTempF !== null && weatherTempF !== undefined ? ` · ${weatherTempF}°F` : ''}
            </span>
            <span className="text-[#b7ad96] font-normal">· {distanceToNearestLineFt} ft</span>
          </button>

          {isLoadingParcels ? (
            <div className="shrink-0 px-3 py-1.5 rounded-2xl bg-[#12170f]/95 border border-[#323f2a] text-[11px] text-[#f97316] flex items-center gap-1.5 shadow-xl whitespace-nowrap">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Loading KS Parcels...</span>
            </div>
          ) : (
            <div className="shrink-0 px-3 py-1.5 rounded-2xl bg-[#12170f]/92 border border-[#2d3826] text-[11px] font-mono text-[#d6cebc] flex items-center gap-1.5 shadow-lg whitespace-nowrap">
              <span>{parcels.length} Borders</span>
              {gisSourcesActive.length > 0 && (
                <span className="text-[#84cc16]">· {gisSourcesActive[0]}</span>
              )}
            </div>
          )}

          <div className="shrink-0 flex items-center">
            <OfflineIndicator forceOfflineMode={isOfflineMode} cachedTileCount={cachedTileCount} />
          </div>

          <div className="shrink-0 flex items-center">
            <PWAInstallButton compact />
          </div>
        </div>

        {/* ROW 3: KANSAS COUNTY QUICK-JUMP STRIP */}
        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="pointer-events-auto flex items-center gap-1 bg-[#12170f]/95 backdrop-blur-md border border-[#323f2a] px-2 py-1 rounded-2xl shadow-xl overflow-x-auto max-w-full"
        >
          <span className="text-[10px] font-mono font-bold text-[#9c927d] uppercase tracking-wider px-1 shrink-0">
            KS:
          </span>
          {KANSAS_QUICK_REGIONS.map((reg) => (
            <button
              key={reg.id}
              onClick={() => onJumpToRegion(reg.center, reg.zoom)}
              className="px-2.5 py-1 rounded-xl text-[11px] font-semibold text-[#e6e0d2] hover:bg-[#232d1d] hover:text-[#f97316] transition-colors whitespace-nowrap shrink-0"
            >
              {reg.label}
            </button>
          ))}
        </div>
      </div>

      {/* FLOATING RIGHT-EDGE NATIVE HUNTING APP RAIL (POSITIONED BELOW TOP HUD) */}
      <div className="absolute top-[122px] right-2.5 bottom-3 z-20 flex items-start gap-2 pointer-events-none">
        {/* FLYOUT MENUS RENDERED OUTSIDE SCROLL CONTAINER SO THEY ARE NEVER CLIPPED */}
        {showLayerMenu && (
          <div className="pointer-events-auto w-52 bg-[#131810]/96 backdrop-blur-xl border border-[#34422c] rounded-2xl p-2 shadow-2xl space-y-1 animate-sheet-up">
            <div className="text-[10px] font-mono font-bold text-[#9c927d] uppercase px-2.5 pb-1 border-b border-[#25301f]">
              Map Layer
            </div>
            {(
              [
                { id: 'HYBRID', label: 'Hybrid (Sat + Roads)' },
                { id: 'SATELLITE', label: 'Satellite (Timber)' },
                { id: 'TOPO', label: 'Topo / Ridges' },
                { id: 'ROADMAP', label: 'Street Map' },
                { id: 'NIGHT', label: '5AM Night Red' },
              ] as { id: MapLayerMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  onChangeMapLayer(opt.id);
                  setShowLayerMenu(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  mapLayer === opt.id
                    ? 'bg-[#ea580c] text-white font-bold'
                    : 'text-[#e6e0d2] hover:bg-[#1f2919]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {showPinMenu && (
          <div className="pointer-events-auto w-56 bg-[#131810]/96 backdrop-blur-xl border border-[#34422c] rounded-2xl p-2.5 shadow-2xl animate-sheet-up">
            <div className="text-[10px] font-mono font-bold text-[#9c927d] uppercase px-1 pb-1.5 mb-1.5 border-b border-[#25301f]">
              Tap Pin, Then Tap Map
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {PIN_CATEGORIES.map((item) => (
                <button
                  key={item.category}
                  onClick={() => {
                    onSetPinCategoryToDrop(item.category);
                    setShowPinMenu(false);
                  }}
                  className="px-2.5 py-2 rounded-xl bg-[#1b2316] hover:bg-[#273320] border border-[#2d3826] text-xs font-semibold text-[#f4f1ea] flex items-center gap-1.5"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="truncate">{item.category}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="pointer-events-auto max-h-full overflow-y-auto touch-scroll-y flex flex-col items-end gap-1.5 pb-2"
        >
          <button
            onClick={() => {
              setShowLayerMenu((v) => !v);
              setShowPinMenu(false);
            }}
            title="Switch Map View"
            className="w-11 h-11 shrink-0 rounded-2xl bg-[#12170f]/92 hover:bg-[#1f2919] backdrop-blur-md border border-[#34422c] text-[#f4f1ea] flex flex-col items-center justify-center shadow-xl"
          >
            <Layers className="w-4 h-4 text-[#f97316]" />
            <span className="text-[8px] font-bold mt-0.5">{mapLayer === 'NIGHT' ? 'RED' : mapLayer.slice(0, 3)}</span>
          </button>

          <button
            onClick={() => setShowAllKansasLines((v) => !v)}
            title="Toggle All 105 Kansas County Property Lines"
            className={`w-11 h-11 shrink-0 rounded-2xl backdrop-blur-md border flex flex-col items-center justify-center shadow-xl transition-colors ${
              showAllKansasLines
                ? 'bg-[#ea580c] border-[#fb923c] text-white'
                : 'bg-[#12170f]/92 hover:bg-[#1f2919] border-[#34422c] text-[#b7ad96]'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">LINES</span>
          </button>

          <button
            onClick={onToggle3DTilt}
            title="3D Terrain Tilt"
            className={`w-11 h-11 shrink-0 rounded-2xl backdrop-blur-md border flex flex-col items-center justify-center shadow-xl transition-colors ${
              is3DTilt
                ? 'bg-[#3f7d20] border-[#65a30d] text-white'
                : 'bg-[#12170f]/92 hover:bg-[#1f2919] border-[#34422c] text-[#d6cebc]'
            }`}
          >
            <Mountain className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">3D</span>
          </button>

          <button
            onClick={() => onOpenStreetView(mapCenter)}
            title="Open Gate Street View"
            className="w-11 h-11 shrink-0 rounded-2xl bg-[#12170f]/92 hover:bg-[#1f2919] backdrop-blur-md border border-[#34422c] text-[#c29b6c] flex flex-col items-center justify-center shadow-xl"
          >
            <Eye className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">ST VW</span>
          </button>

          <button
            onClick={() => {
              setShowPinMenu((v) => !v);
              setShowLayerMenu(false);
            }}
            title="Drop Hunting Pin"
            className={`w-11 h-11 shrink-0 rounded-2xl backdrop-blur-md border flex flex-col items-center justify-center shadow-xl transition-colors ${
              activePinCategoryToDrop
                ? 'bg-[#ea580c] border-white text-white'
                : 'bg-[#12170f]/92 hover:bg-[#1f2919] border-[#34422c] text-[#f4f1ea]'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">PIN</span>
          </button>

          <button
            onClick={handleLocateMe}
            title="Center on My Live GPS"
            className="w-11 h-11 shrink-0 rounded-2xl bg-[#12170f]/92 hover:bg-[#1f2919] backdrop-blur-md border border-[#34422c] text-[#84cc16] flex flex-col items-center justify-center shadow-xl"
          >
            <LocateFixed className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">GPS</span>
          </button>

          <button
            onClick={onToggleCrewGps}
            title="Show Crew Buddies on Map"
            className={`w-11 h-11 shrink-0 rounded-2xl backdrop-blur-md border flex flex-col items-center justify-center shadow-xl ${
              showCrewGps
                ? 'bg-[#3f7d20] border-[#84cc16] text-white'
                : 'bg-[#12170f]/92 border-[#34422c] text-[#b7ad96]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">CREW</span>
          </button>

          <button
            onClick={isOfflineDownloaded ? onToggleOfflineMode : onDownloadOfflineCounty}
            title={
              cachedTileCount > 0
                ? `Offline Field Cache (${cachedTileCount} tiles & parcels ready) — tap to toggle Offline Mode`
                : 'Download Offline Field Cache for current area'
            }
            className={`w-11 h-11 shrink-0 rounded-2xl backdrop-blur-md border flex flex-col items-center justify-center shadow-xl ${
              isOfflineMode
                ? 'bg-[#ea580c] border-[#fb923c] text-white'
                : 'bg-[#12170f]/92 border-[#34422c] text-[#84cc16]'
            }`}
          >
            {isOfflineMode ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
            <span className="text-[8px] font-bold mt-0.5">
              {downloadProgress !== null ? `${downloadProgress}%` : isOfflineMode ? `OFF(${pendingSyncCount})` : 'SYNC'}
            </span>
          </button>

          <button
            onClick={() =>
              onMoveHunterGps(
                isTrespassingRed ? { lat: 37.8193, lng: -96.7506 } : { lat: 37.8143, lng: -96.7517 }
              )
            }
            title="Simulate Walking Into Red (No Go) Parcel"
            className={`w-11 h-11 shrink-0 rounded-2xl backdrop-blur-md border flex flex-col items-center justify-center shadow-xl ${
              isTrespassingRed
                ? 'bg-red-600 border-white text-white animate-pulse'
                : 'bg-[#12170f]/92 border-red-900/70 text-red-400 hover:bg-red-950/80'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">ALERT</span>
          </button>
        </div>
      </div>

      {/* ACTIVE PIN-DROP INSTRUCTION CHIP */}
      {activePinCategoryToDrop && (
        <div className="absolute top-[124px] left-1/2 -translate-x-1/2 z-30 bg-[#ea580c] text-white px-4 py-2 rounded-full font-bold text-xs shadow-2xl flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          <span>Tap map to drop {activePinCategoryToDrop} pin</span>
          <button
            onClick={() => onSetPinCategoryToDrop(null)}
            className="ml-1 px-2 py-0.5 rounded-full bg-[#11150e] text-white text-[10px]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* COMPACT BOTTOM-LEFT COLOR LEGEND */}
      <div className="absolute bottom-3 left-3 z-10 hidden md:flex items-center gap-3 bg-[#12170f]/90 backdrop-blur-md border border-[#2d3826] px-3 py-1.5 rounded-2xl text-[11px] text-[#e6e0d2] shadow-lg">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#65a30d]" />Yes</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#f97316]" />Ask</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />No Go</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500" />WIHA</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#c29b6c]" />Leased</span>
        {currentZoomDisplay < 15 ? (
          <span className="text-[#f97316] font-semibold ml-1">· Zoom to z15 for all KS property lines</span>
        ) : (
          <span className="text-[#84cc16] font-semibold ml-1">· Tap any parcel for owner categories</span>
        )}
      </div>

      {/* GOOGLE STREET VIEW MODAL */}
      {streetViewCoords && (
        <StreetViewOverlay coords={streetViewCoords} onClose={onCloseStreetView} />
      )}
    </div>
  );
};
