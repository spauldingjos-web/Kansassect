import React, { useState, useEffect } from 'react';
import {
  X,
  Home,
  Car,
  ExternalLink,
  DoorOpen,
  Mail,
  MessageSquarePlus,
  FileCheck2,
  Sparkles,
  Eye,
  EyeOff,
  Phone,
  PhoneCall,
  Search,
  Loader2,
  Truck,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  Send,
  ShieldCheck,
  MapPin,
  Plus,
  Pencil,
  Compass,
  Navigation,
  Printer,
  MessageSquare,
} from 'lucide-react';
import {
  HuntingParcel,
  PermissionStatus,
  HuntSpecies,
  OwnerPublicIntel,
  FieldPin,
} from '../types/hunting';
import { resolveParcelGateDestination } from './WardenSlipModal';
import {
  getAllParcelPhones,
  formatPhoneDigits,
  buildPermissionSmsHref,
  PERMISSION_SMS_TEMPLATES,
  PermissionSmsTemplateId,
} from '../utils/phoneUtils';

interface OwnerCardSheetProps {
  parcel: HuntingParcel | null;
  pins?: FieldPin[];
  onClose: () => void;
  onUpdatePermissionStatus: (parcelId: string, status: PermissionStatus) => void;
  onLogKnockVisit: (parcelId: string, outcomeNote: string) => void;
  onAddCrewNote: (
    parcelId: string,
    noteText: string,
    tag: 'Knock Intel' | 'Access Rule' | 'Sighting' | 'Pressure Warning'
  ) => void;
  onSendLeaseMessage: (parcelId: string, message: string, proposedRate?: number) => void;
  onCreatePermissionSlip: (
    parcelId: string,
    allowedSpecies: HuntSpecies[],
    maxHunters: number,
    rules: string
  ) => void;
  onIncrementTrucksSeen: (parcelId: string) => void;
  onRunEScout: (parcel: HuntingParcel) => void;
  isEScoutLoading: boolean;
  onOpenStreetView: (coords: { lat: number; lng: number }) => void;
  onOpenWardenSlip?: (parcel: HuntingParcel) => void;
  hidePhonesForCrewPrivacy: boolean;
  onToggleHidePhones: () => void;
  publicIntel?: OwnerPublicIntel;
  isSearchingPublicIntel: boolean;
  onSearchPublicIntel: (parcel: HuntingParcel) => void;
  onSaveOwnerPhone: (parcelId: string, phone: string, opts?: { asAdditional?: boolean }) => void;
  onUpdateOwnerDetails: (
    parcelId: string,
    details: {
      ownerName: string;
      propertyAddress?: string;
      taxMailingAddress?: string;
      savedOwnerPhone?: string;
      livesOnLand?: boolean;
    }
  ) => void;
  hunterName: string;
  hunterPhone?: string;
}

type SheetCategory = 'MENU' | 'PROPERTY' | 'PHONE' | 'PERMISSION' | 'SCOUT';

const PERMISSION_BTNS: { value: PermissionStatus; label: string; active: string }[] = [
  {
    value: 'YES',
    label: 'Yes',
    active: 'bg-[#3f7d20] text-[#f4f1ea] font-bold border-[#65a30d]',
  },
  {
    value: 'ASK',
    label: 'Ask',
    active: 'bg-[#ea580c] text-white font-bold border-[#fb923c]',
  },
  {
    value: 'NO_GO',
    label: 'No Go',
    active: 'bg-red-700 text-white font-bold border-red-500',
  },
  {
    value: 'LEASED',
    label: 'Leased',
    active: 'bg-[#8c6239] text-[#f4f1ea] font-bold border-[#b58454]',
  },
  {
    value: 'UNKNOWN',
    label: 'Unknown',
    active: 'bg-[#36422d] text-[#f4f1ea] font-bold border-[#556647]',
  },
];

export const OwnerCardSheet: React.FC<OwnerCardSheetProps> = ({
  parcel,
  pins = [],
  onClose,
  onUpdatePermissionStatus,
  onLogKnockVisit,
  onAddCrewNote,
  onSendLeaseMessage,
  onCreatePermissionSlip,
  onIncrementTrucksSeen,
  onRunEScout,
  isEScoutLoading,
  onOpenStreetView,
  onOpenWardenSlip,
  hidePhonesForCrewPrivacy,
  onToggleHidePhones,
  publicIntel,
  isSearchingPublicIntel,
  onSearchPublicIntel,
  onSaveOwnerPhone,
  onUpdateOwnerDetails,
  hunterName,
  hunterPhone,
}) => {
  const [activeCategory, setActiveCategory] = useState<SheetCategory>('MENU');
  const [permTab, setPermTab] = useState<'SLIP' | 'KNOCK' | 'MAIL' | 'LEASE'>('SLIP');
  const [showEditOwner, setShowEditOwner] = useState(false);

  const [knockOutcome, setKnockOutcome] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [noteTag, setNoteTag] = useState<
    'Knock Intel' | 'Access Rule' | 'Sighting' | 'Pressure Warning'
  >('Knock Intel');
  const [copiedLetter, setCopiedLetter] = useState(false);
  const [slipMaxHunters, setSlipMaxHunters] = useState(2);
  const [slipRules, setSlipRules] = useState(
    'Archery & predator hunting only. Keep pasture gates latched. Text before entering.'
  );
  const [leaseMsg, setLeaseMsg] = useState('');
  const [leaseOffer, setLeaseOffer] = useState('1500');
  const [showAddPhone, setShowAddPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [smsTemplateId, setSmsTemplateId] = useState<PermissionSmsTemplateId>('bow');
  const [editOwnerName, setEditOwnerName] = useState('');
  const [editPropAddr, setEditPropAddr] = useState('');
  const [editMailAddr, setEditMailAddr] = useState('');
  const [editOwnerPhone, setEditOwnerPhone] = useState('');
  const [editLivesOnLand, setEditLivesOnLand] = useState(false);

  useEffect(() => {
    if (parcel) {
      setActiveCategory('MENU');
      setPermTab('SLIP');
      setShowEditOwner(false);
      setShowAddPhone(false);
      setPhoneInput('');
      setSmsTemplateId(parcel.permissionSlip ? 'checkin' : 'bow');
      const isPlaceholderOwner =
        parcel.ownerNameVerified === false ||
        /^Private (Owner|Landowner)|Section \d+ Landowner/i.test(parcel.ownerName);
      setEditOwnerName(isPlaceholderOwner ? '' : parcel.ownerName);
      setEditPropAddr(parcel.propertyAddress || '');
      setEditMailAddr(
        /does not publish|keeps owner names|Tap County|Tax Roll/i.test(parcel.taxMailingAddress)
          ? ''
          : parcel.taxMailingAddress
      );
      setEditOwnerPhone(parcel.savedOwnerPhone || parcel.publicPhoneListing || '');
      setEditLivesOnLand(Boolean(parcel.livesOnLand));
      setKnockOutcome(
        `Knocked on ${parcel.ownerName.split('/')[0].trim()} door — asked respectfully about archery deer & coyote control.`
      );
      setSlipRules(
        parcel.permissionSlip?.rulesAndNotes ||
          'Archery & predator hunting only. Keep pasture gates latched. Text owner before entering.'
      );
    }
  }, [parcel?.id]);

  if (!parcel) return null;

  const letterContactLine = hunterPhone?.trim()
    ? `I'd be grateful to talk at ${hunterPhone.trim()}.`
    : `I'd be grateful to talk whenever you have a spare moment.`;

  const letterBody = `Dear ${parcel.ownerName},

My name is ${hunterName}, a local respectful Kansas bowhunter. I noticed your ${parcel.acres.toFixed(1)}-acre parcel (${parcel.sectionCode}) in ${parcel.county}. My two close friends and I are looking for a quiet spot for whitetail deer and coyote control. We strictly close every gate, never drive on wet pasture, share processed venison/sausage, and help mend fence if needed.

If you'd consider granting written permission—even for does or coyotes—${letterContactLine}

Thank you,
${hunterName}`;

  const handleCopyLetter = () => {
    navigator.clipboard?.writeText(letterBody);
    setCopiedLetter(true);
    setTimeout(() => setCopiedLetter(false), 2500);
  };

  const allOwnerPhones = getAllParcelPhones(parcel, publicIntel);
  const primaryPhone = allOwnerPhones[0]?.number || '';
  const phoneDigits = formatPhoneDigits(primaryPhone);
  const gateDest = resolveParcelGateDestination(parcel, pins);
  const driveToGateUrl = `https://www.google.com/maps/dir/?api=1&destination=${gateDest.lat},${gateDest.lng}&travelmode=driving`;
  const smsHref = primaryPhone
    ? buildPermissionSmsHref(primaryPhone, parcel, smsTemplateId, undefined, hunterName, hunterPhone)
    : '';
  const isUnverifiedOwner =
    parcel.permissionStatus !== 'PUBLIC' &&
    (parcel.ownerNameVerified === false ||
      /^Private (Owner|Landowner)|Section \d+ Landowner/i.test(parcel.ownerName));
  const countyTaxRollLink =
    parcel.countyAppraiserUrl ||
    parcel.publicLinks.find((l) => l.label === 'County GIS Tax Roll')?.url ||
    'https://www.kansasgis.org/orka/';

  const propertySummary =
    parcel.propertyAddress ||
    (parcel.taxMailingAddress && !/Tap County|does not publish/i.test(parcel.taxMailingAddress)
      ? parcel.taxMailingAddress
      : `${parcel.sectionCode} · ${parcel.county}`);

  const phoneSummary = allOwnerPhones.length > 0
    ? hidePhonesForCrewPrivacy
      ? `${allOwnerPhones.length} phone line(s) hidden (Crew Privacy On)`
      : allOwnerPhones.length > 1
        ? `${allOwnerPhones.length} numbers ready · ${primaryPhone}`
        : `${primaryPhone}${allOwnerPhones[0]?.source ? ` · ${allOwnerPhones[0].source}` : ''}`
    : isSearchingPublicIntel
      ? 'Scanning public directories & records...'
      : 'AI Phone Scan · FastPeopleSearch · Whitepages';

  const permissionSummary = parcel.permissionSlip
    ? `Signed Warden Slip active (Max ${parcel.permissionSlip.maxHuntersAtOnce} hunters)`
    : parcel.leaseMessages.length > 0
      ? `${parcel.leaseMessages.length} lease messages · Knock, mail & slip`
      : 'Warden slip · Log knock · Mail letter · Lease chat';

  const scoutSummary = `${parcel.crewNotes.length} crew ${parcel.crewNotes.length === 1 ? 'note' : 'notes'} · ${parcel.trucksSeenThisWeek} ${parcel.trucksSeenThisWeek === 1 ? 'truck' : 'trucks'} this wk · E-Scout & Street View`;

  const categoryTitles: Record<Exclude<SheetCategory, 'MENU'>, string> = {
    PROPERTY: 'Property & Address',
    PHONE: 'Phone & Public Records',
    PERMISSION: 'Permission, Knock & Mail',
    SCOUT: 'Scout, Street View & Notes',
  };

  return (
    <div className="fixed inset-x-0 bottom-[68px] z-40 flex justify-center px-2 sm:px-4 pointer-events-none">
      <div
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="pointer-events-auto animate-sheet-up w-full max-w-xl bg-[#131810]/98 backdrop-blur-xl border border-[#323f2a] rounded-t-3xl sm:rounded-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.75)] max-h-[76dvh] flex flex-col overflow-hidden min-h-0"
      >
        {/* TOP NATIVE APP CAMO HEADER */}
        <div className="camo-header px-4 pt-2.5 pb-3 border-b border-[#2d3826] shrink-0">
          <div className="flex justify-center mb-2">
            <div className="w-10 h-1.5 rounded-full bg-[#4a5a3f]" />
          </div>

          {activeCategory === 'MENU' ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-mono text-[#b7ad96] truncate">
                    {parcel.county} · {parcel.sectionCode}
                    {parcel.source ? ` · ${parcel.source}` : ''}
                  </div>
                  <h2 className="font-display text-2xl sm:text-[26px] font-bold text-[#f4f1ea] leading-tight truncate mt-0.5">
                    {parcel.ownerName}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#b7ad96] mt-0.5">
                    <span className="font-mono font-bold text-[#f97316]">
                      {parcel.acres.toFixed(2)} ac
                    </span>
                    <span>·</span>
                    <span>{parcel.landType}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Car className="w-3.5 h-3.5 text-[#c29b6c]" />
                      {parcel.driveMinutes}m
                    </span>
                    {parcel.permissionStatus !== 'PUBLIC' && (
                      <>
                        <span>·</span>
                        <span
                          className={
                            parcel.livesOnLand
                              ? 'text-[#84cc16] font-semibold'
                              : 'text-[#c29b6c] font-semibold'
                          }
                        >
                          {parcel.livesOnLand ? 'Lives On Land' : 'Absentee'}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Owner Card"
                  className="w-10 h-10 rounded-full bg-[#1d2518]/90 hover:bg-[#2a3623] border border-[#3a4931] text-[#d6cebc] hover:text-white flex items-center justify-center shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {parcel.permissionStatus !== 'PUBLIC' && (
                <div className="grid grid-cols-5 gap-1.5 mt-3">
                  {PERMISSION_BTNS.map((btn) => {
                    const active = parcel.permissionStatus === btn.value;
                    return (
                      <button
                        key={btn.value}
                        type="button"
                        onClick={() => onUpdatePermissionStatus(parcel.id, btn.value)}
                        className={`py-2 rounded-xl text-[11px] border transition-colors min-h-[38px] ${
                          active
                            ? btn.active
                            : 'bg-[#192015]/90 border-[#2d3826] text-[#b7ad96] hover:bg-[#242e1e] hover:text-[#f4f1ea]'
                        }`}
                      >
                        {btn.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveCategory('MENU');
                  setShowEditOwner(false);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1d2518] hover:bg-[#283322] border border-[#394730] text-xs font-bold text-[#f4f1ea] min-h-[40px]"
              >
                <ChevronLeft className="w-4 h-4 text-[#f97316]" />
                <span>Categories</span>
              </button>

              <div className="min-w-0 text-center flex-1">
                <div className="text-[10px] font-mono text-[#b7ad96] truncate">
                  {parcel.ownerName}
                </div>
                <div className="font-display text-lg font-bold text-[#f4f1ea] leading-none">
                  {categoryTitles[activeCategory]}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close Owner Card"
                className="w-10 h-10 rounded-full bg-[#1d2518] hover:bg-[#2a3623] border border-[#3a4931] text-[#d6cebc] hover:text-white flex items-center justify-center shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* ============================================================
            VIEW 1: CLEAN NATIVE CATEGORY LIST (DEFAULT ON TAP)
           ============================================================ */}
        {activeCategory === 'MENU' && (
          <div className="overflow-y-auto flex-1 min-h-0 touch-scroll-y">
            {isUnverifiedOwner && (
              <div className="px-4 py-2.5 bg-[#241d12] border-b border-[#4a3a22] flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-bold text-[#e2c290]">Owner Held on County Tax Roll</div>
                  <div className="text-[11px] text-[#b7ad96] truncate">
                    Open {parcel.county} tax roll or add the owner you know
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveCategory('PROPERTY');
                    setShowEditOwner(true);
                  }}
                  className="px-3 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs shrink-0"
                >
                  Add Owner
                </button>
              </div>
            )}

            {/* DIRECT ALL-NUMBERS CALL & PERMISSION TEXT STRIP */}
            {parcel.permissionStatus !== 'PUBLIC' && (
              <div className="px-4 py-3 bg-[#10150d] border-b border-[#25301f] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#84cc16]">
                    <Phone className="w-3.5 h-3.5 text-[#f97316]" />
                    <span>
                      {allOwnerPhones.length > 0
                        ? `${allOwnerPhones.length} Owner Line${allOwnerPhones.length > 1 ? 's' : ''} — Tap Call or Text Ask`
                        : 'Owner Phone Lookup'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {allOwnerPhones.length === 0 && (
                      <button
                        type="button"
                        onClick={() => onSearchPublicIntel(parcel)}
                        disabled={isSearchingPublicIntel}
                        className="px-2.5 py-1 rounded-lg bg-[#ea580c] hover:bg-[#f97316] disabled:opacity-60 text-white text-[11px] font-bold flex items-center gap-1"
                      >
                        {isSearchingPublicIntel ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Search className="w-3 h-3" />
                        )}
                        <span>{isSearchingPublicIntel ? 'Scanning...' : 'Find #'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCategory('PHONE');
                        setShowAddPhone(true);
                      }}
                      className="px-2 py-1 rounded-lg bg-[#1e2719] hover:bg-[#2a3623] border border-[#34422c] text-[#d6cebc] text-[11px] font-bold flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3 text-[#f97316]" />
                      <span>Add #</span>
                    </button>
                  </div>
                </div>

                {allOwnerPhones.length > 0 && !hidePhonesForCrewPrivacy && (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {PERMISSION_SMS_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => setSmsTemplateId(tpl.id)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                            smsTemplateId === tpl.id
                              ? 'bg-[#3f7d20] border-[#84cc16] text-white'
                              : 'bg-[#182014] border-[#2d3826] text-[#9c927d] hover:text-[#f4f1ea]'
                          }`}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-mono text-[#b7ad96]">
                        Texting as <strong className="text-[#84cc16]">{hunterName}</strong>
                      </div>
                      {allOwnerPhones.map((ph, idx) => {
                        const digits = formatPhoneDigits(ph.number);
                        const perLineSms = buildPermissionSmsHref(
                          ph.number,
                          parcel,
                          smsTemplateId,
                          undefined,
                          hunterName,
                          hunterPhone
                        );
                        return (
                          <div
                            key={`${digits}-${idx}`}
                            className="flex items-center justify-between gap-2 bg-[#161d12] border border-[#2d3826] rounded-xl px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-sm text-[#f4f1ea]">
                                {ph.number}
                              </div>
                              <div className="text-[10px] text-[#9c927d] truncate">
                                {ph.label} · {ph.source}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`tel:${digits}`}
                                className="px-3 py-1.5 rounded-lg bg-[#2f6619] hover:bg-[#3f7d20] text-white font-bold text-xs flex items-center gap-1"
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                                <span>Call</span>
                              </a>
                              <a
                                href={perLineSms}
                                className="px-3 py-1.5 rounded-lg bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center gap-1"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>Text</span>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {allOwnerPhones.length > 0 && hidePhonesForCrewPrivacy && (
                  <div className="text-[11px] text-[#9c927d] font-mono">
                    {allOwnerPhones.length} phone number(s) hidden · Crew Privacy On
                  </div>
                )}
              </div>
            )}

            <div className="divide-y divide-[#25301f]">
              <button
                type="button"
                onClick={() => setActiveCategory('PROPERTY')}
                className="w-full px-4 py-3.5 flex items-center gap-3.5 text-left hover:bg-[#1b2316] active:bg-[#222c1c] transition-colors min-h-[66px]"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#1e2719] border border-[#34422c] flex items-center justify-center shrink-0">
                  <Home className="w-5 h-5 text-[#c29b6c]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#f4f1ea]">Property &amp; Address</div>
                  <div className="text-xs text-[#b7ad96] truncate mt-0.5">{propertySummary}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#7a876f] shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('PHONE')}
                className="w-full px-4 py-3.5 flex items-center gap-3.5 text-left hover:bg-[#1b2316] active:bg-[#222c1c] transition-colors min-h-[66px]"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#271b11] border border-[#5e3819] flex items-center justify-center shrink-0">
                  <Phone className="w-5 h-5 text-[#f97316]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#f4f1ea]">Phone &amp; Public Records</div>
                  <div className="text-xs text-[#b7ad96] truncate mt-0.5">{phoneSummary}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#7a876f] shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('PERMISSION')}
                className="w-full px-4 py-3.5 flex items-center gap-3.5 text-left hover:bg-[#1b2316] active:bg-[#222c1c] transition-colors min-h-[66px]"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#192814] border border-[#355528] flex items-center justify-center shrink-0">
                  <FileCheck2 className="w-5 h-5 text-[#84cc16]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#f4f1ea]">Permission, Knock &amp; Mail</div>
                  <div className="text-xs text-[#b7ad96] truncate mt-0.5">{permissionSummary}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#7a876f] shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setActiveCategory('SCOUT')}
                className="w-full px-4 py-3.5 flex items-center gap-3.5 text-left hover:bg-[#1b2316] active:bg-[#222c1c] transition-colors min-h-[66px]"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#241f15] border border-[#4a3e28] flex items-center justify-center shrink-0">
                  <Compass className="w-5 h-5 text-[#c29b6c]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#f4f1ea]">Scout, Street View &amp; Notes</div>
                  <div className="text-xs text-[#b7ad96] truncate mt-0.5">{scoutSummary}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#7a876f] shrink-0" />
              </button>
            </div>

            <div className="p-3 bg-[#0f130c] border-t border-[#25301f] grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onRunEScout(parcel)}
                disabled={isEScoutLoading}
                className="py-3 px-3 rounded-2xl bg-[#ea580c] hover:bg-[#f97316] disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md"
              >
                {isEScoutLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>{isEScoutLoading ? 'Scouting...' : 'AI E-Scout'}</span>
              </button>

              <a
                href={driveToGateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 px-3 rounded-2xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <Navigation className="w-4 h-4 text-[#f97316]" />
                <span>Drive to Gate</span>
              </a>

              {primaryPhone && !hidePhonesForCrewPrivacy ? (
                <div className="col-span-2 sm:col-span-1 grid grid-cols-2 gap-1.5">
                  <a
                    href={`tel:${phoneDigits}`}
                    className="py-3 px-2 rounded-2xl bg-[#2f6619] hover:bg-[#3f7d20] text-[#f4f1ea] font-bold text-xs flex items-center justify-center gap-1"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span>Call</span>
                  </a>
                  <a
                    href={smsHref}
                    className="py-3 px-2 rounded-2xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#84cc16] font-bold text-xs flex items-center justify-center gap-1"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Text</span>
                  </a>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenStreetView(parcel.center)}
                  className="col-span-2 sm:col-span-1 py-3 px-3 rounded-2xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-4 h-4 text-[#c29b6c]" />
                  <span>Gate Street View</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            VIEW 2: PROPERTY & ADDRESS CATEGORY POPUP
           ============================================================ */}
        {activeCategory === 'PROPERTY' && (
          <div className="overflow-y-auto flex-1 min-h-0 touch-scroll-y p-4 space-y-4">
            <div className="divide-y divide-[#25301f] bg-[#182014] rounded-2xl border border-[#2d3826] overflow-hidden">
              <div className="px-3.5 py-3 flex items-start gap-3">
                <MapPin className="w-4 h-4 text-[#f97316] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#9c927d]">
                    Physical Property Address
                  </div>
                  <div className="text-sm font-semibold text-[#f4f1ea] mt-0.5">
                    {parcel.propertyAddress || 'Rural parcel — no road address on tax roll'}
                  </div>
                </div>
              </div>

              <div className="px-3.5 py-3 flex items-start gap-3">
                <Home className="w-4 h-4 text-[#84cc16] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#9c927d]">
                    Tax Mailing Address
                  </div>
                  <div className="text-sm font-semibold text-[#f4f1ea] mt-0.5">
                    {parcel.taxMailingAddress}
                  </div>
                  <div className="text-xs text-[#b7ad96] mt-1">
                    {parcel.livesOnLand
                      ? 'Owner lives on this property — good door-knock candidate.'
                      : 'Absentee landowner — mail letter or call first.'}
                  </div>
                </div>
              </div>

              <div className="px-3.5 py-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[10px] font-mono uppercase text-[#9c927d]">Acreage</div>
                  <div className="font-mono font-bold text-[#f97316] text-sm mt-0.5">
                    {parcel.acres.toFixed(2)} Acres
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[#9c927d]">Section / Legal</div>
                  <div className="font-mono font-semibold text-[#f4f1ea] text-sm mt-0.5">
                    {parcel.sectionCode}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[#9c927d]">County</div>
                  <div className="text-[#f4f1ea] font-semibold mt-0.5">{parcel.county}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase text-[#9c927d]">Land Cover</div>
                  <div className="text-[#f4f1ea] font-semibold mt-0.5">{parcel.landType}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <a
                href={driveToGateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-[#2f6619] hover:bg-[#3f7d20] text-white font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Drive to Gate</span>
              </a>
              <a
                href={countyTaxRollLink}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <span>County Tax Roll</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#c29b6c]" />
              </a>
              {parcel.permissionStatus !== 'PUBLIC' && (
                <button
                  type="button"
                  onClick={() => setShowEditOwner((v) => !v)}
                  className="col-span-2 sm:col-span-1 py-2.5 px-3 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>{showEditOwner ? 'Hide Editor' : 'Edit Owner Info'}</span>
                </button>
              )}
            </div>

            {showEditOwner && parcel.permissionStatus !== 'PUBLIC' && (
              <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#5e3819] space-y-2.5 text-xs">
                <div className="font-bold text-[#f97316]">
                  Save Confirmed Owner Details to Crew Map
                </div>
                <input
                  type="text"
                  value={editOwnerName}
                  onChange={(e) => setEditOwnerName(e.target.value)}
                  placeholder="Landowner full name (e.g. John & Mary Miller)"
                  className="w-full rounded-xl bg-[#0e120b] border border-[#34422c] px-3 py-2.5 text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <input
                  type="text"
                  value={editPropAddr}
                  onChange={(e) => setEditPropAddr(e.target.value)}
                  placeholder="Physical street address"
                  className="w-full rounded-xl bg-[#0e120b] border border-[#34422c] px-3 py-2.5 text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <input
                  type="text"
                  value={editMailAddr}
                  onChange={(e) => setEditMailAddr(e.target.value)}
                  placeholder="Mailing address (if different)"
                  className="w-full rounded-xl bg-[#0e120b] border border-[#34422c] px-3 py-2.5 text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="tel"
                    value={editOwnerPhone}
                    onChange={(e) => setEditOwnerPhone(e.target.value)}
                    placeholder="Phone (e.g. 620-555-0192)"
                    className="flex-1 rounded-xl bg-[#0e120b] border border-[#34422c] px-3 py-2.5 text-[#f4f1ea] placeholder-[#7a876f] font-mono focus:outline-none focus:border-[#ea580c]"
                  />
                  <label className="flex items-center gap-1.5 text-[#d6cebc] cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={editLivesOnLand}
                      onChange={(e) => setEditLivesOnLand(e.target.checked)}
                      className="accent-[#ea580c]"
                    />
                    <span>Lives on land</span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!editOwnerName.trim()) return;
                    onUpdateOwnerDetails(parcel.id, {
                      ownerName: editOwnerName.trim(),
                      propertyAddress: editPropAddr.trim() || undefined,
                      taxMailingAddress: editMailAddr.trim() || undefined,
                      savedOwnerPhone: editOwnerPhone.trim() || undefined,
                      livesOnLand: editLivesOnLand,
                    });
                    setShowEditOwner(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] text-white font-bold text-xs"
                >
                  Save Owner Details Permanently
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            VIEW 3: PHONE & PUBLIC RECORDS CATEGORY POPUP
           ============================================================ */}
        {activeCategory === 'PHONE' && (
          <div className="overflow-y-auto flex-1 min-h-0 touch-scroll-y p-4 space-y-4">
            <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#2d3826] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-[#f97316]" />
                  <span className="text-xs font-bold text-[#f4f1ea]">
                    All Owner Numbers ({allOwnerPhones.length})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAddPhone((v) => !v)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#232d1d] hover:bg-[#2d3a25] text-[#f4f1ea] text-[11px] font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3 text-[#f97316]" />
                    <span>Add #</span>
                  </button>
                  <button
                    type="button"
                    onClick={onToggleHidePhones}
                    className="p-1.5 rounded-lg bg-[#232d1d] hover:bg-[#2d3a25] text-[#b7ad96]"
                    title="Toggle Crew Privacy Phone Mask"
                  >
                    {hidePhonesForCrewPrivacy ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {showAddPhone && (
                <div className="flex items-center gap-2">
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="Add owner mobile or home # (e.g. 620-555-0148)"
                    className="flex-1 rounded-xl bg-[#0e120b] border border-[#3a4931] px-3 py-2 text-xs text-[#f4f1ea] font-mono focus:outline-none focus:border-[#ea580c]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!phoneInput.trim()) return;
                      onSaveOwnerPhone(parcel.id, phoneInput.trim(), {
                        asAdditional: allOwnerPhones.length > 0,
                      });
                      setPhoneInput('');
                      setShowAddPhone(false);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] text-white text-xs font-bold"
                  >
                    Save
                  </button>
                </div>
              )}

              {/* Permission Text Preset Selector */}
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#9c927d]">
                  Permission Text Message Style
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PERMISSION_SMS_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSmsTemplateId(tpl.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        smsTemplateId === tpl.id
                          ? 'bg-[#3f7d20] border-[#84cc16] text-white'
                          : 'bg-[#10150d] border-[#2d3826] text-[#b7ad96] hover:text-[#f4f1ea]'
                      }`}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {allOwnerPhones.length > 0 ? (
                <div className="space-y-2">
                  {allOwnerPhones.map((ph, idx) => {
                    const digits = formatPhoneDigits(ph.number);
                    const lineSmsHref = buildPermissionSmsHref(
                      ph.number,
                      parcel,
                      smsTemplateId,
                      undefined,
                      hunterName,
                      hunterPhone
                    );
                    return (
                      <div
                        key={`${digits}-${idx}`}
                        className="flex items-center justify-between gap-2 bg-[#10150d] px-3 py-2.5 rounded-xl border border-[#2d3826]"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-base text-[#f4f1ea]">
                            {hidePhonesForCrewPrivacy ? '(•••) •••-••••' : ph.number}
                          </div>
                          <div className="text-[11px] text-[#84cc16] truncate">
                            {ph.label} · {ph.source}
                          </div>
                        </div>
                        {!hidePhonesForCrewPrivacy && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={`tel:${digits}`}
                              className="px-3 py-2 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] text-white font-bold text-xs flex items-center gap-1.5"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                              <span>Call</span>
                            </a>
                            <a
                              href={lineSmsHref}
                              className="px-3 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center gap-1.5"
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
                <p className="text-xs text-[#b7ad96]">
                  No phone saved yet. Run the AI Phone &amp; Record Scan below or tap any public directory link.
                </p>
              )}

              {parcel.permissionStatus !== 'PUBLIC' && (
                <button
                  type="button"
                  onClick={() => onSearchPublicIntel(parcel)}
                  disabled={isSearchingPublicIntel}
                  className="w-full py-3 rounded-xl bg-[#ea580c] hover:bg-[#f97316] disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md"
                >
                  {isSearchingPublicIntel ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  <span>
                    {isSearchingPublicIntel
                      ? 'Scanning Public Records & Directories...'
                      : publicIntel
                        ? 'Refresh AI Phone & Record Scan'
                        : 'Run AI Phone & Public Record Scan'}
                  </span>
                </button>
              )}
            </div>

            {publicIntel && (
              <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#3a4931] space-y-3 text-xs">
                <div className="font-bold text-[#84cc16]">Public Record Findings</div>
                <p className="text-[#d6cebc] leading-relaxed">{publicIntel.summary}</p>

                {publicIntel.publicPhones && publicIntel.publicPhones.length > 0 && (
                  <div className="space-y-1.5">
                    {publicIntel.publicPhones.map((ph, idx) => {
                      const digits = formatPhoneDigits(ph.number);
                      const lineSmsHref = buildPermissionSmsHref(
                        ph.number,
                        parcel,
                        smsTemplateId,
                        undefined,
                        hunterName,
                        hunterPhone
                      );
                      return (
                        <div
                          key={`${ph.number}-${idx}`}
                          className="flex items-center justify-between gap-2 bg-[#0e120b] border border-[#2d3826] rounded-xl px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-[#f4f1ea]">
                              {hidePhonesForCrewPrivacy ? '(•••) •••-••••' : ph.number}
                            </div>
                            <div className="text-[11px] text-[#9c927d] truncate">
                              {ph.label} · {ph.source}
                            </div>
                          </div>
                          {!hidePhonesForCrewPrivacy && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => onSaveOwnerPhone(parcel.id, ph.number, { asAdditional: true })}
                                className="px-2.5 py-1.5 rounded-lg bg-[#232d1d] hover:bg-[#314029] text-[#f4f1ea] text-[11px] font-bold"
                              >
                                Save
                              </button>
                              <a
                                href={`tel:${digits}`}
                                className="px-2.5 py-1.5 rounded-lg bg-[#3f7d20] hover:bg-[#4d9328] text-white text-[11px] font-bold flex items-center gap-1"
                              >
                                <PhoneCall className="w-3 h-3" />
                                <span>Call</span>
                              </a>
                              <a
                                href={lineSmsHref}
                                className="px-2.5 py-1.5 rounded-lg bg-[#ea580c] hover:bg-[#f97316] text-white text-[11px] font-bold flex items-center gap-1"
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span>Text</span>
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {publicIntel.matchedListings && publicIntel.matchedListings.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-mono uppercase text-[#9c927d]">
                      Matched Directory Listings
                    </div>
                    {publicIntel.matchedListings.map((m, i) => (
                      <a
                        key={`${m.url}-${i}`}
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-2.5 rounded-xl bg-[#0e120b] border border-[#2d3826] hover:border-[#ea580c]"
                      >
                        <div className="font-bold text-[#f4f1ea] flex items-center justify-between gap-2">
                          <span className="truncate">{m.name}</span>
                          <ExternalLink className="w-3 h-3 text-[#f97316] shrink-0" />
                        </div>
                        <div className="text-[11px] text-[#b7ad96] truncate">
                          {m.phone ? `${m.phone} · ` : ''}
                          {m.address} ({m.source})
                        </div>
                      </a>
                    ))}
                  </div>
                )}

                {publicIntel.portfolio && publicIntel.portfolio.parcelCount > 0 && (
                  <div className="text-[#b7ad96] bg-[#0e120b] rounded-xl p-2.5 border border-[#2d3826]">
                    <span className="font-bold text-[#f4f1ea]">KS Land Portfolio: </span>
                    {publicIntel.portfolio.parcelCount} parcels ·{' '}
                    {publicIntel.portfolio.totalAcres.toFixed(1)} ac across{' '}
                    {publicIntel.portfolio.counties.join(', ')}
                  </div>
                )}

                {publicIntel.groundingLinks && publicIntel.groundingLinks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {publicIntel.groundingLinks.map((src, i) => (
                      <a
                        key={`${src.uri}-${i}`}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-[#232d1d] hover:bg-[#2f3c27] text-[#c29b6c] text-[11px] font-semibold flex items-center gap-1"
                      >
                        <span className="truncate max-w-[160px]">{src.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#9c927d] px-1">
                Direct Public Lookup Portals
              </div>
              <div className="divide-y divide-[#25301f] bg-[#182014] rounded-2xl border border-[#2d3826] overflow-hidden">
                {parcel.publicLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-3 flex items-center justify-between gap-2 text-xs font-semibold text-[#f4f1ea] hover:bg-[#222c1c] transition-colors"
                  >
                    <span>{link.label}</span>
                    <ExternalLink className="w-4 h-4 text-[#f97316] shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            VIEW 4: PERMISSION, KNOCK, MAIL & LEASE CATEGORY POPUP
           ============================================================ */}
        {activeCategory === 'PERMISSION' && (
          <div className="overflow-y-auto flex-1 min-h-0 touch-scroll-y p-4 space-y-3.5">
            <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-[#0e120b] border border-[#2d3826]">
              {(
                [
                  { id: 'SLIP', label: 'Warden Slip', icon: FileCheck2 },
                  { id: 'KNOCK', label: 'Knock', icon: DoorOpen },
                  { id: 'MAIL', label: 'Letter', icon: Mail },
                  { id: 'LEASE', label: 'Lease', icon: Send },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = permTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPermTab(tab.id)}
                    className={`py-2 px-1.5 rounded-xl text-[11px] font-bold flex flex-col items-center gap-0.5 transition-colors ${
                      active
                        ? 'bg-[#ea580c] text-white'
                        : 'text-[#b7ad96] hover:text-[#f4f1ea]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {permTab === 'SLIP' && (
              <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#2d3826] space-y-3 text-xs">
                {parcel.permissionSlip ? (
                  <>
                    <div className="flex items-center gap-2 text-[#84cc16] font-bold text-sm">
                      <ShieldCheck className="w-5 h-5" />
                      <span>Active Digital Game Warden Slip</span>
                    </div>
                    <div className="divide-y divide-[#25301f] text-[#d6cebc]">
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[#9c927d]">Landowner</span>
                        <span className="font-bold text-[#f4f1ea]">
                          {parcel.permissionSlip.ownerName}
                        </span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[#9c927d]">Valid Dates</span>
                        <span className="font-mono text-[#f4f1ea]">
                          {parcel.permissionSlip.grantedDate} → {parcel.permissionSlip.expiresDate}
                        </span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[#9c927d]">Max Hunters</span>
                        <span className="font-mono font-bold text-[#f97316]">
                          {parcel.permissionSlip.maxHuntersAtOnce}
                        </span>
                      </div>
                      <div className="py-2">
                        <div className="text-[#9c927d] mb-0.5">Owner Rules</div>
                        <div className="text-[#f4f1ea]">{parcel.permissionSlip.rulesAndNotes}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {onOpenWardenSlip && (
                        <button
                          type="button"
                          onClick={() => onOpenWardenSlip(parcel)}
                          className="py-2.5 px-3 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Print / View Slip</span>
                        </button>
                      )}
                      <a
                        href={driveToGateUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="py-2.5 px-3 rounded-xl bg-[#2f6619] hover:bg-[#3f7d20] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Drive to Gate</span>
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-bold text-[#f4f1ea]">
                      Generate Written Permission Slip (KS Statutory Proof)
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[#b7ad96]">Max Hunters:</label>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={slipMaxHunters}
                        onChange={(e) => setSlipMaxHunters(Number(e.target.value) || 1)}
                        className="w-20 rounded-xl bg-[#0e120b] border border-[#3a4931] px-2.5 py-1.5 text-[#f4f1ea] font-mono"
                      />
                    </div>
                    <textarea
                      rows={3}
                      value={slipRules}
                      onChange={(e) => setSlipRules(e.target.value)}
                      className="w-full rounded-xl bg-[#0e120b] border border-[#3a4931] p-2.5 text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onCreatePermissionSlip(
                          parcel.id,
                          ['Deer', 'Coyote'],
                          slipMaxHunters,
                          slipRules
                        )
                      }
                      className="w-full py-2.5 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] text-white font-bold"
                    >
                      Save Signed Digital Permission Slip
                    </button>
                  </>
                )}
              </div>
            )}

            {permTab === 'KNOCK' && (
              <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#2d3826] space-y-3 text-xs">
                <div className="font-bold text-[#f4f1ea]">Log Door Knock Visit</div>
                <textarea
                  rows={3}
                  value={knockOutcome}
                  onChange={(e) => setKnockOutcome(e.target.value)}
                  className="w-full rounded-xl bg-[#0e120b] border border-[#3a4931] p-2.5 text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!knockOutcome.trim()) return;
                    onLogKnockVisit(parcel.id, knockOutcome.trim());
                    setKnockOutcome('');
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold"
                >
                  Save Knock &amp; Log to Crew Notes
                </button>
              </div>
            )}

            {permTab === 'MAIL' && (
              <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#2d3826] space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#f4f1ea]">Ready-to-Mail Letter</span>
                  <button
                    type="button"
                    onClick={handleCopyLetter}
                    className="px-3 py-1.5 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold flex items-center gap-1"
                  >
                    {copiedLetter ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLetter ? 'Copied!' : 'Copy Letter'}</span>
                  </button>
                </div>
                <div className="text-[11px] font-mono text-[#c29b6c]">
                  To: {parcel.taxMailingAddress}
                </div>
                <pre className="whitespace-pre-wrap font-sans bg-[#0e120b] border border-[#2d3826] rounded-xl p-3 text-[#d6cebc] leading-relaxed">
                  {letterBody}
                </pre>
              </div>
            )}

            {permTab === 'LEASE' && (
              <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#2d3826] space-y-3 text-xs">
                <div className="font-bold text-[#f4f1ea]">Direct Lease / Access Chat</div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {parcel.leaseMessages.length === 0 ? (
                    <div className="text-[#9c927d]">No messages sent yet.</div>
                  ) : (
                    parcel.leaseMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`p-2.5 rounded-xl ${
                          m.sender === 'CREW'
                            ? 'bg-[#2a1d12] border border-[#5e3819] ml-6'
                            : 'bg-[#1a2614] border border-[#355528] mr-6'
                        }`}
                      >
                        <div className="flex justify-between text-[10px] font-mono text-[#b7ad96]">
                          <span>{m.senderName}</span>
                          <span>{m.timestamp}</span>
                        </div>
                        <div className="text-[#f4f1ea] mt-0.5">{m.message}</div>
                        {m.proposedAnnualRate && (
                          <div className="text-[10px] font-mono text-[#f97316] mt-0.5">
                            Offer: ${m.proposedAnnualRate.toLocaleString()}/yr
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#9c927d] font-mono">$</span>
                  <input
                    type="number"
                    value={leaseOffer}
                    onChange={(e) => setLeaseOffer(e.target.value)}
                    placeholder="Offer $"
                    className="w-24 rounded-xl bg-[#0e120b] border border-[#3a4931] px-2.5 py-2 text-[#f4f1ea] font-mono"
                  />
                  <input
                    type="text"
                    value={leaseMsg}
                    onChange={(e) => setLeaseMsg(e.target.value)}
                    placeholder="Message landowner..."
                    className="flex-1 rounded-xl bg-[#0e120b] border border-[#3a4931] px-3 py-2 text-[#f4f1ea] focus:outline-none focus:border-[#ea580c]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!leaseMsg.trim()) return;
                      onSendLeaseMessage(
                        parcel.id,
                        leaseMsg.trim(),
                        leaseOffer ? Number(leaseOffer) : undefined
                      );
                      setLeaseMsg('');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            VIEW 5: SCOUT, STREET VIEW, PRESSURE & CREW NOTES POPUP
           ============================================================ */}
        {activeCategory === 'SCOUT' && (
          <div className="overflow-y-auto flex-1 min-h-0 touch-scroll-y p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onRunEScout(parcel)}
                disabled={isEScoutLoading}
                className="py-3 px-3 rounded-2xl bg-[#ea580c] hover:bg-[#f97316] disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5"
              >
                {isEScoutLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>{isEScoutLoading ? 'Analyzing...' : 'Run AI E-Scout'}</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenStreetView(parcel.center)}
                className="py-3 px-3 rounded-2xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <Eye className="w-4 h-4 text-[#c29b6c]" />
                <span>Gate Street View</span>
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#2d3826] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#271b11] border border-[#5e3819] flex items-center justify-center">
                  <Truck className="w-5 h-5 text-[#f97316]" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#f4f1ea]">
                    Pressure: {parcel.trucksSeenThisWeek}{' '}
                    {parcel.trucksSeenThisWeek === 1 ? 'Truck' : 'Trucks'} ({parcel.pressureLevel})
                  </div>
                  <div className="text-[11px] text-[#b7ad96]">
                    Log parked hunter vehicles at the gate
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onIncrementTrucksSeen(parcel.id)}
                className="px-3.5 py-2 rounded-xl bg-[#2a3623] hover:bg-[#38472e] border border-[#4a5d3e] text-[#f4f1ea] text-xs font-bold shrink-0"
              >
                +1 Truck
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#182014] border border-[#2d3826] space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#f4f1ea] flex items-center gap-1.5">
                  <MessageSquarePlus className="w-4 h-4 text-[#84cc16]" />
                  <span>Crew Field Notes ({parcel.crewNotes.length})</span>
                </span>
                <select
                  value={noteTag}
                  onChange={(e) =>
                    setNoteTag(
                      e.target.value as
                        | 'Knock Intel'
                        | 'Access Rule'
                        | 'Sighting'
                        | 'Pressure Warning'
                    )
                  }
                  className="rounded-lg bg-[#0e120b] border border-[#3a4931] px-2 py-1 text-[11px] text-[#f4f1ea]"
                >
                  <option value="Knock Intel">Knock Intel</option>
                  <option value="Access Rule">Access Rule</option>
                  <option value="Sighting">Sighting</option>
                  <option value="Pressure Warning">Pressure Warning</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Gate combo, buck sign, turkey roost..."
                  className="flex-1 rounded-xl bg-[#0e120b] border border-[#3a4931] px-3 py-2 text-[#f4f1ea] placeholder-[#7a876f] focus:outline-none focus:border-[#ea580c]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!noteInput.trim()) return;
                    onAddCrewNote(parcel.id, noteInput.trim(), noteTag);
                    setNoteInput('');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-[#3f7d20] hover:bg-[#4d9328] text-white font-bold"
                >
                  Save
                </button>
              </div>

              {parcel.crewNotes.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {parcel.crewNotes.map((n) => (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-xl bg-[#0e120b] border border-[#25301f]"
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#9c927d]">
                        <span className="text-[#c29b6c] font-bold">{n.tag || 'Field Note'}</span>
                        <span>
                          {n.author} · {n.timestamp}
                        </span>
                      </div>
                      <p className="text-[#f4f1ea] mt-0.5">{n.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
