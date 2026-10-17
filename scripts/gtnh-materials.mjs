// GTNH material icons: works out each GregTech material's texture style ("icon set") and colour.
//
// NEI hides some GregTech item shapes (tiny/small/impure/purified dust, crushed/purified/centrifuged
// ore, hot ingots), so the icon dump has no pictures of them. GregTech draws every material item
// from a grey template per shape and style, tinted with the material's colour, plus an untinted
// overlay. This script takes an icon that IS in the dump (the material's dust, ingot, plate...),
// tries every style's template, and keeps the style and tint that reproduce it best. With those,
// the site can draw any shape of that material from the templates (ItemIcon composes them).
//
// Usage: node scripts/gtnh-materials.mjs [references/GTNH]
// Needs: recex-2.8.4.json, itempanel.csv, icons/ (NEI dump) and gt-textures/ (from the GT jar).
// Writes: <dir>/materials.json { "<material id>": { name, set, color, from, err } }
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../promo/package.json', import.meta.url));
const { loadImage, createCanvas } = require('@napi-rs/canvas');

const dir = process.argv[2] ?? 'references/GTNH';
const TEX = path.join(dir, 'gt-textures/assets/gregtech/textures/items/materialicons');
const META = 'gregtech:gt.metaitem.01';

// Shapes (meta / 1000) that NEI shows, in the order we'd rather fit against, with their texture names.
const REFERENCE = [[2, 'dust'], [11, 'ingot'], [17, 'plate'], [8, 'gem'], [9, 'nugget'], [23, 'stick'], [29, 'foil'], [26, 'bolt']];

// ---------------------------------------------------------------- NEI dump: item key -> icon file
const parseCsv = (line) => {
  const out = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { out.push(cur); cur = ''; continue; } cur += ch; }
  out.push(cur); return out;
};
const illegal = new Set([...'<>:"/\\|?*'].map((c) => c.charCodeAt(0)));
const cleanName = (n) => [...n].map((ch) => (illegal.has(ch.charCodeAt(0)) || ch.charCodeAt(0) < 32 ? '_' : ch)).join('');
const iconOf = new Map();
{
  const seen = new Map();
  const rows = fs.readFileSync(path.join(dir, 'itempanel.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(parseCsv);
  for (const r of rows) {
    const base = cleanName(r.slice(4).join(','));
    const n = seen.get(base) ?? 1; seen.set(base, n + 1);
    const key = `${r[0]}:${r[2]}`;
    if (!iconOf.has(key)) iconOf.set(key, path.join(dir, 'icons', n > 1 ? `${base}_${n}.png` : `${base}.png`));
  }
}

// ---------------------------------------------------------------- materials used in recipes
const recex = JSON.parse(fs.readFileSync(path.join(dir, 'recex-2.8.4.json'), 'utf8'));
const materials = new Map(); // id -> name (from any item of it, e.g. "Iron Dust" -> "Iron")
const SHAPE_WORDS = /^(Tiny Pile of |Small Pile of |Impure Pile of |Purified Pile of |Crushed |Purified |Centrifuged |Hot )|( Dust| Ingot| Ore| Plate| Nugget| Rod| Foil| Bolt)$/g;
for (const m of recex.sources[0].machines) for (const r of m.recs) for (const i of [...r.iI, ...r.iO]) {
  if (i.id !== META || i.m >= 32000) continue;
  const id = i.m % 1000;
  if (!materials.has(id) || Math.floor(i.m / 1000) === 2) materials.set(id, i.lN.replace(SHAPE_WORDS, '').trim());
}

// ---------------------------------------------------------------- pixels
const pixelCache = new Map();
async function pixels(file, size = 16) {
  if (pixelCache.has(file)) return pixelCache.get(file);
  let out = null;
  if (fs.existsSync(file)) {
    const img = await loadImage(file);
    const c = createCanvas(size, size), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    // Animated textures are vertical strips: use the first square frame.
    g.drawImage(img, 0, 0, img.width, img.width, 0, 0, size, size);
    out = g.getImageData(0, 0, size, size).data;
  }
  pixelCache.set(file, out);
  return out;
}

const sets = fs.readdirSync(TEX).filter((s) => s !== 'CUSTOM' && fs.statSync(path.join(TEX, s)).isDirectory());

/** Best tint for a template against a dumped icon, and how far off the result is (0 = exact). */
function fit(base, overlay, icon) {
  let num = [0, 0, 0], den = 0;
  for (let p = 0; p < 256; p++) {
    const i = p * 4;
    if (base[i + 3] < 128 || icon[i + 3] < 128 || (overlay && overlay[i + 3] > 0)) continue;
    for (let ch = 0; ch < 3; ch++) num[ch] += icon[i + ch] * base[i + ch];
    den += (base[i] * base[i] + base[i + 1] * base[i + 1] + base[i + 2] * base[i + 2]) / 3;
  }
  if (!den) return null;
  const tint = num.map((v) => Math.min(255, Math.round((v / den) * 255)));
  let err = 0, n = 0;
  for (let p = 0; p < 256; p++) {
    const i = p * 4;
    const inBase = base[i + 3] >= 128 || (overlay && overlay[i + 3] >= 128), inIcon = icon[i + 3] >= 128;
    if (!inBase && !inIcon) continue;
    n++;
    if (inBase !== inIcon) { err += 255; continue; } // wrong shape
    const o = overlay && overlay[i + 3] > 0;
    for (let ch = 0; ch < 3; ch++) {
      const want = o ? overlay[i + ch] : (base[i + ch] * tint[ch]) / 255;
      err += Math.abs(want - icon[i + ch]) / 3;
    }
  }
  return { tint, err: err / n };
}

const customDirs = new Map(fs.readdirSync(path.join(TEX, 'CUSTOM')).map((d) => [d.toLowerCase().replace(/[^a-z0-9]/g, ''), d]));
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const result = {};
let fitted = 0, none = 0;
for (const [id, name] of [...materials].sort((a, b) => a[0] - b[0])) {
  // Every shape of this material that NEI shows: several styles share a dust template but differ
  // elsewhere (crushed ore, ingot), so a style has to match all of them.
  const refs = [];
  for (const [shape, tex] of REFERENCE) {
    const iconFile = iconOf.get(`${META}:${shape * 1000 + id}`);
    const icon = iconFile && (await pixels(iconFile));
    if (icon) refs.push({ tex, icon });
  }
  let best = null;
  for (const set of sets) {
    let total = 0, n = 0, tint = null;
    for (const { tex, icon } of refs) {
      const base = await pixels(path.join(TEX, set, `${tex}.png`));
      if (!base) { total += 255; n++; continue; }
      const f = fit(base, await pixels(path.join(TEX, set, `${tex}_OVERLAY.png`)), icon);
      if (!f) { total += 255; n++; continue; }
      total += f.err; n++;
      tint ??= f.tint; // colour from the first (most reliable) shape
    }
    if (!n || !tint) continue;
    const err = total / n;
    if (!best || err < best.err) best = { set, color: hex(tint), from: refs.map((r) => r.tex).join(','), err: Math.round(err * 10) / 10 };
  }
  // Materials drawn from their own textures (materialicons/CUSTOM/<name>/) rather than a style.
  const custom = customDirs.get(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (best && best.err > 20 && custom) best = { ...best, set: `CUSTOM/${custom}`, color: '#ffffff' };
  if (best) { result[id] = { name, ...best }; fitted++; } else { result[id] = { name, set: null }; none++; }
}

// Materials whose own items aren't GregTech's (vanilla or AE2): colour from that item's icon, on
// the plain dust style. Only the colour matters for their tiny and small piles.
const BORROWED = { 'Blaze Powder': 'minecraft:blaze_powder:0', 'Bone Meal': 'minecraft:dye:15', Sugar: 'minecraft:sugar:0', Gunpowder: 'minecraft:gunpowder:0', 'Charged Certus Quartz': 'appliedenergistics2:item.ItemMultiMaterial:1' };
for (const r of Object.values(result)) {
  const key = BORROWED[r.name];
  const icon = key && iconOf.get(key) && (await pixels(iconOf.get(key)));
  if (!icon || r.set) continue;
  const sum = [0, 0, 0]; let n = 0;
  for (let p = 0; p < 256; p++) if (icon[p * 4 + 3] >= 128) { for (let ch = 0; ch < 3; ch++) sum[ch] += icon[p * 4 + ch]; n++; }
  // The dust template averages about 70% grey, so scale the average colour up to match.
  if (n) Object.assign(r, { set: 'DULL', color: hex(sum.map((v) => Math.min(255, Math.round(v / n / 0.7)))), from: key, err: null });
}

fs.writeFileSync(path.join(dir, 'materials.json'), JSON.stringify(result, null, 1));
const errs = Object.values(result).filter((r) => r.set).map((r) => r.err).sort((a, b) => a - b);
console.log(`materials ${materials.size}: fitted ${fitted}, no reference icon ${none}`);
console.log(`fit error: median ${errs[errs.length >> 1]}, 90th pct ${errs[Math.floor(errs.length * 0.9)]}, worst ${errs.at(-1)}`);
