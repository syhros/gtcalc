import { TIER_ORDER, type MachineRecipe, type RecipeItem, type VoltageTier } from './types';
import type { RecipeDatabase } from './recipeData';

/**
 * Best Route: pick a chain of recipes that makes the requested items from raw resources.
 *
 * Every item gets a cost per unit (one item, or 1000 mB of fluid). A recipe's cost is its own
 * running cost plus the cost of what it eats; an output costs that total divided by how much
 * of it one craft makes. Costs settle cheapest-first (Knuth's generalisation of Dijkstra), so
 * each item ends up with its cheapest finite chain and loops never win.
 *
 * Running cost balances power and machine count: seconds per craft x (1 + EU/t / 128), plus a
 * flat step cost so short chains beat long ones. Mined resources (ores, logs, water, oil) are
 * cheap and stop the chain. Anything else no allowed recipe makes is priced as "supply it
 * yourself", high enough that a real chain wins when one exists.
 *
 * The output being routed pays for the whole craft. The solver sizes each machine for the
 * output it's linked by, so by-products end up as spare and shouldn't make a recipe look cheap.
 */

export interface RoutePlan {
  nodes: { key: string; recipe: MachineRecipe; depth: number }[];
  /** `to` null means the node the route was requested for. */
  links: { from: string; outId: string; to: string | null; inId: string }[];
  /** Items left for the player to supply (mined resources and anything no allowed recipe makes). */
  raw: RecipeItem[];
  /** Requested items that no allowed recipe makes at all. */
  missing: RecipeItem[];
}

const MINED_COST = 20; // per ore, log or block: someone has to mine it
const PUMPED_COST = 1; // per bucket of water, lava, oil...: a pump runs forever
const NO_RECIPE = 1e5; // nothing makes it (or nothing within the max tier): you supply it
const UNREACHED = 1e8; // recipes make it, but none could be finished from what's available
const STEP = 2; // flat cost per recipe in the chain
const BYPRODUCT_SHARE = 0.5; // how much of a recipe's cost its other outputs carry, per unit
const MAX_DEPTH = 16;
const MAX_NODES = 80;

// Things you mine, pump or chop: the chain stops here even if some recipe makes them.
const MINED = /(_ore$|^#forge:ores|^#forge:raw_materials|_log$|_logs$|^#minecraft:logs|:(water|lava|cobblestone|stone|gravel|sand|red_sand|dirt|netherrack|end_stone|clay_ball|ice|snowball|flint|oil|oil_heavy|oil_light|oil_medium|natural_gas|salt_water|crude_oil)$)/;
/** Raw ore items (raw_iron) count as mined; raw_ fluids (raw gasoline) are products. */
// GTNH ids end in ":<meta>"; GT5 ore blocks and vanilla logs are mined too.
const GTNH_MINED = /(gt\.blockores|:blockores|^minecraft:(log2?|cobblestone|stone|gravel|sand|dirt|netherrack|end_stone|clay_ball|ice|snowball|flint|obsidian):\d+$|^fluid:(water|lava|air|oil|oilheavy|oilmedium|oillight|liquid_natural_gas|naturalgas|saltwater))/;
const isMined = (db: RecipeDatabase, id: string) => GTNH_MINED.test(id) ||
  (MINED.test(id) && !/(crushed|purified|refined|impure|pure|centrifuged)_/.test(id)) || (/:raw_/.test(id) && !/rubber/.test(id) && db.itemById.get(id)?.unit === 'item');
// Machines that never make sense in a production chain (the air scrubber only cleans up pollution).
// GTNH: tree farms, fishing ports and matter fabricators make things from nothing, so they'd win every route.
const EXCLUDED_MACHINE = /scanner|research|air scrubber|recycl|disassembl|replicat|mass fab|amplifab|uncrafting|creative|tree growth|fishing port|matter fabricator|matter amplifier|eye of harmony|space project/i;

const unitAmount = (i: RecipeItem) => (i.unit === 'mB' ? i.amount / 1000 : i.amount) * (i.chance ?? 1);
const pathOf = (id: string) => id.slice(id.indexOf(':') + 1);

/** Items a tag stands for, among the ids given (same rules as tagMatchesItem, as lookups). */
function tagIndex(ids: Iterable<string>) {
  const byPath = new Map<string, string[]>();
  const bySuffix = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, id: string) => { const l = m.get(k); if (l) l.push(id); else m.set(k, [id]); };
  for (const id of ids) {
    if (id.startsWith('#')) continue;
    const p = pathOf(id);
    add(byPath, p, id);
    for (let k = p.indexOf('_'); k >= 0; k = p.indexOf('_', k + 1)) add(bySuffix, p.slice(k + 1), id);
  }
  return (tag: string): string[] => {
    const segs = pathOf(tag.replace(/^#/, '')).split('/');
    if (segs.length === 1) return [...(byPath.get(segs[0]) ?? []), ...(bySuffix.get(segs[0]) ?? [])];
    const material = segs.slice(1).join('_');
    const prefix = segs[0].replace(/s$/, '');
    const parts = prefix.split('_');
    const candidates = [`${material}_${prefix}`, `${prefix}_${material}`];
    if (parts.length > 1) candidates.push(`${parts.slice(0, -1).join('_')}_${material}_${parts[parts.length - 1]}`);
    if (segs[0] === 'storage_blocks') candidates.push(`${material}_block`);
    if (segs[0] === 'raw_materials') candidates.push(`raw_${material}`);
    const found = candidates.flatMap((c) => byPath.get(c) ?? []);
    // The bare material (dusts/emerald -> minecraft:emerald) only when no proper form exists,
    // so ender pearl dust never resolves to ender pearls.
    return found.length ? found : byPath.get(material) ?? [];
  };
}

interface Costs { cost: Map<string, number>; best: Map<string, MachineRecipe>; members: (tag: RecipeItem) => string[] }
const cache = new WeakMap<RecipeDatabase, Map<VoltageTier, Costs>>();

/** Cheapest cost per unit of every item, and the recipe that achieves it. Cached per pack and tier. */
function computeCosts(db: RecipeDatabase, maxTier: VoltageTier): Costs {
  const hit = cache.get(db)?.get(maxTier);
  if (hit) return hit;
  const maxIdx = TIER_ORDER.indexOf(maxTier);
  const recipes = db.recipes.filter((r) =>
    !r.generatesEU && !r.boiler && r.kind !== 'supply' && r.outputs.length > 0 &&
    TIER_ORDER.indexOf(r.baseTier) <= maxIdx && !EXCLUDED_MACHINE.test(r.machineName) &&
    // Crafting grids would open loops (craft a tool, arc-smelt it back down): GregTech machines only.
    !r.manual);

  const unitOf = new Map<string, RecipeItem['unit']>();
  for (const r of recipes) for (const o of r.outputs) unitOf.set(o.id, o.unit);
  const produced = new Set(unitOf.keys());
  for (const i of db.items) if (!unitOf.has(i.id)) unitOf.set(i.id, i.unit);
  // Index every known item, not just made ones, so a tag finds its proper form (diamond gear)
  // even when no recipe makes it, instead of falling back to the bare material (diamond).
  const lookup = tagIndex(unitOf.keys());
  const memberCache = new Map<string, string[]>();
  const members = (tag: RecipeItem) => {
    let m = memberCache.get(tag.id);
    if (!m) { m = lookup(tag.id).filter((id) => unitOf.get(id) === tag.unit); memberCache.set(tag.id, m); }
    return m;
  };

  // Each recipe waits for its consumed inputs to settle; tags settle with their first member.
  const keys = recipes.map((r) => [...new Set(r.inputs.filter((i) => i.consumed !== false).map((i) => i.id))]);
  const pending = keys.map((k) => k.length);
  const consumers = new Map<string, number[]>();
  const tagsOfMember = new Map<string, string[]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  keys.forEach((k, idx) => k.forEach((id) => push(consumers, id, idx)));
  const tagItems = new Map<string, RecipeItem>();
  for (const r of recipes) for (const i of r.inputs) if (i.isTag && i.consumed !== false) tagItems.set(i.id, i);
  for (const [id, t] of tagItems) for (const m of members(t)) push(tagsOfMember, m, id);

  const cost = new Map<string, number>();
  const best = new Map<string, MachineRecipe>();
  const done = new Set<string>();
  // Binary heap of [cost, id].
  const heap: [number, string][] = [];
  const hpush = (c: number, id: string) => {
    heap.push([c, id]);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const hpop = () => {
    const top = heap[0]; const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const offer = (id: string, c: number, r?: MachineRecipe) => {
    if (done.has(id) || c >= (cost.get(id) ?? Infinity) - 1e-9) return;
    cost.set(id, c);
    if (r) best.set(id, r); else best.delete(id);
    hpush(c, id);
  };
  // A recipe's own cost is mostly the energy one craft takes (2,000 EU is worth about one mined
  // block), plus a little for machine time. Slow but cheap recipes (air separation) stay cheap:
  // more machines are easy, ores have to be mined.
  const own = (r: MachineRecipe) => STEP + (r.baseEUt * r.baseDurationSec / 100 + r.baseDurationSec * 0.05) * (r.multiblock ? 1.5 : 1);
  const inputCost = (r: MachineRecipe) => {
    let total = own(r);
    for (const i of r.inputs) if (i.consumed !== false) total += (cost.get(i.id) ?? Infinity) * unitAmount(i);
    return total;
  };
  const relax = (r: MachineRecipe) => {
    const total = inputCost(r);
    if (!Number.isFinite(total)) return;
    // Other outputs carry part of the cost (by-products count half), so a recipe that makes
    // nitrogen and oxygen together isn't charged in full for each, but a pile of by-products
    // doesn't make a long chain look free either.
    const outs = r.outputs.filter((o) => unitAmount(o) > 0 && !isMined(db, o.id) && !r.inputs.some((i) => i.id === o.id && i.consumed !== false));
    const units = outs.reduce((a, o) => a + unitAmount(o), 0);
    for (const o of outs) offer(o.id, total / (unitAmount(o) + BYPRODUCT_SHARE * (units - unitAmount(o))), r);
  };

  // Starting prices: mined resources are cheap, everything else is "supply it yourself".
  const allIds = new Set<string>([...unitOf.keys(), ...consumers.keys()]);
  for (const id of allIds) {
    if (isMined(db, id)) offer(id, unitOf.get(id) === 'mB' ? PUMPED_COST : MINED_COST);
    else if (id.startsWith('#')) offer(id, members(tagItems.get(id) ?? { id, name: id, amount: 1, unit: 'item', isTag: true }).some((m) => produced.has(m)) ? UNREACHED : NO_RECIPE);
    else offer(id, produced.has(id) ? UNREACHED : NO_RECIPE);
  }
  recipes.forEach((r, idx) => { if (!pending[idx]) relax(r); }); // gas collectors, rock breakers...

  const settle = (id: string) => {
    for (const idx of consumers.get(id) ?? []) if (--pending[idx] === 0) relax(recipes[idx]);
  };
  while (heap.length) {
    const [c, id] = hpop();
    if (done.has(id) || c > (cost.get(id) ?? Infinity) + 1e-9) continue;
    done.add(id);
    settle(id);
    for (const tag of tagsOfMember.get(id) ?? []) {
      if (done.has(tag)) continue;
      if (c < (cost.get(tag) ?? Infinity)) { cost.set(tag, c); best.delete(tag); }
      done.add(tag);
      settle(tag);
    }
  }
  const result = { cost, best, members };
  if (!cache.has(db)) cache.set(db, new Map());
  cache.get(db)!.set(maxTier, result);
  return result;
}

export function planRoute(db: RecipeDatabase, needs: RecipeItem[], maxTier: VoltageTier): RoutePlan {
  const { cost, best, members } = computeCosts(db, maxTier);
  const price = (id: string) => cost.get(id) ?? Infinity;

  // Build the chain: one node per recipe, shared when two machines need the same thing.
  const plan: RoutePlan = { nodes: [], links: [], raw: [], missing: [] };
  const placed = new Set<string>();
  const rawSeen = new Set<string>();
  const addRaw = (i: RecipeItem) => { if (!rawSeen.has(i.id)) { rawSeen.add(i.id); plan.raw.push(i); } };
  const resolve = (i: RecipeItem): string | null => {
    if (isMined(db, i.id)) return null;
    if (!i.isTag) return best.has(i.id) ? i.id : null;
    let pick: string | null = null;
    for (const id of members(i)) if (best.has(id) && (pick == null || price(id) < price(pick))) pick = id;
    return pick;
  };
  const expand = (item: RecipeItem, to: string | null, stack: Set<string>, depth: number) => {
    const id = resolve(item);
    const r = id ? best.get(id) : undefined;
    if (!id || !r || stack.has(id) || depth > MAX_DEPTH || (placed.size >= MAX_NODES && !placed.has(r.id))) {
      if (to == null && !id && !isMined(db, item.id)) plan.missing.push(item);
      addRaw(item);
      return;
    }
    plan.links.push({ from: r.id, outId: id, to, inId: item.id });
    if (placed.has(r.id)) return;
    placed.add(r.id);
    plan.nodes.push({ key: r.id, recipe: r, depth });
    const inner = new Set(stack).add(id).add(`r:${r.id}`);
    for (const i of r.inputs) if (i.consumed !== false) expand(i, r.id, inner, depth + 1);
  };
  for (const n of needs) expand(n, null, new Set(), 1);
  return plan;
}

/** Work out the costs ahead of time (they're cached), so the Best Route button answers at once. */
export function warmRouteCosts(db: RecipeDatabase, maxTier: VoltageTier) {
  computeCosts(db, maxTier);
}

/** Cost per unit Best Route has worked out for an item (for tests and tooltips). */
export function routeCost(db: RecipeDatabase, id: string, maxTier: VoltageTier) {
  const { cost, best } = computeCosts(db, maxTier);
  return { cost: cost.get(id), recipe: best.get(id)?.id };
}
