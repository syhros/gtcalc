import type { CanvasNode, Connection } from './types';

/**
 * What makes a flow the same flow for "has it changed since I shared it?": machines, recipes,
 * tiers, counts, targets, generator setup (machine, rotor, holder tier, boost) and links. Card
 * positions don't count.
 */
export function flowSignature(f: { nodes: CanvasNode[]; connections: Connection[] }): string {
  const nodes = f.nodes.map((n) => [n.instanceId, n.recipe.id, n.selectedTier, n.countMode === 'manual' ? n.count : 'auto', n.multi?.variantId ?? '', n.multi?.parallel ?? 0,
    n.gen?.variantId ?? '', n.gen?.boostOn ? 1 : 0, n.gen?.rotor?.id ?? '', n.gen?.holderTier ?? '', n.gen?.boost?.fluid ?? '', n.isTarget ? 1 : 0, n.targetRate ? `${n.targetRate.itemId}:${n.targetRate.perSec}` : '', n.targetEUt ?? '', n.supplyLimit ?? '', n.setupLocked ? 1 : 0].join('|')).sort();
  const links = f.connections.map((c) => `${c.sourceInstanceId}>${c.sourceItemId}>${c.targetInstanceId}>${c.targetItemId}`).sort();
  return `${nodes.join(';')}#${links.join(';')}`;
}
