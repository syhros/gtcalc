/**
 * Username profanity check (Vercel function): GET /api/check-username?u=<name>
 * Asks APIVerve's Username Profanity API (https://apiverve.com/marketplace/usernameprofanity),
 * which also catches profanity hidden inside joined-up names. The API key stays here on the
 * server (APIVERVE_API_KEY in Vercel's environment variables), never in the browser.
 *
 * Answers { ok: true } or { ok: false, reason }. Without a key, or if APIVerve is down, it
 * answers { ok: true, checked: false } and the app falls back to its own word list (the
 * database rules apply that list as well).
 */

declare const process: { env: Record<string, string | undefined> }; // Node global on Vercel

const NAME = /^[A-Za-z0-9_-]{3,20}$/;
// Best-effort throttle per server instance, so the endpoint can't be used to burn the API quota.
const recent = new Map<string, number[]>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get('u') ?? '';
  if (!NAME.test(name)) return json({ ok: false, reason: 'Username: 3 to 20 letters, numbers, - or _' });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 20) return json({ ok: false, reason: 'Too many checks. Wait a minute and try again' }, 429);
  hits.push(now);
  recent.set(ip, hits);

  const key = process.env.APIVERVE_API_KEY;
  if (!key) return json({ ok: true, checked: false });
  try {
    const res = await fetch(`https://api.apiverve.com/v1/usernameprofanity?username=${encodeURIComponent(name)}`, {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return json({ ok: true, checked: false });
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const d = body.data ?? {};
    const profane = d.isProfane === true || d.profane === true || d.containsProfanity === true || d.isProfanity === true;
    return profane ? json({ ok: false, reason: 'That username isn\'t allowed. Please pick another' }) : json({ ok: true, checked: true });
  } catch {
    return json({ ok: true, checked: false });
  }
}
