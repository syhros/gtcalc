import { useSyncExternalStore } from 'react';

/**
 * The visitor's choice on the cookie banner. Flows, settings and sign-in always live in the
 * browser (the app needs them); "accepted" also turns on anonymous, cookieless visit stats
 * (Vercel Web Analytics and Speed Insights). null: not asked yet, so the banner shows.
 */
export type Consent = 'accepted' | 'rejected' | null;

const KEY = 'gt_calc_consent';
const listeners = new Set<() => void>();
let current: Consent = (() => {
  try { const v = localStorage.getItem(KEY); return v === 'accepted' || v === 'rejected' ? v : null; } catch { return null; }
})();

export function getConsent(): Consent { return current; }
/** Save a choice, or pass null to ask again (Cookie settings in the Guide). */
export function setConsent(value: Consent) {
  current = value;
  try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export const useConsent = () => useSyncExternalStore(subscribe, getConsent, () => null);
