import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, type Firestore } from 'firebase/firestore';

/**
 * Firebase connection, configured from VITE_FIREBASE_* environment variables (set in Vercel and
 * in .env.local for development). These values identify the project; they aren't secrets.
 * Access is controlled by firestore.rules. Without them the community features stay off.
 */
// On our own domain the sign-in pages are served from /__/auth on the site itself (vercel.json
// proxies them to Firebase), so Google's screen names gtcalc.app instead of firebaseapp.com.
// List a host in VITE_SITE_AUTH_HOSTS only once the OAuth client allows https://<host>/__/auth/handler.
const siteAuthHosts = String(import.meta.env.VITE_SITE_AUTH_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: typeof location !== 'undefined' && siteAuthHosts.includes(location.hostname)
    ? location.hostname
    : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

export const firebaseEnabled = !!(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseEnabled) {
  app = getApps().length ? getApp() : initializeApp(config as Record<string, string>);
  auth = getAuth(app);
  // Cache documents in the browser so builds and comments load instantly on repeat visits.
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
  } catch {
    db = getFirestore(app); // already set up (development hot reload)
  }
}

let appCheckStarted = false;
/**
 * App Check (optional): proves requests come from this site, not a script. Turned on by setting
 * VITE_RECAPTCHA_SITE_KEY; enforce it in the Firebase console once it's live. It loads Google
 * reCAPTCHA, so it starts on the first call that talks to Firebase (signing in, Community,
 * sharing, a signed-in visitor's sync), never on a visit that only uses the calculator.
 */
export function startAppCheck() {
  if (appCheckStarted || !app) return;
  appCheckStarted = true;
  const recaptcha = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
  // Not on localhost: the reCAPTCHA key is registered for the live site (use an App Check debug
  // token for local development once enforcement is on).
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  if (recaptcha && !local) initializeAppCheck(app, { provider: new ReCaptchaV3Provider(recaptcha), isTokenAutoRefreshEnabled: true });
}

/** Auth and the database, for a call about to reach Firebase (so App Check starts first). */
export function fb() {
  if (!auth || !db) throw new Error('The community server is not configured');
  startAppCheck();
  return { auth, db };
}

/** The same, without starting App Check: for listeners that send nothing until someone signs in. */
export function fbIdle() {
  if (!auth || !db) throw new Error('The community server is not configured');
  return { auth, db };
}
