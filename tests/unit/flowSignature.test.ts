// "Update shared" appears when a shared flow's signature differs from the local copy's, so every
// setting that changes the numbers must change the signature.
import { describe, expect, it } from 'vitest';
import { flowSignature } from '../../src/flowSignature';
import type { GeneratorConfig } from '../../src/types';
import { item, node, rec } from './fixtures';

const turbine = (gen: GeneratorConfig, x = 0) => ({
  nodes: [node('t', rec('turb', [item('steam', 1)], [], { generatesEU: true, kind: 'generator' }), { gen, x })],
  connections: [],
});
const base: GeneratorConfig = { variantId: 'large_steam_turbine', kind: 'turbine', name: 'x', tier: 'EV', holderTier: 'EV', rotor: { id: 'steel', name: 'Steel', power: 100, efficiency: 100 } };

describe('flowSignature', () => {
  it('changes with the turbine rotor', () => {
    expect(flowSignature(turbine(base))).not.toBe(flowSignature(turbine({ ...base, rotor: { id: 'tungstensteel', name: 'TS', power: 150, efficiency: 110 } })));
  });
  it('changes with the rotor holder tier', () => {
    expect(flowSignature(turbine(base))).not.toBe(flowSignature(turbine({ ...base, holderTier: 'LuV' })));
  });
  it('changes with the boost fluid', () => {
    const boosted = { ...base, boostOn: true, boost: { fluid: 'oxygen', perTick: 1, factor: 3 } };
    expect(flowSignature(turbine(boosted))).not.toBe(flowSignature(turbine({ ...boosted, boost: { fluid: 'liquid_oxygen', perTick: 1, factor: 3 } })));
  });
  it('ignores card positions', () => {
    expect(flowSignature(turbine(base, 0))).toBe(flowSignature(turbine(base, 500)));
  });
});
