/**
 * Account emails (Vercel function): POST /api/account-email
 *   { kind: 'reset', email }                 password reset link
 *   { kind: 'verify', idToken }              confirm the signed-in user's email
 *   { kind: 'change', idToken, newEmail }    confirm a new email for the signed-in user
 *
 * Firebase won't let this project edit its email templates, so the site sends these itself: a
 * service account asks Firebase for the link only (returnOobLink, so Firebase sends nothing), the
 * link goes to gtcalc.app/auth/action, and Brevo's SMTP relay delivers our template (api/_emails.ts,
 * built by emails/build.mjs) from noreply@gtcalc.app. SMTP rather than Brevo's API, which only
 * accepts allow-listed IPs; Vercel's change.
 *
 * Environment (Vercel): FIREBASE_SERVICE_ACCOUNT (JSON key, Firebase Auth admin only),
 * BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, VITE_FIREBASE_API_KEY. Without them, or if Google or Brevo
 * fail, it answers { ok: false, fallback: true } and the app has Firebase send its own email.
 *
 * Resets always answer { ok: true } for unknown addresses, so the endpoint can't be used to find
 * out who has an account. At most one email a minute per address.
 */
import { createSign } from 'node:crypto';
import nodemailer from 'nodemailer';
import { CHANGE_EMAIL, RESET_PASSWORD, VERIFY_EMAIL } from './_emails.js'; // Node ESM needs the extension
import { ipThrottle } from './_throttle.js';

declare const process: { env: Record<string, string | undefined> }; // Node global on Vercel

const PROJECT = 'greg-calc';
const TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const HIDDEN = /@users\.greg-calc\.app$/i; // username-only accounts (HIDDEN_EMAIL_DOMAIN): nowhere to send
// Best-effort throttles per server instance (see _throttle.ts).
const allowed = ipThrottle(6, 10 * 60_000);
const byEmail = new Map<string, number>();

type Template = { subject: string; html: string; text: string };
type SA = { client_email: string; private_key: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
const fallback = () => json({ ok: false, fallback: true });
const ok = () => json({ ok: true });

let token: { value: string; expires: number } | null = null;
/** OAuth access token for the service account (signed JWT exchanged at Google's token endpoint). */
async function accessToken(sa: SA) {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function post<T>(url: string, body: unknown, bearer?: string): Promise<{ ok: boolean; status: number; j: T & { error?: { message?: string } } }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { ok: res.ok, status: res.status, j: (await res.json().catch(() => ({}))) as T & { error?: { message?: string } } };
}

/** The gtcalc username for an account (profiles are public in Firestore). */
async function usernameOf(uid: string): Promise<string | null> {
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(uid)}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { fields?: { username?: { stringValue?: string } } };
    return j.fields?.username?.stringValue ?? null;
  } catch { return null; }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function send(t: Template, to: string, vars: { name: string; email: string; link: string }) {
  const user = process.env.BREVO_SMTP_LOGIN, pass = process.env.BREVO_SMTP_KEY;
  if (!user || !pass) throw new Error('smtp not configured');
  const fill = (s: string, html: boolean) => s
    .replaceAll('%NAME%', html ? escape(vars.name) : vars.name)
    .replaceAll('%EMAIL%', html ? escape(vars.email) : vars.email)
    .replaceAll('%LINK%', html ? escape(vars.link) : vars.link);
  const mail = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com', port: 587, requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 8000,
  });
  await mail.sendMail({
    from: { name: 'gtcalc', address: 'noreply@gtcalc.app' },
    to,
    subject: t.subject,
    html: fill(t.html, true),
    text: fill(t.text, false),
  });
}

/** Firebase's link, moved onto our own page. */
const ourLink = (oobLink: string) => `https://gtcalc.app/auth/action${new URL(oobLink).search}`;

export async function POST(request: Request): Promise<Response> {
  let body: { kind?: unknown; email?: unknown; idToken?: unknown; newEmail?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { /* bad body */ }
  const kind = body.kind ?? 'reset';

  if (!allowed(request)) return json({ ok: false, reason: 'Too many requests. Wait a few minutes and try again' }, 429);
  const now = Date.now();
  if (byEmail.size > 5000) for (const [k, t] of byEmail) if (now - t >= 60_000) byEmail.delete(k);
  const once = (address: string) => {
    const key = `${kind}|${address.toLowerCase()}`;
    if (now - (byEmail.get(key) ?? 0) < 60_000) return false; // already sent one just now
    byEmail.set(key, now);
    return true;
  };

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!saJson || !apiKey || !process.env.BREVO_SMTP_LOGIN) return fallback();

  try {
    const bearer = await accessToken(JSON.parse(saJson) as SA);

    if (kind === 'reset') {
      const email = String(body.email ?? '').trim();
      if (!EMAIL.test(email) || email.length > 254) return json({ ok: false, reason: 'Enter a valid email address' }, 400);
      if (!once(email)) return ok();
      const r = await post<{ oobLink?: string }>(`${TOOLKIT}/projects/${PROJECT}/accounts:sendOobCode`, { requestType: 'PASSWORD_RESET', email, returnOobLink: true }, bearer);
      if (!r.ok) {
        if (/EMAIL_NOT_FOUND|USER_DISABLED/.test(r.j.error?.message ?? '')) return ok();
        console.error('reset link failed', r.status, r.j.error?.message);
        return fallback();
      }
      // With email enumeration protection on, an unknown address "succeeds" with no link.
      if (!r.j.oobLink) return ok();
      const who = await post<{ users?: { localId: string }[] }>(`${TOOLKIT}/projects/${PROJECT}/accounts:lookup`, { email: [email] }, bearer);
      const uid = who.j.users?.[0]?.localId;
      const name = (uid && (await usernameOf(uid))) || 'there';
      await send(RESET_PASSWORD, email, { name, email, link: ourLink(r.j.oobLink) });
      return ok();
    }

    if (kind === 'verify' || kind === 'change') {
      const idToken = String(body.idToken ?? '');
      if (!idToken) return json({ ok: false, reason: 'Log in first' }, 401);
      // Google checks the token; the answer is the signed-in account.
      const me = await post<{ users?: { localId: string; email?: string; emailVerified?: boolean }[] }>(`${TOOLKIT}/accounts:lookup?key=${apiKey}`, { idToken });
      const user = me.j.users?.[0];
      if (!me.ok || !user?.email) return json({ ok: false, reason: 'Log in again first' }, 401);
      const name = (await usernameOf(user.localId)) || 'there';

      if (kind === 'verify') {
        if (user.emailVerified || HIDDEN.test(user.email)) return ok();
        if (!once(user.email)) return ok();
        const r = await post<{ oobLink?: string }>(`${TOOLKIT}/projects/${PROJECT}/accounts:sendOobCode`, { requestType: 'VERIFY_EMAIL', email: user.email, returnOobLink: true }, bearer);
        if (!r.ok || !r.j.oobLink) { console.error('verify link failed', r.status, r.j.error?.message); return fallback(); }
        await send(VERIFY_EMAIL, user.email, { name, email: user.email, link: ourLink(r.j.oobLink) });
        return ok();
      }

      // Changing the email needs a fresh login, as Firebase's own verifyBeforeUpdateEmail does.
      const authTime = Number(JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString() || '{}').auth_time ?? 0);
      if (Date.now() / 1000 - authTime > 10 * 60) return json({ ok: false, reason: 'Log in again first, then retry' }, 401);
      const newEmail = String(body.newEmail ?? '').trim();
      if (!EMAIL.test(newEmail) || newEmail.length > 254) return json({ ok: false, reason: 'Enter a valid email address' }, 400);
      if (!once(newEmail)) return ok();
      const r = await post<{ oobLink?: string }>(`${TOOLKIT}/projects/${PROJECT}/accounts:sendOobCode`, { requestType: 'VERIFY_AND_CHANGE_EMAIL', email: user.email, newEmail, returnOobLink: true }, bearer);
      if (!r.ok || !r.j.oobLink) {
        if (/EMAIL_EXISTS/.test(r.j.error?.message ?? '')) return json({ ok: false, reason: 'That email is already used by another account' }, 409);
        console.error('change link failed', r.status, r.j.error?.message);
        return fallback();
      }
      await send(CHANGE_EMAIL, newEmail, { name, email: newEmail, link: ourLink(r.j.oobLink) });
      return ok();
    }

    return json({ ok: false, reason: 'Unknown request' }, 400);
  } catch (e) {
    console.error('account email error', (e as Error).message?.slice(0, 300));
    return fallback();
  }
}
