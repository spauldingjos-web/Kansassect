import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  Printer,
  Copy,
  Check,
  Navigation,
  PhoneCall,
  MessageSquare,
} from 'lucide-react';
import { HuntingParcel, FieldPin } from '../types/hunting';

interface WardenSlipModalProps {
  parcel: HuntingParcel | null;
  pins?: FieldPin[];
  hidePhonesForCrewPrivacy?: boolean;
  hunterName?: string;
  onClose: () => void;
}

export function resolveParcelGateDestination(
  parcel: HuntingParcel,
  pins: FieldPin[] = []
): { lat: number; lng: number; label: string } {
  const gatePin = pins.find(
    (p) => p.parcelId === parcel.id && (p.category === 'Gate' || p.category === 'Parking')
  );
  if (gatePin) {
    return { lat: gatePin.lat, lng: gatePin.lng, label: gatePin.label || `${gatePin.category} Pin` };
  }
  if (parcel.parkingLotCoords) {
    return parcel.parkingLotCoords;
  }
  return {
    lat: parcel.center.lat,
    lng: parcel.center.lng,
    label: parcel.propertyAddress || parcel.sectionCode || parcel.county,
  };
}

export const WardenSlipModal: React.FC<WardenSlipModalProps> = ({
  parcel,
  pins = [],
  hidePhonesForCrewPrivacy = false,
  hunterName = 'Kansas Hunter',
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!parcel || !parcel.permissionSlip) return null;

  const slip = parcel.permissionSlip;
  const gate = resolveParcelGateDestination(parcel, pins);
  const rawPhone =
    parcel.savedOwnerPhone || parcel.publicPhoneListing || slip.ownerPhoneVerified || '';
  const digits = rawPhone.replace(/[^\d+]/g, '');
  const hasRealPhone = digits.length >= 10 && !/Verified On File/i.test(rawPhone);

  const proofSummary = [
    `KANSAS STATUTORY WRITTEN HUNTING PERMISSION (K.S.A. 32-1013)`,
    `Permit ID: ${slip.id} | Verification: ${slip.verificationHash}`,
    `Landowner: ${slip.ownerName}${hasRealPhone && !hidePhonesForCrewPrivacy ? ` (${rawPhone})` : ''}`,
    `Property: ${parcel.name} | ${parcel.county} | ${parcel.sectionCode} (${parcel.acres.toFixed(1)} ac)`,
    `Authorized Hunters: ${slip.hunterNames.join(', ')} (Max ${slip.maxHuntersAtOnce} at once)`,
    `Valid Dates: ${slip.grantedDate} through ${slip.expiresDate}`,
    `Species: ${slip.allowedSpecies.join(', ')} | Weapons: ${slip.weaponsAllowed}`,
    `Rules: ${slip.rulesAndNotes}`,
    `Gate GPS: ${gate.lat.toFixed(5)}, ${gate.lng.toFixed(5)} (${gate.label})`,
  ].join('\n');

  const handleCopyProof = () => {
    navigator.clipboard?.writeText(proofSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const smsCheckInBody = `Hi ${slip.ownerName.split('/')[0].trim()}, this is ${hunterName} checking in per our permission slip (${slip.id}) before heading onto ${parcel.sectionCode}. Appreciate your hospitality!`;

  return (
    <div className="print-slip-overlay fixed inset-0 z-[750] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 overflow-hidden">
      <div
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="print-slip-card animate-sheet-up w-full max-w-xl bg-[#131810] border border-[#3f7d20] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col min-h-0"
      >
        {/* Top Action Bar */}
        <div className="no-print camo-header px-4 py-3 border-b border-[#2d3826] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#84cc16]" />
            <div>
              <h2 className="font-display text-xl font-bold text-[#f4f1ea] leading-none">
                GAME WARDEN PERMISSION SLIP
              </h2>
              <p className="text-[11px] font-mono text-[#b7ad96] mt-0.5">
                {slip.id} · Offline Field Ready
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Warden Slip"
            className="w-9 h-9 rounded-full bg-[#1d2518] hover:bg-[#2a3623] border border-[#3a4931] text-[#d6cebc] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Proof Document Body */}
        <div className="overflow-y-auto flex-1 min-h-0 touch-scroll-y p-5 space-y-4 bg-[#f4f1ea] text-[#11150e]">
          <div className="border-b-2 border-[#11150e] pb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#3f7d20]">
                Kansas Written Hunting Permission Proof · K.S.A. 32-1013
              </div>
              <h3 className="font-display text-2xl font-bold tracking-tight text-[#0c0f0a] mt-0.5">
                {slip.ownerName}
              </h3>
              <div className="text-xs font-medium text-[#2d3826]">
                {parcel.county} · {parcel.sectionCode} · {parcel.acres.toFixed(2)} Acres
              </div>
            </div>
            <div className="text-right font-mono text-[11px]">
              <div className="font-bold text-[#0c0f0a]">{slip.id}</div>
              <div className="text-[#4a5a3f]">{slip.verificationHash}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 rounded-xl bg-[#e7e2d4] border border-[#c6beaa]">
              <div className="text-[10px] font-mono uppercase text-[#4a5a3f]">Valid Dates</div>
              <div className="font-mono font-bold text-[#0c0f0a] mt-0.5">
                {slip.grantedDate} → {slip.expiresDate}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#e7e2d4] border border-[#c6beaa]">
              <div className="text-[10px] font-mono uppercase text-[#4a5a3f]">Owner Contact</div>
              <div className="font-mono font-bold text-[#0c0f0a] mt-0.5">
                {hidePhonesForCrewPrivacy
                  ? '(•••) •••-••••'
                  : rawPhone || 'On File with Crew'}
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs border-y border-[#c6beaa] py-3">
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-[#4a5a3f]">Authorized Hunters:</span>
              <span className="font-bold text-right">{slip.hunterNames.join(', ')}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-[#4a5a3f]">Max Hunters On Property:</span>
              <span className="font-mono font-bold">{slip.maxHuntersAtOnce} at a time</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-[#4a5a3f]">Species Allowed:</span>
              <span className="font-bold">{slip.allowedSpecies.join(', ')}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-[#4a5a3f]">Methods / Weapons:</span>
              <span className="font-semibold text-right">{slip.weaponsAllowed}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-semibold text-[#4a5a3f]">Gate / Parking GPS:</span>
              <span className="font-mono font-semibold text-right">
                {gate.lat.toFixed(5)}, {gate.lng.toFixed(5)}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#e7e2d4] border border-[#c6beaa] text-xs">
            <div className="text-[10px] font-mono uppercase font-bold text-[#3f7d20] mb-1">
              Landowner Access Rules &amp; Stipulations
            </div>
            <p className="text-[#11150e] leading-relaxed">{slip.rulesAndNotes}</p>
          </div>

          {slip.gatePhotoUrl && (
            <div className="flex items-center gap-3 pt-1">
              <img
                src={slip.gatePhotoUrl}
                alt="Signed Gate Verification"
                referrerPolicy="no-referrer"
                className="w-20 h-14 object-cover rounded-lg border border-[#b7ad96]"
              />
              <div className="text-[11px] text-[#3a4931]">
                Gate &amp; landowner verification record cached offline in SectionLine KS. Present directly to KDWP Conservation Officers if requested in the field.
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="no-print p-3 bg-[#0e120b] border-t border-[#2d3826] flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 min-w-[130px] py-2.5 px-3 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save PDF</span>
          </button>

          <button
            type="button"
            onClick={handleCopyProof}
            className="py-2.5 px-3 rounded-xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center gap-1.5"
          >
            {copied ? <Check className="w-4 h-4 text-[#84cc16]" /> : <Copy className="w-4 h-4 text-[#c29b6c]" />}
            <span>{copied ? 'Copied' : 'Copy Proof'}</span>
          </button>

          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${gate.lat},${gate.lng}&travelmode=driving`}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2.5 px-3 rounded-xl bg-[#2f6619] hover:bg-[#3f7d20] text-white font-bold text-xs flex items-center gap-1.5"
          >
            <Navigation className="w-4 h-4" />
            <span>Drive to Gate</span>
          </a>

          {hasRealPhone && !hidePhonesForCrewPrivacy && (
            <>
              <a
                href={`sms:${digits}?&body=${encodeURIComponent(smsCheckInBody)}`}
                className="py-2.5 px-3 rounded-xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#84cc16] font-bold text-xs flex items-center gap-1.5"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Check-In Text</span>
              </a>
              <a
                href={`tel:${digits}`}
                className="py-2.5 px-3 rounded-xl bg-[#1e2719] hover:bg-[#2a3623] border border-[#3a4931] text-[#f97316] font-bold text-xs flex items-center gap-1.5"
              >
                <PhoneCall className="w-4 h-4" />
                <span>Call</span>
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
