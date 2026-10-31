// Compact, split recipe files (the format GTNH already uses; src/recipeData.ts unpack() reads it).
// Items and machine types go by number, a recipe's id keeps only what follows "<prefix><type>/",
// and its tier is left out (the app works it out from EU/t). The head file keeps everything else.
//   input row:  [item, amount] + 0 (not consumed) or 2 (fixed amount)
//   output row: [item, amount] + chance
import fs from 'node:fs';
import path from 'node:path';

const TIER_VOLTS = [['ULV', 8], ['LV', 32], ['MV', 128], ['HV', 512], ['EV', 2048], ['IV', 8192], ['LuV', 32768], ['ZPM', 131072], ['UV', 524288], ['UHV', 2097152], ['UEV', 8388608], ['UIV', 33554432], ['UXV', 134217728], ['OpV', 536870912]];
const tierOf = (eut) => TIER_VOLTS.find(([, v]) => v >= eut)?.[0] ?? 'MAX';

/**
 * Write `data` (a full recipes file object) as `<dataDir>/<name>.json` plus `<name>-<k>.json`
 * parts. `name` is e.g. "recipes-base"; the parts are named "<name>-0.json" and so on.
 * Returns the file sizes in bytes, head first.
 */
export function writePacked(dataDir, name, data, { parts = 2, idPrefix = 'gtceu:', partName = name } = {}) {
  const { recipes, ...head } = data;
  const items = Object.keys(head.items), itemNo = new Map(items.map((id, k) => [id, k]));
  const types = Object.keys(head.machines), typeNo = new Map(types.map((t, k) => [t, k]));
  const io = (list, out) => list.map((x) => {
    if (!itemNo.has(x.id)) throw new Error(`pack: item ${x.id} is not in items`);
    const row = [itemNo.get(x.id), x.amount];
    if (out) { if (x.chance != null) row.push(x.chance); }
    else if (x.consumed === false) row.push(0);
    else if (x.fixed) row.push(2);
    return row;
  });
  const pack = (r) => {
    if (!typeNo.has(r.type)) throw new Error(`pack: machine type ${r.type} is not in machines`);
    if (tierOf(r.eut) !== r.tier) throw new Error(`pack: ${r.id} is ${r.tier}, but ${r.eut} EU/t reads as ${tierOf(r.eut)}`);
    const pre = `${idPrefix}${r.type}/`;
    return {
      t: typeNo.get(r.type), ...(r.id.startsWith(pre) ? { n: r.id.slice(pre.length) } : { id: r.id }), e: r.eut, d: r.ticks, i: io(r.inputs, false), o: io(r.outputs, true),
      ...(r.circuit != null ? { c: r.circuit } : {}), ...(r.temp ? { h: r.temp } : {}), ...(r.gen ? { g: 1 } : {}), ...(r.boiler ? { b: 1 } : {}),
      ...(r.nonGT ? { x: 1 } : {}), ...(r.source !== 'gtceu' ? { s: r.source } : {}), ...(r.conditions ? { k: r.conditions } : {}), ...(r.startEU != null ? { u: r.startEU } : {}),
    };
  };
  for (const f of fs.readdirSync(dataDir)) if (new RegExp(`^${partName}-\\d+\\.json$`).test(f)) fs.rmSync(path.join(dataDir, f));
  const per = Math.ceil(recipes.length / parts);
  const files = [`${name}.json`, ...Array.from({ length: parts }, (_, k) => `${partName}-${k}.json`)];
  for (let k = 0; k < parts; k++) fs.writeFileSync(path.join(dataDir, files[k + 1]), JSON.stringify(recipes.slice(k * per, (k + 1) * per).map(pack)));
  fs.writeFileSync(path.join(dataDir, files[0]), JSON.stringify({ ...head, packed: { parts, file: `data/${partName}-{k}.json`, items, types, idPrefix } }));
  return files.map((f) => fs.statSync(path.join(dataDir, f)).size);
}

/** Read a recipes file, packed or not, back to its full form (for the importers' id carry-over). */
export function readRecipes(dataDir, name) {
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));
  const p = raw.packed;
  if (!p) return raw;
  const recipes = [];
  for (let k = 0; k < p.parts; k++) {
    const part = JSON.parse(fs.readFileSync(path.join(dataDir, path.basename(p.file.replace('{k}', String(k)))), 'utf8'));
    for (const r of part) {
      const type = p.types[r.t];
      recipes.push({
        id: r.id ?? `${p.idPrefix}${type}/${r.n}`, type, source: r.s ?? 'gtceu', tier: tierOf(r.e), eut: r.e, ticks: r.d,
        inputs: r.i.map(([k, amount, flag]) => ({ id: p.items[k], amount, ...(flag === 0 ? { consumed: false } : flag === 2 ? { fixed: true } : {}) })),
        outputs: r.o.map(([k, amount, chance]) => ({ id: p.items[k], amount, ...(chance != null ? { chance } : {}) })),
        ...(r.c != null ? { circuit: r.c } : {}), ...(r.h ? { temp: r.h } : {}), ...(r.g ? { gen: true } : {}), ...(r.b ? { boiler: true } : {}),
        ...(r.x ? { nonGT: true } : {}), ...(r.k ? { conditions: r.k } : {}), ...(r.u != null ? { startEU: r.u } : {}),
      });
    }
  }
  const { packed: _, ...head } = raw;
  return { ...head, recipes };
}

// One-off conversion: node scripts/lib/pack-recipes.mjs public/data recipes-base recipes-base 2
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const [dir, name, partName = name, parts = '2'] = process.argv.slice(2);
  const data = readRecipes(dir, name);
  console.log(name, writePacked(dir, name, data, { parts: Number(parts), partName }).map((b) => (b / 1048576).toFixed(2)).join(' + '), 'MB');
}
