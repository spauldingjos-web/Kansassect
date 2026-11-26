import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Layers,
  Mountain,
  Wind,
  Plus,
  Users,
  ShieldAlert,
  WifiOff,
  Wifi,
  Compass,
  Eye,
  MapPin,
  Loader2,
  LocateFixed,
  Signpost,
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

interface KansasFallbackMapProps {
  parcels: HuntingParcel[];
  selectedParcelId: string | null;
  onSelectParcel: (parcel: HuntingParcel) => void;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  onCameraChange: (
    center: { lat: number; lng: number },
    zoom: number,
    bounds?: { north: number; south: number; east: number; west: number }
  ) => void;
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
  { stroke: string; fill: string; fillOpacity: number; selectedOpacity: number }
> = {
  YES: { stroke: '#65a30d', fill: '#4d7c0f', fillOpacity: 0.24, selectedOpacity: 0.44 },
  ASK: { stroke: '#f97316', fill: '#ea580c', fillOpacity: 0.22, selectedOpacity: 0.42 },
  NO_GO: { stroke: '#ef4444', fill: '#dc2626', fillOpacity: 0.28, selectedOpacity: 0.48 },
  UNKNOWN: { stroke: '#e7e5dc', fill: '#6c7761', fillOpacity: 0.06, selectedOpacity: 0.28 },
  PUBLIC: { stroke: '#c084fc', fill: '#a855f7', fillOpacity: 0.25, selectedOpacity: 0.44 },
  LEASED: { stroke: '#c29b6c', fill: '#9a7248', fillOpacity: 0.24, selectedOpacity: 0.42 },
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const KansasFallbackMap: React.FC<KansasFallbackMapProps> = ({
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
  onJumpToRegion,
  onInspectCoordinate,
  inspectingCoords,
  isInspectingPoint,
  weatherTempF,
  legalLightWindow,
  cachedTileCount = 0,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayersRef = useRef<L.TileLayer[]>([]);
  const streetLabelsLayersRef = useRef<L.TileLayer[]>([]);
  const regridLayerRef = useRef<L.TileLayer | null>(null);
  const parcelLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const labelLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const gpsCircleRef = useRef<L.Circle | null>(null);
  const gpsMarkerRef = useRef<L.Marker | null>(null);
  const prevTargetRef = useRef<string>('');

  // Keep latest callbacks in refs so Leaflet event listeners never go stale
  const onCameraChangeRef = useRef(onCameraChange);
  const onInspectCoordRef = useRef(onInspectCoordinate);
  const onDropPinAtRef = useRef(onDropPinAt);
  const activePinRef = useRef(activePinCategoryToDrop);
  const onMoveHunterGpsRef = useRef(onMoveHunterGps);

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
    onInspectCoordRef.current = onInspectCoordinate;
    onDropPinAtRef.current = onDropPinAt;
    activePinRef.current = activePinCategoryToDrop;
    onMoveHunterGpsRef.current = onMoveHunterGps;
  }, [onCameraChange, onInspectCoordinate, onDropPinAt, activePinCategoryToDrop, onMoveHunterGps]);

  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showPinMenu, setShowPinMenu] = useState(false);
  const [showAllKansasLines, setShowAllKansasLines] = useState(true);
  const [showStreetLabels, setShowStreetLabels] = useState(true);
  const [currentZoomDisplay, setCurrentZoomDisplay] = useState(mapZoom);

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [mapCenter.lat, mapCenter.lng],
      zoom: mapZoom,
      zoomControl: false,
      attributionControl: false,
      maxZoom: 19,
      minZoom: 6,
    });

    // Dedicated top-level pane for state, town, county & street labels above parcel fills (non-blocking)
    const labelsPane = map.createPane('labelsPane');
    labelsPane.style.zIndex = '450';
    labelsPane.style.pointerEvents = 'none';

    parcelLayerGroupRef.current = L.layerGroup().addTo(map);
    labelLayerGroupRef.current = L.layerGroup().addTo(map);
    markersLayerGroupRef.current = L.layerGroup().addTo(map);

    const emitBounds = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      const b = map.getBounds();
      setCurrentZoomDisplay(Math.round(z));
      onCameraChangeRef.current(
        { lat: c.lat, lng: c.lng },
        z,
        {
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        }
      );
    };

    map.on('moveend', emitBounds);
    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      if (activePinRef.current) {
        onDropPinAtRef.current(lat, lng, activePinRef.current);
        return;
      }
      onInspectCoordRef.current({ lat, lng });
    });

    mapRef.current = map;

    // Trigger initial Kansas parcel fetch for viewport immediately
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
        emitBounds();
      }
    }, 120);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly/pan camera when targetCenter/targetZoom changes externally (search, region jump, Hunt Today)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${mapCenter.lat.toFixed(5)},${mapCenter.lng.toFixed(5)},${mapZoom}`;
    if (prevTargetRef.current !== key) {
      prevTargetRef.current = key;
      const cur = map.getCenter();
      const dist = Math.hypot(cur.lat - mapCenter.lat, cur.lng - mapCenter.lng);
      if (dist > 0.0005 || Math.abs(map.getZoom() - mapZoom) >= 0.5) {
        map.setView([mapCenter.lat, mapCenter.lng], mapZoom, { animate: true });
      }
    }
  }, [mapCenter, mapZoom]);

  // Switch Base Map Layers (Satellite, Hybrid, Topo, Roadmap, 5AM Night Red)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    baseLayersRef.current.forEach((layer) => map.removeLayer(layer));
    baseLayersRef.current = [];

    const created: L.TileLayer[] = [];

    if (mapLayer === 'TOPO') {
      created.push(
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 19, maxNativeZoom: 18, zIndex: 10 }
        ).addTo(map)
      );
    } else if (mapLayer === 'ROADMAP') {
      created.push(
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          zIndex: 10,
        }).addTo(map)
      );
    } else {
      // HYBRID, SATELLITE & NIGHT: High-Res Esri World Imagery Satellite
      created.push(
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 19, maxNativeZoom: 18, zIndex: 10 }
        ).addTo(map)
      );
    }

    baseLayersRef.current = created;
  }, [mapLayer]);

  // Crisp State, County, Town, Highway & Street Name Overlays (Esri Reference Layers on top-level labelsPane)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    streetLabelsLayersRef.current.forEach((layer) => map.removeLayer(layer));
    streetLabelsLayersRef.current = [];

    // ROADMAP (OSM) and TOPO (Esri World_Topo_Map) already bake all states, towns & streets into the base tiles
    if (!showStreetLabels || mapLayer === 'ROADMAP' || mapLayer === 'TOPO') return;

    const layers: L.TileLayer[] = [
      // Roads, highways, county roads & every rural/city street name
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        {
          pane: 'labelsPane',
          maxZoom: 19,
          maxNativeZoom: 18,
          opacity: 0.92,
          zIndex: 451,
        }
      ).addTo(map),
      // State names, state borders, county names, cities & every Kansas town name
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          pane: 'labelsPane',
          maxZoom: 19,
          maxNativeZoom: 18,
          opacity: 1,
          zIndex: 452,
        }
      ).addTo(map),
    ];

    streetLabelsLayersRef.current = layers;
  }, [mapLayer, showStreetLabels]);

  // Mount Statewide Regrid Nationwide Parcel Boundaries Tile Layer (ALL 105 KS Counties!)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (regridLayerRef.current) {
      map.removeLayer(regridLayerRef.current);
      regridLayerRef.current = null;
    }

    if (showAllKansasLines) {
      regridLayerRef.current = L.tileLayer(
        'https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}',
        {
          minZoom: 15,
          maxNativeZoom: 17,
          maxZoom: 19,
          opacity: 0.92,
          zIndex: 400,
        }
      ).addTo(map);
    }
  }, [showAllKansasLines]);

  // Render Clickable Kansas Parcel & WIHA Boundary Polygons + Owner/Acreage Labels
  useEffect(() => {
    const polyGroup = parcelLayerGroupRef.current;
    const labelGroup = labelLayerGroupRef.current;
    if (!polyGroup || !labelGroup) return;

    polyGroup.clearLayers();
    labelGroup.clearLayers();

    for (const parcel of parcels) {
      if (!parcel.rings?.length) continue;
      const isSelected = parcel.id === selectedParcelId;
      const st = STATUS_STYLE[parcel.permissionStatus] || STATUS_STYLE.UNKNOWN;
      const latlngs = parcel.rings.map((ring) =>
        ring.map((pt) => [pt.lat, pt.lng] as [number, number])
      );

      const poly = L.polygon(latlngs, {
        color: isSelected ? '#f97316' : st.stroke,
        opacity: 0.96,
        weight: isSelected ? 4.5 : parcel.permissionStatus === 'UNKNOWN' ? 1.8 : 3.2,
        fillColor: st.fill,
        fillOpacity: isSelected ? st.selectedOpacity : st.fillOpacity,
      });

      poly.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        if (activePinRef.current) {
          onDropPinAtRef.current(e.latlng.lat, e.latlng.lng, activePinRef.current);
          return;
        }
        onSelectParcel(parcel);
      });

      poly.addTo(polyGroup);
      if (isSelected) poly.bringToFront();
    }

    // In-Parcel Owner & Acreage Labels (Visible at zoom >= 14; prioritize parcels with phone numbers)
    if (currentZoomDisplay >= 14) {
      const hasPhone = (p: HuntingParcel) =>
        Boolean(p.savedOwnerPhone || p.publicPhoneListing || p.publicPhoneListings?.length);
      const labeled = [...parcels]
        .filter((p) => currentZoomDisplay >= 15 || p.acres >= 10 || p.id === selectedParcelId || hasPhone(p))
        .sort((a, b) => Number(hasPhone(b)) - Number(hasPhone(a)) || (b.acres || 0) - (a.acres || 0))
        .slice(0, 75);

      for (const p of labeled) {
        const isSelected = p.id === selectedParcelId;
        const badgeClass = isSelected
          ? 'bg-[#ea580c] text-white border-white'
          : p.permissionStatus === 'PUBLIC'
          ? 'bg-purple-950/92 text-purple-100 border-purple-400/70'
          : p.permissionStatus === 'YES'
          ? 'bg-[#182912]/92 text-[#d9f99d] border-[#65a30d]/80'
          : p.permissionStatus === 'NO_GO'
          ? 'bg-red-950/92 text-red-100 border-red-400/70'
          : 'bg-[#131810]/90 text-[#f4f1ea] border-[#48593d]';

        const ownerShort = escapeHtml(p.ownerName.split('/')[0].trim());
        const primaryPhone = p.savedOwnerPhone || p.publicPhoneListing || p.publicPhoneListings?.[0]?.number;
        const phoneCount = Math.max(
          p.publicPhoneListings?.length || 0,
          primaryPhone ? 1 : 0
        );
        const subText = `${p.acres > 0 ? `${p.acres.toFixed(1)} ac` : p.permissionStatus}${
          p.livesOnLand ? ' · LIVES HERE' : ''
        }`;
        const phoneHtml = primaryPhone
          ? `<div class="font-mono text-[9px] text-[#84cc16] font-bold mt-0.5">${escapeHtml(
              `${primaryPhone}${phoneCount > 1 ? ` +${phoneCount - 1}` : ''}`
            )}</div>`
          : '';

        const icon = L.divIcon({
          className: 'bg-transparent border-0',
          html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;" class="px-2 py-0.5 rounded-md text-[10px] font-bold leading-tight text-center shadow-md border ${badgeClass}"><div style="max-width:125px;overflow:hidden;text-overflow:ellipsis;">${ownerShort}</div><div class="font-mono text-[9px] opacity-90">${escapeHtml(
            subText
          )}</div>${phoneHtml}</div>`,
          iconSize: [0, 0],
        });

        const m = L.marker([p.center.lat, p.center.lng], { icon, zIndexOffset: isSelected ? 600 : 100 });
        m.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onSelectParcel(p);
        });
        m.addTo(labelGroup);
      }
    }
  }, [parcels, selectedParcelId, currentZoomDisplay, onSelectParcel]);

  // Render Live 50ft GPS Circle + Draggable Blue GPS Dot
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!gpsCircleRef.current) {
      gpsCircleRef.current = L.circle([hunterGps.lat, hunterGps.lng], {
        radius: 15.24, // Exact 50 feet in meters
        interactive: false,
      }).addTo(map);
    }

    gpsCircleRef.current.setLatLng([hunterGps.lat, hunterGps.lng]);
    gpsCircleRef.current.setStyle({
      color: isTrespassingRed ? '#ef4444' : '#f97316',
      opacity: 0.9,
      weight: 2,
      fillColor: isTrespassingRed ? '#ef4444' : '#ea580c',
      fillOpacity: isTrespassingRed ? 0.35 : 0.2,
    });

    const dotIcon = L.divIcon({
      className: 'bg-transparent border-0',
      html: `<div style="transform:translate(-50%,-50%);" class="w-5 h-5 rounded-full border-[3px] border-white shadow-lg ${
        isTrespassingRed ? 'bg-red-600' : 'bg-[#ea580c]'
      }"></div>`,
      iconSize: [0, 0],
    });

    if (!gpsMarkerRef.current) {
      const m = L.marker([hunterGps.lat, hunterGps.lng], {
        icon: dotIcon,
        draggable: true,
        zIndexOffset: 1000,
        title: 'Your Live GPS (Drag to simulate walking across property lines)',
      }).addTo(map);

      m.on('dragend', () => {
        const pos = m.getLatLng();
        onMoveHunterGpsRef.current({ lat: pos.lat, lng: pos.lng });
      });

      gpsMarkerRef.current = m;
    } else {
      gpsMarkerRef.current.setLatLng([hunterGps.lat, hunterGps.lng]);
      gpsMarkerRef.current.setIcon(dotIcon);
    }
  }, [hunterGps, isTrespassingRed]);

  // Render Crew Buddies, Scouting Pins, AI E-Scout Zones & Tap-Anywhere Crosshair
  useEffect(() => {
    const group = markersLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (inspectingCoords) {
      const icon = L.divIcon({
        className: 'bg-transparent border-0',
        html: `<div style="transform:translate(-50%,-100%);" class="flex flex-col items-center"><div class="px-2.5 py-0.5 rounded-full bg-[#ea580c] text-white font-bold text-[10px] shadow-xl whitespace-nowrap">${
          isInspectingPoint ? 'Pulling Owner...' : 'Selected Spot'
        }</div><div class="w-3.5 h-3.5 rounded-full bg-[#f97316] border-2 border-white shadow-lg mt-0.5"></div></div>`,
        iconSize: [0, 0],
      });
      L.marker([inspectingCoords.lat, inspectingCoords.lng], { icon, zIndexOffset: 1100 }).addTo(group);
    }

    if (showCrewGps) {
      crewMembers
        .filter((m) => m.sharingLiveGps && m.id !== 'crew-josh')
        .forEach((buddy) => {
          const icon = L.divIcon({
            className: 'bg-transparent border-0',
            html: `<div style="transform:translate(-50%,-100%);" class="flex flex-col items-center"><div class="px-2 py-0.5 rounded-lg bg-[#162411]/95 border border-[#84cc16] text-[10px] font-bold text-[#ecfccb] shadow-lg whitespace-nowrap">${escapeHtml(
              buddy.name.split(' ')[0]
            )} · Hunting</div><div class="w-3 h-3 rounded-full bg-[#84cc16] border-2 border-white mt-0.5"></div></div>`,
            iconSize: [0, 0],
          });
          L.marker([buddy.lat, buddy.lng], { icon, zIndexOffset: 800 }).addTo(group);
        });
    }

    pins.forEach((pin) => {
      const meta = PIN_CATEGORIES.find((c) => c.category === pin.category) || PIN_CATEGORIES[0];
      const icon = L.divIcon({
        className: 'bg-transparent border-0',
        html: `<div style="transform:translate(-50%,-50%);border-color:${meta.color};color:${meta.color};" class="px-1.5 py-0.5 rounded-full bg-[#11150e]/95 border-2 text-[9px] font-mono font-bold shadow-lg whitespace-nowrap">${meta.short}</div>`,
        iconSize: [0, 0],
      });
      L.marker([pin.lat, pin.lng], { icon, zIndexOffset: 750, title: `${pin.category}: ${pin.label}` }).addTo(group);
    });

    const activeEScout = selectedParcelId ? escoutReports[selectedParcelId] : undefined;
    if (activeEScout) {
      const colorMap: Record<string, string> = {
        BEDDING: '#a855f7',
        FUNNEL: '#f97316',
        FOOD: '#84cc16',
        STAND: '#c29b6c',
      };
      activeEScout.zones.forEach((z) => {
        const c = colorMap[z.type] || '#f97316';
        const icon = L.divIcon({
          className: 'bg-transparent border-0',
          html: `<div style="transform:translate(-50%,-50%);border-color:${c};max-width:150px;" class="px-2 py-1 rounded-xl bg-[#11150e]/95 border-2 text-[10px] font-bold text-[#f4f1ea] shadow-xl"><span class="font-mono" style="color:${c}">AI ${escapeHtml(
            z.type
          )}</span><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" class="font-normal text-[#d6cebc]">${escapeHtml(
            z.label
          )}</div></div>`,
          iconSize: [0, 0],
        });
        L.marker([z.lat, z.lng], { icon, zIndexOffset: 900 }).addTo(group);
      });
    }
  }, [inspectingCoords, isInspectingPoint, showCrewGps, crewMembers, pins, escoutReports, selectedParcelId]);

  const handleLocateMe = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          onMoveHunterGps(coords);
          onJumpToRegion(coords, 15);
        },
        () => {
          onJumpToRegion(hunterGps, 15);
        }
      );
    } else {
      onJumpToRegion(hunterGps, 15);
    }
  };

  return (
    <div className="relative w-full h-full bg-[#0c0f0a] overflow-hidden">
      {/* FULL-SCREEN RED TRESPASS ALERT BANNER */}
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

      {/* REAL INTERACTIVE KANSAS SATELLITE + REGRID ALL-105-COUNTY GIS MAP */}
      <div
        className={`relative z-0 isolate w-full h-full transition-transform duration-300 ${
          mapLayer === 'NIGHT' ? 'night-vision-filter' : ''
        }`}
        style={is3DTilt ? { transform: 'perspective(1100px) rotateX(18deg) scale(1.08)' } : undefined}
      >
        <div ref={containerRef} className="w-full h-full bg-[#0c0f0a]" />
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
            onClick={() => setShowStreetLabels((v) => !v)}
            title="Toggle Street Names & Town Labels"
            className={`w-11 h-11 shrink-0 rounded-2xl backdrop-blur-md border flex flex-col items-center justify-center shadow-xl transition-colors ${
              showStreetLabels
                ? 'bg-[#8c6239] border-[#c29b6c] text-white'
                : 'bg-[#12170f]/92 hover:bg-[#1f2919] border-[#34422c] text-[#b7ad96]'
            }`}
          >
            <Signpost className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">ROADS</span>
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

          <a
            href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${mapCenter.lat},${mapCenter.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Gate Street View"
            className="w-11 h-11 shrink-0 rounded-2xl bg-[#12170f]/92 hover:bg-[#1f2919] backdrop-blur-md border border-[#34422c] text-[#c29b6c] flex flex-col items-center justify-center shadow-xl"
          >
            <Eye className="w-4 h-4" />
            <span className="text-[8px] font-bold mt-0.5">ST VW</span>
          </a>

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
    </div>
  );
};
