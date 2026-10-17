// Writes gtcalc's example flows to Community (as builds marked example: true), for every pack,
// using your Firebase CLI login. Run again to refresh them; their votes, favourites and comments
// are kept. npx tsx scripts/seed-examples.mts [--dry]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {} }; // format.ts reads display units
const { hydrate, unpack, MODPACKS } = await import('../src/recipeData.ts');
const { makeExamples } = await import('../src/examples.ts');

const require = createRequire(import.meta.url);
const root = path.join(execSync('npm prefix -g').toString().trim(), 'node_modules', 'firebase-tools', 'lib');
const auth = require(path.join(root, 'auth.js'));
const { configstore } = require(path.join(root, 'configstore.js'));
const DB = 'https://firestore.googleapis.com/v1/projects/greg-calc/databases/(default)/documents';
const dry = process.argv.includes('--dry');

type V = { stringValue: string } | { integerValue: string } | { doubleValue: number } | { booleanValue: boolean } | { nullValue: null } | { arrayValue: { values: V[] } } | { mapValue: { fields: Record<string, V> } } | { timestampValue: string };
const v = (x: unknown): V => typeof x === 'string' ? { stringValue: x }
  : typeof x === 'number' ? (Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x })
  : typeof x === 'boolean' ? { booleanValue: x }
  : Array.isArray(x) ? { arrayValue: { values: x.map(v) } }
  : x == null ? { nullValue: null }
  : { mapValue: { fields: Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).map(([k, y]) => [k, v(y)])) } };

const token = (await auth.getAccessToken(configstore.get('tokens').refresh_token, [])).access_token;
const headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'greg-calc', 'Content-Type': 'application/json' };

const existing = ((await (await fetch(`${DB}/builds?pageSize=300`, { headers })).json()).documents ?? []) as { name: string; fields: Record<string, { booleanValue?: boolean }> }[];
const keep = new Set<string>();
for (const pack of MODPACKS) {
  let raw = JSON.parse(readFileSync(new URL(`../public/${pack.file}`, import.meta.url), 'utf8'));
  // Split packs (GTNH): read the recipe parts too.
  if (raw.packed) raw = unpack(raw, Array.from({ length: raw.packed.parts }, (_, k) => JSON.parse(readFileSync(new URL(`../public/${raw.packed.file.replace('{k}', String(k))}`, import.meta.url), 'utf8'))));
  const db = hydrate(raw);
  for (const ex of makeExamples(db, pack.id)) {
    keep.add(ex.id);
    const fields = {
      name: v(ex.name), description: v(ex.description), author: v('gtcalc'), authorId: v('gregcalc'), pack: v(pack.id),
      createdAt: { timestampValue: new Date(ex.createdAt).toISOString() }, flowJson: v(JSON.stringify(ex.flow)),
      stats: v(JSON.parse(JSON.stringify(ex.stats))), example: v(true),
    };
    const url = `${DB}/builds/${ex.id}`;
    const exists = (await fetch(url, { headers })).ok;
    // A new example starts with no votes; an existing one keeps them (only its content is updated).
    const body = exists ? { fields } : { fields: { ...fields, upvoters: v([]), favoriters: v([]), commentCount: v(0) } };
    const mask = exists ? Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&') : '';
    console.log(`${dry ? '[dry] ' : ''}${exists ? 'update' : 'create'} ${ex.id}: ${ex.name} (${ex.stats.machines} machines)`);
    if (dry) continue;
    const r = await fetch(`${url}${mask ? `?${mask}` : ''}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (!r.ok) console.log('  failed', r.status, (await r.text()).slice(0, 200));
  }
}

// Examples that are no longer made (renamed or dropped) go, with their comments.
for (const d of existing) {
  const id = d.name.split('/').pop()!;
  if (d.fields.example?.booleanValue !== true || keep.has(id)) continue;
  console.log(`${dry ? '[dry] ' : ''}remove old example ${id}`);
  if (dry) continue;
  const comments = ((await (await fetch(`${DB}/builds/${id}/comments?pageSize=300`, { headers })).json()).documents ?? []) as { name: string }[];
  for (const c of comments) await fetch(`https://firestore.googleapis.com/v1/${c.name}`, { method: 'DELETE', headers });
  await fetch(`${DB}/builds/${id}`, { method: 'DELETE', headers });
}
