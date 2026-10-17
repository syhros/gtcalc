#!/usr/bin/env node
// Imports GregTech machine recipes from the Sky Greg modpack into public/data/recipes.json
// and copies the machine textures used by the calculator into public/textures/.
//
// Sources:
//   1. KubeJS scripts (kubejs/startup_scripts + kubejs/server_scripts) — the pack's own
//      recipes, evaluated exactly as written (see lib/kubejs-sandbox.mjs).
//   2. Optional GTCEu recipe dump — every base GregTech recipe. GTCEu generates these in
//      Java at load time, so they only exist on disk after enabling `dumpRecipes: true`
//      in config/gtceu.yaml and loading a world once. The pack's `event.remove(...)`
//      calls are applied to these.
//   3. Mod jars — English names (lang files) and machine/casing/fluid textures.
//
// Usage:
//   node scripts/import-recipes.mjs [--instance "<modpack instance dir>"] [--dump "<dir>"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipFile } from './lib/zip.mjs';
import { averagePngColor } from './lib/png.mjs';
import { runKubeJS } from './lib/kubejs-sandbox.mjs';
import { BUILTIN_RECIPES } from './data/builtin-gtceu-recipes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const instanceDir = path.resolve(arg('instance') ?? path.resolve(rootDir, 'references/Sky Greg'));
const outDir = path.resolve(arg('out') ?? path.join(rootDir, 'public'));
// --profile base: plain GTCEu (the dump's gtceu recipes only, no pack scripts or addon mods),
// written to data/recipes-base.json for the "Base GregTech" option in the app.
const profile = arg('profile') === 'base' ? 'base' : 'skygreg';
// --export <dir>: take the recipes from a Pack Extract export of the pack instead of the GTCEu
// dump and the KubeJS scripts (which are still read for machines, materials and textures).
const exportDir = arg('export') ? path.resolve(arg('export')) : null;

function firstExisting(...candidates) {
  return candidates.find((p) => p && fs.existsSync(p));
}

const kubejsDir = firstExisting(path.join(instanceDir, 'kubejs'), path.join(instanceDir, 'overrides', 'kubejs'));
if (!kubejsDir) {
  console.error(`No kubejs folder found in ${instanceDir}`);
  process.exit(1);
}
const modsDir = firstExisting(path.join(instanceDir, 'mods'));
const dumpArg = arg('dump');
// A copied instance keeps CurseForge's minecraftinstance.json, which points at the live
// install. Check there too so a dump made in game is picked up without copying it.
let liveInstanceDir = null;
try {
  const meta = JSON.parse(fs.readFileSync(path.join(instanceDir, 'minecraftinstance.json'), 'utf8'));
  if (meta.installPath) liveInstanceDir = meta.installPath;
} catch { /* not a CurseForge instance */ }
// Copies of the live instance (e.g. "Sky Greg - Test") are checked as well.
const siblingDumps = [];
if (liveInstanceDir && fs.existsSync(path.dirname(liveInstanceDir))) {
  const base = path.basename(liveInstanceDir.replace(/[\\/]+$/, ''));
  for (const name of fs.readdirSync(path.dirname(liveInstanceDir))) {
    if (name !== base && name.startsWith(base)) siblingDumps.push(path.join(path.dirname(liveInstanceDir), name, 'gtceu', 'dumped', 'data'));
  }
}
const dumpRoot = firstExisting(
  dumpArg && path.resolve(dumpArg),
  path.join(instanceDir, 'gtceu', 'dumped', 'data'),
  liveInstanceDir && path.join(liveInstanceDir, 'gtceu', 'dumped', 'data'),
  ...siblingDumps,
);

console.log(`Instance: ${instanceDir}`);
console.log(`KubeJS:   ${kubejsDir}`);
console.log(`Mods:     ${modsDir ?? '(none — names/textures will be approximate)'}`);
console.log(`GT dump:  ${dumpRoot ?? '(none — base GTCEu recipes not included)'}`);

// ---------------------------------------------------------------- constants
const V = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608, 33554432, 134217728, 536870912, 2147483647];
const TIERS = ['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UXV', 'OpV', 'MAX'];

// GTCEu recipe types whose only machine is a multiblock.
const GT_MULTIBLOCK_TYPES = new Set([
  'electric_blast_furnace', 'primitive_blast_furnace', 'coke_oven', 'pyrolyse_oven', 'cracker',
  'distillation_tower', 'implosion_compressor', 'vacuum_freezer', 'large_chemical_reactor',
  'assembly_line', 'fusion_reactor', 'large_boiler', 'research_station', 'alloy_blast_smelter',
  'air_scrubber', 'evaporation_plant',
]);
// GTCEu recipe types that produce EU.
const GT_GENERATOR_TYPES = new Set(['combustion_generator', 'gas_turbine', 'steam_turbine', 'plasma_generator', 'steam_boiler']);

// Large boilers (GTCEu 7.5.3 LargeBoilerMachine): at full temperature and 100% throttle, every
// 5 ticks they drain floor(maxTemp * 5 / steamPerWater) water and make that x steamPerWater
// steam. Fuel burns for the recipe's duration whatever the boiler (the throttle scales steam
// and burn time together), so the steam made per fuel item depends only on the boiler type.
const gtceuYaml = (() => {
  for (const dir of [instanceDir, path.join(instanceDir, 'overrides')]) {
    const f = path.join(dir, 'config', 'gtceu.yaml');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  }
  return '';
})();
const yamlInt = (key, fallback) => {
  const m = new RegExp(`^\\s*${key}:\\s*(\\d+)`, 'm').exec(gtceuYaml);
  return m ? Number(m[1]) : fallback;
};
const STEAM_PER_WATER = yamlInt('steamPerWater', 160);
const boilerWaterPerTick = (maxTemp) => Math.floor((maxTemp * 5) / STEAM_PER_WATER) / 5;
const LARGE_BOILERS = [
  { id: 'bronze_large_boiler', mat: 'bronze', maxTemp: yamlInt('bronzeBoilerMaxTemperature', 800), casing: 'gtceu:block/casings/solid/machine_casing_bronze_plated_bricks' },
  { id: 'steel_large_boiler', mat: 'steel', maxTemp: yamlInt('steelBoilerMaxTemperature', 1800), casing: 'gtceu:block/casings/solid/machine_casing_solid_steel' },
  { id: 'titanium_large_boiler', mat: 'titanium', maxTemp: yamlInt('titaniumBoilerMaxTemperature', 3200), casing: 'gtceu:block/casings/solid/machine_casing_stable_titanium' },
  { id: 'tungstensteel_large_boiler', mat: 'tungstensteel', maxTemp: yamlInt('tungstensteelBoilerMaxTemperature', 6400), casing: 'gtceu:block/casings/solid/machine_casing_robust_tungstensteel' },
];
// Recipe amounts are written for the bronze boiler; other boilers scale water and steam.
const BOILER_BASE_WATER = boilerWaterPerTick(LARGE_BOILERS[0].maxTemp);

// Texture directory aliases where the recipe type and the texture folder differ.
const OVERLAY_ALIASES = {
  cracker: ['gtceu:block/multiblock/cracking_unit'],
  combustion_generator: ['gtceu:block/generators/combustion'],
  gas_turbine: ['gtceu:block/generators/gas_turbine'],
  steam_turbine: ['gtceu:block/generators/steam_turbine'],
  plasma_generator: ['gtceu:block/multiblock/generator/large_plasma_turbine'],
  large_boiler: ['gtceu:block/multiblock/generator/large_steel_boiler'],
  steam_boiler: ['gtceu:block/generators/boiler/coal'],
  alloy_blast_smelter: ['gtceu:block/multiblock/gcym/blast_alloy_smelter'],
};
const MULTIBLOCK_CASINGS = {
  electric_blast_furnace: 'gtceu:block/casings/solid/machine_casing_heatproof',
  distillation_tower: 'gtceu:block/casings/solid/machine_casing_clean_stainless_steel',
  cracker: 'gtceu:block/casings/solid/machine_casing_clean_stainless_steel',
  pyrolyse_oven: 'gtceu:block/casings/voltage/ulv/side',
  vacuum_freezer: 'gtceu:block/casings/solid/machine_casing_frost_proof',
  large_chemical_reactor: 'gtceu:block/casings/solid/machine_casing_inert_ptfe',
  coke_oven: 'gtceu:block/casings/solid/machine_coke_bricks',
  primitive_blast_furnace: 'gtceu:block/casings/solid/machine_primitive_bricks',
  alloy_blast_smelter: 'gtceu:block/casings/gcym/high_temperature_smelting_casing',
  large_boiler: 'gtceu:block/casings/solid/machine_casing_solid_steel',
  plasma_generator: 'gtceu:block/casings/mechanic/machine_casing_turbine_tungstensteel',
};
const DEFAULT_MULTI_CASING = 'gtceu:block/casings/solid/machine_casing_solid_steel';

// Machines that can burn each GT fuel recipe type (GTCEu 7.5.3: GTMachines / GTMultiMachines).
// Single-block generators exist for LV-HV only. Engine/turbine maths: see src/solver.ts.
const GENERATOR_VARIANTS = {
  combustion_generator: [
    { id: 'combustion_generator', kind: 'single', maxTier: 'HV' },
    { id: 'large_combustion_engine', kind: 'engine', tier: 'EV', boost: { fluid: 'gtceu:oxygen', perTick: 1, factor: 1.5 },
      overlay: 'gtceu:block/multiblock/generator/large_combustion_engine', casing: 'gtceu:block/casings/solid/machine_casing_stable_titanium' },
    { id: 'extreme_combustion_engine', kind: 'engine', tier: 'IV', boost: { fluid: 'gtceu:liquid_oxygen', perTick: 4, factor: 2 },
      overlay: 'gtceu:block/multiblock/generator/extreme_combustion_engine', casing: 'gtceu:block/casings/solid/machine_casing_robust_tungstensteel' },
  ],
  gas_turbine: [
    { id: 'gas_turbine', kind: 'single', maxTier: 'HV' },
    { id: 'gas_large_turbine', kind: 'turbine', tier: 'EV',
      overlay: 'gtceu:block/multiblock/generator/large_gas_turbine', casing: 'gtceu:block/casings/mechanic/machine_casing_turbine_stainless_steel' },
  ],
  steam_turbine: [
    { id: 'steam_turbine', kind: 'single', maxTier: 'HV' },
    { id: 'steam_large_turbine', kind: 'turbine', tier: 'HV',
      overlay: 'gtceu:block/multiblock/generator/large_steam_turbine', casing: 'gtceu:block/casings/mechanic/machine_casing_turbine_steel' },
  ],
  large_boiler: LARGE_BOILERS.map((b) => ({
    id: b.id, kind: 'boiler', steamScale: boilerWaterPerTick(b.maxTemp) / BOILER_BASE_WATER,
    steamPerTick: boilerWaterPerTick(b.maxTemp) * STEAM_PER_WATER,
    overlay: `gtceu:block/multiblock/generator/large_${b.mat}_boiler`, casing: b.casing,
  })),
  plasma_generator: [
    { id: 'plasma_large_turbine', kind: 'turbine', tier: 'IV',
      overlay: 'gtceu:block/multiblock/generator/large_plasma_turbine', casing: 'gtceu:block/casings/mechanic/machine_casing_turbine_tungstensteel' },
  ],
};
const GT_ITEM_NAMESPACES = new Set(['gtceu', 'kubejs', 'gttruesteam']);

// ---------------------------------------------------------------- jars + lang
const jars = [];
let gtJar = null;
if (modsDir) {
  for (const f of fs.readdirSync(modsDir)) {
    if (!f.endsWith('.jar')) continue;
    try {
      const z = new ZipFile(path.join(modsDir, f));
      jars.push(z);
      if (/^gtceu-1\.20\.1-[\d.]+\.jar$/.test(f)) gtJar = z;
    } catch (e) {
      console.warn(`  skipped ${f}: ${e.message}`);
    }
  }
}
const gtVersion = gtJar ? /gtceu-1\.20\.1-([\d.]+)\.jar/.exec(path.basename(gtJar.path))[1] : null;

const lang = {};
const parseJsonLoose = (text) => JSON.parse(text.replace(/^﻿/, ''));
for (const z of jars) {
  for (const name of z.names()) {
    if (!/^assets\/[^/]+\/lang\/en_us\.json$/.test(name)) continue;
    try { Object.assign(lang, parseJsonLoose(z.readText(name))); } catch { /* malformed lang file */ }
  }
}
// GTCEu last so its keys win over addons that override them by accident.
if (gtJar) Object.assign(lang, parseJsonLoose(gtJar.readText('assets/gtceu/lang/en_us.json')));
const kubeAssets = path.join(kubejsDir, 'assets');
if (fs.existsSync(kubeAssets)) {
  for (const ns of fs.readdirSync(kubeAssets)) {
    const p = path.join(kubeAssets, ns, 'lang', 'en_us.json');
    if (fs.existsSync(p)) {
      try { Object.assign(lang, parseJsonLoose(fs.readFileSync(p, 'utf8'))); } catch { /* ignore */ }
    }
  }
}
const clean = (s) => String(s).replace(/§./g, '').trim();
const L = (key) => (lang[key] != null ? clean(lang[key]) : null);

// ---------------------------------------------------------------- KubeJS
console.log('Evaluating KubeJS scripts...');
const kjs = runKubeJS(kubejsDir);
if (profile === 'base') {
  // Keep the script run for nothing but ignore everything the pack adds or changes.
  kjs.recipes = [];
  kjs.removals = [];
  kjs.replacements = [];
  kjs.registry = [];
  console.log('  profile "base": pack scripts ignored');
}
console.log(`  ${kjs.files.startup} startup + ${kjs.files.server} server scripts, ${kjs.recipes.length} GT recipes, ${kjs.removals.length} removals`);
if (kjs.errors.length) {
  console.warn(`  ${kjs.errors.length} script errors (recipes before the error are kept):`);
  for (const e of kjs.errors) console.warn(`    ${path.relative(kubejsDir, e.where)}: ${e.message}`);
}

// Startup registrations
const recipeTypeIO = {};
const kubeMachines = [];
const kubeMaterials = {};
const kubeNames = {};
for (const reg of kjs.registry) {
  const call = (m) => reg.calls.find((c) => c[0] === m);
  if (reg.registry === 'gtceu:recipe_type') {
    const io = call('setEUIO');
    recipeTypeIO[reg.name] = io ? String(io[1][0]) : 'in';
  } else if (reg.registry === 'gtceu:machine') {
    const typeCalls = reg.calls.filter((c) => c[0] === 'recipeType' || c[0] === 'recipeTypes');
    const types = kjs.collectStrings(typeCalls.map((c) => c[1])).map((s) => s.replace(/^gtceu:/, ''));
    const texStrings = kjs.collectStrings(reg.calls.filter((c) => /model|renderer/i.test(c[0])).map((c) => c[1]))
      .filter((s) => s.includes('block/'))
      .map((s) => s.replace(/^gtceu:(?=[a-z_]+:)/, '')); // GTCEu.id("minecraft:...") quirk
    const holeNames = (v, out = []) => {
      if (Array.isArray(v)) v.forEach((x) => holeNames(x, out));
      else { const n = kjs.holeName(v); if (n) out.push(n); }
      return out;
    };
    const modifiers = holeNames(reg.calls.filter((c) => /^recipeModifiers?$/.test(c[0])).map((c) => c[1]));
    kubeMachines.push({
      name: reg.name, kind: reg.kind, types, textures: texStrings,
      displayName: kjs.collectStrings(call('langValue')?.[1] ?? [])[0],
      parallel: modifiers.some((m) => /PARALLEL_HATCH/.test(m)),
    });
  } else if (reg.registry === 'gtceu:material') {
    const c = call('color');
    kubeMaterials[reg.name] = { color: c && typeof c[1][0] === 'number' ? `#${c[1][0].toString(16).padStart(6, '0')}` : null };
  } else if (['item', 'block', 'fluid'].includes(reg.registry)) {
    const dn = call('displayName');
    const id = reg.name.includes(':') ? reg.name : `kubejs:${reg.name}`;
    if (dn) kubeNames[id] = clean(kjs.collectStrings(dn[1])[0] ?? '');
  }
}

// ---------------------------------------------------------------- names
const titleCase = (s) =>
  s.split(/[_/]+/).filter(Boolean).map((w) => (/^(lv|mv|hv|ev|iv|luv|zpm|uv|uhv|ulv)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');

const materialColors = JSON.parse(fs.readFileSync(path.join(here, 'data', 'gtceu-material-colors.json'), 'utf8'));
const materialIds = new Set([
  ...Object.keys(lang).filter((k) => k.startsWith('material.gtceu.')).map((k) => k.slice('material.gtceu.'.length)),
  ...Object.keys(materialColors),
  ...Object.keys(kubeMaterials),
]);
const materialsByLength = [...materialIds].sort((a, b) => b.length - a.length);
const materialName = (m) => L(`material.gtceu.${m}`) ?? titleCase(m);

const materialCache = new Map();
/** Find the GT material an id refers to, plus the "tag prefix" pattern around it. */
function splitMaterial(p) {
  if (materialCache.has(p)) return materialCache.get(p);
  let res = null;
  for (const m of materialsByLength) {
    const re = new RegExp(`(^|_)${m}($|_)`);
    const match = re.exec(p);
    if (match) {
      const pattern = p.slice(0, match.index + match[1].length) + '%s' + p.slice(match.index + match[0].length - match[2].length);
      res = { material: m, pattern };
      break;
    }
  }
  materialCache.set(p, res);
  return res;
}

// In-game names from a Pack Extract export (see --export), used before anything guessed.
const exportItemNames = new Map();
const exportFluidNames = new Map();
function itemName(id) {
  if (exportItemNames.has(id)) return exportItemNames.get(id);
  const [ns, p] = id.includes(':') ? id.split(':') : ['minecraft', id];
  const direct = L(`item.${ns}.${p}`) ?? L(`block.${ns}.${p}`) ?? kubeNames[id];
  if (direct) return direct;
  if (ns === 'gtceu') {
    const sm = splitMaterial(p);
    if (sm) {
      const key = sm.pattern.replace('%s', '').replace(/^_+|_+$/g, '').replace(/__+/g, '_');
      const pat = L(`tagprefix.${key}`);
      if (pat) return pat.replace('%s', materialName(sm.material));
    }
  }
  return titleCase(p);
}

function fluidName(id) {
  if (exportFluidNames.has(id)) return exportFluidNames.get(id);
  const [ns, p] = id.includes(':') ? id.split(':') : ['minecraft', id];
  const direct = L(`fluid_type.${ns}.${p}`) ?? L(`fluid.${ns}.${p}`) ?? L(`block.${ns}.${p}`) ?? kubeNames[id];
  if (direct) return direct;
  if (ns === 'gtceu' || materialIds.has(p)) {
    if (materialIds.has(p)) return materialName(p);
    let m;
    if ((m = /^liquid_(.+)$/.exec(p)) && materialIds.has(m[1])) return `Liquid ${materialName(m[1])}`;
    if ((m = /^molten_(.+)$/.exec(p)) && materialIds.has(m[1])) return `Molten ${materialName(m[1])}`;
    if ((m = /^(.+)_plasma$/.exec(p)) && materialIds.has(m[1])) return `${materialName(m[1])} Plasma`;
  }
  const bucket = L(`item.${ns}.${p}_bucket`);
  if (bucket) return bucket.replace(/\s*Bucket$/i, '');
  return titleCase(p);
}

function tagName(tag) {
  if (exportItemNames.has(`#${tag}`)) return exportItemNames.get(`#${tag}`);
  const [, p] = tag.includes(':') ? tag.split(':') : ['forge', tag];
  const segs = p.split('/');
  if (segs[0] === 'circuits' && segs[1]) return `${segs[1].toUpperCase()} Circuit (any)`;
  if (segs.length >= 2) {
    const mat = segs.slice(1).join('_');
    const matName = materialIds.has(mat) ? materialName(mat) : titleCase(mat);
    // forge:dusts/carbon -> GTCEu's "%s Dust" pattern -> "Carbon Dust (any)"
    const pattern = L(`tagprefix.${segs[0].replace(/s$/, '')}`) ?? L(`tagprefix.${segs[0]}`);
    return `${pattern ? pattern.replace('%s', matName) : `${matName} ${titleCase(segs[0])}`} (any)`;
  }
  return `${titleCase(p)} (any)`;
}

// ---------------------------------------------------------------- colours
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  // HSL(hue, 55%, 58%) -> hex
  const sat = 0.55, lig = 0.58;
  const k = (n) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
const VANILLA_FLUID_COLORS = { 'minecraft:water': '#3f76e4', 'minecraft:lava': '#e8601c', 'minecraft:milk': '#f4f4f4' };
const fluidTextureColor = new Map();
function materialColor(m) {
  return kubeMaterials[m]?.color ?? materialColors[m] ?? null;
}
function colorFor(id, unit, isTag) {
  if (VANILLA_FLUID_COLORS[id]) return VANILLA_FLUID_COLORS[id];
  const [ns, p] = id.includes(':') ? id.split(':') : ['minecraft', id];
  const lookup = isTag ? p.split('/').slice(1).join('_') || p : p;
  if (unit === 'mB') {
    const base = lookup.replace(/^(liquid|molten)_/, '').replace(/_plasma$/, '');
    const c = materialColor(base);
    if (c) return c;
    if (gtJar && ns === 'gtceu') {
      if (!fluidTextureColor.has(base)) {
        const buf = gtJar.read(`assets/gtceu/textures/block/fluids/fluid.${base}.png`);
        fluidTextureColor.set(base, buf ? averagePngColor(buf) : null);
      }
      if (fluidTextureColor.get(base)) return fluidTextureColor.get(base);
    }
  } else {
    const sm = splitMaterial(lookup);
    if (sm && materialColor(sm.material)) return materialColor(sm.material);
  }
  return hashColor(id);
}

// ---------------------------------------------------------------- item dictionary
const VANILLA_MATERIAL_FORMS = new Set(['%s', '%s_ingot', '%s_nugget', '%s_block', '%s_dust', 'raw_%s']);
/** GregTech-related item: GT/pack namespaces, any fluid, or a vanilla item that is a GT material form. */
function isGregTechItem(id, unit, isTag) {
  if (unit === 'mB') return true;
  const [ns, p] = id.includes(':') ? id.split(':') : ['minecraft', id];
  if (GT_ITEM_NAMESPACES.has(ns)) return true;
  if (isTag) return ns === 'forge' && p.includes('/') && materialIds.has(p.split('/').slice(1).join('_'));
  if (ns !== 'minecraft') return false;
  const sm = splitMaterial(p);
  return !!sm && VANILLA_MATERIAL_FORMS.has(sm.pattern);
}

const items = {};
function itemRef(raw, unit) {
  const key = raw.isTag ? `#${raw.id}` : raw.id;
  if (!items[key]) {
    items[key] = {
      name: raw.isTag ? tagName(raw.id) : unit === 'mB' ? fluidName(raw.id) : itemName(raw.id),
      color: colorFor(raw.id, unit, raw.isTag),
      unit,
      ...(raw.isTag ? { tag: true } : {}),
      ...(isGregTechItem(raw.id, unit, raw.isTag) ? {} : { nonGT: true }),
    };
  }
  const ref = { id: key, amount: raw.amount };
  if (raw.chance != null && raw.chance < 1) ref.chance = Math.round(raw.chance * 10000) / 10000;
  if (raw.consumed === false) ref.consumed = false;
  return ref;
}

const tierFor = (eut) => {
  const a = Math.abs(eut || 0);
  const i = V.findIndex((v) => a <= v);
  return TIERS[i < 0 ? TIERS.length - 1 : i];
};

// ---------------------------------------------------------------- normalise recipes
const recipes = [];
const usedIds = new Set();
const typesSeen = new Set();

function addRecipe(raw, source) {
  const type = raw.type.replace(/^gtceu:/, '');
  typesSeen.add(type);
  let id = raw.id ?? `${source}:auto/${type}/${recipes.length}`;
  if (usedIds.has(id)) {
    let n = 2;
    while (usedIds.has(`${id}#${n}`)) n++;
    id = `${id}#${n}`;
  }
  usedIds.add(id);

  const eut = raw.EUt ?? 0;
  const generates = eut < 0 || recipeTypeIO[type] === 'out' || GT_GENERATOR_TYPES.has(type);
  const inputs = [...raw.itemInputs.map((x) => itemRef(x, 'item')), ...raw.fluidInputs.map((x) => itemRef(x, 'mB'))];
  const outputs = [...raw.itemOutputs.map((x) => itemRef(x, 'item')), ...raw.fluidOutputs.map((x) => itemRef(x, 'mB'))];
  if (type === 'large_boiler') {
    // Fuel is per craft whatever the boiler; water and steam scale with the boiler type.
    for (const i of inputs) i.fixed = true;
    const ticks = raw.duration ?? 0;
    inputs.push(itemRef({ id: 'minecraft:water', amount: Math.round(BOILER_BASE_WATER * ticks * 1000) / 1000 }, 'mB'));
    outputs.push(itemRef({ id: 'gtceu:steam', amount: Math.round(BOILER_BASE_WATER * STEAM_PER_WATER * ticks * 1000) / 1000 }, 'mB'));
  }
  const r = {
    id,
    type,
    source,
    tier: tierFor(eut),
    eut: Math.abs(eut),
    ticks: raw.duration ?? 0,
    inputs,
    outputs,
  };
  if (generates) r.gen = true;
  if (type === 'large_boiler') r.boiler = true;
  if (!generates && outputs.length && outputs.every((o) => items[o.id].nonGT)) r.nonGT = true;
  if (raw.circuit != null) r.circuit = raw.circuit;
  if (raw.inputEU) r.startEU = raw.inputEU;
  if (raw.conditions?.length) r.conditions = raw.conditions;
  if (raw.extra?.blastFurnaceTemp) r.temp = raw.extra.blastFurnaceTemp;
  recipes.push(r);
}

// ---------------------------------------------------------------- GTCEu dump
const isRegExp = (x) => Object.prototype.toString.call(x) === '[object RegExp]';
function strMatch(pattern, value) {
  if (isRegExp(pattern)) return new RegExp(pattern.source, pattern.flags).test(value);
  return String(pattern).replace(/^#/, '') === String(value).replace(/^#/, '');
}
function filterMatches(filter, r) {
  if (filter == null) return false;
  if (Array.isArray(filter)) return filter.some((f) => filterMatches(f, r));
  if (typeof filter === 'string' || isRegExp(filter)) return strMatch(filter, r.id);
  if (typeof filter !== 'object') return false;
  const keys = Object.keys(filter);
  if (!keys.length) return false;
  return keys.every((k) => {
    const v = filter[k];
    switch (k) {
      case 'id': return strMatch(v, r.id);
      case 'type': return strMatch(String(v).includes(':') || isRegExp(v) ? v : `gtceu:${v}`, `gtceu:${r.type}`);
      case 'mod': return strMatch(v, r.id.split(':')[0]);
      case 'output': return [...r.itemOutputs, ...r.fluidOutputs].some((x) => strMatch(v, x.id));
      case 'input': return [...r.itemInputs, ...r.fluidInputs].some((x) => strMatch(v, x.id));
      case 'not': return !filterMatches(v, r);
      default: return false;
    }
  });
}

function walkJson(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJson(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Pull an item/tag identity + count out of any GTCEu SizedIngredient JSON shape. */
function parseItemContent(c) {
  if (c == null) return null;
  if (Array.isArray(c)) return parseItemContent(c[0]);
  if (typeof c === 'string') return { id: c.replace(/^#/, ''), isTag: c.startsWith('#'), amount: 1 };
  if (c.type === 'gtceu:circuit' || c.type === 'gtceu:int_circuit') return { circuit: c.configuration ?? c.config ?? 0 };
  const count = c.count ?? c.amount ?? 1;
  if (c.item) return { id: c.item, isTag: false, amount: count };
  if (c.tag) return { id: c.tag, isTag: true, amount: count };
  const inner = c.ingredient ?? c.inner ?? c.value ?? c.base;
  if (inner) {
    const r = parseItemContent(inner);
    if (r && !r.circuit) r.amount = count * (r.amount || 1);
    return r;
  }
  return null;
}
/**
 * GTCEu writes fluid inputs as tags ("forge:raw_gasoline") but outputs as fluids
 * ("gtceu:raw_gasoline"). Map material fluid tags back to the fluid so the two connect.
 */
function fluidFromTag(tag) {
  const [ns, p] = tag.includes(':') ? tag.split(':') : ['forge', tag];
  if (ns !== 'forge' && ns !== 'c') return null;
  if (p === 'water' || p === 'lava' || p === 'milk') return `minecraft:${p}`;
  const base = p.replace(/^(liquid|molten)_/, '').replace(/_plasma$/, '');
  return materialIds.has(base) || materialIds.has(p) ? `gtceu:${p}` : null;
}
function parseFluidContent(c) {
  if (c == null) return null;
  if (Array.isArray(c)) return parseFluidContent(c[0]);
  const amount = c.amount ?? 1000;
  if (c.fluid) return { id: c.fluid, isTag: false, amount };
  if (c.tag) {
    const fluid = fluidFromTag(c.tag);
    return fluid ? { id: fluid, isTag: false, amount } : { id: c.tag, isTag: true, amount };
  }
  if (c.FluidName) return { id: c.FluidName, isTag: false, amount: c.Amount ?? amount };
  const inner = c.value ?? c.values ?? c.ingredient;
  if (inner) {
    const r = parseFluidContent(inner);
    if (r) r.amount = amount;
    return r;
  }
  return null;
}
function parseEU(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const c = list[0].content ?? list[0];
  if (typeof c === 'number') return c;
  if (c && typeof c === 'object') return (c.voltage ?? c.eu ?? 0) * (c.amperage ?? c.amps ?? 1);
  return 0;
}
function parseDumpRecipe(id, j) {
  const r = { id, type: String(j.type).replace(/^gtceu:/, ''), itemInputs: [], itemOutputs: [], fluidInputs: [], fluidOutputs: [], duration: j.duration ?? 0, EUt: 0, circuit: null, conditions: [], extra: {} };
  const take = (section, cap, list, parser, isInput) => {
    for (const entry of j[section]?.[cap] ?? []) {
      const parsed = parser(entry.content ?? entry);
      if (!parsed) continue;
      if (parsed.circuit != null) { r.circuit = parsed.circuit; continue; }
      const max = entry.maxChance ?? 10000;
      const chance = entry.chance ?? max;
      if (isInput && chance === 0) parsed.consumed = false;
      else if (chance < max) parsed.chance = chance / max;
      list.push(parsed);
    }
  };
  take('inputs', 'item', r.itemInputs, parseItemContent, true);
  take('inputs', 'fluid', r.fluidInputs, parseFluidContent, true);
  take('outputs', 'item', r.itemOutputs, parseItemContent, false);
  take('outputs', 'fluid', r.fluidOutputs, parseFluidContent, false);
  const euIn = parseEU(j.tickInputs?.eu);
  const euOut = parseEU(j.tickOutputs?.eu);
  r.EUt = euOut ? -euOut : euIn;
  if (j.data?.ebf_temp) r.extra.blastFurnaceTemp = j.data.ebf_temp;
  return r;
}

// ---------------------------------------------------------------- Pack Extract export (--export)
// The export lists every recipe as the game loaded it: GregTech machines (pack KubeJS recipes
// included), crafting, furnace and other mods' recipe types. Only recipes that end up in a
// GregTech chain are kept (see the filter below). Recipe ids and tag inputs from the previous
// data/recipes.json are kept where the recipe is the same, so saved flows still load.
const exportMachineNames = {};
const exportImages = new Map(); // item id, or "fluid|<id>" -> 64px render in the export
const exportTagFirst = new Map(); // tag -> an item it stands for, for its icon
let exportStats = null;
const exportOtherTypes = new Set(); // crafting and other mods' types
const EXPORT_SKIP_TYPES = /^(justenoughbreeding|jeed|crafttweaker|emojiful|waystones|unknown|botanypots:(soil|fertilizer|pot_interaction)|rftoolsutility:spawner|apotheosis:(spawner_modifier|salvaging|reforging)|framedblocks|enderio:painting)/;
// GregTech tools in crafting grids take damage instead of being used up.
const GT_TOOL = /^gtceu:.*_(hammer|wrench|file|saw|screwdriver|wire_cutter|mortar|knife|crowbar|mallet|scythe|plunger|drill|chainsaw|buzzsaw)(#.*)?$/;

function importExport() {
  const X = (f) => JSON.parse(fs.readFileSync(path.join(exportDir, f), 'utf8'));
  const manifest = X('manifest.json');
  const xItems = X('items.json');
  const xFluids = X('fluids.json');
  const xTags = X('tags.json');
  console.log(`Export:   ${exportDir} (${manifest.pack}, ${manifest.generator}, ${manifest.generatedAt})`);
  const prevFile = path.join(outDir, 'data', 'recipes.json');
  const prev = profile === 'skygreg' && fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, 'utf8')) : null;

  for (const i of xItems) {
    if (i.name) exportItemNames.set(i.id, clean(i.name));
    if (i.image && !i.imageBlank) exportImages.set(i.id, path.join(exportDir, i.image));
  }
  // NBT variants that lose their hash (tools) use the variant's render.
  for (const i of xItems) {
    const plain = i.id.replace(/#.*$/, '');
    if (i.image && !i.imageBlank && !exportImages.has(plain)) exportImages.set(plain, path.join(exportDir, i.image));
  }
  for (const f of xFluids) {
    if (f.name) exportFluidNames.set(f.id, clean(f.name));
    if (f.image) exportImages.set(`fluid|${f.id}`, path.join(exportDir, f.image));
  }
  const circuitOf = new Map();
  for (const i of xItems) {
    const m = i.id.startsWith('gtceu:programmed_circuit#') && /Configuration:(\d+)/.exec(i.nbt ?? '');
    if (m) circuitOf.set(i.id, Number(m[1]));
  }
  // A list of alternatives ("any log") is written out item by item; find the tag it came from.
  const base = (id) => id.replace(/#.*$/, '');
  const tagBySet = new Map();
  const tagRank = (t) => (t.startsWith('forge:') ? 0 : t.startsWith('minecraft:') ? 1 : t.startsWith('gtceu:') ? 2 : 3);
  for (const [tag, members] of Object.entries(xTags.items ?? {})) {
    const key = [...new Set(members)].sort().join(' ');
    const had = tagBySet.get(key);
    if (!had || tagRank(tag) < tagRank(had) || (tagRank(tag) === tagRank(had) && tag.length < had.length)) tagBySet.set(key, tag);
  }
  // Else the smallest tag holding every alternative (a GT tool in any material: forge:tools/...).
  const tagsOfItem = new Map();
  for (const [tag, members] of Object.entries(xTags.items ?? {})) for (const m of members) { if (!tagsOfItem.has(m)) tagsOfItem.set(m, []); tagsOfItem.get(m).push(tag); }
  const tagFor = (ids) => {
    const set = [...new Set(ids.map(base))];
    const exact = tagBySet.get([...set].sort().join(' '));
    if (exact || set.length < 2) return exact ?? null;
    let common = tagsOfItem.get(set[0]) ?? [];
    for (const id of set.slice(1)) { const t = new Set(tagsOfItem.get(id) ?? []); common = common.filter((x) => t.has(x)); }
    const size = (t) => xTags.items[t].length;
    return common.sort((a, b) => size(a) - size(b) || tagRank(a) - tagRank(b))[0] ?? null;
  };
  const tagMembers = (id) => xTags.items?.[id.slice(1)] ?? xTags.fluids?.[id.slice(1)] ?? [];
  for (const [tag, members] of Object.entries(xTags.items ?? {})) if (members[0]) exportTagFirst.set(`#${tag}`, members[0]);

  // NBT variants ("#hash") lose the hash when the pack only ever uses one variant of the item.
  const xGt = X('recipes/gregtech.json');
  const xCraft = X('recipes/crafting.json');
  const xSmelt = X('recipes/smelting.json');
  const xOther = X('recipes/other.json');
  const variants = new Map();
  const allRefs = (r) => [...(r.inputs ?? []), ...(r.outputs ?? []), r.input, r.output].filter(Boolean);
  for (const r of [...xGt, ...xCraft, ...xSmelt, ...xOther]) {
    for (const x of allRefs(r)) {
      for (const id of x.item ? [x.item] : x.anyOf ?? []) {
        if (circuitOf.has(id)) continue;
        if (!variants.has(base(id))) variants.set(base(id), new Set());
        variants.get(base(id)).add(id);
      }
    }
  }
  // One variant, or the plain item plus one NBT form (a tool's default NBT), counts as one item.
  const itemId = (id) => {
    const v = variants.get(base(id));
    return !v || v.size === 1 || (v.size === 2 && v.has(base(id))) || GT_TOOL.test(id) ? base(id) : id;
  };

  function xItem(x, grid = false) {
    if (!x) return null;
    if (x.item && circuitOf.has(x.item)) return { circuit: circuitOf.get(x.item) };
    let id = x.item ? itemId(x.item) : null;
    let isTag = false;
    if (!id && x.anyOf?.length) {
      let tag = tagFor(x.anyOf);
      // GT tools of every material with no tag in common: "Wire Cutter (any)".
      const kinds = new Set(x.anyOf.map((a) => GT_TOOL.exec(a)?.[1]));
      if (!tag && kinds.size === 1 && !kinds.has(undefined)) {
        const kind = [...kinds][0];
        tag = `gtceu:tools/${kind}`;
        exportItemNames.set(`#${tag}`, `${titleCase(kind)} (any)`);
        exportTagFirst.set(`#${tag}`, itemId(x.anyOf[0]));
      }
      if (tag) { id = tag; isTag = true; } else id = itemId(x.anyOf[0]);
    }
    if (!id && x.tag) { id = x.tag; isTag = true; }
    if (!id) return null;
    const ref = { id, isTag, amount: x.amount ?? 1 };
    if (x.chance != null && x.chance < 1) ref.chance = x.chance;
    if (x.consumed === false || (grid && GT_TOOL.test(x.item ?? x.anyOf?.[0] ?? ''))) ref.consumed = false;
    return ref;
  }
  function xFluid(x) {
    if (!x) return null;
    const id = x.fluid ?? x.anyOf?.[0];
    const ref = id ? { id, isTag: false, amount: x.amount ?? 1000 } : x.fluidTag ? { id: x.fluidTag, isTag: true, amount: x.amount ?? 1000 } : null;
    if (ref && x.chance != null && x.chance < 1) ref.chance = x.chance;
    if (ref && x.consumed === false) ref.consumed = false;
    return ref;
  }
  const blank = (id, type, source) => ({ id, type, source, itemInputs: [], itemOutputs: [], fluidInputs: [], fluidOutputs: [], duration: 0, EUt: 0, circuit: null, conditions: [], extra: {} });
  const takeItems = (raw, list, into, grid = false) => {
    for (const x of list ?? []) {
      const ref = xItem(x, grid);
      if (!ref) continue;
      if (ref.circuit != null) { raw.circuit = ref.circuit; continue; }
      // A crafting grid lists each slot: add up the same ingredient.
      const same = into === raw.itemInputs && into.find((y) => y.id === ref.id && y.isTag === ref.isTag && y.consumed === ref.consumed && y.chance === ref.chance);
      if (same) { if (ref.consumed !== false) same.amount += ref.amount; } else into.push(ref);
    }
  };

  // GregTech machines. Addon maps keep their own name unless it clashes with a GTCEu one.
  const gtPaths = new Set(xGt.filter((r) => r.map.startsWith('gtceu:')).map((r) => r.map.slice(6)));
  const mapType = (map) => { const [ns, p] = map.split(':'); return ns === 'gtceu' || !gtPaths.has(p) ? p : `${ns}_${p}`; };
  for (const m of X('recipes/gregtech-maps.json')) exportMachineNames[mapType(m.id)] = m.name;
  const conditionName = (c) => { const s = String(c).replace(/Condition$/, ''); return s[0].toLowerCase() + s.slice(1); };
  for (const r of xGt) {
    const raw = blank(r.id, mapType(r.map), r.id.startsWith('kubejs:') ? 'kubejs' : 'gtceu');
    takeItems(raw, r.inputs, raw.itemInputs);
    takeItems(raw, r.outputs, raw.itemOutputs);
    raw.fluidInputs = (r.fluidInputs ?? []).map(xFluid).filter(Boolean);
    raw.fluidOutputs = (r.fluidOutputs ?? []).map(xFluid).filter(Boolean);
    raw.duration = r.duration ?? 0;
    raw.EUt = r.eutOutput ? -r.eutOutput : r.eut ?? 0;
    raw.conditions = (r.conditions ?? []).map(conditionName);
    if (r.temp) raw.extra.blastFurnaceTemp = r.temp;
    addRecipe(raw, raw.source);
  }
  // Crafting grids: one craft a second (by hand or an autocrafter), no power.
  exportMachineNames.crafting = 'Crafting';
  exportOtherTypes.add('crafting');
  for (const r of xCraft) {
    if (r.type === 'special' || !r.output?.item) continue;
    const raw = blank(r.id, 'crafting', 'gtceu');
    takeItems(raw, r.inputs, raw.itemInputs, true);
    takeItems(raw, [r.output], raw.itemOutputs);
    raw.duration = 20;
    if (raw.itemInputs.length) addRecipe(raw, 'gtceu');
  }
  // Furnace recipes run in the Electric Furnace: 4 EU/t, 128 ticks at its base tier.
  for (const r of xSmelt) {
    if (r.type !== 'smelting' || !r.output?.item) continue;
    const raw = blank(r.id, 'electric_furnace', 'gtceu');
    takeItems(raw, [r.input], raw.itemInputs);
    takeItems(raw, [r.output], raw.itemOutputs);
    raw.duration = 128;
    raw.EUt = 4;
    if (raw.itemInputs.length) addRecipe(raw, 'gtceu');
  }
  // Other mods' recipe types (Inscriber, Stonecutter...): one craft a second, no power.
  const modName = new Map((manifest.mods ?? []).map((m) => [m.id, m.name]));
  for (const r of xOther) {
    if (EXPORT_SKIP_TYPES.test(r.type) || !r.output?.item) continue;
    const [ns, p] = r.type.split(':');
    const type = `${ns}_${p}`;
    exportOtherTypes.add(type);
    exportMachineNames[type] ??= `${titleCase(p)}${ns !== 'minecraft' && modName.get(ns) ? ` (${modName.get(ns)})` : ''}`;
    const raw = blank(r.id, type, 'gtceu');
    takeItems(raw, r.inputs, raw.itemInputs);
    takeItems(raw, [r.output], raw.itemOutputs);
    raw.duration = 20;
    if (raw.itemInputs.length) addRecipe(raw, 'gtceu');
  }
  const total = recipes.length;

  // Keep a recipe when it makes something GregTech (or power), or makes something a kept recipe
  // uses, repeated until nothing changes. Tinkers parts, Apotheosis gear and decorative blocks
  // that never feed a GregTech line drop out.
  const keep = recipes.map((r) => !!(r.gen || r.boiler || r.outputs.some((o) => !items[o.id].nonGT)));
  const needed = new Set();
  // Breaking one item back down (macerating, arc or alloy smelting, melting) takes almost anything,
  // so it doesn't make that item worth keeping.
  const BREAKDOWN = new Set(['macerator', 'arc_furnace', 'extractor', 'alloy_smelter', 'electric_furnace']);
  const need = (r) => {
    const solids = r.inputs.filter((i) => i.consumed !== false && items[i.id]?.unit !== 'mB');
    if (BREAKDOWN.has(r.type) && solids.length <= 1) return;
    for (const i of r.inputs) {
      needed.add(i.id);
      if (i.id.startsWith('#')) for (const m of tagMembers(i.id)) needed.add(itemId(m));
    }
  };
  recipes.forEach((r, k) => { if (keep[k]) need(r); });
  for (let changed = true; changed;) {
    changed = false;
    recipes.forEach((r, k) => {
      if (keep[k] || !r.outputs.some((o) => needed.has(o.id))) return;
      keep[k] = true;
      need(r);
      changed = true;
    });
  }
  const dropped = {};
  recipes.forEach((r, k) => { if (!keep[k]) { dropped[r.type] = (dropped[r.type] ?? 0) + 1; usedIds.delete(r.id); } });
  const kept = recipes.filter((_, k) => keep[k]);
  recipes.length = 0;
  for (const r of kept) recipes.push(r);

  // Same recipe as before: keep its old id and its old tag inputs.
  let sameId = 0, renamed = 0, tagsKept = 0, carried = 0;
  if (prev) {
    const prevById = new Map(prev.recipes.map((r) => [r.id, r]));
    const sig = (r) => [r.type, r.eut, r.ticks, r.outputs.map((o) => `${o.id}*${o.amount}*${o.chance ?? 1}`).sort().join(','), r.inputs.map((i) => i.amount).sort((a, b) => a - b).join(',')].join('|');
    const prevBySig = new Map();
    for (const p of prev.recipes) { const k = sig(p); if (!prevBySig.has(k)) prevBySig.set(k, []); prevBySig.get(k).push(p); }
    const claimed = new Set();
    const copyItem = (id) => { if (!items[id] && prev.items[id]) { const { icon: _icon, ...info } = prev.items[id]; items[id] = info; } };
    for (const r of recipes) {
      let old = prevById.get(r.id);
      if (old) sameId++;
      else {
        const cands = (prevBySig.get(sig(r)) ?? []).filter((p) => !claimed.has(p.id) && !usedIds.has(p.id));
        const score = (p) => p.inputs.filter((i) => r.inputs.some((j) => j.id === i.id)).length;
        old = cands.sort((a, b) => score(b) - score(a))[0];
        if (old) { claimed.add(old.id); usedIds.delete(r.id); usedIds.add(old.id); r.id = old.id; renamed++; }
      }
      if (!old) continue;
      const free = old.inputs.filter((i) => i.id.startsWith('#'));
      for (const i of r.inputs) {
        if (i.id.startsWith('#')) continue;
        const k = free.findIndex((o) => o.amount === i.amount && prev.items[o.id]?.unit === items[i.id]?.unit && tagMembers(o.id).map(itemId).includes(i.id));
        if (k < 0) continue;
        i.id = free[k].id;
        free.splice(k, 1);
        copyItem(i.id);
        tagsKept++;
      }
    }
    // Boiler fuels the export doesn't list (the old dump had every burnable item).
    const fuels = new Set(recipes.filter((r) => r.type === 'large_boiler' || r.type === 'steam_boiler').map((r) => `${r.type}|${r.inputs[0]?.id}`));
    for (const p of prev.recipes) {
      if ((p.type !== 'large_boiler' && p.type !== 'steam_boiler') || usedIds.has(p.id) || fuels.has(`${p.type}|${p.inputs[0]?.id}`)) continue;
      recipes.push(structuredClone(p));
      usedIds.add(p.id);
      for (const x of [...p.inputs, ...p.outputs]) copyItem(x.id);
      carried++;
    }
  }

  // Items no kept recipe uses are left out.
  const used = new Set(recipes.flatMap((r) => [...r.inputs, ...r.outputs].map((x) => x.id)));
  for (const id of Object.keys(items)) if (!used.has(id)) delete items[id];
  typesSeen.clear();
  for (const r of recipes) typesSeen.add(r.type);

  exportStats = { pack: manifest.pack, generator: manifest.generator, exportedAt: manifest.generatedAt, read: total, kept: recipes.length - carried, carriedBoilerFuels: carried };
  console.log(`  ${total} recipes read, ${recipes.length - carried} kept in GregTech chains, ${carried} boiler fuels carried over`);
  console.log(`  ids: ${sameId} unchanged, ${renamed} matched to their old id, ${tagsKept} tag inputs kept`);
  const top = Object.entries(dropped).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`  dropped: ${top}`);
}

let dumpCount = 0;
let removedCount = 0;
const kubeIds = new Set(kjs.recipes.map((r) => r.id).filter(Boolean));
if (dumpRoot && !exportDir) {
  // The dump holds one folder per namespace (gtceu plus addons like gttruesteam).
  const dataDir = firstExisting(path.join(dumpRoot, 'gtceu', 'recipes')) ? dumpRoot
    : firstExisting(path.join(dumpRoot, 'data', 'gtceu', 'recipes')) ? path.join(dumpRoot, 'data')
    : path.join(dumpRoot, 'dumped', 'data');
  const recipeDirs = fs.readdirSync(dataDir)
    .map((ns) => ({ ns, dir: path.join(dataDir, ns, 'recipes') }))
    .filter((x) => fs.existsSync(x.dir) && (profile !== 'base' || x.ns === 'gtceu'));
  console.log(`Reading GTCEu dump from ${dataDir} (${recipeDirs.map((x) => x.ns).join(', ')})...`);
  const dumpFiles = recipeDirs.flatMap(({ ns, dir }) => walkJson(dir).map((file) => ({ ns, dir, file })));
  for (const { ns, dir: recipesDir, file } of dumpFiles) {
    const rel = path.relative(recipesDir, file).replace(/\\/g, '/').replace(/\.json$/, '');
    const id = `${ns}:${rel}`;
    let j;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    // Machine recipes only: skip vanilla types and GT's own crafting-table types.
    if (!j || typeof j.type !== 'string' || !j.type.startsWith('gtceu:') || j.type.startsWith('gtceu:crafting_')) continue;
    const raw = parseDumpRecipe(id, j);
    if (kubeIds.has(id)) continue; // overridden by a KubeJS recipe with the same id
    if (kjs.removals.some((rm) => filterMatches(rm.filter, raw))) { removedCount++; continue; }
    for (const rep of kjs.replacements) {
      if (!filterMatches(rep.filter, raw)) continue;
      const list = rep.kind === 'replaceInput' ? [...raw.itemInputs, ...raw.fluidInputs] : [...raw.itemOutputs, ...raw.fluidOutputs];
      const to = parseItemContent(typeof rep.to === 'string' ? rep.to : String(rep.to));
      for (const x of list) if (to && strMatch(rep.from, x.id)) { x.id = to.id; x.isTag = to.isTag; }
    }
    addRecipe(raw, 'gtceu');
    dumpCount++;
  }
  console.log(`  ${dumpCount} base recipes imported, ${removedCount} removed by pack scripts`);
}

// Verified base recipes for the petrochem chain, used where the dump doesn't supply them.
let builtinCount = 0;
for (const raw of exportDir ? [] : BUILTIN_RECIPES) {
  if (usedIds.has(raw.id) || kubeIds.has(raw.id)) continue;
  if (kjs.removals.some((rm) => filterMatches(rm.filter, raw))) continue;
  addRecipe(raw, 'builtin');
  builtinCount++;
}
if (builtinCount) console.log(`  ${builtinCount} built-in base GTCEu recipes added (petrochem chain)`);

if (!exportDir) for (const raw of kjs.recipes) addRecipe(raw, 'kubejs');
else importExport();

// Fluid tags left over (addon materials we have no definition for): if some recipe outputs
// a fluid with the same path, use that fluid so producers and consumers connect.
{
  const fluidByPath = new Map();
  for (const [id, info] of Object.entries(items)) {
    if (info.unit === 'mB' && !info.tag) fluidByPath.set(id.split(':')[1], id);
  }
  const remap = new Map();
  for (const [id, info] of Object.entries(items)) {
    if (info.unit !== 'mB' || !info.tag) continue;
    const p = id.slice(1).split(':')[1];
    if (fluidByPath.has(p)) remap.set(id, fluidByPath.get(p));
  }
  for (const r of recipes) for (const ref of r.inputs) if (remap.has(ref.id)) ref.id = remap.get(ref.id);
  for (const id of remap.keys()) delete items[id];
  if (remap.size) console.log(`  mapped ${remap.size} addon fluid tags to their fluids`);
}

// ---------------------------------------------------------------- machines + textures
const texturesOut = path.join(outDir, 'textures');
// Shared with the base profile and with GTNH (textures/gtnh, written by import-gtnh.mjs), so nothing is
// cleared: files are overwritten in place, and a texture no longer used just stays.
const copiedTextures = new Map();

/** Resolve "ns:block/path" to bytes from the gtceu jar, KubeJS assets or another mod jar. */
function readTexture(ref) {
  const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref];
  const rel = `assets/${ns}/textures/${p}.png`;
  const kube = path.join(kubejsDir, rel);
  if (fs.existsSync(kube)) return fs.readFileSync(kube);
  if (gtJar?.has(rel)) return gtJar.read(rel);
  for (const z of jars) if (z.has(rel)) return z.read(rel);
  return null;
}
function copyTexture(ref) {
  if (copiedTextures.has(ref)) return copiedTextures.get(ref);
  const buf = readTexture(ref);
  let url = null;
  if (buf) {
    const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref];
    url = `textures/${ns}/${p}.png`;
    const dest = path.join(outDir, url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  copiedTextures.set(ref, url);
  return url;
}
/** Overlay folders hold overlay_front.png etc; a casing ref may be a file or a folder. */
function resolveOverlay(dirRef) {
  for (const face of ['overlay_front', 'overlay_side', 'overlay_top']) {
    const url = copyTexture(`${dirRef}/${face}`);
    if (url) return url;
  }
  return null;
}
function resolveCasing(ref) {
  return copyTexture(ref) ?? copyTexture(`${ref}/side`) ?? copyTexture(`${ref}/${ref.split('/').pop()}`);
}

// ---------------------------------------------------------------- item icons
// Each item gets an icon: [base texture, tint?, overlay?, secondary texture?, secondary tint?].
// Textures are written as "ns:path" (served at textures/<ns>/<path>.png). GT material items
// are drawn like the game does: the material set's template tinted with the material colour.
const iconSets = JSON.parse(fs.readFileSync(path.join(here, 'data', 'gtceu-material-iconsets.json'), 'utf8'));
for (const reg of kjs.registry) {
  if (reg.registry !== 'gtceu:material') continue;
  const set = reg.calls.find((c) => c[0] === 'iconSet');
  const name = set && (kjs.holeName(set[1][0]) ?? String(set[1][0]));
  const sec = reg.calls.find((c) => c[0] === 'secondaryColor');
  iconSets[reg.name] = {
    set: /([A-Z_]+)$/.exec(name ?? '')?.[1]?.toLowerCase() ?? iconSets[reg.name]?.set ?? 'dull',
    ...(sec && typeof sec[1][0] === 'number' ? { secondary: `#${sec[1][0].toString(16).padStart(6, '0')}` } : {}),
  };
}
// MaterialIconSet parents: a set without a texture falls back to its parent's.
const SET_PARENT = {
  metallic: 'dull', magnetic: 'metallic', shiny: 'metallic', bright: 'shiny', diamond: 'shiny', emerald: 'diamond',
  gem_horizontal: 'emerald', gem_vertical: 'emerald', ruby: 'emerald', opal: 'ruby', glass: 'ruby', netherstar: 'netherstar_x',
  fine: 'dull', sand: 'fine', wood: 'fine', rough: 'fine', flint: 'rough', lignite: 'rough', quartz: 'rough', certus: 'quartz',
  lapis: 'quartz', fluid: 'dull', radioactive: 'metallic',
};
// GTCEu item id pattern -> material set texture name.
const PREFIX_TEXTURE = {
  '%s_dust': 'dust', 'small_%s_dust': 'dust_small', 'tiny_%s_dust': 'dust_tiny', 'impure_%s_dust': 'dust_impure', 'pure_%s_dust': 'dust_pure',
  'crushed_%s_ore': 'crushed', 'purified_%s_ore': 'crushed_purified', 'refined_%s_ore': 'crushed_refined', 'raw_%s': 'raw_ore',
  '%s_ingot': 'ingot', 'hot_%s_ingot': 'ingot_hot', 'double_%s_ingot': 'ingot_double', '%s_nugget': 'nugget',
  '%s_plate': 'plate', 'double_%s_plate': 'plate_double', 'dense_%s_plate': 'plate_dense', '%s_gear': 'gear', 'small_%s_gear': 'gear_small',
  '%s_rod': 'rod', 'long_%s_rod': 'rod_long', '%s_bolt': 'bolt', '%s_screw': 'screw', '%s_ring': 'ring', '%s_round': 'round',
  '%s_spring': 'spring', 'small_%s_spring': 'spring_small', 'fine_%s_wire': 'wire_fine', '%s_foil': 'foil', '%s_lens': 'lens',
  '%s_gem': 'gem', 'chipped_%s_gem': 'gem_chipped', 'flawed_%s_gem': 'gem_flawed', 'flawless_%s_gem': 'gem_flawless',
  'exquisite_%s_gem': 'gem_exquisite', '%s_rotor': 'rotor', '%s_turbine_blade': 'turbine_blade',
};
const PREFIX_BLOCK = { '%s_block': 'block', '%s_frame': 'frame_gt', 'raw_%s_block': 'raw_ore_block' };
// forge tag folder -> GTCEu id pattern
const TAG_FOLDER = {
  dusts: '%s_dust', small_dusts: 'small_%s_dust', tiny_dusts: 'tiny_%s_dust', impure_dusts: 'impure_%s_dust', pure_dusts: 'pure_%s_dust',
  crushed_ores: 'crushed_%s_ore', purified_ores: 'purified_%s_ore', refined_ores: 'refined_%s_ore', raw_materials: 'raw_%s',
  ingots: '%s_ingot', hot_ingots: 'hot_%s_ingot', double_ingots: 'double_%s_ingot', nuggets: '%s_nugget', plates: '%s_plate',
  double_plates: 'double_%s_plate', dense_plates: 'dense_%s_plate', gears: '%s_gear', small_gears: 'small_%s_gear', rods: '%s_rod',
  long_rods: 'long_%s_rod', bolts: '%s_bolt', screws: '%s_screw', rings: '%s_ring', rounds: '%s_round', springs: '%s_spring',
  small_springs: 'small_%s_spring', fine_wires: 'fine_%s_wire', foils: '%s_foil', lenses: '%s_lens', gems: '%s_gem',
  chipped_gems: 'chipped_%s_gem', flawed_gems: 'flawed_%s_gem', flawless_gems: 'flawless_%s_gem', exquisite_gems: 'exquisite_%s_gem',
  rotors: '%s_rotor', storage_blocks: '%s_block', frames: '%s_frame',
};
const GAS_FLUIDS = /(^|_)(gas|hydrogen|oxygen|nitrogen|helium|helium_3|argon|neon|krypton|xenon|radon|chlorine|fluorine|methane|ethane|propane|butane|ethylene|propene|butene|butadiene|carbon_monoxide|carbon_dioxide|hydrogen_sulfide|sulfur_dioxide|sulfur_trioxide|ammonia|steam|deuterium|tritium|nitric_oxide|nitrogen_dioxide|dinitrogen_tetroxide|vinyl_chloride|tetrafluoroethylene|hydrogen_chloride|hydrogen_fluoride|dimethyl_ether|chloromethane|air)$/;

// Vanilla textures live in the Minecraft client jar (CurseForge keeps it under Install/versions).
let mcJar = null;
{
  let mcVersion = '1.20.1';
  try { mcVersion = JSON.parse(fs.readFileSync(path.join(instanceDir, 'minecraftinstance.json'), 'utf8')).gameVersion ?? mcVersion; } catch { /* default */ }
  const roots = [arg('mcjar'), liveInstanceDir && path.resolve(liveInstanceDir, '..', '..', 'Install', 'versions', mcVersion, `${mcVersion}.jar`)];
  const f = firstExisting(...roots);
  if (f) { try { mcJar = new ZipFile(f); } catch { /* unreadable */ } }
  console.log(`MC jar:   ${f ?? '(none — vanilla items get colour swatches)'}`);
}
function readAsset(rel) {
  const kube = path.join(kubejsDir, rel);
  if (fs.existsSync(kube)) return fs.readFileSync(kube);
  if (gtJar?.has(rel)) return gtJar.read(rel);
  for (const z of jars) if (z.has(rel)) return z.read(rel);
  if (mcJar?.has(rel)) return mcJar.read(rel);
  return null;
}
const hasTexture = (ref) => {
  const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref];
  return !!readAsset(`assets/${ns}/textures/${p}.png`);
};
/** Copy a texture and return its "ns:path" key, or null. */
function iconTexture(ref) {
  if (!ref) return null;
  const norm = ref.includes(':') ? ref : `minecraft:${ref}`;
  if (copiedTextures.has(`icon|${norm}`)) return copiedTextures.get(`icon|${norm}`);
  const [ns, p] = norm.split(':');
  const buf = readAsset(`assets/${ns}/textures/${p}.png`);
  let key = null;
  if (buf) {
    const dest = path.join(outDir, 'textures', ns, `${p}.png`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    key = norm;
  }
  copiedTextures.set(`icon|${norm}`, key);
  return key;
}
function materialSetTexture(set, kind, name) {
  for (let s = set; s; s = SET_PARENT[s]) {
    const ref = `gtceu:${kind}/material_sets/${s}/${name}`;
    if (hasTexture(ref)) return { ref, set: s };
  }
  const ref = `gtceu:${kind}/material_sets/dull/${name}`;
  return hasTexture(ref) ? { ref, set: 'dull' } : null;
}
function materialIcon(material, pattern) {
  const color = materialColor(material);
  if (!color) return null;
  const tex = PREFIX_TEXTURE[pattern] ? ['item', PREFIX_TEXTURE[pattern]] : PREFIX_BLOCK[pattern] ? ['block', PREFIX_BLOCK[pattern]] : null;
  if (!tex) return null;
  const info = iconSets[material] ?? { set: 'dull' };
  const base = materialSetTexture(info.set, tex[0], tex[1]);
  if (!base) return null;
  const dir = base.ref.slice(0, base.ref.lastIndexOf('/'));
  const overlay = hasTexture(`${dir}/${tex[1]}_overlay`) ? iconTexture(`${dir}/${tex[1]}_overlay`) : null;
  const secondary = hasTexture(`${dir}/${tex[1]}_secondary`) ? iconTexture(`${dir}/${tex[1]}_secondary`) : null;
  const icon = [iconTexture(base.ref), color, overlay];
  if (secondary) icon.push(secondary, info.secondary ?? color);
  return icon;
}

const modelCache = new Map();
function readModel(ref) {
  const [ns, p] = ref.includes(':') ? ref.split(':') : ['minecraft', ref];
  const key = `${ns}:${p}`;
  if (modelCache.has(key)) return modelCache.get(key);
  let json = null;
  const buf = readAsset(`assets/${ns}/models/${p}.json`);
  if (buf) { try { json = parseJsonLoose(buf.toString('utf8')); } catch { /* malformed */ } }
  modelCache.set(key, json);
  return json;
}
/** Flatten an item model (following parents) to the texture that best shows it. */
function modelIcon(ns, p) {
  let model = readModel(`${ns}:item/${p}`);
  if (!model) return null;
  const textures = {};
  let isBlock = false;
  for (let depth = 0; model && depth < 10; depth++) {
    for (const [k, v] of Object.entries(model.textures ?? {})) if (!(k in textures)) textures[k] = v;
    const parent = model.parent;
    if (!parent || /builtin\/|item\/generated|item\/handheld/.test(parent)) break;
    if (/(^|:)block\//.test(parent)) isBlock = true;
    model = readModel(parent);
  }
  const resolve = (v, n = 0) => (typeof v === 'string' && v.startsWith('#') && n < 8 ? resolve(textures[v.slice(1)], n + 1) : v);
  const keys = isBlock ? ['all', 'side', 'front', 'end', 'top', 'texture', 'cross', 'particle', 'layer0'] : ['layer0', 'all', 'side', 'texture', 'particle'];
  for (const k of keys) {
    const t = resolve(textures[k]);
    if (typeof t === 'string' && !t.startsWith('#')) {
      const url = iconTexture(t);
      if (url) return [url, null, isBlock ? null : iconTexture(resolve(textures.layer1))];
    }
  }
  return null;
}
const tagFileCache = new Map();
function tagValues(tagId) {
  if (tagFileCache.has(tagId)) return tagFileCache.get(tagId);
  const [ns, p] = tagId.split(':');
  let values = [];
  const buf = readAsset(`data/${ns}/tags/items/${p}.json`.replace(/^/, '')) ?? readAsset(`data/${ns}/tags/item/${p}.json`);
  if (buf) { try { values = (parseJsonLoose(buf.toString('utf8')).values ?? []).map((v) => (typeof v === 'string' ? v : v.id)); } catch { /* bad tag */ } }
  tagFileCache.set(tagId, values);
  return values;
}
function iconForItem(id, info, depth = 0) {
  const [ns, p] = id.replace(/^#/, '').split(':');
  if (info.tag) {
    const segs = p.split('/');
    if (segs.length >= 2 && TAG_FOLDER[segs[0]]) {
      const mat = segs.slice(1).join('_');
      const pattern = TAG_FOLDER[segs[0]];
      const real = `gtceu:${pattern.replace('%s', mat)}`;
      if (items[real] && !items[real].tag) return iconForItem(real, items[real], depth + 1);
      const mi = materialIcon(mat, pattern);
      if (mi) return mi;
    }
    if (depth > 3) return null;
    for (const v of tagValues(`${ns}:${p}`)) {
      const icon = v.startsWith('#') ? iconForItem(v, { tag: true, unit: info.unit }, depth + 1) : iconForItem(v, { unit: info.unit }, depth + 1);
      if (icon) return icon;
    }
    return null;
  }
  if (info.unit === 'mB') {
    if (ns === 'minecraft' && (p === 'water' || p === 'lava')) {
      const t = iconTexture(`minecraft:block/${p}_still`);
      return t ? [t, p === 'water' ? '#3f76e4' : null] : null;
    }
    const base = p.replace(/^(liquid|molten)_/, '').replace(/_plasma$/, '');
    const custom = iconTexture(`${ns}:block/fluids/fluid.${p}`) ?? (ns === 'gtceu' ? iconTexture(`gtceu:block/fluids/fluid.${base}`) : null);
    if (custom) return [custom];
    const state = /^molten_/.test(p) ? 'molten' : /_plasma$/.test(p) ? 'plasma' : GAS_FLUIDS.test(base) ? 'gas' : 'liquid';
    const t = iconTexture(`gtceu:block/material_sets/dull/${state}`);
    return t ? [t, info.color] : null;
  }
  if (ns === 'gtceu') {
    const sm = splitMaterial(p);
    if (sm) {
      const mi = materialIcon(sm.material, sm.pattern);
      if (mi) return mi;
    }
  }
  return modelIcon(ns, p)
    ?? (iconTexture(`${ns}:item/${p}`) ? [iconTexture(`${ns}:item/${p}`)] : null)
    ?? (iconTexture(`${ns}:block/${p}`) ? [iconTexture(`${ns}:block/${p}`)] : null);
}
// With an export, items other than GT material forms and fluids use the game's own render
// (64px, scaled to a 16px cell on a sprite sheet: refs "skygreg:atlas-N#i").
const ATLAS_CELL = 16, ATLAS_ROW = 64, ATLAS_SHEET = ATLAS_ROW * ATLAS_ROW;
const atlasFiles = []; // cell -> image file
const atlasIndex = new Map();
const atlasRef = (file) => {
  if (!atlasIndex.has(file)) { atlasIndex.set(file, atlasFiles.length); atlasFiles.push(file); }
  const i = atlasIndex.get(file);
  return `${profile}:atlas-${Math.floor(i / ATLAS_SHEET)}#${i % ATLAS_SHEET}`;
};
function exportImage(id, info) {
  if (info.unit === 'mB') return exportImages.get(`fluid|${id}`) ?? null;
  if (info.tag) return exportTagFirst.has(id) ? exportImage(exportTagFirst.get(id), {}) : null;
  return exportImages.get(id) ?? exportImages.get(id.replace(/#.*$/, '')) ?? null;
}
function exportIcon(id, info) {
  const [ns, p] = id.replace(/^#/, '').split(':');
  const drawn = info.unit === 'mB' || info.tag || (ns === 'gtceu' && splitMaterial(p) && materialIcon(splitMaterial(p).material, splitMaterial(p).pattern));
  if (drawn) {
    const icon = iconForItem(id, info);
    if (icon) return icon;
  }
  const file = exportImage(id, info);
  if (file) return [atlasRef(file)];
  return info.unit === 'mB' || info.tag ? null : iconForItem(id, info);
}
async function drawExportAtlases() {
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../promo/package.json', import.meta.url));
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const dir = path.join(outDir, 'textures', profile);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^atlas-\d+\.png$/.test(f)) fs.rmSync(path.join(dir, f));
  // NBT variants go on the last sheets, which normal use rarely loads.
  const old = new Map(atlasFiles.map((f, i) => [`${profile}:atlas-${Math.floor(i / ATLAS_SHEET)}#${i % ATLAS_SHEET}`, f]));
  atlasFiles.length = 0;
  atlasIndex.clear();
  const order = Object.entries(items).filter(([, it]) => it.icon && old.has(it.icon[0]))
    .sort(([a], [b]) => Number(a.includes('#') && !a.startsWith('#')) - Number(b.includes('#') && !b.startsWith('#')));
  for (const [, it] of order) it.icon[0] = atlasRef(old.get(it.icon[0]));
  const colorOf = new Map();
  const sheets = Math.ceil(atlasFiles.length / ATLAS_SHEET);
  for (let s = 0; s < sheets; s++) {
    const n = Math.min(ATLAS_SHEET, atlasFiles.length - s * ATLAS_SHEET);
    const W = ATLAS_ROW * ATLAS_CELL, H = Math.ceil(n / ATLAS_ROW) * ATLAS_CELL;
    const canvas = createCanvas(W, H);
    const out = canvas.getContext('2d').createImageData(W, H);
    for (let k = 0; k < n; k++) {
      const file = atlasFiles[s * ATLAS_SHEET + k];
      const img = await loadImage(file).catch(() => null);
      if (!img) continue;
      const w = img.width, f = Math.max(1, Math.floor(w / ATLAS_CELL));
      const src = createCanvas(w, w), sg = src.getContext('2d');
      sg.drawImage(img, 0, 0, w, w, 0, 0, w, w); // first frame of animated strips
      const d = sg.getImageData(0, 0, w, w).data;
      const x0 = (k % ATLAS_ROW) * ATLAS_CELL, y0 = Math.floor(k / ATLAS_ROW) * ATLAS_CELL;
      let cr = 0, cg = 0, cb = 0, cn = 0;
      for (let y = 0; y < ATLAS_CELL; y++) for (let x = 0; x < ATLAS_CELL; x++) {
        // Box filter, alpha-weighted so edges don't darken.
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
          const q = ((y * f + dy) * w + (x * f + dx)) * 4, al = d[q + 3];
          r += d[q] * al; g += d[q + 1] * al; b += d[q + 2] * al; a += al;
        }
        if (!a) continue;
        const q = ((y0 + y) * W + x0 + x) * 4, alpha = a / (f * f);
        out.data[q] = r / a; out.data[q + 1] = g / a; out.data[q + 2] = b / a; out.data[q + 3] = alpha;
        if (alpha > 128) { cr += r / a; cg += g / a; cb += b / a; cn++; }
      }
      if (cn) colorOf.set(file, '#' + [cr, cg, cb].map((v) => Math.round(v / cn).toString(16).padStart(2, '0')).join(''));
    }
    canvas.getContext('2d').putImageData(out, 0, 0);
    fs.writeFileSync(path.join(dir, `atlas-${s}.png`), canvas.encodeSync('png'));
  }
  // Items drawn from a render take its average colour (wires and swatches use it).
  for (const it of Object.values(items)) {
    if (it.unit !== 'mB' && it.icon?.[0]?.startsWith(`${profile}:atlas-`)) {
      const cell = Number(/atlas-(\d+)/.exec(it.icon[0])[1]) * ATLAS_SHEET + Number(it.icon[0].split('#')[1]);
      const c = colorOf.get(atlasFiles[cell]);
      if (c) it.color = c;
    }
  }
  console.log(`  ${atlasFiles.length} rendered icons on ${sheets} sprite sheets in textures/${profile}`);
}
{
  let withIcon = 0;
  for (const [id, info] of Object.entries(items)) {
    let icon = null;
    try { icon = exportDir ? exportIcon(id, info) : iconForItem(id, info); } catch { /* leave the colour swatch */ }
    if (!icon) continue;
    while (icon.length > 1 && icon[icon.length - 1] == null) icon.pop();
    info.icon = icon;
    withIcon++;
  }
  console.log(`  item icons: ${withIcon} / ${Object.keys(items).length}`);
  if (exportDir) await drawExportAtlases();
}

// Tiered hull textures for single-block machines (switch with the selected tier).
const tierCasings = {};
for (const t of TIERS) {
  const url = copyTexture(`gtceu:block/casings/voltage/${t.toLowerCase()}/side`);
  if (url) tierCasings[t] = url;
}

const machines = {};
for (const type of [...typesSeen].sort()) {
  const kube = kubeMachines.find((m) => m.types.includes(type));
  const runsIn = kubeMachines.filter((m) => m.types.includes(type)).map((m) => L(`block.gtceu.${m.name}`) ?? m.displayName ?? titleCase(m.name));
  const isGen = recipes.some((r) => r.type === type && r.gen) || recipeTypeIO[type] === 'out' || GT_GENERATOR_TYPES.has(type);
  // A tiered single-block machine exists for this type (e.g. block.gtceu.hv_chemical_reactor).
  const hasTieredMachine = TIERS.some((t) => L(`block.gtceu.${t.toLowerCase()}_${type}`) != null);
  const isMultiblock = GT_MULTIBLOCK_TYPES.has(type) || (!hasTieredMachine && kube?.kind === 'multiblock');
  const kind = isGen ? 'generator' : isMultiblock ? 'multiblock' : 'single';

  let overlay = null;
  let casing = null;
  let tiered = false;
  // Use the pack's textures only for recipe types the pack itself registered.
  if (isMultiblock && kube && type in recipeTypeIO) {
    const ovRef = kube.textures.find((t) => /block\/(multiblock|machines|generators)\//.test(t));
    const caRef = kube.textures.find((t) => t !== ovRef);
    if (ovRef) overlay = resolveOverlay(ovRef);
    if (caRef) casing = resolveCasing(caRef);
  }
  if (!overlay) {
    const candidates = [
      ...(OVERLAY_ALIASES[type] ?? []),
      `gtceu:block/machines/${type}`,
      `gtceu:block/multiblock/${type}`,
      `gtceu:block/generators/${type}`,
      `gtceu:block/multiblock/generator/${type}`,
    ];
    for (const c of candidates) {
      overlay = resolveOverlay(c);
      if (overlay) break;
    }
  }
  if (!casing) {
    if (isMultiblock) {
      casing = resolveCasing(MULTIBLOCK_CASINGS[type] ?? DEFAULT_MULTI_CASING);
    } else {
      tiered = true;
    }
  }

  machines[type] = {
    name: L(`gtceu.${type}`) ?? exportMachineNames[type] ?? (kube && L(`block.gtceu.${kube.name}`)) ?? titleCase(type),
    kind,
    ...(isMultiblock ? { multiblock: true } : {}),
    ...(overlay ? { overlay } : {}),
    ...(casing ? { casing } : {}),
    ...(tiered ? { tiered: true } : {}),
    ...(runsIn.length ? { runsIn } : {}),
  };
}

// Crafting and other mods' recipe types (export only) run in no GregTech machine: no tiered hull.
const vanillaTexture = (ref) => { const k = iconTexture(ref); return k ? `textures/${k.replace(':', '/')}.png` : null; };
for (const type of exportOtherTypes) {
  const info = machines[type];
  if (!info) continue;
  delete info.tiered;
  info.manual = true;
  const overlay = type === 'crafting' ? vanillaTexture('minecraft:block/crafting_table_front') : null;
  const casing = vanillaTexture(type === 'crafting' ? 'minecraft:block/oak_planks' : 'minecraft:block/smooth_stone');
  if (overlay) info.overlay = overlay; else delete info.overlay;
  if (casing) info.casing = casing;
}

// ---------------------------------------------------------------- generators
const rotorStats = JSON.parse(fs.readFileSync(path.join(here, 'data', 'gtceu-rotor-stats.json'), 'utf8'));
const rotors = Object.entries(rotorStats)
  .filter(([id]) => id !== '_source')
  .map(([id, s]) => ({ id, name: materialName(id), power: s.power, efficiency: s.efficiency }))
  .sort((a, b) => a.power - b.power || a.efficiency - b.efficiency || a.name.localeCompare(b.name));

// Fluids the large engines consume on top of their fuel.
for (const id of ['gtceu:lubricant', 'gtceu:oxygen', 'gtceu:liquid_oxygen']) itemRef({ id, amount: 1, isTag: false }, 'mB');

const generatorVariants = {};
for (const [type, variants] of Object.entries(GENERATOR_VARIANTS)) {
  if (!typesSeen.has(type)) continue;
  generatorVariants[type] = variants.map((v) => {
    if (v.kind === 'single') return { id: v.id, kind: 'single', name: machines[type]?.name ?? titleCase(type), maxTier: v.maxTier };
    const overlay = resolveOverlay(v.overlay);
    const casing = resolveCasing(v.casing);
    return {
      id: v.id,
      kind: v.kind,
      name: L(`block.gtceu.${v.id}`) ?? titleCase(v.id),
      tier: v.tier,
      ...(v.boost ? { boost: v.boost } : {}),
      ...(v.steamScale ? { steamScale: v.steamScale, steamPerTick: v.steamPerTick } : {}),
      ...(overlay ? { overlay } : {}),
      ...(casing ? { casing } : {}),
    };
  });
}

// Multiblocks that can run a processing recipe type instead of its basic machine.
// GCYM (merged into GTCEu 7.x) all take parallel control hatches; the pack's own KubeJS
// multiblocks do when they list GTRecipeModifiers.PARALLEL_HATCH.
const GCYM_MULTIS = {
  large_maceration_tower: ['macerator'], large_chemical_bath: ['chemical_bath', 'ore_washer'],
  large_centrifuge: ['centrifuge', 'thermal_centrifuge'], large_mixer: ['mixer'], large_electrolyzer: ['electrolyzer'],
  large_electromagnet: ['electromagnetic_separator', 'polarizer'], large_packer: ['packer'], large_assembler: ['assembler'],
  large_circuit_assembler: ['circuit_assembler'], large_arc_smelter: ['arc_furnace'], large_engraving_laser: ['laser_engraver'],
  large_sifting_funnel: ['sifter'], large_material_press: ['bender', 'compressor', 'forge_hammer', 'forming_press'],
  large_brewer: ['brewery', 'fermenter', 'fluid_heater'], large_cutter: ['cutter', 'lathe'],
  large_distillery: ['distillery', 'distillation_tower'], large_extractor: ['extractor', 'canner'], large_extruder: ['extruder'],
  large_solidifier: ['fluid_solidifier'], large_wiremill: ['wiremill'], large_autoclave: ['autoclave'],
  mega_blast_furnace: ['electric_blast_furnace'], mega_vacuum_freezer: ['vacuum_freezer'],
};
const GCYM_CASINGS = {
  large_maceration_tower: 'secure_maceration_casing', large_chemical_bath: 'watertight_casing', large_centrifuge: 'vibration_safe_casing',
  large_mixer: 'reaction_safe_mixing_casing', large_electrolyzer: 'nonconducting_casing', large_electromagnet: 'nonconducting_casing',
  large_packer: 'tungstensteel', large_assembler: 'large_scale_assembling_casing', large_circuit_assembler: 'large_scale_assembling_casing',
  large_arc_smelter: 'high_temperature_smelting_casing', large_engraving_laser: 'laser_safe_engraving_casing', large_sifting_funnel: 'vibration_safe_casing',
  large_material_press: 'stress_proof_casing', large_brewer: 'corrosion_proof_casing', large_cutter: 'shock_proof_cutting_casing',
  large_distillery: 'watertight_casing', large_extractor: 'watertight_casing', large_extruder: 'stress_proof_casing',
  large_solidifier: 'watertight_casing', large_wiremill: 'stress_proof_casing', large_autoclave: 'watertight_casing',
  mega_blast_furnace: 'high_temperature_smelting_casing', mega_vacuum_freezer: 'atomic_casing',
};
const machineVariants = {};
const addVariant = (type, v) => {
  if (!typesSeen.has(type)) return;
  (machineVariants[type] ??= []).push(v);
};
for (const [id, types] of Object.entries(GCYM_MULTIS)) {
  const name = L(`block.gtceu.${id}`);
  if (!name) continue;
  const overlay = resolveOverlay(`gtceu:block/multiblock/gcym/${id}`);
  const casing = resolveCasing(`gtceu:block/casings/gcym/${GCYM_CASINGS[id] ?? 'blank_casing'}`);
  for (const t of types) addVariant(t, { id, name, parallel: true, ...(overlay ? { overlay } : {}), ...(casing ? { casing } : {}) });
}
for (const m of kubeMachines) {
  if (m.kind !== 'multiblock') continue;
  const name = L(`block.gtceu.${m.name}`) ?? m.displayName ?? titleCase(m.name);
  let overlay = null;
  let casing = null;
  for (const t of m.textures) {
    if (!overlay && !/casing/.test(t)) overlay = resolveOverlay(t);
    if (!casing && /casing/.test(t)) casing = resolveCasing(t);
  }
  for (const t of m.types) {
    // A type's own (only) machine is not an alternative (e.g. the pack's 'desulfurizer' recipe type),
    // but it may take a parallel hatch itself (the Advanced Greenhouse does).
    if (t === m.name) {
      if (m.parallel && machines[t]) machines[t].parallel = true;
      continue;
    }
    addVariant(t, { id: m.name, name, parallel: !!m.parallel, ...(overlay ? { overlay } : {}), ...(casing ? { casing } : {}) });
  }
}
console.log(`  multiblock alternatives for ${Object.keys(machineVariants).length} recipe types`);

// ---------------------------------------------------------------- write
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gtceuVersion: gtVersion,
  sources: exportStats
    ? { kubejs: recipes.filter((r) => r.source === 'kubejs').length, gtceu: recipes.filter((r) => r.source !== 'kubejs').length, builtin: 0, removedByPack: 0, hasDump: true, export: exportStats }
    : { kubejs: kjs.recipes.length, gtceu: dumpCount, builtin: builtinCount, removedByPack: removedCount, hasDump: !!dumpRoot },
  tierCasings,
  machines,
  generatorVariants,
  machineVariants,
  rotors,
  items,
  recipes,
};
const outFile = path.join(outDir, 'data', profile === 'base' ? 'recipes-base.json' : 'recipes.json');
fs.writeFileSync(outFile, JSON.stringify(out));
// Small summary per profile for the app's modpack menu (recipe counts without loading 12 MB).
{
  const packsFile = path.join(outDir, 'data', 'packs.json');
  let packs = {};
  try { packs = JSON.parse(fs.readFileSync(packsFile, 'utf8')); } catch { /* first run */ }
  packs[profile] = { recipes: recipes.length, generatedAt: out.generatedAt };
  fs.writeFileSync(packsFile, JSON.stringify(packs, null, 2));
}
console.log(`Wrote ${recipes.length} recipes, ${Object.keys(items).length} items, ${Object.keys(machines).length} machine types`);
console.log(`  -> ${path.relative(rootDir, outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
console.log(`  -> ${[...copiedTextures.values()].filter(Boolean).length} textures in ${path.relative(rootDir, texturesOut)}`);
if (kjs.autoGlobals.length) console.log(`  (mocked unknown KubeJS globals: ${kjs.autoGlobals.join(', ')})`);
