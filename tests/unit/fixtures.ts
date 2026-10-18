// Small builders for solver tests: recipe items, recipes, canvas nodes and links.
import type { CanvasNode, Connection, MachineRecipe, RecipeItem, VoltageTier } from '../../src/types';

export const item = (id: string, amount: number, extra: Partial<RecipeItem> = {}): RecipeItem => ({ id, name: id, amount, unit: 'item', ...extra });
export const rec = (id: string, inputs: RecipeItem[], outputs: RecipeItem[], o: Partial<MachineRecipe> = {}): MachineRecipe =>
  ({ id, machineName: 'm', recipeName: id, baseTier: 'LV', baseEUt: 30, baseDurationSec: 1, durationTicks: 20, inputs, outputs, kind: 'single', ...o });
export const node = (id: string, recipe: MachineRecipe, o: Partial<CanvasNode> = {}): CanvasNode =>
  ({ instanceId: id, recipe, selectedTier: recipe.baseTier as VoltageTier, count: 1, countMode: 'auto', x: 0, y: 0, ...o });
let cid = 0;
export const conn = (s: string, si: string, t: string, ti: string): Connection =>
  ({ id: `c${cid++}`, sourceInstanceId: s, sourceItemId: si, targetInstanceId: t, targetItemId: ti });
