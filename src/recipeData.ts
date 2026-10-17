import { useEffect, useState } from 'react';
import { TIER_ORDER, TIERS, type GeneratorVariant, type MachineInfo, type MachineVariant, type MachineKind, type MachineRecipe, type RecipeItem, type RotorInfo, type VoltageTier } from './types';

// Shape of public/data/recipes.json, written by scripts/import-recipes.mjs
interface RawItemRef { id: string; amount: number; chance?: number; consumed?: false; fixed?: true }
interface RawRecipe {
  id: string;
  type: string;
  source: 'kubejs' | 'gtceu' | 'builtin';
  tier: string;
  eut: number;
  ticks: number;
  inputs: RawItemRef[];
  outputs: RawItemRef[];
  gen?: boolean;
  boiler?: boolean;
  nonGT?: boolean;
  circuit?: number;
  startEU?: number;
  conditions?: string[];
}
interface RawData {
  generatedAt: string;
  gtceuVersion: string | null;
  sources: { kubejs: number; gtceu: number; builtin: number; removedByPack: number; hasDump: boolean; export?: { pack: string; read: number; kept: number } };
  tierCasings: Partial<Record<VoltageTier, string>>;
  machines: Record<string, MachineInfo>;
  generatorVariants?: Record<string, GeneratorVariant[]>;
  machineVariants?: Record<string, MachineVariant[]>;
  rotors?: RotorInfo[];
  items: Record<string, RawItemInfo>;
  recipes: RawRecipe[];
  // Big packs (GTNH) ship their recipes compact and split: see unpack().
  packed?: { parts: number; file: string; items: string[]; types: string[]; idPrefix: string };
}
/** A compact recipe from a split file: items and machine types by number. */
interface PackedRecipe { t: number; n: number; e: number; d: number; i: number[][]; o: number[][]; c?: number; h?: number; g?: 1 }

/** Rebuild the recipe list of a packed pack from its parts (in order). */
export function unpack(raw: RawData, parts: PackedRecipe[][]): RawData {
  const p = raw.packed!;
  const tierOf = (eut: number) => TIER_ORDER.find((t) => TIERS[t].voltage >= eut) ?? 'MAX';
  const recipes: RawRecipe[] = [];
  for (const part of parts) for (const r of part) {
    const type = p.types[r.t];
    recipes.push({
      id: `${p.idPrefix}${type}/${r.n}`, type, source: 'gtceu', tier: tierOf(r.e), eut: r.e, ticks: r.d,
      inputs: r.i.map(([k, amount, flag]) => ({ id: p.items[k], amount, ...(flag === 0 ? { consumed: false as const } : {}) })),
      outputs: r.o.map(([k, amount, chance]) => ({ id: p.items[k], amount, ...(chance != null ? { chance } : {}) })),
      ...(r.c != null ? { circuit: r.c } : {}),
      ...(r.h ? { temp: r.h } : {}),
      ...(r.g ? { gen: true } : {}),
    } as RawRecipe);
  }
  return { ...raw, recipes };
}
interface RawItemInfo { name: string; color: string; unit: 'mB' | 'item'; tag?: boolean; nonGT?: boolean; icon?: ItemIconSpec; group?: string; variant?: string }

/** [base texture, tint?, overlay?, secondary texture?, secondary tint?]; textures are "ns:path". */
export type ItemIconSpec = [string, (string | null)?, (string | null)?, (string | null)?, (string | null)?];
const iconRegistry = new Map<string, ItemIconSpec>();
let iconVersion = 0;
const iconListeners = new Set<() => void>();
/** For useSyncExternalStore: icons arrive when the database loads, after first render. */
export const subscribeIcons = (cb: () => void) => { iconListeners.add(cb); return () => { iconListeners.delete(cb); }; };
export const getIconVersion = () => iconVersion;
/** Icon for an item id (filled once the recipe database has loaded). */
export const itemIcon = (id: string) => iconRegistry.get(id);
export const textureUrl = (ref: string) => {
  const i = ref.indexOf(':');
  const hash = ref.indexOf('#'); // sprite sheet cell (GTNH icons): "ns:sheet#index"
  return `${import.meta.env.BASE_URL}textures/${ref.slice(0, i)}/${ref.slice(i + 1, hash < 0 ? undefined : hash)}.png`;
};
/** Cell of a sprite sheet ref ("gtnh:atlas-0#12"): 16px cells, 64 per row. */
export const atlasCell = (ref: string) => {
  const hash = ref.indexOf('#');
  if (hash < 0) return null;
  const k = Number(ref.slice(hash + 1));
  return { x: (k % 64) * 16, y: Math.floor(k / 64) * 16, size: 16 };
};

export interface RecipeDatabase {
  recipes: MachineRecipe[];
  byId: Map<string, MachineRecipe>;
  producers: Map<string, MachineRecipe[]>; // item id -> recipes that output it
  consumers: Map<string, MachineRecipe[]>; // item id -> recipes that consume it
  machines: Record<string, MachineInfo>;
  generatorVariants: Record<string, GeneratorVariant[]>;
  machineVariants: Record<string, MachineVariant[]>;
  rotors: RotorInfo[];
  items: RecipeItem[]; // every known item/fluid, for Input nodes
  itemById: Map<string, RecipeItem & { nonGT?: boolean }>;
  groups: Map<string, RecipeItem[]>; // same-name items (GTNH ore types), by group name
  tierCasings: Partial<Record<VoltageTier, string>>;
  meta: RawData['sources'] & { generatedAt: string; gtceuVersion: string | null };
}

const BASE = import.meta.env?.BASE_URL ?? '/';
export const assetUrl = (rel: string) => `${BASE}${rel}`;
/** Hash of the recipe files at build time (see vite.config.ts); '0' when run outside Vite. */
const DATA_VERSION = typeof __DATA_VERSION__ === 'string' ? __DATA_VERSION__ : '0';

/**
 * Multiblocks with their own recipe type that take a parallel hatch (Sky Greg's Advanced Greenhouse)
 * get a "self" variant, so the card offers the hatch even though there is no other machine to pick.
 */
function withOwnHatches(raw: RawData): Record<string, MachineVariant[]> {
  const out: Record<string, MachineVariant[]> = { ...(raw.machineVariants ?? {}) };
  for (const [type, m] of Object.entries(raw.machines)) {
    if (!m.parallel) continue;
    const self: MachineVariant = { id: type, name: m.name, parallel: true, self: true, ...(m.overlay ? { overlay: m.overlay } : {}), ...(m.casing ? { casing: m.casing } : {}) };
    out[type] = [self, ...(out[type] ?? []).filter((v) => v.id !== type)];
  }
  return out;
}

export function hydrate(raw: RawData): RecipeDatabase {
  const item = (ref: RawItemRef): RecipeItem => {
    const info = raw.items[ref.id];
    return {
      id: ref.id,
      name: info?.name ?? ref.id,
      amount: ref.amount,
      unit: info?.unit ?? 'item',
      iconColor: info?.color,
      ...(ref.chance != null ? { chance: ref.chance } : {}),
      ...(ref.consumed === false ? { consumed: false } : {}),
      ...(ref.fixed ? { fixed: true } : {}),
      ...(info?.tag ? { isTag: true } : {}),
      ...(info?.group ? { group: info.group, variant: info.variant } : {}),
    };
  };

  const recipes: MachineRecipe[] = raw.recipes.map((r) => {
    const machine = raw.machines[r.type];
    const outputs = r.outputs.map(item);
    const inputs = r.inputs.map(item);
    const kind: MachineKind = r.gen ? 'generator' : machine?.kind ?? 'single';
    const primary = r.gen || r.boiler ? inputs.find((i) => i.consumed !== false) : outputs[0];
    return {
      id: r.id,
      machineId: r.type,
      machineName: machine?.name ?? r.type,
      recipeName: primary ? primary.name : r.id.split('/').pop() ?? r.id,
      baseTier: (TIER_ORDER.includes(r.tier as VoltageTier) ? r.tier : 'ULV') as VoltageTier,
      baseEUt: r.eut,
      baseDurationSec: r.ticks / 20,
      durationTicks: r.ticks,
      inputs,
      outputs,
      kind,
      multiblock: !!machine?.multiblock,
      generatesEU: !!r.gen,
      ...(r.boiler ? { boiler: true } : {}),
      ...(r.nonGT ? { nonGT: true } : {}),
      ...(machine?.manual ? { manual: true } : {}),
      ...(r.circuit != null ? { circuit: r.circuit } : {}),
      ...(r.startEU ? { startEU: r.startEU } : {}),
      ...(r.conditions ? { conditions: r.conditions } : {}),
      source: r.source,
    };
  });

  const byId = new Map<string, MachineRecipe>();
  const producers = new Map<string, MachineRecipe[]>();
  const consumers = new Map<string, MachineRecipe[]>();
  const push = (map: Map<string, MachineRecipe[]>, key: string, r: MachineRecipe) => {
    const list = map.get(key);
    if (list) { if (list[list.length - 1] !== r) list.push(r); } else map.set(key, [r]);
  };
  for (const r of recipes) {
    byId.set(r.id, r);
    for (const o of r.outputs) push(producers, o.id, r);
    for (const i of r.inputs) push(consumers, i.id, r);
  }

  const itemById = new Map<string, RecipeItem & { nonGT?: boolean }>();
  for (const [id, info] of Object.entries(raw.items)) {
    if (info.icon) iconRegistry.set(id, info.icon);
    itemById.set(id, { id, name: info.name, amount: 1, unit: info.unit, iconColor: info.color, ...(info.tag ? { isTag: true } : {}), ...(info.nonGT ? { nonGT: true } : {}), ...(info.group ? { group: info.group, variant: info.variant } : {}) });
  }
  const groups = new Map<string, RecipeItem[]>();
  for (const it of itemById.values()) if (it.group) { const g = groups.get(it.group); if (g) g.push(it); else groups.set(it.group, [it]); }
  // GregTech's own types first (plain stone before the rest), so a group opens on the usual one.
  const rank = (it: RecipeItem) => (it.id.startsWith('gregtech:') ? 0 : it.id.startsWith('minecraft:') ? 1 : 2) + (it.variant === 'Stone' ? -0.5 : 0);
  for (const g of groups.values()) g.sort((a, b) => rank(a) - rank(b) || (a.variant ?? '').localeCompare(b.variant ?? ''));

  iconVersion++;
  for (const cb of iconListeners) cb();

  return {
    recipes,
    byId,
    producers,
    consumers,
    machines: raw.machines,
    generatorVariants: raw.generatorVariants ?? {},
    machineVariants: withOwnHatches(raw),
    rotors: raw.rotors ?? [],
    items: [...itemById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    itemById,
    groups,
    tierCasings: raw.tierCasings ?? {},
    meta: { ...raw.sources, generatedAt: raw.generatedAt, gtceuVersion: raw.gtceuVersion },
  };
}

/**
 * Heuristic tag <-> item match for tags we can't resolve without the game's tag data,
 * e.g. '#forge:dusts/redstone' matches 'minecraft:redstone' / 'gtceu:redstone_dust'.
 */
export function tagMatchesItem(tag: string, itemId: string): boolean {
  // GTNH "any variant" ingredients: #mod:item:* matches mod:item:<any meta>.
  if (tag.endsWith(':*')) return itemId.startsWith(tag.slice(1, -1));
  const t = tag.replace(/^#/, '');
  const [, tagPath = t] = t.split(':');
  const [, itemPath = itemId] = itemId.split(':');
  const segs = tagPath.split('/');
  if (segs.length === 1) return itemPath === segs[0] || itemPath.endsWith(`_${segs[0]}`);
  const material = segs.slice(1).join('_');
  const prefix = segs[0].replace(/s$/, ''); // dusts -> dust, impure_dusts -> impure_dust
  const parts = prefix.split('_');
  const candidates = [material, `${material}_${prefix}`, `${prefix}_${material}`];
  // GTCEu ids wrap the material: impure_dusts/x -> impure_x_dust, double_plates/x -> double_x_plate
  if (parts.length > 1) candidates.push(`${parts.slice(0, -1).join('_')}_${material}_${parts[parts.length - 1]}`);
  if (segs[0] === 'storage_blocks') candidates.push(`${material}_block`);
  if (segs[0] === 'raw_materials') candidates.push(`raw_${material}`);
  return candidates.includes(itemPath);
}

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; db: RecipeDatabase }
  | { status: 'error'; message: string };

/** Modpacks the calculator has data for (see scripts/import-recipes.mjs --profile). */
export const MODPACKS = [
  { id: 'base', name: 'GregTech', file: 'data/recipes-base.json' },
  { id: 'skygreg', name: 'Sky Greg', file: 'data/recipes.json' },
  { id: 'gtnh', name: 'GT New Horizons', file: 'data/recipes-gtnh.json' },
] as const;
export type ModpackId = (typeof MODPACKS)[number]['id'];

export function useRecipeDatabase(pack: ModpackId = 'skygreg'): LoadState {
  const file = MODPACKS.find((m) => m.id === pack)?.file ?? 'data/recipes.json';
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    // Versioned by the data's own hash (vite.config.ts), so browsers keep it until it changes.
    fetch(`${assetUrl(file)}?v=${DATA_VERSION}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<RawData>;
      })
      .then(async (raw) => {
        if (!raw.packed) return raw;
        // Split packs: every part at once, then put the recipe list back together.
        const parts = await Promise.all(Array.from({ length: raw.packed.parts }, (_, k) =>
          fetch(`${assetUrl(raw.packed!.file.replace('{k}', String(k)))}?v=${DATA_VERSION}`).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json() as Promise<PackedRecipe[]>;
          })));
        return unpack(raw, parts);
      })
      .then((raw) => { if (!cancelled) setState({ status: 'ready', db: hydrate(raw) }); })
      .catch((e) => {
        if (!cancelled) setState({ status: 'error', message: `Could not load data/recipes.json (${e.message}). Run "npm run import-recipes".` });
      });
    return () => { cancelled = true; };
  }, [file]);
  return state;
}

/** Can `a` feed `b` (or vice versa)? Same fluid/item, or a tag that matches the item. */
export function itemsMatch(a: RecipeItem, b: RecipeItem): boolean {
  if (a.unit !== b.unit) return false;
  if (a.id === b.id) return true;
  if (a.isTag && !b.isTag) return tagMatchesItem(a.id, b.id);
  if (b.isTag && !a.isTag) return tagMatchesItem(b.id, a.id);
  return false;
}
