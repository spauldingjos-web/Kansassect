import React, { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  Crosshair,
  ShieldCheck,
  UserPlus,
  LogIn,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  BookmarkCheck,
  Phone,
  Mail,
  Lock,
  User as UserIcon,
} from 'lucide-react';
import {
  auth,
  googleProvider,
  configureAuthPersistence,
  loadOrSyncUserProfile,
  setPendingSignupOverrides,
  HunterProfile,
} from '../firebase';
import firebaseConfig from '../../firebase-applet-config.json';
import { PWAInstallButton } from './PWAInstallButton';

const SAVED_LOGIN_HINT_KEY = 'sectionline_ks_saved_login_hint_v1';
export const STANDALONE_AUTHED_KEY = 'sectionline_ks_standalone_authed_v1';

interface SavedLoginHint {
  email: string;
  displayName?: string;
  phone?: string;
  remember: boolean;
}

function readSavedLoginHint(): SavedLoginHint | null {
  try {
    const raw = localStorage.getItem(SAVED_LOGIN_HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLoginHint;
    if (parsed && typeof parsed.email === 'string') return parsed;
  } catch {
    // Ignore storage issues
  }
  return null;
}

function writeSavedLoginHint(hint: SavedLoginHint | null): void {
  try {
    if (!hint) {
      localStorage.removeItem(SAVED_LOGIN_HINT_KEY);
    } else {
      localStorage.setItem(SAVED_LOGIN_HINT_KEY, JSON.stringify(hint));
    }
  } catch {
    // Ignore storage issues
  }
}

interface AuthScreenProps {
  onAuthenticated: (user: User, profile: HunterProfile) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const savedHint = readSavedLoginHint();

  const [mode, setMode] = useState<'SIGN_IN' | 'CREATE_ACCOUNT'>(
    savedHint?.email ? 'SIGN_IN' : 'CREATE_ACCOUNT'
  );
  const [fullName, setFullName] = useState(savedHint?.displayName || '');
  const [email, setEmail] = useState(savedHint?.email || '');
  const [phone, setPhone] = useState(savedHint?.phone || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState<boolean>(savedHint?.remember ?? true);
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsEmailProviderEnable, setNeedsEmailProviderEnable] = useState(false);

  useEffect(() => {
    setErrorMsg(null);
    setNeedsEmailProviderEnable(false);
  }, [mode]);

  const mapAuthError = (err: unknown): { message: string; showProviderHelp: boolean } => {
    const code = (err as { code?: string })?.code || '';
    const rawMsg = err instanceof Error ? err.message : String(err);

    if (
      code === 'auth/operation-not-allowed' ||
      rawMsg.includes('OPERATION_NOT_ALLOWED') ||
      rawMsg.includes('operation-not-allowed')
    ) {
      return {
        message:
          'Email & Password sign-in needs to be toggled ON once in Firebase Console, OR use "Continue with Google" below to sign in right now.',
        showProviderHelp: true,
      };
    }
    if (code === 'auth/email-already-in-use') {
      return {
        message: 'That email already has an account. Switch to "Sign In" to log in.',
        showProviderHelp: false,
      };
    }
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found'
    ) {
      return {
        message: 'Email or password did not match. Double-check your login details and try again.',
        showProviderHelp: false,
      };
    }
    if (code === 'auth/weak-password') {
      return {
        message: 'Password must be at least 6 characters long.',
        showProviderHelp: false,
      };
    }
    if (code === 'auth/invalid-email') {
      return {
        message: 'Please enter a valid email address.',
        showProviderHelp: false,
      };
    }
    if (code === 'auth/popup-closed-by-user') {
      return {
        message: 'Google sign-in window was closed before finishing.',
        showProviderHelp: false,
      };
    }
    if (code === 'auth/too-many-requests') {
      return {
        message: 'Too many login attempts. Wait a minute and try again.',
        showProviderHelp: false,
      };
    }
    return {
      message: rawMsg || 'Could not complete sign in. Please try again.',
      showProviderHelp: false,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNeedsEmailProviderEnable(false);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }

    if (mode === 'CREATE_ACCOUNT') {
      const cleanName = fullName.trim();
      if (cleanName.length < 2) {
        setErrorMsg('Please enter your full name (this shows up on your landowner texts).');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }
    } else if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await configureAuthPersistence(rememberLogin);

      if (mode === 'CREATE_ACCOUNT') {
        const cleanName = fullName.trim();
        const cleanPhone = phone.trim();
        setPendingSignupOverrides(cleanEmail, {
          displayName: cleanName,
          phone: cleanPhone || undefined,
        });
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await updateProfile(cred.user, { displayName: cleanName });

        if (rememberLogin) {
          writeSavedLoginHint({
            email: cleanEmail,
            displayName: cleanName,
            phone: cleanPhone || undefined,
            remember: true,
          });
        } else {
          writeSavedLoginHint(null);
        }

        let profile: HunterProfile;
        try {
          profile = await loadOrSyncUserProfile(cred.user, {
            displayName: cleanName,
            phone: cleanPhone,
          });
        } catch {
          profile = {
            uid: cred.user.uid,
            displayName: cleanName,
            email: cleanEmail,
            phone: cleanPhone || undefined,
            role: 'hunter',
          };
        }
        onAuthenticated(cred.user, profile);
      } else {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        const resolvedName = cred.user.displayName || savedHint?.displayName || '';
        if (rememberLogin) {
          writeSavedLoginHint({
            email: cleanEmail,
            displayName: resolvedName || undefined,
            remember: true,
          });
        } else {
          writeSavedLoginHint(null);
        }

        let profile: HunterProfile;
        try {
          profile = await loadOrSyncUserProfile(cred.user);
        } catch {
          profile = {
            uid: cred.user.uid,
            displayName: resolvedName || cleanEmail.split('@')[0],
            email: cleanEmail,
            role: 'hunter',
          };
        }
        onAuthenticated(cred.user, profile);
      }
    } catch (err) {
      const mapped = mapAuthError(err);
      setErrorMsg(mapped.message);
      setNeedsEmailProviderEnable(mapped.showProviderHelp);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setNeedsEmailProviderEnable(false);
    setIsGoogleLoading(true);
    try {
      await configureAuthPersistence(rememberLogin);
      const cred = await signInWithPopup(auth, googleProvider);
      if (rememberLogin && cred.user.email) {
        writeSavedLoginHint({
          email: cred.user.email,
          displayName: cred.user.displayName || undefined,
          remember: true,
        });
      }
      let profile: HunterProfile;
      try {
        profile = await loadOrSyncUserProfile(cred.user);
      } catch {
        profile = {
          uid: cred.user.uid,
          displayName: cred.user.displayName || cred.user.email?.split('@')[0] || 'Kansas Hunter',
          email: cred.user.email || '',
          role: 'hunter',
        };
      }
      onAuthenticated(cred.user, profile);
    } catch (err) {
      const mapped = mapAuthError(err);
      setErrorMsg(mapped.message);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const previewHunterName =
    (mode === 'CREATE_ACCOUNT' ? fullName.trim() : savedHint?.displayName?.trim()) || 'Your Name';

  const firebaseProvidersUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;

  return (
    <div className="h-dvh w-screen bg-[#0c0f0a] text-[#f4f1ea] overflow-y-auto touch-scroll-y p-4 flex flex-col">
      <div className="w-full max-w-md space-y-4 mx-auto my-auto py-4">
        {/* Camo Brand Card Header */}
        <div className="camo-header border border-[#34422c] rounded-3xl p-5 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#ea580c] text-white flex items-center justify-center shadow-lg shrink-0">
              <Crosshair className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#84cc16] font-bold">
                SectionLine KS · Kansas Tactical GIS
              </div>
              <h1 className="font-display text-2xl font-bold text-[#f4f1ea] leading-tight">
                CREW HUNTER LOGIN
              </h1>
            </div>
          </div>
          <p className="text-xs text-[#b7ad96] mt-3 leading-relaxed">
            Create your own hunter account or sign in. Whichever crew member is logged in gets their{' '}
            <strong className="text-[#f4f1ea]">own name</strong> automatically put into landowner permission texts, letters, notes, and slips.
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-[#131810] border border-[#2d3826] rounded-3xl p-5 shadow-2xl space-y-4">
          {/* Segmented Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[#0c0f0a] border border-[#283421]">
            <button
              type="button"
              onClick={() => setMode('SIGN_IN')}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                mode === 'SIGN_IN'
                  ? 'bg-[#ea580c] text-white shadow'
                  : 'text-[#b7ad96] hover:text-[#f4f1ea]'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('CREATE_ACCOUNT')}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                mode === 'CREATE_ACCOUNT'
                  ? 'bg-[#3f7d20] text-white shadow'
                  : 'text-[#b7ad96] hover:text-[#f4f1ea]'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-[#29170f] border border-[#ea580c]/70 text-xs text-[#ffedd5] space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#f97316] shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              {needsEmailProviderEnable && (
                <div className="pl-6 space-y-1.5 text-[11px] text-[#d6cebc]">
                  <div>To turn on Email &amp; Password accounts:</div>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Open Firebase Sign-in Providers</li>
                    <li>Click <strong>Add new provider → Email/Password</strong></li>
                    <li>Enable it and click <strong>Save</strong></li>
                  </ol>
                  <a
                    href={firebaseProvidersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-[#f97316] underline"
                  >
                    <span>Open Firebase Providers Console</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="on" className="space-y-3">
            {mode === 'CREATE_ACCOUNT' && (
              <>
                <div className="space-y-1">
                  <label
                    htmlFor="hunter-fullname"
                    className="text-[11px] font-mono uppercase tracking-wider text-[#b7ad96] block"
                  >
                    Your Full Name (Used in Permission Texts)
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-[#84cc16] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="hunter-fullname"
                      name="name"
                      type="text"
                      required
                      maxLength={80}
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full rounded-xl bg-[#0c0f0a] border border-[#34422c] pl-10 pr-3.5 py-2.5 text-sm text-[#f4f1ea] placeholder-[#68755d] focus:outline-none focus:border-[#ea580c]"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="hunter-phone"
                    className="text-[11px] font-mono uppercase tracking-wider text-[#b7ad96] block"
                  >
                    Callback Phone (Optional — for Letters)
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#c29b6c] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="hunter-phone"
                      name="tel"
                      type="tel"
                      maxLength={32}
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(316) 555-0142"
                      className="w-full rounded-xl bg-[#0c0f0a] border border-[#34422c] pl-10 pr-3.5 py-2.5 text-sm font-mono text-[#f4f1ea] placeholder-[#68755d] focus:outline-none focus:border-[#ea580c]"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1">
              <label
                htmlFor="hunter-email"
                className="text-[11px] font-mono uppercase tracking-wider text-[#b7ad96] block"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#f97316] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="hunter-email"
                  name="email"
                  type="email"
                  required
                  maxLength={160}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="hunter@example.com"
                  className="w-full rounded-xl bg-[#0c0f0a] border border-[#34422c] pl-10 pr-3.5 py-2.5 text-sm text-[#f4f1ea] placeholder-[#68755d] focus:outline-none focus:border-[#ea580c]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="hunter-password"
                className="text-[11px] font-mono uppercase tracking-wider text-[#b7ad96] block"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#c29b6c] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="hunter-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={mode === 'CREATE_ACCOUNT' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'CREATE_ACCOUNT' ? 'At least 6 characters' : 'Enter your password'}
                  className="w-full rounded-xl bg-[#0c0f0a] border border-[#34422c] pl-10 pr-10 py-2.5 text-sm text-[#f4f1ea] placeholder-[#68755d] focus:outline-none focus:border-[#ea580c]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9c927d] hover:text-[#f4f1ea]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'CREATE_ACCOUNT' && (
              <div className="space-y-1">
                <label
                  htmlFor="hunter-confirm-password"
                  className="text-[11px] font-mono uppercase tracking-wider text-[#b7ad96] block"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#c29b6c] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="hunter-confirm-password"
                    name="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full rounded-xl bg-[#0c0f0a] border border-[#34422c] pl-10 pr-3.5 py-2.5 text-sm text-[#f4f1ea] placeholder-[#68755d] focus:outline-none focus:border-[#ea580c]"
                  />
                </div>
              </div>
            )}

            {/* Save Login Info Toggle */}
            <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#0f140c] border border-[#283421] cursor-pointer">
              <div className="flex items-center gap-2 text-xs text-[#d6cebc]">
                <BookmarkCheck className="w-4 h-4 text-[#84cc16] shrink-0" />
                <span>Save my login info &amp; stay signed in</span>
              </div>
              <input
                type="checkbox"
                checked={rememberLogin}
                onChange={(e) => setRememberLogin(e.target.checked)}
                className="w-4 h-4 accent-[#ea580c] rounded"
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting || isGoogleLoading}
              className={`w-full py-3 px-4 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 shadow-lg transition-colors disabled:opacity-60 ${
                mode === 'CREATE_ACCOUNT'
                  ? 'bg-[#3f7d20] hover:bg-[#4d9328]'
                  : 'bg-[#ea580c] hover:bg-[#f97316]'
              }`}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'CREATE_ACCOUNT' ? (
                <UserPlus className="w-4 h-4" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              <span>
                {isSubmitting
                  ? mode === 'CREATE_ACCOUNT'
                    ? 'Creating Hunter Account...'
                    : 'Signing In...'
                  : mode === 'CREATE_ACCOUNT'
                    ? 'Create Account & Save Login'
                    : 'Sign In to SectionLine KS'}
              </span>
            </button>
          </form>

          {/* Divider + One-Tap Google Login */}
          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-[#283421]" />
            <span className="shrink mx-3 text-[10px] font-mono uppercase tracking-wider text-[#7a876f]">
              Or Instant Sign In
            </span>
            <div className="flex-grow border-t border-[#283421]" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isSubmitting || isGoogleLoading}
            className="w-full py-2.5 px-4 rounded-xl bg-[#1b2416] hover:bg-[#24301d] border border-[#3a4931] text-[#f4f1ea] font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {isGoogleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#f97316]" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-[#84cc16]" />
            )}
            <span>{isGoogleLoading ? 'Connecting Google Account...' : 'Continue with Google'}</span>
          </button>

          {/* Live SMS Text Preview showing dynamic hunter name */}
          <div className="p-3 rounded-2xl bg-[#0d120a] border border-[#283421] space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#84cc16]">
              <MessageSquare className="w-3 h-3 text-[#f97316]" />
              <span>Permission Text Preview</span>
            </div>
            <p className="text-[11px] text-[#b7ad96] leading-relaxed">
              &ldquo;Hello Robert, my name is{' '}
              <strong className="text-[#f4f1ea]">{previewHunterName}</strong>, a respectful local Kansas bowhunter...&rdquo;
            </p>
          </div>

          <PWAInstallButton />
        </div>
      </div>
    </div>
  );
};
