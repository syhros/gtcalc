/**
 * Modpack search for "Suggest a pack" (Vercel function): GET /api/pack-search?q=<name>
 * Asks Modpack Index (modpackindex.com, which lists CurseForge and Modrinth packs) on the
 * browser's behalf, since its API doesn't allow calls from other sites. Answers
 * { hits: [{ name, summary, url, icon, downloads, source }] }, at most 8.
 */
import { ipThrottle } from './_throttle.js'; // Node ESM needs the extension

const allowed = ipThrottle(40, 60_000);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': status === 200 ? 'public, max-age=3600' : 'no-store' } });
}

interface Pack { name: string; summary?: string; url?: string; links?: { curseforge?: string; modrinth?: string }; thumbnail_url?: string; download_count?: number }

export async function GET(request: Request): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return json({ hits: [] });

  if (!allowed(request)) return json({ hits: [], error: 'Too many searches. Wait a minute' }, 429);

  try {
    const res = await fetch(`https://www.modpackindex.com/api/v1/modpacks?limit=8&name=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!res.ok) return json({ hits: [] }, 502);
    const j = (await res.json()) as { data?: Pack[] };
    const out = (j.data ?? []).map((p) => {
      const url = p.links?.curseforge ?? p.links?.modrinth ?? p.url ?? '';
      return {
        name: p.name,
        summary: p.summary ?? '',
        url,
        icon: p.thumbnail_url && /^https:\/\//i.test(p.thumbnail_url) ? p.thumbnail_url : null, // only https images
        downloads: p.download_count ?? 0,
        source: /curseforge\.com/i.test(url) ? 'curseforge' : /modrinth\.com/i.test(url) ? 'modrinth' : 'link',
      };
    }).filter((p) => /^https:\/\//.test(p.url));
    return json({ hits: out });
  } catch {
    return json({ hits: [] }, 502);
  }
}
