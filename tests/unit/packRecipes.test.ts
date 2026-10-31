// The compact recipe files (scripts/lib/pack-recipes.mjs) must read back to exactly what went in,
// both in the app (unpack) and in the importers (readRecipes): saved flows find recipes by id.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unpack } from '../../src/recipeData';
import { readRecipes, writePacked } from '../../scripts/lib/pack-recipes.mjs';

const data = {
  version: 1,
  generatedAt: '2026-10-31T00:00:00.000Z',
  gtceuVersion: 'test',
  sources: { kubejs: 1, gtceu: 3, builtin: 0, removedByPack: 0, hasDump: true },
  tierCasings: {},
  machines: { macerator: { name: 'Macerator' }, steam_boiler: { name: 'Steam Boiler' }, cutter: { name: 'Cutter' } },
  items: { 'minecraft:iron_ore': { name: 'Iron Ore' }, 'gtceu:iron_dust': { name: 'Iron Dust' }, 'gtceu:steam': { name: 'Steam' }, 'gtceu:water': { name: 'Water' }, '#forge:logs': { name: 'Logs' }, 'minecraft:oak_planks': { name: 'Oak Planks' } },
  recipes: [
    { id: 'gtceu:macerator/iron_ore', type: 'macerator', source: 'gtceu', tier: 'LV', eut: 30, ticks: 200, inputs: [{ id: 'minecraft:iron_ore', amount: 1 }], outputs: [{ id: 'gtceu:iron_dust', amount: 1 }, { id: 'gtceu:iron_dust', amount: 1, chance: 0.14 }], circuit: 1 },
    { id: 'gtceu:steam_boiler/logs', type: 'steam_boiler', source: 'gtceu', tier: 'ULV', eut: 0, ticks: 100, inputs: [{ id: '#forge:logs', amount: 1 }, { id: 'gtceu:water', amount: 6, fixed: true }], outputs: [{ id: 'gtceu:steam', amount: 960 }], boiler: true, nonGT: true },
    { id: 'kubejs:cutter/oak_planks', type: 'cutter', source: 'kubejs', tier: 'IV', eut: 7680, ticks: 40, inputs: [{ id: '#forge:logs', amount: 1 }, { id: 'gtceu:water', amount: 4, consumed: false }], outputs: [{ id: 'minecraft:oak_planks', amount: 6 }], conditions: ['cleanroom'], temp: 1800, gen: true, startEU: 1000 },
  ],
};

describe('packed recipe files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtcalc-pack-'));
  writePacked(dir, 'recipes-test', data, { parts: 2 });

  it('read back unchanged by the importers', () => {
    expect(readRecipes(dir, 'recipes-test')).toEqual(data);
  });

  it('read back unchanged by the app', () => {
    const head = JSON.parse(fs.readFileSync(path.join(dir, 'recipes-test.json'), 'utf8'));
    const parts = Array.from({ length: head.packed.parts }, (_, k) => JSON.parse(fs.readFileSync(path.join(dir, `recipes-test-${k}.json`), 'utf8')));
    const { packed: _, ...out } = unpack(head, parts);
    expect(out).toEqual(data);
  });

  it('refuses a recipe whose tier does not match its EU/t', () => {
    expect(() => writePacked(dir, 'recipes-bad', { ...data, recipes: [{ ...data.recipes[0], tier: 'HV' }] }, { parts: 1 })).toThrow(/reads as LV/);
  });
});
