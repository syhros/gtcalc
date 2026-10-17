/**
 * /sitemap.xml (rewritten here by vercel.json): the home page, the landing pages, the policies, and every flow
 * shared to Community, so search engines can find each flow's page (/?flow=<id>).
 */

const BUILDS = 'https://firestore.googleapis.com/v1/projects/greg-calc/databases/(default)/documents/builds';
const SITE = 'https://gtcalc.app';

type Doc = { name: string; fields?: Record<string, { timestampValue?: string }>; updateTime?: string };

async function listBuilds(): Promise<Doc[]> {
  const out: Doc[] = [];
  let token = '';
  for (let page = 0; page < 20; page++) { // at most 6,000 flows per sitemap
    const q = new URLSearchParams({ pageSize: '300' });
    q.append('mask.fieldPaths', 'createdAt');
    q.append('mask.fieldPaths', 'updatedAt');
    if (token) q.set('pageToken', token);
    const res = await fetch(`${BUILDS}?${q}`);
    if (!res.ok) break;
    const j = await res.json() as { documents?: Doc[]; nextPageToken?: string };
    out.push(...(j.documents ?? []));
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out;
}

export async function GET(): Promise<Response> {
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);
  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/gtnh`, priority: '0.9' },
    { loc: `${SITE}/gtceu`, priority: '0.9' },
    { loc: `${SITE}/guide`, priority: '0.8' },
    { loc: `${SITE}/privacy`, priority: '0.2' },
    { loc: `${SITE}/terms`, priority: '0.2' },
  ];
  try {
    for (const d of await listBuilds()) {
      const id = d.name.split('/').pop()!;
      const lastmod = day(d.fields?.updatedAt?.timestampValue ?? d.fields?.createdAt?.timestampValue ?? d.updateTime);
      urls.push({ loc: `${SITE}/?flow=${encodeURIComponent(id)}`, lastmod, priority: '0.6' });
    }
  } catch { /* the static pages are still worth listing */ }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc.replace(/&/g, '&amp;')}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=3600' } });
}

// Some crawlers and checkers send HEAD first; answer it like GET, without the body.
export async function HEAD(): Promise<Response> {
  const res = await GET();
  return new Response(null, { status: res.status, headers: res.headers });
}
