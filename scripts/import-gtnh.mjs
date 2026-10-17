// GT New Horizons import: Pack Extract dump -> public/data/recipes-gtnh.json.
//
// Input: a Pack Extract folder (the mod's own export, written to <.minecraft>/pack-extract/<run>/):
//   items.json, fluids.json            every item and fluid, with names and 64px icons (images/)
//   recipes/gregtech.json              GregTech recipe maps (chances, coil heat, tool slots)
//   recipes/gregtech-maps.json         recipe map ids and display names
//   recipes/smelting.json              the vanilla furnace list (run by Electric Furnaces)
// Default: the newest run in the Prism instance's pack-extract folder.
//
// Optional: references/GTNH/recex-2.8.4.json, the RecEx export the site used before. When present,
// recipes that match one in it keep its id (gtnh:<machine>/<n>), so saved flows still load.
//
// Writes:
//   public/data/recipes-gtnh.json        the recipe database (same shape as recipes.json)
//   public/data/recipes-gtnh-N.json      recipes, compact and split (see "write")
//   public/textures/gtnh/atlas-N.png     icons packed into sprite sheets (16px cells; refs "gtnh:atlas-N#i")
//   public/textures/gtnh/machines/*.png  machine pictures
//   public/data/packs.json               recipe count for the modpack menu
//
// Only items and fluids that a kept recipe uses are written.
//
// Usage: node --max-old-space-size=8192 scripts/import-gtnh.mjs [--extract <run folder>] [--legacy <recex.json>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../promo/package.json', import.meta.url));
const { loadImage, createCanvas } = require('@napi-rs/canvas');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const INSTANCE = path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'PrismLauncher/instances/GT_New_Horizons_2.8.4_Java_17-25/.minecraft');
const EXTRACT = arg('extract', (() => {
  const dir = path.join(INSTANCE, 'pack-extract');
  const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.existsSync(path.join(dir, f, 'manifest.json'))).sort() : [];
  return runs.length ? path.join(dir, runs.at(-1)) : null;
})());
if (!EXTRACT) throw new Error('no Pack Extract run found: pass --extract <folder>');
const LEGACY = arg('legacy', 'references/GTNH/recex-2.8.4.json');
const OUT = 'public';
const TEX_OUT = path.join(OUT, 'textures/gtnh');

const VOLTAGES = [['ULV', 8], ['LV', 32], ['MV', 128], ['HV', 512], ['EV', 2048], ['IV', 8192], ['LuV', 32768], ['ZPM', 131072], ['UV', 524288], ['UHV', 2097152], ['UEV', 8388608], ['UIV', 33554432], ['UXV', 134217728], ['OpV', 536870912], ['MAX', 2147483647]];
const tierOf = (eut) => (VOLTAGES.find(([, v]) => v >= eut) ?? VOLTAGES.at(-1))[0];

// Recipe tables that aren't production steps (or only list things for other systems).
const SKIP_MAPS = /^(Scanner|Replicator|Recycler|Furnace|Space Projects|Space Research|Radio Hatch Material List|Fluid Canner|Large Boiler|Semifluid Boiler Fuels|gt\.recipe\.multiblockrockbreaker|Research.*)$/;
// Tables listed under another name: the Assembly Line's recipes live in its NEI-only process table.
const RENAME_MAPS = { 'Assemblyline Process': 'Assembly Line' };
// Fuel tables: one cell (or 1000 mB) of fuel and its value in EU per mB.
const FUEL_MAPS = /Fuel|Fuels|Naquadah Reactor|RTG|Acid Generator/;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const readX = (f) => JSON.parse(fs.readFileSync(path.join(EXTRACT, f), 'utf8'));
console.log(`reading ${EXTRACT}...`);
const xItems = new Map(readX('items.json').map((i) => [i.id, i]));
const xFluids = new Map(readX('fluids.json').map((f) => [f.id, f]));
const xMaps = readX('recipes/gregtech-maps.json');
const xRecipes = readX('recipes/gregtech.json');
const xSmelting = readX('recipes/smelting.json');

// ---------------------------------------------------------------- names
// A few items have no translation and show their key ("tile.slabGCDouble.tinSlab.name"). Rebuild a
// name from the key: the last part in words, "Tin Slab", plus "(Double)" when the key says so.
const words = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
const title = (ws) => ws.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
function fixName(name) {
  if (!name || !/^(tile|item|fluid)\.|\.name$/.test(name)) return name;
  const parts = name.replace(/^(tile|item|fluid)\./, '').replace(/\.name$/, '').split('.').filter((p) => p && p !== 'null');
  if (!parts.length) return name;
  let k = parts.length - 1;
  while (k > 0 && /^\d+$/.test(parts[k])) k--;
  const num = parts.slice(k + 1).filter((p) => /^\d+$/.test(p));
  const main = title(words(parts[k]).filter((w) => w !== 'GC'));
  const double = parts.slice(0, k).some((p) => /double/i.test(p)) && !/double/i.test(main) ? ' (Double)' : '';
  return `${main}${num.length ? ` ${num.join(' ')}` : ''}${double}`;
}

// ---------------------------------------------------------------- atlas
// Every icon becomes a 16px cell, box-filtered down from the 64px render (flat items stay exact,
// 3D blocks get smooth edges).
const CELL = 16, PER_ROW = 64, PER_SHEET = PER_ROW * PER_ROW;
const cells = []; // { source }
const cellIndex = new Map();
function cellRef(file) {
  if (!cellIndex.has(file)) { cellIndex.set(file, cells.length); cells.push({ source: file }); }
  const i = cellIndex.get(file);
  return `gtnh:atlas-${Math.floor(i / PER_SHEET)}#${i % PER_SHEET}`;
}
const imageFile = (rel) => (rel ? path.join(EXTRACT, rel) : null);

// ---------------------------------------------------------------- items and fluids
// Ids as the site has always used them: "mod:item:meta", "fluid:<name>", "#mod:item:*" for "any
// variant". The extract marks NBT variants with "#hash"; when the kept recipes only ever use one
// variant of an item, the hash is dropped so the id matches the old RecEx one.
const items = {}; // id -> { name, color, unit, icon?, tag? }
const iconOf = new Map(); // site id -> image file, for colours
const counts = { maps: 0, skipped: 0, recipes: 0, fuels: 0, renamed: 0 };
const nbtVariants = new Map(); // base id -> Set of hashed ids used by kept recipes (filled in pass 1)
const plainUsed = new Set();
function siteItemId(xid) {
  if (xid.includes(':*')) return `#${xid.replace(/#.*$/, '')}`;
  const hash = xid.indexOf('#');
  if (hash < 0) return xid;
  const base = xid.slice(0, hash);
  return !plainUsed.has(base) && nbtVariants.get(base)?.size === 1 ? base : xid;
}
function addItem(ref) {
  const id = siteItemId(ref.item);
  if (items[id]) return id;
  if (id.startsWith('#')) {
    const first = xItems.get(ref.anyOf?.[0]) ?? xItems.get(ref.item.replace(/:\*.*$/, ':0'));
    const entry = { name: `${fixName(first?.name) ?? id.slice(1)} (any)`, color: '#94a3b8', unit: 'item', tag: true };
    if (first?.image) { entry.icon = [cellRef(imageFile(first.image))]; iconOf.set(id, imageFile(first.image)); }
    items[id] = entry;
    return id;
  }
  const x = xItems.get(ref.item);
  const name = fixName(x?.name) ?? ref.item;
  if (x && name !== x.name) counts.renamed++;
  const entry = { name, color: '#94a3b8', unit: 'item' };
  if (x?.image && fs.existsSync(imageFile(x.image))) { entry.icon = [cellRef(imageFile(x.image))]; iconOf.set(id, imageFile(x.image)); }
  items[id] = entry;
  return id;
}
function addFluid(name) {
  const id = `fluid:${name}`;
  if (items[id]) return id;
  const f = xFluids.get(name);
  const plain = !f?.color || f.color === '#ffffff';
  const entry = { name: fixName(f?.name) ?? name, color: plain ? '#5b8bd6' : f.color, unit: 'mB' };
  if (f?.image && fs.existsSync(imageFile(f.image))) {
    entry.icon = [cellRef(imageFile(f.image))];
    if (plain) iconOf.set(id, imageFile(f.image));
  }
  items[id] = entry;
  return id;
}
// Filled container -> its fluid, for fuel tables that list cells.
const fluidInContainer = new Map();
for (const f of xFluids.values()) for (const c of f.containers ?? []) if (!fluidInContainer.has(c.filled)) fluidInContainer.set(c.filled, { fluid: f.id, amount: c.amount });

// ---------------------------------------------------------------- old recipe ids
// The RecEx export listed recipes in a different order. Match each recipe to its RecEx twin by
// content and keep that number; new recipes are numbered after the old ones.
const sig = (inputs, outputs, eut, dur) => `${inputs.sort().join(',')}>${outputs.sort().join(',')}@${eut}/${dur}`;
const legacyIds = new Map(); // machine name -> Map(signature -> [numbers])
const legacyCount = new Map(); // machine name -> recipe count
if (fs.existsSync(LEGACY)) {
  console.log('reading the RecEx export for old recipe ids...');
  const recex = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  const rid = (i) => (i.m === 32767 ? `#${i.id}:*` : `${i.id}:${i.m}`);
  const add = (name, k, s) => { if (!legacyIds.has(name)) legacyIds.set(name, new Map()); const m = legacyIds.get(name); if (!m.has(s)) m.set(s, []); m.get(s).push(k); };
  for (const m of recex.sources[0].machines) {
    legacyCount.set(m.n, m.recs.length);
    m.recs.forEach((r, k) => add(m.n, k, sig([...r.iI.map((i) => `${rid(i)}*${i.a}`), ...r.fI.map((f) => `fluid:${f.id}*${f.a}`)], [...r.iO.map((o) => `${rid(o)}*${o.a}`), ...r.fO.map((f) => `fluid:${f.id}*${f.a}`)], r.eut, r.dur)));
  }
  const smelt = recex.sources.find((s) => s.type === 'smelting')?.recipes ?? [];
  legacyCount.set('#smelting', smelt.length);
  smelt.forEach((r, k) => r.input && r.output && add('#smelting', k, sig([`${rid(r.input)}*${r.input.a || 1}`], [`${rid(r.output)}*${r.output.a || 1}`], 0, 0)));
}
const newIds = new Map(); // machine name -> recipes numbered after the old ones
let oldIds = 0;
function recipeNumber(machine, s) {
  const hit = legacyIds.get(machine)?.get(s);
  if (hit?.length) { oldIds++; return hit.shift(); }
  const extra = newIds.get(machine) ?? 0;
  newIds.set(machine, extra + 1);
  return (legacyCount.get(machine) ?? 0) + extra;
}
// RecEx ids had no NBT hash and wrote "any variant" as meta 32767.
const legacyItem = (xid) => (xid.includes(':*') ? `#${xid.replace(/#.*$/, '')}` : xid.replace(/#.*$/, ''));

// ---------------------------------------------------------------- recipes and machines
const machines = {};
const recipes = [];
const madeWith = new Map(); // NBT variant -> the one fluid its recipe pours in (Tinkers bolts), for its type label
const byMap = new Map();
for (const r of xRecipes) { if (!byMap.has(r.map)) byMap.set(r.map, []); byMap.get(r.map).push(r); }
const keptMaps = xMaps.filter((m) => !SKIP_MAPS.test(m.name) && byMap.get(m.id)?.length);
counts.skipped = xMaps.length - keptMaps.length;

// Pass 1: which NBT variants do the kept recipes use? (decides whether a hash can be dropped)
{
  const note = (xid) => {
    if (!xid || xid.includes(':*')) return;
    const hash = xid.indexOf('#');
    if (hash < 0) { plainUsed.add(xid); return; }
    const base = xid.slice(0, hash);
    if (!nbtVariants.has(base)) nbtVariants.set(base, new Set());
    nbtVariants.get(base).add(xid);
  };
  for (const m of keptMaps) for (const r of byMap.get(m.id)) for (const x of [...r.inputs, ...r.outputs]) note(x.item);
  for (const r of xSmelting) { note(r.input?.item); note(r.output?.item); }
}

// Machine pictures: the machine block's own icon, found by name.
const MACHINE_MODS = /^(gregtech|miscutils|bartworks|tectech|GoodGenerator|kubatech|gtnhlanth|GalacticraftAmunRa|gtnhintergalactic|ggfab|gtnhcommunitymod)$/i;
const machineIcons = []; // [name, file, is a gt.blockmachines block]
for (const x of xItems.values()) if (x.isBlock && !x.id.includes('#') && MACHINE_MODS.test(x.mod) && x.image) machineIcons.push([x.name, imageFile(x.image), /gt\.blockmachines/.test(x.registryName)]);
machineIcons.sort((a, b) => Number(b[2]) - Number(a[2]));
// Tables whose machine block has another name.
const MACHINE_BLOCKS = {
  'Ore Washer': 'Basic Ore Washing Plant', 'Simple Dust Washer': 'Basic Ore Washing Plant', Milling: 'IsaMill Grinding Machine',
  'Fusion Reactor': 'Fusion Control Computer Mark I', 'Liquid Fluoride Thorium Reactor': 'Thorium Reactor [LFTR]', RTG: 'Radioisotope Thermoelectric Generator',
  'Isotope Decay': 'Radioisotope Thermoelectric Generator', 'Multiblock Mixer': 'Basic Mixer', 'Electromagnetic Polarizer': 'Basic Polarizer',
  'Matter Amplifier': 'Basic Amplifabricator', 'Mass Fabrication': 'Basic Mass Fabricator', 'QC Components': 'Quantum Computer',
  Degassing: 'Residual Decontaminant Degasser Purification Unit', 'LFTR Gas Sparging': 'Sparge Tower Controller',
  'Multiblock Dehydrator': 'Chemical Dehydrator I', 'Precise Assembler': 'Precise Auto-Assembler MT-3662',
  ...Object.fromEntries(['I', 'II', 'III', 'IV', 'V'].map((n) => [`Naquadah Reactor Mk${n}`, `Naquadah Reactor Mark ${n}`])),
};
/** Machine block icon: "Basic <name>" for tiered machines, else the name itself. */
function machineIcon(name) {
  const block = MACHINE_BLOCKS[name];
  if (block) { const hit = machineIcons.find(([n]) => n === block); if (hit) return { file: hit[1], tiered: /^Basic /.test(block) && !/^Multiblock /.test(name) }; }
  const lc = name.toLowerCase();
  const candidates = [`basic ${lc}`, lc, `industrial ${lc.replace(/^multiblock /, '')}`, `large ${lc}`, lc.replace(/^multiblock /, 'industrial ')];
  for (const c of candidates) { const hit = machineIcons.find(([n]) => n.toLowerCase() === c); if (hit) return { file: hit[1], tiered: c.startsWith('basic ') }; }
  const loose = machineIcons.find(([n]) => n.toLowerCase().includes(lc));
  return loose ? { file: loose[1], tiered: /^basic /i.test(loose[0]) } : null;
}

fs.rmSync(TEX_OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(TEX_OUT, 'machines'), { recursive: true });

for (const m of keptMaps) {
  const list = byMap.get(m.id);
  const display = RENAME_MAPS[m.name] ?? m.name;
  let type = slug(display);
  if (machines[type]) type = slug(m.id); // two maps with one name
  counts.maps++;
  const fuel = FUEL_MAPS.test(display) && list.every((r) => !r.duration);
  const icon = machineIcon(display.replace(/ Fuels?$/, '').replace(/^(Combustion|Gas Turbine|Semifluid|Plasma|Thermal) Generator.*$/, '$1 Generator'));
  let overlay;
  if (icon && fs.existsSync(icon.file)) {
    fs.copyFileSync(icon.file, path.join(TEX_OUT, 'machines', `${type}.png`));
    overlay = `textures/gtnh/machines/${type}.png`;
  }
  machines[type] = { name: display.replace(/ Fuels?$/, ''), kind: fuel ? 'generator' : icon?.tiered ? 'single' : 'multiblock', ...(icon && !icon.tiered && !fuel ? { multiblock: true } : {}), ...(overlay ? { overlay } : {}), ...(icon?.tiered ? { tiered: true } : {}) };

  for (const r of list) {
    if (!r.enabled) continue;
    const s = sig(
      [...r.inputs.map((i) => `${legacyItem(i.item)}*${i.amount}`), ...r.fluidInputs.map((f) => `fluid:${f.fluid}*${f.amount}`)],
      [...r.outputs.map((o) => `${legacyItem(o.item)}*${o.amount}`), ...r.fluidOutputs.map((f) => `fluid:${f.fluid}*${f.amount}`)],
      r.eut, r.duration,
    );
    const id = `gtnh:${type}/${recipeNumber(m.name, s)}`;
    if (fuel) {
      // Fuel value in EU per mB (or per item): a generator recipe burning 1000 mB, or one item.
      const value = r.metadata?.fuel_value ?? r.specialValue;
      if (!value) continue;
      const cell = r.inputs[0];
      const liquid = r.fluidInputs[0] ? { fluid: r.fluidInputs[0].fluid } : cell ? fluidInContainer.get(cell.item) ?? fluidInContainer.get(cell.item.replace(/#.*$/, '')) : null;
      const input = liquid ? { id: addFluid(liquid.fluid), amount: 1000 } : cell ? { id: addItem(cell), amount: cell.amount || 1 } : null;
      if (!input) continue;
      const eut = 32, ticks = Math.max(1, Math.round((1000 * value) / eut));
      recipes.push({ id, type, source: 'gtceu', tier: 'LV', eut, ticks, inputs: [input], outputs: [], gen: true });
      counts.fuels++;
      continue;
    }
    const inputs = [], outputs = [];
    let circuit;
    for (const i of r.inputs) {
      if (/^gregtech:gt\.integrated_circuit:/.test(i.item)) { circuit = Number(i.item.split(':')[2]); continue; }
      const id = addItem(i), kept = i.consumed === false || i.amount === 0;
      const same = inputs.find((x) => x.id === id && (x.consumed === false) === kept);
      if (same) { same.amount += i.amount || 1; continue; } // Assembly Line slots can repeat an item
      inputs.push({ id, amount: i.amount || 1, ...(kept ? { consumed: false } : {}) });
    }
    for (const f of r.fluidInputs) inputs.push({ id: addFluid(f.fluid), amount: f.amount });
    for (const o of r.outputs) if (o.item.includes('#') && r.fluidInputs.length === 1) madeWith.set(siteItemId(o.item), r.fluidInputs[0].fluid);
    for (const o of r.outputs) outputs.push({ id: addItem(o), amount: o.amount, ...(o.chance != null && o.chance < 1 ? { chance: o.chance } : {}) });
    for (const f of r.fluidOutputs) outputs.push({ id: addFluid(f.fluid), amount: f.amount });
    if (!outputs.length) continue;
    const heat = r.metadata?.coil_heat ?? (r.specialValue && /Blast Furnace|Alloy Blast|Plasma Forge|DTPF/i.test(m.name) ? r.specialValue : 0);
    recipes.push({
      id, type, source: 'gtceu', tier: tierOf(r.eut), eut: r.eut, ticks: Math.max(1, r.duration), inputs, outputs,
      ...(circuit != null ? { circuit } : {}),
      ...(heat ? { temp: heat } : {}),
    });
    counts.recipes++;
  }
}

// ---------------------------------------------------------------- furnace recipes
// GregTech's Furnace table is empty in GTNH: electric furnaces run the vanilla smelting list.
// Electric Furnace: 4 EU/t, 128 ticks (6.4 s) at its base tier.
{
  const icon = machineIcon('Electric Furnace');
  if (icon) fs.copyFileSync(icon.file, path.join(TEX_OUT, 'machines', 'electric_furnace.png'));
  machines.electric_furnace = { name: 'Electric Furnace', kind: 'single', tiered: true, ...(icon ? { overlay: 'textures/gtnh/machines/electric_furnace.png' } : {}) };
  for (const r of xSmelting) {
    if (!r.input || !r.output) continue;
    const n = recipeNumber('#smelting', sig([`${legacyItem(r.input.item)}*${r.input.amount || 1}`], [`${legacyItem(r.output.item)}*${r.output.amount || 1}`], 0, 0));
    recipes.push({ id: `gtnh:electric_furnace/${n}`, type: 'electric_furnace', source: 'gtceu', tier: 'ULV', eut: 4, ticks: 128, inputs: [{ id: addItem(r.input), amount: r.input.amount || 1 }], outputs: [{ id: addItem(r.output), amount: r.output.amount || 1 }] });
    counts.recipes++;
  }
  counts.smelting = xSmelting.length;
}

// ---------------------------------------------------------------- drop cell recipes
// GregTech 5 doubles many recipes with cells (a filled cell in, an empty cell out). In GTNH you pipe
// fluids, and every one of these has a fluid twin, so the cell versions only send Best Route off
// through canning and compressing cells.
const isCell = (id) => {
  const it = items[id];
  return it && it.unit === 'item' && / Cell$/.test(it.name)
    && /(gt\.metaitem\.(01|99)|bwMetaGeneratedcell|IC2:itemCell|IC2:itemFluidCell|miscutils:|gtnhlanth|GoodGenerator)/i.test(id)
    && !/(Fuel|Solar|Power|Energy|Lapotronic|Battery|Ender|Fusion)/i.test(it.name);
};
{
  const before = recipes.length;
  for (let k = recipes.length - 1; k >= 0; k--) {
    const r = recipes[k];
    if (!r.gen && [...r.inputs, ...r.outputs].some((x) => isCell(x.id))) recipes.splice(k, 1);
  }
  counts.cellRecipes = before - recipes.length;
  counts.recipes -= counts.cellRecipes;
  // Items that only those recipes used go too.
  const used = new Set(recipes.flatMap((r) => [...r.inputs, ...r.outputs].map((x) => x.id)));
  for (const id of Object.keys(items)) if (!used.has(id)) delete items[id];
}

// ---------------------------------------------------------------- GregTech chains only
// Keep a recipe when it makes something from GregTech or its addons (or a fluid, or power), or
// makes something a kept recipe uses, repeated until nothing changes. Tinkers parts cast in a
// Fluid Solidifier, TGregworks tool parts and other dead ends that never feed a GregTech line go.
const GT_FAMILY = /^(gregtech|bartworks|miscutils|dreamcraft|gtnhlanth|GoodGenerator|tectech|ggfab|kubatech|gtnhintergalactic|kekztech)$/;
{
  const before = recipes.length;
  const isGT = (id) => id.startsWith('fluid:') || GT_FAMILY.test(id.replace(/^#/, '').split(':')[0]);
  const anyOf = (id) => `#${id.replace(/#.*$/, '').replace(/:[^:]*$/, '')}`; // "mod:item:3" -> "#mod:item"
  const keep = recipes.map((r) => !!(r.gen || r.outputs.some((o) => isGT(o.id))));
  const needed = new Set();
  // Breaking one item back down (macerating, arc or alloy smelting, melting) takes almost anything,
  // so it doesn't make that item worth keeping.
  const BREAKDOWN = new Set(['macerator', 'arc_furnace', 'plasma_arc_furnace', 'fluid_extractor', 'extractor', 'alloy_smelter', 'electric_furnace']);
  const need = (r) => {
    const solids = r.inputs.filter((i) => i.consumed !== false && !i.id.startsWith('fluid:'));
    if (BREAKDOWN.has(r.type) && solids.length <= 1) return;
    for (const i of r.inputs) needed.add(i.id);
  };
  recipes.forEach((r, k) => { if (keep[k]) need(r); });
  for (let changed = true; changed;) {
    changed = false;
    recipes.forEach((r, k) => {
      if (keep[k] || !r.outputs.some((o) => needed.has(o.id) || needed.has(anyOf(o.id)))) return;
      keep[k] = true;
      need(r);
      changed = true;
    });
  }
  const dropped = {};
  recipes.forEach((r, k) => { if (!keep[k]) { const mod = r.outputs[0]?.id.split(':')[0] ?? '?'; dropped[mod] = (dropped[mod] ?? 0) + 1; } });
  const kept = recipes.filter((_, k) => keep[k]);
  recipes.length = 0;
  for (const r of kept) recipes.push(r);
  counts.notGregTech = before - recipes.length;
  counts.recipes -= counts.notGregTech;
  console.log(`dropped ${counts.notGregTech} recipes outside GregTech chains: ${Object.entries(dropped).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([m, n]) => `${m} ${n}`).join(', ')}`);
  const used = new Set(recipes.flatMap((r) => [...r.inputs, ...r.outputs].map((x) => x.id)));
  for (const id of Object.keys(items)) if (!used.has(id)) delete items[id];
  const types = new Set(recipes.map((r) => r.type));
  for (const t of Object.keys(machines)) if (!types.has(t)) delete machines[t];
}

// ---------------------------------------------------------------- types of the same item
// Many items share a name (Iron Ore on stone, basalt, Mars, Mercury...). Each gets a type label in
// its name, and group/variant so the site can show them as one entry with a type picker.
// NBT variants of one item: name them by the fluid they were cast from, else by their NBT values.
function nbtLabel(id) {
  if (!id.includes('#') || id.startsWith('#')) return null;
  const fluid = madeWith.get(id);
  if (fluid) return (xFluids.get(fluid)?.name ?? fluid).replace(/^Molten /, '');
  const nbt = xItems.get(id)?.nbt;
  if (!nbt) return null;
  // GregTech tools and turbines: "Iron / Steel" (head / handle material).
  const head = /PrimaryMaterial:"([^"]+)"/.exec(nbt)?.[1], handle = /SecondaryMaterial:"([^"]+)"/.exec(nbt)?.[1];
  const ench = /\bench:/.test(nbt) ? ', enchanted' : '';
  if (head) return `${title(words(head))}${handle ? ` / ${title(words(handle))}` : ''}${ench}`;
  const strings = [...nbt.matchAll(/"([^"]+)"/g)].map((m) => title(words(m[1])));
  if (strings.length) return strings.slice(0, 2).join(' / ') + ench;
  return words(nbt.replace(/(\d)[dfbsL]\b/g, '$1')).slice(0, 6).join(' ') || null;
}
const STONES = ['Stone', 'Netherrack', 'End Stone', 'Black Granite', 'Red Granite', 'Marble', 'Basalt'];
function variantLabel(id, name) {
  const [mod, pth = '', meta = '0'] = id.split(':');
  if (/^gregtech$/.test(mod) && /blockores/.test(pth)) return STONES[Math.floor((Number(meta) % 16000) / 1000)] ?? `Type ${meta}`;
  if (mod === 'minecraft') return 'Vanilla';
  const nameWords = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const drop = new Set(nameWords.concat(['tile', 'block', 'blocks', 'multi', 'ore', 'ores', 'item', 'items', 'gt', 'meta']));
  const label = pth.replace(/^tile\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/)
    .map((w) => {
      // "mercuryblocks" -> "mercury", "Eoreiron" -> "E": drop suffixes and the item's own words
      let x = w.replace(/(blocks?|ores?)$/i, '');
      for (const nw of [...nameWords, 'ore']) if (nw.length > 2 && x.toLowerCase() !== nw) x = x.replace(new RegExp(nw, 'i'), '');
      return x;
    })
    .filter((w) => w && !drop.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').trim();
  return label || mod;
}
{
  const groups = new Map();
  for (const [id, it] of Object.entries(items)) {
    if (it.unit !== 'item' || it.tag) continue;
    if (!groups.has(it.name)) groups.set(it.name, []);
    groups.get(it.name).push(id);
  }
  let grouped = 0;
  for (const [name, ids] of groups) {
    if (ids.length < 2) continue;
    const labels = ids.map((id) => nbtLabel(id) ?? variantLabel(id.replace(/#.*$/, ''), name));
    // Still clashing within the group: add the mod, then the item's number.
    const seen = new Map(); labels.forEach((l) => seen.set(l, (seen.get(l) ?? 0) + 1));
    const modName = (id) => id.split(':')[0].replace(/^Galacticraft(?=[A-Z])/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    const final = ids.map((id, k) => (seen.get(labels[k]) > 1 && !id.startsWith('gregtech:') ? `${labels[k]} · ${modName(id)}` : labels[k]));
    const again = new Map(); final.forEach((l) => again.set(l, (again.get(l) ?? 0) + 1));
    ids.forEach((id, k) => {
      const label = again.get(final[k]) > 1 ? `${labels[k]} #${id.split(':').pop().replace(/#.*$/, '')}` : final[k];
      Object.assign(items[id], { name: `${name} (${label})`, group: name, variant: label });
    });
    grouped++;
  }
  counts.groups = grouped;
}

// ---------------------------------------------------------------- draw the atlases
// Only cells of items still listed, renumbered so the sheets have no gaps.
{
  const files = new Map(); // old ref -> file
  for (const [file, i] of cellIndex) files.set(`gtnh:atlas-${Math.floor(i / PER_SHEET)}#${i % PER_SHEET}`, file);
  cells.length = 0; cellIndex.clear();
  // NBT variants (thousands of Tinkers bolts) go last, on sheets normal use never loads.
  const order = Object.entries(items).filter(([, it]) => it.icon).sort(([a], [b]) => Number(a.includes('#') && !a.startsWith('#')) - Number(b.includes('#') && !b.startsWith('#')));
  for (const [, it] of order) it.icon[0] = cellRef(files.get(it.icon[0]));
}
console.log(`drawing ${cells.length} icon cells...`);
const iconColor = new Map(); // file -> average colour
const sheets = Math.ceil(cells.length / PER_SHEET);
for (let s = 0; s < sheets; s++) {
  const n = Math.min(PER_SHEET, cells.length - s * PER_SHEET);
  const rows = Math.ceil(n / PER_ROW);
  const W = PER_ROW * CELL;
  const canvas = createCanvas(W, rows * CELL), g = canvas.getContext('2d');
  const out = g.createImageData(W, rows * CELL);
  for (let k = 0; k < n; k++) {
    const file = cells[s * PER_SHEET + k].source;
    const img = await loadImage(file).catch(() => null);
    if (!img) continue;
    const w = img.width, f = Math.max(1, Math.floor(w / CELL));
    const src = createCanvas(w, w), sg = src.getContext('2d');
    sg.drawImage(img, 0, 0, w, w, 0, 0, w, w); // first frame of animated strips
    const d = sg.getImageData(0, 0, w, w).data;
    const x0 = (k % PER_ROW) * CELL, y0 = Math.floor(k / PER_ROW) * CELL;
    let cr = 0, cg = 0, cb = 0, cn = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      // Box filter, alpha-weighted so edges don't darken.
      let r = 0, gg = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
        const p = ((y * f + dy) * w + (x * f + dx)) * 4, al = d[p + 3];
        r += d[p] * al; gg += d[p + 1] * al; b += d[p + 2] * al; a += al;
      }
      if (!a) continue;
      const q = ((y0 + y) * W + x0 + x) * 4, alpha = a / (f * f);
      out.data[q] = r / a; out.data[q + 1] = gg / a; out.data[q + 2] = b / a; out.data[q + 3] = alpha;
      if (alpha > 128) { cr += r / a; cg += gg / a; cb += b / a; cn++; }
    }
    if (cn) iconColor.set(file, '#' + [cr, cg, cb].map((v) => Math.round(v / cn).toString(16).padStart(2, '0')).join(''));
  }
  g.putImageData(out, 0, 0);
  fs.writeFileSync(path.join(TEX_OUT, `atlas-${s}.png`), canvas.encodeSync('png'));
}
for (const [id, file] of iconOf) if (items[id] && iconColor.has(file)) items[id].color = iconColor.get(file);

// ---------------------------------------------------------------- write
const manifest = readX('manifest.json');
const data = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gtceuVersion: `GT5-Unofficial (GTNH 2.8.4, ${manifest.generator})`,
  sources: { kubejs: 0, gtceu: recipes.length, builtin: 0, removedByPack: 0, hasDump: true },
  tierCasings: {},
  machines,
  items,
};
// Compact, split recipes: items and machine types by number, recipes in parallel chunk files.
// recipes-gtnh.json carries the index lists; src/recipeData.ts (expandPacked) turns it back.
const itemIndex = Object.keys(items), itemNo = new Map(itemIndex.map((id, k) => [id, k]));
const typeIndex = Object.keys(machines), typeNo = new Map(typeIndex.map((t, k) => [t, k]));
const pack = (r) => {
  const n = Number(r.id.slice(r.id.lastIndexOf('/') + 1));
  const io = (list) => list.map((x) => {
    const row = [itemNo.get(x.id), x.amount];
    if (x.chance != null) row.push(x.chance); else if (x.consumed === false) row.push(0);
    return row;
  });
  return { t: typeNo.get(r.type), n, e: r.eut, d: r.ticks, i: io(r.inputs), o: io(r.outputs), ...(r.circuit != null ? { c: r.circuit } : {}), ...(r.temp ? { h: r.temp } : {}), ...(r.gen ? { g: 1 } : {}) };
};
const PARTS = 6;
const per = Math.ceil(recipes.length / PARTS);
for (const f of fs.readdirSync(path.join(OUT, 'data'))) if (/^recipes-gtnh-\d+\.json$/.test(f)) fs.rmSync(path.join(OUT, 'data', f));
for (let k = 0; k < PARTS; k++) fs.writeFileSync(path.join(OUT, `data/recipes-gtnh-${k}.json`), JSON.stringify(recipes.slice(k * per, (k + 1) * per).map(pack)));
fs.writeFileSync(path.join(OUT, 'data/recipes-gtnh.json'), JSON.stringify({ ...data, packed: { parts: PARTS, file: 'data/recipes-gtnh-{k}.json', items: itemIndex, types: typeIndex, idPrefix: 'gtnh:' } }));
const packsFile = path.join(OUT, 'data/packs.json');
const packs = fs.existsSync(packsFile) ? JSON.parse(fs.readFileSync(packsFile, 'utf8')) : {};
packs.gtnh = { recipes: recipes.length, generatedAt: data.generatedAt };
fs.writeFileSync(packsFile, JSON.stringify(packs, null, 2) + '\n');

const all = Object.values(items);
const withIcon = all.filter((i) => i.icon).length;
console.log(`maps ${counts.maps} (skipped ${counts.skipped}), recipes ${counts.recipes} + fuels ${counts.fuels}, incl. ${counts.smelting} furnace (dropped ${counts.cellRecipes} cell recipes)`);
console.log(`old recipe ids kept ${oldIds}, new ${[...newIds.values()].reduce((a, b) => a + b, 0)} (before dropping cell recipes)`);
console.log(`names rebuilt from keys ${counts.renamed}, same-name groups ${counts.groups}`);
console.log(`items+fluids ${all.length}, with icons ${withIcon} (${((100 * withIcon) / all.length).toFixed(1)}%), atlas sheets ${sheets}`);
console.log(`machines ${Object.keys(machines).length}, with pictures ${Object.values(machines).filter((m) => m.overlay).length}`);
const sizes = ['recipes-gtnh.json', ...Array.from({ length: PARTS }, (_, k) => `recipes-gtnh-${k}.json`)].map((f) => fs.statSync(path.join(OUT, 'data', f)).size);
console.log(`data files: ${sizes.map((b) => (b / 1048576).toFixed(1)).join(' + ')} MB`);
