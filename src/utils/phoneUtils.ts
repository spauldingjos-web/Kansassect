import { HuntingParcel, OwnerPublicIntel, PublicPhoneMatch } from '../types/hunting';

export type PermissionSmsTemplateId = 'bow' | 'predator' | 'turkey' | 'checkin';

export interface PermissionSmsTemplate {
  id: PermissionSmsTemplateId;
  label: string;
  shortDesc: string;
  build: (parcel: HuntingParcel, ownerFirst: string, hunterName: string) => string;
}

export const PERMISSION_SMS_TEMPLATES: PermissionSmsTemplate[] = [
  {
    id: 'bow',
    label: 'Deer / Bow Ask',
    shortDesc: 'Polite archery permission & venison offer',
    build: (parcel, ownerFirst, hunterName) =>
      `Hello ${ownerFirst}, my name is ${hunterName}, a respectful local Kansas bowhunter. I saw your ${parcel.acres.toFixed(
        1
      )}-acre tract in ${parcel.county} (${parcel.sectionCode}) and wanted to politely ask if you might consider deer hunting permission this season. Always close every gate, park cleanly, never drive wet pasture, and gladly share processed venison.`,
  },
  {
    id: 'predator',
    label: 'Coyote Help',
    shortDesc: 'Offer coyote & predator control for cattle/calves',
    build: (parcel, ownerFirst, hunterName) =>
      `Hello ${ownerFirst}, ${hunterName} here — local respectful Kansas hunter. Would you ever consider letting me help with coyote/predator control on your ${parcel.acres.toFixed(
        1
      )}-acre ${parcel.county} ground (${parcel.sectionCode})? Always text before coming, keep pasture gates latched, and protect livestock.`,
  },
  {
    id: 'turkey',
    label: 'Turkey Ask',
    shortDesc: 'Polite walk-in turkey permission request',
    build: (parcel, ownerFirst, hunterName) =>
      `Hello ${ownerFirst}, my name is ${hunterName}, a respectful local Kansas hunter. I noticed your ${parcel.acres.toFixed(
        1
      )}-acre parcel in ${parcel.county} and wanted to politely ask if you'd ever allow quiet walk-in turkey hunting permission. Always close gates and share meat.`,
  },
  {
    id: 'checkin',
    label: 'Gate Check-In',
    shortDesc: 'Active permission day-of check-in text',
    build: (parcel, ownerFirst, hunterName) =>
      parcel.permissionSlip
        ? `Hi ${ownerFirst}, this is ${hunterName} checking in per our hunting permission (${parcel.permissionSlip.id}) before heading out to your ${parcel.sectionCode} ground today. Let me know if anything changed — thank you!`
        : `Hi ${ownerFirst}, this is ${hunterName} checking in ahead of heading out to your ${parcel.sectionCode} (${parcel.county}) ground today. Thank you!`,
  },
];

export function formatPhoneDigits(raw?: string): string {
  return String(raw || '').replace(/[^\d+]/g, '');
}

export function getCleanOwnerDisplay(ownerName: string): string {
  return String(ownerName || 'Landowner')
    .split('/')[0]
    .split(';')[0]
    .trim();
}

export function getAllParcelPhones(
  parcel: HuntingParcel,
  publicIntel?: OwnerPublicIntel
): PublicPhoneMatch[] {
  const result: PublicPhoneMatch[] = [];
  const seenDigits = new Set<string>();

  const pushPhone = (rawNumber: string | undefined, label: string, source: string) => {
    const num = String(rawNumber || '').trim();
    if (!num) return;
    const tenDigits = num.replace(/\D/g, '').slice(-10);
    if (tenDigits.length < 7) return;
    if (seenDigits.has(tenDigits)) return;
    seenDigits.add(tenDigits);
    result.push({ number: num, label, source });
  };

  // 1. Crew-saved primary and additional phones first
  if (parcel.savedOwnerPhone) {
    pushPhone(parcel.savedOwnerPhone, 'Crew Primary', 'Saved by Hunting Crew');
  }
  if (Array.isArray(parcel.savedAdditionalPhones)) {
    parcel.savedAdditionalPhones.forEach((ph, i) => {
      pushPhone(ph, `Crew Line #${i + 2}`, 'Saved by Hunting Crew');
    });
  }

  // 2. All publicPhoneListings attached to the parcel (from directory scrapes / cache / batch lookup)
  if (Array.isArray(parcel.publicPhoneListings)) {
    for (const item of parcel.publicPhoneListings) {
      pushPhone(item?.number, item?.label || 'Public Line', item?.source || parcel.phoneSourceCitation || 'Public Directory');
    }
  }

  // 3. Single publicPhoneListing fallback
  if (parcel.publicPhoneListing) {
    pushPhone(
      parcel.publicPhoneListing,
      'Listed Phone',
      parcel.phoneSourceCitation || 'Public Directory'
    );
  }

  // 4. Live OwnerPublicIntel scan results
  if (Array.isArray(publicIntel?.publicPhones)) {
    for (const item of publicIntel.publicPhones) {
      pushPhone(item?.number, item?.label || 'Directory Match', item?.source || 'Public Record Scan');
    }
  }

  return result;
}

export function buildPermissionSmsText(
  parcel: HuntingParcel,
  templateId?: PermissionSmsTemplateId,
  customMessage?: string,
  hunterName?: string,
  hunterPhone?: string
): string {
  const ownerFirst = getCleanOwnerDisplay(parcel.ownerName);
  const resolvedHunter = (hunterName || '').trim() || 'Kansas Hunter';
  if (customMessage && customMessage.trim()) {
    return customMessage
      .replace(/\{owner\}/gi, ownerFirst)
      .replace(/\{acres\}/gi, parcel.acres.toFixed(1))
      .replace(/\{county\}/gi, parcel.county)
      .replace(/\{section\}/gi, parcel.sectionCode)
      .replace(/\{hunter\}|\{name\}/gi, resolvedHunter)
      .replace(/\{phone\}/gi, (hunterPhone || '').trim());
  }
  const resolvedId: PermissionSmsTemplateId =
    templateId || (parcel.permissionSlip ? 'checkin' : 'bow');
  const tpl =
    PERMISSION_SMS_TEMPLATES.find((t) => t.id === resolvedId) || PERMISSION_SMS_TEMPLATES[0];
  return tpl.build(parcel, ownerFirst, resolvedHunter);
}

export function buildPermissionSmsHref(
  phone: string,
  parcel: HuntingParcel,
  templateId?: PermissionSmsTemplateId,
  customMessage?: string,
  hunterName?: string,
  hunterPhone?: string
): string {
  const digits = formatPhoneDigits(phone);
  if (!digits) return '';
  const body = buildPermissionSmsText(parcel, templateId, customMessage, hunterName, hunterPhone);
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}
