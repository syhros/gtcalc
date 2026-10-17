import React, { useDeferredValue, useMemo, useState } from 'react';
import { ArrowRight, ArrowRightToLine, ChevronDown, ChevronRight, Factory, Route, Search, Target } from 'lucide-react';
import type { CanvasNode, GeneratorConfig, GeneratorVariant, MachineRecipe, RecipeItem } from '../types';
import { machineStats, nodeInputs } from '../solver';

/** Machine options picked on a recipe card (generators/boilers), applied when it's added. */
export interface SelectOpts { variantId?: string; boostOn?: boolean; rotorId?: string }
export type MakeGen = (recipe: MachineRecipe, opts: SelectOpts) => GeneratorConfig | undefined;
import { itemsMatch, tagMatchesItem, type RecipeDatabase } from '../recipeData';
import { TIER_ORDER } from '../types';
import { compact, formatAmount, formatChance, formatRate, formatEU } from '../format';
import { MachineIcon } from './MachineIcon';
import { ItemIcon } from './ItemIcon';

export type SearchMode = 'input_supplier' | 'output_consumer' | 'change_recipe' | 'standalone' | 'supply';
type Tab = 'items' | 'machines' | 'recipes' | 'supply';

interface Props {
  db: RecipeDatabase;
  mode: SearchMode;
  item: RecipeItem | null; // the port that was clicked
  currentRecipe: MachineRecipe | null; // for change_recipe
  onSelect: (recipe: MachineRecipe, opts?: SelectOpts) => void;
  makeGen?: MakeGen;
  onAddSupply: (item: RecipeItem) => void;
  onAddOutput?: (item: RecipeItem) => void; // an Output node: plan the line backwards from it
  onBestRoute?: (all: boolean) => void;
  openInputCount?: number; // inputs of the node that nothing feeds yet
  onClose: () => void;
}

const MAX_ROWS = 150;

const SOURCE_LABEL: Record<string, { text: string; cls: string; title: string }> = {
  kubejs: { text: 'PACK', cls: 'border-violet-600 text-violet-300', title: "From the modpack's KubeJS scripts" },
  gtceu: { text: 'GT', cls: 'border-sky-600 text-sky-300', title: 'Base GTCEu recipe (from recipe dump)' },
  builtin: { text: 'GT', cls: 'border-sky-800 text-sky-400', title: 'Base GTCEu recipe (built-in, verified against GTCEu 7.5.3 source)' },
};

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

// Search text per recipe, built once (rebuilding it for 34k recipes on every key press was slow).
const hayCache = new WeakMap<MachineRecipe, string>();
function haystack(r: MachineRecipe) {
  let hay = hayCache.get(r);
  if (hay == null) {
    hay = [r.recipeName, r.machineName, r.id, ...r.inputs.map((i) => `${i.name} ${i.id}`), ...r.outputs.map((o) => `${o.name} ${o.id}`)].join(' ').toLowerCase();
    hayCache.set(r, hay);
  }
  return hay;
}
function matchesQuery(r: MachineRecipe, w: string[]) {
  if (!w.length) return true;
  const hay = haystack(r);
  return w.every((x) => hay.includes(x));
}

// ---------------------------------------------------------------- sorting
type SortKey = 'default' | 'fastest' | 'tier' | 'eut' | 'most';
/** Per second of `item` a recipe makes ('made') or uses ('used') at base tier, chance-weighted. */
function itemPerSec(r: MachineRecipe, item: RecipeItem | null, side: 'made' | 'used') {
  if (!item) return 0;
  const list = side === 'made' ? r.outputs : r.inputs;
  const hit = list.find((x) => x.id === item.id) ?? list.find((x) => itemsMatch(x, item));
  return hit ? (hit.amount * (hit.chance ?? 1)) / (r.baseDurationSec || 0.05) : 0;
}
function sortRecipes(list: MachineRecipe[], sort: SortKey, item: RecipeItem | null, side: 'made' | 'used') {
  if (sort === 'default') return list;
  const tierIdx = (r: MachineRecipe) => TIER_ORDER.indexOf(r.baseTier);
  const key: Record<Exclude<SortKey, 'default'>, (r: MachineRecipe) => number> = {
    fastest: (r) => r.baseDurationSec,
    tier: (r) => tierIdx(r) * 1e12 + r.baseEUt,
    eut: (r) => r.baseEUt,
    most: (r) => -itemPerSec(r, item, side),
  };
  const k = key[sort];
  return [...list].sort((a, b) => k(a) - k(b));
}
function SortBar({ sort, onSort, item, side }: { sort: SortKey; onSort: (s: SortKey) => void; item: RecipeItem | null; side: 'made' | 'used' }) {
  const options: [SortKey, string, string][] = [
    ['default', 'Default', 'Exact matches first, as listed'],
    ['fastest', 'Fastest', 'Shortest craft time first'],
    ['tier', 'Lowest tier', 'Lowest base tier first (then lowest EU/t)'],
    ['eut', 'Lowest EU/t', 'Least power per machine first'],
  ];
  if (item) options.push(['most', side === 'made' ? `Most ${item.name}/s` : `Uses most ${item.name}/s`, side === 'made' ? `Most ${item.name} made per second by one machine` : `Most ${item.name} used per second by one machine`]);
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      <span className="text-slate-500 uppercase tracking-wider mr-0.5">Sort</span>
      {options.map(([k, label, tip]) => (
        <button
          key={k}
          onClick={() => onSort(k)}
          data-tip={tip}
          className={`px-1.5 py-0.5 border ${sort === k ? 'bg-cyan-950 border-cyan-500/60 text-cyan-200' : 'border-[#2b3548] text-slate-400 hover:text-slate-200'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A machine you can build: a recipe type, or a specific generator/boiler/turbine for it. */
interface MachineEntry { key: string; name: string; machineId: string; variant?: GeneratorVariant; recipes: MachineRecipe[]; aka: string[] }
const machineEntryCache = new WeakMap<RecipeDatabase, MachineEntry[]>();
function machineEntries(db: RecipeDatabase): MachineEntry[] {
  const cached = machineEntryCache.get(db);
  if (cached) return cached;
  const byType = new Map<string, MachineRecipe[]>();
  for (const r of db.recipes) {
    if (!r.machineId) continue;
    const list = byType.get(r.machineId);
    if (list) list.push(r); else byType.set(r.machineId, [r]);
  }
  const list: MachineEntry[] = [];
  for (const [type, recipes] of byType) {
    const info = db.machines[type];
    const variants = db.generatorVariants[type] ?? [];
    if (!variants.length || variants.some((v) => v.kind === 'single')) {
      list.push({ key: type, name: info?.name ?? type, machineId: type, recipes, aka: info?.runsIn ?? [] });
    }
    for (const v of variants.filter((x) => x.kind !== 'single')) {
      list.push({ key: `${type}|${v.id}`, name: v.name, machineId: type, variant: v, recipes, aka: [info?.name ?? type] });
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  machineEntryCache.set(db, list);
  return list;
}

/** Recipes that make (or use) an item, exact matches first, then tag matches. */
function recipesFor(db: RecipeDatabase, item: RecipeItem, side: 'made' | 'used') {
  const index = side === 'made' ? db.producers : db.consumers;
  const exact = index.get(item.id) ?? [];
  const viaTag = new Set<MachineRecipe>();
  for (const [id, list] of index) {
    if (id === item.id || id.startsWith('#') === !!item.isTag) continue;
    const match = item.isTag ? tagMatchesItem(item.id, id) : tagMatchesItem(id, item.id);
    if (match) for (const r of list) if (!exact.includes(r)) viaTag.add(r);
  }
  return { exact, viaTag: [...viaTag] };
}

export function SearchModal({ db, mode, item, currentRecipe, onSelect, onAddSupply, onAddOutput, onBestRoute, openInputCount = 0, onClose, makeGen }: Props) {
  const browsing = mode === 'standalone' || mode === 'supply';
  const [tab, setTab] = useState<Tab>(mode === 'supply' ? 'supply' : 'items');
  const [query, setQuery] = useState('');
  // Typing stays responsive: the (large) result lists follow a deferred copy of the query.
  const deferredQuery = useDeferredValue(query);
  const [pickedMachine, setPickedMachine] = useState<string | null>(null);
  const [machineFilter, setMachineFilter] = useState('');
  // Changing a recipe opens with the current one selected, so its base numbers are on the right.
  const [previewId, setPreviewId] = useState<string | null>(mode === 'change_recipe' ? currentRecipe?.id ?? null : null);
  // Generator options (machine / boost / rotor) picked in the preview panel.
  const [previewOpts, setPreviewOpts] = useState<SelectOpts>({});
  const [pickedItem, setPickedItem] = useState<RecipeItem | null>(null);
  const [itemSide, setItemSide] = useState<'made' | 'used'>('made');
  const [openNonGT, setOpenNonGT] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const toggleNonGT = (key: string) => setOpenNonGT((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const showRecipeList = !browsing || tab === 'recipes';

  // ---------------------------------------------------------------- recipe-list modes
  const groups = useMemo(() => {
    if (!showRecipeList) return [];
    if (mode === 'input_supplier' && item) {
      const { exact, viaTag } = recipesFor(db, item, 'made');
      return [
        { title: `Recipes making ${item.name}`, items: exact },
        { title: item.isTag ? `Items probably matching ${item.name}` : 'Via a matching tag', items: viaTag },
      ];
    }
    if (mode === 'output_consumer' && item) {
      const { exact, viaTag } = recipesFor(db, item, 'used');
      return [
        { title: `Recipes using ${item.name}`, items: exact },
        { title: 'Recipes accepting it via a tag', items: viaTag },
      ];
    }
    if (mode === 'change_recipe' && currentRecipe) {
      const outs = new Set(currentRecipe.outputs.map((o) => o.id));
      const sameOut = [...new Set(currentRecipe.outputs.flatMap((o) => db.producers.get(o.id) ?? []))].filter((r) => r.id !== currentRecipe.id);
      const sameMachine = db.recipes.filter((r) => r.machineId === currentRecipe.machineId && r.id !== currentRecipe.id && !r.outputs.some((o) => outs.has(o.id)));
      return [
        { title: 'Current recipe', items: db.byId.get(currentRecipe.id) ? [db.byId.get(currentRecipe.id)!] : [currentRecipe] },
        { title: 'Same machine, same output', items: sameOut.filter((r) => r.machineId === currentRecipe.machineId) },
        { title: 'Other machines making the same output', items: sameOut.filter((r) => r.machineId !== currentRecipe.machineId) },
        { title: 'Same machine, other recipes', items: sameMachine },
      ];
    }
    return [{ title: 'All recipes', items: db.recipes }];
  }, [db, mode, item, currentRecipe, showRecipeList]);

  // GregTech recipes first; recipes that only make other mods' items sit in a collapsed section.
  const filtered = useMemo(
    () => groups.map((g) => {
      const w = words(deferredQuery);
      const all = g.items.filter((r) => matchesQuery(r, w));
      const gt = all.filter((r) => !r.nonGT);
      const other = all.filter((r) => r.nonGT);
      return { ...g, total: gt.length, items: sortRecipes(gt, sortBy, item, mode === 'output_consumer' ? 'used' : 'made').slice(0, MAX_ROWS), otherTotal: other.length, other: other.slice(0, MAX_ROWS) };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, deferredQuery, sortBy],
  );

  const machineResults = useMemo(() => {
    if (!browsing || tab !== 'machines') return [];
    const w = words(deferredQuery);
    return machineEntries(db).filter((m) => {
      const hay = `${m.name} ${m.machineId} ${m.aka.join(' ')}`.toLowerCase();
      return w.every((x) => hay.includes(x));
    });
  }, [db, browsing, tab, deferredQuery]);
  const machineEntry = pickedMachine ? machineEntries(db).find((m) => m.key === pickedMachine) ?? null : null;

  // ---------------------------------------------------------------- item browser / supply
  const itemResults = useMemo(() => {
    if (!browsing || tab === 'recipes' || tab === 'machines') return { gt: [], other: [], gtTotal: 0, otherTotal: 0 };
    const q = deferredQuery.trim().toLowerCase();
    const w = words(q);
    const pool = tab === 'items'
      ? db.items.filter((i) => db.producers.has(i.id) || db.consumers.has(i.id))
      : db.items;
    const scored = pool
      .filter((i) => w.every((x) => `${i.name} ${i.id}`.toLowerCase().includes(x)))
      .map((i) => {
        const n = i.name.toLowerCase();
        const score = !q ? 3 : n === q ? 0 : n.startsWith(q) ? 1 : n.split(/\s+/).some((p) => p.startsWith(w[0] ?? '')) ? 2 : 3;
        return { i, score };
      })
      .sort((a, b) => a.score - b.score || a.i.name.length - b.i.name.length || a.i.name.localeCompare(b.i.name))
      .map((x) => x.i);
    // GTNH ore types and the like: one entry per group (its best match), named after the group.
    const seenGroup = new Set<string>();
    const collapsed = scored.flatMap((i) => {
      if (!i.group) return [i];
      if (seenGroup.has(i.group)) return [];
      seenGroup.add(i.group);
      const first = db.groups.get(i.group)?.[0] ?? i;
      return [{ ...first, name: i.group, types: db.groups.get(i.group)?.length ?? 1 } as RecipeItem];
    });
    const gt = collapsed.filter((i) => !db.itemById.get(i.id)?.nonGT);
    const other = collapsed.filter((i) => db.itemById.get(i.id)?.nonGT);
    return { gt: gt.slice(0, MAX_ROWS), other: other.slice(0, MAX_ROWS), gtTotal: gt.length, otherTotal: other.length };
  }, [db, browsing, tab, deferredQuery]);

  const pickedRecipes = useMemo(() => {
    if (!pickedItem) return null;
    const made = recipesFor(db, pickedItem, 'made');
    const used = recipesFor(db, pickedItem, 'used');
    return { made: [...made.exact, ...made.viaTag], used: [...used.exact, ...used.viaTag] };
  }, [db, pickedItem]);

  // ---------------------------------------------------------------- render helpers
  const firstHit = filtered.find((g) => g.items.length)?.items[0] ?? null;
  const preview = (previewId && db.byId.get(previewId)) || (mode === 'change_recipe' ? null : firstHit);
  const title =
    mode === 'change_recipe' ? 'Select new recipe for machine'
      : mode === 'output_consumer' ? `Recipes using ${item?.name ?? 'output'}`
      : mode === 'input_supplier' ? `Recipes making ${item?.name ?? 'input'}`
      : tab === 'supply' ? 'Add an input (raw supply)'
      : 'Add a new node';
  const totalShown = filtered.reduce((s, g) => s + g.total + g.otherTotal, 0);
  const sources = db.meta;
  const placeholder = tab === 'supply' && browsing ? 'Search an item or fluid to supply (e.g. heavy oil, hydrogen)...'
    : tab === 'items' && browsing ? 'Search an item or fluid you want to make (e.g. gasoline, steel ingot)...'
    : tab === 'machines' && browsing ? 'Search a machine (e.g. large titanium boiler, electrolyzer, distillation tower)...'
    : 'Search item, recipe or machine (e.g. gasoline, nitric acid, mixer)...';

  // Phones show one side at a time: the list, or (once something is picked) its details.
  const rightOpen = browsing && tab === 'machines' ? !!machineEntry : browsing && tab === 'items' ? !!pickedItem : !!previewId;
  const closeRight = () => { setPreviewId(null); setPickedItem(null); setPickedMachine(null); };
  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-0 md:p-4" onMouseDown={onClose}>
      <div className="w-[1080px] max-w-full h-full md:h-[86vh] bg-[#161a24] md:border border-[#2b3548] flex flex-col shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="h-10 border-b border-[#283244] px-3 md:px-4 flex items-center justify-between bg-[#141822] flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span className="font-bold text-slate-200 uppercase tracking-wider text-xs break-words min-w-0">{title}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 hover:bg-[#202737] flex items-center justify-center text-slate-400 hover:text-slate-200 flex-shrink-0" aria-label="Close">✕</button>
        </div>

        {browsing && (
          <div className="flex border-b border-[#283244] bg-[#141822] px-3 gap-1 flex-shrink-0 overflow-x-auto whitespace-nowrap">
            {([['items', 'By item'], ['machines', 'By machine'], ['recipes', 'All recipes'], ['supply', 'Inputs (raw supply)']] as const).map(([t, label]) => (
              <button
                key={t}
                onClick={() => { setTab(t); setPreviewId(null); }}
                className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-b-2 -mb-px ${tab === t ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* LEFT (phones: the list, until something is picked; then the right side takes over) */}
          <div className={`${browsing && tab === 'supply' ? 'w-full flex' : `w-full md:w-[46%] md:border-r ${rightOpen ? 'hidden md:flex' : 'flex'}`} border-[#283244] p-3 flex-col gap-2 min-h-0`}>
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPreviewId(null); }}
              placeholder={placeholder}
              autoFocus
              className="w-full bg-[#12151e] border border-[#2b3548] px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-400 outline-none"
            />
            {mode === 'input_supplier' && item && (
              <button
                onClick={() => onAddSupply(item)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-[#13201c] hover:bg-[#183028] border border-emerald-600/50 text-emerald-300 text-xs font-bold text-left"
                data-tip="Add an Input node: something you supply yourself"
              >
                <ArrowRightToLine className="w-4 h-4" /> Supply {item.name} myself (add as Input)
              </button>
            )}
            {mode === 'output_consumer' && item && onAddOutput && (
              <button
                onClick={() => onAddOutput(item)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-[#122634] hover:bg-[#16324a] border border-cyan-500/50 text-cyan-200 text-xs font-bold text-left"
                data-tip="Add an Output node: the end of the line"
              >
                <Target className="w-4 h-4" /> End the line here (add as Output)
              </button>
            )}
            {mode === 'input_supplier' && item && onBestRoute && (
              <div className="flex gap-1.5">
                <button
                  onClick={() => onBestRoute(false)}
                  className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-[#211a2e] hover:bg-[#2d2340] border border-violet-500/50 text-violet-200 text-xs font-bold text-left"
                  data-tip={'Experimental. Adds the cheapest chain of machines down to raw resources (ores, logs, water, gas collectors), balancing EU/t and machine count, then runs Auto Ratio and Auto Sort.\nStays at or below your max tier.'}
                >
                  <Route className="w-4 h-4 flex-shrink-0" /> Add best route
                </button>
                {openInputCount > 1 && (
                  <button
                    onClick={() => onBestRoute(true)}
                    className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-[#211a2e] hover:bg-[#2d2340] border border-violet-500/50 text-violet-200 text-xs font-bold text-left"
                    data-tip={`Experimental. Plans a route for every input of this machine that nothing feeds yet (${openInputCount}), sharing machines where they make the same thing.`}
                  >
                    <Route className="w-4 h-4 flex-shrink-0" /> Best route for all inputs ({openInputCount})
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
              {browsing && tab === 'machines' ? (
                <div>
                  <GroupHeader title="Machines" shown={machineResults.length} total={machineResults.length} />
                  <div className="grid grid-cols-2 gap-1">
                    {machineResults.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => { setPickedMachine(m.key); setMachineFilter(''); }}
                        className={`flex items-center gap-2 p-1.5 border text-left min-w-0 ${pickedMachine === m.key ? 'bg-[#1a2333] border-cyan-400' : 'bg-[#12151e] border-[#222a3b] hover:border-[#333e54]'}`}
                        data-tip={m.aka.length ? `Also: ${m.aka.join(', ')}` : m.machineId}
                      >
                        <MachineIcon recipe={m.recipes[0]} tier={m.recipes[0].baseTier} machines={db.machines} tierCasings={db.tierCasings} variant={m.variant} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-200 font-bold break-words min-w-0">{m.name}</div>
                          <div className="text-[10px] text-slate-500 break-words min-w-0">{m.recipes.length.toLocaleString()} recipe{m.recipes.length === 1 ? '' : 's'}{m.variant ? ' · multiblock' : ''}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  {machineResults.length === 0 && <div className="text-slate-500 text-xs italic p-2">No machine matches.</div>}
                </div>
              ) : browsing && tab !== 'recipes' ? (
                <>
                  <ItemList
                    items={itemResults.gt}
                    total={itemResults.gtTotal}
                    data-tip={tab === 'supply' ? 'GregTech items & fluids' : 'Items & fluids'}
                    picked={tab === 'items' ? pickedItem?.id : undefined}
                    db={db}
                    onPick={(i) => { const real = db.itemById.get(i.id) ?? i; if (tab === 'supply') onAddSupply(real); else setPickedItem(real); }}
                    columns={tab === 'supply' ? 3 : 2}
                  />
                  {itemResults.otherTotal > 0 && (
                    <Accordion title={`Other mods' items (${itemResults.otherTotal})`} open={openNonGT.has(`items-${tab}`)} onToggle={() => toggleNonGT(`items-${tab}`)}>
                      <ItemList items={itemResults.other} total={itemResults.otherTotal} picked={pickedItem?.id} db={db} onPick={(i) => { const real = db.itemById.get(i.id) ?? i; if (tab === 'supply') onAddSupply(real); else setPickedItem(real); }} columns={tab === 'supply' ? 3 : 2} />
                    </Accordion>
                  )}
                  {itemResults.gtTotal + itemResults.otherTotal === 0 && <div className="text-slate-500 text-xs italic p-2">Nothing matches.</div>}
                </>
              ) : (
                <>
                  <SortBar sort={sortBy} onSort={setSortBy} item={item} side={mode === 'output_consumer' ? 'used' : 'made'} />
                  {filtered.map((group) => (group.total > 0 || group.otherTotal > 0) && (
                    <div key={group.title}>
                      <GroupHeader title={group.title} shown={group.items.length} total={group.total} />
                      <div className="space-y-1">
                        {group.items.map((recipe) => (
                          <RecipeCard key={recipe.id} recipe={recipe} db={db} selected={preview?.id === recipe.id} actionLabel={mode === 'change_recipe' ? 'Select' : '+ Add'} onClick={() => { if (preview?.id !== recipe.id) setPreviewOpts({}); setPreviewId(recipe.id); }} onAction={(o) => onSelect(recipe, o)} highlight={item?.id} makeGen={makeGen} large={mode === 'input_supplier' || mode === 'output_consumer'} showOptions={false} sharedOpts={preview?.id === recipe.id ? previewOpts : undefined} />
                        ))}
                      </div>
                      {group.otherTotal > 0 && (
                        <Accordion title={`Non-GregTech items (${group.otherTotal})`} open={openNonGT.has(group.title)} onToggle={() => toggleNonGT(group.title)}>
                          <div className="space-y-1">
                            {group.other.map((recipe) => (
                              <RecipeCard key={recipe.id} recipe={recipe} db={db} selected={preview?.id === recipe.id} actionLabel={mode === 'change_recipe' ? 'Select' : '+ Add'} onClick={() => { if (preview?.id !== recipe.id) setPreviewOpts({}); setPreviewId(recipe.id); }} onAction={(o) => onSelect(recipe, o)} highlight={item?.id} makeGen={makeGen} large={mode === 'input_supplier' || mode === 'output_consumer'} showOptions={false} sharedOpts={preview?.id === recipe.id ? previewOpts : undefined} />
                            ))}
                            {group.otherTotal > MAX_ROWS && <div className="text-[10px] text-slate-500">first {MAX_ROWS} of {group.otherTotal} — refine the search</div>}
                          </div>
                        </Accordion>
                      )}
                    </div>
                  ))}
                  {totalShown === 0 && (
                    <div className="text-slate-500 text-xs italic p-2">
                      No recipes found.{mode === 'input_supplier' ? ' You can supply it as an Input instead.' : ''}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="text-[10px] text-slate-500 border-t border-[#242d3d] pt-1.5">
              {db.meta.gtceuVersion?.startsWith('GT5') ? `${db.recipes.length.toLocaleString()} recipes from ${db.meta.gtceuVersion}.`
                : sources.export ? `${db.recipes.length.toLocaleString()} recipes exported from the pack in game: every recipe that feeds a GregTech line (${sources.export.read.toLocaleString()} read).` : <>
                {db.recipes.length.toLocaleString()} recipes: {sources.kubejs.toLocaleString()} from pack scripts
                {sources.gtceu ? `, ${sources.gtceu.toLocaleString()} base GTCEu` : ''}
                {sources.builtin ? `, ${sources.builtin} built-in GTCEu` : ''}.
                {!sources.hasDump && ' Base GTCEu recipes: enable dumpRecipes (see README).'}
              </>}
            </div>
          </div>

          {/* RIGHT */}
          {!(browsing && tab === 'supply') && (
            <div className={`w-full md:w-[54%] bg-[#12151e] flex-col min-h-0 ${rightOpen ? 'flex' : 'hidden md:flex'}`}>
              {rightOpen && (
                <button onClick={closeRight} className="md:hidden flex items-center gap-1 px-3 py-2 border-b border-[#283244] text-cyan-300 text-xs font-bold text-left flex-shrink-0">
                  ← Back to the list
                </button>
              )}
              {browsing && tab === 'machines' ? (
                machineEntry ? (
                  <MachineRecipes key={machineEntry.key} entry={machineEntry} filter={machineFilter} onFilter={setMachineFilter} db={db} onSelect={onSelect} makeGen={makeGen} />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500 text-xs p-6 text-center">
                    Pick a machine on the left to see everything it can run.
                  </div>
                )
              ) : browsing && tab === 'items' ? (
                pickedItem && pickedRecipes ? (
                  <ItemRecipes
                    item={pickedItem}
                    side={itemSide}
                    onSide={setItemSide}
                    recipes={pickedRecipes}
                    db={db}
                    onSelect={onSelect}
                    makeGen={makeGen}
                    onAddSupply={onAddSupply}
                    onAddOutput={onAddOutput}
                    openNonGT={openNonGT.has('picked')}
                    toggleNonGT={() => toggleNonGT('picked')}
                    onVariant={setPickedItem}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500 text-xs p-6 text-center">
                    Pick an item on the left to see every recipe that makes it (or uses it).
                  </div>
                )
              ) : (
                <div className="p-4 flex flex-col justify-between overflow-y-auto h-full">
                  {preview ? <RecipePreview recipe={preview} db={db} makeGen={makeGen} opts={previewOpts} setOpts={setPreviewOpts} /> : (
                    <div className="flex items-center justify-center h-full text-slate-500 text-xs">Select a recipe to preview it</div>
                  )}
                  {preview && (
                    <button
                      onClick={() => onSelect(preview, previewOpts)}
                      className="w-full mt-3 py-2 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-300 font-bold text-xs tracking-wider transition uppercase flex-shrink-0"
                    >
                      {mode === 'change_recipe' ? 'Set recipe on machine' : '+ Add machine to map'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function GroupHeader({ title, shown, total }: { title: string; shown: number; total: number }) {
  return (
    <div className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider border-b border-[#242d3d] pb-1 mb-1.5 flex justify-between">
      <span>{title}</span>
      <span className="text-slate-500">{total > shown ? `first ${shown} of ${total}` : total}</span>
    </div>
  );
}

function Accordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-2 border border-[#242d3d]">
      <button onClick={onToggle} className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase font-bold tracking-wider text-slate-400 hover:text-slate-200 bg-[#141822]">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {title}
      </button>
      {open && <div className="p-1.5">{children}</div>}
    </div>
  );
}

/** An item in a recipe: input chips are red, output chips are green. */
function Chip({ item, side, highlight, size = 14 }: { item: RecipeItem; side: 'in' | 'out'; highlight?: boolean; size?: number }) {
  const rounded = Math.round(item.amount * 1000) / 1000;
  const amount = item.unit === 'mB' ? `${compact(rounded)}mB` : `${rounded}x`;
  const big = size > 20;
  return (
    <span
      className={`flex items-center gap-1.5 px-1 border w-full min-w-0 ${big ? 'py-0.5 text-[11px]' : 'py-px text-[10px]'} ${
        side === 'in' ? 'border-rose-800/70 bg-rose-950/30' : 'border-emerald-800/70 bg-emerald-950/30'
      } ${highlight ? 'ring-1 ring-cyan-400' : ''} ${item.consumed === false ? 'opacity-60' : ''}`}
      data-tip={`${item.name} — ${formatAmount(rounded, item.unit)}${item.chance != null ? ` (${formatChance(item.chance)})` : ''}${item.consumed === false ? ' (not consumed)' : ''}`}
    >
      <ItemIcon id={item.id} color={item.iconColor} size={size} />
      <span className={`min-w-0 ${big ? 'flex flex-col leading-tight' : 'flex items-center gap-1'}`}>
        <span className={`font-bold flex-shrink-0 ${side === 'in' ? 'text-rose-300' : 'text-emerald-300'}`}>{amount}{big && item.chance != null ? ` · ${formatChance(item.chance)}` : ''}</span>
        <span className={`text-slate-200 ${big ? 'break-words' : 'break-words min-w-0'}`}>{item.name}</span>
      </span>
      {!big && item.chance != null && <span className="text-amber-300 font-bold flex-shrink-0" data-tip="Chance per craft">{formatChance(item.chance)}</span>}
    </span>
  );
}

/**
 * One recipe item as a full row: icon and name on the left, amount per craft and the rate for
 * one machine on the right. Every row is two lines tall so inputs and outputs line up.
 */
function RateRow({ item: i, side, seconds, highlight }: { item: RecipeItem; side: 'in' | 'out'; seconds: number; highlight?: boolean }) {
  const perSec = i.consumed === false ? 0 : (i.amount * (i.chance ?? 1)) / (seconds || 0.05);
  return (
    <div className={`flex items-center justify-between gap-2 px-2 py-1 min-h-[38px] border text-xs ${side === 'in' ? 'border-rose-900/70 bg-rose-950/20' : 'border-emerald-900/70 bg-emerald-950/20'} ${highlight ? 'ring-1 ring-cyan-400' : ''}`}>
      <span className="flex items-center gap-1.5 min-w-0">
        <ItemIcon id={i.id} color={i.iconColor} size={20} />
        <span className="text-slate-200 break-words leading-tight min-w-0" data-tip={i.id}>{i.name}</span>
        {i.chance != null && <span className="text-[10px] text-slate-500">{formatChance(i.chance)}</span>}
        {i.consumed === false && <span className="text-[10px] text-slate-500" data-tip="Not consumed">NC</span>}
      </span>
      <span className="text-right whitespace-nowrap">
        <span className={`font-bold ${side === 'out' ? 'text-emerald-400' : 'text-rose-400'}`}>{side === 'out' ? '+' : '-'}{formatAmount(Math.round(i.amount * 1000) / 1000, i.unit)}</span>
        <span className="block text-[9px] text-slate-500">{formatRate(perSec, i.unit)}</span>
      </span>
    </div>
  );
}

function RecipeCard({ recipe, db, selected, actionLabel, onClick, onAction, highlight, large, makeGen, initialVariant, showOptions = true, sharedOpts }: {
  initialVariant?: string;
  showOptions?: boolean; // false where the preview panel shows the machine options instead
  sharedOpts?: SelectOpts; // options picked in the preview panel (when this card is previewed)
  recipe: MachineRecipe;
  db: RecipeDatabase;
  selected?: boolean;
  actionLabel: string;
  onClick?: () => void;
  onAction: (opts?: SelectOpts) => void;
  highlight?: string;
  large?: boolean; // taller rows with big item images (item / machine panels)
  makeGen?: MakeGen;
}) {
  const src = SOURCE_LABEL[recipe.source ?? 'builtin'];
  const variants = recipe.machineId && (recipe.generatesEU || recipe.boiler) ? db.generatorVariants[recipe.machineId] ?? [] : [];
  const [ownOpts, setOpts] = useState<SelectOpts>(() => (initialVariant ? { variantId: initialVariant } : {}));
  const opts = sharedOpts ?? ownOpts;
  // Generators and boilers: show the chosen machine's real numbers (parallels, boost, rotor).
  const gen = variants.length && makeGen ? makeGen(recipe, opts) : undefined;
  const preview: CanvasNode | null = gen ? { instanceId: 'preview', recipe, selectedTier: recipe.baseTier, count: 1, x: 0, y: 0, gen } : null;
  const stats = preview ? machineStats(preview) : null;
  const scaled = (i: RecipeItem): RecipeItem => (stats ? { ...i, amount: i.amount * (i.fixed ? 1 : stats.parallel) } : i);
  const inputs = preview && stats ? nodeInputs(preview, stats).map(scaled) : recipe.inputs;
  const outputs = recipe.outputs.map(scaled);
  const eut = stats ? stats.eutPerMachine : recipe.baseEUt;
  const seconds = stats ? stats.durationSec : recipe.baseDurationSec;
  const chipSize = large ? 28 : 14;
  return (
    <div
      onClick={onClick}
      onDoubleClick={() => onAction(opts)}
      className={`${large ? 'p-2' : 'p-1.5'} border transition-colors ${onClick ? 'cursor-pointer' : ''} ${selected ? 'bg-[#1a2333] border-cyan-400' : 'bg-[#12151e] border-[#222a3b] hover:border-[#333e54]'}`}
    >
      <div className="flex items-center gap-2">
        <MachineIcon recipe={recipe} tier={recipe.baseTier} machines={db.machines} tierCasings={db.tierCasings} variant={gen ? variants.find((v) => v.id === gen.variantId) : undefined} size={large ? 28 : 22} />
        <div className="min-w-0 flex-1 flex items-baseline gap-1.5 flex-wrap">
          <span className="font-bold text-slate-200 text-xs">{gen && gen.kind !== 'single' ? gen.name : recipe.machineName}</span>
          <span className="text-[10px] text-slate-400 whitespace-nowrap">
            {recipe.baseTier} · {recipe.generatesEU ? '+' : ''}{eut ? `${formatEU(eut)}` : 'no EU'} · {Math.round(seconds * 100) / 100}s
            {recipe.circuit != null ? ` · ⚙${recipe.circuit}` : ''}
          </span>
        </div>
        {src && <span className={`px-2 py-0.5 border text-xs font-bold whitespace-nowrap ${src.cls}`} data-tip={src.title}>{src.text}</span>}
        <button
          onClick={(e) => { e.stopPropagation(); onAction(opts); }}
          className="px-2 py-0.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-300 font-bold text-xs whitespace-nowrap"
        >
          {actionLabel}
        </button>
      </div>
      {gen && showOptions && (
        <div className="mt-1.5">
          <GenOptions db={db} variants={variants} gen={gen} opts={opts} setOpts={setOpts} stats={stats} generatesEU={!!recipe.generatesEU} />
        </div>
      )}
      {/* Inputs stacked on the left, outputs on the right (same layout as the preview) */}
      <div className={`${large ? 'mt-1.5' : 'mt-1'} grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1.5 items-center`}>
        <div className="flex flex-col gap-0.5 min-w-0">
          {inputs.length ? inputs.map((i, k) => (large
            ? <RateRow key={`i${k}`} item={i} side="in" seconds={seconds} highlight={i.id === highlight} />
            : <Chip key={`i${k}`} item={i} side="in" highlight={i.id === highlight} size={chipSize} />)) : <span className="text-[10px] text-slate-600">no inputs</span>}
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-slate-500 rotate-90 sm:rotate-0 justify-self-center" />
        <div className="flex flex-col gap-0.5 min-w-0">
          {recipe.generatesEU && <span className={`inline-flex items-center px-1 border border-amber-700/70 bg-amber-950/30 text-[10px] text-amber-300 font-bold ${large ? 'py-1.5' : 'py-px'}`}>+{formatEU(eut)}</span>}
          {outputs.map((o, k) => (large
            ? <RateRow key={`o${k}`} item={o} side="out" seconds={seconds} highlight={o.id === highlight} />
            : <Chip key={`o${k}`} item={o} side="out" highlight={o.id === highlight} size={chipSize} />))}
          {!outputs.length && !recipe.generatesEU && <span className="text-[10px] text-slate-600">no outputs</span>}
        </div>
      </div>
    </div>
  );
}

function ItemList({ items, total, title, picked, db, onPick, columns }: {
  items: RecipeItem[];
  total: number;
  title?: string;
  picked?: string;
  db: RecipeDatabase;
  onPick: (i: RecipeItem) => void;
  columns: 2 | 3;
}) {
  return (
    <div>
      {title && <GroupHeader title={title} shown={items.length} total={total} />}
      <div className={`grid gap-1 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {items.map((i) => {
          const made = db.producers.get(i.id)?.length ?? 0;
          const used = db.consumers.get(i.id)?.length ?? 0;
          return (
            <button
              key={i.id}
              onClick={() => onPick(i)}
              className={`w-full flex items-center gap-2 p-1.5 border text-left text-xs min-w-0 ${picked === i.id ? 'bg-[#1a2333] border-cyan-400' : 'bg-[#12151e] border-[#222a3b] hover:border-[#333e54]'}`}
              data-tip={i.id}
            >
              <ItemIcon id={i.id} color={i.iconColor} size={32} />
              <div className="min-w-0 flex-1">
                <div className="break-words min-w-0 text-slate-200 font-bold">{i.name}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wide">{i.unit === 'mB' ? 'fluid' : i.isTag ? 'tag (any)' : 'item'}{(i as RecipeItem & { types?: number }).types ? <span className="text-fuchsia-300"> · {(i as RecipeItem & { types?: number }).types} types</span> : null}</div>
                {(made > 0 || used > 0) && (
                  <div className="text-[9px] text-slate-500" data-tip={`An output of ${made} recipe${made === 1 ? '' : 's'}, an input to ${used}`}>
                    {made ? <span className="text-emerald-400/80">{made} output</span> : null}{made && used ? ' · ' : ''}{used ? <span className="text-rose-400/80">{used} input</span> : null}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ItemRecipes({ item, side, onSide, recipes, db, onSelect, onAddSupply, onAddOutput, openNonGT, toggleNonGT, makeGen, onVariant }: {
  item: RecipeItem;
  onVariant?: (i: RecipeItem) => void;
  side: 'made' | 'used';
  onSide: (s: 'made' | 'used') => void;
  recipes: { made: MachineRecipe[]; used: MachineRecipe[] };
  db: RecipeDatabase;
  onSelect: (r: MachineRecipe, opts?: SelectOpts) => void;
  makeGen?: MakeGen;
  onAddSupply: (i: RecipeItem) => void;
  onAddOutput?: (i: RecipeItem) => void;
  openNonGT: boolean;
  toggleNonGT: () => void;
}) {
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const list = recipes[side];
  const gt = sortRecipes(list.filter((r) => !r.nonGT), sortBy, item, side).slice(0, MAX_ROWS);
  const other = sortRecipes(list.filter((r) => r.nonGT), sortBy, item, side);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-[#242d3d] flex items-center gap-2">
        <ItemIcon id={item.id} color={item.iconColor} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-slate-100 font-bold text-sm break-words min-w-0">{item.group ?? item.name}</div>
          {item.group && onVariant ? (
            <select value={item.id} onChange={(e) => { const v = db.groups.get(item.group!)?.find((x) => x.id === e.target.value); if (v) onVariant(v); }} className="mt-0.5 max-w-full bg-[#12151e] border border-fuchsia-500/50 text-fuchsia-200 text-[11px] px-1 py-0.5" data-tip="Which type: each has its own recipes">
              {(db.groups.get(item.group) ?? []).map((v) => <option key={v.id} value={v.id}>{v.variant}</option>)}
            </select>
          ) : <div className="text-[10px] text-slate-500 break-words min-w-0">{item.id}</div>}
        </div>
        <button onClick={() => onAddSupply(item)} className="px-2 py-1 bg-[#13201c] hover:bg-[#183028] border border-emerald-600/50 text-emerald-300 text-[11px] font-bold flex items-center gap-1" data-tip="Add as an Input you supply yourself">
          <ArrowRightToLine className="w-3.5 h-3.5" /> Input
        </button>
        {onAddOutput && (
          <button onClick={() => onAddOutput(item)} className="px-2 py-1 bg-[#122634] hover:bg-[#16324a] border border-cyan-500/50 text-cyan-200 text-[11px] font-bold flex items-center gap-1" data-tip={'Add as an Output: the thing you want to make.\nUse Best Route on it to plan the line backwards.'}>
            <Target className="w-3.5 h-3.5" /> Output
          </button>
        )}
      </div>
      <div className="flex px-3 gap-1 border-b border-[#242d3d]">
        {(['made', 'used'] as const).map((s) => (
          <button
            key={s}
            onClick={() => onSide(s)}
            className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-b-2 -mb-px ${side === s ? (s === 'made' ? 'border-emerald-400 text-emerald-300' : 'border-rose-400 text-rose-300') : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {s === 'made' ? `Made by (${recipes.made.length})` : `Used in (${recipes.used.length})`}
          </button>
        ))}
      </div>
      <div className="px-3 pt-2"><SortBar sort={sortBy} onSort={setSortBy} item={item} side={side} /></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">
        {gt.map((r) => <RecipeCard key={r.id} recipe={r} db={db} actionLabel="+ Add" onAction={(o) => onSelect(r, o)} highlight={item.id} large makeGen={makeGen} />)}
        {other.length > 0 && (
          <Accordion title={`Non-GregTech items (${other.length})`} open={openNonGT} onToggle={toggleNonGT}>
            <div className="space-y-1">
              {other.slice(0, MAX_ROWS).map((r) => <RecipeCard key={r.id} recipe={r} db={db} actionLabel="+ Add" onAction={(o) => onSelect(r, o)} highlight={item.id} large makeGen={makeGen} />)}
            </div>
          </Accordion>
        )}
        {list.length === 0 && (
          <div className="text-slate-500 text-xs italic">
            {side === 'made' ? 'No recipe makes this — add it as an Input instead.' : 'Nothing uses this.'}
          </div>
        )}
      </div>
    </div>
  );
}

/** A machine with no recipe yet: placed empty, its recipe button lists this machine's recipes. */
function blankRecipe(entry: MachineEntry): MachineRecipe {
  const first = entry.recipes[0];
  const lowest = entry.recipes.reduce((a, r) => (TIER_ORDER.indexOf(r.baseTier) < TIER_ORDER.indexOf(a) ? r.baseTier : a), first.baseTier);
  return {
    id: `blank:${first.machineId ?? entry.key}`,
    machineId: first.machineId,
    machineName: first.machineName,
    recipeName: 'No recipe yet',
    baseTier: lowest,
    baseEUt: 0,
    baseDurationSec: 1,
    inputs: [],
    outputs: [],
    ...(first.multiblock ? { multiblock: true } : {}),
    source: 'user',
  };
}

function MachineRecipes({ entry, filter, onFilter, db, onSelect, makeGen }: {
  entry: MachineEntry;
  filter: string;
  onFilter: (s: string) => void;
  db: RecipeDatabase;
  onSelect: (r: MachineRecipe, opts?: SelectOpts) => void;
  makeGen?: MakeGen;
}) {
  const deferred = useDeferredValue(filter);
  const list = useMemo(() => {
    const w = words(deferred);
    return entry.recipes.filter((r) => matchesQuery(r, w));
  }, [entry, deferred]);
  const gt = list.filter((r) => !r.nonGT);
  const other = list.filter((r) => r.nonGT);
  const [openOther, setOpenOther] = useState(false);
  const pick = (r: MachineRecipe, o?: SelectOpts) => onSelect(r, { ...o, ...(entry.variant ? { variantId: entry.variant.id } : {}) });
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-[#242d3d] flex items-center gap-2">
        <MachineIcon recipe={entry.recipes[0]} tier={entry.recipes[0].baseTier} machines={db.machines} tierCasings={db.tierCasings} variant={entry.variant} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-slate-100 font-bold text-sm break-words min-w-0 flex items-center gap-1.5"><Factory className="w-3.5 h-3.5 text-cyan-400" />{entry.name}</div>
          <div className="text-[10px] text-slate-500 break-words min-w-0">
            {entry.variant?.kind === 'boiler' ? `${compact(entry.variant.steamPerTick ?? 0)} steam/t at full heat · ` : ''}
            {entry.recipes.length.toLocaleString()} recipes{entry.aka.length ? ` · also ${entry.aka.join(', ')}` : ''}
          </div>
        </div>
        {!entry.recipes[0].generatesEU && !entry.recipes[0].boiler && (
          <button
            onClick={() => pick(blankRecipe(entry))}
            className="px-2 py-1 border border-slate-500/60 text-slate-200 hover:bg-[#202737] text-[11px] font-bold whitespace-nowrap"
            data-tip="Place this machine without a recipe; pick one later with its recipe button"
          >
            + Add blank
          </button>
        )}
      </div>
      <div className="p-2 border-b border-[#242d3d]">
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder={entry.variant?.kind === 'boiler' ? 'Filter fuels (e.g. coal, creosote)...' : 'Filter recipes (e.g. naphtha)...'}
          className="w-full bg-[#12151e] border border-[#2b3548] px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-400 outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">
        {gt.slice(0, MAX_ROWS).map((r) => <RecipeCard key={r.id} recipe={r} db={db} actionLabel="+ Add" onAction={(o) => pick(r, o)} large makeGen={makeGen} initialVariant={entry.variant?.id} />)}
        {gt.length > MAX_ROWS && <div className="text-[10px] text-slate-500">first {MAX_ROWS} of {gt.length} — use the filter</div>}
        {other.length > 0 && (
          <Accordion title={`Non-GregTech items (${other.length})`} open={openOther} onToggle={() => setOpenOther((v) => !v)}>
            <div className="space-y-1">
              {other.slice(0, MAX_ROWS).map((r) => <RecipeCard key={r.id} recipe={r} db={db} actionLabel="+ Add" onAction={(o) => pick(r, o)} large makeGen={makeGen} initialVariant={entry.variant?.id} />)}
            </div>
          </Accordion>
        )}
        {list.length === 0 && <div className="text-slate-500 text-xs italic">Nothing matches.</div>}
      </div>
    </div>
  );
}

function RecipePreview({ recipe, db, makeGen, opts, setOpts }: {
  recipe: MachineRecipe;
  db: RecipeDatabase;
  makeGen?: MakeGen;
  opts: SelectOpts;
  setOpts: (o: SelectOpts) => void;
}) {
  // Generators / boilers: numbers follow the machine, boost and rotor picked below the header.
  const variants = recipe.machineId && (recipe.generatesEU || recipe.boiler) ? db.generatorVariants[recipe.machineId] ?? [] : [];
  const gen = variants.length && makeGen ? makeGen(recipe, opts) : undefined;
  const node: CanvasNode | null = gen ? { instanceId: 'preview', recipe, selectedTier: recipe.baseTier, count: 1, x: 0, y: 0, gen } : null;
  const stats = node ? machineStats(node) : null;
  const scale = (i: RecipeItem): RecipeItem => (stats ? { ...i, amount: i.amount * (i.fixed ? 1 : stats.parallel) } : i);
  const inputs = node && stats ? nodeInputs(node, stats).map(scale) : recipe.inputs;
  const outputs = recipe.outputs.map(scale);
  const seconds = stats ? stats.durationSec : recipe.baseDurationSec;
  const ticks = stats ? stats.durationTicks : recipe.durationTicks ?? Math.round(recipe.baseDurationSec * 20);
  const eut = stats ? stats.eutPerMachine : recipe.baseEUt;
  const row = (i: RecipeItem, side: 'in' | 'out', k: number) => <RateRow key={`${i.id}-${k}`} item={i} side={side} seconds={seconds} highlight={false} />;
  const info = recipe.machineId ? db.machines[recipe.machineId] : undefined;
  const variant = gen ? variants.find((v) => v.id === gen.variantId) : undefined;
  return (
    <div className="space-y-3">
      <div className="border-b border-[#283244] pb-2 flex items-center gap-3">
        <MachineIcon recipe={recipe} tier={recipe.baseTier} machines={db.machines} tierCasings={db.tierCasings} variant={variant} size={40} />
        <div className="min-w-0">
          <div className="text-cyan-400 font-bold text-sm">{gen && gen.kind !== 'single' ? gen.name : recipe.machineName}</div>
          <div className="text-slate-200 text-base font-bold break-words min-w-0">{recipe.recipeName}</div>
          <div className="text-[10px] text-slate-500 break-words min-w-0" data-tip={recipe.id}>{recipe.id}</div>
        </div>
      </div>
      {gen && <GenOptions db={db} variants={variants} gen={gen} opts={opts} setOpts={setOpts} stats={stats} generatesEU={!!recipe.generatesEU} stacked />}
      <div className="grid grid-cols-2 gap-2 text-xs bg-[#161a24] p-2.5 border border-[#252c3d]">
        <div><span className="text-slate-400">Base tier: </span><span className="text-amber-300 font-bold">{recipe.baseTier}</span></div>
        <div><span className="text-slate-400">Duration: </span><span className="text-slate-200 font-bold">{Math.round(seconds * 100) / 100}s ({ticks}t)</span></div>
        <div><span className="text-slate-400">{recipe.generatesEU ? 'Generates' : 'Base'} EU/t: </span><span className="text-amber-400 font-bold">{compact(eut)}</span></div>
        <div><span className="text-slate-400">Total EU: </span><span className="text-slate-200 font-bold">{compact(eut * ticks)}</span></div>
        {recipe.circuit != null && <div><span className="text-slate-400">Circuit: </span><span className="text-slate-200 font-bold">{recipe.circuit}</span></div>}
        {recipe.startEU != null && <div><span className="text-slate-400">Start EU: </span><span className="text-slate-200 font-bold">{compact(recipe.startEU)}</span></div>}
        {recipe.conditions?.map((c) => <div key={c} className="col-span-2 text-slate-400">{c}</div>)}
        {info?.runsIn && <div className="col-span-2 text-slate-400">Also runs in: <span className="text-slate-300">{info.runsIn.join(', ')}</span></div>}
      </div>
      <div className="text-[10px] text-slate-500">Amounts are per craft; small figures are per second for one machine{gen ? '' : ' at the base tier'}.</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] uppercase font-bold text-rose-400 tracking-wider mb-1 flex items-center justify-between">
            <span>Inputs</span><span className="text-slate-500">{inputs.length}</span>
          </div>
          <div className="space-y-1">{inputs.length ? inputs.map((i, k) => row(i, 'in', k)) : <div className="text-[11px] text-slate-600 italic">none</div>}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase font-bold text-emerald-400 tracking-wider mb-1 flex items-center justify-between">
            <span>Outputs</span><span className="text-slate-500">{outputs.length + (recipe.generatesEU ? 1 : 0)}</span>
          </div>
          <div className="space-y-1">
            {recipe.generatesEU && (
              <div className="flex items-center justify-between px-2 py-1 min-h-[38px] border border-amber-800/70 bg-amber-950/20 text-xs">
                <span className="text-amber-300">Energy</span>
                <span className="text-right whitespace-nowrap">
                  <span className="text-amber-300 font-bold">+{formatEU(eut)}</span>
                  <span className="block text-[9px] text-slate-500">+{compact(eut * 20)} EU/s</span>
                </span>
              </div>
            )}
            {outputs.map((o, k) => row(o, 'out', k))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Machine / boost / rotor pickers for a generator or boiler recipe. */
function GenOptions({ db, variants, gen, opts, setOpts, stats, generatesEU, stacked }: {
  db: RecipeDatabase;
  variants: GeneratorVariant[];
  gen: GeneratorConfig;
  opts: SelectOpts;
  setOpts: (o: SelectOpts) => void;
  stats: ReturnType<typeof machineStats> | null;
  generatesEU: boolean;
  stacked?: boolean; // one control per row (preview panel)
}) {
  return (
    <div className={`${stacked ? 'flex flex-col items-start gap-1.5' : 'flex items-center gap-1.5 flex-wrap'} text-[11px]`} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {variants.length > 1 && (
        <select
          value={gen.variantId}
          onChange={(e) => setOpts({ ...opts, variantId: e.target.value })}
          className="bg-[#171d2b] border border-[#2c374c] text-slate-200 px-1 py-0.5 text-[11px] max-w-full"
          data-tip="Machine burning this fuel"
        >
          {variants.map((v) => <option key={v.id} value={v.id}>{v.kind === 'single' ? `${v.name} (LV-${v.maxTier})` : v.kind === 'boiler' ? `${v.name} (${compact(v.steamPerTick ?? 0)} steam/t)` : `${v.name} (${v.tier})`}</option>)}
        </select>
      )}
      {gen.kind === 'engine' && gen.boost && (
        <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
          <input type="checkbox" checked={!!opts.boostOn} onChange={(e) => setOpts({ ...opts, boostOn: e.target.checked })} className="accent-amber-400" />
          {gen.extras?.find((x) => x.boostOnly)?.name ?? 'Oxygen'} boost
        </label>
      )}
      {gen.kind === 'turbine' && (
        <select
          value={gen.rotor?.id}
          onChange={(e) => setOpts({ ...opts, rotorId: e.target.value })}
          className="bg-[#171d2b] border border-[#2c374c] text-slate-200 px-1 py-0.5 text-[11px] max-w-full"
          data-tip="Turbine rotor"
        >
          {db.rotors.map((r) => <option key={r.id} value={r.id}>{r.name} rotor — {r.power}% pwr / {r.efficiency}% eff</option>)}
        </select>
      )}
      {stats && generatesEU && (
        <span className={`${stacked ? '' : 'ml-auto '}px-1.5 py-0.5 border border-amber-600/60 bg-amber-950/40 text-amber-300 font-bold`} data-tip="Total EU/t from one of this machine">
          +{formatEU(stats.eutPerMachine)}{stats.parallel > 1 ? ` (${stats.parallel}x)` : ''}
        </span>
      )}
    </div>
  );
}
