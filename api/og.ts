/**
 * Link preview image for a shared flow (Vercel function): GET /api/og?flow=<build id>
 * A 1200x630 card in the site's style (pixel fonts, dark panels, tier colours): the flow's
 * name, author, output rate and stats, and a map of its machines with links coloured by the
 * item they carry. Chat apps (Discord, Slack, X...) show it when a flow link is posted.
 * Shared flows are public, so it reads them from Firestore without signing in.
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// @vercel/og's Node build loads its renderer with require() and __dirname, which ES modules (this
// package is "type": "module") don't have: provide both, then load the library.
const req = createRequire(import.meta.url);
(globalThis as { require?: unknown }).require ??= req;
(globalThis as { __dirname?: string }).__dirname ??= dirname(req.resolve('@vercel/og'));
const { ImageResponse } = await import('@vercel/og');

const DOC = 'https://firestore.googleapis.com/v1/projects/greg-calc/databases/(default)/documents/builds/';

// Same colours as the site (src/types.ts TIERS), as in GregTech.
const TIER: Record<string, { color: string; bg: string; border: string }> = {
  ULV: { color: '#8a8f98', bg: '#26292f', border: '#555b66' }, LV: { color: '#d1d5db', bg: '#3f4450', border: '#9ca3af' },
  MV: { color: '#22d3ee', bg: '#0e4552', border: '#06b6d4' }, HV: { color: '#facc15', bg: '#5c4a07', border: '#eab308' },
  EV: { color: '#c084fc', bg: '#4c1d95', border: '#a855f7' }, IV: { color: '#6b8cff', bg: '#1e2a78', border: '#3b5bdb' },
  LuV: { color: '#f9a8d4', bg: '#831843', border: '#ec4899' }, ZPM: { color: '#f87171', bg: '#7f1d1d', border: '#ef4444' },
  UV: { color: '#2dd4bf', bg: '#134e4a', border: '#14b8a6' }, UHV: { color: '#fb923c', bg: '#7c2d12', border: '#f97316' },
};
const tierOf = (t: string) => TIER[t] ?? { color: '#cbd5e1', bg: '#334155', border: '#64748b' };

type Item = { id: string; iconColor?: string };
type Node = { instanceId: string; x: number; y: number; isTarget?: boolean; selectedTier?: string; multi?: { name: string }; gen?: { kind?: string; name?: string }; recipe: { kind?: string; machineName: string; recipeName: string; generatesEU?: boolean; outputs?: Item[] } };
type Link = { sourceInstanceId: string; targetInstanceId: string; sourceItemId: string };

const val = (f: Record<string, any> | undefined, k: string) => {
  const v = f?.[k];
  return v?.stringValue ?? (v?.integerValue != null ? Number(v.integerValue) : v?.doubleValue);
};
const compact = (n: number) => {
  const scales = [[1, ''], [1e3, 'k'], [1e6, 'M'], [1e9, 'G'], [1e12, 'T']] as const;
  const a = Math.abs(n);
  for (let i = 0; i < scales.length; i++) {
    const [v, s] = scales[i];
    const last = i === scales.length - 1;
    if (!last && a >= scales[i + 1][0]) continue;
    const x = n / v;
    const text = `${+x.toFixed(Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2)}`;
    if (!last && Math.abs(+text) >= 1000) continue; // 999.6k rounds to 1000k: show 1M
    return `${text}${s}`;
  }
  return String(n);
};

// The map shows at most this many cards and links (a shared flow's JSON is user data).
const MAX_CARDS = 400, MAX_LINKS = 1200;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object';
/** A shared flow's cards and links, keeping only well-formed ones. */
function readMap(flowJson: unknown): { nodes: Node[]; links: Link[] } {
  let flow: unknown;
  try { flow = JSON.parse(String(flowJson)); } catch { return { nodes: [], links: [] }; }
  if (!isObj(flow)) return { nodes: [], links: [] };
  const nodes: Node[] = (Array.isArray(flow.nodes) ? flow.nodes : [])
    .filter((n: unknown) => isObj(n) && typeof n.instanceId === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y) && isObj(n.recipe))
    .slice(0, MAX_CARDS)
    .map((n: Record<string, any>) => ({
      instanceId: n.instanceId, x: n.x, y: n.y, isTarget: n.isTarget === true,
      selectedTier: typeof n.selectedTier === 'string' ? n.selectedTier.slice(0, 8) : undefined,
      multi: isObj(n.multi) && typeof n.multi.name === 'string' ? { name: n.multi.name } : undefined,
      gen: isObj(n.gen) ? { kind: str(n.gen.kind), name: str(n.gen.name) } : undefined,
      recipe: {
        kind: str(n.recipe.kind), machineName: str(n.recipe.machineName) || 'Machine', recipeName: str(n.recipe.recipeName),
        outputs: (Array.isArray(n.recipe.outputs) ? n.recipe.outputs : []).filter((o: unknown) => isObj(o) && typeof o.id === 'string')
          .map((o: Record<string, any>) => ({ id: o.id, iconColor: str(o.iconColor) || undefined })),
      },
    }));
  const links: Link[] = (Array.isArray(flow.connections) ? flow.connections : [])
    .filter((l: unknown) => isObj(l) && typeof l.sourceInstanceId === 'string' && typeof l.targetInstanceId === 'string' && typeof l.sourceItemId === 'string')
    .slice(0, MAX_LINKS);
  return { nodes, links };
}
const rate = (perSec: number, unit: string) => (unit === 'mB' ? (perSec >= 1000 ? `${compact(perSec / 1000)} B/s` : `${compact(perSec)} mB/s`) : perSec < 0.1 ? `${compact(perSec * 60)}/min` : `${compact(perSec)}/s`);
/** Very dark item colours lifted so links stay visible (as on the canvas). */
const visible = (hex?: string) => {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return '#38bdf8';
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum >= 0.35) return hex;
  const t = Math.min(0.6, (0.35 - lum) / 0.35 + 0.2);
  return '#' + rgb.map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
};

/** The site's pixel fonts, from Google Fonts (TTF, which the renderer needs); cached per instance. */
let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }[]> | null = null;
const loadFonts = () => (fonts ??= (async () => {
  const one = async (family: string, name: string, weight: 400 | 700) => {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}`)).text(); // no browser UA: TTF links
    const url = /src:\s*url\(([^)]+\.ttf)\)/.exec(css)?.[1];
    if (!url) throw new Error(`no ttf for ${family}`);
    return { name, data: await (await fetch(url)).arrayBuffer(), weight, style: 'normal' as const };
  };
  return Promise.all([one('Silkscreen:wght@400', 'Silkscreen', 400), one('Silkscreen:wght@700', 'Silkscreen', 700), one('VT323', 'VT323', 400)]);
})().catch(() => { fonts = null; return []; }));

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('flow') ?? '';
  let name = 'gtcalc', author = '', line = 'GregTech production line calculator', nodes: Node[] = [], links: Link[] = [];
  let chips: { text: string; color: string; border: string; bg: string }[] = [];
  let tiers: [string, string] | null = null;
  if (!id) {
    // The site's own card: an example line in the picture, with the site's name and tagline.
    const res = await fetch(DOC + 'example-skygreg-nitric').catch(() => null);
    if (res?.ok) {
      try { ({ nodes, links } = readMap(val((await res.json()).fields, 'flowJson'))); } catch { /* no map */ }
    }
    chips = [{ text: 'Free · no login', color: '#a7f3d0', border: '#047857', bg: '#0f1f1a' }];
  }
  if (/^[\w-]{3,200}$/.test(id)) {
    const res = await fetch(DOC + encodeURIComponent(id)).catch(() => null); // offline: the site's plain card
    if (res?.ok) {
      const f = (await res.json()).fields as Record<string, any>;
      name = String(val(f, 'name') ?? name);
      author = String(val(f, 'author') ?? '');
      const st = f.stats?.mapValue?.fields ?? {};
      const out = st.output?.mapValue?.fields;
      line = out && val(out, 'perSec') != null ? `Makes ${rate(Number(val(out, 'perSec')), String(val(out, 'unit') ?? 'item'))}` : '';
      const use = Number(val(st, 'eutUse') ?? 0), gen = Number(val(st, 'eutGen') ?? 0);
      chips = [
        { text: `${val(st, 'machines') ?? 0} machines`, color: '#e2e8f0', border: '#2b3548', bg: '#161a24' },
        gen > 0
          ? { text: `${gen >= use ? '+' : ''}${compact(gen - use)} EU/t net`, color: gen >= use ? '#fde68a' : '#fda4af', border: gen >= use ? '#a16207' : '#9f1239', bg: '#1c1a10' }
          : { text: `${compact(use)} EU/t`, color: '#fbbf24', border: '#92400e', bg: '#1c1710' },
      ];
      tiers = [String(val(st, 'lowTier') ?? ''), String(val(st, 'topTier') ?? '')];
      ({ nodes, links } = readMap(val(f, 'flowJson')));
    }
  }
  const fontList = await loadFonts();
  const PIXEL = fontList.length ? 'Silkscreen' : 'sans-serif';
  const TEXT = fontList.length ? 'VT323' : 'sans-serif';

  // The map: every card at its canvas position, scaled into the right-hand panel.
  const W = 580, H = 486, CARD_W = 420, CARD_H = 250;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
  const spanX = maxX + CARD_W - minX, spanY = maxY + CARD_H - minY;
  const k = nodes.length ? Math.min((W - 24) / spanX, (H - 24) / spanY, 0.6) : 1;
  const ox = (W - spanX * k) / 2, oy = (H - spanY * k) / 2;
  const pos = new Map(nodes.map((n) => [n.instanceId, { x: ox + (n.x - minX) * k, y: oy + (n.y - minY) * k, w: CARD_W * k, h: CARD_H * k }]));
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  // Links as plain line segments (across, down, across), coloured by the item they carry.
  const segments: { x: number; y: number; w: number; h: number; color: string }[] = [];
  for (const l of links) {
    const s = pos.get(l.sourceInstanceId), t = pos.get(l.targetInstanceId);
    if (!s || !t) continue;
    const color = visible(byId.get(l.sourceInstanceId)?.recipe.outputs?.find((o) => o.id === l.sourceItemId)?.iconColor);
    const x1 = s.x + s.w, y1 = s.y + s.h / 2, x2 = t.x, y2 = t.y + t.h / 2, mx = (x1 + x2) / 2;
    segments.push({ x: Math.min(x1, mx), y: y1 - 2, w: Math.abs(mx - x1), h: 4, color });
    segments.push({ x: mx - 2, y: Math.min(y1, y2) - 2, w: 4, h: Math.abs(y2 - y1) + 4, color });
    segments.push({ x: Math.min(mx, x2), y: y2 - 2, w: Math.abs(x2 - mx), h: 4, color });
  }

  // Plain element objects (what JSX compiles to), so this file needs no JSX setup.
  type El = { type: string; props: Record<string, unknown> };
  const h = (type: string, props: Record<string, unknown>, ...children: unknown[]): El => ({ type, props: { ...props, children: children.flat().filter((c) => c !== false && c != null && c !== '') } });
  const box = (style: Record<string, unknown>, ...children: unknown[]) => h('div', { style: { display: 'flex', ...style } }, ...children);
  const badge = (t: string, size = 22) => box({ fontFamily: PIXEL, fontSize: size, padding: '2px 8px', border: `2px solid ${tierOf(t).border}`, background: tierOf(t).bg, color: tierOf(t).color }, t);

  const left = box({ flexDirection: 'column', width: 500, paddingRight: 28 },
    box({ alignItems: 'center' },
      box({ width: 22, height: 22, background: '#22d3ee', marginRight: 12 }),
      box({ fontFamily: PIXEL, fontSize: 24, color: '#22d3ee', fontWeight: 700 }, 'gtcalc'),
    ),
    box({ fontFamily: PIXEL, fontSize: name.length > 28 ? 40 : 50, fontWeight: 700, marginTop: 28, lineHeight: 1.1, color: '#f8fafc' }, name.toUpperCase()),
    author && box({ fontFamily: TEXT, fontSize: 34, marginTop: 14, color: '#94a3b8' }, `BY ${author.toUpperCase()}`),
    line && box({ fontFamily: PIXEL, fontSize: 30, marginTop: 26, color: '#6ee7b7', fontWeight: 700 }, line.toUpperCase()),
    box({ flexWrap: 'wrap', alignItems: 'center', marginTop: 22 },
      ...chips.map((c) => box({ fontFamily: TEXT, fontSize: 32, padding: '2px 12px', marginRight: 10, marginBottom: 10, border: `2px solid ${c.border}`, background: c.bg, color: c.color }, c.text.toUpperCase())),
      tiers && box({ alignItems: 'center', marginBottom: 10 }, badge(tiers[0]), tiers[1] !== tiers[0] && box({ fontFamily: PIXEL, fontSize: 22, color: '#64748b', margin: '0 6px' }, '-'), tiers[1] !== tiers[0] && badge(tiers[1])),
    ),
    box({ marginTop: 'auto', fontFamily: TEXT, fontSize: 28, color: '#64748b' }, new URL(req.url).host.toUpperCase()),
  );
  const cards = nodes.map((n) => {
    const p = pos.get(n.instanceId)!;
    const supply = n.recipe.kind === 'supply';
    // Border in the machine's tier colour (inputs green, the target cyan), so tiers show at any size.
    const border = n.isTarget ? '#22d3ee' : supply ? '#10b981' : n.selectedTier ? tierOf(n.selectedTier).border : '#3b4a63';
    const title = supply ? 'Input' : n.gen && n.gen.kind !== 'single' && n.gen.name ? n.gen.name : n.multi?.name ?? n.recipe.machineName;
    // Shrink the name until its longest word fits the card (bold pixel letters are about 1em wide).
    const longest = Math.max(1, ...title.split(/\s+/).slice(0, 20).map((w) => w.length));
    const fs = Math.max(6, Math.min(16, (p.w - 14) / (longest * 1.02)));
    return box({ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h, flexDirection: 'column', border: `3px solid ${border}`, background: n.isTarget ? '#12324a' : '#161a24', overflow: 'hidden' },
      box({ alignItems: 'center', justifyContent: 'space-between', padding: '3px 5px', background: n.isTarget ? '#164260' : '#1b2130', borderBottom: '2px solid #222a3b' },
        p.w > 60 && box({ fontFamily: PIXEL, fontSize: fs, color: '#e2e8f0', fontWeight: 700, overflow: 'hidden' }, title.toUpperCase()),
        !supply && n.selectedTier && p.w > 150 && badge(n.selectedTier, Math.max(9, fs - 2)),
      ),
      p.h > 50 && box({ fontFamily: TEXT, fontSize: fs + 4, color: '#94a3b8', padding: '2px 6px', overflow: 'hidden' }, (supply ? 'You supply this' : n.recipe.recipeName).toUpperCase()),
    );
  });
  const map = box({ position: 'relative', width: W, height: H, marginTop: 14, background: '#0f131c', border: '3px solid #222a3b' },
    ...segments.map((g) => box({ position: 'absolute', left: g.x, top: g.y, width: Math.max(1, g.w), height: Math.max(1, g.h), background: g.color })),
    ...cards,
    !nodes.length && box({ margin: 'auto', fontFamily: PIXEL, fontSize: 26, color: '#475569' }, 'PLAN GREGTECH LINES'),
  );
  const card = box({ width: '100%', height: '100%', background: '#11141c', color: '#e2e8f0', padding: 44, border: '8px solid #22d3ee', fontFamily: TEXT }, left, map);
  return new ImageResponse(card as never, { width: 1200, height: 630, fonts: fontList, headers: { 'cache-control': 'public, max-age=600, s-maxage=3600' } }); // lowercase: replaces @vercel/og's own year-long default instead of adding a second value
}
