// Runs KubeJS startup + server scripts inside a Node VM against a mocked KubeJS API,
// recording every `event.recipes.gtceu.<type>(id)` builder chain exactly as written,
// plus `event.remove(...)` filters and startup registrations (recipe types, machines,
// materials, items) so machine kinds, textures, names and colours can be resolved.
//
// Anything the mock doesn't know about becomes a "hole": a callable, chainable proxy
// that swallows every access. Unknown globals are discovered by catching
// ReferenceErrors and re-running the script with that name defined as a hole.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const V = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608, 33554432, 134217728, 536870912, 2147483647];
const VA = [7, 30, 120, 480, 1920, 7680, 30720, 122880, 491520, 1966080, 7864320, 31457280, 125829120, 503316480, 2013265920];
const VN = ['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UXV', 'OpV', 'MAX'];

function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** KubeJS orders scripts by a `// priority: N` header (higher first), then by path. */
function sortByPriority(files) {
  const prio = (f) => {
    const m = /^\s*\/\/\s*priority:\s*(-?\d+)/m.exec(fs.readFileSync(f, 'utf8').slice(0, 500));
    return m ? Number(m[1]) : 0;
  };
  return files
    .map((f) => ({ f, p: prio(f) }))
    .sort((a, b) => b.p - a.p || a.f.localeCompare(b.f))
    .map((x) => x.f);
}

export function runKubeJS(kubejsDir) {
  const holeMeta = new WeakMap();
  const state = {
    recipes: [],
    removals: [],
    replacements: [],
    registry: [],
    errors: [],
    autoGlobals: new Set(),
    serverCallbacks: [],
    currentFile: '',
  };

  // ---------- holes ----------
  function hole(name, parent = null, args = null) {
    const target = function () {};
    let proxy;
    proxy = new Proxy(target, {
      get(_t, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === Symbol.iterator) return function* () {};
        if (typeof key === 'symbol') return undefined;
        if (key === 'toString' || key === 'toJSON') return () => `[${name}]`;
        if (key === 'then') return undefined;
        if (key === 'length') return 0;
        return hole(`${name}.${key}`, proxy);
      },
      apply(_t, _this, callArgs) {
        return hole(`${name}()`, proxy, callArgs);
      },
      construct(_t, callArgs) {
        return hole(`new ${name}`, proxy, callArgs);
      },
      set() { return true; },
    });
    holeMeta.set(proxy, { name, parent, args });
    return proxy;
  }
  const isHole = (x) => (typeof x === 'function' || typeof x === 'object') && x !== null && holeMeta.has(x);

  /** Collect every string reachable from a value (including hole call arguments). */
  function collectStrings(value, out = [], depth = 0) {
    if (depth > 8 || value == null) return out;
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out, depth + 1));
    else if (isHole(value)) {
      const meta = holeMeta.get(value);
      if (meta.args) collectStrings(meta.args, out, depth + 1);
      if (meta.parent) collectStrings(meta.parent, out, depth + 1);
    } else if (typeof value === 'object') {
      for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
    }
    return out;
  }

  const toNum = (x) => {
    if (typeof x === 'number') return x;
    if (typeof x === 'bigint') return Number(x);
    if (isHole(x)) return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };

  // ---------- stacks ----------
  function makeStack(kind, id, amount, extra = {}) {
    const data = { __kind: kind, id: String(id), amount, ...extra };
    let proxy;
    proxy = new Proxy(data, {
      get(t, key) {
        if (key === '__data') return t;
        if (key in t) return t[key];
        if (key === Symbol.toPrimitive) return () => (kind === 'item' ? `${t.amount}x ${t.id}` : `${t.id} ${t.amount}`);
        if (typeof key === 'symbol') return undefined;
        if (key === 'withChance') return (c) => { t.chance = toNum(c); return proxy; };
        if (key === 'withCount' || key === 'withAmount' || key === 'copyWithCount') return (n) => { t.amount = toNum(n) ?? t.amount; return proxy; };
        if (key === 'getId' || key === 'id') return () => t.id;
        return () => proxy;
      },
    });
    return proxy;
  }

  const stackData = (x) => (x && typeof x === 'object' && x.__data ? x.__data : null);

  function parseItemString(s) {
    let str = String(s).trim();
    let count = 1;
    const m = /^(\d+)\s*x\s+(.+)$/i.exec(str);
    if (m) { count = Number(m[1]); str = m[2].trim(); }
    // Strip inline NBT (`id{...}`), it doesn't change identity for flow calculation.
    const nbt = str.indexOf('{');
    if (nbt > 0) str = str.slice(0, nbt).trim();
    return { id: str, amount: count };
  }

  function parseFluidString(s) {
    const str = String(s).trim();
    const m = /^(\S+)\s+(\d+)$/.exec(str);
    if (m) return { id: m[1], amount: Number(m[2]) };
    return { id: str, amount: 1000 };
  }

  /** Normalise anything passed as an item into {id, amount, isTag, chance?} or null. */
  function normItem(x) {
    if (x == null) return null;
    const sd = stackData(x);
    if (sd) return { id: sd.id.replace(/^#/, ''), isTag: sd.id.startsWith('#') || !!sd.isTag, amount: sd.amount ?? 1, chance: sd.chance };
    if (typeof x === 'string') {
      const { id, amount } = parseItemString(x);
      return { id: id.replace(/^#/, ''), isTag: id.startsWith('#'), amount };
    }
    if (isHole(x)) return { unresolved: holeMeta.get(x).name };
    if (typeof x === 'object' && (x.item || x.tag)) return { id: x.item || x.tag, isTag: !!x.tag, amount: toNum(x.count) ?? 1 };
    return { unresolved: String(x) };
  }

  function normFluid(x) {
    if (x == null) return null;
    const sd = stackData(x);
    if (sd) return { id: sd.id.replace(/^#/, ''), isTag: sd.id.startsWith('#'), amount: sd.amount ?? 1000, chance: sd.chance };
    if (typeof x === 'string') {
      const { id, amount } = parseFluidString(x);
      return { id: id.replace(/^#/, ''), isTag: id.startsWith('#'), amount };
    }
    if (isHole(x)) return { unresolved: holeMeta.get(x).name };
    return { unresolved: String(x) };
  }

  const ItemApi = new Proxy({}, {
    get(_t, key) {
      if (key === 'of') {
        return (id, a, b) => {
          const sd = stackData(id);
          if (sd) return id;
          const parsed = parseItemString(id);
          let amount = parsed.amount;
          if (typeof a === 'number') amount = a;
          else if (typeof b === 'number') amount = b;
          return makeStack('item', parsed.id, amount);
        };
      }
      if (key === 'empty') return makeStack('item', 'minecraft:air', 0);
      if (typeof key === 'symbol') return undefined;
      return hole(`Item.${key}`);
    },
  });

  const ingredientOf = (id, count) => {
    const sd = stackData(id);
    if (sd) { if (typeof count === 'number') sd.amount = count; return id; }
    if (Array.isArray(id)) return ingredientOf(id[0], count);
    if (isHole(id)) return id;
    const parsed = parseItemString(id);
    return makeStack('item', parsed.id, typeof count === 'number' ? count : parsed.amount);
  };
  const IngredientApi = new Proxy({}, {
    get(_t, key) {
      if (key === 'of') return ingredientOf;
      if (typeof key === 'symbol') return undefined;
      return hole(`Ingredient.${key}`);
    },
  });

  const FluidApi = new Proxy({}, {
    get(_t, key) {
      if (key === 'of') {
        return (id, amount) => {
          const sd = stackData(id);
          if (sd) return id;
          const parsed = parseFluidString(id);
          return makeStack('fluid', parsed.id, typeof amount === 'number' ? amount : parsed.amount);
        };
      }
      if (typeof key === 'symbol') return undefined;
      // Fluid.water(1000), Fluid.lava() ...
      return (amount) => makeStack('fluid', `minecraft:${String(key)}`, typeof amount === 'number' ? amount : 1000);
    },
  });

  // ---------- GT recipe builder ----------
  function makeBuilder(type, id) {
    const r = {
      type: String(type),
      id: id == null ? null : String(id),
      itemInputs: [],
      itemOutputs: [],
      fluidInputs: [],
      fluidOutputs: [],
      duration: null,
      EUt: null,
      inputEU: null,
      circuit: null,
      conditions: [],
      extra: {},
      warnings: [],
      file: state.currentFile,
    };
    state.recipes.push(r);
    const addAll = (list, norm, args, opts = {}) => {
      for (const a of args.flat(Infinity)) {
        const n = norm(a);
        if (!n) continue;
        if (n.unresolved) { r.warnings.push(`unresolved ${opts.label}: ${n.unresolved}`); continue; }
        list.push({ ...n, ...opts.extra });
      }
    };
    const chance = (c) => {
      if (typeof c === 'string' && c.includes('/')) {
        const [a, b] = c.split('/').map(Number);
        return b ? a / b : null;
      }
      const n = toNum(c);
      return n == null ? null : n / 10000;
    };
    let proxy;
    proxy = new Proxy({}, {
      get(_t, key) {
        if (typeof key === 'symbol') return undefined;
        switch (key) {
          case 'itemInputs': case 'inputItems':
            return (...a) => { addAll(r.itemInputs, normItem, a, { label: 'item input' }); return proxy; };
          case 'itemOutputs': case 'outputItems':
            return (...a) => { addAll(r.itemOutputs, normItem, a, { label: 'item output' }); return proxy; };
          case 'inputFluids': case 'fluidInputs':
            return (...a) => { addAll(r.fluidInputs, normFluid, a, { label: 'fluid input' }); return proxy; };
          case 'outputFluids': case 'fluidOutputs':
            return (...a) => { addAll(r.fluidOutputs, normFluid, a, { label: 'fluid output' }); return proxy; };
          case 'notConsumable':
            return (...a) => { addAll(r.itemInputs, normItem, a, { label: 'item input', extra: { consumed: false } }); return proxy; };
          case 'notConsumableFluid':
            return (...a) => { addAll(r.fluidInputs, normFluid, a, { label: 'fluid input', extra: { consumed: false } }); return proxy; };
          case 'chancedInput':
            return (x, c) => { addAll(r.itemInputs, normItem, [x], { label: 'item input', extra: { chance: chance(c) } }); return proxy; };
          case 'chancedOutput':
            return (x, c) => { addAll(r.itemOutputs, normItem, [x], { label: 'item output', extra: { chance: chance(c) } }); return proxy; };
          case 'chancedFluidInput':
            return (x, c) => { addAll(r.fluidInputs, normFluid, [x], { label: 'fluid input', extra: { chance: chance(c) } }); return proxy; };
          case 'chancedFluidOutput':
            return (x, c) => { addAll(r.fluidOutputs, normFluid, [x], { label: 'fluid output', extra: { chance: chance(c) } }); return proxy; };
          case 'duration':
            return (t) => { r.duration = toNum(t); return proxy; };
          case 'EUt':
            return (v, amps) => { const n = toNum(v); r.EUt = n == null ? null : n * (toNum(amps) ?? 1); return proxy; };
          case 'inputEU':
            return (v) => { r.inputEU = toNum(v); return proxy; };
          case 'outputEU':
            return (v) => { r.extra.outputEU = toNum(v); return proxy; };
          case 'circuit':
            return (n) => { r.circuit = toNum(n); return proxy; };
          case 'id':
            return (x) => { r.id = String(x); return proxy; };
          case 'blastFurnaceTemp':
            return (t) => { r.extra.blastFurnaceTemp = toNum(t); return proxy; };
          case 'CWUt': case 'totalCWU': case 'fusionStartEU':
            return (v) => { r.extra[key] = toNum(v); return proxy; };
          case 'cleanroom': case 'dimension': case 'biome': case 'daytime': case 'rain':
          case 'adjacentFluids': case 'adjacentBlocks': case 'stationResearch': case 'scannerResearch':
          case 'researchWithoutRecipe':
            return (...a) => {
              const s = collectStrings(a).filter((x) => x.length < 80);
              r.conditions.push(s.length ? `${key}: ${s.join(', ')}` : typeof a[0] === 'boolean' ? `${key}: ${a[0]}` : key);
              return proxy;
            };
          default:
            return () => proxy;
        }
      },
    });
    return proxy;
  }

  const gtRecipes = new Proxy({}, {
    get(_t, type) {
      if (typeof type === 'symbol') return undefined;
      return (id) => makeBuilder(type, id);
    },
  });

  function makeRecipeEvent() {
    const recipesNs = new Proxy({}, {
      get(_t, ns) {
        if (ns === 'gtceu') return gtRecipes;
        if (typeof ns === 'symbol') return undefined;
        return hole(`event.recipes.${ns}`);
      },
    });
    return new Proxy({}, {
      get(_t, key) {
        if (typeof key === 'symbol') return undefined;
        if (key === 'recipes') return recipesNs;
        if (key === 'remove') return (filter) => { state.removals.push({ filter, file: state.currentFile }); };
        if (key === 'replaceInput' || key === 'replaceOutput') {
          return (filter, from, to) => { state.replacements.push({ kind: key, filter, from, to, file: state.currentFile }); };
        }
        if (key === 'forEachRecipe') return () => {};
        if (key === 'findRecipes') return () => [];
        if (key === 'countRecipes') return () => 0;
        if (key === 'containsRecipe') return () => false;
        return hole(`event.${key}`);
      },
    });
  }

  // ---------- registries (startup) ----------
  function makeRegistryEvent(registry) {
    return new Proxy({}, {
      get(_t, key) {
        if (typeof key === 'symbol') return undefined;
        if (key === 'create' || key === 'createCustom') {
          return (name, kind) => {
            const entry = { registry: String(registry), name: String(name), kind: typeof kind === 'string' ? kind : null, calls: [], file: state.currentFile };
            state.registry.push(entry);
            let rec;
            rec = new Proxy({}, {
              get(_r, method) {
                if (typeof method === 'symbol') return undefined;
                return (...args) => { entry.calls.push([method, args]); return rec; };
              },
            });
            return rec;
          };
        }
        return hole(`registryEvent.${key}`);
      },
    });
  }

  const eventGroup = (groupName, handlers) => new Proxy({}, {
    get(_t, key) {
      if (typeof key === 'symbol') return undefined;
      if (handlers[key]) return handlers[key];
      return () => {};
    },
  });

  // Callbacks that run later (server recipe events) are queued; startup registry
  // callbacks run immediately, as in KubeJS.
  const pendingCallbacks = [];
  const ServerEvents = eventGroup('ServerEvents', {
    recipes: (cb) => { pendingCallbacks.push({ cb, file: state.currentFile, makeEvent: makeRecipeEvent }); },
  });
  const registryHandler = (registry, cb) => {
    if (typeof cb !== 'function') return;
    pendingCallbacks.push({ cb, file: state.currentFile, makeEvent: () => makeRegistryEvent(registry), immediate: true });
  };
  const StartupEvents = eventGroup('StartupEvents', { registry: registryHandler });
  const GTCEuStartupEvents = eventGroup('GTCEuStartupEvents', { registry: registryHandler });

  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    global: {},
    Item: ItemApi,
    Fluid: FluidApi,
    Ingredient: IngredientApi,
    InputItem: IngredientApi,
    OutputItem: IngredientApi,
    InputFluid: FluidApi,
    FluidStack: FluidApi,
    SizedIngredient: IngredientApi,
    ServerEvents,
    StartupEvents,
    GTCEuStartupEvents,
    GTValues: new Proxy({ V, VA, VN, VH: V.map((v) => v / 2), VHA: VA.map((v) => v / 2), ...Object.fromEntries(VN.map((n, i) => [n, i])) }, {
      get(t, k) { return k in t ? t[k] : typeof k === 'symbol' ? undefined : hole(`GTValues.${String(k)}`); },
    }),
    GTCEu: new Proxy({ id: (p) => `gtceu:${p}` }, {
      get(t, k) { return k in t ? t[k] : typeof k === 'symbol' ? undefined : hole(`GTCEu.${String(k)}`); },
    }),
    Platform: new Proxy({ isLoaded: () => true, isClientEnvironment: () => false }, {
      get(t, k) { return k in t ? t[k] : typeof k === 'symbol' ? undefined : hole(`Platform.${String(k)}`); },
    }),
    Java: { loadClass: (name) => hole(String(name)) },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  const snapshot = () => ({ recipes: state.recipes.length, removals: state.removals.length, replacements: state.replacements.length, registry: state.registry.length, pending: pendingCallbacks.length });
  const restore = (s) => {
    state.recipes.length = s.recipes;
    state.removals.length = s.removals;
    state.replacements.length = s.replacements;
    state.registry.length = s.registry;
    pendingCallbacks.length = s.pending;
  };

  /** Run `fn`, auto-defining unknown globals as holes and retrying from a clean snapshot. */
  function withRetries(label, fn) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const snap = snapshot();
      try {
        fn();
        return true;
      } catch (e) {
        const msg = e && e.message ? String(e.message) : String(e);
        const m = /^(\S+) is not defined$/.exec(msg);
        if (e && e.name === 'ReferenceError' && m && !(m[1] in sandbox)) {
          restore(snap);
          sandbox[m[1]] = hole(m[1]);
          state.autoGlobals.add(m[1]);
          continue;
        }
        // Any other error: keep what was recorded before it, but report it.
        state.errors.push({ where: label, message: msg });
        return false;
      }
    }
    state.errors.push({ where: label, message: 'gave up after too many retries' });
    return false;
  }

  function runFile(file) {
    let code = fs.readFileSync(file, 'utf8');
    // KubeJS scripts share one global scope. Re-running a file after defining a missing
    // global must not trip "already declared", so top-level let/const become var.
    code = code.replace(/^(const|let)(\s)/gm, 'var$2');
    state.currentFile = file;
    withRetries(file, () => vm.runInContext(code, ctx, { filename: file, timeout: 10000 }));
  }

  function drainCallbacks(onlyImmediate) {
    // Callbacks may register further callbacks, so loop until empty.
    while (pendingCallbacks.length) {
      const idx = onlyImmediate ? pendingCallbacks.findIndex((c) => c.immediate) : 0;
      if (idx < 0) break;
      const { cb, file, makeEvent } = pendingCallbacks.splice(idx, 1)[0];
      state.currentFile = file;
      sandbox.__cb = cb;
      withRetries(`${file} (event callback)`, () => {
        sandbox.__ev = makeEvent();
        vm.runInContext('__cb(__ev)', ctx, { timeout: 10000 });
      });
    }
  }

  const startup = sortByPriority(walkJs(path.join(kubejsDir, 'startup_scripts')));
  for (const f of startup) {
    runFile(f);
    drainCallbacks(true);
  }
  const server = sortByPriority(walkJs(path.join(kubejsDir, 'server_scripts')));
  for (const f of server) {
    runFile(f);
  }
  drainCallbacks(false);

  return {
    recipes: state.recipes,
    removals: state.removals,
    replacements: state.replacements,
    registry: state.registry,
    errors: state.errors,
    autoGlobals: [...state.autoGlobals],
    files: { startup: startup.length, server: server.length },
    collectStrings,
    holeName: (x) => (isHole(x) ? holeMeta.get(x).name : null),
  };
}
