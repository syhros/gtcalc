import { TIER_ORDER, type CanvasNode, type Connection, type MachineRecipe, type RecipeItem, type VoltageTier } from './types';

/**
 * GTNH Planner (gtnhplanner.com) project exports. Their files carry every recipe they use, so
 * the flow is rebuilt from the file alone: each planner node becomes a machine card with that
 * recipe (counts above 1 pinned, since the planner sets those by hand), storages that feed a
 * machine become Input nodes, storages between two machines become direct links, and edges
 * become links. Storages that only receive (outputs, trash) are left out: those items show as
 * surplus.
 */

interface GtnhResource { kind: 'item' | 'fluid'; id: string; amount: number; displayName?: string; dominantColor?: string; consumed?: boolean; chance?: number }
interface GtnhRecipe { id: string; name: string; machineType: string; minimumTier: string; durationTicks: number; eut: number; inputs: GtnhResource[]; outputs: GtnhResource[] }
interface GtnhNode { id: string; recipeId: string; machineCount?: number; overclockTier?: string; enabled?: boolean; position?: { x: number; y: number } }
interface GtnhStorage { id: string; kind: 'item' | 'fluid'; resourceId: string; displayName?: string; dominantColor?: string; position?: { x: number; y: number }; drainMode?: string }
interface GtnhEdge { source: string; target: string; sourceHandle: string; targetHandle: string; resourceId?: string }
// drainMode: 'product' (the line's output), 'byproduct', 'trash', or none (a raw input, or a
// buffer between two machines).
export interface GtnhProject { schemaVersion: number; name?: string; recipes: GtnhRecipe[]; nodes: GtnhNode[]; storages?: GtnhStorage[]; edges?: GtnhEdge[] }

export function isGtnhProject(x: unknown): x is GtnhProject {
  const p = x as GtnhProject;
  return !!p && typeof p === 'object' && Array.isArray(p.recipes) && Array.isArray(p.nodes) && p.nodes.every((n) => typeof n?.recipeId === 'string');
}

// "minecraft:clay_ball@32767" (any damage value) and "minecraft:clay_ball" are the same item here.
const norm = (id: string) => id.replace(/@32767$/, '');
const tierOf = (t: string | undefined, fallback: VoltageTier): VoltageTier => (TIER_ORDER.includes(t as VoltageTier) ? (t as VoltageTier) : fallback);
// Handles look like "output:item:gregtech%3Agt.metaitem.01%402018:1": kind, encoded id, then
// (in newer files) the slot. The edge's own resourceId is used when it has one.
const handleItem = (h: string) => {
  const parts = h.split(':').slice(2);
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
  return norm(decodeURIComponent(parts.join(':')));
};
const edgeItem = (e: GtnhEdge, side: 'out' | 'in') => (e.resourceId ? norm(e.resourceId) : handleItem(side === 'out' ? e.sourceHandle : e.targetHandle));

const toItem = (r: GtnhResource): RecipeItem => ({
  id: norm(r.id),
  name: r.displayName ?? r.id,
  amount: r.amount,
  unit: r.kind === 'fluid' ? 'mB' : 'item',
  iconColor: r.dominantColor,
  ...(r.consumed === false ? { consumed: false } : {}),
  ...(r.chance != null && r.chance < 1 ? { chance: r.chance } : {}),
});

function toRecipe(r: GtnhRecipe): MachineRecipe {
  const base = tierOf(r.minimumTier, 'ULV');
  const name = r.name.includes(': ') ? r.name.slice(r.name.indexOf(': ') + 2) : r.name;
  return {
    id: `gtnh:${r.id}`,
    machineName: r.machineType,
    recipeName: name,
    baseTier: base,
    baseEUt: r.eut || 0,
    baseDurationSec: Math.max(1, r.durationTicks) / 20,
    durationTicks: Math.max(1, r.durationTicks),
    inputs: r.inputs.map(toItem),
    outputs: r.outputs.map(toItem),
    source: 'user',
  };
}

export function fromGtnhProject(p: GtnhProject): { name: string; nodes: CanvasNode[]; connections: Connection[] } {
  const recipes = new Map(p.recipes.map((r) => [r.id, r]));
  const stamp = Date.now().toString(36);
  const ids = new Map<string, string>();
  const nodes: CanvasNode[] = [];
  // Planner coordinates are centred on 0 and tighter than our cards: shift to positive and spread.
  const all = [...p.nodes.map((n) => n.position), ...(p.storages ?? []).map((s) => s.position)].filter(Boolean) as { x: number; y: number }[];
  const minX = Math.min(0, ...all.map((q) => q.x));
  const minY = Math.min(0, ...all.map((q) => q.y));
  const place = (q?: { x: number; y: number }) => ({ x: Math.round(((q?.x ?? 0) - minX) * 1.4) + 40, y: Math.round(((q?.y ?? 0) - minY) * 1.6) + 40 });

  p.nodes.forEach((n, k) => {
    const r = recipes.get(n.recipeId);
    if (!r || n.enabled === false || (!r.inputs.length && !r.outputs.length)) return;
    const recipe = toRecipe(r);
    const id = `node_${stamp}_g${k}`;
    ids.set(n.id, id);
    const count = Math.max(1, Math.round(n.machineCount ?? 1));
    // Counts someone raised are kept; the planner's default of 1 just follows demand here.
    nodes.push({ instanceId: id, recipe, selectedTier: tierOf(n.overclockTier, recipe.baseTier), count, countMode: count > 1 ? 'manual' : 'auto', ...place(n.position) });
  });

  // Storages a machine fills and another takes from are buffers: link the machines directly.
  // Storages that only feed machines become Input nodes.
  const storages = new Map((p.storages ?? []).map((s) => [s.id, s]));
  const fillers = new Map<string, string[]>(); // storage -> machines that fill it
  for (const e of p.edges ?? []) if (storages.has(e.target) && ids.has(e.source)) fillers.set(e.target, [...(fillers.get(e.target) ?? []), ids.get(e.source)!]);
  const connections: Connection[] = [];
  const link = (k: string, source: string, target: string, itemOut: string, itemIn: string) => {
    const s = nodes.find((n) => n.instanceId === source)!;
    const t = nodes.find((n) => n.instanceId === target)!;
    const out = s.recipe.outputs.find((o) => o.id === itemOut);
    const inp = t.recipe.inputs.find((i) => i.id === itemIn);
    if (out && inp && !connections.some((c) => c.sourceInstanceId === source && c.targetInstanceId === target && c.targetItemId === inp.id)) {
      connections.push({ id: `conn_${stamp}_g${k}`, sourceInstanceId: source, sourceItemId: out.id, targetInstanceId: target, targetItemId: inp.id });
    }
  };
  (p.edges ?? []).forEach((e, k) => {
    const itemOut = edgeItem(e, 'out');
    const itemIn = edgeItem(e, 'in');
    const target = ids.get(e.target);
    if (!target) return;
    const buffered = storages.has(e.source) ? fillers.get(e.source) : undefined;
    if (buffered?.length) { buffered.forEach((src, j) => link(`${k}_${j}`, src, target, itemIn, itemIn)); return; }
    let source = ids.get(e.source);
    const store = storages.get(e.source);
    if (!source && store && store.drainMode !== 'trash') {
      source = `supply_${stamp}_g${k}`;
      const item: RecipeItem = { id: norm(store.resourceId), name: store.displayName ?? store.resourceId, amount: 1, unit: store.kind === 'fluid' ? 'mB' : 'item', iconColor: store.dominantColor };
      nodes.push({
        instanceId: source,
        // Same shape as App's makeSupplyRecipe.
        recipe: { id: `supply:${item.id}`, machineId: 'supply', kind: 'supply', machineName: 'Input', recipeName: item.name, baseTier: 'ULV', baseEUt: 0, baseDurationSec: 1, durationTicks: 20, inputs: [], outputs: [item], source: 'user' },
        selectedTier: 'ULV',
        count: 1,
        ...place(store.position),
      });
      ids.set(e.source, source);
    }
    if (!source) return;
    link(String(k), source, target, itemOut, itemIn);
  });

  // Target: the machine filling the storage marked as the product, else one filling a storage
  // whose item the project is named after ("Silicon loop" -> Raw Silicon Dust), else the end of
  // the line, else the first machine.
  const feeds = new Set(connections.map((c) => c.sourceInstanceId));
  const words = (p.name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const stored = (p.edges ?? [])
    .filter((e) => storages.has(e.target) && ids.has(e.source))
    .map((e) => ({ node: ids.get(e.source)!, name: (storages.get(e.target)!.displayName ?? '').toLowerCase(), product: storages.get(e.target)!.drainMode === 'product' }));
  const named = stored.find((x) => x.product) ?? stored.find((x) => words.some((w) => x.name.includes(w)));
  const machines = nodes.filter((n) => n.recipe.kind !== 'supply');
  const target = machines.find((n) => n.instanceId === named?.node)
    ?? machines.find((n) => stored.some((x) => x.node === n.instanceId) && !feeds.has(n.instanceId))
    ?? machines.find((n) => !feeds.has(n.instanceId))
    ?? machines[0];
  if (target) target.isTarget = true; // runs at its own machine count
  return { name: p.name ?? 'GTNH Planner flow', nodes, connections };
}
