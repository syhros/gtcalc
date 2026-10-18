import { TIER_ORDER, type CanvasNode, type Connection, type RecipeItem, type VoltageTier } from './types';

/**
 * Flows from outside the app's own state (imported files, other people's shared builds, the
 * paste buffer) are checked here before the canvas or the solver sees them. A malformed card,
 * item or link is dropped, and a bad setting falls back to a safe default, so a damaged file
 * can't crash the page.
 */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v: unknown, fallback: number) => (finite(v) && v >= 0 ? v : fallback);
const positive = (v: unknown, fallback: number) => (finite(v) && v > 0 ? v : fallback);
const isTier = (v: unknown): v is VoltageTier => typeof v === 'string' && (TIER_ORDER as string[]).includes(v);
const without = (o: Obj, keys: string[]) => { const c = { ...o }; for (const k of keys) delete c[k]; return c; };

function cleanItem(v: unknown): RecipeItem | null {
  if (!isObj(v) || typeof v.id !== 'string' || !finite(v.amount) || v.amount < 0) return null;
  const item: Obj = { ...v, name: typeof v.name === 'string' ? v.name : v.id, unit: v.unit === 'mB' ? 'mB' : 'item' };
  if ('chance' in item) { if (finite(v.chance)) item.chance = Math.min(1, Math.max(0, v.chance)); else delete item.chance; }
  if ('perTick' in item && !finite(v.perTick)) item.perTick = 0;
  return item as unknown as RecipeItem;
}
const cleanItems = (v: unknown) => (Array.isArray(v) ? v.map(cleanItem).filter((i): i is RecipeItem => i != null) : []);

/** Generator setup: kept only if its tiers, rotor, boost and extras make sense. */
function cleanGen(v: unknown): Obj | undefined {
  if (!isObj(v) || typeof v.variantId !== 'string') return undefined;
  const g = without(v, [
    ...(['tier', 'maxTier', 'holderTier'] as const).filter((k) => k in v && !isTier(v[k])),
    ...(!('rotor' in v) || (isObj(v.rotor) && typeof v.rotor.id === 'string' && finite(v.rotor.power) && finite(v.rotor.efficiency)) ? [] : ['rotor']),
    ...(!('boost' in v) || (isObj(v.boost) && typeof v.boost.fluid === 'string' && finite(v.boost.perTick) && finite(v.boost.factor)) ? [] : ['boost']),
    ...(['steamScale', 'steamPerTick'] as const).filter((k) => k in v && !finite(v[k])),
  ]);
  if ('extras' in g) g.extras = cleanItems(g.extras);
  return g;
}

function cleanNode(v: unknown): CanvasNode | null {
  if (!isObj(v) || typeof v.instanceId !== 'string' || !isObj(v.recipe)) return null;
  const r = v.recipe;
  if (typeof r.id !== 'string' || !Array.isArray(r.inputs) || !Array.isArray(r.outputs)) return null;
  const baseTier = isTier(r.baseTier) ? r.baseTier : 'LV';
  const durationTicks = positive(r.durationTicks, 20);
  const recipe = {
    ...r,
    machineName: typeof r.machineName === 'string' ? r.machineName : 'Machine',
    recipeName: typeof r.recipeName === 'string' ? r.recipeName : r.id,
    baseTier,
    baseEUt: nonNeg(r.baseEUt, 0),
    durationTicks,
    baseDurationSec: positive(r.baseDurationSec, durationTicks / 20),
    inputs: cleanItems(r.inputs),
    outputs: cleanItems(r.outputs),
  };
  const node: Obj = {
    ...without(v, ['gen', 'multi', 'targetRate', 'targetEUt', 'supplyLimit']),
    recipe,
    selectedTier: isTier(v.selectedTier) ? v.selectedTier : baseTier,
    count: nonNeg(v.count, 1),
    countMode: v.countMode === 'manual' ? 'manual' : 'auto',
    x: finite(v.x) ? v.x : 0,
    y: finite(v.y) ? v.y : 0,
  };
  const gen = cleanGen(v.gen);
  if (gen) node.gen = gen;
  if (isObj(v.multi) && typeof v.multi.variantId === 'string' && finite(v.multi.parallel) && v.multi.parallel >= 1) node.multi = v.multi;
  if (isObj(v.targetRate) && typeof v.targetRate.itemId === 'string' && finite(v.targetRate.perSec) && v.targetRate.perSec >= 0) node.targetRate = v.targetRate;
  if (finite(v.targetEUt) && v.targetEUt >= 0) node.targetEUt = v.targetEUt;
  if (finite(v.supplyLimit) && v.supplyLimit >= 0) node.supplyLimit = v.supplyLimit;
  return node as unknown as CanvasNode;
}

/** The cards and links of an untrusted flow, or null if it isn't a flow at all. */
export function cleanFlow(raw: unknown): { nodes: CanvasNode[]; connections: Connection[] } | null {
  if (!isObj(raw) || !Array.isArray(raw.nodes)) return null;
  const nodes: CanvasNode[] = [];
  const known = new Set<string>();
  for (const n of raw.nodes.map(cleanNode)) {
    if (n && !known.has(n.instanceId)) { known.add(n.instanceId); nodes.push(n); }
  }
  const links = Array.isArray(raw.connections) ? raw.connections : [];
  const connections = links.filter((c): c is Connection => isObj(c) && typeof c.id === 'string'
    && typeof c.sourceItemId === 'string' && typeof c.targetItemId === 'string'
    && known.has(c.sourceInstanceId as string) && known.has(c.targetInstanceId as string));
  return { nodes, connections };
}
