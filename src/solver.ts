import { TIER_ORDER, TIERS, type CanvasNode, type Connection, type RecipeItem } from './types';

export interface MachineStats {
  tierDiff: number; // tiers above the recipe's base tier
  overclocks: number; // overclocks actually applied (stops at 1 tick)
  parallel: number; // generators run 4x parallel per tier instead of overclocking
  durationTicks: number;
  durationSec: number;
  eutPerMachine: number; // consumed, or produced for generators
  tierLocked: boolean;
}

/**
 * Per-machine stats at the node's tier / generator setup. All formulas follow GTCEu 7.5.3:
 * - Processing machines: each tier above base halves duration (floored, min 1 tick), EU/t x4.
 * - Single-block generators: parallel = V[tier] / recipe EU/t, so fuel and EU both scale x4 per tier.
 * - Large combustion engines: parallel = V[tier] / recipe EU/t (x2 with the oxygen boost),
 *   and the boost multiplies output by 1.5 (LCE) or 2 (ECE).
 * - Large turbines: max output = 2 x V[tier] x rotor power% x 2^(holder tier - turbine tier);
 *   duration is stretched by efficiency = max(100%, rotor eff% x (100 + 10 x tier diff)%).
 */
export function machineStats(node: CanvasNode): MachineStats {
  const r = node.recipe;
  const baseTicks = Math.max(1, r.durationTicks ?? Math.round(r.baseDurationSec * 20));
  const tierIdx = (t: string | undefined) => TIER_ORDER.indexOf((t ?? 'ULV') as never);

  if (r.kind === 'supply' || r.kind === 'output') {
    return { tierDiff: 0, overclocks: 0, parallel: 1, durationTicks: 20, durationSec: 1, eutPerMachine: 0, tierLocked: true };
  }

  if (r.boiler) {
    // Large boilers: fuel per craft is fixed, water and steam scale with the boiler type.
    const scale = node.gen?.steamScale ?? 1;
    return { tierDiff: 0, overclocks: 0, parallel: scale, durationTicks: baseTicks, durationSec: baseTicks / 20, eutPerMachine: 0, tierLocked: true };
  }

  if (r.generatesEU) {
    const g = node.gen;
    const recipeEUt = Math.max(1, r.baseEUt);
    if (g?.kind === 'engine' && g.tier) {
      const boosted = !!(g.boost && g.boostOn);
      const voltage = TIERS[g.tier].voltage * (boosted ? 2 : 1);
      const parallel = Math.max(1, Math.floor(voltage / recipeEUt));
      const eut = parallel * recipeEUt * (boosted ? g.boost!.factor : 1);
      return { tierDiff: 0, overclocks: 0, parallel, durationTicks: baseTicks, durationSec: baseTicks / 20, eutPerMachine: eut, tierLocked: true };
    }
    if (g?.kind === 'turbine' && g.tier && g.rotor) {
      const diff = Math.max(0, tierIdx(g.holderTier ?? g.tier) - tierIdx(g.tier));
      // Integer maths, as in GTCEu (long / int division).
      const maxVoltage = Math.floor((2 * TIERS[g.tier].voltage * Math.pow(2, diff) * g.rotor.power) / 100);
      const efficiency = Math.max(100, Math.floor((g.rotor.efficiency * (100 + 10 * diff)) / 100)) / 100;
      const runs = maxVoltage > recipeEUt;
      const parallel = runs ? Math.ceil(maxVoltage / recipeEUt) : 0;
      const ticks = Math.max(1, Math.floor(baseTicks * efficiency));
      return { tierDiff: diff, overclocks: 0, parallel, durationTicks: ticks, durationSec: ticks / 20, eutPerMachine: runs ? maxVoltage : 0, tierLocked: false };
    }
    const tierDiff = Math.max(0, tierIdx(node.selectedTier) - tierIdx(r.baseTier));
    const parallel = Math.pow(4, tierDiff);
    const tierLocked = !!r.multiblock && !g;
    return { tierDiff, overclocks: 0, parallel, durationTicks: baseTicks, durationSec: baseTicks / 20, eutPerMachine: r.baseEUt * parallel, tierLocked };
  }

  const noEnergy = !r.baseEUt;
  const tierLocked = noEnergy;
  const tierDiff = tierLocked ? 0 : Math.max(0, tierIdx(node.selectedTier) - tierIdx(r.baseTier));

  if (node.multi && node.multi.parallel > 1 && !noEnergy) {
    // Parallel hatch: the hatch's full parallel count runs at once (4/16/64/256 crafts per
    // cycle). The combined recipe then overclocks while the energy hatch tier has room.
    const voltage = TIERS[node.selectedTier].voltage;
    const parallel = node.multi.parallel;
    let eut = r.baseEUt * parallel;
    let pticks = baseTicks;
    let ocs = 0;
    while (eut * 4 <= voltage && pticks > 1) {
      eut *= 4;
      pticks = Math.max(1, Math.floor(pticks / 2));
      ocs++;
    }
    return { tierDiff, overclocks: ocs, parallel, durationTicks: pticks, durationSec: pticks / 20, eutPerMachine: eut, tierLocked };
  }

  let ticks = baseTicks;
  let overclocks = 0;
  while (overclocks < tierDiff && ticks > 1) {
    ticks = Math.max(1, Math.floor(ticks / 2));
    overclocks++;
  }
  return { tierDiff, overclocks, parallel: 1, durationTicks: ticks, durationSec: ticks / 20, eutPerMachine: r.baseEUt * Math.pow(4, overclocks), tierLocked };
}

/** Expected amount of an item per machine cycle (chance-weighted, 0 for non-consumed inputs). */
export function perCycle(item: RecipeItem, stats: MachineStats): number {
  if (item.consumed === false) return 0;
  return item.amount * (item.chance ?? 1) * (item.fixed ? 1 : stats.parallel);
}

/** Per cycle of one item id, summed: some recipes list the same item twice (dust x1 plus dust x1 at 14%). */
export function perCycleOf(items: RecipeItem[], itemId: string, stats: MachineStats): number {
  let total = 0;
  for (const i of items) if (i.id === itemId) total += perCycle(i, stats);
  return total;
}

/**
 * The node's inputs: the recipe's own plus anything the chosen machine burns on top
 * (large engines: lubricant 1 mB / 72 ticks, oxygen boost per tick while boosted).
 */
export function nodeInputs(node: CanvasNode, stats: MachineStats): RecipeItem[] {
  const extras = node.gen?.extras;
  if (!extras?.length) return node.recipe.inputs;
  const active = extras.filter((e) => !e.boostOnly || node.gen?.boostOn);
  return [
    ...node.recipe.inputs,
    ...active.map((e) => ({ ...e, amount: e.perTick * stats.durationTicks, fixed: true })),
  ];
}

export interface NodeFlow {
  stats: MachineStats;
  cyclesPerSec: number; // total across all machines
  machinesNeeded: number; // fractional machines to sustain cyclesPerSec
  machines: number; // machines to build (ceil in auto mode)
  utilization: number; // machinesNeeded / machines
  eutAvg: number; // average EU/t drawn (or generated)
  isSink: boolean;
  capped: boolean; // manual count limits this node below demand
  idle: boolean; // nothing downstream asks for anything (e.g. a closed loop with unconnected products)
  idleReason?: 'covered' | 'no-demand'; // covered: its products are already supplied by other machines
  inputRates: Record<string, number>; // per second
  outputRates: Record<string, number>;
}

export interface ConnectionFlow {
  supplied: number; // share of the source's output routed to this consumer
  needed: number;
  diff: number;
}

export interface FlowResult {
  nodes: Map<string, NodeFlow>;
  connections: Map<string, ConnectionFlow>;
  euConsumed: number;
  euGenerated: number;
  unstable: boolean; // the solve missed its constraints (numerical trouble or a loop that can't balance)
}

const EPS = 1e-9;
const PIVOT_TOL = 1e-9; // smallest usable pivot, relative (rows are scaled to a largest coefficient of 1)

/**
 * Dense primal simplex (minimise cost·x subject to rows, x >= 0). Every row must come with a
 * starting basic variable that has coefficient +1 in that row only (a slack or shortfall
 * variable) and a non-negative right-hand side, so no phase 1 is needed.
 *
 * The objectives are minimised in order: each later one only over the solutions that keep the
 * earlier ones at their minimum. A column whose reduced cost is positive at an earlier optimum
 * would make that objective worse, so it never enters again.
 */
function simplexMin(A: Float64Array[], b: number[], costs: number[][], basis: number[], maxIter = 20000): number[] {
  const m = A.length;
  const n = costs[0].length;
  const T = A.map((row, i) => {
    const r = new Float64Array(n + 1);
    r.set(row);
    r[n] = b[i];
    return r;
  });
  const frozen = new Uint8Array(n);
  for (const c of costs) {
    const cMax = Math.max(1, ...c.map(Math.abs));
    // Reduced costs for the current basis: c_j - c_B · column j.
    const z = new Float64Array(n + 1);
    for (let j = 0; j <= n; j++) {
      let v = j < n ? c[j] : 0;
      for (let i = 0; i < m; i++) v -= c[basis[i]] * T[i][j];
      z[j] = v;
    }
    let degenerate = 0;
    for (let iter = 0; iter < maxIter; iter++) {
      // Entering column: most negative reduced cost (Bland's rule after many degenerate steps).
      let enter = -1;
      let best = -1e-12 * cMax;
      for (let j = 0; j < n; j++) {
        if (!frozen[j] && z[j] < best) {
          enter = j;
          if (degenerate > 50) break; // Bland: first improving column
          best = z[j];
        }
      }
      if (enter < 0) break;
      // Leaving row: minimum ratio, ties to the smallest basis index.
      let leave = -1;
      let ratio = Infinity;
      for (let i = 0; i < m; i++) {
        const a = T[i][enter];
        if (a > PIVOT_TOL) { // ignore near-zero entries: pivoting on them blows the numbers up
          const r = T[i][n] / a;
          if (r < ratio - 1e-12 || (Math.abs(r - ratio) <= 1e-12 && leave >= 0 && basis[i] < basis[leave])) {
            ratio = r;
            leave = i;
          }
        }
      }
      if (leave < 0) break; // unbounded (cannot happen: every cost is >= 0)
      degenerate = ratio <= 1e-12 ? degenerate + 1 : 0;
      const pr = T[leave];
      const pv = pr[enter];
      for (let j = 0; j <= n; j++) pr[j] /= pv;
      for (let i = 0; i < m; i++) {
        if (i === leave) continue;
        const f = T[i][enter];
        if (f === 0) continue;
        const row = T[i];
        for (let j = 0; j <= n; j++) row[j] -= f * pr[j];
      }
      const fz = z[enter];
      for (let j = 0; j <= n; j++) z[j] -= fz * pr[j];
      basis[leave] = enter;
    }
    for (let j = 0; j < n; j++) if (z[j] > 1e-9 * cMax) frozen[j] = 1;
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i++) x[basis[i]] = Math.max(0, T[i][n]);
  return x;
}

/**
 * Solve the whole board as one optimisation (linear programme):
 *  - every connected input is fully supplied by its connections (any unmet part is a
 *    "shortfall" with a huge cost, so it only happens when nothing can supply it);
 *  - no machine sends out more of an output than it makes (surplus is allowed);
 *  - the target and end-of-line machines run at their requested rate;
 *  - locked machine counts and Input supply limits cap how fast those machines run;
 *  - subject to that, minimise the total cost of running everything (average EU/t plus a
 *    small per-machine weight).
 * This naturally uses byproducts and spare intermediates first (they cost nothing extra),
 * shares demand between suppliers in the cheapest way, and balances recycling loops such as
 * H2S -> hydrogen -> H2S exactly.
 */
export function solveFlows(
  nodes: CanvasNode[],
  connections: Connection[],
  options: { forceTargetCycles?: number; ignoreCaps?: boolean } = {},
): FlowResult {
  const stats = new Map(nodes.map((n) => [n.instanceId, machineStats(n)]));
  const inputsOf = new Map(nodes.map((n) => [n.instanceId, nodeInputs(n, stats.get(n.instanceId)!)]));
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  const outPer = (n: CanvasNode, itemId: string) => perCycleOf(n.recipe.outputs, itemId, stats.get(n.instanceId)!);
  const inPer = (n: CanvasNode, itemId: string) => perCycleOf(inputsOf.get(n.instanceId)!, itemId, stats.get(n.instanceId)!);
  const conns = connections.filter((c) => {
    const s = byId.get(c.sourceInstanceId);
    const t = byId.get(c.targetInstanceId);
    return s && t && s !== t && s.recipe.outputs.some((o) => o.id === c.sourceItemId) && inputsOf.get(t.instanceId)!.some((i) => i.id === c.targetItemId);
  });

  const outgoing = new Map<string, Connection[]>();
  const groups = new Map<string, Connection[]>(); // `${consumer}|${input}` -> its suppliers
  for (const c of conns) {
    if (!outgoing.has(c.sourceInstanceId)) outgoing.set(c.sourceInstanceId, []);
    outgoing.get(c.sourceInstanceId)!.push(c);
    const k = `${c.targetInstanceId}|${c.targetItemId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }

  const isSink = (n: CanvasNode) => !!n.isTarget || !outgoing.get(n.instanceId)?.length;
  const sinkCycles = (n: CanvasNode): number => {
    const s = stats.get(n.instanceId)!;
    if (n.isTarget && options.forceTargetCycles != null) return options.forceTargetCycles;
    if (n.isTarget && n.recipe.generatesEU && n.targetEUt != null && s.eutPerMachine > 0) {
      return n.targetEUt / s.eutPerMachine / s.durationSec;
    }
    if (n.isTarget && n.targetRate) {
      const per = perCycleOf(n.recipe.outputs, n.targetRate.itemId, s);
      if (per > 0) return n.targetRate.perSec / per;
    }
    if (n.recipe.kind === 'supply' || n.recipe.kind === 'output') return n.supplyLimit ?? 0;
    return Math.max(0, n.count) / s.durationSec;
  };
  const capOf = (n: CanvasNode): number | undefined => {
    if (options.ignoreCaps) return undefined;
    if (n.recipe.kind === 'supply') return n.supplyLimit;
    if (n.countMode === 'manual') return Math.max(0, n.count) / stats.get(n.instanceId)!.durationSec;
    return undefined;
  };

  // ---------------------------------------------------------------- variables
  let nv = 0;
  const xVar = new Map<string, number>(); // cycles/s of each machine that isn't fixed
  const fixed = new Map<string, number>(); // cycles/s of the target / end-of-line machines
  for (const n of nodes) {
    if (isSink(n)) fixed.set(n.instanceId, sinkCycles(n));
    else xVar.set(n.instanceId, nv++);
  }
  const fVar = new Map<string, number>();
  for (const c of conns) fVar.set(c.id, nv++);
  const shortVar = new Map<string, number>();
  const groupKeys = [...groups.keys()].filter((k) => {
    const [consumerId, itemId] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    return inPer(byId.get(consumerId)!, itemId) > 0;
  });
  for (const k of groupKeys) shortVar.set(k, nv++);

  type Row = { coef: Map<number, number>; rhs: number; basic: number | 'slack' };
  const rows: Row[] = [];
  // Outputs: what is routed out can't exceed what is made.
  for (const [nodeId, outs] of outgoing) {
    const n = byId.get(nodeId)!;
    const byItem = new Map<string, Connection[]>();
    for (const c of outs) byItem.set(c.sourceItemId, [...(byItem.get(c.sourceItemId) ?? []), c]);
    for (const [itemId, list] of byItem) {
      const coef = new Map<number, number>();
      for (const c of list) coef.set(fVar.get(c.id)!, 1);
      const per = outPer(n, itemId);
      let rhs = 0;
      if (xVar.has(nodeId)) coef.set(xVar.get(nodeId)!, -per);
      else rhs = per * fixed.get(nodeId)!;
      rows.push({ coef, rhs, basic: 'slack' });
    }
  }
  // Inputs: connections (plus any shortfall) supply exactly what the consumer uses.
  for (const k of groupKeys) {
    const list = groups.get(k)!;
    const consumer = byId.get(list[0].targetInstanceId)!;
    const per = inPer(consumer, list[0].targetItemId);
    const coef = new Map<number, number>();
    for (const c of list) coef.set(fVar.get(c.id)!, 1);
    coef.set(shortVar.get(k)!, 1);
    let rhs = 0;
    if (xVar.has(consumer.instanceId)) coef.set(xVar.get(consumer.instanceId)!, -per);
    else rhs = per * fixed.get(consumer.instanceId)!;
    rows.push({ coef, rhs, basic: shortVar.get(k)! });
  }
  // Caps: locked counts and supply limits.
  for (const n of nodes) {
    const cap = capOf(n);
    if (cap == null || !xVar.has(n.instanceId)) continue;
    rows.push({ coef: new Map([[xVar.get(n.instanceId)!, 1]]), rhs: cap, basic: 'slack' });
  }

  // Scale rows and columns towards a largest coefficient of 1. Recipe amounts range from
  // fractions of a mB to 1e8 mB per craft; unscaled, the simplex's tolerances either pivot on
  // rounding noise or miss real entries. Rows and columns are scaled in turn, ending with rows
  // (so PIVOT_TOL stays relative). A shortfall variable is rescaled with its row (short' = short
  // / scale), so it keeps coefficient 1 and still works as that row's starting basis; machine and
  // link columns are rescaled as y = x * colScale.
  const shortScale = new Map<number, number>();
  const colScale = new Map<number, number>();
  for (let pass = 0; ; pass++) {
    for (const r of rows) {
      let k = 0;
      for (const [j, v] of r.coef) if (r.basic !== j) k = Math.max(k, Math.abs(v));
      if (k === 0 || k === 1) continue;
      for (const [j, v] of r.coef) r.coef.set(j, r.basic === j ? 1 : v / k);
      r.rhs /= k;
      if (typeof r.basic === 'number') shortScale.set(r.basic, (shortScale.get(r.basic) ?? 1) * k);
    }
    if (pass === 3) break;
    const colMax = new Map<number, number>();
    for (const r of rows) for (const [j, v] of r.coef) if (r.basic !== j) colMax.set(j, Math.max(colMax.get(j) ?? 0, Math.abs(v)));
    for (const [j, k] of colMax) {
      if (k === 0 || k === 1) continue;
      for (const r of rows) { const v = r.coef.get(j); if (v != null) r.coef.set(j, v / k); }
      colScale.set(j, (colScale.get(j) ?? 1) * k);
    }
  }

  // Slack variables, then the dense matrix.
  const basis: number[] = [];
  const slackOf: number[] = [];
  for (const r of rows) {
    if (r.basic === 'slack') { slackOf.push(nv); basis.push(nv++); } else { slackOf.push(-1); basis.push(r.basic); }
  }
  const A = rows.map((r, i) => {
    const row = new Float64Array(nv);
    for (const [j, v] of r.coef) row[j] += v;
    if (slackOf[i] >= 0) row[slackOf[i]] = 1;
    return row;
  });

  // Costs, minimised in order: first any shortfall (so an input is only left short when nothing
  // can supply it, however costly the supply), then running cost: a machine ~ average EU/t + a
  // little per machine, Input nodes nearly free, flows a hair above zero so nothing circulates
  // pointlessly. Costs follow the column scaling (cost of y = cost of x / colScale).
  const shortCost = new Array(nv).fill(0);
  for (const j of shortVar.values()) shortCost[j] = 1;
  const c = new Array(nv).fill(0);
  const weight = (n: CanvasNode) => {
    if (n.recipe.kind === 'supply' || n.recipe.kind === 'output') return 1e-6;
    const s = stats.get(n.instanceId)!;
    return s.durationSec * ((n.recipe.generatesEU ? 0 : s.eutPerMachine) + 8);
  };
  const maxW = Math.max(1, ...[...xVar.keys()].map((id) => weight(byId.get(id)!)));
  for (const [id, j] of xVar) c[j] = weight(byId.get(id)!) / maxW;
  for (const j of fVar.values()) c[j] = 1e-9;
  for (const j of shortVar.values()) c[j] = 1;
  for (const [j, k] of colScale) c[j] /= k;

  const y = rows.length ? simplexMin(A, rows.map((r) => r.rhs), [shortCost, c], basis) : new Array(nv).fill(0);

  // Check the answer against the scaled rows: a large miss means the solve went wrong.
  let worst = 0;
  const rowSize: number[] = []; // largest term in each row, for snapping below
  rows.forEach((r) => {
    let lhs = 0;
    let size = Math.abs(r.rhs);
    for (const [j, v] of r.coef) { lhs += v * y[j]; size = Math.max(size, Math.abs(v * y[j])); }
    rowSize.push(size);
    const miss = r.basic === 'slack' ? lhs - r.rhs : Math.abs(lhs - r.rhs); // slack rows are <=
    worst = Math.max(worst, miss / (1 + Math.abs(r.rhs)));
  });
  const unstable = worst > 1e-6;

  // Snap numerical dust to a clean 0: a value whose term is negligible next to the largest term
  // in every row it appears in. (Measured per row, so a 1/s link next to a 1e9 mB/s chain stays.)
  const termShare = new Map<number, number>();
  rows.forEach((r, i) => {
    for (const [j, v] of r.coef) termShare.set(j, Math.max(termShare.get(j) ?? 0, rowSize[i] > 0 ? Math.abs(v * y[j]) / rowSize[i] : 0));
  });
  const shortIds = new Set(shortVar.values());
  for (const [j, share] of termShare) if (share < (shortIds.has(j) ? 1e-7 : 1e-9)) y[j] = 0;

  // ---------------------------------------------------------------- read the solution
  const sol = y.map((v, j) => v / (colScale.get(j) ?? 1));
  const cycles = new Map<string, number>();
  for (const n of nodes) cycles.set(n.instanceId, fixed.get(n.instanceId) ?? sol[xVar.get(n.instanceId)!] ?? 0);
  const alloc = new Map<string, number>();
  for (const cn of conns) alloc.set(cn.id, sol[fVar.get(cn.id)!] ?? 0);
  const shortfall = new Map<string, number>();
  for (const [k, j] of shortVar) if (sol[j] > 0) shortfall.set(k, sol[j] * (shortScale.get(j) ?? 1));
  const anyShort = shortfall.size > 0;

  const groupDemand = (k: string) => {
    const [consumerId, itemId] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const consumer = byId.get(consumerId)!;
    return cycles.get(consumerId)! * inPer(consumer, itemId);
  };

  const nodeFlows = new Map<string, NodeFlow>();
  let euConsumed = 0;
  let euGenerated = 0;
  for (const n of nodes) {
    const s = stats.get(n.instanceId)!;
    const cyc = cycles.get(n.instanceId)!;
    const needed = cyc * s.durationSec;
    const sink = isSink(n);
    const hasRateTarget = n.isTarget && (n.targetRate != null || (n.recipe.generatesEU && n.targetEUt != null));
    const auto = sink ? hasRateTarget : n.countMode !== 'manual';
    const machines = auto ? Math.max(needed > EPS ? 1 : 0, Math.ceil(needed - 1e-6)) : Math.max(0, n.count);
    const eutAvg = s.eutPerMachine * needed;
    if (n.recipe.generatesEU) euGenerated += eutAvg; else euConsumed += eutAvg;

    const inputRates: Record<string, number> = {};
    for (const i of inputsOf.get(n.instanceId)!) inputRates[i.id] = (inputRates[i.id] ?? 0) + perCycle(i, s) * cyc;
    const outputRates: Record<string, number> = {};
    for (const o of n.recipe.outputs) outputRates[o.id] = (outputRates[o.id] ?? 0) + perCycle(o, s) * cyc;

    const cap = capOf(n);
    const idle = !sink && cyc <= EPS && n.recipe.kind !== 'supply';
    const demanded = (outgoing.get(n.instanceId) ?? []).some((x) => groupDemand(`${x.targetInstanceId}|${x.targetItemId}`) > EPS);
    nodeFlows.set(n.instanceId, {
      stats: s,
      cyclesPerSec: cyc,
      machinesNeeded: needed,
      machines,
      utilization: machines > 0 ? needed / machines : 0,
      eutAvg,
      isSink: sink,
      capped: cap != null && anyShort && cyc >= cap * (1 - 1e-6),
      idle,
      idleReason: demanded ? 'covered' : 'no-demand',
      inputRates,
      outputRates,
    });
  }

  // Split each source output between its consumers in proportion to what they draw.
  const connFlows = new Map<string, ConnectionFlow>();
  for (const cn of conns) {
    const siblings = (outgoing.get(cn.sourceInstanceId) ?? []).filter((x) => x.sourceItemId === cn.sourceItemId);
    const totalDrawn = siblings.reduce((sum, x) => sum + (alloc.get(x.id) ?? 0), 0);
    const produced = nodeFlows.get(cn.sourceInstanceId)!.outputRates[cn.sourceItemId] ?? 0;
    const drawn = alloc.get(cn.id) ?? 0;
    const supplied = totalDrawn > EPS ? produced * (drawn / totalDrawn) : produced / siblings.length;
    const key = `${cn.targetInstanceId}|${cn.targetItemId}`;
    const needed = drawn + (shortfall.get(key) ?? 0) / (groups.get(key)?.length ?? 1);
    connFlows.set(cn.id, { supplied, needed, diff: supplied - needed });
  }

  return { nodes: nodeFlows, connections: connFlows, euConsumed, euGenerated, unstable };
}
