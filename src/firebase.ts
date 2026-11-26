import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  User,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export interface HunterProfile {
  uid: string;
  displayName: string;
  email: string;
  phone?: string;
  role: 'hunter';
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function sanitizeDisplayName(rawName: string | null | undefined, email?: string | null): string {
  const cleaned = String(rawName || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (cleaned.length >= 2) return cleaned;
  const fromEmail = String(email || '')
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim()
    .slice(0, 80);
  if (fromEmail.length >= 2) return fromEmail;
  return 'Kansas Hunter';
}

function sanitizePhone(rawPhone?: string | null): string {
  return String(rawPhone || '')
    .trim()
    .slice(0, 32);
}

export function getShortHunterName(fullName: string): string {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'Hunter';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

const inFlightNoArgSync = new Map<string, Promise<HunterProfile>>();
const userSyncLocks = new Map<string, Promise<unknown>>();
const pendingSignupOverrides = new Map<string, { displayName?: string; phone?: string }>();

export function setPendingSignupOverrides(
  email: string,
  overrides: { displayName?: string; phone?: string }
): void {
  const key = String(email || '').trim().toLowerCase();
  if (key) pendingSignupOverrides.set(key, overrides);
}

function runWithUidLock<T>(uid: string, task: () => Promise<T>): Promise<T> {
  const prev = userSyncLocks.get(uid) || Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const tracked = next.catch(() => undefined);
  userSyncLocks.set(uid, tracked);
  tracked.finally(() => {
    if (userSyncLocks.get(uid) === tracked) {
      userSyncLocks.delete(uid);
    }
  });
  return next;
}

export async function configureAuthPersistence(rememberLogin: boolean): Promise<void> {
  await setPersistence(
    auth,
    rememberLogin ? browserLocalPersistence : browserSessionPersistence
  );
}

export async function loadOrSyncUserProfile(
  user: User,
  overrides?: { displayName?: string; phone?: string }
): Promise<HunterProfile> {
  if (!VALID_ID_REGEX.test(user.uid) || user.uid.length > 128) {
    throw new Error('Invalid user UID format');
  }

  const emailKey = String(user.email || '').trim().toLowerCase();
  const hasExplicitOverrides = Boolean(
    overrides && (overrides.displayName !== undefined || overrides.phone !== undefined)
  );

  if (!hasExplicitOverrides) {
    const existingFlight = inFlightNoArgSync.get(user.uid);
    if (existingFlight) {
      return existingFlight;
    }
  }

  const syncPromise = runWithUidLock(user.uid, async () => {
    const pending = emailKey ? pendingSignupOverrides.get(emailKey) : undefined;
    if (pending && emailKey) {
      pendingSignupOverrides.delete(emailKey);
    }
    const mergedOverrides = {
      displayName: overrides?.displayName ?? pending?.displayName,
      phone: overrides?.phone ?? pending?.phone,
    };

    const profilePath = `users/${user.uid}`;
    const docRef = doc(db, 'users', user.uid);
    const safeEmail = String(user.email || `${user.uid}@sectionline.local`)
      .trim()
      .slice(0, 160);

    let snap;
    try {
      snap = await getDocFromServer(docRef);
    } catch {
      try {
        snap = await getDoc(docRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, profilePath);
      }
    }

    if (!snap.exists()) {
      const displayName = sanitizeDisplayName(
        mergedOverrides.displayName || user.displayName,
        safeEmail
      );
      const phone = sanitizePhone(mergedOverrides.phone);
      const payload: Record<string, unknown> = {
        uid: user.uid,
        displayName,
        email: safeEmail,
        role: 'hunter',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (phone) payload.phone = phone;

      try {
        await setDoc(docRef, payload);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, profilePath);
      }

      return {
        uid: user.uid,
        displayName,
        email: safeEmail,
        phone: phone || undefined,
        role: 'hunter' as const,
      };
    }

    const data = snap.data() as Record<string, unknown>;
    const existingName = sanitizeDisplayName(
      typeof data.displayName === 'string' ? data.displayName : user.displayName,
      safeEmail
    );
    const existingPhone = sanitizePhone(typeof data.phone === 'string' ? data.phone : '');

    const wantsNameUpdate =
      Boolean(mergedOverrides.displayName?.trim()) &&
      sanitizeDisplayName(mergedOverrides.displayName, safeEmail) !== existingName;
    const wantsPhoneUpdate =
      mergedOverrides.phone !== undefined && sanitizePhone(mergedOverrides.phone) !== existingPhone;

    if (wantsNameUpdate || wantsPhoneUpdate) {
      const nextName = wantsNameUpdate
        ? sanitizeDisplayName(mergedOverrides.displayName, safeEmail)
        : existingName;
      const nextPhone = wantsPhoneUpdate ? sanitizePhone(mergedOverrides.phone) : existingPhone;
      const updatePayload: Record<string, unknown> = {
        displayName: nextName,
        phone: nextPhone,
        updatedAt: serverTimestamp(),
      };
      try {
        await updateDoc(docRef, updatePayload);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, profilePath);
      }
      return {
        uid: user.uid,
        displayName: nextName,
        email: typeof data.email === 'string' ? data.email : safeEmail,
        phone: nextPhone || undefined,
        role: 'hunter' as const,
      };
    }

    return {
      uid: user.uid,
      displayName: existingName,
      email: typeof data.email === 'string' ? data.email : safeEmail,
      phone: existingPhone || undefined,
      role: 'hunter' as const,
    };
  });

  if (!hasExplicitOverrides) {
    inFlightNoArgSync.set(user.uid, syncPromise);
    syncPromise
      .catch(() => undefined)
      .finally(() => {
        if (inFlightNoArgSync.get(user.uid) === syncPromise) {
          inFlightNoArgSync.delete(user.uid);
        }
      });
  }

  return syncPromise;
}

export async function updateHunterProfile(
  user: User,
  updates: { displayName: string; phone?: string }
): Promise<HunterProfile> {
  return loadOrSyncUserProfile(user, {
    displayName: updates.displayName,
    phone: updates.phone ?? '',
  });
}
