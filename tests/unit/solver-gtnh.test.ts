// Real GTNH data: the Best Route chain for iridium bars at 1/s. Amounts span about 1e8 to 1, which
// used to trip the simplex's absolute tolerances: a false "couldn't balance" banner and an LP row
// that wasn't met (hydrogen used 3000/s, links carrying 2250/s).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planRoute } from '../../src/bestRoute';
import { hydrate, unpack } from '../../src/recipeData';
import { solveFlows } from '../../src/solver';
import type { CanvasNode, Connection, VoltageTier } from '../../src/types';

const DIR = 'public/data/';
const raw = JSON.parse(fs.readFileSync(DIR + 'recipes-gtnh.json', 'utf8'));
const parts = Array.from({ length: raw.packed.parts }, (_, k) => JSON.parse(fs.readFileSync(`${DIR}recipes-gtnh-${k}.json`, 'utf8')));
const db = hydrate(unpack(raw, parts));

function chain(itemId: string, tier: VoltageTier) {
  const target = db.itemById.get(itemId)!;
  const plan = planRoute(db, [{ ...target, amount: 1 }], tier);
  const root = plan.links.find((l) => l.to == null)!;
  const nodes: CanvasNode[] = plan.nodes.map((x, i) => ({
    instanceId: x.key, recipe: x.recipe, selectedTier: x.recipe.baseTier as VoltageTier, count: 1, countMode: 'auto', x: 0, y: i * 10,
    ...(x.key === root.from ? { isTarget: true, targetRate: { itemId: root.outId, perSec: 1 } } : {}),
  }));
  const conns: Connection[] = plan.links.filter((l) => l.to != null)
    .map((l, i) => ({ id: `c${i}`, sourceInstanceId: l.from, sourceItemId: l.outId, targetInstanceId: l.to!, targetItemId: l.inId }));
  return { nodes, conns };
}

describe('real GTNH chains', () => {
  it('iridium bars balance exactly', () => {
    const { nodes, conns } = chain('dreamcraft:item.IridiumBars:0', 'LuV');
    const r = solveFlows(nodes, conns);
    expect(r.unstable).toBe(false);
    // Every linked input's use matches what its links carry.
    for (const n of nodes) {
      const f = r.nodes.get(n.instanceId)!;
      for (const i of new Set(n.recipe.inputs.map((x) => x.id))) {
        const links = conns.filter((c) => c.targetInstanceId === n.instanceId && c.targetItemId === i);
        if (!links.length) continue;
        const carried = links.reduce((a, c) => a + r.connections.get(c.id)!.needed, 0);
        const used = f.inputRates[i] ?? 0;
        expect(Math.abs(carried - used)).toBeLessThanOrEqual(1e-6 * Math.max(1, used));
      }
    }
  });
});
