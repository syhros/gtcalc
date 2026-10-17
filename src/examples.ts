import { TIER_ORDER, type CanvasNode, type Connection, type VoltageTier } from './types';
import type { RecipeDatabase } from './recipeData';
import type { Build } from './community';
import { planRoute } from './bestRoute';
import { analyzeFlow } from './buildStats';
import { formatRate } from './format';
import { machineStats, solveFlows } from './solver';

/**
 * Example flows for Community, planned from the pack's own recipes with Best Route (so every
 * id exists in that pack) and sized to a clean ratio: the rate where every machine runs as
 * close to flat out as possible with the fewest machines, e.g. one gas collector feeding
 * exactly two MV centrifuges. Basic ones may raise a machine up to BASIC_TIER_CAP to make the
 * ratio work; overclocked ones run every machine at OVERCLOCK_TIER; long ones are bigger chains.
 * Stored on the server by scripts/seed-examples.mts (made in the browser only without it).
 */
const BASIC_TIER_CAP: VoltageTier = 'MV';
const OVERCLOCK_TIER: VoltageTier = 'HV';

type Kind = 'basic' | 'overclock' | 'long';
const LIMIT: Record<Kind, number> = { basic: 15, overclock: 15, long: 30 }; // most machines in all

type Target = { key: string; id: string; item: string; name: string; about: string; kind: Kind };
// `id` is the GTCEu item; other packs (GTNH) find the item by `item` name instead.
// Sky Greg's set (also the fallback for packs without their own).
const SKYGREG: Target[] = [
  { key: 'nitrogen', id: 'gtceu:nitrogen', item: 'Nitrogen', name: 'Nitrogen from air', kind: 'basic', about: 'Air is split into nitrogen and oxygen. Nothing to supply but power.' },
  { key: 'chlorine', id: 'gtceu:chlorine', item: 'Chlorine', name: 'Chlorine from salt water', kind: 'basic', about: 'Chlorine split out of salt water, with electrolysis doing the work.' },
  { key: 'methane', id: 'gtceu:methane', item: 'Methane', name: 'Methane', kind: 'basic', about: 'A short chemistry chain from natural gas and salt water.' },
  { key: 'nitric', id: 'gtceu:nitric_acid', item: 'Nitric Acid', name: 'Nitric acid from air', kind: 'basic', about: 'Nitrogen and oxygen from air, combined into nitrogen dioxide, then nitric acid with water.' },
  { key: 'benzene', id: 'gtceu:benzene', item: 'Benzene', name: 'Benzene', kind: 'basic', about: 'Benzene planned from raw resources with Best Route.' },
  { key: 'ethylene', id: 'gtceu:ethylene', item: 'Ethylene', name: 'Ethylene', kind: 'basic', about: 'Natural gas and salt water through a few reactors, cracked and distilled into ethylene.' },
  { key: 'nitrogen-oc', id: 'gtceu:nitrogen', item: 'Nitrogen', name: `Nitrogen from air (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The same air-splitting line with every machine at ${OVERCLOCK_TIER}: much more nitrogen from the same few machines, for more power.` },
  { key: 'nitric-oc', id: 'gtceu:nitric_acid', item: 'Nitric Acid', name: `Nitric acid (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The nitric acid line with machines at ${OVERCLOCK_TIER}. Compare it with the basic one: more acid per machine, more power.` },
  { key: 'benzene-oc', id: 'gtceu:benzene', item: 'Benzene', name: `Benzene (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The benzene line with machines at ${OVERCLOCK_TIER}.` },
  { key: 'ethylene-oc', id: 'gtceu:ethylene', item: 'Ethylene', name: `Ethylene (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `Ethylene with machines at ${OVERCLOCK_TIER}.` },
  { key: 'red-alloy', id: 'gtceu:red_alloy_ingot', item: 'Red Alloy Ingot', name: 'Red alloy from ores', kind: 'long', about: 'A longer chain: copper and redstone ores crushed, washed and refined, then alloyed into red alloy.' },
  { key: 'stainless', id: 'gtceu:stainless_steel_ingot', item: 'Stainless Steel Ingot', name: 'Stainless steel from ores', kind: 'long', about: 'A longer chain with ten kinds of machine: several ores processed into iron, nickel, manganese and chrome dusts, mixed and smelted in a blast furnace.' },
];
// GregTech (plain GTCEu): a different set, so each pack has its own examples.
const GREGTECH: Target[] = [
  { key: 'sulfuric', id: 'gtceu:sulfuric_acid', item: 'Sulfuric Acid', name: `Sulfuric acid`, kind: 'basic', about: `Sulfur burned into sulfur dioxide, oxidised again, then mixed with water.` },
  { key: 'hcl', id: 'gtceu:hydrochloric_acid', item: 'Hydrochloric Acid', name: `Hydrochloric acid`, kind: 'basic', about: `Hydrogen and chlorine from salt water, combined into hydrochloric acid.` },
  { key: 'ammonia', id: 'gtceu:ammonia', item: 'Ammonia', name: `Ammonia`, kind: 'basic', about: `Nitrogen from air and hydrogen from water, combined into ammonia.` },
  { key: 'acetone', id: 'gtceu:acetone', item: 'Acetone', name: `Acetone`, kind: 'basic', about: `A short chemistry chain planned from raw resources.` },
  { key: 'polyethylene', id: 'gtceu:polyethylene', item: 'Polyethylene', name: `Polyethylene`, kind: 'basic', about: `Ethylene polymerised with oxygen: the first plastic of the tech tree.` },
  { key: 'ethanol', id: 'gtceu:ethanol', item: 'Ethanol', name: `Ethanol`, kind: 'basic', about: `Ethanol planned from raw resources with Best Route.` },
  { key: 'sulfuric-oc', id: 'gtceu:sulfuric_acid', item: 'Sulfuric Acid', name: `Sulfuric acid (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The sulfuric acid line with every machine at ${OVERCLOCK_TIER}.` },
  { key: 'ammonia-oc', id: 'gtceu:ammonia', item: 'Ammonia', name: `Ammonia (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The ammonia line with every machine at ${OVERCLOCK_TIER}: more ammonia per machine, for more power.` },
  { key: 'acetone-oc', id: 'gtceu:acetone', item: 'Acetone', name: `Acetone (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The acetone line with machines at ${OVERCLOCK_TIER}.` },
  { key: 'polyethylene-oc', id: 'gtceu:polyethylene', item: 'Polyethylene', name: `Polyethylene (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `Polyethylene with machines at ${OVERCLOCK_TIER}.` },
  { key: 'steel', id: 'gtceu:steel_ingot', item: 'Steel Ingot', name: `Steel from ores`, kind: 'long', about: `Iron ore processed into dust, then smelted with oxygen into steel in a blast furnace.` },
  { key: 'aluminium', id: 'gtceu:aluminium_ingot', item: 'Aluminium Ingot', name: `Aluminium from ores`, kind: 'long', about: `A longer chain: aluminium-bearing ores processed and smelted in a blast furnace.` },
];

// GT New Horizons: items found by name.
const GTNH: Target[] = [
  { key: 'sulfuric', id: '', item: 'Sulfuric Acid', name: `Sulfuric acid`, kind: 'basic', about: `Sulfur burned into sulfur dioxide, oxidised again, then mixed with water.` },
  { key: 'ammonia', id: '', item: 'Ammonia', name: `Ammonia`, kind: 'basic', about: `Nitrogen and hydrogen combined into ammonia.` },
  { key: 'styrene', id: '', item: 'Styrene', name: `Styrene`, kind: 'basic', about: `Styrene planned from raw resources with Best Route.` },
  { key: 'hcl', id: '', item: 'Hydrochloric Acid', name: `Hydrochloric acid`, kind: 'basic', about: `Hydrogen and chlorine combined into hydrochloric acid.` },
  { key: 'polyethylene', id: '', item: 'Molten Polyethylene', name: `Polyethylene`, kind: 'basic', about: `Ethylene polymerised with air: the first plastic of the tech tree.` },
  { key: 'lubricant', id: '', item: 'Lubricant', name: `Lubricant`, kind: 'basic', about: `Lubricant planned from raw resources with Best Route.` },
  { key: 'sulfuric-oc', id: '', item: 'Sulfuric Acid', name: `Sulfuric acid (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The sulfuric acid line with every machine at ${OVERCLOCK_TIER}.` },
  { key: 'ammonia-oc', id: '', item: 'Ammonia', name: `Ammonia (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `The ammonia line with every machine at ${OVERCLOCK_TIER}.` },
  { key: 'styrene-oc', id: '', item: 'Styrene', name: `Styrene (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `Styrene with machines at ${OVERCLOCK_TIER}.` },
  { key: 'polyethylene-oc', id: '', item: 'Molten Polyethylene', name: `Polyethylene (overclocked to ${OVERCLOCK_TIER})`, kind: 'overclock', about: `Polyethylene with machines at ${OVERCLOCK_TIER}.` },
  { key: 'aluminium', id: '', item: 'Aluminium Ingot', name: `Aluminium from ores`, kind: 'long', about: `A longer chain: aluminium-bearing ores processed and smelted in a blast furnace.` },
  { key: 'titanium', id: '', item: 'Titanium Ingot', name: `Titanium`, kind: 'long', about: `Titanium from raw resources: one of the big early-game chains.` },
];
const TARGETS_BY_PACK: Record<string, Target[]> = { skygreg: SKYGREG, base: GREGTECH, gtnh: GTNH };


export function makeExamples(db: RecipeDatabase, pack: string): Build[] {
  const out: Build[] = [];
  (TARGETS_BY_PACK[pack] ?? SKYGREG).forEach((t, k) => {
    const item = (t.id ? db.itemById.get(t.id) : undefined) ?? db.items.find((i) => i.name === t.item && !i.isTag);
    if (!item) return;
    const plan = planRoute(db, [{ ...item, amount: 1 }], 'EV');
    const root = plan.links.find((l) => l.to == null);
    if (!root || !plan.nodes.length || plan.nodes.length > LIMIT[t.kind]) return;
    const maxDepth = Math.max(...plan.nodes.map((n) => n.depth));
    const rows = new Map<number, number>();
    const ids = new Map(plan.nodes.map((n, i) => [n.key, `node_${t.key}_${i}`]));
    const layout = new Map(plan.nodes.map((n) => {
      const row = rows.get(n.depth) ?? 0;
      rows.set(n.depth, row + 1);
      return [n.key, { x: (maxDepth - n.depth) * 620 + 40, y: row * 460 + 40 }];
    }));
    const make = (perSec: number, tiers: Map<string, VoltageTier>): CanvasNode[] => plan.nodes.map((n) => ({
      instanceId: ids.get(n.key)!,
      recipe: n.recipe,
      selectedTier: tiers.get(n.key) ?? n.recipe.baseTier,
      count: 1,
      countMode: 'auto',
      ...layout.get(n.key)!,
      ...(n.key === root.from ? { isTarget: true, targetRate: { itemId: root.outId, perSec } } : {}),
    }));
    const connections: Connection[] = plan.links
      .filter((l) => l.to != null)
      .map((l, i) => ({ id: `conn_${t.key}_${i}`, sourceInstanceId: ids.get(l.from)!, sourceItemId: l.outId, targetInstanceId: ids.get(l.to!)!, targetItemId: l.inId }));

    // Crafts per second each machine does at a reference rate: everything scales with the rate,
    // and a tier only changes how long one craft takes.
    const REF = 1;
    const ref = solveFlows(make(REF, new Map()), connections);
    const tierRange = (base: VoltageTier): VoltageTier[] => {
      const b = TIER_ORDER.indexOf(base);
      if (t.kind === 'overclock') return [TIER_ORDER[Math.max(b, TIER_ORDER.indexOf(OVERCLOCK_TIER))]];
      return TIER_ORDER.slice(b, Math.max(b, TIER_ORDER.indexOf(BASIC_TIER_CAP)) + 1);
    };
    const machines = plan.nodes.map((n) => {
      const crafts = ref.nodes.get(ids.get(n.key)!)?.cyclesPerSec ?? 0;
      const node = make(REF, new Map())[plan.nodes.indexOf(n)];
      const options = tierRange(n.recipe.baseTier).map((tier) => ({ tier, sec: machineStats({ ...node, selectedTier: tier }).durationSec }));
      return { key: n.key, crafts, options };
    }).filter((m) => m.crafts > 0);

    // Every rate where some machine runs exactly 1-6 machines' worth at some tier.
    const candidates = new Set<number>();
    for (const m of machines) for (const o of m.options) for (let c = 1; c <= 6; c++) candidates.add((c / (m.crafts * o.sec)) * REF);
    let best: { perSec: number; tiers: Map<string, VoltageTier>; total: number; use: number } | null = null;
    for (const perSec of candidates) {
      const tiers = new Map<string, VoltageTier>();
      let total = 0, needed = 0;
      for (const m of machines) {
        // Per machine: the tier needing the fewest machines, then the busiest, then the lowest.
        let pick: { tier: VoltageTier; count: number; need: number } | null = null;
        for (const o of m.options) {
          const need = m.crafts * (perSec / REF) * o.sec;
          const count = Math.max(1, Math.ceil(need - 1e-6));
          if (!pick || count < pick.count || (count === pick.count && need / count > pick.need / pick.count + 1e-9)) pick = { tier: o.tier, count, need };
        }
        tiers.set(m.key, pick!.tier);
        total += pick!.count;
        needed += pick!.need;
      }
      if (total > LIMIT[t.kind]) continue;
      const use = needed / total; // how busy the machines are, 1 = all flat out
      const better = !best || use > best.use + 0.005 || (Math.abs(use - best.use) <= 0.005 && (total < best.total || (total === best.total && perSec > best.perSec)));
      if (better) best = { perSec, tiers, total, use };
    }
    if (!best) return;
    // Keep the rate tidy (3 significant figures) without changing the machine counts.
    const tidy = Number(best.perSec.toPrecision(3));
    const nodes = make(tidy <= best.perSec ? tidy : best.perSec, best.tiers);
    const stats = analyzeFlow(nodes, connections).stats;
    const rate = formatRate(tidy, item.unit);
    out.push({
      id: `example-${pack}-${t.key}`,
      name: t.name,
      description: `${t.about} Makes ${rate} with ${stats.machines} machine${stats.machines === 1 ? '' : 's'}, all running ${Math.round(best.use * 100)}% of the time.`,
      author: 'gtcalc', authorId: 'gregcalc', pack,
      createdAt: Date.UTC(2026, 9, 1) - k * 3600_000,
      flow: { nodes, connections, targetEUtBudget: 100000 }, stats,
      upvoters: [], favoriters: [], commentCount: 0, example: true,
    });
  });
  return out;
}
