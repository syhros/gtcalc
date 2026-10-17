import { TIER_ORDER, type CanvasNode, type Connection, type RecipeItem } from './types';
import { solveFlows } from './solver';
import type { BuildStats } from './community';

export interface ItemRate { item: RecipeItem; perSec: number }
export interface BuildAnalysis {
  stats: BuildStats;
  inputs: ItemRate[]; // what you supply (unlinked inputs and Input nodes)
  surplus: ItemRate[]; // made but not used on the canvas (by-products), target output excluded
  output: ItemRate | null; // the target's output: everything it makes
  outputUsed: number; // how much of that the flow itself uses (e.g. fuel burnt by its own generators)
  depth: Map<string, number>; // steps from the target (0 = target), for the simplified tree
  machines: Map<string, number>; // machines per node
}

const isSupply = (n: CanvasNode) => n.recipe.kind === 'supply';

/** The block a node needs (its multiblock or generator if it has one), whatever its tier. */
export function machineName(n: CanvasNode): string {
  const g = n.gen;
  if (g && g.kind !== 'single') return g.name;
  return n.multi?.name ?? n.recipe.machineName;
}

/** Machines to build and how many kinds of machine that is (an HV and an EV ore washer are one kind). */
export function machineTotals(nodes: CanvasNode[], connections: Connection[]): { machines: number; types: number } {
  const a = analyzeFlow(nodes, connections);
  const kinds = new Set(nodes.filter((n) => !isSupply(n) && (a.machines.get(n.instanceId) ?? 0) > 0).map(machineName));
  return { machines: a.stats.machines, types: kinds.size };
}

/** Solve a saved flow and summarise it: totals, what goes in, what's left over, what comes out. */
export function analyzeFlow(nodes: CanvasNode[], connections: Connection[]): BuildAnalysis {
  const flows = solveFlows(nodes, connections);
  const add = (m: Map<string, ItemRate>, item: RecipeItem, rate: number) => {
    if (rate <= 1e-9) return;
    const cur = m.get(item.id);
    if (cur) cur.perSec += rate; else m.set(item.id, { item, perSec: rate });
  };
  const inputs = new Map<string, ItemRate>();
  const surplus = new Map<string, ItemRate>();
  const machines = new Map<string, number>();
  let machineCount = 0, eutUse = 0, eutGen = 0;
  const tiers: number[] = [];
  // An Output node stands in for the target when no machine is marked as one.
  const target = nodes.find((n) => n.isTarget) ?? nodes.find((n) => n.recipe.kind === 'output');
  let output: ItemRate | null = null;
  let outputUsed = 0;

  for (const n of nodes) {
    const f = flows.nodes.get(n.instanceId);
    if (!f) continue;
    if (isSupply(n)) {
      const used = connections.filter((c) => c.sourceInstanceId === n.instanceId).reduce((a, c) => a + (flows.connections.get(c.id)?.needed ?? 0), 0);
      add(inputs, n.recipe.outputs[0], used);
      continue;
    }
    if (n.recipe.kind === 'output') {
      const it = n.recipe.inputs[0];
      if (it && n === target) output = { item: it, perSec: f.inputRates[it.id] ?? 0 };
      continue;
    }
    machines.set(n.instanceId, f.machines);
    machineCount += f.machines;
    if (n.recipe.generatesEU) eutGen += f.eutAvg; else eutUse += f.eutAvg;
    if (n.recipe.baseEUt) tiers.push(TIER_ORDER.indexOf(n.selectedTier));
    for (const [itemId, rate] of Object.entries(f.inputRates)) {
      const linked = connections.filter((c) => c.targetInstanceId === n.instanceId && c.targetItemId === itemId);
      const got = linked.reduce((a, c) => a + (flows.connections.get(c.id)?.needed ?? 0), 0);
      const item = n.recipe.inputs.find((i) => i.id === itemId) ?? n.gen?.extras?.find((x) => x.id === itemId);
      if (item) add(inputs, item, rate - got);
    }
    for (const o of n.recipe.outputs) {
      const made = f.outputRates[o.id] ?? 0;
      const sent = connections.filter((c) => c.sourceInstanceId === n.instanceId && c.sourceItemId === o.id).reduce((a, c) => a + (flows.connections.get(c.id)?.needed ?? 0), 0);
      const isOut = n === target && o.id === (target.targetRate?.itemId ?? target.recipe.outputs[0]?.id);
      if (isOut) { output = { item: o, perSec: made }; outputUsed = Math.min(made, sent); }
      else add(surplus, o, made - sent);
    }
  }

  // Steps from the target, following links backwards (longest path, so chains read left to right).
  const depth = new Map<string, number>();
  if (target) {
    depth.set(target.instanceId, 0);
    for (let pass = 0; pass < nodes.length; pass++) {
      let moved = false;
      for (const c of connections) {
        const d = depth.get(c.targetInstanceId);
        if (d == null) continue;
        if ((depth.get(c.sourceInstanceId) ?? -1) < d + 1 && d + 1 <= nodes.length) { depth.set(c.sourceInstanceId, d + 1); moved = true; }
      }
      if (!moved) break;
    }
  }
  const tgtOut = target?.recipe.kind === 'output' ? target.recipe.inputs[0] : target?.recipe.outputs.find((o) => o.id === (target.targetRate?.itemId ?? target.recipe.outputs[0]?.id));
  const stats: BuildStats = {
    machines: Math.round(machineCount),
    topTier: tiers.length ? TIER_ORDER[Math.max(...tiers)] : '—',
    lowTier: tiers.length ? TIER_ORDER[Math.min(...tiers)] : '—',
    eutUse: Math.round(eutUse),
    eutGen: Math.round(eutGen),
    ...(tgtOut ? { output: { id: tgtOut.id, name: tgtOut.name, perSec: (output as ItemRate | null)?.perSec, unit: tgtOut.unit } } : {}),
  };
  const byRate = (a: ItemRate, b: ItemRate) => b.perSec - a.perSec;
  return { stats, inputs: [...inputs.values()].sort(byRate), surplus: [...surplus.values()].filter((s) => s.perSec > 1e-6).sort(byRate), output, outputUsed, depth, machines };
}
