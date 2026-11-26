import React, { useState } from 'react';
import {
  FileCheck2,
  Camera,
  Upload,
  Search,
  ShieldAlert,
  Clock,
  BookOpen,
  Award,
  Send,
  Download,
  Lock,
  PhoneCall,
  Wind,
  Moon,
  ChevronRight,
  ChevronDown,
  MapPin,
  Loader2,
  Phone,
  Printer,
  MessageSquare,
  Navigation,
  Sun,
  Plus,
  ExternalLink,
  LogOut,
  UserCheck,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  HuntingParcel,
  TrailCamPhoto,
  CrewMember,
  CrewTask,
  HarvestRecord,
  AuditLogEntry,
  HuntSpecies,
  OwnerPublicIntel,
  FieldPin,
  PinCategory,
  PermissionStatus,
  LiveKansasWeather,
} from '../types/hunting';
import { KANSAS_REGULATIONS, IMG_GATE_PERMISSION } from '../data/kansasParcels';
import { resolveParcelGateDestination } from './WardenSlipModal';
import { PWAInstallButton } from './PWAInstallButton';
import {
  getAllParcelPhones,
  formatPhoneDigits,
  buildPermissionSmsHref,
  PERMISSION_SMS_TEMPLATES,
  PermissionSmsTemplateId,
} from '../utils/phoneUtils';

export interface CustomSpotInput {
  ownerName: string;
  propertyAddress: string;
  county: string;
  acres: number;
  phone?: string;
  permissionStatus: PermissionStatus;
  notes?: string;
}

/* ============================================================================
 * VIEW 1: MY SPOTS — NATIVE PERMISSION BLACK BOOK & DIGITAL SLIPS
 * ============================================================================ */
interface PermissionsViewProps {
  parcels: HuntingParcel[];
  pins?: FieldPin[];
  onSelectParcelOnMap: (parcelId: string) => void;
  onOpenWardenSlip?: (parcel: HuntingParcel) => void;
  onMarkThankYouSent: (parcelId: string) => void;
  onSendLeaseMessage: (parcelId: string, msg: string, offer?: number) => void;
  onBatchScanAllPhones?: () => void;
  isBatchScanningPhones?: boolean;
  onSearchSingleOwnerPhones?: (parcel: HuntingParcel) => void;
  isSearchingSingleOwner?: boolean;
  onSaveOwnerPhone?: (parcelId: string, phone: string, opts?: { asAdditional?: boolean }) => void;
  onAddCustomSpot?: (spot: CustomSpotInput) => void;
  onDeleteSpot?: (parcelId: string) => void;
  onUpdatePermissionStatus?: (parcelId: string, status: PermissionStatus) => void;
  hidePhonesForCrewPrivacy?: boolean;
  publicIntelByParcel?: Record<string, OwnerPublicIntel>;
  hunterName: string;
  hunterPhone?: string;
}

export const PermissionsBlackBookView: React.FC<PermissionsViewProps> = ({
  parcels,
  pins = [],
  onSelectParcelOnMap,
  onOpenWardenSlip,
  onMarkThankYouSent,
  onSendLeaseMessage,
  onBatchScanAllPhones,
  isBatchScanningPhones = false,
  onSearchSingleOwnerPhones,
  isSearchingSingleOwner = false,
  onSaveOwnerPhone,
  onAddCustomSpot,
  onDeleteSpot,
  onUpdatePermissionStatus,
  hidePhonesForCrewPrivacy = false,
  publicIntelByParcel = {},
  hunterName,
  hunterPhone,
}) => {
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PHONES' | 'YES' | 'ASK' | 'LEASED'>('ALL');
  const [expandedParcelId, setExpandedParcelId] = useState<string | null>(null);
  const [quickMessage, setQuickMessage] = useState<Record<string, string>>({});
  const [smsTemplateId, setSmsTemplateId] = useState<PermissionSmsTemplateId>('bow');
  const [customSmsText, setCustomSmsText] = useState('');
  const [showCustomSmsEditor, setShowCustomSmsEditor] = useState(false);
  const [addingPhoneForId, setAddingPhoneForId] = useState<string | null>(null);
  const [newPhoneDraft, setNewPhoneDraft] = useState('');

  // Add Spot Form State
  const [showAddSpotForm, setShowAddSpotForm] = useState(false);
  const [spotOwnerName, setSpotOwnerName] = useState('');
  const [spotAddress, setSpotAddress] = useState('');
  const [spotCounty, setSpotCounty] = useState('Butler County, KS');
  const [spotAcres, setSpotAcres] = useState('80');
  const [spotPhone, setSpotPhone] = useState('');
  const [spotStatus, setSpotStatus] = useState<PermissionStatus>('YES');
  const [spotNotes, setSpotNotes] = useState('');

  const handleSubmitNewSpot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!spotOwnerName.trim() || !onAddCustomSpot) return;
    onAddCustomSpot({
      ownerName: spotOwnerName.trim(),
      propertyAddress: spotAddress.trim() || `${spotCounty} Hunting Tract`,
      county: spotCounty.trim() || 'Kansas',
      acres: Math.max(1, Number(spotAcres) || 80),
      phone: spotPhone.trim() || undefined,
      permissionStatus: spotStatus,
      notes: spotNotes.trim() || undefined,
    });
    setSpotOwnerName('');
    setSpotAddress('');
    setSpotAcres('80');
    setSpotPhone('');
    setSpotNotes('');
    setShowAddSpotForm(false);
  };

  const withPhonesCount = parcels.filter(
    (p) => p.permissionStatus !== 'NO_GO' && getAllParcelPhones(p, publicIntelByParcel[p.id]).length > 0
  ).length;

  const filtered = parcels
    .filter((p) => {
      if (filterStatus === 'ALL') return p.permissionStatus !== 'NO_GO';
      if (filterStatus === 'PHONES') {
        return p.permissionStatus !== 'NO_GO' && getAllParcelPhones(p, publicIntelByParcel[p.id]).length > 0;
      }
      return p.permissionStatus === filterStatus;
    })
    .sort((a, b) => {
      const aPhones = getAllParcelPhones(a, publicIntelByParcel[a.id]);
      const bPhones = getAllParcelPhones(b, publicIntelByParcel[b.id]);
      const aReal = aPhones.some((ph) => !/\b555-/.test(ph.number)) ? 2 : aPhones.length > 0 ? 1 : 0;
      const bReal = bPhones.some((ph) => !/\b555-/.test(ph.number)) ? 2 : bPhones.length > 0 ? 1 : 0;
      return bReal - aReal || bPhones.length - aPhones.length || (b.acres || 0) - (a.acres || 0);
    });

  return (
    <div className="min-h-full bg-[#0c0f0a]">
      {/* Sticky Native Camo App Bar */}
      <div className="camo-header sticky top-0 z-20 border-b border-[#2d3826] px-4 py-3.5">
        <div className="max-w-3xl mx-auto space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="font-display text-2xl font-bold text-[#f4f1ea] leading-none">
                MY SPOTS &amp; PERMISSIONS
              </h1>
              <p className="text-[11px] text-[#b7ad96] mt-0.5">
                {filtered.length} properties · {withPhonesCount} with direct numbers ready to call or text
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onAddCustomSpot && (
                <button
                  type="button"
                  onClick={() => setShowAddSpotForm((v) => !v)}
                  className="px-3 py-2 rounded-xl text-[11px] font-bold bg-[#ea580c] hover:bg-[#f97316] text-white flex items-center gap-1 shadow-md"
                >
                  {showAddSpotForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{showAddSpotForm ? 'Close' : 'Add Spot'}</span>
                </button>
              )}
              {onBatchScanAllPhones && (
                <button
                  type="button"
                  onClick={onBatchScanAllPhones}
                  disabled={isBatchScanningPhones}
                  className="px-3 py-2 rounded-xl text-[11px] font-bold bg-[#232d1d] hover:bg-[#2f3c27] disabled:opacity-60 border border-[#3a4931] text-[#f4f1ea] flex items-center gap-1.5"
                >
                  {isBatchScanningPhones ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#f97316]" />
                  ) : (
                    <Phone className="w-3.5 h-3.5 text-[#f97316]" />
                  )}
                  <span>{isBatchScanningPhones ? 'Scanning...' : 'Scan Phones'}</span>
                </button>
              )}
            </div>
          </div>

          {/* ADD NEW SPOT INLINE FORM */}
          {showAddSpotForm && onAddCustomSpot && (
            <form
              onSubmit={handleSubmitNewSpot}
              className="p-3.5 rounded-2xl bg-[#12180f] border border-[#3f5236] space-y-2.5 text-xs shadow-xl"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-[#84cc16]">
                  + Add New Hunting Spot / Landowner
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddSpotForm(false)}
                  className="text-[#9c927d] hover:text-[#f4f1ea]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={spotOwnerName}
                  onChange={(e) => setSpotOwnerName(e.target.value)}
                  placeholder="Landowner or Spot Name *"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <input
                  type="text"
                  value={spotAddress}
                  onChange={(e) => setSpotAddress(e.target.value)}
                  placeholder="Street Address / Road (optional)"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <input
                  type="text"
                  value={spotCounty}
                  onChange={(e) => setSpotCounty(e.target.value)}
                  placeholder="County (e.g. Butler County, KS)"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="1"
                    value={spotAcres}
                    onChange={(e) => setSpotAcres(e.target.value)}
                    placeholder="Acres (80)"
                    className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                  />
                  <select
                    value={spotStatus}
                    onChange={(e) => setSpotStatus(e.target.value as PermissionStatus)}
                    className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-2.5 py-2 text-xs text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                  >
                    <option value="YES">Status: YES</option>
                    <option value="ASK">Status: ASK</option>
                    <option value="LEASED">Status: LEASED</option>
                    <option value="UNKNOWN">Status: UNKNOWN</option>
                  </select>
                </div>
                <input
                  type="tel"
                  value={spotPhone}
                  onChange={(e) => setSpotPhone(e.target.value)}
                  placeholder="Landowner Phone # (optional)"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs font-mono text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <input
                  type="text"
                  value={spotNotes}
                  onChange={(e) => setSpotNotes(e.target.value)}
                  placeholder="Gate rules, stand notes, or description..."
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddSpotForm(false)}
                  className="px-3 py-1.5 rounded-xl bg-[#1c2317] text-[#b7ad96] font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-[#3f7d20] hover:bg-[#4d9628] text-white font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save Spot</span>
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-5 gap-1 p-1 rounded-2xl bg-[#0e120b]/90 border border-[#2d3826]">
            {(
              [
                { id: 'ALL', label: 'All' },
                { id: 'PHONES', label: `Call/Text (${withPhonesCount})` },
                { id: 'YES', label: 'Yes' },
                { id: 'ASK', label: 'Ask' },
                { id: 'LEASED', label: 'Leased' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterStatus(tab.id)}
                className={`py-2 px-1 rounded-xl text-[11px] font-bold truncate transition-colors ${
                  filterStatus === tab.id
                    ? 'bg-[#ea580c] text-white'
                    : 'text-[#b7ad96] hover:text-[#f4f1ea]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Permission Text Message Preset Bar */}
          <div className="bg-[#0e120b]/85 border border-[#2d3826] rounded-xl px-2.5 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#9c927d]">
                Permission Text · Signed as <strong className="text-[#84cc16]">{hunterName}</strong>
              </span>
              <button
                type="button"
                onClick={() => setShowCustomSmsEditor((v) => !v)}
                className="text-[10px] font-bold text-[#f97316] hover:underline"
              >
                {showCustomSmsEditor ? 'Hide Custom Msg' : 'Customize Text'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {PERMISSION_SMS_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    setSmsTemplateId(tpl.id);
                    setCustomSmsText('');
                  }}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                    smsTemplateId === tpl.id && !customSmsText.trim()
                      ? 'bg-[#3f7d20] border-[#84cc16] text-white'
                      : 'bg-[#161c12] border-[#2d3826] text-[#b7ad96] hover:text-[#f4f1ea]'
                  }`}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
            {showCustomSmsEditor && (
              <textarea
                rows={2}
                value={customSmsText}
                onChange={(e) => setCustomSmsText(e.target.value)}
                placeholder="Write custom ask text (optional tags: {owner}, {acres}, {county}, {section})..."
                className="w-full rounded-lg bg-[#151b12] border border-[#323f2a] px-2.5 py-1.5 text-[11px] text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
              />
            )}
          </div>
        </div>
      </div>

      {/* Native Tap-List of Landowners + All Clickable Phone Lines */}
      <div className="max-w-3xl mx-auto divide-y divide-[#222c1c]">
        {filtered.length === 0 && (
          <div className="p-8 text-center space-y-3">
            <div className="text-sm font-bold text-[#f4f1ea]">No spots in this list yet</div>
            <p className="text-xs text-[#b7ad96] max-w-md mx-auto">
              Tap <strong>+ Add Spot</strong> above to add your own hunting spot, or tap any property on the Map to save it to your spots.
            </p>
            {onAddCustomSpot && !showAddSpotForm && (
              <button
                type="button"
                onClick={() => setShowAddSpotForm(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                <span>Add Your First Spot</span>
              </button>
            )}
          </div>
        )}
        {filtered.map((p) => {
          const isExpanded = expandedParcelId === p.id;
          const ownerPhones = getAllParcelPhones(p, publicIntelByParcel[p.id]);
          const isAddingPhone = addingPhoneForId === p.id;
          const fastPeopleLink = p.publicLinks?.find(
            (l) => l.label === 'FastPeopleSearch' || l.label === 'Whitepages'
          );
          return (
            <div key={p.id} className="bg-[#12170f]">
              <div className="px-4 py-3.5 space-y-2.5 hover:bg-[#161d12] transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedParcelId(isExpanded ? null : p.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2 text-[11px] font-mono text-[#9c927d]">
                      <span
                        className={
                          p.permissionStatus === 'YES'
                            ? 'text-[#84cc16] font-bold'
                            : p.permissionStatus === 'PUBLIC'
                              ? 'text-purple-400 font-bold'
                              : p.permissionStatus === 'LEASED'
                                ? 'text-[#c29b6c] font-bold'
                                : 'text-[#f97316] font-bold'
                        }
                      >
                        {p.permissionStatus}
                      </span>
                      <span>·</span>
                      <span>{p.acres.toFixed(1)} ac</span>
                      <span>·</span>
                      <span className="truncate">{p.county}</span>
                    </div>
                    <div className="text-base font-bold text-[#f4f1ea] truncate mt-0.5">
                      {p.ownerName}
                    </div>
                    <div className="text-xs text-[#b7ad96] truncate">
                      {p.permissionSlip
                        ? `Signed Warden Slip · Expires ${p.permissionSlip.expiresDate}`
                        : p.propertyAddress || p.taxMailingAddress}
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.permissionStatus !== 'PUBLIC' && onSaveOwnerPhone && (
                      <button
                        type="button"
                        onClick={() => {
                          setAddingPhoneForId(isAddingPhone ? null : p.id);
                          setNewPhoneDraft('');
                        }}
                        className="px-2 py-1.5 rounded-lg bg-[#1d2518] hover:bg-[#2a3623] border border-[#323f2a] text-[#d6cebc] text-[11px] font-bold flex items-center gap-1"
                        title="Add phone number for this owner"
                      >
                        <Plus className="w-3 h-3 text-[#f97316]" />
                        <span>#</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectParcelOnMap(p.id)}
                      className="px-2 py-1.5 rounded-lg bg-[#1d2518] hover:bg-[#2a3623] border border-[#323f2a] text-[#d6cebc] text-[11px] font-bold flex items-center gap-1"
                    >
                      <MapPin className="w-3 h-3 text-[#f97316]" />
                      <span>Map</span>
                    </button>
                    {onDeleteSpot && (
                      <button
                        type="button"
                        onClick={() => onDeleteSpot(p.id)}
                        className="p-1.5 rounded-lg bg-[#261414] hover:bg-[#3b1c1c] border border-[#5c2828] text-[#fca5a5] transition-colors"
                        title="Delete this spot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedParcelId(isExpanded ? null : p.id)}
                      aria-label="Toggle spot details"
                      className="p-1 text-[#7a876f] hover:text-[#f4f1ea]"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-[#f97316]" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Inline Add Number Input */}
                {isAddingPhone && onSaveOwnerPhone && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <input
                      type="tel"
                      value={newPhoneDraft}
                      onChange={(e) => setNewPhoneDraft(e.target.value)}
                      placeholder="Add phone (e.g. 620-555-0148)"
                      className="flex-1 rounded-xl bg-[#0e120b] border border-[#3a4931] px-3 py-2 text-xs text-[#f4f1ea] font-mono focus:outline-none focus:border-[#ea580c]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newPhoneDraft.trim()) return;
                        onSaveOwnerPhone(p.id, newPhoneDraft.trim(), {
                          asAdditional: ownerPhones.length > 0,
                        });
                        setNewPhoneDraft('');
                        setAddingPhoneForId(null);
                      }}
                      className="px-3 py-2 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] text-white text-xs font-bold"
                    >
                      Save #
                    </button>
                  </div>
                )}

                {/* ALL PHONE NUMBERS FOR THIS LANDOWNER — ONE-TAP CALL & PERMISSION TEXT */}
                {ownerPhones.length > 0 ? (
                  <div className="space-y-1.5">
                    {ownerPhones.map((ph, idx) => {
                      const digits = formatPhoneDigits(ph.number);
                      const smsHref = buildPermissionSmsHref(
                        ph.number,
                        p,
                        smsTemplateId,
                        customSmsText,
                        hunterName,
                        hunterPhone
                      );
                      return (
                        <div
                          key={`${digits}-${idx}`}
                          className="flex items-center justify-between gap-2 bg-[#0e130b] border border-[#283421] rounded-xl px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-sm text-[#84cc16]">
                              {hidePhonesForCrewPrivacy ? '(•••) •••-••••' : ph.number}
                            </div>
                            <div className="text-[10px] text-[#9c927d] truncate">
                              {ph.label} · {ph.source}
                            </div>
                          </div>
                          {!hidePhonesForCrewPrivacy && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`tel:${digits}`}
                                className="px-3 py-1.5 rounded-lg bg-[#2f6619] hover:bg-[#3f7d20] text-white font-bold text-xs flex items-center gap-1"
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                                <span>Call</span>
                              </a>
                              <a
                                href={smsHref}
                                className="px-3 py-1.5 rounded-lg bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center gap-1"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>Text</span>
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  p.permissionStatus !== 'PUBLIC' && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {onSearchSingleOwnerPhones && (
                        <button
                          type="button"
                          onClick={() => onSearchSingleOwnerPhones(p)}
                          disabled={isSearchingSingleOwner}
                          className="px-2.5 py-1.5 rounded-lg bg-[#232d1d] hover:bg-[#2f3c27] border border-[#3a4931] text-[#f4f1ea] font-bold flex items-center gap-1"
                        >
                          <Search className="w-3 h-3 text-[#f97316]" />
                          <span>Find Public #</span>
                        </button>
                      )}
                      {fastPeopleLink && (
                        <a
                          href={fastPeopleLink.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 rounded-lg bg-[#161c12] hover:bg-[#222c1c] border border-[#2d3826] text-[#b7ad96] font-semibold flex items-center gap-1"
                        >
                          <span>{fastPeopleLink.label}</span>
                          <ExternalLink className="w-3 h-3 text-[#f97316]" />
                        </a>
                      )}
                    </div>
                  )
                )}
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 pt-2 space-y-3 bg-[#0e120b] border-t border-[#222c1c] animate-sheet-up">
                  {/* Quick Permission Status Switcher + Delete */}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-[#141a11] border border-[#2d3826] rounded-xl p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-mono uppercase text-[#9c927d] mr-1">
                        Status:
                      </span>
                      {(['YES', 'ASK', 'LEASED', 'UNKNOWN'] as PermissionStatus[]).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => onUpdatePermissionStatus && onUpdatePermissionStatus(p.id, st)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                            p.permissionStatus === st
                              ? 'bg-[#ea580c] text-white'
                              : 'bg-[#1a2216] text-[#b7ad96] hover:text-[#f4f1ea]'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                    {onDeleteSpot && (
                      <button
                        type="button"
                        onClick={() => onDeleteSpot(p.id)}
                        className="px-2.5 py-1 rounded-lg bg-[#2c1515] hover:bg-[#3f1c1c] border border-[#6e2c2c] text-[#fca5a5] text-[11px] font-bold flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete Spot</span>
                      </button>
                    )}
                  </div>

                  {p.permissionSlip ? (
                    <div className="p-3 rounded-2xl bg-[#162012] border border-[#355528] space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-[#84cc16] flex items-center gap-1.5">
                          <FileCheck2 className="w-4 h-4" />
                          WARDEN SLIP #{p.permissionSlip.id}
                        </span>
                        <span className="font-mono text-[#c29b6c]">
                          Exp {p.permissionSlip.expiresDate}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <img
                          src={p.permissionSlip.gatePhotoUrl || IMG_GATE_PERMISSION}
                          alt="Gate permission verification"
                          referrerPolicy="no-referrer"
                          className="w-20 h-20 object-cover rounded-xl border border-[#2d3826] shrink-0"
                        />
                        <div className="space-y-1 text-[#d6cebc]">
                          <p>
                            <strong className="text-[#f4f1ea]">Species:</strong>{' '}
                            {p.permissionSlip.allowedSpecies.join(', ')}
                          </p>
                          <p>
                            <strong className="text-[#f4f1ea]">Limit:</strong>{' '}
                            {p.permissionSlip.weaponsAllowed} · Max {p.permissionSlip.maxHuntersAtOnce}
                          </p>
                          <p className="text-[#b7ad96]">{p.permissionSlip.rulesAndNotes}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {onOpenWardenSlip && (
                          <button
                            type="button"
                            onClick={() => onOpenWardenSlip(p)}
                            className="py-2 px-3 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Warden Slip</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onMarkThankYouSent(p.id)}
                          className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 ${
                            p.permissionSlip.thankYouSent
                              ? 'bg-[#1f3316] text-[#84cc16] border border-[#3f7d20]'
                              : 'bg-[#232d1d] hover:bg-[#2f3c27] text-[#f4f1ea] border border-[#3a4931]'
                          }`}
                        >
                          <span>{p.permissionSlip.thankYouSent ? 'Thanked ✓' : 'Log Thank-You'}</span>
                        </button>
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${resolveParcelGateDestination(p, pins).lat},${resolveParcelGateDestination(p, pins).lng}&travelmode=driving`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2 px-3 rounded-xl bg-[#2f6619] hover:bg-[#3f7d20] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          <span>Drive Gate</span>
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-2xl bg-[#151b12] border border-[#2d3826] text-xs text-[#d6cebc] space-y-1.5">
                      <p>
                        <strong className="text-[#f4f1ea]">Lives On Land:</strong>{' '}
                        {p.livesOnLand ? 'YES' : 'NO'} — {p.homesteadNote}
                      </p>
                      <p>
                        <strong className="text-[#f4f1ea]">Mailing:</strong> {p.taxMailingAddress}
                      </p>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${resolveParcelGateDestination(p, pins).lat},${resolveParcelGateDestination(p, pins).lng}&travelmode=driving`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-xl bg-[#232d1d] hover:bg-[#2f3c27] border border-[#3a4931] text-[#f4f1ea] font-bold text-[11px]"
                      >
                        <Navigation className="w-3.5 h-3.5 text-[#f97316]" />
                        <span>Drive to Gate</span>
                      </a>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={quickMessage[p.id] || ''}
                      onChange={(e) =>
                        setQuickMessage((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      placeholder={`Log note or lease message for ${p.ownerName.split('/')[0].trim()}...`}
                      className="flex-1 rounded-xl bg-[#151b12] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (quickMessage[p.id] || '').trim();
                        if (!txt) return;
                        onSendLeaseMessage(p.id, txt);
                        setQuickMessage((prev) => ({ ...prev, [p.id]: '' }));
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center gap-1"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ============================================================================
 * VIEW 2: SCOUTING — WEATHER STRIP + SPOTS / PINS + TRAIL CAM HUB
 * ============================================================================ */
interface ScoutingAndCamsViewProps {
  trailCams: TrailCamPhoto[];
  parcels: HuntingParcel[];
  pins?: FieldPin[];
  onUploadAndTagCam: (file: File, parcelId: string, notes: string, customSpotName?: string) => Promise<void>;
  onAddManualCamEntry?: (entry: Omit<TrailCamPhoto, 'id'>) => void;
  onDeleteTrailCam?: (camId: string) => void;
  onAddCustomSpot?: (spot: CustomSpotInput) => void;
  onDeleteSpot?: (parcelId: string) => void;
  onAddFieldPin?: (pin: { label: string; category: PinCategory; parcelId: string; windIdeal?: string; notes?: string }) => void;
  onDeleteFieldPin?: (pinId: string) => void;
  onSelectParcelOnMap?: (parcelId: string) => void;
  isTaggingCam: boolean;
  weather?: LiveKansasWeather | null;
}

export const ScoutingAndCamsView: React.FC<ScoutingAndCamsViewProps> = ({
  trailCams,
  parcels,
  pins = [],
  onUploadAndTagCam,
  onAddManualCamEntry,
  onDeleteTrailCam,
  onAddCustomSpot,
  onDeleteSpot,
  onAddFieldPin,
  onDeleteFieldPin,
  onSelectParcelOnMap,
  isTaggingCam,
  weather,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState<'ALL' | 'Buck' | 'Doe' | 'Coyote' | 'Turkey'>('ALL');
  const [uploadParcelId, setUploadParcelId] = useState(parcels[0]?.id || '');
  const [customUploadSpotName, setCustomUploadSpotName] = useState('');

  // Add Manual Cam / Sighting Form
  const [showAddCamForm, setShowAddCamForm] = useState(false);
  const [manualCamSpotName, setManualCamSpotName] = useState('');
  const [manualCamSpecies, setManualCamSpecies] = useState<TrailCamPhoto['species']>('Buck');
  const [manualCamCount, setManualCamCount] = useState('1');
  const [manualCamTitle, setManualCamTitle] = useState('');
  const [manualCamTip, setManualCamTip] = useState('');
  const [manualCamWind, setManualCamWind] = useState(
    weather ? `${weather.windDir} ${weather.windSpeedMph} mph` : 'NW 11 mph'
  );

  // Add Spot / Cam Pin Form on Cam Page
  const [showAddSpotOrPinForm, setShowAddSpotOrPinForm] = useState(false);
  const [addMode, setAddMode] = useState<'SPOT' | 'PIN'>('SPOT');
  const [newSpotName, setNewSpotName] = useState('');
  const [newSpotAddress, setNewSpotAddress] = useState('');
  const [newSpotCounty, setNewSpotCounty] = useState('Butler County, KS');
  const [newSpotAcres, setNewSpotAcres] = useState('80');
  const [newSpotStatus, setNewSpotStatus] = useState<PermissionStatus>('YES');

  const [newPinLabel, setNewPinLabel] = useState('');
  const [newPinCategory, setNewPinCategory] = useState<PinCategory>('Camera');
  const [newPinWind, setNewPinWind] = useState('NW');
  const [newPinNotes, setNewPinNotes] = useState('');

  const filteredCams = trailCams.filter((cam) => {
    if (speciesFilter !== 'ALL' && cam.species !== speciesFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      cam.parcelName.toLowerCase().includes(q) ||
      cam.species.toLowerCase().includes(q) ||
      cam.classification.toLowerCase().includes(q) ||
      cam.tacticalTip.toLowerCase().includes(q)
    );
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onUploadAndTagCam(
      file,
      uploadParcelId || parcels[0]?.id || '',
      'Field camera upload',
      customUploadSpotName.trim() || undefined
    );
    e.target.value = '';
  };

  const handleCreateManualCam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddManualCamEntry) return;
    const selectedP = parcels.find((p) => p.id === uploadParcelId) || parcels[0];
    const spotLabel =
      manualCamSpotName.trim() ||
      customUploadSpotName.trim() ||
      (selectedP ? selectedP.ownerName.split('/')[0].trim() : 'My Kansas Cam Spot');

    onAddManualCamEntry({
      parcelId: selectedP?.id || `spot-${Date.now()}`,
      parcelName: spotLabel,
      imageUrl: IMG_GATE_PERMISSION,
      species: manualCamSpecies,
      count: Math.max(1, Number(manualCamCount) || 1),
      classification: manualCamTitle.trim() || `${manualCamSpecies} Sighting at ${spotLabel}`,
      capturedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      daysAgo: 0,
      tempF: weather?.tempF || 34,
      windDir: manualCamWind.trim() || 'NW 10 mph',
      moonPhase: 'Field Logged',
      tacticalTip: manualCamTip.trim() || 'Setup downwind on rub line / travel corridor.',
      aiTagged: false,
    });
    setManualCamSpotName('');
    setManualCamTitle('');
    setManualCamTip('');
    setManualCamCount('1');
    setShowAddCamForm(false);
  };

  const handleCreateSpotOrPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (addMode === 'SPOT') {
      if (!newSpotName.trim() || !onAddCustomSpot) return;
      onAddCustomSpot({
        ownerName: newSpotName.trim(),
        propertyAddress: newSpotAddress.trim() || `${newSpotCounty} Cam Spot`,
        county: newSpotCounty.trim() || 'Kansas',
        acres: Math.max(1, Number(newSpotAcres) || 80),
        permissionStatus: newSpotStatus,
      });
      setNewSpotName('');
      setNewSpotAddress('');
      setShowAddSpotOrPinForm(false);
    } else {
      if (!newPinLabel.trim() || !onAddFieldPin) return;
      onAddFieldPin({
        label: newPinLabel.trim(),
        category: newPinCategory,
        parcelId: uploadParcelId || parcels[0]?.id || 'kansas-map',
        windIdeal: newPinWind.trim() || 'NW',
        notes: newPinNotes.trim() || `${newPinCategory} location`,
      });
      setNewPinLabel('');
      setNewPinNotes('');
      setShowAddSpotOrPinForm(false);
    }
  };

  const forecastDays = weather?.forecast7Day?.length
    ? weather.forecast7Day
    : [
        { day: 'Today', wind: 'NW 11', temp: '28°/46°', rating: 'PEAK FRONT', legalLight: '6:49 AM – 5:44 PM' },
        { day: 'Thu', wind: 'NNW 9', temp: '25°/44°', rating: 'EXCELLENT', legalLight: '6:50 AM – 5:44 PM' },
        { day: 'Fri', wind: 'W 7', temp: '31°/51°', rating: 'GOOD', legalLight: '6:51 AM – 5:43 PM' },
      ];

  return (
    <div className="min-h-full bg-[#0c0f0a]">
      {/* Sticky Native Camo Header */}
      <div className="camo-header sticky top-0 z-20 border-b border-[#2d3826] px-4 py-3.5">
        <div className="max-w-3xl mx-auto space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="font-display text-2xl font-bold text-[#f4f1ea] leading-none flex items-center gap-2">
                <Camera className="w-5 h-5 text-[#f97316]" />
                <span>SCOUT, SPOTS &amp; TRAIL CAMS</span>
              </h1>
              <p className="text-[11px] text-[#b7ad96] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center gap-1 font-mono text-[#f97316]">
                  <Wind className="w-3.5 h-3.5" />{' '}
                  {weather
                    ? `${weather.windDir} ${weather.windSpeedMph} mph (G ${weather.windGustsMph}) · ${weather.tempF}°F · ${weather.pressureInHg}"`
                    : 'NW 11 mph · 28°F'}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1 font-mono text-[#84cc16]">
                  <Sun className="w-3.5 h-3.5" />{' '}
                  {weather ? `Legal: ${weather.legalShootingLight}` : 'Legal: 6:49 AM – 5:44 PM'}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowAddSpotOrPinForm((v) => !v);
                  setShowAddCamForm(false);
                }}
                className="px-3 py-2 rounded-xl bg-[#232d1d] hover:bg-[#2f3c27] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5 text-[#84cc16]" />
                <span>+ Spot / Pin</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowAddCamForm((v) => !v);
                  setShowAddSpotOrPinForm(false);
                }}
                className="px-3 py-2 rounded-xl bg-[#232d1d] hover:bg-[#2f3c27] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5 text-[#f97316]" />
                <span>+ Log Cam</span>
              </button>

              <label className="cursor-pointer px-3 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-md">
                <Upload className="w-3.5 h-3.5" />
                <span>{isTaggingCam ? 'Tagging...' : 'Upload Photo'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  disabled={isTaggingCam}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Species Segmented Control */}
          <div className="grid grid-cols-5 gap-1 p-1 rounded-2xl bg-[#0e120b]/90 border border-[#2d3826]">
            {(['ALL', 'Buck', 'Doe', 'Coyote', 'Turkey'] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => {
                  setSpeciesFilter(sp);
                  setSearchQuery('');
                }}
                className={`py-2 rounded-xl text-xs font-bold transition-colors ${
                  speciesFilter === sp
                    ? 'bg-[#ea580c] text-white'
                    : 'text-[#b7ad96] hover:text-[#f4f1ea]'
                }`}
              >
                {sp === 'ALL' ? 'All Cams' : sp}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {/* FORM 1: ADD SPOT OR CAM/STAND PIN */}
        {showAddSpotOrPinForm && (
          <form
            onSubmit={handleCreateSpotOrPin}
            className="p-4 rounded-2xl bg-[#141a11] border border-[#3f5236] space-y-3 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAddMode('SPOT')}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs ${
                    addMode === 'SPOT'
                      ? 'bg-[#ea580c] text-white'
                      : 'bg-[#0e120b] text-[#b7ad96] border border-[#2d3826]'
                  }`}
                >
                  + Add Hunting Spot
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('PIN')}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs ${
                    addMode === 'PIN'
                      ? 'bg-[#ea580c] text-white'
                      : 'bg-[#0e120b] text-[#b7ad96] border border-[#2d3826]'
                  }`}
                >
                  + Add Cam / Stand Pin
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSpotOrPinForm(false)}
                className="text-[#9c927d] hover:text-[#f4f1ea]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {addMode === 'SPOT' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={newSpotName}
                  onChange={(e) => setNewSpotName(e.target.value)}
                  placeholder="Spot or Landowner Name *"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <input
                  type="text"
                  value={newSpotAddress}
                  onChange={(e) => setNewSpotAddress(e.target.value)}
                  placeholder="Street Address / Road (optional)"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <input
                  type="text"
                  value={newSpotCounty}
                  onChange={(e) => setNewSpotCounty(e.target.value)}
                  placeholder="County (e.g. Butler County, KS)"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="1"
                    value={newSpotAcres}
                    onChange={(e) => setNewSpotAcres(e.target.value)}
                    placeholder="Acres (80)"
                    className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                  />
                  <select
                    value={newSpotStatus}
                    onChange={(e) => setNewSpotStatus(e.target.value as PermissionStatus)}
                    className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-2.5 py-2 text-xs text-[#f4f1ea]"
                  >
                    <option value="YES">Permission: YES</option>
                    <option value="ASK">Permission: ASK</option>
                    <option value="LEASED">Permission: LEASED</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={newPinLabel}
                  onChange={(e) => setNewPinLabel(e.target.value)}
                  placeholder="Cam / Stand Name (e.g. Creek Crossing Cam) *"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newPinCategory}
                    onChange={(e) => setNewPinCategory(e.target.value as PinCategory)}
                    className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-2.5 py-2 text-xs text-[#f4f1ea]"
                  >
                    {(['Camera', 'Stand', 'Blind', 'Scrape', 'Rub', 'Bedding', 'Water', 'Gate', 'Parking'] as PinCategory[]).map(
                      (cat) => (
                        <option key={cat} value={cat}>
                          Type: {cat}
                        </option>
                      )
                    )}
                  </select>
                  <input
                    type="text"
                    value={newPinWind}
                    onChange={(e) => setNewPinWind(e.target.value)}
                    placeholder="Best Wind (e.g. NW)"
                    className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea]"
                  />
                </div>
                <input
                  type="text"
                  value={newPinNotes}
                  onChange={(e) => setNewPinNotes(e.target.value)}
                  placeholder="Notes (e.g. Facing south pinch point)"
                  className="sm:col-span-2 rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f]"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddSpotOrPinForm(false)}
                className="px-3 py-1.5 rounded-xl bg-[#1c2317] text-[#b7ad96] font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-[#3f7d20] hover:bg-[#4d9628] text-white font-bold"
              >
                {addMode === 'SPOT' ? 'Save Hunting Spot' : 'Save Cam / Stand Pin'}
              </button>
            </div>
          </form>
        )}

        {/* FORM 2: ADD MANUAL TRAIL CAM ENTRY / SIGHTING */}
        {showAddCamForm && (
          <form
            onSubmit={handleCreateManualCam}
            className="p-4 rounded-2xl bg-[#141a11] border border-[#3f5236] space-y-3 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-[#f97316]">
                + Log Trail Cam Entry or Buck Sighting
              </span>
              <button
                type="button"
                onClick={() => setShowAddCamForm(false)}
                className="text-[#9c927d] hover:text-[#f4f1ea]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={manualCamSpotName}
                onChange={(e) => setManualCamSpotName(e.target.value)}
                placeholder="Spot / Property Name (or select below)"
                className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f]"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={manualCamSpecies}
                  onChange={(e) => setManualCamSpecies(e.target.value as TrailCamPhoto['species'])}
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-2.5 py-2 text-xs text-[#f4f1ea]"
                >
                  {(['Buck', 'Doe', 'Coyote', 'Turkey', 'Hog', 'Duck'] as TrailCamPhoto['species'][]).map((s) => (
                    <option key={s} value={s}>
                      Species: {s}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={manualCamCount}
                  onChange={(e) => setManualCamCount(e.target.value)}
                  placeholder="Count (1)"
                  className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea]"
                />
              </div>
              <input
                type="text"
                required
                value={manualCamTitle}
                onChange={(e) => setManualCamTitle(e.target.value)}
                placeholder="Description (e.g. Wide 10-Point at Creek Scrape) *"
                className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f]"
              />
              <input
                type="text"
                value={manualCamWind}
                onChange={(e) => setManualCamWind(e.target.value)}
                placeholder="Wind (e.g. NW 12 mph)"
                className="rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea]"
              />
              <input
                type="text"
                value={manualCamTip}
                onChange={(e) => setManualCamTip(e.target.value)}
                placeholder="Stand Tip / Notes (e.g. Moving east to west at first light)"
                className="sm:col-span-2 rounded-xl bg-[#0b0e09] border border-[#323f2a] px-3 py-2 text-xs text-[#f4f1ea] placeholder-[#7a876f]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddCamForm(false)}
                className="px-3 py-1.5 rounded-xl bg-[#1c2317] text-[#b7ad96] font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold"
              >
                Save Cam Entry
              </button>
            </div>
          </form>
        )}

        {/* Horizontal Swipe 7-Day Live Deer Wind & Shooting Light Strip */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {forecastDays.map((d) => (
            <div
              key={d.day}
              className="min-w-[126px] bg-[#141a11] border border-[#2d3826] rounded-2xl p-2.5 text-xs shrink-0"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold text-[#f4f1ea]">{d.day}</span>
                <span className="font-mono text-[9px] text-[#84cc16] font-bold">{d.rating}</span>
              </div>
              <div className="font-mono text-[#f97316] font-bold mt-0.5">{d.wind} mph</div>
              <div className="font-mono text-[11px] text-[#b7ad96]">{d.temp}</div>
              <div className="font-mono text-[9px] text-[#c29b6c] mt-1 truncate" title="KDWP Legal Shooting Hours">
                {d.legalLight}
              </div>
            </div>
          ))}
        </div>

        {/* MY SPOTS & CAM / STAND PINS MANAGER ON THE CAM PAGE */}
        <div className="bg-[#141a11] border border-[#2d3826] rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-[#84cc16]">
                My Cam Spots, Stands &amp; Saved Properties ({pins.length} Pins · {parcels.filter((p) => p.permissionStatus !== 'PUBLIC').length} Spots)
              </h2>
              <p className="text-[11px] text-[#9c927d]">
                Add or delete your camera locations, tree stands, and hunting spots right here.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddSpotOrPinForm((v) => !v)}
              className="px-2.5 py-1.5 rounded-xl bg-[#1f291a] hover:bg-[#2a3723] border border-[#3a4931] text-xs font-bold text-[#f4f1ea] flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5 text-[#84cc16]" />
              <span>Add</span>
            </button>
          </div>

          {pins.length === 0 && parcels.filter((p) => p.permissionStatus === 'YES' || p.permissionStatus === 'ASK' || p.permissionStatus === 'LEASED').length === 0 ? (
            <div className="text-xs text-[#9c927d] py-2">
              No custom camera pins or saved spots yet — tap <strong>+ Spot / Pin</strong> above to add one.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto touch-scroll-y pr-1">
              {pins.map((pin) => (
                <div
                  key={pin.id}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0e130b] border border-[#32402b] text-xs"
                >
                  <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#ea580c]/20 text-[#fb923c] font-bold">
                    {pin.category}
                  </span>
                  <span className="font-bold text-[#f4f1ea]">{pin.label}</span>
                  {pin.windIdeal && (
                    <span className="text-[10px] font-mono text-[#84cc16]">Wind: {pin.windIdeal}</span>
                  )}
                  {onDeleteFieldPin && (
                    <button
                      type="button"
                      onClick={() => onDeleteFieldPin(pin.id)}
                      className="p-1 rounded hover:bg-[#3a1a1a] text-[#fca5a5]"
                      title="Delete pin"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {parcels
                .filter((p) => p.permissionStatus === 'YES' || p.permissionStatus === 'ASK' || p.permissionStatus === 'LEASED')
                .map((spot) => (
                  <div
                    key={spot.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0e130b] border border-[#355528] text-xs"
                  >
                    <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#3f7d20]/30 text-[#84cc16] font-bold">
                      {spot.permissionStatus}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectParcelOnMap && onSelectParcelOnMap(spot.id)}
                      className="font-bold text-[#f4f1ea] hover:underline text-left"
                    >
                      {spot.ownerName.split('/')[0].trim()} ({spot.acres.toFixed(0)} ac)
                    </button>
                    {onDeleteSpot && (
                      <button
                        type="button"
                        onClick={() => onDeleteSpot(spot.id)}
                        className="p-1 rounded hover:bg-[#3a1a1a] text-[#fca5a5]"
                        title="Delete spot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Search + Upload Target Parcel */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#9c927d] absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search trail cams by species, spot name, or notes..."
              className="w-full rounded-2xl bg-[#141a11] border border-[#2d3826] pl-10 pr-4 py-2.5 text-xs text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
            />
          </div>
          <input
            type="text"
            value={customUploadSpotName}
            onChange={(e) => setCustomUploadSpotName(e.target.value)}
            placeholder="Custom Spot Label for Next Upload (optional)"
            className="rounded-2xl bg-[#141a11] border border-[#2d3826] px-3 py-2.5 text-xs text-[#f4f1ea] placeholder-[#7a876f] sm:w-56"
          />
          {parcels.length > 0 && (
            <select
              value={uploadParcelId || parcels[0]?.id || ''}
              onChange={(e) => setUploadParcelId(e.target.value)}
              className="rounded-2xl bg-[#141a11] border border-[#2d3826] px-3 py-2.5 text-xs text-[#f4f1ea]"
            >
              {parcels.slice(0, 30).map((p) => (
                <option key={p.id} value={p.id}>
                  Cam Spot: {p.ownerName.split('/')[0].trim()}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Trail Cam Native Feed */}
        {filteredCams.length === 0 ? (
          <div className="bg-[#141a11] border border-[#2d3826] rounded-3xl p-8 text-center space-y-3">
            <Camera className="w-7 h-7 text-[#f97316] mx-auto" />
            <div className="text-sm font-bold text-[#f4f1ea]">No trail cam photos or entries yet</div>
            <p className="text-xs text-[#b7ad96] max-w-md mx-auto">
              Tap <strong>Upload Photo</strong> to upload a trail camera image or tap <strong>+ Log Cam</strong> to add a trail cam sighting manually.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {filteredCams.map((cam) => (
              <div
                key={cam.id}
                className="bg-[#141a11] border border-[#2d3826] rounded-3xl overflow-hidden flex flex-col"
              >
                <div className="relative h-48 bg-[#0c0f0a] overflow-hidden">
                  <img
                    src={cam.imageUrl}
                    alt={cam.classification}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  {onDeleteTrailCam && (
                    <button
                      type="button"
                      onClick={() => onDeleteTrailCam(cam.id)}
                      className="absolute top-2.5 right-2.5 px-2.5 py-1.5 rounded-xl bg-black/75 hover:bg-[#3f1a1a] border border-[#6e2c2c] text-[#fca5a5] text-[11px] font-bold flex items-center gap-1 backdrop-blur-sm transition-colors"
                      title="Delete trail cam entry"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-3 flex items-end justify-between">
                    <span className="text-xs font-bold text-[#f97316] font-mono">
                      {cam.species.toUpperCase()} (x{cam.count})
                    </span>
                    <span className="text-[11px] font-mono text-[#e6e0d2]">{cam.capturedAt}</span>
                  </div>
                </div>

                <div className="p-3.5 space-y-1.5">
                  <div className="text-[11px] text-[#9c927d] flex items-center justify-between font-mono">
                    <span className="truncate">{cam.parcelName}</span>
                    <span className="shrink-0">{cam.daysAgo}d ago</span>
                  </div>
                  <h3 className="text-sm font-bold text-[#f4f1ea] leading-snug">
                    {cam.classification}
                  </h3>
                  <div className="text-[11px] text-[#b7ad96] font-mono">
                    {cam.tempF}°F · Wind {cam.windDir} · {cam.moonPhase}
                  </div>
                  <p className="text-xs text-[#d9f99d] bg-[#182613] border border-[#355528] rounded-xl p-2.5 leading-relaxed">
                    <strong>Stand Tip:</strong> {cam.tacticalTip}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * VIEW 3: CREW OPS, TASKS & LEADERBOARD (NATIVE APP LISTS)
 * ============================================================================ */
interface CrewAndEnterpriseViewProps {
  crewMembers: CrewMember[];
  tasks: CrewTask[];
  onToggleTask: (taskId: string) => void;
  onAddTask: (assignee: string, actionType: CrewTask['actionType'], parcelId: string) => void;
  parcels: HuntingParcel[];
  auditLogs: AuditLogEntry[];
  activeRole: CrewMember['role'];
  onChangeRole: (role: CrewMember['role']) => void;
  onExportCloudBackup: () => void;
  loggedInHunter?: { displayName: string; email: string; phone?: string };
  onOpenAccountModal?: () => void;
  onSignOut?: () => void;
}

export const CrewAndEnterpriseView: React.FC<CrewAndEnterpriseViewProps> = ({
  crewMembers,
  tasks,
  onToggleTask,
  onAddTask,
  parcels,
  auditLogs,
  activeRole,
  onChangeRole,
  onExportCloudBackup,
  loggedInHunter,
  onOpenAccountModal,
  onSignOut,
}) => {
  const [newAssignee, setNewAssignee] = useState(
    loggedInHunter?.displayName || crewMembers[0]?.name || 'Kansas Hunter'
  );
  const [newAction, setNewAction] = useState<CrewTask['actionType']>('KNOCK');
  const [newParcelId, setNewParcelId] = useState(parcels[0]?.id || '');

  const yesParcels = parcels.filter((p) => p.permissionStatus === 'YES');
  const askedParcels = parcels.filter(
    (p) =>
      p.permissionStatus === 'YES' ||
      p.permissionStatus === 'ASK' ||
      p.permissionStatus === 'NO_GO'
  );
  const knockRatePct =
    askedParcels.length > 0
      ? `${((yesParcels.length / askedParcels.length) * 100).toFixed(0)}%`
      : '0%';

  const totalAcresYes = yesParcels.reduce((acc, p) => acc + p.acres, 0);
  const totalAcresPublic = parcels
    .filter((p) => p.permissionStatus === 'PUBLIC')
    .reduce((acc, p) => acc + p.acres, 0);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      {/* Logged-In Hunter Account Card */}
      {loggedInHunter && (
        <div className="bg-[#141a11] border border-[#3f7d20]/70 rounded-3xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#1f3316] border border-[#3f7d20] flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5 text-[#84cc16]" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[#84cc16] font-bold">
                Signed In Hunter · Texts Use This Name
              </div>
              <div className="text-base font-bold text-[#f4f1ea] truncate">
                {loggedInHunter.displayName}
              </div>
              <div className="text-[11px] font-mono text-[#b7ad96] truncate">
                {loggedInHunter.email}
                {loggedInHunter.phone ? ` · ${loggedInHunter.phone}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenAccountModal && (
              <button
                type="button"
                onClick={onOpenAccountModal}
                className="px-3 py-2 rounded-xl bg-[#232d1d] hover:bg-[#2f3c27] border border-[#3a4931] text-[#f4f1ea] text-xs font-bold flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5 text-[#f97316]" />
                <span>Edit Profile</span>
              </button>
            )}
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="px-3 py-2 rounded-xl bg-[#2a1a12] hover:bg-[#3a2318] border border-[#5e3819] text-[#ffedd5] text-xs font-bold flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5 text-[#f97316]" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Compact Stats Row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#141a11] border border-[#2d3826] rounded-2xl p-3">
          <div className="text-[10px] font-mono uppercase text-[#9c927d]">Private Yes</div>
          <div className="text-lg font-bold font-mono text-[#84cc16] mt-0.5">
            {totalAcresYes.toFixed(0)} ac
          </div>
        </div>
        <div className="bg-[#141a11] border border-[#2d3826] rounded-2xl p-3">
          <div className="text-[10px] font-mono uppercase text-[#9c927d]">WIHA Ground</div>
          <div className="text-lg font-bold font-mono text-purple-400 mt-0.5">
            {totalAcresPublic.toFixed(0)} ac
          </div>
        </div>
        <div className="bg-[#141a11] border border-[#2d3826] rounded-2xl p-3">
          <div className="text-[10px] font-mono uppercase text-[#9c927d]">Permission Rate</div>
          <div className="text-lg font-bold font-mono text-[#f97316] mt-0.5">{knockRatePct}</div>
        </div>
      </div>

      {/* Crew Task Assignments */}
      <div className="bg-[#141a11] border border-[#2d3826] rounded-3xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#25301f] flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-[#f4f1ea]">
            CREW KNOCK &amp; SCOUT TASKS
          </h2>
          <span className="text-[11px] font-mono text-[#b7ad96]">{tasks.length} items</span>
        </div>

        <div className="p-3 bg-[#0e120b] border-b border-[#25301f] flex flex-wrap gap-2 text-xs">
          <select
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value)}
            className="bg-[#182014] border border-[#34422c] rounded-xl px-2.5 py-2 text-[#f4f1ea]"
          >
            {crewMembers.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name.split(' ')[0]}
              </option>
            ))}
          </select>
          <select
            value={newAction}
            onChange={(e) => setNewAction(e.target.value as CrewTask['actionType'])}
            className="bg-[#182014] border border-[#34422c] rounded-xl px-2.5 py-2 text-[#f97316] font-bold"
          >
            <option value="KNOCK">KNOCK</option>
            <option value="MAIL LETTER">MAIL LETTER</option>
            <option value="SCOUT WIHA">SCOUT WIHA</option>
            <option value="HANG CAM">HANG CAM</option>
            <option value="THANK OWNER">THANK OWNER</option>
          </select>
          <select
            value={newParcelId || parcels[0]?.id || ''}
            onChange={(e) => setNewParcelId(e.target.value)}
            className="flex-1 min-w-[140px] bg-[#182014] border border-[#34422c] rounded-xl px-2.5 py-2 text-[#f4f1ea]"
          >
            {parcels.slice(0, 20).map((p) => (
              <option key={p.id} value={p.id}>
                {p.ownerName.split('/')[0].trim()} ({p.acres.toFixed(0)} ac)
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const pid = newParcelId || parcels[0]?.id;
              if (!pid) return;
              onAddTask(newAssignee, newAction, pid);
            }}
            className="px-4 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold"
          >
            Assign
          </button>
        </div>

        <div className="divide-y divide-[#25301f]">
          {tasks.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#9c927d]">
              No crew tasks assigned yet. Pick an action and property above and tap Assign.
            </div>
          ) : (
            tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onToggleTask(t.id)}
                className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors ${
                  t.completed ? 'opacity-50 line-through' : 'hover:bg-[#1a2216]'
                }`}
              >
                <div className="text-xs min-w-0">
                  <div className="font-bold text-[#f4f1ea] truncate">
                    <span className="text-[#f97316]">{t.actionType}</span> · {t.parcelName}
                  </div>
                  <div className="text-[#b7ad96] mt-0.5">
                    {t.assignee} · {t.dueLabel}
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold shrink-0 ${
                    t.completed ? 'text-[#84cc16]' : 'bg-[#232d1d] text-[#f4f1ea]'
                  }`}
                >
                  {t.completed ? 'DONE ✓' : 'OPEN'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Crew Leaderboard */}
      <div className="bg-[#141a11] border border-[#2d3826] rounded-3xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#25301f] flex items-center gap-2">
          <Award className="w-5 h-5 text-[#f97316]" />
          <h2 className="font-display text-lg font-bold text-[#f4f1ea]">CREW LEADERBOARD</h2>
        </div>
        <div className="divide-y divide-[#25301f]">
          {crewMembers.map((m, idx) => (
            <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="font-bold text-[#f4f1ea]">
                  #{idx + 1} {m.name}
                </div>
                <div className="text-[11px] text-[#84cc16] truncate">{m.statusText}</div>
              </div>
              <div className="text-right font-mono shrink-0">
                <div className="font-bold text-[#f97316]">{m.permissionsSecured} perms</div>
                <div className="text-[11px] text-[#b7ad96]">
                  {m.doesHarvested}D/{m.bucksHarvested}B · {m.acresScouted.toLocaleString()} ac
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Role & Backup Strip */}
      <div className="bg-[#141a11] border border-[#2d3826] rounded-3xl p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#c29b6c]" />
            <span className="font-bold text-[#f4f1ea]">Crew Role</span>
          </div>
          <select
            value={activeRole}
            onChange={(e) => onChangeRole(e.target.value as CrewMember['role'])}
            className="bg-[#0e120b] border border-[#34422c] rounded-xl px-3 py-2 text-[#f4f1ea] font-semibold"
          >
            <option value="Crew Captain (Admin)">Crew Captain (Admin)</option>
            <option value="Outfitter Manager">Outfitter Manager</option>
            <option value="Field Scout">Field Scout</option>
            <option value="Landowner Guest">Landowner Guest (Read-Only)</option>
          </select>
        </div>

        <PWAInstallButton />

        <button
          type="button"
          onClick={onExportCloudBackup}
          className="w-full py-2.5 rounded-xl bg-[#232d1d] hover:bg-[#2f3c27] border border-[#3a4931] text-[#f4f1ea] font-bold flex items-center justify-center gap-1.5"
        >
          <Download className="w-4 h-4 text-[#f97316]" />
          <span>Export Encrypted Crew Backup ({auditLogs.length} Audit Events)</span>
        </button>
      </div>
    </div>
  );
};

/* ============================================================================
 * VIEW 4: SAFETY CHECK-IN, SOS BEACON, KS RULES & HARVEST LOG
 * ============================================================================ */
interface LegalAndSafetyViewProps {
  parcels: HuntingParcel[];
  harvestLogs: HarvestRecord[];
  onAddHarvestLog: (record: Omit<HarvestRecord, 'id'>) => void;
  onSendEmergencySos: () => void;
  sosTriggeredAt: string | null;
  hunterName: string;
}

export const LegalAndSafetyView: React.FC<LegalAndSafetyViewProps> = ({
  parcels,
  harvestLogs,
  onAddHarvestLog,
  onSendEmergencySos,
  sosTriggeredAt,
  hunterName,
}) => {
  const [checkInActive, setCheckInActive] = useState(false);
  const [checkInParcel, setCheckInParcel] = useState('');
  const [checkInWindow, setCheckInWindow] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');

  const [regSpecies, setRegSpecies] = useState<HuntSpecies>('Deer');
  const [harvestSpecies, setHarvestSpecies] = useState('');
  const [harvestParcelId, setHarvestParcelId] = useState('');
  const [harvestWeight, setHarvestWeight] = useState<string>('');
  const [harvestDetails, setHarvestDetails] = useState('');

  const matchingRegs = KANSAS_REGULATIONS.filter((r) => r.species === regSpecies);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      {/* One-Tap SOS Beacon */}
      <div className="bg-red-950/50 border border-red-700/60 rounded-3xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-bold text-red-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              <span>ONE-TAP CREW SOS BEACON</span>
            </h2>
            <p className="text-xs text-red-200/80 mt-0.5">
              Blasts exact GPS + gate code to crew &amp; emergency contacts immediately.
            </p>
          </div>
        </div>

        {sosTriggeredAt && (
          <div className="p-2.5 rounded-xl bg-red-900/90 border border-red-400 text-white text-xs font-mono">
            SOS DISPATCHED AT {sosTriggeredAt} — GPS pin sent to crew.
          </div>
        )}

        <button
          type="button"
          onClick={onSendEmergencySos}
          className="w-full py-3.5 px-4 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg"
        >
          <PhoneCall className="w-4 h-4" />
          <span>SEND EMERGENCY GPS + &ldquo;I NEED HELP&rdquo;</span>
        </button>
      </div>

      {/* Dead-Man Hunt Check-In Timer */}
      <div className="bg-[#141a11] border border-[#2d3826] rounded-3xl p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#84cc16]" />
            <h2 className="font-display text-xl font-bold text-[#f4f1ea]">HUNT CHECK-IN TIMER</h2>
          </div>
          <span
            className={`font-mono text-[11px] font-bold ${
              checkInActive ? 'text-[#84cc16]' : 'text-[#9c927d]'
            }`}
          >
            {checkInActive ? 'ACTIVE' : 'CHECKED OUT'}
          </span>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={checkInParcel}
            onChange={(e) => setCheckInParcel(e.target.value)}
            placeholder="Property or section you are hunting..."
            className="w-full rounded-xl bg-[#0e120b] border border-[#323f2a] px-3 py-2 text-[#f4f1ea] placeholder-[#68755d]"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={checkInWindow}
              onChange={(e) => setCheckInWindow(e.target.value)}
              placeholder="Hunt window (e.g. 5:30 AM – 11:00 AM)"
              className="w-full rounded-xl bg-[#0e120b] border border-[#323f2a] px-3 py-2 text-[#f4f1ea] placeholder-[#68755d]"
            />
            <input
              type="text"
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              placeholder="Emergency contact name & phone"
              className="w-full rounded-xl bg-[#0e120b] border border-[#323f2a] px-3 py-2 text-[#f4f1ea] placeholder-[#68755d]"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCheckInActive((v) => !v)}
          className={`w-full py-2.5 rounded-xl font-bold text-xs ${
            checkInActive
              ? 'bg-[#3f7d20] hover:bg-[#4d9328] text-white'
              : 'bg-[#ea580c] hover:bg-[#f97316] text-white'
          }`}
        >
          {checkInActive ? 'Check Out Safe Now' : 'Start New Hunt Check-In'}
        </button>
      </div>

      {/* Kansas Season Rules Engine */}
      <div className="bg-[#141a11] border border-[#2d3826] rounded-3xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-[#f97316]" />
          <h2 className="font-display text-xl font-bold text-[#f4f1ea]">KANSAS SEASON RULES</h2>
        </div>

        <div className="grid grid-cols-5 gap-1 p-1 rounded-2xl bg-[#0e120b] border border-[#2d3826]">
          {(['Deer', 'Turkey', 'Duck', 'Coyote', 'Hog'] as HuntSpecies[]).map((sp) => (
            <button
              key={sp}
              type="button"
              onClick={() => setRegSpecies(sp)}
              className={`py-2 rounded-xl text-xs font-bold transition-colors ${
                regSpecies === sp
                  ? 'bg-[#ea580c] text-white'
                  : 'text-[#b7ad96] hover:text-[#f4f1ea]'
              }`}
            >
              {sp}
            </button>
          ))}
        </div>

        <div className="divide-y divide-[#25301f] rounded-2xl bg-[#0e120b] border border-[#25301f] overflow-hidden">
          {matchingRegs.map((reg, i) => (
            <div key={`${reg.species}-${reg.method}-${i}`} className="p-3.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#f97316]">
                  {reg.species} — {reg.method}
                </span>
                <span className="font-mono text-[#9c927d]">{reg.state}</span>
              </div>
              <p className="text-[#f4f1ea]">
                <strong>Dates:</strong> {reg.dates} · {reg.shootingHours}
              </p>
              <p className="text-[#d6cebc]">
                <strong>Tags:</strong> {reg.tagsRequired}
              </p>
              <p className="text-[#fb923c]">
                <strong>Blaze Orange:</strong> {reg.orangeRequirement}
              </p>
              <p className="text-[#84cc16]">
                <strong>Baiting:</strong> {reg.baitingRule}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Harvest Log */}
      <div className="bg-[#141a11] border border-[#2d3826] rounded-3xl p-4 space-y-3">
        <h2 className="font-display text-xl font-bold text-[#f4f1ea]">HARVEST LOG</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <input
            type="text"
            value={harvestSpecies}
            onChange={(e) => setHarvestSpecies(e.target.value)}
            placeholder="Species (e.g. Whitetail Buck, Doe, Coyote)"
            className="rounded-xl bg-[#0e120b] border border-[#323f2a] px-3 py-2 text-[#f4f1ea] placeholder-[#68755d]"
          />
          <select
            value={harvestParcelId || parcels[0]?.id || ''}
            onChange={(e) => setHarvestParcelId(e.target.value)}
            className="rounded-xl bg-[#0e120b] border border-[#323f2a] px-3 py-2 text-[#f4f1ea]"
          >
            {parcels.slice(0, 20).map((p) => (
              <option key={p.id} value={p.id}>
                {p.ownerName.split('/')[0].trim()} ({p.acres.toFixed(0)} ac)
              </option>
            ))}
          </select>
          <input
            type="number"
            value={harvestWeight}
            onChange={(e) => setHarvestWeight(e.target.value)}
            placeholder="Weight (lbs)"
            className="rounded-xl bg-[#0e120b] border border-[#323f2a] px-3 py-2 text-[#f4f1ea] placeholder-[#68755d] font-mono"
          />
          <input
            type="text"
            value={harvestDetails}
            onChange={(e) => setHarvestDetails(e.target.value)}
            placeholder="Shot & recovery details..."
            className="rounded-xl bg-[#0e120b] border border-[#323f2a] px-3 py-2 text-[#f4f1ea] placeholder-[#68755d]"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (!harvestSpecies.trim()) return;
            const p = parcels.find((item) => item.id === harvestParcelId) || parcels[0];
            onAddHarvestLog({
              hunterName,
              species: harvestSpecies.trim(),
              details: harvestDetails.trim() || 'Logged in field',
              parcelId: p?.id || 'ks-field',
              parcelName: p?.ownerName || 'Kansas Field Spot',
              date: new Date().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }),
              wind: 'Field Logged',
              weightLbs: Number(harvestWeight) || 0,
              landownerThanked: false,
              photoUrl: '/src/assets/images/trailcam_whitetail_buck_1795634029037.jpg',
            });
            setHarvestSpecies('');
            setHarvestWeight('');
            setHarvestDetails('');
          }}
          className="w-full py-2.5 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] text-white font-bold text-xs"
        >
          + Log Harvest
        </button>

        <div className="divide-y divide-[#25301f] rounded-2xl bg-[#0e120b] border border-[#25301f] overflow-hidden">
          {harvestLogs.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#9c927d]">
              No harvests logged yet. Enter species and details above to record a harvest.
            </div>
          ) : (
            harvestLogs.map((h) => (
              <div key={h.id} className="p-3 flex items-center gap-3">
                <img
                  src={h.photoUrl}
                  alt={h.species}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 object-cover rounded-xl border border-[#2d3826] shrink-0"
                />
                <div className="min-w-0 flex-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#f97316] truncate">{h.species}</span>
                    <span className="font-mono text-[10px] text-[#9c927d] shrink-0">{h.date}</span>
                  </div>
                  <div className="text-[#f4f1ea] font-medium truncate">
                    {h.hunterName} · {h.parcelName}
                  </div>
                  <div className="text-[#b7ad96] truncate">{h.details}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
