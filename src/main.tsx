import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    registerSW({
      immediate: true,
      onOfflineReady() {
        console.info('[SectionLine KS] Offline Field Mode ready.');
      },
    });
  } else {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          const urls = [
            registration.active?.scriptURL,
            registration.installing?.scriptURL,
            registration.waiting?.scriptURL,
          ].filter(Boolean) as string[];
          if (urls.some((u) => u.includes('dev-sw') || u.includes('/sw.js'))) {
            registration.unregister().catch(() => {});
          }
        }
      })
      .catch(() => {});
  }
}

// Tier 1 Google Maps Platform Demo Key quota, auth & billing listener
const triggerBillingFallback = () => {
  (window as any).__GMP_BILLING_ERROR__ = true;
  window.dispatchEvent(new CustomEvent('gmp-auth-billing-error'));
};

const triggerQuotaBanner = () => {
  (window as any).__GMP_QUOTA_EXCEEDED__ = true;
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

(window as any).gm_authFailure = () => {
  triggerBillingFallback();
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  const isBillingOrAuthErr =
    msg.includes('BillingNotEnabledMapError') ||
    msg.includes('enable Billing on the Google Cloud Project') ||
    msg.includes('InvalidKeyMapError') ||
    msg.includes('ApiNotActivatedMapError') ||
    msg.includes('RefererNotAllowedMapError') ||
    msg.includes('Google Maps JavaScript API error');

  const isQuotaErr =
    msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError');

  if (isQuotaErr) {
    triggerQuotaBanner();
    triggerBillingFallback();
    console.warn('[SectionLine KS] Google Maps quota reached — switched to Esri Satellite + Regrid KS parcel map.');
    return;
  }

  if (isBillingOrAuthErr) {
    triggerBillingFallback();
    console.warn('[SectionLine KS] Google Maps billing not enabled on linked Cloud project — switched to Esri Satellite + Regrid KS parcel map.');
    return;
  }

  origConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
