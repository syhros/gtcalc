/**
 * Build mode: the flow as a list of steps to build in game. First the raw inputs to have ready, then
 * every machine in an order where its suppliers come first, with where each input comes from, where
 * each output goes (and how it splits), and a pipe that carries each link.
 */
import type { CanvasNode, Connection, RecipeItem } from './types';
import type { FlowResult } from './solver';

export interface BuildLink { connId: string; otherId: string; otherName: string; perSec: number; pipe: string | null }
export interface BuildInput { item: RecipeItem; perSec: number; from: BuildLink[]; raw: boolean }
export interface BuildOutput { item: RecipeItem; perSec: number; to: BuildLink[]; spare: number }
export interface RawStep { kind: 'raw'; items: { item: RecipeItem; perSec: number; users: string[] }[]; supplies: { name: string; perSec: number; unit: 'mB' | 'item' }[] }
export interface MachineStep {
  kind: 'machine';
  nodeId: string;
  name: string; // the block to build (multiblock, hatch)
  tier: string;
  tierLabel: string;
  machines: number;
  recipeName: string;
  circuit?: number;
  inputs: BuildInput[];
  outputs: BuildOutput[];
}
export interface DoneStep { kind: 'done'; machines: number; targets: { name: string; item: RecipeItem; perSec: number }[] }
export type BuildStep = RawStep | MachineStep | DoneStep;

/**
 * GregTech CEu fluid pipes (from its material data): throughput per size step in mB/t, and the size
 * multipliers (tiny 1, small 2, normal 6, large 12, huge 24). Cheapest materials first.
 */
const FLUID_PIPES: [string, number][] = [
  ['Bronze', 20], ['Steel', 50], ['Polyethylene', 60], ['Stainless Steel', 75], ['Aluminium', 100], ['Titanium', 150],
  ['Tungstensteel', 225], ['Polybenzimidazole', 350], ['Duranium', 500], ['Neutronium', 5000],
];
const FLUID_SIZES: [string, number][] = [['Small', 2], ['Normal', 6], ['Large', 12], ['Huge', 24]];

/** The first (cheapest, then smallest) GTCEu fluid pipe that carries this rate, or how many it takes. */
export function fluidPipe(mbPerSec: number): string {
  const perTick = mbPerSec / 20;
  for (const [mat, base] of FLUID_PIPES) {
    for (const [size, mult] of FLUID_SIZES) {
      if (base * mult >= perTick) return `${mat} ${size} Fluid Pipe (${base * mult} mB/t)`;
    }
  }
  const top = FLUID_PIPES[FLUID_PIPES.length - 1];
  return `${Math.ceil(perTick / (top[1] * 24))}× ${top[0]} Huge Fluid Pipe`;
}

/** mB/t (fluids) or items/s, as pipes are rated. */
export const pipeRate = (perSec: number, unit: 'mB' | 'item') =>
  unit === 'mB' ? `${+(perSec / 20).toFixed(perSec / 20 >= 10 ? 0 : 1)} mB/t` : `${+perSec.toFixed(perSec >= 10 ? 0 : 2)} items/s`;

export function buildSteps(
  nodes: CanvasNode[],
  connections: Connection[],
  flows: FlowResult,
  opts: { blockName: (n: CanvasNode) => string; tierLabel: (n: CanvasNode) => { tier: string; label: string }; isPort: (n: CanvasNode) => boolean; isSupply: (n: CanvasNode) => boolean; inputs: (n: CanvasNode) => RecipeItem[]; gtceuPipes: boolean },
): BuildStep[] {
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  const nameOf = (id: string) => { const n = byId.get(id); return n ? (opts.isPort(n) ? `${n.recipe.machineName}: ${n.recipe.outputs[0]?.name ?? n.recipe.inputs[0]?.name ?? ''}` : opts.blockName(n)) : '?'; };
  const machines = nodes.filter((n) => !opts.isPort(n) && (flows.nodes.get(n.instanceId)?.machines ?? 0) > 0);
  const pipe = (perSec: number, unit: 'mB' | 'item') => (unit === 'mB' && opts.gtceuPipes ? fluidPipe(perSec) : null);

  // Order: a machine comes after every machine that feeds it (loops broken left to right on the canvas).
  const feeds = new Map<string, Set<string>>();
  for (const c of connections) {
    if (!byId.has(c.sourceInstanceId) || opts.isPort(byId.get(c.sourceInstanceId)!)) continue;
    if (!feeds.has(c.targetInstanceId)) feeds.set(c.targetInstanceId, new Set());
    feeds.get(c.targetInstanceId)!.add(c.sourceInstanceId);
  }
  const done = new Set<string>();
  const order: CanvasNode[] = [];
  const left = [...machines].sort((a, b) => a.x - b.x || a.y - b.y);
  while (left.length) {
    let k = left.findIndex((n) => [...(feeds.get(n.instanceId) ?? [])].every((s) => done.has(s) || !machines.some((m) => m.instanceId === s)));
    if (k < 0) k = 0; // a loop: take the leftmost
    const [n] = left.splice(k, 1);
    done.add(n.instanceId);
    order.push(n);
  }

  // Step 1: raw inputs (unlinked inputs) and Input nodes.
  const connected = new Set(connections.map((c) => `${c.targetInstanceId}|${c.targetItemId}`));
  const raw = new Map<string, { item: RecipeItem; perSec: number; users: string[] }>();
  for (const n of machines) {
    const f = flows.nodes.get(n.instanceId)!;
    for (const i of opts.inputs(n)) {
      if (i.consumed === false || connected.has(`${n.instanceId}|${i.id}`)) continue;
      const e = raw.get(i.id) ?? { item: i, perSec: 0, users: [] };
      e.perSec += f.inputRates[i.id] ?? 0;
      if (!e.users.includes(opts.blockName(n))) e.users.push(opts.blockName(n));
      raw.set(i.id, e);
    }
  }
  const supplies = nodes.filter(opts.isSupply).map((n) => {
    const out = n.recipe.outputs[0];
    return { name: out?.name ?? n.recipe.recipeName, perSec: flows.nodes.get(n.instanceId)?.outputRates[out?.id ?? ''] ?? 0, unit: out?.unit ?? 'item' };
  });
  const steps: BuildStep[] = [{ kind: 'raw', items: [...raw.values()].filter((r) => r.perSec > 1e-9).sort((a, b) => a.item.name.localeCompare(b.item.name)), supplies }];

  for (const n of order) {
    const f = flows.nodes.get(n.instanceId)!;
    const { tier, label } = opts.tierLabel(n);
    const inputs: BuildInput[] = opts.inputs(n).filter((i) => i.consumed !== false).map((i) => {
      const from = connections.filter((c) => c.targetInstanceId === n.instanceId && c.targetItemId === i.id).map((c) => {
        const perSec = flows.connections.get(c.id)?.needed ?? 0;
        return { connId: c.id, otherId: c.sourceInstanceId, otherName: nameOf(c.sourceInstanceId), perSec, pipe: pipe(perSec, i.unit) };
      });
      return { item: i, perSec: f.inputRates[i.id] ?? 0, from, raw: from.length === 0 };
    }).filter((i) => i.perSec > 1e-9);
    const outputs: BuildOutput[] = n.recipe.outputs.map((o) => {
      const to = connections.filter((c) => c.sourceInstanceId === n.instanceId && c.sourceItemId === o.id).map((c) => {
        const perSec = flows.connections.get(c.id)?.needed ?? 0;
        return { connId: c.id, otherId: c.targetInstanceId, otherName: nameOf(c.targetInstanceId), perSec, pipe: pipe(perSec, o.unit) };
      });
      const made = f.outputRates[o.id] ?? 0;
      return { item: o, perSec: made, to, spare: Math.max(0, made - to.reduce((a, l) => a + l.perSec, 0)) };
    }).filter((o) => o.perSec > 1e-9);
    steps.push({
      kind: 'machine', nodeId: n.instanceId, name: opts.blockName(n), tier, tierLabel: label, machines: f.machines,
      recipeName: n.recipe.recipeName, ...(n.recipe.circuit != null ? { circuit: n.recipe.circuit } : {}), inputs, outputs,
    });
  }

  const targets = nodes.filter((n) => flows.nodes.get(n.instanceId)?.isSink).flatMap((n) => {
    const f = flows.nodes.get(n.instanceId)!;
    return n.recipe.outputs.filter((o) => (f.outputRates[o.id] ?? 0) > 0).slice(0, 1).map((o) => ({ name: nameOf(n.instanceId), item: o, perSec: f.outputRates[o.id] }));
  });
  steps.push({ kind: 'done', machines: order.reduce((a, n) => a + (flows.nodes.get(n.instanceId)?.machines ?? 0), 0), targets });
  return steps;
}
