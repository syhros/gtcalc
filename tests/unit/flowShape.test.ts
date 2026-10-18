// Imported files and shared builds are untrusted: after cleanFlow, nothing in them may crash
// the solver, and a well-formed flow must come through unchanged.
import { describe, expect, it } from 'vitest';
import { cleanFlow } from '../../src/flowShape';
import { solveFlows } from '../../src/solver';
import { conn, item, node, rec } from './fixtures';

const good = () => {
  const a = node('a', rec('r', [item('x', 1)], [item('y', 1, { chance: 0.5 })]), { multi: { variantId: 'v', name: 'v', parallel: 4 } as never });
  const b = node('b', rec('s', [item('y', 2)], [item('z', 1)]), { isTarget: true, targetRate: { itemId: 'z', perSec: 1 } });
  return { nodes: [a, b], connections: [conn('a', 'y', 'b', 'y')] };
};

describe('cleanFlow', () => {
  it('keeps a well-formed flow as it is', () => {
    const f = good();
    expect(cleanFlow(JSON.parse(JSON.stringify(f)))).toEqual(JSON.parse(JSON.stringify(f)));
  });

  it('refuses things that are not flows', () => {
    for (const raw of [null, 7, 'x', [], {}, { nodes: 'no' }]) expect(cleanFlow(raw)).toBeNull();
  });

  // The cases the bug hunt found, then random damage to every field.
  it.each([
    ['a null link', (f: any) => { f.connections.push(null); }],
    ['a null input', (f: any) => { f.nodes[0].recipe.inputs.push(null); }],
    ['a tier with a space and a parallel hatch', (f: any) => { f.nodes[0].selectedTier = 'HV '; }],
    ['a link to a missing card', (f: any) => { f.connections.push({ ...f.connections[0], id: 'z', targetInstanceId: 'gone' }); }],
    ['a generator with a bad rotor', (f: any) => { f.nodes[0].gen = { variantId: 'v', kind: 'turbine', name: 't', tier: 'XX', rotor: 'steel' }; }],
  ])('survives %s', (_label, damage) => {
    const f = JSON.parse(JSON.stringify(good()));
    damage(f);
    const clean = cleanFlow(f)!;
    expect(() => solveFlows(clean.nodes, clean.connections)).not.toThrow();
  });

  it('survives random damage to any field', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const junk = [null, undefined, 'HV ', -1, NaN, Infinity, 0, {}, [], [null], 'x', true];
    const paths = (o: any, prefix: (string | number)[] = []): (string | number)[][] =>
      o && typeof o === 'object' ? Object.keys(o).flatMap((k) => [[...prefix, k], ...paths(o[k], [...prefix, k])]) : [];
    for (let trial = 0; trial < 2000; trial++) {
      const f = JSON.parse(JSON.stringify(good()));
      const all = paths(f);
      for (let hits = 1 + Math.floor(rand() * 3); hits > 0; hits--) {
        const p = all[Math.floor(rand() * all.length)];
        let o: any = f;
        for (const k of p.slice(0, -1)) o = o?.[k];
        if (o && typeof o === 'object') o[p[p.length - 1]] = junk[Math.floor(rand() * junk.length)];
      }
      const clean = cleanFlow(f);
      if (clean) expect(() => solveFlows(clean.nodes, clean.connections), JSON.stringify(f)).not.toThrow();
    }
  });
});
