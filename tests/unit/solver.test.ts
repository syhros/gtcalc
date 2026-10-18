import { describe, expect, it } from 'vitest';
import { solveFlows } from '../../src/solver';
import { conn, item, node, rec } from './fixtures';

describe('recipes that list the same item more than once', () => {
  // Real shape from recipes.json: a macerator giving dust x1 plus dust x1 at 14%.
  const mac = rec('mac', [item('ore', 1)], [item('dust', 1), item('dust', 1, { chance: 0.14 })], { baseEUt: 2, baseTier: 'ULV', durationTicks: 400, baseDurationSec: 20 });

  it('count every copy of an output when sizing the producer', () => {
    const A = node('A', mac);
    const B = node('B', rec('use', [item('dust', 1)], [item('out', 1)]), { isTarget: true, targetRate: { itemId: 'out', perSec: 1 } });
    const r = solveFlows([A, B], [conn('A', 'dust', 'B', 'dust')]);
    expect(r.nodes.get('A')!.cyclesPerSec).toBeCloseTo(1 / 1.14, 6);
    expect(r.nodes.get('A')!.outputRates.dust).toBeCloseTo(1, 6);
  });

  it('count every copy of an output for a target rate', () => {
    const A = node('A', mac, { isTarget: true, targetRate: { itemId: 'dust', perSec: 1.14 } });
    const r = solveFlows([A], []);
    expect(r.nodes.get('A')!.cyclesPerSec).toBeCloseTo(1, 6);
  });

  it('count every copy of an input', () => {
    const S = node('S', rec('make', [], [item('x', 1)]));
    const T = node('T', rec('eat', [item('x', 1), item('x', 2)], [item('out', 1)]), { isTarget: true, targetRate: { itemId: 'out', perSec: 1 } });
    const r = solveFlows([S, T], [conn('S', 'x', 'T', 'x')]);
    expect(r.nodes.get('S')!.cyclesPerSec).toBeCloseTo(3, 6);
  });
});

describe('small flows next to huge ones', () => {
  // A liquid-air chain with real GTNH amounts (1e8 mB per distillation craft) on the same board
  // as an unrelated 1 dust/s link. The dust link must not be snapped to zero.
  const mB = { unit: 'mB' as const };
  const A = node('A', rec('freezer', [item('air', 2000, mB)], [item('liquidair', 1000, mB)], { baseEUt: 120 }));
  const B = node('B', rec('tower', [item('liquidair', 1e8, mB)], [item('xenon', 9, mB)], { baseEUt: 1920, durationTicks: 2000 }));
  const D = node('D', rec('dustmaker', [item('ore', 1)], [item('dust', 1)], { baseEUt: 30 }));
  const C = node('C', rec('furnace', [item('xenon', 250, mB), item('dust', 1)], [item('bar', 1)], { baseEUt: 500, durationTicks: 20 }), { isTarget: true, targetRate: { itemId: 'bar', perSec: 1 } });
  const links = [conn('A', 'liquidair', 'B', 'liquidair'), conn('B', 'xenon', 'C', 'xenon'), conn('D', 'dust', 'C', 'dust')];

  it('keep a 1/s link and its producer', () => {
    const r = solveFlows([A, B, C, D], links);
    expect(r.connections.get(links[2].id)!.needed).toBeCloseTo(1, 6);
    expect(r.nodes.get('D')!.cyclesPerSec).toBeCloseTo(1, 6);
    expect(r.unstable).toBe(false);
  });
});

describe('outputs with a low chance', () => {
  // The only maker of X has a low chance of making it: the solver must run it, never leave X short.
  for (const chance of [1e-2, 1e-4, 1e-5, 1e-7]) {
    it(`runs the maker for chance ${chance}`, () => {
      const P = node('P', rec('p', [item('ore', 1)], [item('x', 1, { chance })], { baseEUt: 30, durationTicks: 20 }));
      const T = node('T', rec('t', [item('x', 1)], [item('y', 1)]), { isTarget: true, targetRate: { itemId: 'y', perSec: 1 } });
      const r = solveFlows([P, T], [conn('P', 'x', 'T', 'x')]);
      expect(r.nodes.get('P')!.cyclesPerSec / (1 / chance)).toBeCloseTo(1, 6);
      expect([...r.connections.values()][0].diff).toBeCloseTo(0, 6);
    });
  }

  it('still leaves an input short when a locked count caps its only maker', () => {
    const P = node('P', rec('p', [item('ore', 1)], [item('x', 1)]), { countMode: 'manual', count: 1 });
    const T = node('T', rec('t', [item('x', 1)], [item('y', 1)]), { isTarget: true, targetRate: { itemId: 'y', perSec: 3 } });
    const r = solveFlows([P, T], [conn('P', 'x', 'T', 'x')]);
    expect(r.nodes.get('P')!.cyclesPerSec).toBeCloseTo(1, 6);
    expect(r.unstable).toBe(false);
  });

  it('prefers the cheaper of two makers', () => {
    const cheap = node('cheap', rec('c', [item('ore', 1)], [item('x', 1)], { baseEUt: 8 }));
    const dear = node('dear', rec('d', [item('ore', 1)], [item('x', 1)], { baseEUt: 480, baseTier: 'MV' }));
    const T = node('T', rec('t', [item('x', 1)], [item('y', 1)]), { isTarget: true, targetRate: { itemId: 'y', perSec: 1 } });
    const r = solveFlows([cheap, dear, T], [conn('cheap', 'x', 'T', 'x'), conn('dear', 'x', 'T', 'x')]);
    expect(r.nodes.get('cheap')!.cyclesPerSec).toBeCloseTo(1, 6);
    expect(r.nodes.get('dear')!.cyclesPerSec).toBe(0);
  });
});
