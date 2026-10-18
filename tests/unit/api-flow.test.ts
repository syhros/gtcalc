// The shared-flow page (/api/flow) puts the flow's name and description into index.html. User
// text must land literally: String.replace treats $&, $` and $' in a replacement string as
// patterns, which spliced page content into the head.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../api/flow';

const INDEX = `<!doctype html><html><head>
    <title>gtcalc</title>
    <meta name="description" content="site" />
  </head><body><main class="seo-intro"><h1>gtcalc</h1></main><div id="root"></div></body></html>`;

function serve(fields: Record<string, unknown>, opts: { indexFails?: number } = {}) {
  let fails = opts.indexFails ?? 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const u = String(input);
    if (u.endsWith('/index.html')) {
      if (fails-- > 0) throw new Error('network');
      return new Response(INDEX);
    }
    return new Response(JSON.stringify({ fields }), { headers: { 'Content-Type': 'application/json' } });
  }));
}
const str = (s: string) => ({ stringValue: s });
const req = () => new Request('https://gtcalc.app/?flow=abc_123');

afterEach(() => { vi.unstubAllGlobals(); });

describe('/api/flow', () => {
  it('puts $ patterns in the name and description in literally', async () => {
    serve({ name: str("Iron $& $` $' $$ line"), author: str('Alice'), description: str("costs $$5 and $'more") });
    const html = await (await GET(req())).text();
    expect(html).toContain('<h1>Iron $&amp; $` $&#39; $$ line</h1>');
    expect(html).toContain('costs $$5 and $&#39;more');
    expect(html.match(/<\/head>/g)).toHaveLength(1);
    expect(html.match(/<main class="seo-intro">/g)).toHaveLength(1);
  });

  it('retries the page once when it cannot be fetched', async () => {
    serve({ name: str('Iron') }, { indexFails: 1 });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>Iron</h1>');
  });

  it('answers 503 instead of crashing when the page cannot be fetched at all', async () => {
    serve({ name: str('Iron') }, { indexFails: 5 });
    const res = await GET(req());
    expect(res.status).toBe(503);
  });
});
