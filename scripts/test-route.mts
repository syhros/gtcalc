// Best Route spot check: npx tsx scripts/test-route.mts [item ids...]
import { readFileSync } from 'node:fs';
import { hydrate, unpack } from '../src/recipeData.ts';
import { planRoute } from '../src/bestRoute.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'));
const raw = read('data/recipes.json');
const db = hydrate(unpack(raw, Array.from({ length: raw.packed.parts }, (_, k) => read(raw.packed.file.replace('{k}', String(k))))));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['gtceu:oxygen', 'gtceu:nitrogen', 'gtceu:hydrogen', 'gtceu:nitric_acid', 'gtceu:sulfuric_acid', 'gtceu:steel_ingot'];
for (const id of ids) {
  const item = db.itemById.get(id);
  if (!item) { console.log(id, 'unknown'); continue; }
  const plan = planRoute(db, [item], 'IV');
  console.log(`${id}: ${plan.nodes.map((n) => n.recipe.id.split(':')[1]).join(' <- ')}  | raw: ${plan.raw.map((r) => r.id).join(', ')}`);
}
