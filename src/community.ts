import {
  EmailAuthProvider, GoogleAuthProvider, createUserWithEmailAndPassword, deleteUser, signInWithPopup, onAuthStateChanged, reauthenticateWithCredential, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updatePassword, verifyBeforeUpdateEmail, type User as FirebaseUser,
} from 'firebase/auth';
import {
  arrayRemove, arrayUnion, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, increment, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, deleteField, where, writeBatch, type Timestamp,
} from 'firebase/firestore';
import type { CanvasNode, Connection } from './types';
import { fb, fbIdle, firebaseEnabled, startAppCheck } from './firebase';
import { cleanFlow } from './flowShape';
import { REVIEW_SCORE, assertClean, assertCleanText, assertCleanUsername, textScore, usernameScore } from './moderation';

/**
 * Accounts, community builds, upvotes, favourites and comments, on Firebase (Auth + Firestore).
 *
 * Accounts are a username and password, with an optional email for password resets. Firebase
 * Auth signs in with an email, so an account without one gets a hidden address
 * (<username>@users.greg-calc.app) the user never sees. No IP addresses are stored.
 *
 * Firestore layout (rules in firestore.rules):
 *   usernames/{lowercase}       { uid, username, hasEmail, loginAs? } one per name, so names are unique
 *   users/{uid}                 { username, createdAt } public profile
 *   renameFlags/{uid}           { by, at } a moderator asked for a new username (private)
 *   mods/{uid}                  {}                             moderators (added with the admin login)
 *   reviews/{uid}               { username, decision, ... }    moderators' username decisions
 *   bannedNames/{lowercase}     { username, by, at }           names moderators denied (mods only)
 *   reports/{buildId}_{uid}     { buildId, reason, info, ... } reports on shared flows (mods read)
 *   flowReviews/{buildId}       { name, description, ... }     flows a moderator has checked
 *   users/{uid}/flows/{id}      { name, savedAt, draft, json } the user's saved flows (private)
 *   builds/{id}                 shared builds (flow stored as JSON text)
 *   builds/{id}/files/schematic { name, dataUrl }              optional schematic
 *   builds/{id}/comments/{id}   comments with up/down voter lists
 *   limits/{uid}                { lastComment, lastBuild }     rate limits, checked by the rules
 */

// Minimum gaps the rules enforce (keep in step with firestore.rules).
export const COMMENT_GAP_S = 15;
export const BUILD_GAP_S = 60;

export const communityEnabled = firebaseEnabled;
export const HIDDEN_EMAIL_DOMAIN = 'users.greg-calc.app';
export const USERNAME_RULE = /^[A-Za-z0-9_-]{3,20}$/;

export interface User {
  uid: string;
  username: string;
  createdAt: number;
  email: string | null;
  google?: boolean; // signed in with Google
  needsUsername?: boolean; // signed in with Google for the first time: must pick a username
  needsRename?: boolean; // a moderator flagged the username: must pick a new one
  mod?: boolean; // can review usernames
}

export interface BuildStats {
  machines: number;
  topTier: string;
  lowTier: string;
  eutUse: number; // EU/t the machines draw (average at the planned rate)
  eutGen: number; // EU/t generators make
  output?: { id: string; name: string; perSec?: number; unit?: 'mB' | 'item' };
}

/** Categories a shared flow can carry (one each). Keep in step with firestore.rules. */
export const FLOW_TAGS = [
  ['power', 'Power'],
  ['fuel', 'Oil & fuel'],
  ['chemicals', 'Chemicals'],
  ['metals', 'Ores & metals'],
  ['early', 'Early game'],
] as const;
export type FlowTag = (typeof FLOW_TAGS)[number][0];
export const tagLabel = (t?: string) => FLOW_TAGS.find(([k]) => k === t)?.[1];

export interface BuildFlow { nodes: CanvasNode[]; connections: Connection[]; targetEUtBudget: number }

export interface Build {
  id: string;
  name: string;
  description: string;
  author: string;
  authorId: string;
  pack: string;
  createdAt: number;
  flow: BuildFlow;
  stats: BuildStats;
  schematicName?: string;
  sourceFlowId?: string; // the saved flow it was shared from (one share per flow)
  upvoters: string[];
  forkers?: string[]; // people who made their own copy (each once) // uids
  favoriters: string[]; // uids
  commentCount: number;
  example?: boolean; // one of gtcalc's own examples (seeded with scripts/seed-examples.mts)
  tag?: FlowTag; // one optional category, chosen when sharing
}

export interface BuildComment {
  id: string;
  author: string;
  authorId: string;
  text: string;
  createdAt: number;
  up: string[]; // uids
  down: string[];
  parentId?: string; // a reply to this comment (one level of replies)
}

const millis = (t: unknown) => ((t as Timestamp | null)?.toMillis?.() ?? (typeof t === 'number' ? t : Date.now()));
const loginEmail = (username: string) => `${username.toLowerCase()}@${HIDDEN_EMAIL_DOMAIN}`;
const isHidden = (email: string | null | undefined) => !!email && email.endsWith(`@${HIDDEN_EMAIL_DOMAIN}`);

/** Firebase's error codes, in words. */
function friendly(e: unknown): Error {
  const code = (e as { code?: string }).code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Wrong username or password (if you added an email, log in with that)',
    'auth/wrong-password': 'Wrong username or password',
    'auth/user-not-found': 'Wrong username or password',
    'auth/invalid-email': 'That email address looks wrong',
    'auth/email-already-in-use': 'That email is already used by another account',
    'auth/weak-password': 'Password: at least 6 characters',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again',
    'auth/requires-recent-login': 'Log in again first, then retry',
    'auth/network-request-failed': 'No connection to the server',
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished',
    'auth/popup-blocked': 'The browser blocked the Google sign-in window. Allow pop-ups for this site',
    'auth/account-exists-with-different-credential': 'That email already has an account: log in with its password',
    'permission-denied': 'Not allowed',
  };
  return new Error(map[code] ?? (e as Error).message ?? 'Something went wrong');
}

// ---------------------------------------------------------------- accounts
let user: User | null = null;
const userListeners = new Set<(u: User | null) => void>();
export function currentUser() { return user; }
export function onUserChange(fn: (u: User | null) => void) {
  userListeners.add(fn);
  fn(user);
  return () => { userListeners.delete(fn); };
}
const setUser = (u: User | null) => { user = u; userListeners.forEach((fn) => fn(u)); };

if (firebaseEnabled) {
  const { auth, db } = fbIdle(); // a visitor who never signs in never loads App Check
  onAuthStateChanged(auth, async (fu) => {
    if (!fu) { setUser(null); return; }
    startAppCheck(); // signed in: profile, sync and shared builds are about to load
    // Right after sign-up the profile may not be written yet: wait for it briefly.
    let data: Record<string, unknown> | undefined;
    const viaGoogle = fu.providerData.some((p) => p.providerId === 'google.com');
    for (let tries = 0; tries < (viaGoogle ? 1 : 5) && !data; tries++) {
      data = (await getDoc(doc(db, 'users', fu.uid)).catch(() => null))?.data();
      if (!data) await new Promise((r) => setTimeout(r, 600));
    }
    const mod = data ? (await getDoc(doc(db, 'mods', fu.uid)).catch(() => null))?.exists() : false;
    const mustRename = data ? (await getDoc(doc(db, 'renameFlags', fu.uid)).catch(() => null))?.exists() : false;
    if (auth.currentUser?.uid !== fu.uid) return; // logged out meanwhile
    // Signed in with a confirmed real address (not the hidden one): username login now needs it.
    if (data?.username && fu.email && !isHidden(fu.email) && !viaGoogle) {
      updateDoc(doc(db, 'usernames', String(data.username).toLowerCase()), { hasEmail: true }).catch(() => {});
    }
    setUser({
      uid: fu.uid,
      // A new Google account has no username until it picks one (never its Google name or email).
      username: (data?.username as string) ?? (viaGoogle ? 'New player' : fu.email?.split('@')[0] ?? 'player'),
      createdAt: data?.createdAt ? millis(data.createdAt) : Date.parse(fu.metadata.creationTime ?? '') || Date.now(),
      email: isHidden(fu.email) ? null : fu.email,
      ...(viaGoogle ? { google: true } : {}),
      ...(!data ? { needsUsername: true } : {}),
      ...(mustRename ? { needsRename: true } : {}),
      ...(mod ? { mod: true } : {}),
    });
  });
}

// The rules refuse taken names and names a moderator denied alike; users can't tell which.
const TAKEN = 'That username is taken or not allowed';

export async function register(username: string, password: string, email?: string): Promise<void> {
  const name = username.trim();
  if (!USERNAME_RULE.test(name)) throw new Error('Username: 3 to 20 letters, numbers, - or _');
  await checkUsername(name);
  if (password.length < 6) throw new Error('Password: at least 6 characters');
  const { auth, db } = fb();
  const lower = name.toLowerCase();
  if ((await getDoc(doc(db, 'usernames', lower))).exists()) throw new Error('That username is taken');
  const realEmail = email?.trim() || null;
  try {
    const cred = await createUserWithEmailAndPassword(auth, realEmail ?? loginEmail(name), password);
    // Claim the name and create the profile together; the rules reject a name that's taken.
    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', lower), { uid: cred.user.uid, username: name, hasEmail: !!realEmail });
    batch.set(doc(db, 'users', cred.user.uid), { username: name, createdAt: serverTimestamp() });
    try {
      await batch.commit();
    } catch {
      await cred.user.delete().catch(() => {}); // taken in the meantime, or denied by a moderator
      throw new Error(TAKEN);
    }
    setUser({ uid: cred.user.uid, username: name, createdAt: Date.now(), email: realEmail });
    if (realEmail) void sendVerification(cred.user);
  } catch (e) {
    throw e instanceof Error && e.message === TAKEN ? e : friendly(e);
  }
}

/** Log in with a username or an email address. */
export async function login(identifier: string, password: string): Promise<void> {
  const { auth, db } = fb();
  const id = identifier.trim();
  try {
    if (id.includes('@')) { await signInWithEmailAndPassword(auth, id, password); return; }
    const entry = (await getDoc(doc(db, 'usernames', id.toLowerCase()))).data();
    if (entry?.hasEmail) throw new Error('This account logs in with its email address or with Google');
    // A renamed account still signs in with the address made from its first username.
    await signInWithEmailAndPassword(auth, loginEmail(typeof entry?.loginAs === 'string' ? entry.loginAs : id), password);
  } catch (e) {
    throw e instanceof Error && !(e as { code?: string }).code ? e : friendly(e);
  }
}

export async function logout() { await signOut(fb().auth); }

/**
 * Delete the signed-in account and everything it made: shared flows (with their comments and
 * files), comments on other flows, votes and favourites, cloud-saved flows, the username and
 * the profile, then the login itself. Firebase only deletes a login signed in within the last
 * few minutes, so that is checked first and nothing is deleted halfway.
 */
export async function deleteAccount(): Promise<void> {
  const { auth, db } = fb();
  const me = auth.currentUser;
  if (!me || !user) throw new Error('Log in first');
  const signedIn = Date.parse(me.metadata.lastSignInTime ?? '') || 0;
  if (Date.now() - signedIn > 4 * 60_000) throw new Error('For safety, log out and log back in, then delete your account within 4 minutes.');
  const uid = me.uid;
  const del = (refs: { ref: Parameters<typeof deleteDoc>[0] }[]) => Promise.all(refs.map((d) => deleteDoc(d.ref)));
  // Shared flows, with their comments and schematic files
  for (const b of (await getDocs(query(collection(db, 'builds'), where('authorId', '==', uid)))).docs) {
    await del((await getDocs(collection(db, 'builds', b.id, 'comments'))).docs);
    await del((await getDocs(collection(db, 'builds', b.id, 'files'))).docs);
    await deleteDoc(b.ref);
  }
  await del((await getDocs(query(collection(db, 'fingerprints'), where('uid', '==', uid)))).docs);
  // Comments on other people's flows, then votes and favourites
  await del((await getDocs(query(collectionGroup(db, 'comments'), where('authorId', '==', uid)))).docs);
  for (const field of ['upvoters', 'favoriters'] as const) {
    for (const b of (await getDocs(query(collection(db, 'builds'), where(field, 'array-contains', uid)))).docs) await updateDoc(b.ref, { [field]: arrayRemove(uid) });
  }
  // Cloud-saved flows, then the username, profile and rate-limit record
  await del((await getDocs(collection(db, 'users', uid, 'flows'))).docs);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid));
  batch.delete(doc(db, 'usernames', user.username.toLowerCase()));
  batch.delete(doc(db, 'renameFlags', uid));
  await batch.commit();
  await deleteDoc(doc(db, 'limits', uid)).catch(() => {});
  try { await deleteUser(me); } catch (e) { throw friendly(e); }
}

/** Sign in with Google. A first-time Google user then picks a username (see claimUsername). */
export async function loginWithGoogle(): Promise<void> {
  let uid: string;
  try { uid = (await signInWithPopup(fb().auth, new GoogleAuthProvider())).user.uid; } catch (e) { throw friendly(e); }
  // Wait until the profile has been looked up, so callers can tell whether a username is needed.
  if (user?.uid === uid) return;
  await new Promise<void>((resolve) => {
    const stop = onUserChange((u) => { if (u?.uid === uid) { stop(); resolve(); } });
    setTimeout(() => { stop(); resolve(); }, 8000);
  });
}

/** Give a Google account its username (first sign-in only). */
export async function claimUsername(username: string): Promise<void> {
  const { auth, db } = fb();
  const fu = auth.currentUser;
  if (!fu) throw new Error('Log in first');
  const name = username.trim();
  if (!USERNAME_RULE.test(name)) throw new Error('Username: 3 to 20 letters, numbers, - or _');
  await checkUsername(name);
  const lower = name.toLowerCase();
  if ((await getDoc(doc(db, 'usernames', lower))).exists()) throw new Error('That username is taken');
  const batch = writeBatch(db);
  // Google accounts log in with Google, so they count as having an email for login purposes.
  batch.set(doc(db, 'usernames', lower), { uid: fu.uid, username: name, hasEmail: true });
  batch.set(doc(db, 'users', fu.uid), { username: name, createdAt: serverTimestamp() });
  try { await batch.commit(); } catch { throw new Error(TAKEN); }
  setUser({ uid: fu.uid, username: name, createdAt: Date.now(), email: fu.email, google: true });
}

/**
 * Pick a new username after a moderator flagged the old one: the old claim is released, the new
 * one claimed and the profile renamed in one batch, then shared builds and comments follow.
 */
export async function renameUsername(username: string): Promise<void> {
  const { db } = fb();
  const u = requireUser();
  const name = username.trim();
  if (!USERNAME_RULE.test(name)) throw new Error('Username: 3 to 20 letters, numbers, - or _');
  if (name.toLowerCase() === u.username.toLowerCase()) throw new Error('Pick a different username');
  await checkUsername(name);
  const lower = name.toLowerCase();
  if ((await getDoc(doc(db, 'usernames', lower))).exists()) throw new Error(TAKEN);
  const oldRef = doc(db, 'usernames', u.username.toLowerCase());
  const old = (await getDoc(oldRef)).data();
  const loginAs = typeof old?.loginAs === 'string' ? old.loginAs : u.username.toLowerCase();
  const batch = writeBatch(db);
  if (old?.uid === u.uid) batch.delete(oldRef);
  batch.set(doc(db, 'usernames', lower), { uid: u.uid, username: name, hasEmail: !!old?.hasEmail, ...(old?.hasEmail ? {} : { loginAs }) });
  batch.update(doc(db, 'users', u.uid), { username: name });
  batch.delete(doc(db, 'renameFlags', u.uid));
  try { await batch.commit(); } catch { throw new Error(TAKEN); }
  setUser({ ...u, username: name, needsRename: undefined });
  // The author name on everything they've shared (best effort: the rename itself is done).
  try {
    const [builds, comments] = await Promise.all([
      getDocs(query(collection(db, 'builds'), where('authorId', '==', u.uid))),
      getDocs(query(collectionGroup(db, 'comments'), where('authorId', '==', u.uid))),
    ]);
    const refs = [...builds.docs, ...comments.docs].map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const b = writeBatch(db);
      for (const r of refs.slice(i, i + 400)) b.update(r, { author: name });
      await b.commit();
    }
  } catch { /* old name stays on some posts; not worth failing the rename over */ }
}

// ---------------------------------------------------------------- moderation (mods only)
export interface NameEntry { uid: string; username: string; createdAt: number; flagged: boolean; score: number; reason: string | null }
export interface Review { uid: string; username: string; decision: 'allowed' | 'denied'; score: number; reason: string; by: string; at: number }

/**
 * Everything the moderation window shows: every account's username with its score, the
 * decisions made so far and the denied names. Scored here, in the moderator's browser, so a
 * name can't dodge review by skipping the site's own checks.
 */
export async function loadModeration(): Promise<{ names: NameEntry[]; reviews: Review[]; banned: { name: string; username: string; at: number }[] }> {
  const { db } = fb();
  const [users, reviews, banned, flags] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'reviews')),
    getDocs(collection(db, 'bannedNames')),
    getDocs(collection(db, 'renameFlags')),
  ]).catch((e) => { throw friendly(e); });
  const flagged = new Set(flags.docs.map((d) => d.id));
  return {
    names: users.docs.map((d) => {
      const x = d.data();
      const username = String(x.username ?? '');
      return { uid: d.id, username, createdAt: x.createdAt ? millis(x.createdAt) : 0, flagged: flagged.has(d.id), ...usernameScore(username) };
    }),
    reviews: reviews.docs.map((d) => {
      const x = d.data();
      return { uid: d.id, username: x.username, decision: x.decision, score: x.score, reason: x.reason, by: x.by, at: x.at ? millis(x.at) : 0 };
    }),
    banned: banned.docs.map((d) => ({ name: d.id, username: d.data().username, at: d.data().at ? millis(d.data().at) : 0 })),
  };
}

/** Allow a username: it stays, and drops off the review list (until the account renames). */
export async function allowUsername(n: NameEntry) {
  const { db } = fb();
  const u = requireUser();
  const batch = writeBatch(db);
  batch.set(doc(db, 'reviews', n.uid), { username: n.username, decision: 'allowed', score: n.score, reason: n.reason ?? '', by: u.uid, at: serverTimestamp() });
  // Changed their mind after denying: clear the flag and free the name again.
  if (n.flagged) batch.delete(doc(db, 'renameFlags', n.uid));
  if (n.flagged) batch.delete(doc(db, 'bannedNames', n.username.toLowerCase()));
  try { await batch.commit(); } catch (e) { throw friendly(e); }
}

/** Deny a username: nobody can take it again, and its owner must pick a new one at next login. */
export async function denyUsername(n: NameEntry) {
  const { db } = fb();
  const u = requireUser();
  const batch = writeBatch(db);
  batch.set(doc(db, 'reviews', n.uid), { username: n.username, decision: 'denied', score: n.score, reason: n.reason ?? '', by: u.uid, at: serverTimestamp() });
  batch.set(doc(db, 'bannedNames', n.username.toLowerCase()), { username: n.username, by: u.uid, at: serverTimestamp() });
  batch.set(doc(db, 'renameFlags', n.uid), { by: u.uid, at: serverTimestamp() });
  try { await batch.commit(); } catch (e) { throw friendly(e); }
}

/** Take a name off the denied list (it can be claimed again once its owner has renamed). */
export async function unbanName(name: string) {
  try { await deleteDoc(doc(fb().db, 'bannedNames', name)); } catch (e) { throw friendly(e); }
}

/**
 * Password reset: the site sends its own email (/api/account-email, our template from gtcalc.app).
 * If that isn't available (local dev, or the server is missing its keys), Firebase sends its own.
 */
export async function resetPassword(email: string) {
  if (await siteEmail({ kind: 'reset', email: email.trim() })) return;
  try { await sendPasswordResetEmail(fb().auth, email.trim()); } catch (e) { throw friendly(e); }
}

/**
 * Account emails come from the site (/api/account-email: our templates, links on gtcalc.app).
 * True when it sent one; false when it isn't available (local dev, missing keys), so the caller
 * has Firebase send its own. Throws the server's message for things like a bad address.
 */
async function siteEmail(body: Record<string, string>): Promise<boolean> {
  let j: { ok?: boolean; reason?: string } = {};
  try {
    const res = await fetch('/api/account-email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    j = await res.json();
  } catch { return false; }
  if (j.ok) return true;
  if (j.reason) throw new Error(j.reason);
  return false;
}

/** Confirm-your-email link for the signed-in account (after signing up with an email). */
async function sendVerification(fu: FirebaseUser) {
  try {
    if (await siteEmail({ kind: 'verify', idToken: await fu.getIdToken() })) return;
    await sendEmailVerification(fu);
  } catch { /* not worth failing sign-up over */ }
}

export async function changePassword(current: string, next: string) {
  const fu = fb().auth.currentUser;
  if (!fu?.email) throw new Error('Log in first');
  try {
    await reauthenticateWithCredential(fu, EmailAuthProvider.credential(fu.email, current));
    await updatePassword(fu, next);
  } catch (e) { throw friendly(e); }
}

/**
 * Add or change the email used for password resets. Firebase sends a link to confirm it; once
 * confirmed, that address is also how the account logs in.
 */
export async function setRecoveryEmail(current: string, email: string) {
  const { auth } = fb();
  const fu = auth.currentUser;
  if (!fu?.email || !user) throw new Error('Log in first');
  try {
    await reauthenticateWithCredential(fu, EmailAuthProvider.credential(fu.email, current));
    // hasEmail is set once they sign in with the confirmed address
    if (await siteEmail({ kind: 'change', idToken: await fu.getIdToken(true), newEmail: email.trim() })) return;
    await verifyBeforeUpdateEmail(fu, email.trim());
  } catch (e) { throw e instanceof Error && !(e as { code?: string }).code ? e : friendly(e); }
}

/**
 * Username check: our word lists score the name (usernameScore). From BLOCK_SCORE up it's
 * refused; from REVIEW_SCORE up to that it's "not sure", which APIVerve settles via the site's
 * /api/check-username when USE_APIVERVE is on (each check costs API credits). With it off, or if
 * the service can't be reached, "not sure" names are allowed. The database rules re-check the
 * core list either way.
 */
const USE_APIVERVE = false; // switched off for now: our own lists decide
async function checkUsername(name: string) {
  assertCleanUsername(name);
  if (!USE_APIVERVE || usernameScore(name).score < REVIEW_SCORE) return;
  try {
    const res = await fetch(`/api/check-username?u=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok && res.status !== 429) return;
    const body = (await res.json()) as { ok?: boolean; reason?: string };
    if (body.ok === false) throw new Error(body.reason ?? "That username isn't allowed");
  } catch (e) {
    // Network trouble, timeouts or no function (local dev serves the page instead): word list only.
    if (e instanceof Error && !/abort|timeout|timed out|fetch|json|network/i.test(e.message + e.name)) throw e;
  }
}

/** Seconds left before the rate limit allows the next comment / build (0 = go ahead). */
async function secondsUntil(uid: string, field: 'lastComment' | 'lastBuild', gap: number) {
  const last = (await getDoc(doc(fb().db, 'limits', uid)).catch(() => null))?.data()?.[field] as Timestamp | undefined;
  if (!last) return 0;
  return Math.max(0, Math.ceil(gap - (Date.now() - last.toMillis()) / 1000));
}

function requireUser() {
  if (!user) throw new Error('Log in first');
  return user;
}

// ---------------------------------------------------------------- builds
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** A flow from someone else's build, checked so a malformed one can't break the page. */
function safeFlow(raw: unknown): BuildFlow | null {
  let f: unknown = raw;
  if (typeof raw === 'string') { try { f = JSON.parse(raw); } catch { return null; } }
  const clean = cleanFlow(f);
  if (!clean) return null;
  const o = f as Partial<BuildFlow>;
  return { ...o, ...clean, targetEUtBudget: num(o.targetEUtBudget) || 100000 } as BuildFlow;
}
function safeStats(raw: unknown): BuildStats {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = (s.output && typeof s.output === 'object' ? s.output : null) as Record<string, unknown> | null;
  return {
    machines: num(s.machines), topTier: text(s.topTier, 8) || '—', lowTier: text(s.lowTier, 8) || '—', eutUse: num(s.eutUse), eutGen: num(s.eutGen),
    ...(out && typeof out.id === 'string' && typeof out.name === 'string'
      ? { output: { id: text(out.id), name: text(out.name), ...(typeof out.perSec === 'number' ? { perSec: out.perSec } : {}), ...(out.unit === 'mB' || out.unit === 'item' ? { unit: out.unit } : {}) } }
      : {}),
  };
}

const toBuild = (id: string, d: Record<string, unknown>): Build | null => {
  const flow = safeFlow(d.flowJson);
  if (!flow || typeof d.name !== 'string' || typeof d.authorId !== 'string') return null; // skip broken builds
  return {
    id,
    name: text(d.name, 64),
    description: text(d.description, 2000),
    author: text(d.author, 20),
    authorId: d.authorId,
    pack: text(d.pack, 40),
    createdAt: millis(d.createdAt),
    flow,
    stats: safeStats(d.stats),
    ...(typeof d.schematicName === 'string' ? { schematicName: text(d.schematicName, 100) } : {}),
    ...(typeof d.sourceFlowId === 'string' ? { sourceFlowId: text(d.sourceFlowId, 80) } : {}),
    upvoters: ids(d.upvoters),
    favoriters: ids(d.favoriters),
    forkers: ids(d.forkers),
    commentCount: num(d.commentCount),
    ...(d.example === true ? { example: true } : {}),
    ...(typeof d.tag === 'string' && tagLabel(d.tag) ? { tag: d.tag as FlowTag } : {}),
  };
};


/** Live list of a pack's builds (newest first). Returns the unsubscribe function. */
export function subscribeBuilds(pack: string, fn: (builds: Build[]) => void, onError?: (e: Error) => void) {
  const { db } = fb();
  return onSnapshot(
    query(collection(db, 'builds'), where('pack', '==', pack), orderBy('createdAt', 'desc')),
    (snap) => fn(snap.docs.map((x) => toBuild(x.id, x.data())).filter((b): b is Build => b != null)),
    (e) => onError?.(friendly(e)),
  );
}

const MAX_FLOW_JSON = 800_000; // Firestore documents top out at 1 MB
export const MAX_SCHEMATIC_BYTES = 700_000;

export { flowSignature } from './flowSignature';

/** Replace a shared flow with the author's current version (votes, comments and link stay). */
export async function updateSharedBuild(build: Build, flow: BuildFlow, stats: BuildStats) {
  const u = requireUser();
  if (build.authorId !== u.uid) throw new Error('Only the author can update this flow');
  const { db } = fb();
  const flowJson = JSON.stringify({ ...flow, origin: (build.flow as { origin?: unknown }).origin });
  if (flowJson.length > MAX_FLOW_JSON) throw new Error('This flow is too big to share (over 800 KB)');
  const fp = await fingerprint(JSON.stringify({ nodes: flow.nodes, connections: flow.connections }));
  const claim = (await getDoc(doc(db, 'fingerprints', fp))).data();
  if (claim && claim.buildId !== build.id) throw new Error('This exact flow is already on Community');
  const batch = writeBatch(db);
  // The rules check that the recorded fingerprint is claimed for this build in the same batch.
  batch.update(doc(db, 'builds', build.id), { flowJson, stats: JSON.parse(JSON.stringify(stats)), updatedAt: serverTimestamp(), fp });
  if (!claim) batch.set(doc(db, 'fingerprints', fp), { uid: u.uid, buildId: build.id });
  try { await batch.commit(); } catch (e) { throw friendly(e); }
}

/** Change a shared flow's name, description and tag (votes, comments, copies and the link stay). */
export async function updateBuildDetails(build: Build, details: { name: string; description: string; tag?: FlowTag }) {
  const u = requireUser();
  if (build.authorId !== u.uid) throw new Error('Only the author can change this flow');
  const name = details.name.trim().slice(0, 64);
  const description = details.description.trim().slice(0, 2000);
  if (!name) throw new Error('Give the flow a name');
  assertCleanText(name, 'name');
  assertCleanText(description, 'description');
  try {
    await updateDoc(doc(fb().db, 'builds', build.id), { name, description, tag: details.tag ?? deleteField() });
  } catch (e) { throw friendly(e); }
}

/** Short fingerprint of a flow: the same flow always gives the same build id. */
async function fingerprint(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function submitBuild(input: { name: string; description: string; pack: string; flow: BuildFlow; stats: BuildStats; schematic?: { name: string; dataUrl: string }; sourceFlowId?: string; tag?: FlowTag }): Promise<Build> {
  const u = requireUser();
  const { db } = fb();
  const flowJson = JSON.stringify(input.flow);
  if (flowJson.length > MAX_FLOW_JSON) throw new Error('This flow is too big to share (over 800 KB)');
  const wait = await secondsUntil(u.uid, 'lastBuild', BUILD_GAP_S);
  if (wait > 0) throw new Error(`You can share one build every ${BUILD_GAP_S} seconds. Try again in ${wait}s`);
  // Shared names and descriptions get the full word check (personal flow names aren't checked).
  assertCleanText(input.name, 'name');
  assertCleanText(input.description, 'description');
  if (input.schematic && !/^data:[\w.+-]*\/?[\w.+-]*;base64,/.test(input.schematic.dataUrl)) throw new Error('That schematic file could not be read');
  const data = {
    name: input.name.trim().slice(0, 64),
    description: input.description.trim().slice(0, 2000),
    author: u.username,
    authorId: u.uid,
    pack: input.pack,
    createdAt: serverTimestamp(),
    flowJson,
    stats: JSON.parse(JSON.stringify(input.stats)), // drops undefined fields Firestore rejects
    ...(input.schematic ? { schematicName: input.schematic.name } : {}),
    ...(input.sourceFlowId ? { sourceFlowId: input.sourceFlowId.slice(0, 80) } : {}),
    ...(input.tag ? { tag: input.tag } : {}),
    upvoters: [],
    favoriters: [],
    commentCount: 0,
  };
  try {
    // The build, its schematic and the rate-limit stamp go in one batch; the rules reject a
    // second build within BUILD_GAP_S seconds.
    // One build per user per flow: the id is the user plus a fingerprint of the flow, so sharing
    // the same flow again hits the existing build (the rules refuse to overwrite it).
    // The fingerprint is also claimed globally (fingerprints/{fp}), so nobody can share an exact
    // copy of a flow that's already on the Builds page.
    const fp = await fingerprint(JSON.stringify({ nodes: input.flow.nodes, connections: input.flow.connections }));
    const ref = doc(db, 'builds', `${u.uid}_${fp}`);
    const claim = (await getDoc(doc(db, 'fingerprints', fp))).data();
    if (claim) throw new Error(claim.uid === u.uid ? 'You\'ve already shared this flow. Change it before sharing it again' : 'This exact flow is already on the Builds page (shared by someone else)');
    const batch = writeBatch(db);
    batch.set(ref, data);
    batch.set(doc(db, 'fingerprints', fp), { uid: u.uid, buildId: ref.id });
    if (input.schematic) {
      const m = /^(.*)\.([A-Za-z]+)$/.exec(input.schematic.name);
      const name = m ? `${m[1].slice(0, 80)}.${m[2].toLowerCase()}` : input.schematic.name.slice(0, 100);
      batch.set(doc(db, 'builds', ref.id, 'files', 'schematic'), { name, dataUrl: input.schematic.dataUrl });
      data.schematicName = name;
      batch.set(ref, data);
    }
    batch.set(doc(db, 'limits', u.uid), { lastBuild: serverTimestamp(), lastBuildId: ref.id }, { merge: true });
    await batch.commit();
    return toBuild(ref.id, { ...data, createdAt: Date.now() })!;
  } catch (e) {
    if (e instanceof Error && !(e as { code?: string }).code) throw e;
    if ((e as { code?: string }).code === 'permission-denied') {
      const last = (await getDoc(doc(db, 'limits', u.uid)).catch(() => null))?.data()?.lastBuild as Timestamp | undefined;
      if (last && Date.now() - last.toMillis() < BUILD_GAP_S * 1000) throw new Error(`You can share one build every ${BUILD_GAP_S} seconds. Try again shortly`);
      throw new Error('The server refused this build. Check the name, description and schematic, then try again');
    }
    throw friendly(e);
  }
}

export async function deleteBuild(buildId: string) {
  const { db } = fb();
  try {
    // Comments and the schematic go first (the rules only let the author remove them).
    const comments = await getDocs(collection(db, 'builds', buildId, 'comments'));
    for (let i = 0; i < comments.docs.length; i += 400) {
      const batch = writeBatch(db);
      comments.docs.slice(i, i + 400).forEach((c) => batch.delete(c.ref));
      await batch.commit().catch(() => {});
    }
    await deleteDoc(doc(db, 'builds', buildId, 'files', 'schematic')).catch(() => {});
    await deleteDoc(doc(db, 'builds', buildId));
    const fp = buildId.split('_')[1];
    if (fp) await deleteDoc(doc(db, 'fingerprints', fp)).catch(() => {}); // frees the flow to be shared again
    // Claims from later updates of this build, too.
    const claims = await getDocs(query(collection(db, 'fingerprints'), where('buildId', '==', buildId))).catch(() => null);
    for (const c of claims?.docs ?? []) await deleteDoc(c.ref).catch(() => {});
    // Moderators also clear its reports and review (authors can't read those, so this fails quietly for them).
    const reports = await getDocs(query(collection(db, 'reports'), where('buildId', '==', buildId))).catch(() => null);
    for (const r of reports?.docs ?? []) await deleteDoc(r.ref).catch(() => {});
    await deleteDoc(doc(db, 'flowReviews', buildId)).catch(() => {});
  } catch (e) { throw friendly(e); }
}

// ---------------------------------------------------------------- reports and flow moderation
/** The link that opens a shared flow straight to its page on Community (?flow=<id>). */
export const flowLink = (id: string) => `${location.origin}/?flow=${encodeURIComponent(id)}`;

export const REPORT_REASONS = [
  ['offensive', 'Offensive name, description or comments'],
  ['spam', 'Spam or junk'],
  ['copied', "Copied from someone else's flow"],
  ['broken', "Broken or misleading (doesn't work as described)"],
  ['other', 'Something else'],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];

/** Count a copy made with Create copy (once per person; authors copying their own flow don't count). */
export async function recordCopy(build: Build) {
  const u = user;
  if (!u || build.authorId === u.uid || build.forkers?.includes(u.uid)) return;
  try { await updateDoc(doc(fb().db, 'builds', build.id), { forkers: arrayUnion(u.uid) }); } catch { /* counting is best effort */ }
}

/** Report a shared flow to the moderators (reporting it again replaces your earlier report). */
export async function reportBuild(build: Build, reason: ReportReason, info: string) {
  const u = requireUser();
  const { db } = fb();
  try {
    await setDoc(doc(db, 'reports', `${build.id}_${u.uid}`), {
      buildId: build.id, buildName: build.name.slice(0, 64) || 'Untitled', reason, info: info.trim().slice(0, 500), by: u.uid, at: serverTimestamp(),
    });
  } catch (e) { throw friendly(e); }
}

/** Report a comment to the moderators (reporting it again replaces your earlier report). */
export async function reportComment(build: Build, comment: BuildComment, reason: ReportReason, info: string) {
  const u = requireUser();
  try {
    await setDoc(doc(fb().db, 'commentReports', `${build.id}_${comment.id}_${u.uid}`), {
      buildId: build.id, commentId: comment.id, buildName: build.name.slice(0, 64) || 'Untitled', commentText: comment.text.slice(0, 1000),
      commentAuthor: comment.author.slice(0, 20), reason, info: info.trim().slice(0, 500), by: u.uid, at: serverTimestamp(),
    });
  } catch (e) { throw friendly(e); }
}

export interface CommentReport { id: string; buildId: string; commentId: string; buildName: string; commentText: string; commentAuthor: string; reason: ReportReason; info: string; at: number }

/** All comment reports (moderators). */
export async function loadCommentReports(): Promise<CommentReport[]> {
  const snap = await getDocs(collection(fb().db, 'commentReports')).catch((e) => { throw friendly(e); });
  return snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, buildId: x.buildId, commentId: x.commentId, buildName: x.buildName, commentText: x.commentText, commentAuthor: x.commentAuthor, reason: x.reason, info: x.info ?? '', at: x.at ? millis(x.at) : 0 };
  });
}

/** A moderator removes a reported comment (and the reports on it). */
export async function removeComment(buildId: string, commentId: string, reportIds: string[]) {
  const { db } = fb();
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'builds', buildId, 'comments', commentId));
    for (const id of reportIds) batch.delete(doc(db, 'commentReports', id));
    await batch.commit();
  } catch (e) { throw friendly(e); }
}

/** Clear reports on a comment without removing it. */
export async function dismissCommentReports(reportIds: string[]) {
  const { db } = fb();
  try {
    const batch = writeBatch(db);
    for (const id of reportIds) batch.delete(doc(db, 'commentReports', id));
    await batch.commit();
  } catch (e) { throw friendly(e); }
}

export interface FlowReport { id: string; buildId: string; buildName: string; reason: ReportReason; info: string; by: string; at: number }
export interface FlowEntry { id: string; name: string; description: string; author: string; authorId: string; createdAt: number; score: number; reason: string | null; reviewed: boolean }

/**
 * The moderation window's flow side: every shared flow scored on its name and description
 * (in the moderator's browser), whether a moderator has passed it as it is now, and all reports.
 */
export async function loadFlowModeration(): Promise<{ flows: FlowEntry[]; reports: FlowReport[] }> {
  const { db } = fb();
  const [builds, reviews, reports] = await Promise.all([
    getDocs(collection(db, 'builds')),
    getDocs(collection(db, 'flowReviews')),
    getDocs(collection(db, 'reports')),
  ]).catch((e) => { throw friendly(e); });
  const passed = new Map(reviews.docs.map((d) => [d.id, d.data()]));
  return {
    flows: builds.docs.map((d) => {
      const x = d.data();
      const name = String(x.name ?? ''), description = String(x.description ?? '');
      const a = textScore(name), b = textScore(description);
      const worst = b.score > a.score ? { score: b.score, reason: b.reason && `description: ${b.reason}` } : { score: a.score, reason: a.reason && `name: ${a.reason}` };
      const r = passed.get(d.id);
      return { id: d.id, name, description, author: String(x.author ?? ''), authorId: String(x.authorId ?? ''), createdAt: x.createdAt ? millis(x.createdAt) : 0, ...worst, reviewed: !!r && r.name === name && r.description === description };
    }),
    reports: reports.docs.map((d) => {
      const x = d.data();
      return { id: d.id, buildId: x.buildId, buildName: x.buildName, reason: x.reason, info: x.info ?? '', by: x.by, at: x.at ? millis(x.at) : 0 };
    }),
  };
}

/** A moderator passes a flow as it is now; it drops off the review list until its text changes. */
export async function allowFlow(f: FlowEntry) {
  try {
    await setDoc(doc(fb().db, 'flowReviews', f.id), { name: f.name, description: f.description, decision: 'allowed', by: requireUser().uid, at: serverTimestamp() });
  } catch (e) { throw friendly(e); }
}

/** Clear a flow's reports without removing it. */
export async function dismissReports(reportIds: string[]) {
  const { db } = fb();
  try {
    for (let i = 0; i < reportIds.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of reportIds.slice(i, i + 400)) batch.delete(doc(db, 'reports', id));
      await batch.commit();
    }
  } catch (e) { throw friendly(e); }
}

export async function getSchematic(buildId: string): Promise<{ name: string; dataUrl: string } | null> {
  const snap = await getDoc(doc(fb().db, 'builds', buildId, 'files', 'schematic'));
  const d = snap.data();
  return d ? { name: String(d.name), dataUrl: String(d.dataUrl) } : null;
}

/** Add or take back an upvote. */
export async function toggleUpvote(build: Build) {
  const u = requireUser();
  const on = build.upvoters.includes(u.uid);
  try { await updateDoc(doc(fb().db, 'builds', build.id), { upvoters: on ? arrayRemove(u.uid) : arrayUnion(u.uid) }); } catch (e) { throw friendly(e); }
}

export async function toggleFavorite(build: Build) {
  const u = requireUser();
  const on = build.favoriters.includes(u.uid);
  try { await updateDoc(doc(fb().db, 'builds', build.id), { favoriters: on ? arrayRemove(u.uid) : arrayUnion(u.uid) }); } catch (e) { throw friendly(e); }
}

// ---------------------------------------------------------------- comments
export function subscribeComments(buildId: string, fn: (comments: BuildComment[]) => void) {
  return onSnapshot(query(collection(fb().db, 'builds', buildId, 'comments'), orderBy('createdAt', 'asc')), (snap) => fn(snap.docs.map((x) => {
    const d = x.data();
    return { id: x.id, author: text(d.author, 20), authorId: text(d.authorId, 128), text: text(d.text, 1000), createdAt: millis(d.createdAt), up: ids(d.up), down: ids(d.down), ...(typeof d.parentId === 'string' ? { parentId: d.parentId } : {}) };
  }).filter((c) => c.text)));
}

export async function addComment(buildId: string, text: string, parentId?: string) {
  const u = requireUser();
  const body = text.trim().slice(0, 1000);
  if (!body) return;
  assertClean(body, 'comment');
  const { db } = fb();
  // Check the rate limit first: the server enforces it, but a refused transaction is retried
  // silently, so the person would see nothing happen.
  const wait = await secondsUntil(u.uid, 'lastComment', COMMENT_GAP_S);
  if (wait > 0) throw new Error(`Slow down: you can comment again in ${wait} second${wait === 1 ? '' : 's'}`);
  try {
    // The comment, the build's comment count and the rate-limit stamp change together; the
    // rules reject a comment within COMMENT_GAP_S seconds of the last one.
    await runTransaction(db, async (tx) => {
      const ref = doc(collection(db, 'builds', buildId, 'comments'));
      tx.set(ref, { author: u.username, authorId: u.uid, text: body, createdAt: serverTimestamp(), up: [], down: [], ...(parentId ? { parentId } : {}) });
      tx.update(doc(db, 'builds', buildId), { commentCount: increment(1) });
      tx.set(doc(db, 'limits', u.uid), { lastComment: serverTimestamp(), lastCommentId: `${buildId}/${ref.id}` }, { merge: true });
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') throw new Error(`Slow down: one comment every ${COMMENT_GAP_S} seconds`);
    throw friendly(e);
  }
}

/** Up (1) or down (-1); the same vote again takes it back. */
export async function voteComment(buildId: string, c: BuildComment, vote: 1 | -1) {
  const u = requireUser();
  const [mine, other] = vote === 1 ? ['up', 'down'] : ['down', 'up'];
  const on = (vote === 1 ? c.up : c.down).includes(u.uid);
  try {
    await updateDoc(doc(fb().db, 'builds', buildId, 'comments', c.id), on ? { [mine]: arrayRemove(u.uid) } : { [mine]: arrayUnion(u.uid), [other]: arrayRemove(u.uid) });
  } catch (e) { throw friendly(e); }
}

// ---------------------------------------------------------------- saved flows (sync)
export interface CloudFlow { id: string; pack: string; name: string; savedAt: number; draft?: boolean; nodes: CanvasNode[]; connections: Connection[]; targetEUtBudget: number; origin?: { author: string; authorId?: string; buildId?: string; example?: boolean } }

/** The logged-in user's saved flows for one modpack. */
export async function fetchFlows(pack: string): Promise<CloudFlow[]> {
  const u = requireUser();
  const snap = await getDocs(query(collection(fb().db, 'users', u.uid, 'flows'), where('pack', '==', pack)));
  return snap.docs.flatMap((x) => {
    const d = x.data();
    try {
      const body = JSON.parse(String(d.json));
      return [{ id: x.id, pack, name: String(d.name), savedAt: Number(d.savedAt), ...(d.draft ? { draft: true } : {}), nodes: body.nodes ?? [], connections: body.connections ?? [], targetEUtBudget: body.targetEUtBudget ?? 100000, ...(body.origin ? { origin: body.origin } : {}) }];
    } catch { return []; }
  });
}

/**
 * Upload changed flows and remove deleted ones, one write each: a flow the server refuses (too
 * big, or older than the copy already there) is skipped instead of blocking the others.
 * Returns the ids the server confirmed and the ids that failed for a reason worth retrying
 * (network); the rest were refused and stay only in this browser.
 */
export async function pushFlows(flows: CloudFlow[], deleted: string[]): Promise<{ stored: string[]; retry: string[] }> {
  const all = [...flows.map((f) => f.id), ...deleted];
  if (!user) return { stored: [], retry: all };
  const { db } = fb();
  const uid = user.uid;
  const stored: string[] = [];
  const retry: string[] = [];
  const isNetwork = (e: unknown) => /unavailable|network|deadline/i.test(String((e as { code?: string }).code ?? e));
  for (const f of flows) {
    const json = JSON.stringify({ nodes: f.nodes, connections: f.connections, targetEUtBudget: f.targetEUtBudget, ...(f.origin ? { origin: f.origin } : {}) });
    if (json.length > MAX_FLOW_JSON) continue; // too big for one document: stays in this browser
    const savedAt = Number.isFinite(f.savedAt) ? f.savedAt : Date.now();
    await setDoc(doc(db, 'users', uid, 'flows', f.id), { name: String(f.name).slice(0, 64), savedAt, draft: !!f.draft, json, pack: f.pack })
      .then(() => { stored.push(f.id); }, (e) => { if (isNetwork(e)) retry.push(f.id); });
  }
  for (const id of deleted) {
    await deleteDoc(doc(db, 'users', uid, 'flows', id)).then(() => { stored.push(id); }, (e) => { if (isNetwork(e)) retry.push(id); });
  }
  return { stored, retry };
}

export const upvotes = (b: Build) => b.upvoters.length;

// ---------------------------------------------------------------- modpack suggestions

export interface PackSuggestion { id: string; name: string; url: string; source: 'modrinth' | 'curseforge' | 'link'; votes: number; createdAt: number }

/** Document id for a suggested pack: the Modrinth slug, or one made from the link. */
export function packSuggestionId(url: string) {
  const m = url.match(/modrinth\.com\/modpack\/([\w-]+)/i) ?? url.match(/curseforge\.com\/minecraft\/modpacks\/([\w-]+)/i);
  const raw = m ? m[1] : url.replace(/^https?:\/\/(www\.)?/i, '');
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'pack';
}

/**
 * Vote for a modpack to be added. Adds your vote to an existing suggestion, or starts one.
 * Returns false when you'd already suggested it. Users can't read the list (moderators only).
 */
export async function suggestPack(name: string, url: string, source: PackSuggestion['source']): Promise<boolean> {
  const { auth, db } = fb();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Log in first');
  if (!/^https:\/\/\S+$/.test(url)) throw new Error('Paste the pack\'s https:// link');
  assertClean(name, 'Pack name');
  const ref = doc(db, 'packSuggestions', packSuggestionId(url));
  // Users can't read suggestions, so try to start one first: if it already exists, that write
  // counts as an update and the rules refuse it; then add your vote to it instead.
  try {
    await setDoc(ref, { name: name.trim().slice(0, 80), url: url.slice(0, 300), source, voters: [uid], createdAt: serverTimestamp() });
    return true;
  } catch (e) {
    if ((e as { code?: string }).code !== 'permission-denied') throw friendly(e);
  }
  try {
    await updateDoc(ref, { voters: arrayUnion(uid) });
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') return false; // your vote is already in
    throw friendly(e);
  }
}

/** Moderators: suggested packs, most wanted first. */
export async function listPackSuggestions(): Promise<PackSuggestion[]> {
  const snap = await getDocs(collection(fb().db, 'packSuggestions'));
  return snap.docs.map((d) => {
    const x = d.data() as { name: string; url: string; source: PackSuggestion['source']; voters?: string[]; createdAt?: Timestamp };
    return { id: d.id, name: x.name, url: x.url, source: x.source, votes: x.voters?.length ?? 0, createdAt: x.createdAt?.toMillis() ?? 0 };
  }).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

/** Moderators: clear a suggestion (added, or not happening). */
export async function removePackSuggestion(id: string) {
  try { await deleteDoc(doc(fb().db, 'packSuggestions', id)); } catch (e) { throw friendly(e); }
}
