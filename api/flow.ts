/**
 * The site's page for a shared flow link (/?flow=<id>, rewritten here by vercel.json): the normal
 * index.html with the flow's name, a description and a preview image in the link-preview tags,
 * so Discord, Slack, X and messaging apps show a proper card. The app itself loads as usual.
 */

const DOC = 'https://firestore.googleapis.com/v1/projects/greg-calc/databases/(default)/documents/builds/';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const field = (f: Record<string, any> | undefined, k: string) => {
  const v = f?.[k];
  return v?.stringValue ?? (v?.integerValue != null ? Number(v.integerValue) : v?.doubleValue);
};

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const html = await (await fetch(new URL('/index.html', url.origin))).text();
  // A preview problem must never break the link: on any error, serve the normal page.
  try { return await withPreview(url, html); } catch { return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
}

async function withPreview(url: URL, html: string): Promise<Response> {
  const page = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
  const id = url.searchParams.get('flow') ?? '';
  if (!/^[\w-]{3,200}$/.test(id)) return page(html);
  const res = await fetch(DOC + encodeURIComponent(id));
  if (!res.ok) return page(html);
  const f = (await res.json()).fields as Record<string, any>;
  const name = String(field(f, 'name') ?? 'Shared flow').slice(0, 80);
  const author = String(field(f, 'author') ?? '');
  const st = f.stats?.mapValue?.fields ?? {};
  const out = st.output?.mapValue?.fields;
  const summary = [out ? `Makes ${field(out, 'name')}` : null, `${field(st, 'machines') ?? 0} machines`, `${field(st, 'lowTier')}–${field(st, 'topTier')}`, author ? `by ${author}` : null].filter(Boolean).join(' · ');
  const about = String(field(f, 'description') ?? '').slice(0, 200);
  const description = esc(about ? `${summary}. ${about}` : summary);
  const title = esc(`${name} · gtcalc`);
  const image = esc(`${url.origin}/api/og?flow=${encodeURIComponent(id)}`);
  const link = esc(`${url.origin}/?flow=${encodeURIComponent(id)}`);
  const tags = [
    `<title>${title}</title>`,
    `<link rel="canonical" href="${link}" />`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="gtcalc" />`,
    `<meta property="og:title" content="${esc(name)}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:url" content="${link}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(name)}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('\n    ');
  // Swap the site-wide title / description / preview tags for this flow's.
  // What search engines read for this flow (index.html keeps it visually hidden): its machines and output.
  let machines: string[] = [];
  try {
    const flow = JSON.parse(String(field(f, 'flowJson') ?? '{}')) as { nodes?: { selectedTier?: string; recipe?: { kind?: string; machineName?: string; recipeName?: string } }[] };
    const seen = new Map<string, number>();
    for (const n of flow.nodes ?? []) {
      if (n.recipe?.kind === 'supply' || !n.recipe?.machineName) continue;
      const k = `${n.recipe.machineName}${n.recipe.recipeName ? ` (${n.recipe.recipeName})` : ''}, ${n.selectedTier ?? ''}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    machines = [...seen].slice(0, 40).map(([k, c]) => (c > 1 ? `${k} ×${c}` : k));
  } catch { /* no flow data */ }
  const intro = `<main class="seo-intro">
        <h1>${esc(name)}</h1>
        <p>A GregTech (GTCEu) production line shared on gtcalc. ${esc(summary)}.</p>
        ${about ? `<p>${esc(about)}</p>` : ''}
        ${machines.length ? `<h2>Machines</h2><ul>${machines.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        <p><a href="/">Open gtcalc</a> to view, copy or change this flow.</p>
      </main>`;
  const stripped = html
    .replace(/<main class="seo-intro">[\s\S]*?<\/main>/, intro)
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*<link rel="canonical"[^>]*>/, '')
    .replace(/\s*<meta (name="description"|property="og:[^"]+"|name="twitter:[^"]+")[^>]*>/g, '');
  return page(stripped.replace('</head>', `    ${tags}\n  </head>`));
}
