import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckSquare, ChevronDown, ChevronRight, ChevronUp, Minus, Plus, Tag, SquareDashed, Trash2, Download, Factory, FileJson, Image as ImageIcon, LayoutGrid, Link2, Loader2, Magnet, Menu, Redo2, Save, Scale, Square, Undo2, Unlink, Upload, Users, X, Share2, ChevronLeft, FolderOpen, Lock, LockOpen } from 'lucide-react';
import { TIER_ORDER, TIERS, type CanvasNode, type Connection, type GeneratorConfig, type MachineRecipe, type MultiConfig, type RecipeItem, type VoltageTier } from './types';
import { itemsMatch, MODPACKS, useRecipeDatabase, type ModpackId, type RecipeDatabase } from './recipeData';
import { machineStats, nodeInputs, perCycle, perCycleOf, solveFlows, type FlowResult } from './solver';
import { nearestFree, placeBadges, type Rect } from './layout';
import { planRoute, warmRouteCosts } from './bestRoute';
import { fromGtnhProject, isGtnhProject } from './importers';
import { MultiblockSettings } from './components/MultiblockSettings';
import { communityEnabled, currentUser, fetchFlows, flowLink, flowSignature, recordCopy, updateSharedBuild, logout, onUserChange, pushFlows, subscribeBuilds, type Build, type User } from './community';
import { makeExamples } from './examples';
import { analyzeFlow, machineTotals } from './buildStats';
import { cleanFlow } from './flowShape';
import { markSynced, noteSaves, primeSaves, queueDeletes, queueFlows, setSyncAdapter, takeSynced, tombstones } from './cloudSync';
import { compact, euUnit, formatEU, formatRate, parseRate, visibleColor, useUnits } from './format';
import { NODE_TARGET_WIDE, NODE_WIDE, NODE_WIDTH, NodeCard, SUPPLY_WIDTH, type LinkHint } from './components/NodeCard';
import { EditableText, EditableValue } from './components/RateInput';
import type { SearchMode, SelectOpts } from './components/SearchModal';
// Opened on demand: loaded the first time they're shown.
import { ExportImageModal } from './components/ExportImageModal';
import { BuildImageModal, BuildSheet, type BuildGroup, type BuildLayout } from './components/BuildSheet';
import { BuildMode } from './components/BuildMode';
import { buildSteps } from './buildMode';
import { DEFAULT_EXPORT, EXPORT_SIZES, type ExportOptions } from './exportOptions';
import { AuthModal, BuildsPage, Guide, ImportModal, ModerationModal, ProfileModal, SearchModal, ShareBuildModal, SuggestPackModal } from './lazy';
import { UnitsToggles } from './components/UnitsPicker';
import { ConsentBanner } from './components/ConsentBanner';
import { useConsent } from './consent';
import { MachineIcon } from './components/MachineIcon';
import { ItemIcon } from './components/ItemIcon';
import { HoverInfo, WireInfo } from './components/HoverInfo';
import { PixelIcon } from './components/PixelIcon';
import { TooltipLayer } from './components/Tooltip';
import { Dropdown } from './components/Dropdown';
import { CloudIcon, ScrollRow, TripleChevron } from './components/HeaderBits';

// Selected modpack (header dropdown). Canvas and saves are stored per pack.
// The modpack: the visitor's last choice; GregTech for new visitors. Anyone who already has
// work under Sky Greg (the old default, which never saved a choice) stays on Sky Greg.
// A link can pick it: /?pack=gtnh (the landing pages use this); the choice is then remembered.
const PACK: ModpackId = (() => {
  try {
    const url = new URL(location.href);
    const asked = url.searchParams.get('pack');
    if (asked) {
      if (MODPACKS.some((m) => m.id === asked)) localStorage.setItem('gt_calc_pack', asked);
      url.searchParams.delete('pack');
      history.replaceState(null, '', url);
    }
    const v = localStorage.getItem('gt_calc_pack');
    if (MODPACKS.some((m) => m.id === v)) return v as ModpackId;
    const pack: ModpackId = localStorage.getItem('gt_calc_saved') || localStorage.getItem('gt_calc_saves') ? 'skygreg' : 'base';
    localStorage.setItem('gt_calc_pack', pack);
    return pack;
  } catch {
    return 'base';
  }
})();
const packKey = (key: string) => (PACK === 'skygreg' ? key : `${key}_${PACK}`);
const STORAGE_KEY = packKey('gt_calc_saved');

/** Auto Ratio modes: label, colours (kept from the old buttons) and a one-line explanation. */
const AUTO_MODES = {
  efficient: { label: 'Max Efficiency', text: 'text-emerald-300', box: 'bg-emerald-950 border-emerald-500/50', help: 'Base tier everywhere: lowest EU/t, most machines.' },
  balanced: { label: 'Balanced', text: 'text-sky-300', box: 'bg-sky-950 border-sky-500/50', help: 'Best upgrades first, using a third of the extra EU/t.' },
  compact: { label: 'Min Machines', text: 'text-amber-300', box: 'bg-amber-950 border-amber-500/50', help: 'Fewest machines the EU/t budget allows.' },
} as const;
const NODE_GAP = 40; // minimum space between machine cards
const BADGE_W = 176;
const BADGE_H = 92; // room for item names that wrap onto a second line

interface Measured { w: number; h: number; ports: Record<string, number> }
interface SearchState { mode: SearchMode; nodeId?: string; item?: RecipeItem; at?: { x: number; y: number } }
interface LinkDrag { nodeId: string; side: 'in' | 'out'; item: RecipeItem; startX: number; startY: number; active: boolean; x: number; y: number }

const SAVES_KEY = packKey('gt_calc_saves');

/** A named flow kept in the browser (Save button / Saves tab). */
interface SavedFlow {
  id: string;
  name: string;
  savedAt: number;
  nodes: CanvasNode[];
  connections: Connection[];
  targetEUtBudget: number;
  draft?: boolean; // "Untitled flow-NN": kept automatically until it's given a name
  origin?: FlowOrigin; // who made it, when it came from Builds (kept through Save as and exports)
}
/** The original creator of a flow opened from Builds; only they can share it. */
interface FlowOrigin { author: string; authorId?: string; buildId?: string; example?: boolean }
type CurrentSave = { id: string; name: string; draft?: boolean };
/** "Last edited" time: today shows just the time, older saves show the date too. */
function formatEdited(ms: number) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `today ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })} ${time}`;
}
/** Next free "Untitled flow-NN" name. */
function nextUntitled(list: SavedFlow[]) {
  let max = 0;
  for (const x of list) {
    const m = /^Untitled flow-(\d+)$/i.exec(x.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Untitled flow-${String(max + 1).padStart(2, '0')}`;
}
interface ConfirmState { title: string; body: string; actions: { label: string; kind?: 'primary' | 'danger'; run: () => void }[] }
function loadSaves(): SavedFlow[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVES_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeSaves(list: SavedFlow[]): boolean {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(list));
    noteSaves(list); // queue what changed for the server sync
    return true;
  } catch {
    return false; // storage full or unavailable
  }
}
const snapshotOf = (nodes: CanvasNode[], connections: Connection[], budget: number) => JSON.stringify([nodes, connections, budget]);

function loadSaved(): { nodes?: CanvasNode[]; connections?: Connection[]; targetEUtBudget?: number; currentSave?: CurrentSave } | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

// Rough card geometry used until the real DOM has been measured.
const isSupply = (n: CanvasNode) => n.recipe.kind === 'supply';
/** An Output node: the item the line is for, with the rate you want (Best Route plans backwards from it). */
const isOutput = (n: CanvasNode) => n.recipe.kind === 'output';
/** Input and Output nodes: not machines, so tiers, counts and power don't apply. */
const isPort = (n: CanvasNode) => isSupply(n) || isOutput(n);
/** Bounding box of an orthogonal wire path ("M x y H x V y ..."), for skipping off-screen animation. */
const pathBox = (d: string) => {
  const t = d.split(' ');
  let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'M') { x = +t[++i]; y = +t[++i]; } else if (t[i] === 'H') x = +t[++i]; else if (t[i] === 'V') y = +t[++i]; else continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
};
const widthOf = (n: CanvasNode) => (isPort(n) ? SUPPLY_WIDTH : n.isTarget && !n.recipe.generatesEU && n.recipe.outputs.length > 1 ? NODE_TARGET_WIDE : (n.gen && n.gen.kind !== 'single') || n.multi ? NODE_WIDE : NODE_WIDTH);
const rowsOf = (n: CanvasNode) => Math.max(n.recipe.inputs.length + (n.gen?.extras?.length ?? 0), n.recipe.outputs.length + (n.recipe.generatesEU ? 1 : 0), 1);
const estimateHeight = (n: CanvasNode) => (isPort(n) ? 130 : 236 + (n.gen ? 28 : 0) + rowsOf(n) * 32);
const estimatePortY = (n: CanvasNode, side: 'in' | 'out', itemId: string) => {
  if (isPort(n)) return 82;
  const list = side === 'in' ? n.recipe.inputs : n.recipe.outputs;
  const idx = Math.max(0, list.findIndex((i) => i.id === itemId)) + (side === 'out' && n.recipe.generatesEU ? 1 : 0);
  return 190 + idx * 32 + 14;
};

// Old built-in recipe ids -> imported GTCEu ids, so canvases saved before the import keep working.
const LEGACY_RECIPES: Record<string, string> = {
  gasoline: 'gtceu:chemical_reactor/gasoline',
  raw_gasoline: 'gtceu:large_chemical_reactor/raw_gasoline',
  naphtha_desulf: 'gtceu:chemical_reactor/desulfurize_naphtha',
  naphtha_lhclf: 'gtceu:distillation_tower/distill_lightly_hydro_cracked_light_fuel',
  lhclf: 'gtceu:chemical_reactor/lightly_hydro_crack_light_fuel',
  light_fuel: 'gtceu:distillation_tower/distill_lightly_hydro_cracked_heavy_fuel',
  lhchf: 'gtceu:chemical_reactor/lightly_hydro_crack_heavy_fuel',
  heavy_fuel: 'gtceu:chemical_reactor/desulfurize_heavy_fuel',
  sulfuric_heavy_fuel: 'gtceu:distillation_tower/distill_heavy_oil',
  refinery_gas: 'gtceu:chemical_reactor/desulfurize_natural_gas',
  toluene: 'gtceu:distillation_tower/distill_wood_tar',
  wood_tar: 'gtceu:pyrolyse_oven/log_to_wood_tar_nitrogen',
  acetone: 'gtceu:distillation_tower/distill_wood_vinegar',
  wood_vinegar: 'gtceu:pyrolyse_oven/log_to_wood_vinegar_nitrogen',
  gas_turbine: 'gtceu:combustion_generator/gasoline',
};
const LEGACY_ITEMS: Record<string, string> = {
  hydrogen_gas: 'gtceu:hydrogen', nitrogen_gas: 'gtceu:nitrogen', methane_gas: 'gtceu:methane', oxygen_gas: 'gtceu:oxygen',
  lhclf: 'gtceu:lightly_hydro_cracked_light_fuel', lhchf: 'gtceu:lightly_hydro_cracked_heavy_fuel',
  water: 'minecraft:water', logs: '#minecraft:logs_that_burn', heavy_oil: 'gtceu:oil_heavy',
};
const legacyItem = (id: string) => (id.includes(':') ? id : LEGACY_ITEMS[id] ?? `gtceu:${id}`);

/** Refresh saved nodes from the current recipe database (and migrate pre-import saves). */
function refreshFromDatabase(nodes: CanvasNode[], connections: Connection[], db: RecipeDatabase) {
  let changed = false;
  const migrated = new Set<string>();
  const next = nodes.map((n) => {
    const legacyId = LEGACY_RECIPES[n.recipe.id];
    const fresh = db.byId.get(legacyId ?? n.recipe.id);
    if (!fresh) return n;
    if (legacyId) migrated.add(n.instanceId);
    const gen = fresh.generatesEU || fresh.boiler ? n.gen ?? makeGenConfig(db, fresh) : undefined;
    if (fresh === n.recipe && gen === n.gen) return n;
    changed = true;
    const baseIdx = TIER_ORDER.indexOf(fresh.baseTier);
    const tier = TIER_ORDER.indexOf(n.selectedTier) >= baseIdx ? n.selectedTier : fresh.baseTier;
    const targetRate = n.targetRate && legacyId ? { ...n.targetRate, itemId: legacyItem(n.targetRate.itemId) } : n.targetRate;
    return { ...n, recipe: fresh, selectedTier: tier, targetRate, gen };
  });
  if (!changed) return null;
  const byId = new Map(next.map((n) => [n.instanceId, n]));
  const conns = connections
    .map((c) => ({
      ...c,
      sourceItemId: migrated.has(c.sourceInstanceId) ? legacyItem(c.sourceItemId) : c.sourceItemId,
      targetItemId: migrated.has(c.targetInstanceId) ? legacyItem(c.targetItemId) : c.targetItemId,
    }))
    .filter((c) => {
      const s = byId.get(c.sourceInstanceId);
      const t = byId.get(c.targetInstanceId);
      return s?.recipe.outputs.some((o) => o.id === c.sourceItemId) && t && nodeInputs(t, machineStats(t)).some((i) => i.id === c.targetItemId);
    });
  return { nodes: next, connections: conns };
}

/** The output of `recipe` that can feed `item` (exact id, else a tag match). */
function matchingOutput(recipe: MachineRecipe, item: RecipeItem) {
  return recipe.outputs.find((o) => o.id === item.id) ?? recipe.outputs.find((o) => itemsMatch(o, item));
}
function matchingInput(inputs: RecipeItem[], item: RecipeItem) {
  return inputs.find((i) => i.id === item.id) ?? inputs.find((i) => i.consumed !== false && itemsMatch(i, item));
}

/** Default machine for a generator recipe, or a specific variant (large engine, turbine...). */
function makeGenConfig(db: RecipeDatabase, recipe: MachineRecipe, variantId?: string, prev?: GeneratorConfig): GeneratorConfig | undefined {
  const variants = recipe.machineId ? db.generatorVariants[recipe.machineId] : undefined;
  if ((!recipe.generatesEU && !recipe.boiler) || !variants?.length) return undefined;
  const v = variants.find((x) => x.id === variantId) ?? variants[0];
  const fluid = (id: string) => {
    const info = db.itemById.get(id);
    return { id, name: info?.name ?? id, unit: 'mB' as const, iconColor: info?.iconColor, amount: 0 };
  };
  const extras: GeneratorConfig['extras'] = [];
  if (v.kind === 'engine') {
    extras.push({ ...fluid('gtceu:lubricant'), perTick: 1 / 72 }); // 1 mB every 72 ticks
    if (v.boost) extras.push({ ...fluid(v.boost.fluid), perTick: v.boost.perTick, boostOnly: true });
  }
  const rotor = v.kind === 'turbine'
    ? prev?.rotor ?? db.rotors.find((r) => r.id === 'steel') ?? db.rotors[0]
    : undefined;
  return {
    variantId: v.id,
    kind: v.kind,
    name: v.name,
    tier: v.tier,
    maxTier: v.maxTier,
    boost: v.boost,
    boostOn: v.kind === 'engine' ? prev?.boostOn ?? false : undefined,
    rotor,
    holderTier: v.kind === 'turbine' ? v.tier : undefined,
    ...(v.kind === 'boiler' ? { steamScale: v.steamScale, steamPerTick: v.steamPerTick } : {}),
    extras,
  };
}

/** Unconnected inputs across the canvas, totalled per item (per second). */
function rawInputUsage(nodes: CanvasNode[], connections: Connection[], flows: FlowResult) {
  const connected = new Set(connections.map((c) => `${c.targetInstanceId}|${c.targetItemId}`));
  const raw = new Map<string, { item: RecipeItem; rate: number }>();
  for (const n of nodes) {
    const f = flows.nodes.get(n.instanceId);
    if (!f) continue;
    for (const i of nodeInputs(n, f.stats)) {
      if (i.consumed === false || connected.has(`${n.instanceId}|${i.id}`)) continue;
      const e = raw.get(i.id) ?? { item: i, rate: 0 };
      e.rate += perCycle(i, f.stats) * f.cyclesPerSec;
      raw.set(i.id, e);
    }
  }
  return raw;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** A wire path with its last straight run shortened by `by` px (wire paths end in "H <x>"). */
const trimEnd = (d: string, by: number) => d.replace(/H (-?[\d.]+)$/, (_m, x: string) => `H ${Number(x) - by}`);
const fileSafe = (name: string) => name.replace(/[^a-z0-9-_ ]+/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'flow';
const readPref = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const writePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

/** An Input node: something supplied from outside the line. */
const PHONE = '(max-width: 767px) and (pointer: coarse)';

function makeSupplyRecipe(item: RecipeItem): MachineRecipe {
  return {
    id: `supply:${item.id}`,
    machineId: 'supply',
    machineName: 'Input',
    recipeName: item.name,
    baseTier: 'ULV',
    baseEUt: 0,
    baseDurationSec: 1,
    durationTicks: 20,
    inputs: [],
    outputs: [{ id: item.id, name: item.name, unit: item.unit, iconColor: item.iconColor, amount: 1, ...(item.isTag ? { isTag: true } : {}) }],
    kind: 'supply',
    source: 'user',
  };
}

/** An Output node: takes one item at the rate you want, so you can plan backwards from it. */
function makeOutputRecipe(item: RecipeItem): MachineRecipe {
  return {
    id: `output:${item.id}`,
    machineId: 'output',
    machineName: 'Output',
    recipeName: item.name,
    baseTier: 'ULV',
    baseEUt: 0,
    baseDurationSec: 1,
    durationTicks: 20,
    inputs: [{ id: item.id, name: item.name, unit: item.unit, iconColor: item.iconColor, amount: 1, ...(item.isTag ? { isTag: true } : {}) }],
    outputs: [],
    kind: 'output',
    source: 'user',
  };
}

export function App() {
  useUnits(); // rates per second or minute, power in EU/t or EU/s: re-render everything on change
  // Asked on first launch, and again after signing up if it was skipped.
  const dbState = useRecipeDatabase(PACK);
  // Recipe counts per modpack (written by the importer), shown in the modpack menu.
  const [packInfo, setPackInfo] = useState<Record<string, { recipes: number; generatedAt: string }>>({});
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/packs.json`).then((r) => (r.ok ? r.json() : {})).then(setPackInfo).catch(() => {});
  }, []);
  const [pixelFont, setPixelFont] = useState(() => readPref('gt_calc_pixel_font', '1') === '1');
  useEffect(() => writePref('gt_calc_pixel_font', pixelFont ? '1' : '0'), [pixelFont]);
  /** Each modpack has its own canvas and saves; switching reloads with the other pack's data. */
  const switchPack = (pack: ModpackId) => {
    if (pack === PACK) return;
    writePref('gt_calc_pack', pack);
    window.location.reload();
  };
  const db = dbState.status === 'ready' ? dbState.db : null;

  const [saved] = useState(loadSaved);
  const [nodes, setNodes] = useState<CanvasNode[]>(() => saved?.nodes ?? []);
  const [connections, setConnections] = useState<Connection[]>(() => saved?.connections ?? []);
  const [budget, setBudget] = useState<number>(() => saved?.targetEUtBudget ?? 100000);
  const [autoMode, setAutoMode] = useState<'efficient' | 'balanced' | 'compact'>(() => readPref('gt_calc_auto_mode', 'balanced') as 'efficient' | 'balanced' | 'compact');
  const [snapOn, setSnapOn] = useState(() => readPref('gt_calc_snap', '1') === '1');
  // Auto Ratio locked on: reruns whenever machines or links are added or removed.
  const [autoLock, setAutoLock] = useState(() => readPref('gt_calc_auto_lock', '0') === '1');
  useEffect(() => { writePref('gt_calc_auto_lock', autoLock ? '1' : '0'); }, [autoLock]);
  // Flow animation on every wire costs a repaint per frame; off by default (hovered wires still animate).
  const [flowAnim, setFlowAnim] = useState(() => readPref('gt_calc_flow_anim2', '1') === '1');
  const [showLabels, setShowLabels] = useState(() => readPref('gt_calc_flow_labels2', '0') === '1');
  const [showHelp, setShowHelp] = useState(() => readPref('gt_calc_show_help', '1') === '1');
  // Width of the floating energy box, so the bottom-left toolbar wraps before reaching it.
  const [energyW, setEnergyW] = useState(460);
  // Bottom toolbar: full labels while every control fits on one line, icons only otherwise.
  const toolRow = useRef<HTMLDivElement>(null);
  const [toolWide, setToolWide] = useState(true);
  const toolNeeds = useRef(0); // the width it took with labels, so they come back once there's room
  // Little or no room beside the energy box: the toolbar sits above it and the energy bar
  // spans the bottom. The bar's natural width is kept from before it stretched.
  const [toolAbove, setToolAbove] = useState(false);
  const toolAboveRef = useRef(false);
  toolAboveRef.current = toolAbove;
  const energyObserver = useRef<ResizeObserver | null>(null);
  const energyRef = useCallback((el: HTMLDivElement | null) => {
    energyObserver.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    setEnergyW(Math.ceil(el.offsetWidth));
    energyObserver.current = new ResizeObserver(() => { if (!toolAboveRef.current) setEnergyW(Math.ceil(el.offsetWidth)); });
    energyObserver.current.observe(el);
  }, []);
  useEffect(() => writePref('gt_calc_show_help', showHelp ? '1' : '0'), [showHelp]);
  useEffect(() => writePref('gt_calc_flow_labels2', showLabels ? '1' : '0'), [showLabels]);
  useEffect(() => writePref('gt_calc_flow_anim2', flowAnim ? '1' : '0'), [flowAnim]);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number } | null>(null);
  const [hover, setHover] = useState<{ kind: 'node' | 'wire'; id: string } | null>(null);
  // Hover fading, smoothed: crossing the gap between two cards or wires doesn't un-fade and
  // re-fade everything (that read as flicker), and skimming past something doesn't fade at all.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverNow = useRef<{ kind: 'node' | 'wire'; id: string } | null>(null);
  const requestHover = useCallback((h: { kind: 'node' | 'wire'; id: string } | null) => {
    clearTimeout(hoverTimer.current);
    const apply = () => { hoverNow.current = h; setHover(h); };
    if (h && hoverNow.current) apply(); // already fading: switch straight to the new target
    else hoverTimer.current = setTimeout(apply, h ? 60 : 140);
  }, []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const [hoverMode, setHoverMode] = useState<'direct' | 'chain' | 'off'>(() => readPref('gt_calc_hover2', 'chain') as 'direct' | 'chain' | 'off');
  const [budgetOn, setBudgetOn] = useState(() => readPref('gt_calc_budget_on', '1') === '1');
  const [maxTier, setMaxTier] = useState<VoltageTier>(() => readPref('gt_calc_max_tier', 'UHV') as VoltageTier);
  const [useLargeMachines, setUseLargeMachines] = useState(() => readPref('gt_calc_use_large', '0') === '1');
  const [parallelAccess, setParallelAccess] = useState(() => readPref('gt_calc_parallel_access', '0') === '1');
  useEffect(() => writePref('gt_calc_use_large', useLargeMachines ? '1' : '0'), [useLargeMachines]);
  useEffect(() => writePref('gt_calc_parallel_access', parallelAccess ? '1' : '0'), [parallelAccess]);
  const maxTierRef = useRef(maxTier);
  maxTierRef.current = maxTier;
  useEffect(() => writePref('gt_calc_max_tier', maxTier), [maxTier]);
  const [alwaysRunning, setAlwaysRunning] = useState(() => readPref('gt_calc_always_running', '0') === '1');
  // Manual machine counts: new machines start at 1 and keep the count you give them (nothing
  // scales on its own); Auto Ratio still sizes everything when clicked.
  const [manualCounts, setManualCounts] = useState(() => readPref('gt_calc_manual_counts', '0') === '1');
  const [exporting, setExporting] = useState(false);
  const [exportGrid, setExportGrid] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const afterSave = useRef<(() => void) | null>(null); // run once the save dialog saves (e.g. open the next flow)
  const [built, setBuilt] = useState<Set<string>>(new Set());
  const [, setHistTick] = useState(0);
  const [machineSort, setMachineSort] = useState<'machine' | 'tier'>('machine');
  const [exportMenu, setExportMenu] = useState(false);
  // Guide: the blank canvas offers it big until it's been opened once (remembered in this browser).
  const [showGuide, setShowGuide] = useState(false);
  const [guideSeen, setGuideSeen] = useState(() => readPref('gt_calc_guide_seen', '0') === '1');
  /** First-launch choices: picking any of them hides the welcome options for good. */
  const markWelcomed = () => {
    setGuideSeen(true);
    writePref('gt_calc_guide_seen', '1');
  };
  const openGuide = () => {
    setShowGuide(true);
    markWelcomed();
  };
  const [allocPrompt, setAllocPrompt] = useState<{ nodeId: string; sourceId: string; itemId: string; inputId: string } | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<string | null>(null); // a new Input node: offer to feed every machine using its item
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Build mode: the step being shown (null = off). The canvas can't be edited meanwhile.
  const [buildStep, setBuildStep] = useState<number | null>(null);
  const building = buildStep != null;
  // First machine ever placed: open the side panel once so new players see it.
  const firstNodeShown = useRef(readPref('gt_calc_panel_intro', '0') === '1');
  // On phones the panel would cover the whole flow, so a bubble points at its button instead.
  const [panelHint, setPanelHint] = useState(false);
  const [userSuppliedLimits, setUserSuppliedLimits] = useState<Record<string, string>>({});
  const [outputFilter, setOutputFilter] = useState<'all' | 'surplus'>('all');
  const [sidebarTab, setSidebarTab] = useState<'balances' | 'machines'>('balances');
  const [buildsTab, setBuildsTab] = useState<'list' | 'mine' | 'favorites'>('list');
  const [navKey, setNavKey] = useState(0);
  // View mode: a shared flow opened on the canvas to look at, not copied or saved. While it's
  // up, the user's own flow waits in `stash` and nothing on the canvas can be changed or saved.
  const [viewFlow, setViewFlow] = useState<{ build: Build; stash: { nodes: CanvasNode[]; connections: Connection[] } } | null>(null);
  const viewing = viewFlow != null;
  const viewingRef = useRef(false);
  useEffect(() => { viewingRef.current = viewing; }, [viewing]); // bumped by the header's Community / My flows: back to the list
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const [panAnimating, setPanAnimating] = useState(false);
  // Empty drafts (left by older versions' New flow) are dropped on load; a restored flow that was one
  // opens as a fresh canvas instead.
  const [saves, setSaves] = useState<SavedFlow[]>(() => {
    const list = loadSaves();
    const kept = list.filter((x) => !(x.draft && !x.nodes.length));
    if (kept.length !== list.length) writeSaves(kept);
    return kept;
  });
  const [currentSave, setCurrentSave] = useState<CurrentSave | null>(() => {
    const cur = saved?.currentSave ?? null;
    return cur && loadSaves().some((x) => x.id === cur.id) ? cur : null;
  });
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(() => {
    const match = saved?.currentSave && loadSaves().find((x) => x.id === saved.currentSave!.id);
    return match ? snapshotOf(match.nodes, match.connections, match.targetEUtBudget) : null;
  });
  const [saveDialog, setSaveDialog] = useState<string | null>(null); // name being typed
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  // Best Route runs Auto Ratio, then Auto Sort, each after the previous change has rendered.
  const [routeStep, setRouteStep] = useState<{ stage: 1 | 2 | 3 | 4; msg: string; undo: () => void; ids: Set<string> } | null>(null);
  const [measured, setMeasured] = useState<Record<string, Measured>>({});
  const [measureTick, setMeasureTick] = useState(0);
  const [modOpen, setModOpen] = useState(false); // username moderation (moderators only)
  const [suggestOpen, setSuggestOpen] = useState(false); // "Suggest a pack"
  const [exportPanel, setExportPanel] = useState(false); // image export options
  const afterUsername = useRef<(() => void) | undefined>(undefined); // runs once a new Google account has its username
  const [toastState, setToastState] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  const setToast = useCallback((text: string | null, undo?: () => void) => setToastState(text ? { text, undo, id: Date.now() } : null), []);
  // Big flows: once, suggest turning the wire animation off if the page gets slow.
  useEffect(() => {
    if (!flowAnim || connections.length <= 25 || readPref('gt_calc_flow_tip', '0') === '1') return;
    writePref('gt_calc_flow_tip', '1');
    setToast('This flow is getting big. If the page feels slow, turn off the Flow animation in the bottom toolbar.');
  }, [flowAnim, connections.length, setToast]);
  const toast = toastState;

  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Community: the Builds page replaces the canvas while open (the canvas is hidden, not drawn).
  // A shared link (?flow=<id>) opens that flow's page on Community.
  // Only used for the first visit: the header buttons always open the list after that.
  const [linkedFlow, setLinkedFlow] = useState(() => new URLSearchParams(location.search).get('flow'));
  const [page, setPage] = useState<'canvas' | 'builds'>(() => (linkedFlow ? 'builds' : 'canvas'));
  /** Keep the address bar on the flow being viewed, so it can be copied and shared. */
  const showFlowInUrl = useCallback((id: string | null) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set('flow', id); else url.searchParams.delete('flow');
    if (url.href !== location.href) window.history.replaceState(null, '', url);
  }, []);
  useEffect(() => { if (page !== 'builds') showFlowInUrl(null); }, [page, showFlowInUrl]);
  const consent = useConsent(); // null until the cookie banner is answered
  // Phones only view flows: cards can't be dragged, linked or changed (pan and pinch still work).
  const [viewOnly, setViewOnly] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setViewOnly(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [user, setUser] = useState<User | null>(() => currentUser());
  useEffect(() => onUserChange(setUser), []);
  const [authPrompt, setAuthPrompt] = useState<{ reason?: string; then?: () => void } | null>(null);
  // Flow being shared to Builds (the open one, or a save from the Saves tab).
  const [shareFlow, setShareFlow] = useState<{ id?: string; name: string; flow: { nodes: CanvasNode[]; connections: Connection[]; targetEUtBudget: number } } | null>(null);
  // Saved flows this user has already shared -> the build each became, so Share can hand out its link.
  const [sharedFlowIds, setSharedFlowIds] = useState<Map<string, string>>(() => new Map());
  const [sharedBuilds, setSharedBuilds] = useState<Map<string, Build>>(() => new Map()); // saved flow id -> its shared build
  // Notifications: new upvotes, favourites, comments and copies on your shared flows since you
  // last opened the profile window (counts remembered per account in this browser).
  const [myBuilds, setMyBuilds] = useState<Build[]>([]);
  const seenKey = user ? `gt_calc_seen_${user.uid}` : null;
  const [seen, setSeen] = useState<Record<string, number[]> | null>(null);
  useEffect(() => {
    if (!seenKey) { setSeen(null); return; }
    try { setSeen(JSON.parse(localStorage.getItem(seenKey) ?? 'null')); } catch { setSeen(null); }
  }, [seenKey]);
  const countsOf = (b: Build) => [b.upvoters.filter((u) => u !== b.authorId).length, b.favoriters.filter((u) => u !== b.authorId).length, b.commentCount, b.forkers?.length ?? 0];
  const markSeen = useCallback(() => {
    if (!seenKey) return;
    const now = Object.fromEntries(myBuilds.map((b) => [b.id, countsOf(b)]));
    try { localStorage.setItem(seenKey, JSON.stringify(now)); } catch { /* storage blocked */ }
    setSeen(now);
  }, [seenKey, myBuilds]);
  // The first time on this browser, today's counts are the starting point (no flood of old news).
  useEffect(() => { if (seenKey && seen === null && myBuilds.length) markSeen(); }, [seenKey, seen, myBuilds, markSeen]);
  const activity = useMemo(() => myBuilds.map((b) => {
    const was = seen?.[b.id] ?? [0, 0, 0, 0];
    const d = countsOf(b).map((n, i) => Math.max(0, n - (was[i] ?? 0)));
    return { build: b, up: d[0], fav: d[1], comments: d[2], copies: d[3], total: d[0] + d[1] + d[2] + d[3] };
  }).filter((a) => a.total > 0), [myBuilds, seen]);
  const unread = seen ? activity.reduce((a, x) => a + x.total, 0) : 0;
  /** Clear one flow's news (it was opened from the profile window). */
  const markSeenOne = (b: Build) => {
    if (!seenKey) return;
    const next = { ...(seen ?? {}), [b.id]: countsOf(b) };
    try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch { /* storage blocked */ }
    setSeen(next);
  };
  // Opening a flow's page from elsewhere (a notification): the Community page picks this up.
  const [jump, setJump] = useState<{ id: string; comments: boolean; n: number } | null>(null);
  useEffect(() => { if (page !== 'builds') setJump(null); }, [page]); // only acted on while it's fresh
  const openActivity = (a: { build: Build; comments: number }) => {
    markSeenOne(a.build);
    setProfileOpen(false);
    exitView();
    setLinkedFlow(null);
    setBuildsTab('list');
    setPage('builds');
    setJump((j) => ({ id: a.build.id, comments: a.comments > 0, n: (j?.n ?? 0) + 1 }));
  };
  const currentOrigin = saves.find((x) => x.id === currentSave?.id)?.origin;
  const [profileOpen, setProfileOpen] = useState(false);
  const [examples, setExamples] = useState<Build[]>([]);
  // Multi-select: the Select tool drags a box on the canvas; selected cards move together and
  // get the bulk actions bar.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Select tool: holding Space switches to move mode (drag pans the canvas) until released.
  const [spaceMove, setSpaceMove] = useState(false);
  useEffect(() => {
    if (!selectMode) { setSpaceMove(false); return; }
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]');
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); setSpaceMove(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceMove(false); };
    const blur = () => setSpaceMove(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [selectMode]);
  // Large machines Auto Ratio must not pick (variant ids), from the Settings next to "Use large machines".
  const [disabledMultis, setDisabledMultis] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(packKey('gt_calc_multi_off')) || '[]')); } catch { return new Set(); }
  });
  const [multiSettings, setMultiSettings] = useState(false);
  const updateDisabledMultis = (next: Set<string>) => {
    setDisabledMultis(next);
    writePref(packKey('gt_calc_multi_off'), JSON.stringify([...next]));
  };
  // Balances sections: open by default, remembered per browser.
  const [balOpen, setBalOpen] = useState<{ raw: boolean; out: boolean }>(() => {
    try { return { raw: true, out: true, ...JSON.parse(localStorage.getItem('gt_calc_bal_open') || '{}') }; } catch { return { raw: true, out: true }; }
  });
  const toggleBal = (k: 'raw' | 'out') => setBalOpen((prev) => {
    const next = { ...prev, [k]: !prev[k] };
    writePref('gt_calc_bal_open', JSON.stringify(next));
    return next;
  });
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const dragPan = useRef<{ x: number; y: number } | null>(null); // live pan while dragging the canvas
  const nodeDrag = useRef<{ id: string; offX: number; offY: number } | null>(null);

  // Latest state for stable callbacks (keeps memoised node cards from re-rendering).
  const live = useRef({ nodes, connections, pan, zoom, measured, saveName: '', snap: snapOn });
  live.current = { nodes, connections, pan, zoom, measured, saveName: currentSave?.name ?? '', snap: snapOn };
  useEffect(() => writePref('gt_calc_snap', snapOn ? '1' : '0'), [snapOn]);
  useEffect(() => writePref('gt_calc_hover2', hoverMode), [hoverMode]);
  useEffect(() => writePref('gt_calc_budget_on', budgetOn ? '1' : '0'), [budgetOn]);
  useEffect(() => writePref('gt_calc_always_running', alwaysRunning ? '1' : '0'), [alwaysRunning]);
  useEffect(() => writePref('gt_calc_manual_counts', manualCounts ? '1' : '0'), [manualCounts]);
  const effectiveBudget = budgetOn && budget > 0 ? budget : Infinity;
  useEffect(() => writePref('gt_calc_auto_mode', autoMode), [autoMode]);

  // ---------------------------------------------------------------- persistence
  const autosaveWarned = useRef(false);
  useEffect(() => {
    if (draggingNodeId || viewFlow) return; // view mode: the user's own flow stays as last stored
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, connections, targetEUtBudget: budget, currentSave }));
        autosaveWarned.current = false;
      } catch {
        // Storage full or blocked: say so once, rather than silently losing the autosave.
        if (!autosaveWarned.current) setToast('This browser\'s storage is full, so the canvas isn\'t being autosaved. Save the flow or export it');
        autosaveWarned.current = true;
      }
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, connections, budget, draggingNodeId, currentSave, viewFlow, setToast]);

  // ---------------------------------------------------------------- undo / redo
  // Snapshots are taken once things settle (not on every drag frame).
  type Snap = { nodes: CanvasNode[]; connections: Connection[]; budget: number };
  const history = useRef<{ past: Snap[]; future: Snap[]; last: Snap | null; skip: boolean }>({ past: [], future: [], last: null, skip: false });
  useEffect(() => {
    if (draggingNodeId) return;
    if (viewFlow) { history.current.skip = true; return; } // looking at a shared flow isn't an edit
    const t = setTimeout(() => {
      const h = history.current;
      const cur = { nodes, connections, budget };
      if (h.skip || !h.last) { h.skip = false; h.last = cur; return; }
      if (h.last.nodes === nodes && h.last.connections === connections && h.last.budget === budget) return;
      h.past.push(h.last);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.last = cur;
      setHistTick((x) => x + 1);
    }, 350);
    return () => clearTimeout(t);
  }, [nodes, connections, budget, draggingNodeId, viewFlow]);
  const restore = (snap: Snap) => {
    history.current.skip = true;
    history.current.last = snap;
    setNodes(snap.nodes);
    setConnections(snap.connections);
    setBudget(snap.budget);
    setHistTick((x) => x + 1);
  };
  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev || !h.last) return;
    h.future.push(h.last);
    restore(prev);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next || !h.last) return;
    h.past.push(h.last);
    restore(next);
  };
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.closest?.('input,textarea,select')) return; // target can be the page itself (no closest)
      if (viewingRef.current) return; // view mode: no shortcuts change anything
      const k = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey)) {
        if ((k === 'delete' || k === 'backspace') && selectedRef.current.size) { e.preventDefault(); selectionKeys.current.bulkDelete(); }
        if (k === 'escape') { setSelected(new Set()); setSelectMode(false); }
        return;
      }
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current.undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRef.current.redo(); }
      else if (k === 'c' && selectedRef.current.size) { if (selectionKeys.current.copySelection()) e.preventDefault(); }
      else if (k === 'v') { e.preventDefault(); selectionKeys.current.pasteSelection(); }
      else if (k === 'a') { e.preventDefault(); setSelected(new Set(live.current.nodes.map((n) => n.instanceId))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pull fresh recipe data into saved nodes once the database is loaded.
  useEffect(() => {
    if (!db) return;
    const res = refreshFromDatabase(live.current.nodes, live.current.connections, db);
    if (res) {
      setNodes(res.nodes);
      setConnections(res.connections);
    }
  }, [db]);

  // ---------------------------------------------------------------- flow solve
  const logicKey = useMemo(
    () => JSON.stringify([
      nodes.map((n) => [n.instanceId, n.recipe.id, n.recipe.inputs.length, n.selectedTier, n.count, n.countMode, n.isTarget, n.targetRate, n.targetEUt, n.supplyLimit, n.gen, n.multi]),
      connections,
    ]),
    [nodes, connections],
  );
  // The node list as of the last logic change: moving a node doesn't change it, so totals
  // and summaries built from it aren't recomputed on every drag frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const logicNodes = useMemo(() => live.current.nodes, [logicKey]);
  const flows = useMemo(
    () => solveFlows(live.current.nodes, live.current.connections),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logicKey],
  );

  // ---------------------------------------------------------------- measurement
  const resizeObserver = useMemo(
    () => (typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => setMeasureTick((t) => t + 1)) : null),
    [],
  );
  const registerEl = useCallback((id: string, el: HTMLDivElement | null) => {
    const prev = nodeEls.current.get(id);
    if (prev === el) return; // already observed: re-observing fires the observer again (re-measure + re-render)
    if (prev) resizeObserver?.unobserve(prev);
    if (el) {
      nodeEls.current.set(id, el);
      resizeObserver?.observe(el);
    } else {
      nodeEls.current.delete(id);
    }
  }, [resizeObserver]);

  useLayoutEffect(() => {
    const next: Record<string, Measured> = {};
    for (const [id, el] of nodeEls.current) {
      const ports: Record<string, number> = {};
      el.querySelectorAll<HTMLElement>('[data-port]').forEach((p) => {
        let y = 0;
        let cur: HTMLElement | null = p;
        while (cur && cur !== el) {
          y += cur.offsetTop;
          cur = cur.offsetParent as HTMLElement | null;
        }
        // offsetTop is measured inside the card's border, so add the border (clientTop) to get
        // the port's centre from the card's outer edge, where node.y is.
        ports[p.dataset.port!] = el.clientTop + y + p.offsetHeight / 2;
      });
      next[id] = { w: el.offsetWidth, h: el.offsetHeight, ports };
    }
    setMeasured((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [logicKey, measureTick, db]);

  const rectOf = useCallback((n: CanvasNode, m: Record<string, Measured> = live.current.measured): Rect => ({
    x: n.x,
    y: n.y,
    w: m[n.instanceId]?.w ?? widthOf(n),
    h: m[n.instanceId]?.h ?? estimateHeight(n),
  }), []);
  const portY = (n: CanvasNode, side: 'in' | 'out', itemId: string) =>
    n.y + (measured[n.instanceId]?.ports[`${side}:${itemId}`] ?? estimatePortY(n, side, itemId));

  // Push apart anything that overlaps (e.g. a card grew taller, or an old save).
  useEffect(() => {
    if (draggingNodeId) return;
    const placed: Rect[] = [];
    let changed = false;
    const updated = nodes.map((n) => {
      const r = rectOf(n, measured);
      const pos = nearestFree(r, placed, NODE_GAP);
      placed.push({ ...r, ...pos });
      if (pos.x !== n.x || pos.y !== n.y) {
        changed = true;
        return { ...n, x: pos.x, y: pos.y };
      }
      return n;
    });
    if (changed) setNodes(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, draggingNodeId, nodes.length]);

  // ---------------------------------------------------------------- coordinates
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { zoom: z } = live.current;
    const p = dragPan.current ?? live.current.pan;
    return { x: (clientX - r.left - p.x) / z, y: (clientY - r.top - p.y) / z };
  }, []);

  // ---------------------------------------------------------------- node mutations
  const updateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
    if (viewingRef.current) return; // view mode: cards can't be changed (backs up the CSS)
    setNodes((prev) => prev.map((n) => (n.instanceId === id ? { ...n, ...updates } : n)));
  }, []);

  const flowsRef = useRef(flows);
  flowsRef.current = flows;

  const onTierStep = useCallback((node: CanvasNode, dir: 1 | -1) => {
    const gen = node.gen;
    if (gen?.kind === 'engine' || gen?.kind === 'boiler') return;
    if (gen?.kind === 'turbine' && gen.tier) {
      // Turbines: the badge is the rotor holder tier (holders exist from the turbine's tier up to UV).
      const lo = TIER_ORDER.indexOf(gen.tier);
      const hi = TIER_ORDER.indexOf('UV');
      const next = Math.min(hi, Math.max(lo, TIER_ORDER.indexOf(gen.holderTier ?? gen.tier) + dir));
      updateNode(node.instanceId, { gen: { ...gen, holderTier: TIER_ORDER[next] } });
      return;
    }
    const base = TIER_ORDER.indexOf(node.recipe.baseTier);
    // Never step above the max tier you can build (but a recipe's own base tier is always allowed).
    const top = Math.max(base, Math.min(gen?.maxTier ? TIER_ORDER.indexOf(gen.maxTier) : TIER_ORDER.length - 1, TIER_ORDER.indexOf(maxTierRef.current)));
    const cur = TIER_ORDER.indexOf(node.selectedTier);
    let next = cur + dir;
    if (dir === 1 && next > top) next = base; // wrap back to base
    if (next < base) next = base;
    updateNode(node.instanceId, { selectedTier: TIER_ORDER[next] });
  }, [updateNode]);

  const dbRef = useRef(db);
  dbRef.current = db;
  const onGenChange = useCallback((node: CanvasNode, change: { variantId?: string; boostOn?: boolean; rotorId?: string }) => {
    const database = dbRef.current;
    if (!database) return;
    let gen = node.gen;
    if (change.variantId) gen = makeGenConfig(database, node.recipe, change.variantId, gen);
    if (gen && change.boostOn != null) gen = { ...gen, boostOn: change.boostOn };
    if (gen && change.rotorId) gen = { ...gen, rotor: database.rotors.find((r) => r.id === change.rotorId) ?? gen.rotor };
    const selectedTier = gen?.kind === 'single' && gen.maxTier && TIER_ORDER.indexOf(node.selectedTier) > TIER_ORDER.indexOf(gen.maxTier) ? gen.maxTier : node.selectedTier;
    updateNode(node.instanceId, { gen, selectedTier });
    // Lubricant / boost inputs may have gone away: drop their now-dangling connections.
    const updated = { ...node, gen, selectedTier };
    const inputs = new Set(nodeInputs(updated, machineStats(updated)).map((i) => i.id));
    setConnections((prev) => prev.filter((c) => c.targetInstanceId !== node.instanceId || inputs.has(c.targetItemId)));
  }, [updateNode]);

  const onMultiChange = useCallback((node: CanvasNode, change: { variantId?: string | null; parallel?: number }) => {
    const database = dbRef.current;
    if (!database || !node.recipe.machineId) return;
    if (change.variantId === null) { updateNode(node.instanceId, { multi: undefined }); return; }
    if (change.variantId) {
      const v = database.machineVariants[node.recipe.machineId]?.find((x) => x.id === change.variantId);
      if (v) updateNode(node.instanceId, { multi: { variantId: v.id, name: v.name, parallel: v.parallel ? node.multi?.parallel ?? 1 : 1 } });
      return;
    }
    if (change.parallel == null) return;
    const self = database.machineVariants[node.recipe.machineId]?.find((x) => x.self);
    // The machine's own multiblock: a hatch sets it, no hatch clears it (it is the plain machine then).
    if (self && (!node.multi || node.multi.variantId === self.id)) {
      updateNode(node.instanceId, { multi: change.parallel > 1 ? { variantId: self.id, name: self.name, parallel: change.parallel } : undefined });
      return;
    }
    if (node.multi) updateNode(node.instanceId, { multi: { ...node.multi, parallel: change.parallel } });
  }, [updateNode]);

  /** Remove links: all of a node's, or just those on one of its ports. */
  const onUnlink = useCallback((node: CanvasNode, port?: { side: 'in' | 'out'; itemId: string }) => {
    setConnections((prev) => {
      const keep = prev.filter((c) => {
        if (port?.side === 'in') return !(c.targetInstanceId === node.instanceId && c.targetItemId === port.itemId);
        if (port?.side === 'out') return !(c.sourceInstanceId === node.instanceId && c.sourceItemId === port.itemId);
        return c.sourceInstanceId !== node.instanceId && c.targetInstanceId !== node.instanceId;
      });
      if (keep.length !== prev.length) {
        const removed = prev.length - keep.length;
        setToast(`Removed ${removed} route${removed === 1 ? '' : 's'}`, () => setConnections(prev));
      }
      return keep;
    });
  }, [setToast]);

  const removeConnection = useCallback((id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const onSupplyLimit = useCallback((node: CanvasNode, limit: number | undefined) => {
    updateNode(node.instanceId, { supplyLimit: limit });
  }, [updateNode]);

  const onSetCount = useCallback((node: CanvasNode, count: number) => {
    if (count < 0) { updateNode(node.instanceId, { countMode: 'auto' }); return; } // unpin
    const flow = flowsRef.current.nodes.get(node.instanceId);
    if (node.isTarget || flow?.isSink) {
      // Setting the count on an end node replaces any rate target.
      updateNode(node.instanceId, { count, targetRate: undefined, targetEUt: undefined });
    } else {
      updateNode(node.instanceId, { count, countMode: 'manual' });
    }
  }, [updateNode]);

  const onToggleCountMode = useCallback((node: CanvasNode) => {
    // The lock pins the machine's tier and type for Auto Ratio; the count still follows demand.
    updateNode(node.instanceId, { setupLocked: !node.setupLocked });
  }, [updateNode]);

  const onSetTarget = useCallback((node: CanvasNode) => {
    if (viewingRef.current) return;
    const flow = flowsRef.current.nodes.get(node.instanceId);
    setNodes((prev) => prev.map((n) => (n.instanceId === node.instanceId
      ? { ...n, isTarget: true, count: Math.max(1, flow?.machines ?? n.count) }
      : n.isTarget ? { ...n, isTarget: false, targetRate: undefined, targetEUt: undefined } : n)));
  }, []);

  // Anything that removes the hovered node or wire (undo, multi-delete, relink) clears the fade too.
  useEffect(() => {
    if (!hover) return;
    const gone = hover.kind === 'node' ? !nodes.some((n) => n.instanceId === hover.id) : !connections.some((c) => c.id === hover.id);
    if (gone) { clearTimeout(hoverTimer.current); hoverNow.current = null; setHover(null); }
  }, [hover, nodes, connections]);

  const onRemove = useCallback((node: CanvasNode) => {
    if (viewingRef.current) return;
    // The card is gone before its mouseleave fires: clear the hover so the rest un-fades.
    clearTimeout(hoverTimer.current); hoverNow.current = null; setHover(null);
    setNodes((prev) => prev.filter((n) => n.instanceId !== node.instanceId));
    setConnections((prev) => prev.filter((c) => c.sourceInstanceId !== node.instanceId && c.targetInstanceId !== node.instanceId));
  }, []);

  const onChangeRecipe = useCallback((node: CanvasNode) => setSearch({ mode: 'change_recipe', nodeId: node.instanceId }), []);
  const suppressPortClick = useRef(false);
  const onPortClick = useCallback((node: CanvasNode, side: 'in' | 'out', item: RecipeItem) => {
    if (suppressPortClick.current) return; // the mouse-up ended a link drag
    setSearch({ mode: side === 'in' ? 'input_supplier' : 'output_consumer', nodeId: node.instanceId, item });
  }, []);

  // ---------------------------------------------------------------- drag-to-link from ports
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const linkDragRef = useRef<LinkDrag | null>(null);
  const onPortMouseDown = useCallback((e: React.MouseEvent, node: CanvasNode, side: 'in' | 'out', item: RecipeItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    const drag = { nodeId: node.instanceId, side, item, startX: e.clientX, startY: e.clientY, active: false, x: w.x, y: w.y };
    linkDragRef.current = drag;
    setLinkDrag(drag);
  }, [toWorld]);

  const addConnection = useCallback((c: Omit<Connection, 'id'>) => {
    setConnections((prev) => {
      if (prev.some((x) => x.sourceInstanceId === c.sourceInstanceId && x.targetInstanceId === c.targetInstanceId && x.targetItemId === c.targetItemId)) return prev;
      return [...prev, { ...c, id: `conn_${c.sourceInstanceId}_${c.targetInstanceId}_${c.targetItemId}_${Date.now().toString(36)}` }];
    });
  }, []);

  useEffect(() => {
    if (!linkDrag) return;
    const move = (e: MouseEvent) => {
      const d = linkDragRef.current;
      if (!d) return;
      const moved = d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5;
      if (!moved) return;
      const w = toWorld(e.clientX, e.clientY);
      const next = { ...d, active: true, x: w.x, y: w.y };
      linkDragRef.current = next;
      setLinkDrag(next);
    };
    const up = (e: MouseEvent) => {
      const d = linkDragRef.current;
      linkDragRef.current = null;
      setLinkDrag(null);
      if (!d?.active) return;
      suppressPortClick.current = true;
      setTimeout(() => { suppressPortClick.current = false; }, 0);

      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const nodeEl = el?.closest<HTMLElement>('[data-node]');
      const { nodes: ns } = live.current;
      const from = ns.find((n) => n.instanceId === d.nodeId);
      if (!from) return;

      if (!nodeEl) {
        // Dropped on empty canvas: pick a machine to put there.
        if (el && canvasRef.current?.contains(el) && dbRef.current) {
          const w = toWorld(e.clientX, e.clientY);
          setSearch({ mode: d.side === 'out' ? 'output_consumer' : 'input_supplier', nodeId: d.nodeId, item: d.item, at: { x: w.x - (d.side === 'out' ? 0 : NODE_WIDTH), y: w.y - 40 } });
        }
        return;
      }
      const target = ns.find((n) => n.instanceId === nodeEl.dataset.node);
      if (!target || target.instanceId === from.instanceId) return;
      const portAttr = el?.closest<HTMLElement>('[data-port]')?.dataset.port;
      const portSide = portAttr?.slice(0, portAttr.indexOf(':'));
      const portItem = portAttr?.slice(portAttr.indexOf(':') + 1);

      if (d.side === 'out') {
        const inputs = nodeInputs(target, machineStats(target));
        const dropped = portSide === 'in' ? inputs.find((i) => i.id === portItem && itemsMatch(i, d.item)) : undefined;
        const inp = dropped ?? matchingInput(inputs, d.item);
        if (!inp) { setToast(`${target.recipe.machineName} has no input for ${d.item.name}`); return; }
        linkOrUnlink({ sourceInstanceId: from.instanceId, sourceItemId: d.item.id, targetInstanceId: target.instanceId, targetItemId: inp.id });
      } else {
        const dropped = portSide === 'out' ? target.recipe.outputs.find((o) => o.id === portItem && itemsMatch(o, d.item)) : undefined;
        const out = dropped ?? matchingOutput(target.recipe, d.item);
        if (!out) { setToast(`${target.recipe.machineName} doesn't make ${d.item.name}`); return; }
        linkOrUnlink({ sourceInstanceId: target.instanceId, sourceItemId: out.id, targetInstanceId: from.instanceId, targetItemId: d.item.id });
      }
    };
    /** Dragging a link that already exists removes it instead (undo from the toast). */
    const linkOrUnlink = (c: Omit<Connection, 'id'>) => {
      const existing = live.current.connections.find((x) => x.sourceInstanceId === c.sourceInstanceId && x.sourceItemId === c.sourceItemId && x.targetInstanceId === c.targetInstanceId && x.targetItemId === c.targetItemId);
      if (!existing) { addConnection(c); return; }
      setConnections((prev) => prev.filter((x) => x.id !== existing.id));
      const name = live.current.nodes.find((n) => n.instanceId === c.sourceInstanceId)?.recipe.outputs.find((o) => o.id === c.sourceItemId)?.name ?? 'link';
      setToast(`Disconnected ${name}`, () => setConnections((prev) => [...prev, existing]));
    };
    // Right-click while dragging a link cancels it (and doesn't open the add-node menu).
    const cancel = (e: MouseEvent) => {
      if (!linkDragRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      linkDragRef.current = null;
      setLinkDrag(null);
      suppressPortClick.current = true;
      setTimeout(() => { suppressPortClick.current = false; }, 0);
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 2 || !linkDragRef.current) return;
      // Cancelling re-renders and removes these listeners before the contextmenu event
      // arrives, so block that one event separately (else the add-node window opens).
      const block = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };
      window.addEventListener('contextmenu', block, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('contextmenu', block, { capture: true }), 500);
      cancel(e);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', cancel, true);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', cancel, true);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // Re-bind only when a drag starts/ends, not on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkDrag != null, toWorld, addConnection]);

  const linkHint: LinkHint | null = useMemo(
    () => (linkDrag?.active ? { side: linkDrag.side, item: linkDrag.item, nodeId: linkDrag.nodeId } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkDrag?.active, linkDrag?.nodeId, linkDrag?.side, linkDrag?.item],
  );
  const onTargetRate = useCallback((node: CanvasNode, itemId: string, perSec: number) => {
    updateNode(node.instanceId, { targetRate: { itemId, perSec }, targetEUt: undefined });
  }, [updateNode]);
  const onTargetEUt = useCallback((node: CanvasNode, eut: number) => {
    updateNode(node.instanceId, { targetEUt: eut, targetRate: undefined });
  }, [updateNode]);

  /**
   * Snap a dragged node: line its centre or edges up with other nodes, and line its ports
   * up with the ports it's wired to so those wires run dead straight.
   */
  const snapPosition = (me: CanvasNode, desired: Rect) => {
    const { nodes: ns, connections: cs, zoom: z, measured: m } = live.current;
    const th = 10 / z;
    const portOff = (n: CanvasNode, side: 'in' | 'out', itemId: string) => m[n.instanceId]?.ports[`${side}:${itemId}`] ?? estimatePortY(n, side, itemId);
    let bx: { d: number; v: number; guide: number } | null = null;
    let by: { d: number; v: number; guide: number } | null = null;
    const tryX = (v: number, guide: number, weight = 1) => {
      const d = Math.abs(v - desired.x) * weight;
      if (d <= th && (!bx || d < bx.d)) bx = { d, v, guide };
    };
    const tryY = (v: number, guide: number, weight = 1) => {
      const d = Math.abs(v - desired.y) * weight;
      if (d <= th && (!by || d < by.d)) by = { d, v, guide };
    };
    for (const o of ns) {
      if (o.instanceId === me.instanceId) continue;
      const r = rectOf(o, m);
      tryX(r.x + r.w / 2 - desired.w / 2, r.x + r.w / 2);
      tryX(r.x, r.x);
      tryY(r.y + r.h / 2 - desired.h / 2, r.y + r.h / 2);
      tryY(r.y, r.y);
    }
    // Straight wires win over plain alignment (weight < 1).
    const byId = new Map(ns.map((n) => [n.instanceId, n]));
    for (const c of cs) {
      if (c.sourceInstanceId === me.instanceId) {
        const o = byId.get(c.targetInstanceId);
        if (o) { const y = o.y + portOff(o, 'in', c.targetItemId); tryY(y - portOff(me, 'out', c.sourceItemId), y, 0.6); }
      } else if (c.targetInstanceId === me.instanceId) {
        const o = byId.get(c.sourceInstanceId);
        if (o) { const y = o.y + portOff(o, 'out', c.sourceItemId); tryY(y - portOff(me, 'in', c.targetItemId), y, 0.6); }
      }
    }
    const sx = bx as { v: number; guide: number } | null;
    const sy = by as { v: number; guide: number } | null;
    return { x: sx?.v ?? desired.x, y: sy?.v ?? desired.y, guides: sx || sy ? { x: sx?.guide, y: sy?.guide } : null };
  };

  // ---------------------------------------------------------------- drag / pan / zoom
  const onHeaderMouseDown = useCallback((e: React.MouseEvent, node: CanvasNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    // Shift-click a card's header: add it to / remove it from the selection.
    if (e.shiftKey) {
      setSelected((prev) => { const next = new Set(prev); if (next.has(node.instanceId)) next.delete(node.instanceId); else next.add(node.instanceId); return next; });
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    nodeDrag.current = { id: node.instanceId, offX: w.x - node.x, offY: w.y - node.y };
    setDraggingNodeId(node.instanceId);
  }, [toWorld]);

  useEffect(() => {
    if (!draggingNodeId && !panning) return;
    // Panning moves the world layer and grid directly (no React render per mouse move);
    // React gets the final position on mouse-up. Node drags render at most once per frame.
    let frame = 0;
    let lastEvent: MouseEvent | null = null;
    const applyPan = (p: { x: number; y: number }) => {
      dragPan.current = p;
      const z = live.current.zoom;
      if (worldRef.current) worldRef.current.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
      if (canvasRef.current) canvasRef.current.style.backgroundPosition = `${p.x}px ${p.y}px`;
    };
    const move = (e: MouseEvent) => {
      if (panStart.current) {
        applyPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
        return;
      }
      lastEvent = e;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (lastEvent) dragTo(lastEvent); });
    };
    const dragTo = (e: MouseEvent) => {
      const drag = nodeDrag.current;
      if (!drag) return;
      const w = toWorld(e.clientX, e.clientY);
      const { nodes: ns } = live.current;
      const me = ns.find((n) => n.instanceId === drag.id);
      if (!me) return;
      // Dragging one of several selected cards moves them all by the same amount.
      const group = selectedRef.current;
      if (group.size > 1 && group.has(drag.id)) {
        const dx = w.x - drag.offX - me.x, dy = w.y - drag.offY - me.y;
        setSnapGuides(null);
        setNodes((prev) => prev.map((n) => (group.has(n.instanceId) ? { ...n, x: n.x + dx, y: n.y + dy } : n)));
        return;
      }
      let desired = { ...rectOf(me), x: w.x - drag.offX, y: w.y - drag.offY };
      let guides: { x?: number; y?: number } | null = null;
      if (live.current.snap) {
        const snapped = snapPosition(me, desired);
        desired = { ...desired, x: snapped.x, y: snapped.y };
        guides = snapped.guides;
      }
      const others = ns.filter((n) => n.instanceId !== drag.id).map((n) => rectOf(n));
      const pos = nearestFree(desired, others, NODE_GAP);
      // Pushed away from the snapped spot: the guide no longer applies.
      setSnapGuides(guides && (pos.x !== desired.x || pos.y !== desired.y) ? null : guides);
      setNodes((prev) => prev.map((n) => (n.instanceId === drag.id ? { ...n, x: pos.x, y: pos.y } : n)));
    };
    const up = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; if (lastEvent) dragTo(lastEvent); }
      if (dragPan.current) { setPan(dragPan.current); dragPan.current = null; }
      nodeDrag.current = null;
      panStart.current = null;
      setDraggingNodeId(null);
      setPanning(false);
      setSnapGuides(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingNodeId, panning, toWorld, rectOf]);

  /** Select tool: drag a box; cards it touches become selected (Shift adds to the selection). */
  const startMarquee = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    const add = e.shiftKey;
    const base = add ? new Set(selectedRef.current) : new Set<string>();
    setMarquee({ x0, y0, x1: x0, y1: y0 });
    const pick = (x1: number, y1: number) => {
      const a = toWorld(r.left + Math.min(x0, x1), r.top + Math.min(y0, y1));
      const b = toWorld(r.left + Math.max(x0, x1), r.top + Math.max(y0, y1));
      const next = new Set(base);
      for (const n of live.current.nodes) {
        const q = rectOf(n);
        if (q.x < b.x && q.x + q.w > a.x && q.y < b.y && q.y + q.h > a.y) next.add(n.instanceId);
      }
      return next;
    };
    const move = (ev: MouseEvent) => {
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
      setMarquee({ x0, y0, x1, y1 });
      setSelected(pick(x1, y1));
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setMarquee(null);
      setSelected(pick(ev.clientX - r.left, ev.clientY - r.top)); // a plain click clears it
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Touch (phones/tablets): one finger drags the view (from anywhere but a button or field),
  // two fingers pinch to zoom around the point between them. Taps still click.
  const touch = useRef<{ mode: 'pan' | 'pinch'; x: number; y: number; pan: { x: number; y: number }; zoom: number; dist: number } | null>(null);
  const touchPoint = (t: React.TouchList) => {
    const r = canvasRef.current!.getBoundingClientRect();
    if (t.length < 2) return { x: t[0].clientX - r.left, y: t[0].clientY - r.top, dist: 0 };
    const [a, b] = [t[0], t[1]];
    return { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top, dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  };
  const onCanvasTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button,input,select,textarea,a,[contenteditable]')) return;
    const p = touchPoint(e.touches);
    touch.current = { mode: e.touches.length >= 2 ? 'pinch' : 'pan', x: p.x, y: p.y, pan: { ...pan }, zoom, dist: p.dist || 1 };
  };
  const onCanvasTouchMove = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t) return;
    if (e.touches.length >= 2 && t.mode !== 'pinch') { onCanvasTouchStart(e); return; }
    const p = touchPoint(e.touches);
    if (t.mode === 'pan') { setPan({ x: t.pan.x + p.x - t.x, y: t.pan.y + p.y - t.y }); return; }
    const nz = Math.min(2.5, Math.max(0.15, t.zoom * (p.dist / t.dist)));
    // Keep the world point under the pinch centre under the fingers as they move.
    setZoom(nz);
    setPan({ x: p.x - (t.x - t.pan.x) * (nz / t.zoom), y: p.y - (t.y - t.pan.y) * (nz / t.zoom) });
  };
  const onCanvasTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && touch.current?.mode === 'pinch') { onCanvasTouchStart(e); return; } // lifted one finger: keep panning
    if (!e.touches.length) touch.current = null;
  };

  const isBackground = (target: EventTarget) => !(target as HTMLElement).closest('[data-node],[data-badge],button,input,a');

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.button !== 0 && e.button !== 1) || !isBackground(e.target)) return;
    if (selectMode && !spaceMove && e.button === 0) { startMarquee(e); return; }
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    setPanning(true);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const nz = Math.min(2.5, Math.max(0.15, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    setPan({ x: cx - (cx - pan.x) * (nz / zoom), y: cy - (cy - pan.y) * (nz / zoom) });
    setZoom(nz);
  };

  // ---------------------------------------------------------------- adding machines
  /** Generator config for a recipe with the options picked on its search card. */
  const makeGen = useCallback((recipe: MachineRecipe, o: SelectOpts) => {
    if (!db) return undefined;
    let g = makeGenConfig(db, recipe, o.variantId);
    if (g && o.boostOn != null) g = { ...g, boostOn: o.boostOn };
    if (g && o.rotorId) g = { ...g, rotor: db.rotors.find((r) => r.id === o.rotorId) ?? g.rotor };
    return g;
  }, [db]);

  const handleSelectRecipe = (recipe: MachineRecipe, opts?: SelectOpts) => {
    if (!search) return;
    const anchor = nodes.find((n) => n.instanceId === search.nodeId);

    if (search.mode === 'change_recipe' && anchor) {
      const gen = makeGen(recipe, opts ?? {});
      const changed = { ...anchor, recipe, selectedTier: recipe.baseTier, targetRate: undefined, targetEUt: undefined, gen };
      const newInputs = nodeInputs(changed, machineStats(changed));
      setNodes((prev) => prev.map((n) => (n.instanceId === anchor.instanceId ? changed : n)));
      setConnections((prev) => prev.filter((c) =>
        (c.sourceInstanceId !== anchor.instanceId || recipe.outputs.some((o) => o.id === c.sourceItemId)) &&
        (c.targetInstanceId !== anchor.instanceId || newInputs.some((i) => i.id === c.targetItemId))));
      setSearch(null);
      return;
    }

    placeNewNode({
      instanceId: `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      recipe,
      selectedTier: recipe.baseTier,
      count: 1,
      countMode: manualCounts ? 'manual' : 'auto',
      x: 0,
      y: 0,
      isTarget: nodes.length === 0,
      gen: makeGen(recipe, opts ?? {}),
    });
  };

  /** Input node for an item, linked to the port it was requested from (if any). */
  const handleAddSupply = (item: RecipeItem) => {
    placeNewNode({
      instanceId: `supply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      recipe: makeSupplyRecipe(item),
      selectedTier: 'ULV',
      count: 1,
      x: 0,
      y: 0,
    });
  };

  /** Output node for an item: the line is built backwards from it (Best Route on the card). */
  const handleAddOutput = (item: RecipeItem) => {
    placeNewNode({
      instanceId: `output_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      recipe: makeOutputRecipe(item),
      selectedTier: 'ULV',
      count: 1,
      x: 0,
      y: 0,
      supplyLimit: item.unit === 'mB' ? 1000 : 1,
    });
  };

  // Price every item while the input picker is open, so Best Route is instant when clicked.
  const searchMode = search?.mode;
  const hasOutput = nodes.some(isOutput); // the Output card has a Best Route button too
  useEffect(() => {
    if ((searchMode !== 'input_supplier' && !hasOutput) || !db) return;
    const t = setTimeout(() => warmRouteCosts(db, maxTier), 400);
    return () => clearTimeout(t);
  }, [searchMode, hasOutput, db, maxTier]);

  /** Inputs of the search's node that nothing feeds yet (Best Route for all inputs). */
  const openInputs = (n: CanvasNode) => nodeInputs(n, machineStats(n)).filter((i) =>
    i.consumed !== false && !connections.some((c) => c.targetInstanceId === n.instanceId && c.targetItemId === i.id));

  /**
   * Best Route: plan the cheapest chain down to raw resources for one input (or every open
   * input) of the search's node, add it, then run Auto Ratio and Auto Sort on the result.
   */
  const handleBestRoute = (all: boolean) => {
    if (!search) return;
    const anchor = nodes.find((n) => n.instanceId === search.nodeId);
    if (!anchor) return;
    runBestRoute(anchor, all ? openInputs(anchor) : search.item ? [search.item] : []);
  };
  // Best Route button on an Output card: route its open input. Stable, so the cards stay memoised.
  const routeRef = useRef<(node: CanvasNode) => void>(() => {});
  routeRef.current = (node) => runBestRoute(node, openInputs(node));
  const onRoute = useCallback((node: CanvasNode) => routeRef.current(node), []);
  /** Input/Output node: switch to another type of the same item (Iron Ore on basalt instead of stone). */
  const onVariant = useCallback((node: CanvasNode, item: RecipeItem) => {
    if (viewingRef.current) return;
    const output = node.recipe.kind === 'output';
    const old = output ? node.recipe.inputs[0] : node.recipe.outputs[0];
    if (!old || old.id === item.id) return;
    setNodes((prev) => prev.map((n) => (n.instanceId === node.instanceId ? { ...n, recipe: output ? makeOutputRecipe(item) : makeSupplyRecipe(item) } : n)));
    setConnections((prev) => prev.map((c) => {
      if (!output && c.sourceInstanceId === node.instanceId && c.sourceItemId === old.id) return { ...c, sourceItemId: item.id };
      if (output && c.targetInstanceId === node.instanceId && c.targetItemId === old.id) return { ...c, targetItemId: item.id };
      return c;
    }));
  }, []);
  const runBestRoute = (anchor: CanvasNode, needs: RecipeItem[]) => {
    if (viewingRef.current) return; // view mode: nothing changes
    if (!db || !needs.length) return;
    const plan = planRoute(db, needs, maxTier);
    if (!plan.nodes.length) {
      setToast(`Best Route: no allowed recipe makes ${needs.map((i) => i.name).join(', ')} (max tier ${maxTier})`);
      setSearch(null);
      return;
    }
    const stamp = Date.now().toString(36);
    const ids = new Map(plan.nodes.map((p, k) => [p.key, `node_${stamp}_r${k}`]));
    // Rough spot left of the anchor, one column per step; Auto Sort tidies it up afterwards.
    const rows = new Map<number, number>();
    const added: CanvasNode[] = plan.nodes.map((p) => {
      const row = rows.get(p.depth) ?? 0;
      rows.set(p.depth, row + 1);
      return {
        instanceId: ids.get(p.key)!,
        recipe: p.recipe,
        selectedTier: p.recipe.baseTier,
        count: 1,
        countMode: manualCounts ? 'manual' : 'auto',
        x: anchor.x - p.depth * (NODE_WIDE + 240),
        y: anchor.y + row * 420,
      };
    });
    // Link the way Auto Connect does (each input to every new machine that makes it), so shared
    // intermediates and by-products are all wired in, not just the one route the plan followed.
    const group = [anchor, ...added];
    const neededIds = new Set(needs.map((i) => i.id));
    const links: Connection[] = [];
    const have = new Set(connections.map((c) => `${c.sourceInstanceId}|${c.sourceItemId}|${c.targetInstanceId}|${c.targetItemId}`));
    for (const target of group) {
      for (const inp of nodeInputs(target, machineStats(target))) {
        if (inp.consumed === false || (target === anchor && !neededIds.has(inp.id))) continue;
        const others = added.filter((x) => x !== target);
        const exact = others.filter((x) => x.recipe.outputs.some((o) => o.id === inp.id));
        for (const src of exact.length ? exact : others.filter((x) => x.recipe.outputs.some((o) => itemsMatch(o, inp)))) {
          const out = matchingOutput(src.recipe, inp)!;
          const key = `${src.instanceId}|${out.id}|${target.instanceId}|${inp.id}`;
          if (have.has(key)) continue;
          have.add(key);
          links.push({ id: `conn_${stamp}_r${links.length}`, sourceInstanceId: src.instanceId, sourceItemId: out.id, targetInstanceId: target.instanceId, targetItemId: inp.id });
        }
      }
    }
    const before = { nodes, connections };
    setNodes((prev) => [...prev, ...added]);
    setConnections((prev) => [...prev, ...links]);
    setSearch(null);
    const supply = plan.raw.filter((i) => !plan.missing.includes(i));
    const msg = `Best Route: added ${added.length} machine${added.length === 1 ? '' : 's'}`
      + (supply.length ? `. Supply yourself: ${supply.slice(0, 6).map((i) => i.name).join(', ')}${supply.length > 6 ? ` +${supply.length - 6} more` : ''}` : '')
      + (plan.missing.length ? `. No route for ${plan.missing.map((i) => i.name).join(', ')}` : '');
    setRouteStep({ stage: 1, msg, undo: () => { setNodes(before.nodes); setConnections(before.connections); }, ids: new Set([anchor.instanceId, ...added.map((n) => n.instanceId)]) });
  };

  /** Position a new node beside the port it was added from (or where it was dropped) and link it. */
  const placeNewNode = (draft: CanvasNode) => {
    if (viewingRef.current) return; // view mode: nothing changes
    if (!search) return;
    const anchor = nodes.find((n) => n.instanceId === search.nodeId);
    const recipe = draft.recipe;
    const id = draft.instanceId;
    let desired: { x: number; y: number };
    let conn: Connection | null = null;

    if (anchor && search.item && search.mode === 'input_supplier') {
      const out = matchingOutput(recipe, search.item);
      const sourceItemId = out?.id ?? search.item.id;
      desired = search.at ?? {
        x: anchor.x - widthOf(draft) - 240,
        y: portY(anchor, 'in', search.item.id) - estimatePortY(draft, 'out', sourceItemId),
      };
      if (out) conn = { id: `conn_${id}_${anchor.instanceId}_${search.item.id}`, sourceInstanceId: id, sourceItemId, targetInstanceId: anchor.instanceId, targetItemId: search.item.id };
    } else if (anchor && search.item && search.mode === 'output_consumer') {
      const inp = matchingInput(nodeInputs(draft, machineStats(draft)), search.item);
      const targetItemId = inp?.id ?? search.item.id;
      desired = search.at ?? {
        x: anchor.x + rectOf(anchor).w + 240,
        y: portY(anchor, 'out', search.item.id) - estimatePortY(draft, 'in', targetItemId),
      };
      if (inp) conn = { id: `conn_${anchor.instanceId}_${id}_${search.item.id}`, sourceInstanceId: anchor.instanceId, sourceItemId: search.item.id, targetInstanceId: id, targetItemId };
    } else if (search.at) {
      desired = search.at;
    } else {
      const r = canvasRef.current?.getBoundingClientRect();
      const c = toWorld((r?.left ?? 0) + (r?.width ?? 800) / 2, (r?.top ?? 0) + (r?.height ?? 600) / 2);
      desired = { x: c.x - widthOf(draft) / 2, y: c.y - 160 };
    }

    const size = { w: widthOf(draft), h: estimateHeight(draft) };
    const pos = nearestFree({ ...desired, ...size }, nodes.map((n) => rectOf(n)), NODE_GAP);
    setNodes((prev) => [...prev, { ...draft, ...pos }]);
    if (conn) setConnections((prev) => [...prev, conn!]);
    // Fed from an existing output: offer to size the new machine to use all the spare supply.
    if (conn && search.mode === 'output_consumer' && anchor) setAllocPrompt({ nodeId: id, sourceId: anchor.instanceId, itemId: conn.sourceItemId, inputId: conn.targetItemId });
    if (isSupply(draft)) setLinkPrompt(id);
    setSearch(null);
  };

  // ---------------------------------------------------------------- toolbar actions
  /**
   * Pick every machine's tier, then let counts follow demand.
   *  - Max Efficiency: base tier (each overclock doubles the energy per craft).
   *  - Min Machines: overclock wherever it saves whole machines, best machines-saved per
   *    extra EU/t first, while the total stays inside the EU/t budget.
   *  - Balanced: the same greedy order, but it stops after spending a third of the extra
   *    EU/t Min Machines would use. The best savings come first, so this keeps most of the
   *    machine reduction for a fraction of the power.
   * Overclocking doesn't change what a craft makes, so demand (crafts/s) stays put and each
   * tier's machine count follows directly from the current solve.
   */
  const handleAutoRatio = (quiet = false) => {
    if (viewingRef.current) return; // view mode: nothing changes
    type Option = { tier: VoltageTier; count: number; eu: number; multi?: MultiConfig };
    // Parallel hatches you can make: IV 4x, LuV 16x, ZPM 64x, UV 256x, up to the max tier.
    const allowedParallels = [['IV', 4], ['LuV', 16], ['ZPM', 64], ['UV', 256]]
      .filter(([t]) => TIER_ORDER.indexOf(t as VoltageTier) <= TIER_ORDER.indexOf(maxTier))
      .map(([, p]) => p as number);
    const plans = new Map<string, Option[]>();
    // Always Running: the target's machines run flat out (whole machines at full speed) and
    // everything upstream is sized to keep them fed. Flows scale linearly with the target.
    const target = nodes.find((n) => n.isTarget);
    // Manual counts cap what each machine makes; size from what the line asks for instead.
    const demand = manualCounts
      ? solveFlows(nodes.map((n) => (isPort(n) ? n : { ...n, countMode: 'auto' as const })), connections)
      : flows;
    let scale = 1;
    let targetUpdate: Partial<CanvasNode> | null = null;
    if (alwaysRunning && target) {
      const tf = demand.nodes.get(target.instanceId);
      const ts = machineStats(target);
      if (tf && tf.cyclesPerSec > 0) {
        const count = Math.max(1, Math.ceil(tf.machinesNeeded - 1e-6));
        const fullCycles = count / ts.durationSec;
        scale = fullCycles / tf.cyclesPerSec;
        if (target.recipe.generatesEU) targetUpdate = { targetEUt: count * ts.eutPerMachine, targetRate: undefined };
        else {
          const out = target.recipe.outputs.find((o) => o.id === (target.targetRate?.itemId ?? target.recipe.outputs[0]?.id));
          if (out) targetUpdate = { targetRate: { itemId: out.id, perSec: fullCycles * perCycleOf(target.recipe.outputs, out.id, ts) }, targetEUt: undefined };
        }
      }
    }
    for (const n of nodes) {
      if (isPort(n)) continue;
      if (targetUpdate && n.isTarget) continue; // Always Running keeps the target's own tier
      if (n.setupLocked) continue; // locked: keep its tier and machine type
      const f = demand.nodes.get(n.instanceId);
      const stats = machineStats(n);
      if (!f || stats.tierLocked || (n.gen && n.gen.kind !== 'single')) continue;
      if (f.idle) continue; // unused: keep its setup rather than dropping it to the cheapest
      const base = TIER_ORDER.indexOf(n.recipe.baseTier);
      const top = Math.max(base, Math.min(n.gen?.maxTier ? TIER_ORDER.indexOf(n.gen.maxTier) : TIER_ORDER.indexOf('UHV'), TIER_ORDER.indexOf(maxTier)));
      const work = f.cyclesPerSec * stats.parallel * scale; // crafts/s x parallels: fixed by demand
      // Machine setups to consider: the current one, or (with "Use large machines") the basic
      // machine plus every multiblock that runs this recipe, with each allowed parallel hatch.
      const variants = (useLargeMachines && !n.recipe.generatesEU && n.recipe.machineId ? db?.machineVariants[n.recipe.machineId] ?? [] : [])
        .filter((v) => !disabledMultis.has(v.id)); // turned off in Auto Ratio settings
      const setups: (MultiConfig | undefined)[] = useLargeMachines ? [undefined] : [n.multi];
      for (const v of variants) {
        // The machine's own multiblock without a hatch is the plain machine, already in the list.
        const hatches = v.parallel && parallelAccess ? allowedParallels : [1];
        for (const p of v.self ? hatches.filter((x) => x > 1) : hatches) setups.push({ variantId: v.id, name: v.name, parallel: p });
      }
      const all: Option[] = [];
      for (const multi of setups) {
        for (let t = base; t <= top; t++) {
          // A parallel hatch only helps if the energy hatch tier can power all the parallels.
          if (multi && multi.parallel > 1 && multi.parallel * n.recipe.baseEUt > TIERS[TIER_ORDER[t]].voltage) continue;
          const st = machineStats({ ...n, selectedTier: TIER_ORDER[t], multi });
          const needed = (work / st.parallel) * st.durationSec;
          const count = needed > 1e-9 ? Math.max(1, Math.ceil(needed - 1e-6)) : 0;
          all.push({ tier: TIER_ORDER[t], count, eu: n.recipe.generatesEU ? 0 : st.eutPerMachine * needed, multi });
        }
      }
      // Keep the trade-off curve: cheapest first, each later option building fewer machines.
      all.sort((a, b) => a.eu - b.eu || a.count - b.count || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
      const options: Option[] = [];
      for (const o of all) if (!options.length || o.count < options[options.length - 1].count) options.push(o);
      plans.set(n.instanceId, options);
    }
    let baseTotal = [...plans.values()].reduce((a, p) => a + p[0].eu, 0);
    for (const n of nodes) if (!plans.has(n.instanceId) && !n.recipe.generatesEU) baseTotal += (demand.nodes.get(n.instanceId)?.eutAvg ?? 0) * scale;
    /** Greedy: repeatedly take the upgrade saving the most machines per extra EU/t. */
    const greedy = (limit: number) => {
      const at = new Map([...plans.keys()].map((id) => [id, 0]));
      let total = baseTotal;
      for (;;) {
        let best: { id: string; to: number; ratio: number; dEu: number } | null = null;
        for (const [id, p] of plans) {
          const cur = p[at.get(id)!];
          for (let k = at.get(id)! + 1; k < p.length; k++) {
            const saved = cur.count - p[k].count;
            const dEu = Math.max(0, p[k].eu - cur.eu);
            if (total + dEu > limit) continue;
            const ratio = saved / (dEu + 1e-9);
            if (!best || ratio > best.ratio) best = { id, to: k, ratio, dEu };
          }
        }
        if (!best) break;
        at.set(best.id, best.to);
        total += best.dEu;
      }
      return { at, total };
    };
    const budgetLimit = effectiveBudget;
    let chosen = new Map([...plans.keys()].map((id) => [id, 0]));
    if (autoMode === 'compact') chosen = greedy(budgetLimit).at;
    if (autoMode === 'balanced') {
      const full = greedy(budgetLimit).total;
      chosen = greedy(baseTotal + (full - baseTotal) / 3).at;
    }
    const before = nodes;
    setNodes((prev) => prev.map((n) => {
      if (isPort(n)) return n;
      const p = plans.get(n.instanceId);
      const pick = p?.[chosen.get(n.instanceId) ?? 0];
      const tierChange: Partial<CanvasNode> = { selectedTier: pick ? pick.tier : n.selectedTier, countMode: 'auto', ...(pick ? { multi: pick.multi } : {}) };
      // Manual counts: write the sized count in (end-of-line machines keep the count you set).
      const f = demand.nodes.get(n.instanceId);
      if (manualCounts && f && !f.isSink) {
        const needed = f.machinesNeeded * scale;
        Object.assign(tierChange, { countMode: 'manual', count: pick ? pick.count : f.idle ? n.count : Math.max(needed > 1e-9 ? 1 : 0, Math.ceil(needed - 1e-6)) });
      }
      return n.isTarget && targetUpdate ? { ...n, ...tierChange, ...targetUpdate } : { ...n, ...tierChange };
    }));
    const label = autoMode === 'efficient' ? 'Max Efficiency' : autoMode === 'balanced' ? 'Balanced' : 'Min Machines';
    const overBudget = autoMode !== 'efficient' && Number.isFinite(effectiveBudget) && baseTotal > effectiveBudget;
    const running = targetUpdate ? ' · Always Running' : '';
    if (quiet && !overBudget) return; // locked on: rerun silently after each change
    setToast(
      overBudget
        ? `Auto Ratio (${label}${running}): even at base tiers this line draws ${formatEU(baseTotal)}, over the ${compact(budget)} budget, so nothing was overclocked. Raise the budget or turn it off.`
        : `Auto Ratio (${label}${running})${autoMode !== 'efficient' && Number.isFinite(effectiveBudget) ? ` within ${formatEU(budget)}` : ''}`,
      () => setNodes(before),
    );
  };

  /** Manual machine counts on or off. The open flow switches too, so nothing jumps. */
  /**
   * Manual counts on: the open flow's counts are pinned as they are, so nothing jumps. Off: the
   * counts still stay put (new machines follow demand); Auto Ratio hands everything back to demand.
   */
  const toggleManualCounts = (on: boolean) => {
    setManualCounts(on);
    if (on) setAutoLock(false); // the lock would resize everything after each change
    if (viewingRef.current) return;
    if (!on) { setToast('Manual counts off: new machines follow demand. Click Auto Ratio to resize the rest.'); return; }
    const before = nodes;
    let changed = false;
    const next = nodes.map((n) => {
      const f = flows.nodes.get(n.instanceId);
      if (isPort(n) || !f || f.isSink || n.countMode === 'manual') return n; // end-of-line machines already keep their count
      changed = true;
      return { ...n, countMode: 'manual' as const, count: f.machines };
    });
    if (changed) setNodes(next);
    setToast('Manual machine counts: new machines start at 1 and keep the count you set. Auto Ratio sizes them when you click it.', changed ? () => setNodes(before) : undefined);
  };

  // Locked Auto Ratio: after machines or links change (not tiers or counts, which it sets
  // itself, so it can't loop), rerun it once the solve has caught up.
  const autoRatioRef = useRef(handleAutoRatio);
  autoRatioRef.current = handleAutoRatio;
  const structure = useMemo(() => `${nodes.map((n) => `${n.instanceId}:${n.recipe.id}`).join(',')}|${connections.map((c) => c.id).join(',')}`, [nodes, connections]);
  const lastStructure = useRef<string | null>(null);
  const lastSaveId = useRef(currentSave?.id);
  useEffect(() => {
    // Opening another flow isn't an edit: leave it as it was saved.
    const switched = lastSaveId.current !== currentSave?.id;
    lastSaveId.current = currentSave?.id;
    if (switched || viewFlow || !autoLock || manualCounts || !db || !nodes.length) { lastStructure.current = structure; return; }
    if (lastStructure.current === structure) return;
    lastStructure.current = structure;
    const t = setTimeout(() => autoRatioRef.current(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, autoLock, manualCounts, db, currentSave?.id, viewFlow]);

  /**
   * Tidy the canvas into columns: each machine goes one column right of whatever feeds it
   * (loops are broken where the wire runs backwards today), columns are ordered by their
   * neighbours so wires cross less, and rows line up with the machines they're wired to.
   */
  const handleAutoSort = () => {
    if (viewingRef.current) return; // view mode: nothing changes
    if (!nodes.length) return;
    const m = measured;
    const ids = nodes.map((n) => n.instanceId);
    const byId = new Map(nodes.map((n) => [n.instanceId, n]));
    const outs = new Map<string, string[]>(ids.map((id) => [id, []]));
    const ins = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const c of connections) {
      if (!byId.has(c.sourceInstanceId) || !byId.has(c.targetInstanceId) || c.sourceInstanceId === c.targetInstanceId) continue;
      outs.get(c.sourceInstanceId)!.push(c.targetInstanceId);
      ins.get(c.targetInstanceId)!.push(c.sourceInstanceId);
    }
    // Break cycles with a DFS visiting nodes left to right; back edges are ignored.
    const state = new Map<string, 0 | 1 | 2>();
    const back = new Set<string>();
    const order = [...ids].sort((a, b) => byId.get(a)!.x - byId.get(b)!.x);
    const visit = (id: string) => {
      state.set(id, 1);
      for (const t of outs.get(id)!) {
        if (state.get(t) === 1) back.add(`${id}>${t}`);
        else if (!state.get(t)) visit(t);
      }
      state.set(id, 2);
    };
    for (const id of order) if (!state.get(id)) visit(id);
    const fwdIns = (id: string) => ins.get(id)!.filter((s) => !back.has(`${s}>${id}`));
    const fwdOuts = (id: string) => outs.get(id)!.filter((t) => !back.has(`${id}>${t}`));
    // Longest path from the sources gives each node's column.
    const layer = new Map<string, number>();
    const layerOf = (id: string): number => {
      if (layer.has(id)) return layer.get(id)!;
      layer.set(id, 0);
      const l = Math.max(0, ...fwdIns(id).map((s) => layerOf(s) + 1));
      layer.set(id, l);
      return l;
    };
    ids.forEach(layerOf);
    // Pull suppliers right so they sit just before the first machine they feed.
    for (let pass = 0; pass < 3; pass++) {
      for (const id of [...ids].sort((a, b) => layer.get(b)! - layer.get(a)!)) {
        const targets = fwdOuts(id);
        if (targets.length) layer.set(id, Math.max(layer.get(id)!, Math.min(...targets.map((t) => layer.get(t)!)) - 1));
      }
    }
    // Compact: stack a node above the machine it feeds, in that machine's column, when it's
    // just one step into it: its only output goes to that machine, and either it has no
    // inputs of its own (a raw input / simple supplier) or that machine has no other feeder
    // (a straight chain such as ore -> crushed -> impure dust -> dust).
    const uniq = (a: string[]) => [...new Set(a)];
    const stackOn = new Map<string, string>();
    for (const id of ids) {
      const t = uniq(fwdOuts(id));
      if (t.length !== 1) continue;
      if (fwdIns(id).length === 0 || uniq(fwdIns(t[0])).length === 1) stackOn.set(id, t[0]);
    }
    const rootOf = (id: string) => {
      let r = id;
      for (let i = 0; i < ids.length && stackOn.has(r); i++) r = stackOn.get(r)!;
      return r;
    };
    /** A stacked block, top to bottom: everything stacked onto `root`, then the root itself. */
    const blockOf = (root: string): string[] => [...ids.filter((x) => stackOn.get(x) === root).flatMap(blockOf), root];
    const columns: string[][] = [];
    for (const id of ids) if (rootOf(id) === id) (columns[layer.get(id)!] ??= []).push(id);
    const cols = columns.filter(Boolean).map((col) => col.sort((a, b) => byId.get(a)!.y - byId.get(b)!.y));
    // Order within columns by the average position of neighbours (a few sweeps both ways).
    const posInCol = () => {
      const p = new Map<string, number>();
      // Stacked members share their root's position.
      for (const col of cols) col.forEach((id, i) => { for (const mId of blockOf(id)) p.set(mId, i / Math.max(1, col.length - 1)); });
      return p;
    };
    for (let sweep = 0; sweep < 4; sweep++) {
      const p = posInCol();
      for (const col of cols) {
        const key = (id: string) => {
          const nb = sweep % 2 === 0 ? ins.get(id)! : outs.get(id)!;
          return nb.length ? nb.reduce((a, x) => a + p.get(x)!, 0) / nb.length : p.get(id)!;
        };
        col.sort((a, b) => key(a) - key(b));
      }
    }
    const size = (id: string) => ({ w: m[id]?.w ?? widthOf(byId.get(id)!), h: m[id]?.h ?? estimateHeight(byId.get(id)!) });
    // Columns need room for the rate panels only when flow labels are shown.
    const COL_GAP = showLabels ? BADGE_W + 140 : 140;
    const top = Math.min(...nodes.map((n) => n.y));
    let x = Math.min(...nodes.map((n) => n.x));
    const placed = new Map<string, { x: number; y: number }>();
    for (const col of cols) {
      const blocks = col.map(blockOf);
      const width = Math.max(...blocks.flat().map((id) => size(id).w));
      // Rows: aim each block's root at the middle of the already-placed machines feeding it;
      // whatever is stacked onto it sits directly above.
      let y = top;
      for (const block of blocks) {
        const root = block[block.length - 1];
        const feeders = block.flatMap((id) => ins.get(id)!).filter((s) => placed.has(s) && !block.includes(s));
        const above = block.slice(0, -1).reduce((a, id) => a + size(id).h + NODE_GAP, 0);
        const want = feeders.length ? feeders.reduce((a, s) => a + placed.get(s)!.y + size(s).h / 2, 0) / feeders.length - size(root).h / 2 - above : null;
        let by = Math.max(y, want ?? y);
        for (const id of block) {
          placed.set(id, { x: x + (width - size(id).w) / 2, y: by });
          by += size(id).h + NODE_GAP;
        }
        y = by;
      }
      x += width + COL_GAP;
    }
    const before = nodes;
    setNodes((prev) => prev.map((n) => (placed.has(n.instanceId) ? { ...n, ...placed.get(n.instanceId)! } : n)));
    setToast(`Sorted ${nodes.length} nodes into ${cols.length} column${cols.length === 1 ? '' : 's'}`, () => setNodes(before));
  };

  useEffect(() => {
    if (!routeStep) return;
    if (routeStep.stage === 1) {
      handleAutoRatio();
      setRouteStep({ ...routeStep, stage: 2 });
    } else if (routeStep.stage === 2) {
      setRouteStep({ ...routeStep, stage: 3 }); // one more render so the new cards' sizes are measured
    } else if (routeStep.stage === 3) {
      handleAutoSort();
      setRouteStep({ ...routeStep, stage: 4 });
    } else {
      fitNodes(routeStep.ids); // positions from Auto Sort are in place now
      setToast(routeStep.msg, routeStep.undo);
      setRouteStep(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStep]);

  /**
   * Rebuild every route from scratch: each input is linked to every machine on the canvas
   * that makes it (exact item first, tag matches only if nothing makes the exact item).
   * The solver then shares demand between them, using byproducts before dedicated suppliers.
   */
  const handleAutoConnect = () => {
    if (viewingRef.current) return; // view mode: nothing changes
    const next: Connection[] = [];
    for (const target of nodes) {
      if (isSupply(target)) continue;
      for (const inp of nodeInputs(target, machineStats(target))) {
        if (inp.consumed === false) continue;
        const others = nodes.filter((s) => s.instanceId !== target.instanceId);
        const exact = others.filter((s) => s.recipe.outputs.some((o) => o.id === inp.id));
        const suppliers = exact.length ? exact : others.filter((s) => s.recipe.outputs.some((o) => itemsMatch(o, inp)));
        for (const s of suppliers) {
          const out = matchingOutput(s.recipe, inp)!;
          next.push({ id: `conn_${s.instanceId}_${target.instanceId}_${inp.id}`, sourceInstanceId: s.instanceId, sourceItemId: out.id, targetInstanceId: target.instanceId, targetItemId: inp.id });
        }
      }
    }
    const prev = connections;
    setConnections(next);
    setToast(`Auto Connect: ${next.length} route${next.length === 1 ? '' : 's'} (replaced ${prev.length})`, () => setConnections(prev));
  };

  // ---------------------------------------------------------------- selection actions
  const selNodes = () => nodes.filter((n) => selected.has(n.instanceId));
  /** Set every selected machine to one tier (never below its recipe's base tier). */
  const bulkTier = (tier: VoltageTier) => {
    const before = nodes;
    let changed = 0;
    setNodes((prev) => prev.map((n) => {
      if (!selected.has(n.instanceId) || isPort(n) || (n.gen && n.gen.kind !== 'single')) return n;
      const t = TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(n.recipe.baseTier) ? n.recipe.baseTier : tier;
      changed++;
      return { ...n, selectedTier: t };
    }));
    setToast(`Set ${changed} machine${changed === 1 ? '' : 's'} to ${tier} (or their base tier)`, () => setNodes(before));
  };
  /** Multiply the selected machines' counts and pin them. */
  const bulkMultiply = (k: number) => {
    const before = nodes;
    setNodes((prev) => prev.map((n) => {
      if (!selected.has(n.instanceId) || isPort(n)) return n;
      const now = flows.nodes.get(n.instanceId)?.machines ?? n.count;
      return { ...n, count: Math.max(1, Math.round(now * k)), countMode: 'manual' };
    }));
    setToast(`Counts x${k} (pinned)`, () => setNodes(before));
  };
  /** Auto Connect, but only between selected cards; links that already exist stay. */
  const bulkConnect = () => {
    const sel = selNodes();
    const have = new Set(connections.map((c) => `${c.sourceInstanceId}|${c.sourceItemId}|${c.targetInstanceId}|${c.targetItemId}`));
    const added: Connection[] = [];
    for (const target of sel) {
      if (isSupply(target)) continue;
      for (const inp of nodeInputs(target, machineStats(target))) {
        if (inp.consumed === false) continue;
        const others = sel.filter((x) => x.instanceId !== target.instanceId);
        const exact = others.filter((x) => x.recipe.outputs.some((o) => o.id === inp.id));
        for (const src of exact.length ? exact : others.filter((x) => x.recipe.outputs.some((o) => itemsMatch(o, inp)))) {
          const out = matchingOutput(src.recipe, inp)!;
          const key = `${src.instanceId}|${out.id}|${target.instanceId}|${inp.id}`;
          if (have.has(key)) continue;
          have.add(key);
          added.push({ id: `conn_${src.instanceId}_${target.instanceId}_${inp.id}`, sourceInstanceId: src.instanceId, sourceItemId: out.id, targetInstanceId: target.instanceId, targetItemId: inp.id });
        }
      }
    }
    if (!added.length) { setToast('Nothing new to link between the selected machines'); return; }
    const before = connections;
    setConnections((prev) => [...prev, ...added]);
    setToast(`Linked ${added.length} route${added.length === 1 ? '' : 's'} between selected machines`, () => setConnections(before));
  };
  /**
   * Max flow for the selection: each selected machine is pinned to the most machines its
   * linked inputs can keep fed (what it gets now plus its suppliers' spare output).
   */
  const bulkMaxFlow = () => {
    const before = nodes;
    const updates = new Map<string, number>();
    for (const n of selNodes()) {
      const f = flows.nodes.get(n.instanceId);
      if (isPort(n) || !f || f.cyclesPerSec <= 0) continue;
      let ratio = Infinity;
      for (const [itemId, rate] of Object.entries(f.inputRates)) {
        const links = connections.filter((c) => c.targetInstanceId === n.instanceId && c.targetItemId === itemId);
        if (!links.length || rate <= 0) continue;
        let avail = 0;
        for (const c of links) {
          const got = flows.connections.get(c.id)?.needed ?? 0;
          const made = flows.nodes.get(c.sourceInstanceId)?.outputRates[c.sourceItemId] ?? 0;
          const sent = connections.filter((x) => x.sourceInstanceId === c.sourceInstanceId && x.sourceItemId === c.sourceItemId)
            .reduce((acc, x) => acc + (flows.connections.get(x.id)?.needed ?? 0), 0);
          avail += got + Math.max(0, made - sent);
        }
        ratio = Math.min(ratio, avail / rate);
      }
      if (!Number.isFinite(ratio)) continue;
      updates.set(n.instanceId, Math.max(1, Math.floor(f.machinesNeeded * ratio + 1e-6)));
    }
    if (!updates.size) { setToast('Select machines with linked inputs to max them out'); return; }
    setNodes((prev) => prev.map((n) => (updates.has(n.instanceId) ? { ...n, count: updates.get(n.instanceId)!, countMode: 'manual' } : n)));
    setToast(`Maxed ${updates.size} machine${updates.size === 1 ? '' : 's'} to their available supply (counts pinned)`, () => setNodes(before));
  };
  const bulkDelete = () => {
    if (!selected.size) return;
    const before = { nodes, connections };
    const gone = selected;
    clearTimeout(hoverTimer.current); hoverNow.current = null; setHover(null);
    setNodes((prev) => prev.filter((n) => !gone.has(n.instanceId)));
    setConnections((prev) => prev.filter((c) => !gone.has(c.sourceInstanceId) && !gone.has(c.targetInstanceId)));
    setSelected(new Set());
    setToast(`Deleted ${gone.size} node${gone.size === 1 ? '' : 's'}`, () => { setNodes(before.nodes); setConnections(before.connections); });
  };
  /** Copy the selected cards and the links between them (kept in this browser). */
  const copySelection = () => {
    const sel = selNodes();
    if (!sel.length) return false;
    const ids = new Set(sel.map((n) => n.instanceId));
    const clip = { nodes: sel, connections: connections.filter((c) => ids.has(c.sourceInstanceId) && ids.has(c.targetInstanceId)) };
    writePref('gt_calc_clipboard', JSON.stringify(clip));
    setToast(`Copied ${sel.length} node${sel.length === 1 ? '' : 's'}`);
    return true;
  };
  /** Paste copied cards beside the originals (new ids, never a second target), selected. */
  const pasteSelection = () => {
    let clip: { nodes: CanvasNode[]; connections: Connection[] } | null = null;
    try { clip = cleanFlow(JSON.parse(localStorage.getItem('gt_calc_clipboard') || 'null')); } catch { clip = null; }
    if (!clip?.nodes?.length) return;
    const stamp = Date.now().toString(36);
    const ids = new Map(clip.nodes.map((n, k) => [n.instanceId, `${isSupply(n) ? 'supply' : 'node'}_${stamp}_p${k}`]));
    const minX = Math.min(...clip.nodes.map((n) => n.x));
    const maxX = Math.max(...clip.nodes.map((n) => n.x + rectOf(n).w));
    const dx = maxX - minX + 120;
    const added = clip.nodes.map((n) => ({ ...n, instanceId: ids.get(n.instanceId)!, x: n.x + dx, y: n.y + 40, isTarget: false, targetRate: undefined, targetEUt: undefined }));
    const links = clip.connections.map((c, k) => ({ ...c, id: `conn_${stamp}_p${k}`, sourceInstanceId: ids.get(c.sourceInstanceId)!, targetInstanceId: ids.get(c.targetInstanceId)! }));
    const before = { nodes, connections };
    setNodes((prev) => [...prev, ...added]);
    setConnections((prev) => [...prev, ...links]);
    setSelected(new Set(added.map((n) => n.instanceId)));
    setToast(`Pasted ${added.length} node${added.length === 1 ? '' : 's'}`, () => { setNodes(before.nodes); setConnections(before.connections); });
  };
  // Selected cards that were deleted some other way drop out of the selection.
  useEffect(() => {
    if (!selected.size) return;
    const present = new Set(nodes.map((n) => n.instanceId));
    if ([...selected].some((id) => !present.has(id))) setSelected(new Set([...selected].filter((id) => present.has(id))));
  }, [nodes, selected]);
  const selectionKeys = useRef({ bulkDelete, copySelection, pasteSelection });
  selectionKeys.current = { bulkDelete, copySelection, pasteSelection };

  // ---------------------------------------------------------------- community
  /** Share the open flow: needs an account, so log in first when there isn't one. */
  const handleShare = (entry?: SavedFlow) => {
    const item = entry
      ? { id: entry.id, name: entry.name, flow: { nodes: entry.nodes, connections: entry.connections, targetEUtBudget: entry.targetEUtBudget } }
      : { id: currentSave?.id, name: currentSave?.name ?? 'My flow', flow: { nodes, connections, targetEUtBudget: budget } };
    if (item.id && sharedFlowIds.has(item.id)) { setToast(`"${item.name}" is already shared. Open Community to see it`); return; }
    const origin = entry ? entry.origin : currentOrigin;
    if (origin?.example) { setToast('Example flows can\'t be shared. Make your own version from scratch to share it'); return; }
    if (origin && (!user || origin.authorId !== user.uid)) { setToast(`This flow was made by ${origin.author}, so only they can share it`); return; }
    if (!item.flow.nodes.length) { setToast('Add some machines before sharing a flow'); return; }
    if (!user) { setAuthPrompt({ reason: 'An account is needed to share flows.', then: () => setShareFlow(item) }); return; }
    setShareFlow(item);
  };
  /** Open a shared flow on the canvas to look at (nothing is copied, saved or editable). */
  const openView = (b: Build) => {
    if (viewFlow) return;
    const fresh = (db ? refreshFromDatabase(b.flow.nodes, b.flow.connections, db) : null) ?? { nodes: b.flow.nodes, connections: b.flow.connections };
    history.current.skip = true;
    setViewFlow({ build: b, stash: { nodes, connections } });
    setNodes(fresh.nodes);
    setConnections(fresh.connections);
    setSelected(new Set());
    setSelectMode(false);
    setSidebarOpen(false);
    setSearch(null);
    setPage('canvas');
    setFitTick((t) => t + 1);
  };
  /** Back to the user's own flow, exactly as it was. */
  const exitView = () => {
    if (!viewFlow) return;
    history.current.skip = true;
    setNodes(viewFlow.stash.nodes);
    setConnections(viewFlow.stash.connections);
    setViewFlow(null);
    setFitTick((t) => t + 1);
  };
  // Anything that leaves view mode for somewhere else runs once the user's flow is back.
  const afterView = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (viewFlow || !afterView.current) return;
    const run = afterView.current;
    afterView.current = null;
    run();
  }, [viewFlow]);
  const leaveViewThen = (run: () => void) => { if (!viewFlow) return false; afterView.current = run; exitView(); return true; };
  const navRef = useRef<{ load: (e: SavedFlow) => void; fresh: () => void; copy: (b: Build) => void }>(null!);

  /** Header Share: a link to the open flow. Already shared: copy it; otherwise share it first. */
  const copyLink = (id: string, name: string, fresh = false) => {
    const url = flowLink(id);
    const said = fresh ? `Shared "${name}" to Community` : `Link to "${name}"`;
    navigator.clipboard.writeText(url).then(
      () => setToast(`${said}: link copied${fresh ? '' : ' (it shows the version you shared)'}`),
      () => setToast(`${said}: ${url}`),
    );
  };
  const handleShareLink = () => {
    const built = currentSave ? sharedFlowIds.get(currentSave.id) : undefined;
    if (built) { copyLink(built, currentSave!.name); return; }
    handleShare();
  };
  /** Copy a community build into Saves and open it on the canvas. */
  /** Your own saved flow behind a build you shared: opening it edits that flow instead of copying it. */
  const ownSaveFor = (b: Build) => (user && b.authorId === user.uid ? saves.find((s) => sharedBuilds.get(s.id)?.id === b.id) : undefined);
  const editOrCopy = (b: Build) => { const own = ownSaveFor(b); if (own) handleLoadSave(own); else openBuild(b); };
  const openBuild = (b: Build) => {
    if (leaveViewThen(() => navRef.current.copy(b))) return;
    const list = loadSaves();
    const taken = new Set(list.map((x) => x.name.toLowerCase()));
    let name = b.name.slice(0, 64);
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${b.name.slice(0, 58)} (${k})`;
    // Remember who made it (or the build's own recorded creator), so it can't be re-shared as new.
    const carried = (b.flow as { origin?: FlowOrigin }).origin;
    const origin: FlowOrigin = carried ?? (b.example ? { author: b.author, example: true, buildId: b.id } : { author: b.author, authorId: b.authorId, buildId: b.id });
    const entry: SavedFlow = { id: `flow_${Date.now().toString(36)}`, name, savedAt: Date.now(), nodes: b.flow.nodes, connections: b.flow.connections, targetEUtBudget: b.flow.targetEUtBudget, origin };
    if (!persistSaves([entry, ...list])) return;
    void recordCopy(b); // the flow's copy count
    setPage('canvas');
    confirmLeave(`open "${name}"`, () => openSave(entry));
  };
  const showError = useCallback((m: string) => setToast(m), [setToast]);
  useEffect(() => { navRef.current = { load: handleLoadSave, fresh: handleNewFlow, copy: openBuild }; });
  // Examples live on the server like any shared flow (scripts/seed-examples.mts), so they can be
  // voted on and commented on. Without the server they're made here from the recipes instead.
  useEffect(() => {
    if (communityEnabled || page !== 'builds' || !db) return;
    if (examples.length) return;
    const t = setTimeout(() => setExamples(makeExamples(db, PACK)), 50);
    return () => clearTimeout(t);
  }, [page, db, examples.length]);

  // Saved flows sync: while logged in, changes go to the server every 30s. On login, flows on the
  // server and in this browser are merged (the newer copy of each wins).
  useEffect(() => {
    primeSaves(loadSaves());
  }, []);
  const userId = user?.uid;
  // Logging in or out while viewing a shared flow brings the user's own flow back first.
  const viewUser = useRef(userId);
  useEffect(() => {
    if (viewUser.current === userId) return;
    viewUser.current = userId;
    if (viewingRef.current) exitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  // Which saved flows this user has shared (live), to show "Shared" and prevent duplicates.
  useEffect(() => {
    if (!userId || !communityEnabled) { setSharedFlowIds(new Map()); setSharedBuilds(new Map()); return; }
    return subscribeBuilds(PACK, (list) => {
      setMyBuilds(list.filter((b) => b.authorId === userId));
      const mine = list.filter((b) => b.authorId === userId && b.sourceFlowId);
      setSharedFlowIds(new Map(mine.map((b) => [b.sourceFlowId!, b.id])));
      setSharedBuilds(new Map(mine.map((b) => [b.sourceFlowId!, b])));
    });
  }, [userId]);
  // Logging out clears that account's server-backed flows from this browser (they're safe on the
  // server), so the next person on a shared computer doesn't see or inherit them.
  const lastUser = useRef<string | undefined>(userId);
  useEffect(() => {
    const prev = lastUser.current;
    lastUser.current = userId;
    if (!prev || userId) return;
    const gone = takeSynced(prev);
    if (!gone.size) return;
    const keep = loadSaves().filter((f) => !gone.has(f.id));
    primeSaves(keep);
    if (writeSaves(keep)) setSaves(keep);
    if (currentSave && gone.has(currentSave.id)) { setNodes([]); setConnections([]); setCurrentSave(null); setSavedSnapshot(null); }
    setToast('Logged out. Your synced flows were removed from this browser (they\'re safe in your account)');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    if (!userId) { setSyncAdapter(null); return; }
    let cancelled = false;
    setSyncAdapter({ push: (flows, gone) => pushFlows(flows.map((f) => ({ ...(f as SavedFlow), pack: PACK })), gone) }, userId);
    fetchFlows(PACK).then((cloud) => {
      if (cancelled) return;
      // Flows deleted in this browser stay deleted (and are removed from the server too).
      const graves = tombstones();
      const dead = cloud.filter((c) => graves.has(c.id)).map((c) => c.id);
      if (dead.length) queueDeletes(dead);
      cloud = cloud.filter((c) => !graves.has(c.id));
      markSynced(userId, cloud.map((c) => c.id));
      const local = loadSaves();
      const byId = new Map(local.map((f) => [f.id, f]));
      let merged = [...local];
      for (const c of cloud) {
        const mine = byId.get(c.id);
        if (!mine) merged.push({ id: c.id, name: c.name, savedAt: c.savedAt, nodes: c.nodes, connections: c.connections, targetEUtBudget: c.targetEUtBudget, ...(c.draft ? { draft: true } : {}), ...(c.origin ? { origin: c.origin } : {}) });
        else if (c.savedAt > mine.savedAt) merged = merged.map((f) => (f.id === c.id ? { ...f, name: c.name, savedAt: c.savedAt, nodes: c.nodes, connections: c.connections, targetEUtBudget: c.targetEUtBudget, draft: c.draft, origin: c.origin ?? f.origin } : f));
      }
      const cloudIds = new Map(cloud.map((c) => [c.id, c.savedAt]));
      queueFlows(merged.filter((f) => (cloudIds.get(f.id) ?? -1) < f.savedAt)); // local-only or newer here
      if (writeSaves(merged)) setSaves(merged);
      // Flows written by the merge are already on the server or queued: don't queue them twice.
      primeSaves(merged);
    }).catch(() => setToast('Could not load your saved flows from the server; they stay in this browser for now'));
    return () => { cancelled = true; };
  }, [userId, setToast]);

  // The first machine anyone places opens the side panel on Balances, once (on phones: the hint). Canvases that already
  // have machines when the page loads don't count.
  const prevCount = useRef(nodes.length);
  useEffect(() => {
    const was = prevCount.current;
    prevCount.current = nodes.length;
    if (firstNodeShown.current) return;
    if (was > 0) { firstNodeShown.current = true; writePref('gt_calc_panel_intro', '1'); return; }
    if (nodes.length > 0) {
      firstNodeShown.current = true;
      writePref('gt_calc_panel_intro', '1');
      setSidebarTab('balances');
      if (window.innerWidth < 768) setPanelHint(true);
      else setSidebarOpen(true);
    }
  }, [nodes.length]);

  /** Machines that need an item and have no link feeding it (raw inputs in Balances). */
  const rawUsers = (itemId: string) => logicNodes.filter((n) => !isPort(n)
    && nodeInputs(n, machineStats(n)).some((i) => i.id === itemId && i.consumed !== false)
    && !connections.some((c) => c.targetInstanceId === n.instanceId && c.targetItemId === itemId));
  const rawGoTo = useRef(new Map<string, number>());
  /** Go to the next machine that needs this raw input (cycles on repeated clicks). */
  const goToRawUser = (itemId: string) => {
    const users = rawUsers(itemId);
    if (!users.length) return;
    const k = (rawGoTo.current.get(itemId) ?? -1) + 1;
    rawGoTo.current.set(itemId, k);
    goToNode(users[k % users.length].instanceId);
  };

  /**
   * Unused machines: idle at this rate, either NO DEMAND (nothing outside their own loop uses
   * what they make) or NOT NEEDED (other machines already cover everything they make).
   */
  const noDemandIds = useMemo(() => new Set(logicNodes.filter((n) => {
    const f = flows.nodes.get(n.instanceId);
    return !isPort(n) && !n.isTarget && f?.idle;
  }).map((n) => n.instanceId)), [logicNodes, flows]);
  /** Remove every unused machine and its links (undo-able). */
  const handleRemoveNoDemand = () => {
    if (viewingRef.current) return; // view mode: nothing changes
    if (!noDemandIds.size) return;
    const before = { nodes, connections };
    const gone = noDemandIds;
    clearTimeout(hoverTimer.current); hoverNow.current = null; setHover(null);
    setNodes((prev) => prev.filter((n) => !gone.has(n.instanceId)));
    setConnections((prev) => prev.filter((c) => !gone.has(c.sourceInstanceId) && !gone.has(c.targetInstanceId)));
    setToast(`Removed ${gone.size} unused machine${gone.size === 1 ? '' : 's'}`, () => { setNodes(before.nodes); setConnections(before.connections); });
  };

  // Opening a flow (and the page load) frames the whole flow in the middle, so a flow far from
  // the old view doesn't look empty or unsaved. Runs once the new cards have rendered.
  const [fitTick, setFitTick] = useState(1);
  useEffect(() => {
    if (!fitTick) return;
    const t = setTimeout(() => {
      const ids = new Set(live.current.nodes.map((n) => n.instanceId));
      if (ids.size) fitNodes(ids);
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);

  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  /** Pan so a node sits in the middle of the canvas, then pulse a glow ring round it. */
  const goToNode = useCallback((id: string) => {
    const n = live.current.nodes.find((x) => x.instanceId === id);
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!n || !canvas) return;
    const r = rectOf(n);
    // Phones: the side panel covers the whole screen, so close it to show the machine.
    if (window.innerWidth < 768) setSidebarOpen(false);
    const z = Math.max(live.current.zoom, 0.6);
    // Centre in the part of the canvas the side panel (336px) doesn't cover.
    const visibleWidth = canvas.width - (sidebarOpenRef.current && window.innerWidth >= 768 ? 336 : 0);
    setPanAnimating(true);
    setZoom(z);
    setPan({ x: visibleWidth / 2 - (r.x + r.w / 2) * z, y: canvas.height / 2 - (r.y + r.h / 2) * z });
    setFocus({ id, tick: Date.now() });
    setTimeout(() => setPanAnimating(false), 450);
  }, [rectOf]);
  /** Zoom and pan so every given node fits on screen (used after Best Route adds a chain). */
  /** The zoom and pan that fit these nodes in the visible canvas (null if there's nothing to fit). */
  const fitView = useCallback((ids: Set<string>) => {
    const list = live.current.nodes.filter((n) => ids.has(n.instanceId));
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!list.length || !canvas) return null;
    const rs = list.map((n) => rectOf(n));
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    const visibleWidth = canvas.width - (sidebarOpenRef.current && window.innerWidth >= 768 ? 336 : 0);
    const z = Math.max(0.15, Math.min(1, (visibleWidth - 80) / (x1 - x0), (canvas.height - 120) / (y1 - y0)));
    return { zoom: z, pan: { x: visibleWidth / 2 - ((x0 + x1) / 2) * z, y: canvas.height / 2 - ((y0 + y1) / 2) * z } };
  }, [rectOf]);
  const fitNodes = useCallback((ids: Set<string>) => {
    const v = fitView(ids);
    if (!v) return;
    setPanAnimating(true);
    setZoom(v.zoom);
    setPan(v.pan);
    setTimeout(() => setPanAnimating(false), 450);
  }, [fitView]);
  /** Back to 100% with the middle of the flow in the middle of the visible canvas. */
  const centreFlow = useCallback(() => {
    const rs = live.current.nodes.map((n) => rectOf(n));
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!rs.length || !canvas) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    const visibleWidth = canvas.width - (sidebarOpenRef.current && window.innerWidth >= 768 ? 336 : 0);
    setPanAnimating(true);
    setZoom(1);
    setPan({ x: visibleWidth / 2 - (x0 + x1) / 2, y: canvas.height / 2 - (y0 + y1) / 2 });
    setTimeout(() => setPanAnimating(false), 450);
  }, [rectOf]);
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => setFocus(null), 2600);
    return () => clearTimeout(t);
  }, [focus]);

  // ---------------------------------------------------------------- named saves
  // Serialising the whole canvas is costly: don't do it on every drag frame (it also made
  // garbage-collection pauses mid-drag). It catches up when the drag ends.
  const snapshotCache = useRef('');
  const currentSnapshot = useMemo(() => {
    if (draggingNodeId) return snapshotCache.current;
    snapshotCache.current = snapshotOf(nodes, connections, budget);
    return snapshotCache.current;
  }, [nodes, connections, budget, draggingNodeId]);
  // Saving is manual: unsaved changes since the last Save (an unsaved canvas with machines counts too).
  const dirty = !viewFlow && (currentSave ? savedSnapshot !== currentSnapshot : nodes.length > 0);

  /**
   * Write the open flow into Saves now (named or untitled). A canvas with machines but no save
   * yet becomes a new untitled draft. Returns the save it wrote to.
   */
  const flushSave = (): CurrentSave | null => {
    if (viewingRef.current) return currentSave; // never save a flow that's only being viewed
    if (!currentSave && !nodes.length) return null;
    if (currentSave && savedSnapshot === currentSnapshot) return currentSave;
    const list = loadSaves();
    const target = currentSave ?? { id: `flow_${Date.now().toString(36)}`, name: nextUntitled(list), draft: true };
    const origin = list.find((x) => x.id === target.id)?.origin;
    const entry: SavedFlow = { id: target.id, name: target.name, savedAt: Date.now(), nodes, connections, targetEUtBudget: budget, ...(target.draft ? { draft: true } : {}), ...(origin ? { origin } : {}) };
    const next = list.some((x) => x.id === entry.id) ? list.map((x) => (x.id === entry.id ? entry : x)) : [entry, ...list];
    if (!writeSaves(next)) { setToast('Could not save: browser storage is full. Delete an old save or use Backup (.json).'); return currentSave; }
    setSaves(next);
    setSavedSnapshot(currentSnapshot);
    if (!currentSave) setCurrentSave(target);
    return target;
  };
  const flushRef = useRef(flushSave);
  flushRef.current = flushSave;

  const persistSaves = (list: SavedFlow[]) => {
    if (!writeSaves(list)) { setToast('Could not save: browser storage is full. Delete an old save or use Backup (.json).'); return false; }
    setSaves(list);
    return true;
  };

  /** Save under a name: same name overwrites that save, a new name makes a new one. */
  const handleSaveAs = (rawName: string) => {
    const name = rawName.trim().slice(0, 64);
    if (!name) return;
    const existing = saves.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const fromDraft = currentSave?.draft ? saves.find((x) => x.id === currentSave.id) : undefined;
    const entry: SavedFlow = {
      id: existing?.id ?? fromDraft?.id ?? `flow_${Date.now().toString(36)}`,
      name,
      savedAt: Date.now(),
      nodes,
      connections,
      targetEUtBudget: budget,
      ...(currentOrigin ? { origin: currentOrigin } : {}), // a copy keeps its original creator
    };
    // Naming a draft turns it into this save (and drops the draft if the name already existed).
    const base = fromDraft && existing && existing.id !== fromDraft.id ? saves.filter((x) => x.id !== fromDraft.id) : saves;
    const list = base.some((x) => x.id === entry.id) ? base.map((x) => (x.id === entry.id ? entry : x)) : [entry, ...base];
    if (!persistSaves(list)) return;
    setCurrentSave({ id: entry.id, name });
    setSavedSnapshot(currentSnapshot);
    setSaveDialog(null);
    setToast(existing ? `Updated "${name}"` : `Saved "${name}"`);
    const then = afterSave.current;
    afterSave.current = null;
    if (then) setTimeout(then, 0);
  };

  /** Save: overwrite the open flow straight away; ask for a name only if it has none yet. */
  const handleQuickSave = () => {
    if (viewingRef.current) return; // view mode: nothing changes
    if (currentSave && !currentSave.draft) handleSaveAs(currentSave.name);
    else setSaveDialog('');
  };
  const quickSaveRef = useRef(handleQuickSave);
  quickSaveRef.current = handleQuickSave;
  /** Save as: always ask for a (new) name. */
  const openSaveAsDialog = () => setSaveDialog(currentSave && !currentSave.draft ? `${currentSave.name} copy` : '');
  const saveAsRef = useRef(openSaveAsDialog);
  saveAsRef.current = openSaveAsDialog;

  const fontCss = useRef<string | null>(null);
  const exportFlowJson = (flow: { name?: string; nodes: CanvasNode[]; connections: Connection[]; targetEUtBudget: number; origin?: FlowOrigin }) => {
    // The creator goes in the file too: the flow's recorded origin, else whoever exports it.
    const origin = flow.origin ?? (user ? { author: user.username, authorId: user.uid } : undefined);
    const body = { name: flow.name ?? currentSave?.name ?? 'Untitled flow', nodes: flow.nodes, connections: flow.connections, targetEUtBudget: flow.targetEUtBudget, ...(origin ? { origin } : {}) };
    downloadBlob(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }), `skygreg-${fileSafe(body.name)}.json`);
  };
  /**
   * Show / hide the Supplied / Needed panels. Turning them on also widens the gaps to the
   * right of machines that send something, so the panels fit without covering a node.
   */
  const toggleLabels = () => {
    if (showLabels) { setShowLabels(false); return; }
    setShowLabels(true);
    const need = BADGE_W + 60;
    const sends = new Set(connections.map((c) => c.sourceInstanceId));
    const sorted = [...nodes].sort((a, b) => a.x - b.x);
    const placed: (Rect & { sends: boolean })[] = [];
    const moved = new Map<string, number>();
    for (const n of sorted) {
      const r = rectOf(n, measured);
      let x = r.x;
      for (const p of placed) {
        const besideVertically = p.y < r.y + r.h + NODE_GAP && r.y < p.y + p.h + NODE_GAP;
        if (p.sends && besideVertically && p.x < r.x) x = Math.max(x, p.x + p.w + need);
      }
      if (x !== r.x) moved.set(n.instanceId, x);
      placed.push({ ...r, x, sends: sends.has(n.instanceId) });
    }
    if (!moved.size) return;
    const before = nodes;
    setNodes((prev) => prev.map((n) => (moved.has(n.instanceId) ? { ...n, x: moved.get(n.instanceId)! } : n)));
    setToast(`Made room for flow labels (${moved.size} node${moved.size === 1 ? '' : 's'} moved)`, () => setNodes(before));
  };

  /** Plain-text build list: every machine (in the Machines tab's sort) plus the power totals. */
  const exportBuildList = () => {
    const s = machineSummary;
    const name = currentSave?.name ?? 'Untitled flow';
    const pad = (v: string, n: number) => (v.length >= n ? v.slice(0, n - 1) + ' ' : v + ' '.repeat(n - v.length));
    const lines: string[] = [
      `${MODPACKS.find((m) => m.id === PACK)?.name ?? ''} build list: ${name}`,
      `Exported ${new Date().toLocaleString()} · sorted by ${machineSort === 'machine' ? 'machine' : 'tier'}`,
      '',
    ];
    const row = (r: (typeof s.list)[number], indent = '') =>
      `${indent}${pad(machineSort === 'machine' && indent ? r.recipe.recipeName : r.name, indent ? 38 : 40)}${pad(r.tierLabel, 16)}${pad(`x${r.machines}`, 8)}${r.gen ? '+' : ''}${formatEU(r.eutMax)}`;
    lines.push(`${pad('Machine', 40)}${pad('Tier', 16)}${pad('Count', 8)}${euUnit()} (full load)`);
    lines.push('-'.repeat(84));
    if (machineSort === 'machine') {
      for (const g of machineGroups) {
        lines.push(`${g.name} — x${g.total}`);
        for (const r of g.rows) lines.push(row(r, '  '));
      }
    } else {
      for (const r of s.list) lines.push(row(r));
    }
    const net = s.genAvg - s.useAvg;
    lines.push('', 'Totals', '-'.repeat(84),
      `Machines to build:     ${Math.round(s.totalMachines)}`,
      `Machine types:         ${s.list.length}`,
      `Full load:             ${formatEU(s.useMax)}`,
      `Average:               ${formatEU(s.useAvg)}`,
      `Generated (average):   +${formatEU(s.genAvg)}`,
      `Net:                   ${net >= 0 ? '+' : '-'}${formatEU(Math.abs(net))}`,
    );
    downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/plain' }), `skygreg-${fileSafe(name)}-build-list.txt`);
  };

  /** Build list as a picture (see BuildSheet): rendered off screen in the chosen layout and saved. */
  const buildSheetRef = useRef<HTMLDivElement>(null);
  const [buildSheet, setBuildSheet] = useState<BuildLayout | null>(null);
  const [buildPanel, setBuildPanel] = useState(false);
  const exportBuildImage = async (layout: BuildLayout, format: 'jpg' | 'png') => {
    setBuildSheet(layout);
    setExporting(true);
    try {
      // Let the sheet render and its machine textures load.
      await new Promise((r) => setTimeout(r, 150));
      const el = buildSheetRef.current;
      if (!el) throw new Error('nothing to render');
      await Promise.all([...el.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
      const { getFontEmbedCSS, toJpeg, toPng } = await import('html-to-image'); // only loaded for exports
      fontCss.current ??= await getFontEmbedCSS(el).catch(() => '');
      const opts = { pixelRatio: 2, backgroundColor: '#161a24', fontEmbedCSS: fontCss.current };
      const url = format === 'png' ? await toPng(el, opts) : await toJpeg(el, { ...opts, quality: 0.92 });
      downloadBlob(await (await fetch(url)).blob(), `${PACK}-${fileSafe(currentSave?.name ?? 'flow')}-build-list.${format}`);
    } catch (e) {
      setToast(`Image export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
      setBuildSheet(null);
    }
  };

  const exportAllSaves = () => {
    downloadBlob(new Blob([JSON.stringify({ saves }, null, 2)], { type: 'application/json' }), 'skygreg-all-saves.json');
  };
  /** Picture of the whole flow (not just what's on screen), rendered at 2x so text stays sharp. */
  /**
   * Draw the flow as an image with the export options. `previewSide` makes a small preview (that
   * long side in px) for the export panel; without it, the full-size image. One at a time.
   */
  const captureQueue = useRef<Promise<unknown>>(Promise.resolve());
  const captureFlow = (opts: ExportOptions, previewSide?: number) => {
    const run = async () => {
      const world = worldRef.current;
      if (!world || !nodes.length) throw new Error('Nothing to export yet');
      // Detail level and wire labels change the cards' size: apply them, let the cards re-measure,
      // then frame the flow.
      const labelsBefore = showLabels;
      world.classList.toggle('export-basic', opts.detail === 'basic');
      world.classList.toggle('export-simple', opts.detail === 'simple');
      if (opts.labels !== showLabels) setShowLabels(opts.labels);
      try {
        await new Promise((r) => setTimeout(r, opts.detail === 'advanced' && opts.labels === labelsBefore ? 30 : 250));
        const rects = [...nodes.map((n) => {
          const el = world.querySelector<HTMLElement>(`[data-node="${n.instanceId}"]`);
          return el ? { x: n.x, y: n.y, w: el.offsetWidth, h: el.offsetHeight } : rectOf(n, measured);
        }), ...(opts.labels ? [...badgeRects.values()].map((b) => ({ x: b.x, y: b.y, w: BADGE_W, h: BADGE_H })) : [])];
        const pad = 60;
        const minX = Math.min(...rects.map((r) => r.x)) - pad;
        const minY = Math.min(...rects.map((r) => r.y)) - pad;
        const width = Math.ceil(Math.max(...rects.map((r) => r.x + r.w)) + pad - minX);
        const height = Math.ceil(Math.max(...rects.map((r) => r.y + r.h)) + pad - minY);
        // Resolution: the long side at the chosen size (4K, HD, SD), or as sharp as fits ("auto").
        // Browsers cap canvas size (~16k px a side, ~120 MP), so very large flows come out smaller.
        const cap = Math.min(16000 / width, 16000 / height, Math.sqrt(120e6 / (width * height)));
        const fullRatio = Math.max(0.1, Math.min(4, opts.size === 'auto' ? 2 : EXPORT_SIZES[opts.size] / Math.max(width, height), cap));
        const pixelRatio = previewSide ? Math.max(0.05, Math.min(previewSide / Math.max(width, height), cap)) : fullRatio;
        // The dotted grid lives on the canvas behind this layer: add a copy under the flow.
        setExportGrid(opts.grid ? { x: minX, y: minY, w: width, h: height } : null);
        await new Promise((r) => setTimeout(r, 30));
        const { getFontEmbedCSS, toJpeg, toPng } = await import('html-to-image'); // only loaded for exports
        fontCss.current ??= await getFontEmbedCSS(world).catch(() => '');
        const url = await (opts.format === 'png' && !previewSide ? toPng : toJpeg)(world, {
          fontEmbedCSS: fontCss.current,
          width,
          height,
          pixelRatio,
          quality: previewSide ? 0.8 : 0.9,
          backgroundColor: '#11141c',
          style: {
            transform: `translate(${-minX}px, ${-minY}px)`,
            transition: 'none',
            width: `${width}px`,
            height: `${height}px`,
          },
          // Skip snap guides and the animated flow dashes (static wires are drawn anyway).
          filter: (el: Node) => !((el instanceof HTMLElement || el instanceof SVGElement) && (el.dataset.exportSkip != null || el.classList.contains('wire-flow'))),
        });
        // `full`: the size the real export will be, shown under the preview
        return { url, width: Math.round(width * pixelRatio), height: Math.round(height * pixelRatio), full: { w: Math.round(width * fullRatio), h: Math.round(height * fullRatio) } };
      } finally {
        setExportGrid(null);
        world.classList.remove('export-basic', 'export-simple');
        if (opts.labels !== labelsBefore) setShowLabels(labelsBefore);
      }
    };
    const next = captureQueue.current.then(run, run);
    captureQueue.current = next.catch(() => {});
    return next;
  };
  const exportFlowImage = async (opts: ExportOptions = DEFAULT_EXPORT) => {
    if (!nodes.length) { setToast('Nothing to export yet'); return; }
    setExporting(true);
    try {
      const shot = await captureFlow(opts);
      const blob = await (await fetch(shot.url)).blob();
      downloadBlob(blob, `gtcalc-${fileSafe(currentSave?.name ?? 'flow')}.${opts.format}`);
      setToast(`Image saved (${shot.width} x ${shot.height} px)`);
    } catch (e) {
      setToast(`Image export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };
  /** Import a flow (.json from Export) or a whole saves file into the Saves list. */
  const handleImportFiles = async (files: File[]) => {
    const list = files.filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json').slice(0, 10);
    if (!list.length) { setToast('Pick .json files (up to 10 at once)'); return; }
    const incoming: SavedFlow[] = [];
    const failed: string[] = [];
    for (const file of list) {
      try {
        const data = JSON.parse(await file.text());
        const base = file.name.replace(/\.json$/i, '');
        if (isGtnhProject(data)) {
          const flow = fromGtnhProject(data);
          incoming.push({ id: '', name: flow.name || base, savedAt: Date.now(), nodes: flow.nodes, connections: flow.connections, targetEUtBudget: 100000 });
        } else if (Array.isArray(data?.saves)) incoming.push(...data.saves);
        else if (Array.isArray(data?.nodes)) incoming.push({ id: '', name: data.name ?? base, savedAt: Date.now(), nodes: data.nodes, connections: data.connections ?? [], targetEUtBudget: data.targetEUtBudget ?? 100000, ...(data.origin?.author ? { origin: data.origin as FlowOrigin } : {}) });
        else failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
    }
    if (files.length > 10) failed.push(`${files.length - 10} more (10 at a time)`);
    if (!incoming.length) { setToast(`Could not read ${failed.join(', ')}`); return; }
    const current = loadSaves();
    const taken = new Set(current.map((x) => x.name.toLowerCase()));
    // Imported files are untrusted: keep only well-formed flows, with names and dates the app
    // (and the sync rules) accept.
    const valid = incoming.flatMap((x) => { const f = cleanFlow(x); return f ? [{ ...x, ...f }] : []; });
    if (valid.length < incoming.length) failed.push(`${incoming.length - valid.length} damaged flow${incoming.length - valid.length === 1 ? '' : 's'}`);
    if (!valid.length) { setToast(`Could not read ${failed.join(', ')}`); return; }
    const added = valid.map((x, i) => {
      const base = String(x.name || 'Imported flow').slice(0, 56);
      let name = base;
      for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base} (${k})`;
      taken.add(name.toLowerCase());
      return { ...x, name, savedAt: Number.isFinite(x.savedAt) ? x.savedAt : Date.now(), connections: Array.isArray(x.connections) ? x.connections : [], targetEUtBudget: Number.isFinite(x.targetEUtBudget) ? x.targetEUtBudget : 100000, id: `flow_${Date.now().toString(36)}_${i}`, draft: undefined };
    });
    if (persistSaves([...added, ...current])) {
      setImportOpen(false);
      setLinkedFlow(null);
      setBuildsTab('mine');
      setPage('builds');
      setNavKey((k) => k + 1);
      setToast(`Imported ${added.length} flow${added.length === 1 ? '' : 's'} into Saves${failed.length ? `. Skipped: ${failed.join(', ')}` : ''}`);
    }
  };

  /** Before leaving the current flow: offer to save unsaved changes first. */
  const confirmLeave = (verb: string, proceed: () => void) => {
    if (!dirty) { proceed(); return; }
    setConfirm({
      title: 'Unsaved changes',
      body: `"${currentSave?.name ?? 'This flow'}" has changes that aren't saved. Save them before you ${verb}?`,
      actions: [
        { label: "Don't save", kind: 'danger', run: proceed },
        { label: 'Save', kind: 'primary', run: () => { flushSave(); proceed(); } },
      ],
    });
  };

  // Opening a save from the profile window or the Builds page goes back to the canvas.
  const handleLoadSave = (entry: SavedFlow) => {
    if (leaveViewThen(() => navRef.current.load(entry))) return;
    setProfileOpen(false);
    setPage('canvas');
    confirmLeave(`open "${entry.name}"`, () => openSave(entry));
  };
  const openSave = (entry: SavedFlow) => {
    const prev = { nodes, connections, budget, currentSave, savedSnapshot };
    const fresh = (db ? refreshFromDatabase(entry.nodes, entry.connections, db) : null) ?? { nodes: entry.nodes, connections: entry.connections };
    setNodes(fresh.nodes);
    setConnections(fresh.connections);
    setBudget(entry.targetEUtBudget ?? 100000);
    setCurrentSave({ id: entry.id, name: entry.name, ...(entry.draft ? { draft: true } : {}) });
    // Snapshot of what's on the canvas, so opening a flow doesn't count as an edit (autosave).
    setSavedSnapshot(snapshotOf(fresh.nodes, fresh.connections, entry.targetEUtBudget ?? 100000));
    setFitTick((t) => t + 1);
    setToast(`Opened "${entry.name}"`, () => {
      setNodes(prev.nodes);
      setConnections(prev.connections);
      setBudget(prev.budget);
      setCurrentSave(prev.currentSave);
      setSavedSnapshot(prev.savedSnapshot);
    });
  };

  const handleDeleteSave = (entry: SavedFlow) => {
    setConfirm({
      title: 'Delete flow',
      body: `Are you sure you want to delete "${entry.name}"?`,
      actions: [{ label: 'Delete', kind: 'danger', run: () => deleteSave(entry) }],
    });
  };
  const deleteSave = (entry: SavedFlow) => {
    const prev = saves;
    const wasOpen = currentSave?.id === entry.id;
    const canvas = { nodes, connections, currentSave, savedSnapshot };
    if (!persistSaves(loadSaves().filter((x) => x.id !== entry.id))) return;
    // Deleting the open flow clears the canvas too; otherwise autosave would bring it back as a new draft.
    if (wasOpen) { setCurrentSave(null); setSavedSnapshot(null); setNodes([]); setConnections([]); setSelected(new Set()); }
    setToast(`Deleted "${entry.name}"`, () => {
      if (!writeSaves(prev)) return;
      setSaves(prev);
      if (wasOpen) { setNodes(canvas.nodes); setConnections(canvas.connections); setCurrentSave(canvas.currentSave); setSavedSnapshot(canvas.savedSnapshot); }
    });
  };

  const handleRenameSave = (id: string, rawName: string) => {
    const name = rawName.trim();
    setRenaming(null);
    if (!name) return;
    if (currentSave?.id === id) flushSave(); // make sure the open flow is in the list first
    // Renaming gives a draft its name, so it stops being "untitled".
    persistSaves(loadSaves().map((x) => (x.id === id ? { ...x, name: name.slice(0, 64), draft: undefined } : x)));
    if (currentSave?.id === id) setCurrentSave({ id, name: name.slice(0, 64) });
  };

  const handleNewFlow = () => { if (leaveViewThen(() => navRef.current.fresh())) return; setPage('canvas'); confirmLeave('start a new flow', startNewFlow); };
  // A new flow is just an empty canvas: its "Untitled flow-NN" draft is made when the first machine
  // goes on (flushSave), so opening the site or pressing New flow leaves no empty drafts behind.
  const startNewFlow = () => {
    const prev = { nodes, connections, currentSave, savedSnapshot };
    setNodes([]);
    setConnections([]);
    setCurrentSave(null);
    setSavedSnapshot(null);
    setToast('Started a new flow', () => {
      setNodes(prev.nodes);
      setConnections(prev.connections);
      setCurrentSave(prev.currentSave);
      setSavedSnapshot(prev.savedSnapshot);
    });
  };

  // Ctrl/Cmd+S opens the save dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) saveAsRef.current(); // Ctrl+Shift+S: save as a new flow
        else quickSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------- machine breakdown
  const machineSummary = useMemo(() => {
    const nodes = logicNodes; // positions don't matter here: skip recomputing while dragging
    type Row = { key: string; name: string; tier: string; tierLabel: string; recipe: MachineRecipe; node: CanvasNode; machines: number; needed: number; eutMax: number; eutAvg: number; gen: boolean; nodeIds: string[] };
    const rows = new Map<string, Row>();
    for (const n of nodes) {
      if (isPort(n)) continue;
      const f = flows.nodes.get(n.instanceId);
      if (!f) continue;
      const g = n.gen;
      // Name the actual block to build: the multiblock variant and its parallel hatch, not just the recipe's machine.
      const m = !g || g.kind === 'single' ? n.multi : undefined;
      const name = g && g.kind !== 'single' ? g.name : m ? `${m.name}${m.parallel > 1 ? ` + ${m.parallel}x Parallel` : ''}` : n.recipe.machineName;
      const noEnergy = !n.recipe.baseEUt && !n.recipe.generatesEU;
      const tier = g?.kind === 'engine' || g?.kind === 'turbine' ? g.tier! : n.selectedTier;
      const tierLabel = noEnergy ? 'No EU' : g?.kind === 'turbine' && g.holderTier && g.holderTier !== g.tier ? `${tier} (${g.holderTier} holder)` : tier;
      const key = `${name}|${tierLabel}`;
      const row = rows.get(key) ?? { key, name, tier: noEnergy ? '' : tier, tierLabel, recipe: n.recipe, node: n, machines: 0, needed: 0, eutMax: 0, eutAvg: 0, gen: !!n.recipe.generatesEU, nodeIds: [] };
      row.machines += f.machines;
      row.needed += f.machinesNeeded;
      row.eutMax += f.stats.eutPerMachine * f.machines;
      row.eutAvg += f.eutAvg;
      row.nodeIds.push(n.instanceId);
      rows.set(key, row);
    }
    const tierIdx = (t: string) => (t ? TIER_ORDER.indexOf(t as never) : -1);
    const list = [...rows.values()].sort((a, b) => (machineSort === 'tier'
      ? tierIdx(a.tier) - tierIdx(b.tier) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name) || tierIdx(a.tier) - tierIdx(b.tier)));
    const tiers = new Map<string, number>();
    for (const r of list) if (r.tier) tiers.set(r.tier, (tiers.get(r.tier) ?? 0) + r.machines);
    const consumers = list.filter((r) => !r.gen);
    const generators = list.filter((r) => r.gen);
    return {
      list,
      tiers: [...tiers].sort((a, b) => TIER_ORDER.indexOf(a[0] as never) - TIER_ORDER.indexOf(b[0] as never)),
      totalMachines: list.reduce((a, r) => a + r.machines, 0),
      types: new Set(list.filter((r) => r.machines > 0).map((r) => r.name.replace(/ \+ \d+x Parallel$/, ''))).size, // kinds of machine, any tier
      useMax: consumers.reduce((a, r) => a + r.eutMax, 0),
      useAvg: consumers.reduce((a, r) => a + r.eutAvg, 0),
      genMax: generators.reduce((a, r) => a + r.eutMax, 0),
      genAvg: generators.reduce((a, r) => a + r.eutAvg, 0),
    };
  }, [logicNodes, flows, machineSort]);
  const builtKey = `gt_calc_built_${currentSave?.id ?? 'scratch'}`;
  useEffect(() => {
    try { setBuilt(new Set(JSON.parse(localStorage.getItem(builtKey) || '[]'))); } catch { setBuilt(new Set()); }
  }, [builtKey]);
  const updateBuilt = (next: Set<string>) => {
    if (viewingRef.current) return; // ticks belong to the user's own flow
    setBuilt(next);
    writePref(builtKey, JSON.stringify([...next]));
  };
  const machineGroups = useMemo(() => {
    const groups = new Map<string, { name: string; total: number; rows: typeof machineSummary.list }>();
    for (const r of machineSummary.list) {
      const g = groups.get(r.name) ?? { name: r.name, total: 0, rows: [] };
      g.total += r.machines;
      g.rows.push(r);
      groups.set(r.name, g);
    }
    return [...groups.values()];
  }, [machineSummary]);
  /** Build list picture: one group per block to build, one row per recipe and tier on the canvas. */
  const buildGroups = useMemo((): BuildGroup[] => {
    if (!buildSheet && !buildPanel) return [];
    const groups = new Map<string, BuildGroup>();
    const io = (rates: Record<string, number>, items: RecipeItem[]) => Object.entries(rates)
      .filter(([, v]) => v > 1e-9)
      .map(([id, perSec]) => {
        const it = items.find((x) => x.id === id) ?? db?.itemById.get(id);
        return { id, name: it?.name ?? id, unit: (it?.unit ?? 'item') as 'mB' | 'item', color: it?.iconColor, perSec };
      });
    for (const n of logicNodes) {
      if (isPort(n)) continue;
      const f = flows.nodes.get(n.instanceId);
      if (!f || f.machines <= 0) continue;
      const g = n.gen;
      const m = !g || g.kind === 'single' ? n.multi : undefined;
      const name = g && g.kind !== 'single' ? g.name : m ? `${m.name}${m.parallel > 1 ? ` + ${m.parallel}x Parallel` : ''}` : n.recipe.machineName;
      const noEnergy = !n.recipe.baseEUt && !n.recipe.generatesEU;
      const tier = noEnergy ? '' : g?.kind === 'engine' || g?.kind === 'turbine' ? g.tier! : n.selectedTier;
      const tierLabel = noEnergy ? 'No EU' : g?.kind === 'turbine' && g.holderTier && g.holderTier !== g.tier ? `${tier} (${g.holderTier} holder)` : tier;
      const group = groups.get(name) ?? { name, recipe: n.recipe, tier, total: 0, rows: [] };
      group.total += f.machines;
      const key = `${n.recipe.id}|${tierLabel}`;
      const same = group.rows.find((r) => r.key === key);
      const inputs = io(f.inputRates, n.recipe.inputs);
      const outputs = io(f.outputRates, n.recipe.outputs);
      if (same) {
        same.machines += f.machines;
        same.eut += f.stats.eutPerMachine * f.machines;
        for (const x of inputs) { const y = same.inputs.find((z) => z.id === x.id); if (y) y.perSec += x.perSec; else same.inputs.push(x); }
        for (const x of outputs) { const y = same.outputs.find((z) => z.id === x.id); if (y) y.perSec += x.perSec; else same.outputs.push(x); }
      } else {
        group.rows.push({ key, recipe: n.recipe, recipeName: n.recipe.recipeName, tier, tierLabel, machines: f.machines, eut: f.stats.eutPerMachine * f.machines, gen: !!n.recipe.generatesEU, ...(n.recipe.circuit != null ? { circuit: n.recipe.circuit } : {}), inputs, outputs });
      }
      groups.set(name, group);
    }
    const tierIdx = (t: string) => (t ? TIER_ORDER.indexOf(t as never) : -1);
    const list = [...groups.values()];
    for (const gr of list) gr.rows.sort((a, b) => tierIdx(a.tier) - tierIdx(b.tier) || a.recipeName.localeCompare(b.recipeName));
    return list.sort((a, b) => (machineSort === 'tier' ? tierIdx(a.rows[0].tier) - tierIdx(b.rows[0].tier) : 0) || a.name.localeCompare(b.name));
  }, [buildSheet, buildPanel, logicNodes, flows, db, machineSort]);
  const cycleIdx = useRef(new Map<string, number>());
  /** Go to the next node in a list (repeat clicks step through several sources). */
  const goToNext = (key: string, ids: string[]) => {
    if (!ids.length) return;
    const i = ((cycleIdx.current.get(key) ?? -1) + 1) % ids.length;
    cycleIdx.current.set(key, i);
    goToNode(ids[i]);
  };

  const handleClearLinks = () => {
    if (viewingRef.current) return; // view mode: nothing changes
    if (!connections.length) return;
    const prev = connections;
    setConnections([]);
    setToast(`Removed ${prev.length} route${prev.length === 1 ? '' : 's'}`, () => setConnections(prev));
  };

  /**
   * Largest target rate allowed by every limit: the EU/t budget, Input node supply limits,
   * raw-input limits typed in the sidebar, and locked machine counts. Flows scale linearly
   * with the target, so each limit is checked against a solve at one target craft per second.
   */
  const handleMaxFlow = () => {
    if (viewingRef.current) return; // view mode: nothing changes
    const target = nodes.find((n) => n.isTarget);
    if (!target) { setToast('Set a target machine first'); return; }
    const unit = solveFlows(nodes, connections, { forceTargetCycles: 1, ignoreCaps: true });
    const limits: { cycles: number; reason: string }[] = [];
    if (unit.euConsumed > 0 && budgetOn && budget > 0) limits.push({ cycles: budget / unit.euConsumed, reason: `the ${formatEU(budget)} budget` });
    for (const n of nodes) {
      const f = unit.nodes.get(n.instanceId);
      if (!f || f.cyclesPerSec <= 0 || n.isTarget) continue;
      if (isSupply(n) && n.supplyLimit != null) limits.push({ cycles: n.supplyLimit / f.cyclesPerSec, reason: `${n.recipe.recipeName} supply` });
      if (!isSupply(n) && n.countMode === 'manual') limits.push({ cycles: n.count / f.stats.durationSec / f.cyclesPerSec, reason: `locked ${n.recipe.machineName} count` });
    }
    for (const r of rawInputUsage(nodes, connections, unit).values()) {
      const text = userSuppliedLimits[r.item.id];
      const limit = text ? parseRate(text, r.item.unit) : null;
      if (limit != null && r.rate > 0) limits.push({ cycles: limit / r.rate, reason: `${r.item.name} supply` });
    }
    if (!limits.length) { setToast('Nothing limits this line: set an EU budget or supply limits first'); return; }
    const best = limits.reduce((a, b) => (b.cycles < a.cycles ? b : a));
    const cycles = best.cycles;
    setToast(`Max flow limited by ${best.reason}`);
    const stats = machineStats(target);
    if (target.recipe.generatesEU) {
      updateNode(target.instanceId, { targetEUt: cycles * stats.durationSec * stats.eutPerMachine, targetRate: undefined });
    } else {
      const itemId = target.targetRate?.itemId ?? target.recipe.outputs[0]?.id;
      const item = target.recipe.outputs.find((o) => o.id === itemId);
      if (item) updateNode(target.instanceId, { targetRate: { itemId: item.id, perSec: cycles * perCycleOf(target.recipe.outputs, item.id, stats) }, targetEUt: undefined });
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2200);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  // ---------------------------------------------------------------- wires + rate panels
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.instanceId, n])), [nodes]);
  const portSets = useMemo(() => {
    const m = new Map<string, { ins: Set<string>; outs: Set<string> }>();
    const get = (id: string) => {
      if (!m.has(id)) m.set(id, { ins: new Set(), outs: new Set() });
      return m.get(id)!;
    };
    for (const c of connections) {
      get(c.targetInstanceId).ins.add(c.targetItemId);
      get(c.sourceInstanceId).outs.add(c.sourceItemId);
    }
    return m;
  }, [connections]);
  const emptySets = useMemo(() => ({ ins: new Set<string>(), outs: new Set<string>() }), []);

  const wires = useMemo(() => {
    const pairTotal = new Map<string, number>();
    for (const c of connections) pairTotal.set(`${c.sourceInstanceId}|${c.targetInstanceId}`, (pairTotal.get(`${c.sourceInstanceId}|${c.targetInstanceId}`) ?? 0) + 1);
    const pairSeen = new Map<string, number>();
    let backIdx = 0;

    const list = connections.flatMap((c) => {
      const s = nodeById.get(c.sourceInstanceId);
      const t = nodeById.get(c.targetInstanceId);
      if (!s || !t) return [];
      const sItem = s.recipe.outputs.find((o) => o.id === c.sourceItemId);
      const tItem = nodeInputs(t, flows.nodes.get(t.instanceId)?.stats ?? machineStats(t)).find((i) => i.id === c.targetItemId);
      if (!sItem || !tItem) return [];
      const sr = rectOf(s, measured);
      const tr = rectOf(t, measured);
      const x1 = sr.x + sr.w + 4;
      const y1 = portY(s, 'out', c.sourceItemId);
      const x2 = tr.x - 4;
      const y2 = portY(t, 'in', c.targetItemId);

      const key = `${c.sourceInstanceId}|${c.targetInstanceId}`;
      const k = pairSeen.get(key) ?? 0;
      pairSeen.set(key, k + 1);
      const lane = (k - ((pairTotal.get(key) ?? 1) - 1) / 2) * 12;

      let d: string;
      let length: number;
      // Wires may pass under other cards (easier to follow than long detours).
      // Forward whenever the consumer starts right of the producer, even when the cards sit
      // side by side: the vertical leg then runs in the gap between them.
      if (x2 - x1 >= 12) {
        const margin = Math.min(20, (x2 - x1) / 2);
        const midX = Math.min(x2 - margin, Math.max(x1 + margin, (x1 + x2) / 2 + lane));
        d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
        length = Math.abs(midX - x1) + Math.abs(y2 - y1) + Math.abs(x2 - midX);
        const color = visibleColor(tItem.iconColor ?? sItem.iconColor);
        return [{ conn: c, sItem, tItem, x1, y1, x2, y2, d, length, color, leg: { midX, lo: x1 + margin, hi: x2 - margin } }];
      } else {
        // Consumer sits left of the producer: loop around the two cards, above or below
        // whichever is shorter.
        // Each looping wire gets its own lane, so their vertical legs run side by side instead of on top of each other
        const bi = backIdx++ % 8;
        const out = x1 + 24 + Math.abs(lane) + bi * 6;
        const inn = x2 - 24 - Math.abs(lane) - bi * 6;
        const offset = 28 + bi * 10;
        // Cards stacked one above the other (e.g. after Auto Sort): cross back through the
        // gap between them, right after the source card ends, instead of looping round both.
        const gapTop = sr.y + sr.h < tr.y ? sr.y + sr.h : tr.y + tr.h < sr.y ? tr.y + tr.h : null;
        const gapBottom = sr.y + sr.h < tr.y ? tr.y : tr.y + tr.h < sr.y ? sr.y : null;
        const below = Math.max(sr.y + sr.h, tr.y + tr.h) + offset;
        const above = Math.min(sr.y, tr.y) - offset;
        const yd = gapTop != null && gapBottom != null && gapBottom - gapTop >= 16
          ? (gapTop + gapBottom) / 2 + Math.max(-(gapBottom - gapTop) / 2 + 4, Math.min((gapBottom - gapTop) / 2 - 4, lane))
          : Math.abs(below - y1) + Math.abs(below - y2) <= Math.abs(above - y1) + Math.abs(above - y2) ? below : above;
        d = `M ${x1} ${y1} H ${out} V ${yd} H ${inn} V ${y2} H ${x2}`;
        length = (out - x1) + Math.abs(yd - y1) + Math.abs(out - inn) + Math.abs(yd - y2) + (x2 - inn);
      }
      const color = visibleColor(tItem.iconColor ?? sItem.iconColor);
      return [{ conn: c, sItem, tItem, x1, y1, x2, y2, d, length, color, leg: null as { midX: number; lo: number; hi: number } | null }];
    });
    // Vertical legs that would sit on top of each other (same x, overlapping heights) are spread
    // a few pixels apart, so each wire runs as its own parallel line instead of merging. Within a
    // group they're ordered by height, so they don't cross one another.
    const LANE = 6;
    const legs = list.filter((w) => w.leg);
    // Union-find: legs within 10 px of each other whose heights overlap share a group (chains too).
    const parent = legs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < legs.length; i++) {
      const a = legs[i], aTop = Math.min(a.y1, a.y2) - 3, aBot = Math.max(a.y1, a.y2) + 3;
      for (let j = i + 1; j < legs.length; j++) {
        const o = legs[j];
        if (Math.abs(a.leg!.midX - o.leg!.midX) < 10 && Math.min(o.y1, o.y2) < aBot && aTop < Math.max(o.y1, o.y2)) parent[find(j)] = find(i);
      }
    }
    const byRoot = new Map<number, typeof legs>();
    legs.forEach((w, i) => { const r = find(i); byRoot.set(r, [...(byRoot.get(r) ?? []), w]); });
    const groups = [...byRoot.values()];
    for (const g of groups) {
      if (g.length < 2) continue;
      g.sort((a, b) => (a.y1 + a.y2) - (b.y1 + b.y2));
      const base = g.reduce((a, w) => a + w.leg!.midX, 0) / g.length;
      g.forEach((w, i) => {
        const x = Math.min(w.leg!.hi, Math.max(w.leg!.lo, base + (i - (g.length - 1) / 2) * LANE));
        w.d = `M ${w.x1} ${w.y1} H ${x} V ${w.y2} H ${w.x2}`;
        w.length = Math.abs(x - w.x1) + Math.abs(w.y2 - w.y1) + Math.abs(w.x2 - x);
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, nodeById, nodes, measured, flows]);

  const badgeRects = useMemo(
    () => (showLabels
      ? placeBadges(
        wires.map((w) => ({ id: w.conn.id, anchorX: w.x1, anchorY: w.y1, w: BADGE_W, h: BADGE_H })),
        nodes.map((n) => rectOf(n, measured)),
      )
      : new Map<string, Rect>()), // "Remove flow labels": no rate panels
    [wires, nodes, measured, rectOf, showLabels],
  );

  const markerColors = useMemo(() => [...new Set(wires.map((w) => w.color))], [wires]);

  /** What stays lit while a node or wire is hovered: its direct links, or its whole chain. */
  /** Build mode's steps (only worked out while it is on). */
  const buildStepList = useMemo(() => {
    if (buildStep == null) return [];
    return buildSteps(logicNodes, connections, flows, {
      blockName: (n) => {
        const g = n.gen;
        const m = !g || g.kind === 'single' ? n.multi : undefined;
        return g && g.kind !== 'single' ? g.name : m ? `${m.name}${m.parallel > 1 ? ` + ${m.parallel}x Parallel` : ''}` : n.recipe.machineName;
      },
      tierLabel: (n) => {
        const g = n.gen;
        if (!n.recipe.baseEUt && !n.recipe.generatesEU) return { tier: '', label: 'No EU' };
        const tier = g?.kind === 'engine' || g?.kind === 'turbine' ? g.tier! : n.selectedTier;
        return { tier, label: g?.kind === 'turbine' && g.holderTier && g.holderTier !== g.tier ? `${tier} (${g.holderTier} holder)` : tier };
      },
      isPort,
      isSupply,
      inputs: (n) => nodeInputs(n, flows.nodes.get(n.instanceId)?.stats ?? machineStats(n)),
      gtceuPipes: PACK !== 'gtnh', // the pipe table is GregTech CEu's
    });
  }, [buildStep == null, logicNodes, connections, flows]); // eslint-disable-line react-hooks/exhaustive-deps
  /** What Build mode lights up: the step's machine and its links, or (first step) the machines taking raw inputs. */
  const buildFocus = useMemo(() => {
    if (buildStep == null) return null;
    const st = buildStepList[Math.min(buildStep, buildStepList.length - 1)];
    if (!st) return null;
    const nodesLit = new Set<string>();
    const connsLit = new Set<string>();
    if (st.kind === 'machine') {
      nodesLit.add(st.nodeId);
      for (const c of connections) {
        if (c.sourceInstanceId === st.nodeId || c.targetInstanceId === st.nodeId) { connsLit.add(c.id); nodesLit.add(c.sourceInstanceId); nodesLit.add(c.targetInstanceId); }
      }
    } else if (st.kind === 'raw') {
      const linked = new Set(connections.map((c) => `${c.targetInstanceId}|${c.targetItemId}`));
      for (const n of logicNodes) {
        if (isSupply(n)) nodesLit.add(n.instanceId);
        else if (!isPort(n) && nodeInputs(n, machineStats(n)).some((i) => i.consumed !== false && !linked.has(`${n.instanceId}|${i.id}`))) nodesLit.add(n.instanceId);
      }
    } else {
      return null;
    }
    return { nodes: nodesLit, conns: connsLit };
  }, [buildStep, buildStepList, connections, logicNodes]);
  /**
   * Build mode's view of a machine: about 140% zoom (less if it wouldn't fit), the machine just right
   * of centre, leaving room on its left for the step card.
   */
  const focusForBuild = useCallback((id: string) => {
    const n = live.current.nodes.find((x) => x.instanceId === id);
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!n || !canvas) return;
    const r = rectOf(n);
    const z = Math.min(1.4, (canvas.height - 120) / r.h, (canvas.width * 0.45) / r.w);
    setPanAnimating(true);
    setZoom(z);
    setPan({ x: canvas.width / 2 + 16 - r.x * z, y: Math.max(60, canvas.height / 2 - (r.h * z) / 2) - r.y * z });
    setFocus({ id, tick: Date.now() });
    setTimeout(() => setPanAnimating(false), 450);
  }, [rectOf]);
  // Each machine step brings its machine into view.
  useEffect(() => {
    if (buildStep == null) return;
    const st = buildStepList[buildStep];
    if (st?.kind === 'machine') focusForBuild(st.nodeId);
  }, [buildStep]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the canvas, viewing a shared flow or clearing it ends build mode.
  useEffect(() => { if (page !== 'canvas' || viewing || !nodes.length) setBuildStep(null); }, [page, viewing, nodes.length]);
  const startBuild = () => { setSidebarOpen(false); setSelected(new Set()); setSelectMode(false); setBuildStep(0); };

  const highlight = useMemo(() => {
    if (buildFocus) return buildFocus;
    if (!hover || hoverMode === 'off' || draggingNodeId || panning || linkDrag?.active) return null;
    const litNodes = new Set<string>();
    const litConns = new Set<string>();
    const walk = (start: string, dir: 'up' | 'down') => {
      const stack = [start];
      const seen = new Set<string>([start]);
      while (stack.length) {
        const id = stack.pop()!;
        for (const c of connections) {
          const [from, to] = dir === 'up' ? [c.targetInstanceId, c.sourceInstanceId] : [c.sourceInstanceId, c.targetInstanceId];
          if (from !== id) continue;
          litConns.add(c.id);
          litNodes.add(to);
          if (!seen.has(to)) { seen.add(to); stack.push(to); }
        }
      }
    };
    if (hover.kind === 'node') {
      litNodes.add(hover.id);
      if (hoverMode === 'chain') { walk(hover.id, 'up'); walk(hover.id, 'down'); } else {
        for (const c of connections) {
          if (c.sourceInstanceId === hover.id || c.targetInstanceId === hover.id) {
            litConns.add(c.id);
            litNodes.add(c.sourceInstanceId);
            litNodes.add(c.targetInstanceId);
          }
        }
      }
    } else {
      const c = connections.find((x) => x.id === hover.id);
      if (!c) return null;
      litConns.add(c.id);
      litNodes.add(c.sourceInstanceId);
      litNodes.add(c.targetInstanceId);
      if (hoverMode === 'chain') { walk(c.sourceInstanceId, 'up'); walk(c.targetInstanceId, 'down'); }
    }
    return { nodes: litNodes, conns: litConns };
  }, [buildFocus, hover, hoverMode, connections, draggingNodeId, panning, linkDrag?.active]);
  const onNodeHover = useCallback((n: CanvasNode | null) => requestHover(n ? { kind: 'node', id: n.instanceId } : null), [requestHover]);

  // ---------------------------------------------------------------- sidebar totals
  const sidebarData = useMemo(() => {
    const nodes = logicNodes; // positions don't matter here: skip recomputing while dragging
    const raw = rawInputUsage(nodes, connections, flows);
    type Out = { item: RecipeItem; produced: number; consumed: number; producers: Map<string, number>; users: CanvasNode[] };
    const outs = new Map<string, Out>();
    for (const n of nodes) {
      const f = flows.nodes.get(n.instanceId);
      if (!f || isPort(n)) continue;
      for (const o of n.recipe.outputs) {
        const e = outs.get(o.id) ?? { item: o, produced: 0, consumed: 0, producers: new Map(), users: [] };
        const rate = perCycle(o, f.stats) * f.cyclesPerSec;
        e.produced += rate;
        e.producers.set(n.instanceId, (e.producers.get(n.instanceId) ?? 0) + rate); // surplus per producer, reduced below
        outs.set(o.id, e);
      }
    }
    for (const c of connections) {
      const e = outs.get(c.sourceItemId);
      const cf = flows.connections.get(c.id);
      if (e && cf) {
        e.consumed += cf.needed;
        e.producers.set(c.sourceInstanceId, (e.producers.get(c.sourceInstanceId) ?? 0) - cf.needed);
      }
    }
    // Machines on the canvas that could use each output but aren't fed it by any producer yet.
    for (const e of outs.values()) {
      for (const n of nodes) {
        if (isPort(n) || e.producers.has(n.instanceId)) continue;
        const inp = nodeInputs(n, machineStats(n)).find((i) => i.consumed !== false && itemsMatch(i, e.item));
        if (!inp) continue;
        const fed = connections.some((c) => c.targetInstanceId === n.instanceId && c.targetItemId === inp.id && e.producers.has(c.sourceInstanceId));
        if (!fed) e.users.push(n);
      }
    }
    const supplies = nodes.filter(isSupply).map((n) => ({ node: n, used: flows.nodes.get(n.instanceId)?.outputRates[n.recipe.outputs[0].id] ?? 0 }));
    return { rawInputs: [...raw.values()], outputs: [...outs.values()], supplies };
  }, [logicNodes, connections, flows]);

  const viewPan = dragPan.current ?? pan; // renders mid-pan must not snap back to the old pan
  // The canvas area currently on screen, in canvas coordinates (window size is close enough).
  const viewBox = { x0: -viewPan.x / zoom, y0: -viewPan.y / zoom, x1: (window.innerWidth - viewPan.x) / zoom, y1: (window.innerHeight - viewPan.y) / zoom };
  const eutStatus = !budgetOn ? 'ok' : flows.euConsumed > budget ? 'danger' : flows.euConsumed >= budget * 0.9 ? 'warning' : 'ok';
  const netEU = flows.euGenerated - flows.euConsumed;
  const powerPositive = flows.euGenerated > 0 && netEU >= -1e-6;
  const searchNode = search?.nodeId ? nodeById.get(search.nodeId) ?? null : null;

  /**
   * The saved-flows list (Open, rename, export, share, delete). Shown in full on the Builds
   * page's Your builds tab, and the latest few in the profile window.
   */
  /** Machines to build and kinds of machine for a saved flow, solved once per saved version. */
  const totalsCache = useRef(new Map<string, { at: number; totals: { machines: number; types: number } }>());
  const saveTotals = (entry: SavedFlow) => {
    const hit = totalsCache.current.get(entry.id);
    if (hit && hit.at === entry.savedAt) return hit.totals;
    const totals = machineTotals(entry.nodes, entry.connections);
    totalsCache.current.set(entry.id, { at: entry.savedAt, totals });
    return totals;
  };
  /** Replace the shared copy on Community with this saved version (after a confirm). */
  const handleUpdateShare = (entry: SavedFlow, build: Build) => setConfirm({
    title: 'Update shared flow',
    body: `Replace "${build.name}" on Community with your current version? Its votes, comments and link stay.`,
    actions: [{ label: 'Update', kind: 'primary', run: () => {
      const flow = { nodes: entry.nodes, connections: entry.connections, targetEUtBudget: entry.targetEUtBudget };
      updateSharedBuild(build, flow, analyzeFlow(entry.nodes, entry.connections).stats)
        .then(() => setToast(`Updated "${build.name}" on Community`))
        .catch((e: Error) => setToast(e.message));
    } }],
  });
  /** My flows: Share; Shared once it's on Community; Update shared if it has changed since. */
  const shareButton = (entry: SavedFlow, isCurrent: boolean) => {
    const build = sharedBuilds.get(entry.id);
    if (build && flowSignature(entry) !== flowSignature(build.flow)) {
      return (
        <button onClick={() => handleUpdateShare(entry, build)} className="px-1.5 py-0.5 border border-emerald-500 bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-bold inline-flex items-center gap-1" data-tip="You've changed it since sharing: update Community">
          <Share2 className="w-3 h-3" /> Update shared
        </button>
      );
    }
    return sharedFlowIds.has(entry.id)
    ? <span className="px-1.5 py-0.5 border border-emerald-800/60 text-emerald-300/70 text-[10px] inline-flex items-center gap-1" data-tip="Already on Community"><Share2 className="w-3 h-3" /> Shared</span>
    : (
      <button onClick={() => handleShare(isCurrent ? undefined : entry)} className="px-1.5 py-0.5 border border-emerald-500 bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-bold inline-flex items-center gap-1" data-tip="Share this flow to Community">
        <Share2 className="w-3 h-3" /> Share
      </button>
    );
  };
  // Bottom toolbar: labels off when the controls would wrap; back on once the space they took is free.
  useLayoutEffect(() => {
    const row = toolRow.current;
    if (!row) return;
    const update = () => {
      const beside = window.innerWidth - 12 - (energyW + (sidebarOpen ? 432 : 12) + 24);
      const above = beside < 440 && window.innerWidth >= 768; // would wrap or nearly touch
      setToolAbove(above);
      const avail = above ? window.innerWidth - 24 - (sidebarOpen ? 432 : 0) : beside;
      if (toolWide) {
        const kids = [...row.children] as HTMLElement[];
        const needs = kids.reduce((a, k) => a + k.offsetWidth, 0) + 6 * Math.max(0, kids.length - 1);
        if (needs > avail) { toolNeeds.current = needs; setToolWide(false); }
      } else if (avail >= toolNeeds.current) setToolWide(true);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [energyW, sidebarOpen, toolWide, showLabels, hoverMode, page, viewing]);

  // Header labels: on the canvas they give way to the toolbar below 1536 px; elsewhere they show from 1280 px.
  const navLabel = page === 'canvas' ? 'hidden 2xl:inline' : 'hidden xl:inline';

  const renderSaves = ({ limit, full, onlyCurrent }: { limit?: number; full?: boolean; onlyCurrent?: boolean }) => (
            <div className="space-y-2">
              {full && (<>
              <div className="flex gap-1.5">
                <button onClick={handleQuickSave} className="flex-1 py-1.5 bg-[#1b2a22] hover:bg-[#233b2e] text-emerald-300 border border-emerald-500/40 text-xs font-bold" data-tip={currentSave && !currentSave.draft ? `Save over "${currentSave.name}"` : 'Save this flow under a name'}>
                  Save
                </button>
                <button onClick={openSaveAsDialog} className="flex-1 py-1.5 bg-[#16221c] hover:bg-[#233b2e] text-emerald-300/90 border border-emerald-500/40 text-xs font-bold" data-tip="Save a copy under a new name">
                  Save as…
                </button>
                <button onClick={handleNewFlow} className="px-3 py-1.5 bg-[#1a202c] hover:bg-[#252f40] text-slate-300 border border-[#2b3548] text-xs font-bold" data-tip="Start a new, empty flow">
                  New flow
                </button>
              </div>
              </>)}
              {(onlyCurrent ? !saves.some((s) => s.id === currentSave?.id) : saves.length === 0) ? (
                <div className="text-slate-500 text-xs italic p-1">{onlyCurrent ? 'No flow open yet. It saves automatically as you build.' : 'No saved flows yet. Flows save automatically as you build.'}</div>
              ) : (
                [...saves].filter((s) => !onlyCurrent || s.id === currentSave?.id).sort((a, b) => b.savedAt - a.savedAt).slice(0, limit).map((entry) => {
                  const isCurrent = currentSave?.id === entry.id;
                  const target = entry.nodes.find((n) => n.isTarget);
                  const totals = saveTotals(entry);
                  return (
                    <div
                      key={entry.id}
                      className={`border p-2 text-xs space-y-1 ${isCurrent ? 'border-cyan-500/60 bg-cyan-950/20' : 'border-[#222a3b] bg-[#12151e]'}`}
                    >
                      {/* [Open] [Draft]  ...  actions */}
                      <div className="flex items-center gap-1">
                        <button
                          // The open flow just takes you back to the canvas (from Community or the profile).
                          onClick={(e) => { e.stopPropagation(); if (isCurrent) { setProfileOpen(false); setPage('canvas'); } else handleLoadSave(entry); }}
                          disabled={isCurrent && page === 'canvas' && !profileOpen}
                          className={`px-2 py-0.5 border text-[11px] font-bold ${isCurrent ? 'border-cyan-400 bg-cyan-900/70 text-cyan-100 disabled:cursor-default' : 'border-cyan-700/40 text-cyan-400/60 hover:border-cyan-400 hover:text-cyan-200 hover:bg-cyan-950'}`}
                          data-tip={isCurrent ? 'This flow is open' : 'Open this flow (the open one is saved first)'}
                        >
                          Open
                        </button>
                        {entry.draft && <span className="px-2 py-0.5 border border-slate-600 text-slate-400 text-[11px] font-bold uppercase" data-tip="Untitled: rename it to give it a name">draft</span>}
                        <span className="ml-auto flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setRenaming({ id: entry.id, name: entry.name })} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-300 hover:text-slate-100 text-[10px]">Rename</button>
                          <button onClick={() => exportFlowJson(entry)} className="hidden md:inline-block px-1.5 py-0.5 border border-sky-700/50 text-sky-300 hover:bg-sky-950 text-[10px]" data-tip="Download this save as a .json file">.json</button>
                          {/* Sharing lives on the Community page (My flows), not in the profile window. */}
                          {full && shareButton(entry, isCurrent)}
                          {isCurrent && <button onClick={() => setExportPanel(true)} className="px-1.5 py-0.5 border border-sky-700/50 text-sky-300 hover:bg-sky-950 text-[10px]" data-tip="Download a picture of this flow">Image</button>}
                          <button onClick={() => handleDeleteSave(entry)} className="px-1.5 py-0.5 border border-rose-700/50 text-rose-300 hover:bg-rose-950 text-[10px]">Delete</button>
                        </span>
                      </div>
                      {/* Name (24 chars) ... last edited */}
                      <div className="flex items-baseline gap-2">
                        {renaming?.id === entry.id ? (
                          <input
                            autoFocus
                            value={renaming.name}
                            maxLength={64}
                            onChange={(e) => setRenaming({ id: entry.id, name: e.target.value })}
                            onBlur={() => handleRenameSave(entry.id, renaming.name)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameSave(entry.id, renaming.name);
                              if (e.key === 'Escape') setRenaming(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 bg-[#0f131c] border border-cyan-500/60 px-1.5 py-0.5 text-slate-100 font-bold outline-none"
                          />
                        ) : (
                          <span className="text-slate-100 font-bold min-w-0 flex-1 truncate" data-tip={entry.name.length > 24 ? entry.name : undefined}>{entry.name.length > 24 ? `${entry.name.slice(0, 23)}…` : entry.name}</span>
                        )}
                        <span className="text-[10px] text-slate-500 whitespace-nowrap" data-tip={new Date(entry.savedAt).toLocaleString()}>Last edited: {formatEdited(entry.savedAt)}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">Machines: <span className="text-slate-200 font-bold">{totals.machines}</span> <span className="text-slate-500">· {totals.types} type{totals.types === 1 ? '' : 's'}</span></div>
                      {entry.origin && (entry.origin.example || !user || entry.origin.authorId !== user.uid) && (
                        <div className="text-[10px] text-slate-400">Original creator: <span className="text-pink-300 font-bold">{entry.origin.author}</span>{entry.origin.example ? ' (example)' : ''}</div>
                      )}
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 min-w-0">
                        Output:
                        {target ? (
                          <>
                            <ItemIcon id={target.recipe.outputs[0]?.id ?? ''} color={target.recipe.outputs[0]?.iconColor} size={12} />
                            <span className="text-slate-200 font-bold truncate" data-tip-cut="" data-tip={target.recipe.outputs.find((o) => o.id === target.targetRate?.itemId)?.name ?? target.recipe.outputs[0]?.name ?? target.recipe.recipeName}>{target.recipe.outputs.find((o) => o.id === target.targetRate?.itemId)?.name ?? target.recipe.outputs[0]?.name ?? target.recipe.recipeName}</span>
                          </>
                        ) : <span className="text-slate-500 italic">no target</span>}
                      </div>
                    </div>
                  );
                })
              )}
              {full && (<>
              <div className="flex gap-1.5 pt-1">
                <button onClick={exportAllSaves} disabled={!saves.length} className="flex-1 py-1 border border-sky-700/50 text-sky-300 hover:bg-sky-950 text-[11px] font-bold disabled:opacity-40">Export all (.json)</button>
                <button onClick={() => setImportOpen(true)} className="flex-1 py-1 border border-emerald-700/50 text-emerald-300 hover:bg-emerald-950 text-[11px] font-bold">Import .json…</button>
              </div>
              <div className="text-[10px] text-slate-500 pt-1">Flows save automatically and live in this browser only. Export them to keep a copy or move them to another computer; open a save to export it as an image.</div>
              </>)}
            </div>
  );

  // ---------------------------------------------------------------- render
  return (
    <div className={`flex flex-col h-screen w-screen bg-[#11141c] text-slate-100 select-none overflow-clip ${pixelFont ? 'pixel-font-all' : 'font-mono'}`} onContextMenu={(e) => e.preventDefault()}>
      {/* TOP BAR */}
      <header className="h-11 border-b border-[#252c3d] bg-[#161a24] px-2 md:px-3 flex items-center justify-between z-40 relative flex-shrink-0 text-xs gap-2 md:gap-3 whitespace-nowrap">
        <h1 className="sr-only">gtcalc: GregTech calculator and factory planner</h1>
        <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
          <div className="flex items-center gap-1.5 font-bold text-slate-200 uppercase tracking-wider text-xs flex-shrink-0">
            <img src="/favicon.svg" alt="gtcalc" className="w-7 h-7 flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
            <Dropdown
              label={<span className="font-pixel-bold text-xs sm:text-sm uppercase">{MODPACKS.find((m) => m.id === PACK)?.name}</span>}
              className="bg-[#141822] border-cyan-500/30 hover:border-cyan-400/70 text-cyan-400"
              tip="Modpack: each keeps its own recipes, canvas and saves"
            >
              {(close) => <>
                {MODPACKS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { close(); switchPack(m.id); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-[#202737] ${m.id === PACK ? 'text-cyan-300' : 'text-slate-200'}`}
                  >
                    <div className="font-bold">{m.name}{m.id === PACK ? ' ✓' : ''}</div>
                    <div className="text-[10px] text-slate-500">
                      {packInfo[m.id] ? `${packInfo[m.id].recipes.toLocaleString()} recipes` : m.id === PACK && db ? `${db.recipes.length.toLocaleString()} recipes` : 'not imported yet'}
                    </div>
                  </button>
                ))}
                <button onClick={() => { close(); setSuggestOpen(true); }} className="w-full text-left px-3 py-1.5 border-t border-[#283244] hover:bg-[#202737] text-fuchsia-300 font-bold">+ Suggest a pack</button>
              </>}
            </Dropdown>
            <button
              onClick={openGuide}
              className="h-7 hidden md:flex items-center gap-1.5 px-2.5 bg-fuchsia-950/70 hover:bg-fuchsia-900/70 border border-fuchsia-500/70 text-fuchsia-200 text-xs font-bold normal-case tracking-normal"
              data-tip="Guide: how everything works" aria-label="Guide"
            >
              <BookOpen className="w-3.5 h-3.5" /> <span className={navLabel}>Guide</span>
            </button>
            {page === 'builds' && (
              <button
                onClick={() => setPage('canvas')}
                className="h-7 flex items-center gap-1 px-2 sm:px-2.5 border text-xs font-bold normal-case tracking-normal bg-[#1b2230] hover:bg-[#253147] border-cyan-500/50 text-cyan-200"
                data-tip="Back to your flow on the canvas" aria-label="Back to flow"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> <span className="sm:hidden">Flow</span><span className="hidden sm:inline">Back to flow</span>
              </button>
            )}
            {([['list', 'Community', Users, 'Community: browse, vote on, favourite and share flows'], ['mine', 'My flows', FolderOpen, 'My flows: your saved flows and the ones you have shared']] as const).map(([t, label, Icon, tip]) => {
              const on = page === 'builds' && (t === 'list' ? buildsTab !== 'mine' : buildsTab === 'mine');
              return (
                <button
                  key={t}
                  onClick={() => { exitView(); setLinkedFlow(null); setBuildsTab(t); setPage('builds'); setNavKey((k) => k + 1); }}
                  className={`h-7 flex items-center gap-1.5 px-2 sm:px-2.5 border text-xs font-bold normal-case tracking-normal ${on ? 'bg-pink-900/80 border-pink-300 text-pink-100' : 'bg-pink-950/60 hover:bg-pink-900/60 border-pink-500/60 text-pink-200'}`}
                  data-tip={tip} aria-label={label}
                >
                  <Icon className="w-3.5 h-3.5" /> <span className={navLabel}>{label}</span>
                </button>
              );
            })}
          </div>
          {page === 'canvas' && !viewing && !building && (<>
          <div className="hidden md:block h-4 w-[1px] bg-slate-700/60 mx-1.5 flex-shrink-0" />
          <ScrollRow className="hidden md:flex flex-1">
          {(wide) => (<>
          <span className="hidden md:block flex-shrink-0">
          <Dropdown
            label={
              <span className={`text-[11px] font-bold whitespace-nowrap ${AUTO_MODES[autoMode].text}`}>
                {AUTO_MODES[autoMode].label}{alwaysRunning ? <span className="text-violet-300"> · 24/7</span> : null}
              </span>
            }
            className={AUTO_MODES[autoMode].box}
            tip="How Auto Ratio picks tiers"
          >
            {() => (
              <>
                {(Object.keys(AUTO_MODES) as (keyof typeof AUTO_MODES)[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAutoMode(m)}
                    className={`w-full text-left px-3 py-1.5 border-l-2 ${autoMode === m ? `${AUTO_MODES[m].box} ${AUTO_MODES[m].text}` : 'border-transparent text-slate-300 hover:bg-[#202737]'}`}
                  >
                    <div className="font-bold">{AUTO_MODES[m].label}</div>
                    <div className="text-[10px] text-slate-500 leading-snug">{AUTO_MODES[m].help}</div>
                  </button>
                ))}
                <div className="border-t border-[#283244] my-1" />
                <label className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#202737]">
                  <input type="checkbox" checked={alwaysRunning} onChange={(e) => setAlwaysRunning(e.target.checked)} className="mt-0.5 accent-violet-400" />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold text-violet-200">Always Running (24/7)</span>
                    <span className="block text-[10px] text-slate-500 leading-snug">The target runs whole machines non-stop; everything upstream is sized to feed it.</span>
                  </span>
                </label>

              </>
            )}
          </Dropdown>
          </span>
          <span className="hidden md:flex flex-shrink-0 h-7">
            <button onClick={() => handleAutoRatio()} data-tip={autoLock ? 'Locked on: reruns when machines or links change' : 'Pick the best tier for every machine'} className={`flex items-center gap-1 px-2.5 py-1 hover:bg-[#223048] text-cyan-300 border border-cyan-500/40 text-xs font-bold transition ${autoLock ? 'bg-[#223048] text-cyan-100' : 'bg-[#1a2333]'}`}>
              ⚡ <span className="hidden xl:inline">Auto Ratio</span>
            </button>
            <button
              onClick={() => setAutoLock((v) => !v)}
              disabled={manualCounts}
              className={`flex items-center px-1.5 border border-l-0 border-cyan-500/40 transition disabled:opacity-40 disabled:pointer-events-auto ${autoLock ? 'bg-cyan-800/70 text-cyan-100' : 'bg-[#161e2c] text-cyan-400/70 hover:bg-[#223048] hover:text-cyan-200'}`}
              data-tip={manualCounts ? 'Off while Manual counts is on (top left of the canvas)' : autoLock ? 'Unlock Auto Ratio' : 'Lock on: rerun Auto Ratio after every change'} aria-label="Lock Auto Ratio" aria-pressed={autoLock}
            >
              {autoLock ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
            </button>
          </span>
          <button onClick={handleMaxFlow} data-tip="Max Flow: raise the target as far as your limits allow" aria-label="Max Flow" className="hidden md:flex flex-shrink-0 items-center gap-1 px-2.5 py-1 bg-[#26201a] hover:bg-[#382d22] text-amber-300 border border-amber-500/40 text-xs font-bold transition">
            <TripleChevron className="w-4 h-3.5" />{wide && <span>Max Flow</span>}
          </button>
          <button onClick={handleAutoConnect} data-tip="Link every input to the machines that make it" aria-label="Auto Connect" className="hidden md:flex flex-shrink-0 items-center gap-1 px-2.5 py-1 bg-[#19262e] hover:bg-[#20343f] text-emerald-300 border border-emerald-500/40 text-xs font-bold transition">
            <Link2 className="w-3.5 h-3.5" />{wide && <span>Auto Connect</span>}
          </button>
          <button onClick={handleClearLinks} disabled={!connections.length} data-tip="Remove every link" aria-label="Clear links" className="hidden md:flex flex-shrink-0 items-center gap-1 px-2.5 py-1 bg-[#261a1e] hover:bg-[#3a2229] text-rose-300 border border-rose-500/40 text-xs font-bold transition disabled:opacity-40">
            <Unlink className="w-3.5 h-3.5" />{wide && <span>Clear links</span>}
          </button>
          <button onClick={handleRemoveNoDemand} disabled={!noDemandIds.size} data-tip={noDemandIds.size ? `Remove ${noDemandIds.size} unused machine${noDemandIds.size === 1 ? '' : 's'} (greyed out)` : 'Every machine is in use'} aria-label="Remove unused" className="hidden md:flex flex-shrink-0 items-center gap-1 px-2.5 py-1 bg-[#261a1e] hover:bg-[#3a2229] text-rose-300 border border-rose-500/40 text-xs font-bold transition disabled:opacity-40 whitespace-nowrap">
            <Trash2 className="w-3.5 h-3.5" />{wide && <span>Remove unused</span>}{noDemandIds.size ? ` ${noDemandIds.size}` : ''}
          </button>
          </>)}
          </ScrollRow>
          </>)}
          {dbState.status === 'loading' && <span className="hidden md:inline text-slate-500 text-[11px]">Loading recipes…</span>}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {page === 'canvas' && !viewing && !building && (<>
          <div className="hidden md:flex h-7">
            <button
              onClick={handleNewFlow}
              data-tip="Start a new, empty flow" aria-label="New flow"
              className="flex items-center gap-1 px-2 py-1 bg-[#1a202c] hover:bg-[#252f40] text-slate-200 border border-[#2b3548] text-xs font-bold transition"
            >
              <Plus className="w-3.5 h-3.5" /> <span className="hidden 2xl:inline">New flow</span>
            </button>
            {/* Save / Saved: saving is manual; the canvas itself survives a refresh either way */}
            <button
              onClick={handleQuickSave}
              data-tip={dirty ? (currentSave && !currentSave.draft ? `Save changes to "${currentSave.name}" (Ctrl+S; Ctrl+Shift+S saves a copy)` : 'Save this flow under a name (Ctrl+S)') : 'Everything is saved'} aria-label={dirty ? 'Save' : 'Saved'}
              className={`relative -ml-px flex items-center gap-1 px-2.5 py-1 border text-xs font-bold transition ${dirty ? 'bg-emerald-800 hover:bg-emerald-700 text-white border-emerald-400' : 'bg-[#16221c] text-emerald-300/80 border-emerald-500/70'}`}
            >
              <Save className="w-3.5 h-3.5" /> <span className="hidden 2xl:inline">{dirty ? 'Save' : 'Saved'}</span>
            </button>
            {user && <CloudIcon />}
          </div>
          <div className="relative hidden md:flex h-7">
            <button
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 bg-[#1c2638] hover:bg-[#253550] text-sky-300 border border-sky-500/40 text-xs font-bold transition"
              data-tip="Import .json flows (ours or GTNH Planner)" aria-label="Import"
            >
              <Upload className="w-3.5 h-3.5" /> <span className="hidden 2xl:inline">Import</span>
            </button>
            <button
              onClick={() => setExportMenu((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 bg-[#18202f] hover:bg-[#253550] text-sky-300/90 border border-l-0 border-sky-500/40 text-xs font-bold transition"
              data-tip="Export this flow as a file or an image" aria-label="Export"
            >
              <Download className="w-3.5 h-3.5" /> <span className="hidden 2xl:inline">Export</span> <ChevronDown className="w-3 h-3" />
            </button>
            {exportMenu && (
              <>
                <div className="fixed inset-0 z-40" onMouseDown={() => setExportMenu(false)} />
                <div className="absolute right-0 top-8 z-50 w-80 bg-[#161a24] border border-[#2b3548] shadow-2xl text-xs py-1">
                  <button onClick={() => { setExportMenu(false); exportFlowJson({ nodes, connections, targetEUtBudget: budget, origin: currentOrigin }); }} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#202737] text-slate-200 text-left">
                    <FileJson className="w-3.5 h-3.5 text-sky-300" /> This flow (.json)
                  </button>
                  <button onClick={() => { setExportMenu(false); setExportPanel(true); }} disabled={!nodes.length} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#202737] text-slate-200 text-left disabled:opacity-40">
                    <ImageIcon className="w-3.5 h-3.5 text-sky-300" /> This flow as an image…
                  </button>
                  <button onClick={() => { setExportMenu(false); exportAllSaves(); }} disabled={!saves.length} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#202737] text-slate-200 text-left disabled:opacity-40">
                    <Download className="w-3.5 h-3.5 text-sky-300" /> All saves ({saves.length}) (.json)
                  </button>
                  <button onClick={() => { setExportMenu(false); exportBuildList(); }} disabled={!nodes.length} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#202737] text-slate-200 text-left disabled:opacity-40" data-tip="Machines to build (in the Machines tab's sort) with EU/t totals">
                    <Factory className="w-3.5 h-3.5 text-sky-300" /> Machine list (.txt)
                  </button>
                  <button onClick={() => { setExportMenu(false); setBuildPanel(true); }} disabled={!nodes.length} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#202737] text-slate-200 text-left disabled:opacity-40" data-tip="The Machines tab as a picture">
                    <ImageIcon className="w-3.5 h-3.5 text-sky-300" /> Build list as an image…
                  </button>
                  <div className="border-t border-[#283244] my-1" />
                  <button onClick={() => { setExportMenu(false); setImportOpen(true); }} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#202737] text-slate-200 text-left">
                    <Upload className="w-3.5 h-3.5 text-emerald-300" /> Import .json files…
                  </button>
                </div>
              </>
            )}
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              multiple
              onChange={(e) => { void handleImportFiles([...(e.target.files ?? [])]); e.target.value = ''; }}
            />
          </div>
          <button
            onClick={handleShareLink}
            className="hidden md:flex flex-shrink-0 h-7 items-center gap-1 px-2.5 py-1 bg-pink-950/60 hover:bg-pink-900/60 text-pink-200 border border-pink-500/50 text-xs font-bold transition"
            data-tip={currentSave && sharedFlowIds.has(currentSave.id) ? 'Copy the link to this flow on Community' : 'Share this flow to Community and copy its link'} aria-label="Share"
          >
            <Share2 className="w-3.5 h-3.5" /> <span className="hidden 2xl:inline">Share</span>
          </button>
          <button
            onClick={() => {
              // First click shows the whole flow; clicking again (while it's showing) goes to 100% on its centre.
              const all = new Set(nodes.map((n) => n.instanceId));
              const fit = fitView(all);
              const fitted = fit && Math.abs(zoom - fit.zoom) < 0.005 && Math.hypot(pan.x - fit.pan.x, pan.y - fit.pan.y) < 4;
              if (fit && !fitted) fitNodes(all); else centreFlow();
            }}
            className="hidden md:block px-2 py-1 bg-[#1a202c] hover:bg-[#252f40] border border-[#2b3548] text-slate-300 text-xs font-bold h-7"
            data-tip="Show the whole flow; click again for 100% on its centre"
          >
            {Math.round(zoom * 100)}%
          </button>
          {/* Phones: everything else in one menu (viewing first; building is a desktop thing) */}
          <span className="md:hidden">
            <Dropdown label={<span className="text-[11px] font-bold">Menu</span>} className="bg-[#1b2230] border-[#2b3548] text-slate-200" tip="More">
              {(close) => {
                // Same colours as the desktop buttons, so the menu reads the same way.
                const item = (label: string, run: () => void, tone: string, disabled = false) => (
                  <button key={label} disabled={disabled} onClick={() => { close(); run(); }} className={`w-full text-left px-3 py-2 border-l-2 border-transparent hover:bg-[#202737] font-bold disabled:opacity-40 ${tone}`}>{label}</button>
                );
                return (
                  <>
                    <div className="mx-2 mb-1 px-2 py-1.5 border border-amber-600/50 bg-amber-950/40 text-amber-200 text-[10px] leading-snug">
                      Phones are for viewing flows and builds. Use a desktop or laptop to create and edit flows.
                    </div>
                    {item('Fit flow to screen', () => fitNodes(new Set(nodes.map((n) => n.instanceId))), 'text-cyan-300 hover:border-cyan-400', !nodes.length)}
                    {item('Community', () => { exitView(); setLinkedFlow(null); setBuildsTab('list'); setPage('builds'); setNavKey((k) => k + 1); }, 'text-pink-300 hover:border-pink-400')}
                    {item('Guide', openGuide, 'text-fuchsia-300 hover:border-fuchsia-400')}
                    <div className="border-t border-[#283244] my-1" />
                    <div className="px-3 pt-1 text-[10px] uppercase tracking-wider text-slate-500">Auto Ratio mode</div>
                    {(Object.keys(AUTO_MODES) as (keyof typeof AUTO_MODES)[]).map((m) => (
                      <button key={m} onClick={() => setAutoMode(m)} className={`w-full text-left px-3 py-1.5 border-l-2 font-bold ${autoMode === m ? `${AUTO_MODES[m].box} ${AUTO_MODES[m].text}` : 'border-transparent text-slate-400 hover:bg-[#202737]'}`}>
                        {autoMode === m ? '● ' : '○ '}{AUTO_MODES[m].label}
                      </button>
                    ))}
                    {item('⚡ Auto Ratio', () => handleAutoRatio(), 'text-cyan-300 hover:border-cyan-400', !nodes.length)}
                    {item('Max Flow', handleMaxFlow, 'text-amber-300 hover:border-amber-400', !nodes.length)}
                    {item(`Remove unused${noDemandIds.size ? ` (${noDemandIds.size})` : ''}`, handleRemoveNoDemand, 'text-rose-300 hover:border-rose-400', !noDemandIds.size)}
                    <div className="border-t border-[#283244] my-1" />
                    {item('New flow', handleNewFlow, 'text-emerald-300 hover:border-emerald-400')}
                    {item('Save as…', openSaveAsDialog, 'text-emerald-300 hover:border-emerald-400', !nodes.length)}
                    {item('Export image…', () => setExportPanel(true), 'text-sky-300 hover:border-sky-400', !nodes.length)}
                    {item(pixelFont ? 'Normal font' : 'Pixel font', () => setPixelFont((v) => !v), 'text-slate-300 hover:border-slate-400')}
                  </>
                );
              }}
            </Dropdown>
          </span>
          <span className="relative">
            <button onClick={() => { setPanelHint(false); setSidebarOpen((v) => !v); }} className={`p-1.5 bg-[#1b2230] hover:bg-[#253147] text-cyan-300 border transition h-7 flex items-center justify-center ${panelHint ? 'border-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.5)]' : 'border-cyan-500/40'}`} data-tip="Side panel: balances, machines, saves" aria-label="Side panel: balances, machines, saves">
              <Menu className="w-4 h-4" />
            </button>
            {panelHint && (
              <button onClick={() => setPanelHint(false)} className="absolute right-0 top-full mt-2.5 z-40 w-52 text-left text-[11px] whitespace-normal leading-snug normal-case tracking-normal text-cyan-100 bg-[#161a24] border border-cyan-400/70 px-2.5 py-2 shadow-2xl">
                <span className="absolute -top-[6px] right-2.5 w-2.5 h-2.5 rotate-45 bg-[#161a24] border-l border-t border-cyan-400/70" />
                Open Balances and Machines here: raw inputs, outputs and what each machine needs.
                <span className="block mt-1 text-slate-500">Tap to dismiss</span>
              </button>
            )}
          </span>
          </>)}
          <div className="relative">
            <button
              onClick={() => setProfileOpen(true)}
              className={`h-7 w-7 flex items-center justify-center border transition ${user ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300' : 'bg-[#1b2230] border-[#2b3548] text-slate-300 hover:text-cyan-300'}`}
              data-tip={user ? `${user.username}: profile and saved flows` : 'Profile and saved flows (log in to sync and share)'} aria-label={user ? `Profile: ${user.username}` : 'Profile'}
            >
              <PixelIcon name="user" className="w-4 h-4" />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-rose-600 border border-rose-300 text-white text-[9px] font-bold leading-none" data-tip={`${unread} new on your shared flows`}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {dbState.status === 'error' && (
        <div className="bg-rose-950/80 border-b border-rose-700 text-rose-200 text-xs px-3 py-1.5 z-30">{dbState.message}</div>
      )}
      {flows.unstable && (
        <div className="bg-amber-950/80 border-b border-amber-700 text-amber-200 text-xs px-3 py-1.5 z-30">
          The solver couldn't balance this flow exactly, so some numbers may be off. Check recycling loops, or pinned counts that can't be met.
        </div>
      )}

      {page === 'builds' && (
        <BuildsPage
          pack={PACK}
          user={user}
          tab={buildsTab}
          onTab={setBuildsTab}
          yourFlows={renderSaves({ full: true })}
          examples={examples}
          onError={showError}
          onOpenFlow={editOrCopy}
          onViewFlow={openView}
          isOwnFlow={(b) => !!ownSaveFor(b)}
          onExport={(b) => exportFlowJson({ name: b.name, ...b.flow, origin: (b.flow as { origin?: FlowOrigin }).origin ?? (b.example ? { author: b.author, example: true } : { author: b.author, authorId: b.authorId, buildId: b.id }) })}
          onNeedLogin={(reason) => setAuthPrompt({ reason })}
          shareChoices={saves.filter((x) => x.nodes.length).map((x) => ({
            id: x.id,
            name: x.name,
            machines: x.nodes.length,
            open: x.id === currentSave?.id,
            blocked: sharedFlowIds.has(x.id) ? 'Already shared'
              : x.origin?.example ? 'Example'
              : x.origin && x.origin.authorId !== user?.uid ? `By ${x.origin.author}` : undefined,
          }))}
          onShareFlow={(id) => (id === currentSave?.id ? handleShare() : handleShare(saves.find((x) => x.id === id)))}
          navKey={navKey}
          jump={jump}
          initialFlowId={linkedFlow}
          onViewing={showFlowInUrl}
        />
      )}
      {/* CANVAS (hidden, so not drawn, while the Builds page is open) */}
      <div
        ref={canvasRef}
        role="main"
        aria-label="Flow canvas"
        className={`flex-1 relative blueprint-grid overflow-clip ${viewOnly || viewing || building ? 'view-only' : ''} ${page === 'builds' ? 'hidden' : ''} ${panning ? 'cursor-grabbing' : selectMode && !spaceMove ? 'cursor-crosshair' : 'cursor-grab'} ${panning || draggingNodeId ? 'wires-still' : ''} ${flowAnim ? 'flow-anim' : ''}`}
        style={{ backgroundSize: `${26 * zoom}px ${26 * zoom}px`, backgroundPosition: `${viewPan.x}px ${viewPan.y}px`, touchAction: 'none' }}
        onWheel={onWheel}
        onMouseDown={onCanvasMouseDown}
        onTouchStart={onCanvasTouchStart}
        onTouchMove={onCanvasTouchMove}
        onTouchEnd={onCanvasTouchEnd}
        onTouchCancel={() => { touch.current = null; }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!isBackground(e.target) || !db || viewing || building) return;
          const w = toWorld(e.clientX, e.clientY);
          setSearch({ mode: 'standalone', at: { x: w.x - 40, y: w.y - 40 } });
        }}
      >
        {marquee && (
          <div
            className="absolute z-30 pointer-events-none border border-cyan-400 bg-cyan-400/10"
            style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
          />
        )}
        {selected.size > 0 && (
          <div data-export-skip="" className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2 py-1.5 bg-[#161a24]/95 border border-cyan-500/50 shadow-2xl text-[11px] whitespace-nowrap" onMouseDown={(e) => e.stopPropagation()}>
            <span className="font-bold text-cyan-300 px-1">{selected.size} selected</span>
            <select
              value=""
              onChange={(e) => { if (e.target.value) bulkTier(e.target.value as VoltageTier); }}
              className="bg-[#171d2b] border border-[#2c374c] text-slate-200 px-1 py-0.5"
              data-tip="Set every selected machine to this tier (not below its base tier)" aria-label="Set every selected machine to this tier (not below its base tier)"
            >
              <option value="">Set tier…</option>
              {TIER_ORDER.slice(0, TIER_ORDER.indexOf(maxTier) + 1).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {[2, 3, 4].map((k) => (
              <button key={k} onClick={() => bulkMultiply(k)} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-200 hover:bg-[#202737] font-bold" data-tip={`Multiply the counts by ${k} and pin them`}>x{k}</button>
            ))}
            <button onClick={bulkConnect} className="px-1.5 py-0.5 border border-emerald-600/50 text-emerald-300 hover:bg-emerald-950 font-bold" data-tip="Link the selected machines to each other (only them)">Connect</button>
            <button onClick={bulkMaxFlow} className="px-1.5 py-0.5 border border-amber-600/50 text-amber-300 hover:bg-amber-950 font-bold" data-tip="Pin each selected machine to the most its linked inputs can feed">Max flow</button>
            <button onClick={copySelection} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-200 hover:bg-[#202737]" data-tip="Copy (Ctrl+C), paste with Ctrl+V">Copy</button>
            <button onClick={bulkDelete} className="px-1.5 py-0.5 border border-rose-600/50 text-rose-300 hover:bg-rose-950 font-bold" data-tip="Delete the selected nodes (Delete key)">Delete</button>
            <button onClick={() => setSelected(new Set())} className="px-1 text-slate-400 hover:text-slate-100" data-tip="Clear the selection (Esc)" aria-label="Clear the selection (Esc)"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
        {nodes.length === 0 && (
          // Until the cookie choice is made, its banner covers the bottom of a phone screen: sit above it.
          <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none ${consent === null ? 'pb-48 md:pb-0' : ''}`}>
            <div className="bg-[#161a24]/95 border-2 border-cyan-500/50 p-6 flex flex-col items-center gap-3 shadow-2xl pointer-events-auto" onMouseDown={(e) => e.stopPropagation()}>
              {viewOnly ? (
                // Phones only view flows, so the way in is Community, My flows and the Guide.
                <>
                  <span className="font-pixel-bold text-cyan-400 text-lg uppercase">GregTech calculator</span>
                  <p className="text-slate-400 text-xs text-center max-w-xs">
                    Explore flows on your phone: see what the community has built, open your own flows, or read the guide. Build and edit flows on a computer.
                  </p>
                  <div className="w-full grid gap-2">
                    <button onClick={() => { markWelcomed(); setBuildsTab('list'); setPage('builds'); }} className="px-4 py-3 bg-pink-950 hover:bg-pink-900 border-2 border-pink-400 text-pink-100 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                      <Users className="w-3.5 h-3.5" /> Explore Community
                    </button>
                    <button onClick={() => { markWelcomed(); setBuildsTab('mine'); setPage('builds'); }} className="px-4 py-3 bg-pink-950/60 hover:bg-pink-900/60 border-2 border-pink-500/60 text-pink-100 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                      <FolderOpen className="w-3.5 h-3.5" /> Explore your flows
                    </button>
                    <button onClick={openGuide} className="px-4 py-3 bg-fuchsia-950 hover:bg-fuchsia-900 border-2 border-fuchsia-400 text-fuchsia-100 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                      <BookOpen className="w-4 h-4" /> Check the Guide
                    </button>
                    {!user && (
                      <button onClick={() => { markWelcomed(); setAuthPrompt({}); }} className="px-4 py-2 bg-emerald-950 hover:bg-emerald-900 border border-emerald-400 text-emerald-100 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                        <PixelIcon name="user" className="w-4 h-4" /> Sign up
                      </button>
                    )}
                  </div>
                </>
              ) : (<>
              {!guideSeen && (
                // First launch: four ways in. Any of them counts as having seen this.
                <div className="w-full mb-2 grid grid-cols-2 gap-2">
                  <button onClick={() => { markWelcomed(); setPage('builds'); }} className="px-4 py-3 bg-pink-950 hover:bg-pink-900 border-2 border-pink-400 text-pink-100 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                    <Users className="w-3.5 h-3.5" /> Explore Community
                  </button>
                  <button onClick={openGuide} className="px-4 py-3 bg-fuchsia-950 hover:bg-fuchsia-900 border-2 border-fuchsia-400 text-fuchsia-100 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                    <BookOpen className="w-4 h-4" /> Check the Guide
                  </button>
                  {/* Display units: amounts per second or minute, power per tick or second */}
                  <UnitsToggles />
                </div>
              )}
              <span className="font-pixel-bold text-cyan-400 text-lg uppercase">GregTech calculator</span>
              <p className="text-slate-400 text-xs text-center max-w-sm">
                Start by adding the machine you want to build towards (e.g. Gasoline, a Combustion Generator, or anything from the pack).
              </p>
              {!user && (
                <button onClick={() => { markWelcomed(); setAuthPrompt({}); }} className="w-full px-4 py-2 bg-emerald-950 hover:bg-emerald-900 border border-emerald-400 text-emerald-100 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                  <PixelIcon name="user" className="w-4 h-4" /> Sign up
                </button>
              )}
              <button
                disabled={!db}
                onClick={() => { markWelcomed(); setSearch({ mode: 'standalone' }); }}
                className="w-full px-4 py-2 bg-cyan-950 hover:bg-cyan-900 border border-cyan-400 text-cyan-200 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50"
              >
                {db ? '+ Add a new node' : 'Loading recipes…'}
              </button>
              </>)}
            </div>
          </div>
        )}

        <div
          ref={worldRef}
          className="absolute inset-0 origin-top-left pointer-events-none"
          style={{ transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${zoom})`, transition: panAnimating ? 'transform 0.4s ease' : undefined }}
        >
          {exportGrid && (
            <div
              style={{
                position: 'absolute', left: exportGrid.x, top: exportGrid.y, width: exportGrid.w, height: exportGrid.h,
                backgroundColor: '#12161f',
                backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1.2px, transparent 1.3px)',
                backgroundSize: '26px 26px',
              }}
            />
          )}
          {/* Wires */}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible' }} className="pointer-events-none">
            <defs>
              {markerColors.map((c) => (
                <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 0 L 10 5 L 0 10 Z" fill={c} />
                </marker>
              ))}
            </defs>
            {snapGuides && draggingNodeId && (
              <g data-export-skip="">
                {snapGuides.x != null && <line x1={snapGuides.x} x2={snapGuides.x} y1={-100000} y2={100000} stroke="#22d3ee" strokeOpacity={0.6} strokeWidth={1 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />}
                {snapGuides.y != null && <line y1={snapGuides.y} y2={snapGuides.y} x1={-100000} x2={100000} stroke="#22d3ee" strokeOpacity={0.6} strokeWidth={1 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />}
              </g>
            )}
            {wires.map((w) => {
              const badge = badgeRects.get(w.conn.id);
              const leader = badge && Math.abs(badge.y + BADGE_H / 2 - w.y1) > 4;
              // Off-screen wires don't animate (the animation repaints the whole wire every step)
              const b = pathBox(w.d);
              const onScreen = b.x1 >= viewBox.x0 && b.x0 <= viewBox.x1 && b.y1 >= viewBox.y0 && b.y0 <= viewBox.y1;
              return (
                <g key={w.conn.id} style={{ opacity: highlight && !highlight.conns.has(w.conn.id) ? 0.1 : 1, transition: 'opacity 0.15s' }}>
                  <path
                    d={w.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    style={{ pointerEvents: 'stroke' }}
                    onMouseEnter={() => requestHover({ kind: 'wire', id: w.conn.id })}
                    onMouseLeave={() => requestHover(null)}
                  />
                  {/* Every wire ends in a straight run into the port. The line stops inside the arrowhead's wide
                      part (so it never shows past the narrow tip), the flow dashes stop just before the arrow, and
                      the arrowhead is drawn last, on top. */}
                  <path d={trimEnd(w.d, 4)} fill="none" stroke="#0b0f17" strokeWidth={6} strokeLinejoin="round" />
                  <path d={trimEnd(w.d, 4)} fill="none" stroke={w.color} strokeWidth={2.5} strokeOpacity={0.85} strokeLinejoin="round" />
                  <path d={trimEnd(w.d, 6)} className={`wire-flow${highlight?.conns.has(w.conn.id) ? ' lit' : ''}${onScreen ? '' : ' off'}`} fill="none" stroke={w.color} strokeWidth={2.5} strokeLinecap="round" />
                  <path d={w.d} fill="none" stroke="none" markerEnd={`url(#arrow-${w.color.slice(1)})`} />
                  {leader && badge && (
                    <path d={`M ${w.x1 + 6} ${w.y1} L ${badge.x} ${badge.y + BADGE_H / 2}`} stroke={w.color} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="3 3" fill="none" />
                  )}
                </g>
              );
            })}
            {linkDrag?.active && (() => {
              const from = nodeById.get(linkDrag.nodeId);
              if (!from) return null;
              const r = rectOf(from, measured);
              const sx = linkDrag.side === 'out' ? r.x + r.w + 4 : r.x - 4;
              const sy = portY(from, linkDrag.side, linkDrag.item.id);
              const dir = linkDrag.side === 'out' ? 1 : -1;
              const bend = Math.max(40, Math.abs(linkDrag.x - sx) / 2);
              const color = visibleColor(linkDrag.item.iconColor);
              return (
                <path
                  className="link-preview"
                  d={`M ${sx} ${sy} C ${sx + dir * bend} ${sy}, ${linkDrag.x - dir * bend} ${linkDrag.y}, ${linkDrag.x} ${linkDrag.y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeDasharray="8 8"
                />
              );
            })()}
          </svg>

          {/* Machines */}
          {nodes.map((node) => {
            const sets = portSets.get(node.instanceId) ?? emptySets;
            return (
              <NodeCard
                key={node.instanceId}
                node={node}
                flow={flows.nodes.get(node.instanceId)}
                machines={db?.machines}
                tierCasings={db?.tierCasings}
                genVariants={node.recipe.machineId ? db?.generatorVariants[node.recipe.machineId] : undefined}
                machineVariants={node.recipe.machineId ? db?.machineVariants[node.recipe.machineId] : undefined}
                onMultiChange={onMultiChange}
                rotors={db?.rotors}
                connectedInputs={sets.ins}
                connectedOutputs={sets.outs}
                linkHint={linkHint}
                registerEl={registerEl}
                onPortMouseDown={onPortMouseDown}
                onGenChange={onGenChange}
                onSupplyLimit={onSupplyLimit}
                onRoute={onRoute}
                variants={isPort(node) && db ? (() => { const it = isOutput(node) ? node.recipe.inputs[0] : node.recipe.outputs[0]; const g = it && db.itemById.get(it.id)?.group; return g ? db.groups.get(g) : undefined; })() : undefined}
                onVariant={onVariant}
                onUnlink={onUnlink}
                pulse={focus?.id === node.instanceId ? focus.tick : undefined}
                dimmed={highlight ? !highlight.nodes.has(node.instanceId) : false}
                selected={selected.has(node.instanceId)}
                onHover={onNodeHover}
                onHeaderMouseDown={onHeaderMouseDown}
                onTierStep={onTierStep}
                onSetCount={onSetCount}
                onToggleCountMode={onToggleCountMode}
                onSetTarget={onSetTarget}
                onRemove={onRemove}
                onChangeRecipe={onChangeRecipe}
                onPortClick={onPortClick}
                onTargetRate={onTargetRate}
                onTargetEUt={onTargetEUt}
                manualCounts={manualCounts}
                readOnly={viewing || viewOnly || building}
              />
            );
          })}

          {linkPrompt && (() => {
            const sup = nodeById.get(linkPrompt);
            const item = sup?.recipe.outputs[0];
            if (!sup || !item) return null;
            // Machines that take this item and aren't fed by this Input yet.
            const users = logicNodes.flatMap((n) => {
              if (isPort(n)) return [];
              const inp = nodeInputs(n, machineStats(n)).find((i) => i.consumed !== false && (i.id === item.id || itemsMatch(item, i)));
              if (!inp || connections.some((c) => c.sourceInstanceId === sup.instanceId && c.targetInstanceId === n.instanceId && c.targetItemId === inp.id)) return [];
              return [{ n, inp }];
            });
            if (!users.length) return null;
            const unfed = users.filter(({ n, inp }) => !connections.some((c) => c.targetInstanceId === n.instanceId && c.targetItemId === inp.id)).length;
            const linkAll = () => {
              const before = connections;
              const added = users.map(({ n, inp }) => ({ id: `conn_${sup.instanceId}_${n.instanceId}_${inp.id}`, sourceInstanceId: sup.instanceId, sourceItemId: item.id, targetInstanceId: n.instanceId, targetItemId: inp.id }));
              setConnections((prev) => [...prev, ...added]);
              setLinkPrompt(null);
              setToast(`Linked ${item.name} to ${added.length} machine${added.length === 1 ? '' : 's'}`, () => setConnections(before));
            };
            return (
              <div
                data-export-skip=""
                className="absolute pointer-events-auto z-30 bg-[#161a24] border border-emerald-500/70 shadow-2xl px-3 py-2 text-xs flex items-center gap-3"
                style={{ left: sup.x, top: sup.y - 52, width: Math.max(widthOf(sup), 380) }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="text-slate-200 flex-1">
                  Link this to every machine that takes {item.name}? <span className="text-emerald-300 font-bold">{users.length} machine{users.length === 1 ? '' : 's'}</span>{unfed < users.length ? ` (${unfed} not fed yet)` : ''}.
                </span>
                <button onClick={linkAll} className="px-2 py-0.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-300 font-bold">Yes</button>
                <button onClick={() => setLinkPrompt(null)} className="px-2 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737] font-bold">No</button>
              </div>
            );
          })()}

          {allocPrompt && (() => {
            const target = nodeById.get(allocPrompt.nodeId);
            const src = nodeById.get(allocPrompt.sourceId);
            const tf = flows.nodes.get(allocPrompt.nodeId);
            const sf = flows.nodes.get(allocPrompt.sourceId);
            if (!target || !src || !tf || !sf) return null;
            // Spare supply = what the source makes minus what its other consumers take.
            const made = sf.outputRates[allocPrompt.itemId] ?? 0;
            let used = 0;
            for (const c of connections) {
              if (c.sourceInstanceId !== src.instanceId || c.sourceItemId !== allocPrompt.itemId || c.targetInstanceId === target.instanceId) continue;
              used += flows.connections.get(c.id)?.needed ?? 0;
            }
            const spare = Math.max(0, made - used);
            const targetInputs = nodeInputs(target, tf.stats);
            const inp = targetInputs.find((i) => i.id === allocPrompt.inputId);
            const perMachine = perCycleOf(targetInputs, allocPrompt.inputId, tf.stats) / tf.stats.durationSec;
            const count = perMachine > 0 ? Math.floor(spare / perMachine + 1e-6) : 0;
            if (count <= tf.machines) return null;
            const unit = inp?.unit ?? 'mB';
            return (
              <div
                data-export-skip=""
                className="absolute pointer-events-auto z-30 bg-[#161a24] border border-emerald-500/70 shadow-2xl px-3 py-2 text-xs flex items-center gap-3"
                style={{ left: target.x, top: target.y - 52, width: Math.max(widthOf(target), 360) }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="text-slate-200 flex-1">
                  Allocate all spare {inp?.name} ({formatRate(spare, unit)})? <span className="text-emerald-300 font-bold">{count} machines</span> would use {formatRate(count * perMachine, unit)}.
                </span>
                <button
                  onClick={() => { updateNode(target.instanceId, { count, targetRate: undefined, targetEUt: undefined }); setAllocPrompt(null); }}
                  className="px-2 py-0.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-300 font-bold"
                >
                  Yes
                </button>
                <button onClick={() => setAllocPrompt(null)} className="px-2 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737] font-bold">No</button>
              </div>
            );
          })()}

          {/* Rate panels, placed beside each source output without covering anything */}
          {wires.map((w) => {
            const cf = flows.connections.get(w.conn.id);
            const rect = badgeRects.get(w.conn.id);
            if (!cf || !rect) return null;
            const tol = Math.max(1e-6, cf.needed * 1e-4);
            const balanced = Math.abs(cf.diff) <= tol;
            const surplus = cf.diff > tol;
            return (
              <div
                key={`badge_${w.conn.id}`}
                data-badge
                className="absolute pointer-events-auto flex flex-col bg-[#151a24]/95 border px-2 py-1 shadow-xl text-[11px] transition-opacity duration-150"
                style={{ left: rect.x, top: rect.y, width: BADGE_W, height: BADGE_H, borderColor: `${w.color}66`, opacity: highlight && !highlight.conns.has(w.conn.id) ? 0.15 : 1 }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => requestHover({ kind: 'wire', id: w.conn.id })}
                onMouseLeave={() => requestHover(null)}
              >
                <div className="font-bold text-slate-200 border-b border-slate-700/60 pb-0.5 mb-0.5 flex items-center gap-1" data-tip={w.sItem.name}>
                  <ItemIcon id={w.sItem.id} color={w.sItem.iconColor} size={14} />
                  <span className="break-words min-w-0 flex-1">{w.sItem.name}</span>
                  <button
                    onClick={() => removeConnection(w.conn.id)}
                    className="w-4 h-4 flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-rose-950 border border-transparent hover:border-rose-500/50 text-[10px] leading-none"
                    data-tip="Remove this route"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex justify-between"><span className="text-slate-400">Supplied</span><span className="text-emerald-400">+{formatRate(cf.supplied, w.sItem.unit)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Needed</span><span className="text-rose-400">-{formatRate(cf.needed, w.tItem.unit)}</span></div>
                <div className={`mt-auto text-center font-bold text-[10px] uppercase tracking-wider ${balanced ? 'text-emerald-300' : surplus ? 'text-cyan-300' : 'text-rose-300'}`}>
                  {balanced ? 'Balanced' : surplus ? `Surplus +${formatRate(cf.diff, w.sItem.unit)}` : `Short -${formatRate(-cf.diff, w.sItem.unit)}`}
                </div>
              </div>
            );
          })}
        </div>

        {hover?.kind === 'node' && !draggingNodeId && !panning && !linkDrag?.active && nodeById.get(hover.id) && (
          <HoverInfo node={nodeById.get(hover.id)!} nodeById={nodeById} connections={connections} flows={flows} />
        )}
        {hover?.kind === 'wire' && !draggingNodeId && !panning && !linkDrag?.active && connections.find((c) => c.id === hover.id) && (
          <WireInfo conn={connections.find((c) => c.id === hover.id)!} nodeById={nodeById} connections={connections} flows={flows} />
        )}

        {/* Controls help: faded until hovered */}
        {/* Bottom-left: controls help (collapsible) above the canvas toolbar; wraps upwards on narrow screens */}
        <div className={`absolute left-3 z-20 hidden flex-col items-start gap-2 ${toolAbove ? 'bottom-14' : 'bottom-3'} ${viewing ? '' : 'md:flex'}`} style={{ maxWidth: toolAbove ? `calc(100% - ${(sidebarOpen ? 432 : 12) + 12}px)` : `calc(100% - ${energyW + (sidebarOpen ? 432 : 12) + 24}px)`, minWidth: 260 }}>
        {showHelp && !building && <div
          className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 text-[11px] text-slate-400 bg-[#161a24] border border-[#2b3548] shadow-xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>Pan: <strong className="text-slate-200">Drag canvas</strong></span>
          <span>Zoom: <strong className="text-slate-200">Wheel</strong></span>
          <span>Tier: <strong className="text-slate-200">Left-click ▲ / Right-click ▼</strong></span>
          <span>Add node: <strong className="text-slate-200">Right-click / click a port</strong></span>
          <span>Link: <strong className="text-slate-200">Drag from a port</strong></span>
          <span>Target: <strong className="text-slate-200">Click the target button</strong></span>
        </div>}

        {/* Build mode keeps only the view toggles (Flow, Hover). */}
        <div ref={toolRow} className={`flex items-stretch flex-wrap gap-1.5 text-[11px] ${building ? '[&_.build-hide]:!hidden' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="build-hide flex items-center justify-center px-2 py-1 bg-[#161a24]/95 hover:bg-[#202737] border border-[#2b3548] text-slate-300"
            data-tip={showHelp ? 'Hide the controls help' : 'Show the controls help'} aria-label={showHelp ? 'Hide the controls help' : 'Show the controls help'} aria-expanded={showHelp}
          >
            {showHelp ? <PixelIcon name="down" className="w-3 h-[7px]" /> : <PixelIcon name="up" className="w-3 h-[7px]" />}
          </button>
          <button
            onClick={handleAutoSort}
            disabled={!nodes.length}
            className="build-hide flex items-center gap-1 px-2 py-1 bg-[#161a24]/95 hover:bg-[#202737] border border-[#2b3548] text-slate-200 font-bold disabled:opacity-40"
            data-tip="Tidy the nodes into columns following the flow (can be undone)" aria-label="Auto Sort"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-cyan-300" />{toolWide && <span>Auto Sort</span>}
          </button>
          <button
            onClick={() => setSnapOn((v) => !v)}
            className={`build-hide flex items-center gap-1 px-2 py-1 border font-bold ${snapOn ? 'bg-cyan-950/90 border-cyan-500/60 text-cyan-200' : 'bg-[#161a24]/95 border-[#2b3548] text-slate-400 hover:text-slate-200'}`}
            data-tip={`Snapping ${snapOn ? 'on' : 'off'}: lines nodes up while dragging, so wires run straight`} aria-label="Snap" aria-pressed={snapOn}
          >
            <Magnet className="w-3.5 h-3.5" />{toolWide && <span>Snap</span>}
          </button>
          <button
            onClick={() => setFlowAnim((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 border font-bold ${flowAnim ? 'bg-cyan-950/90 border-cyan-500/60 text-cyan-200' : 'bg-[#161a24]/95 border-[#2b3548] text-slate-400 hover:text-slate-200'}`}
            data-tip={`Wire animation ${flowAnim ? 'on' : 'off'}. Off is smoother on big flows`} aria-label="Wire animation" aria-pressed={flowAnim}
          >
            <span className="relative w-3.5 h-3.5 overflow-hidden"><ArrowRight className={`absolute inset-0 w-3.5 h-3.5 ${flowAnim ? 'flow-arrow' : 'opacity-60'}`} /></span>
            {toolWide && <span>Flow</span>}
          </button>
          <button
            onClick={toggleLabels}
            className={`build-hide flex items-center gap-0.5 px-2 py-1 border font-bold ${showLabels ? 'bg-rose-950/80 border-rose-500/60 text-rose-200 hover:bg-rose-900/80' : 'bg-[#161a24]/95 border-[#2b3548] text-slate-300 hover:text-slate-100'}`}
            data-tip={showLabels ? 'Remove the Supplied / Needed labels from the wires' : 'Add Supplied / Needed labels to the wires'} aria-label="Wire labels" aria-pressed={showLabels}
          >
            {showLabels ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}<Tag className="w-3.5 h-3.5" />
          </button>
          <div className="relative group flex" data-tip={"Hovering a card fades the rest.\nDirect: its own links. Chain: the whole chain. Off: no fading"}>
            <button className="flex items-center gap-1 px-2 py-1 bg-[#161a24]/95 border border-[#2b3548] font-bold text-slate-300 group-hover:text-slate-100 capitalize">
              {toolWide && <span className="text-slate-500 normal-case font-normal">Hover</span>}{hoverMode}<ChevronUp className="w-3 h-3" />
            </button>
            <div className="absolute bottom-full left-0 hidden group-hover:flex group-focus-within:flex flex-col pb-1">
              <div className="flex flex-col bg-[#161a24] border border-[#2b3548] shadow-xl min-w-full">
                {(['direct', 'chain', 'off'] as const).map((m) => (
                  <button key={m} onClick={(e) => { setHoverMode(m); (e.currentTarget as HTMLButtonElement).blur(); }} className={`px-2.5 py-1 text-left font-bold capitalize whitespace-nowrap ${hoverMode === m ? 'bg-[#243049] text-cyan-200' : 'text-slate-400 hover:text-slate-100 hover:bg-[#202737]'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="build-hide flex items-center bg-[#161a24]/95 border border-[#2b3548]">
            <button onClick={undo} disabled={!history.current.past.length} className="px-2 py-1 min-h-6 text-slate-200 hover:bg-[#202737] disabled:opacity-30" data-tip="Undo (Ctrl+Z)" aria-label="Undo (Ctrl+Z)">
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-[#2b3548]" />
            <button onClick={redo} disabled={!history.current.future.length} className="px-2 py-1 min-h-6 text-slate-200 hover:bg-[#202737] disabled:opacity-30" data-tip="Redo (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Redo (Ctrl+Y / Ctrl+Shift+Z)">
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-[#2b3548]" />
            <button
              onClick={() => { setSelectMode((v) => !v); if (selectMode) setSelected(new Set()); }}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-bold ${selectMode ? 'bg-cyan-950 text-cyan-300' : 'text-slate-200 hover:bg-[#202737]'}`}
              data-tip={selectMode ? 'Drag a box over cards (Shift adds, Space pans, Esc stops)' : 'Select several cards (Ctrl+A selects all)'} aria-label="Select" aria-pressed={selectMode}
            >
              <SquareDashed className="w-3.5 h-3.5" />{toolWide && <span>Select</span>}
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* SIDEBAR */}
      {sidebarOpen && page === 'canvas' && !building && (
        <aside className="panel-in absolute right-0 left-0 md:left-auto top-11 bottom-0 w-full md:w-[420px] bg-[#161a24] md:border-l-2 border-cyan-500/30 p-4 flex flex-col gap-3 z-30 shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2">
            <div className="flex-1 grid grid-cols-2 gap-1 bg-[#10131b] border border-[#283244] p-1">
              {([['balances', 'Balances', Scale], ['machines', 'Machines', Factory]] as const).map(([t, label, Icon]) => (
                <button
                  key={t}
                  onClick={() => setSidebarTab(t)}
                  className={`flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold uppercase tracking-wider border transition ${sidebarTab === t ? 'bg-cyan-950/80 border-cyan-400/70 text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.2)]' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#1a2030]'}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-[#202737] text-slate-400 hover:text-slate-200 border border-transparent hover:border-[#2b3548]" data-tip="Close the side panel" aria-label="Close the side panel"><X className="w-4 h-4" /></button>
          </div>
          {sidebarTab === 'balances' && (<>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div>
              <div className="text-[11px] uppercase font-bold text-cyan-400 tracking-wider mb-2 flex items-center justify-between">
                <button onClick={() => toggleBal('raw')} className="flex items-center gap-1 uppercase hover:text-cyan-300">
                  {balOpen.raw ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  Supplied Raw Inputs <span className="text-slate-500 normal-case">({sidebarData.rawInputs.length + sidebarData.supplies.length})</span>
                </button>
                {balOpen.raw && <span className="text-[10px] text-slate-500">Available /s</span>}
              </div>
              {!balOpen.raw ? null : sidebarData.rawInputs.length === 0 && sidebarData.supplies.length === 0 ? <div className="text-slate-500 text-xs italic">No raw inputs required yet.</div> : (
                <div className="space-y-1.5">
                  {sidebarData.rawInputs.map((r) => {
                    const text = userSuppliedLimits[r.item.id] ?? '';
                    const limit = text ? parseRate(text, r.item.unit) : null;
                    const over = limit != null && r.rate > limit * (1 + 1e-6);
                    return (
                      <div key={r.item.id} className={`bg-[#12151e] border p-2 flex items-center justify-between gap-2 ${over ? 'border-rose-600/70' : 'border-[#222a3b]'}`}>
                        <div className="min-w-0">
                          <div className="text-slate-200 font-bold text-xs flex items-center gap-1.5">
                            <ItemIcon id={r.item.id} color={r.item.iconColor} size={16} />
                            <span className="break-words min-w-0">{r.item.name}</span>
                          </div>
                          <div className={`text-[10px] ${over ? 'text-rose-400 font-bold' : 'text-rose-400'}`}>
                            Required: -{formatRate(r.rate, r.item.unit)}{over ? ` (over by ${formatRate(r.rate - limit!, r.item.unit)})` : ''}
                          </div>
                          {(() => {
                            // Machines that need this and have nothing feeding it: jump to them, or find a source.
                            const users = rawUsers(r.item.id);
                            if (!users.length) return null;
                            return (
                              <div className="flex gap-1 mt-1">
                                <button onClick={() => goToRawUser(r.item.id)} className="px-1.5 py-px border border-cyan-700/60 text-cyan-300 hover:bg-cyan-950 text-[10px] font-bold" data-tip={users.length > 1 ? `Go to the ${users.length} machines that need it (click again for the next)` : 'Go to the machine that needs it'}>
                                  Go to{users.length > 1 ? ` (${users.length})` : ''}
                                </button>
                                <button onClick={() => { const u = users[0]; goToNode(u.instanceId); setSearch({ mode: 'input_supplier', nodeId: u.instanceId, item: nodeInputs(u, machineStats(u)).find((i) => i.id === r.item.id) }); }} className="px-1.5 py-px border border-emerald-700/60 text-emerald-300 hover:bg-emerald-950 text-[10px] font-bold" data-tip="Find a machine that makes it and link it">
                                  + Add source
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                        <EditableValue
                          value={limit ?? NaN}
                          unit={r.item.unit}
                          display={limit == null ? '∞' : formatRate(limit, r.item.unit)}
                          onCommit={(v) => setUserSuppliedLimits((prev) => {
                            const next = { ...prev };
                            if (Number.isFinite(v)) next[r.item.id] = String(v); else delete next[r.item.id];
                            return next;
                          })}
                          allowEmpty
                          placeholder="∞"
                          className="text-amber-300 text-xs"
                          title={`Your ${r.item.name} supply limit (empty = unlimited)`}
                        />
                      </div>
                    );
                  })}
                  {sidebarData.supplies.map(({ node: n, used }) => (
                    <div key={n.instanceId} className={`bg-[#12151e] border p-2 flex items-center justify-between gap-2 ${flows.nodes.get(n.instanceId)?.capped ? 'border-rose-600/70' : 'border-emerald-800/60'}`}>
                      <div className="min-w-0">
                        <div className="text-slate-200 font-bold text-xs flex items-center gap-1.5">
                          <ItemIcon id={n.recipe.outputs[0].id} color={n.recipe.outputs[0].iconColor} size={16} />
                          <span className="break-words min-w-0">{n.recipe.recipeName}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">Input node using {formatRate(used, n.recipe.outputs[0].unit)}</div>
                      </div>
                      <EditableValue
                        value={n.supplyLimit ?? NaN}
                        unit={n.recipe.outputs[0].unit}
                        display={n.supplyLimit == null ? '∞' : formatRate(n.supplyLimit, n.recipe.outputs[0].unit)}
                        onCommit={(v) => onSupplyLimit(n, Number.isFinite(v) ? v : undefined)}
                        allowEmpty
                        placeholder="∞"
                        className="text-amber-300 text-xs"
                        title="Supply limit (empty = unlimited)"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase font-bold text-emerald-400 tracking-wider mb-2 flex items-center justify-between">
                <button onClick={() => toggleBal('out')} className="flex items-center gap-1 uppercase hover:text-emerald-300">
                  {balOpen.out ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  Outputs &amp; Byproducts <span className="text-slate-500 normal-case">({sidebarData.outputs.length})</span>
                </button>
                <div className="flex border border-[#2b3548] text-[10px] normal-case tracking-normal">
                  {(['all', 'surplus'] as const).map((f) => (
                    <button key={f} onClick={() => setOutputFilter(f)} className={`px-1.5 py-0.5 ${outputFilter === f ? 'bg-emerald-950 text-emerald-300' : 'text-slate-400 hover:text-slate-200'}`}>
                      {f === 'all' ? 'All' : 'Surplus'}
                    </button>
                  ))}
                </div>
              </div>
              {balOpen.out && (() => {
                const tol = (o: { produced: number }) => Math.max(1e-6, o.produced * 1e-4);
                const shown = sidebarData.outputs
                  .map((o) => ({ ...o, surplus: o.produced - o.consumed }))
                  .filter((o) => outputFilter === 'all' || o.surplus > tol(o))
                  .sort((a, b) => (outputFilter === 'surplus' ? b.users.length - a.users.length : 0));
                if (!shown.length) return <div className="text-slate-500 text-xs italic">{outputFilter === 'surplus' ? 'No surplus — everything made is used.' : 'No outputs produced yet.'}</div>;
                return (
                  <div className="space-y-1.5">
                    {shown.map((o) => {
                      const isSurplus = o.surplus > tol(o);
                      const spareProducers = [...o.producers].filter(([, spare]) => spare > tol(o)).map(([id]) => id);
                      return (
                        <div key={o.item.id} className="bg-[#12151e] border border-[#222a3b] p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-slate-200 font-bold flex items-center gap-1.5">
                                <ItemIcon id={o.item.id} color={o.item.iconColor} size={16} />
                                <span className="break-words min-w-0">{o.item.name}</span>
                              </div>
                              <div className="text-[10px] text-slate-400">Prod: +{formatRate(o.produced, o.item.unit)} | Cons: -{formatRate(o.consumed, o.item.unit)}</div>
                            </div>
                            <div className={`px-2 py-0.5 border text-[10px] font-bold whitespace-nowrap ${isSurplus ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40' : 'bg-[#181d2a] text-slate-400 border-[#2b3548]'}`}>
                              {isSurplus ? `+${formatRate(o.surplus, o.item.unit)}` : 'Consumed'}
                            </div>
                          </div>
                          {isSurplus && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {o.users.map((u) => (
                                <button
                                  key={u.instanceId}
                                  onClick={() => {
                                    const inp = nodeInputs(u, machineStats(u)).find((i) => i.consumed !== false && itemsMatch(i, o.item))!;
                                    for (const pid of spareProducers.length ? spareProducers : [...o.producers.keys()]) {
                                      addConnection({ sourceInstanceId: pid, sourceItemId: o.item.id, targetInstanceId: u.instanceId, targetItemId: inp.id });
                                    }
                                  }}
                                  className="px-1.5 py-0.5 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-950 text-[10px] max-w-full break-words min-w-0"
                                  data-tip={`Link the spare ${o.item.name} into ${u.recipe.machineName} (${u.recipe.recipeName}) on the canvas`}
                                >
                                  → {u.recipe.machineName} ({u.recipe.recipeName})
                                </button>
                              ))}
                              <button
                                onClick={() => goToNext(`surplus|${o.item.id}`, spareProducers.length ? spareProducers : [...o.producers.keys()])}
                                className="px-1.5 py-0.5 border border-amber-600/60 text-amber-300 hover:bg-amber-950 text-[10px]"
                                data-tip={spareProducers.length > 1 ? `Show where the spare ${o.item.name} comes from (${spareProducers.length} machines — click again for the next)` : `Show where the spare ${o.item.name} comes from`}
                              >
                                ⌖ Go to{spareProducers.length > 1 ? ` (${spareProducers.length})` : ''}
                              </button>
                              <button
                                onClick={() => {
                                  const pid = spareProducers[0] ?? [...o.producers.keys()][0];
                                  if (pid) setSearch({ mode: 'output_consumer', nodeId: pid, item: o.item });
                                }}
                                className="px-1.5 py-0.5 border border-[#2b3548] text-slate-300 hover:text-cyan-300 hover:border-cyan-500/50 text-[10px]"
                                data-tip="Search every recipe that uses this"
                              >
                                Find uses…
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="text-[10px] text-slate-500">
              Total draw {formatEU(flows.euConsumed)}{flows.euGenerated > 0 ? `, generating ${formatEU(flows.euGenerated)} (net ${formatEU(flows.euGenerated - flows.euConsumed)})` : ''}.
            </div>
          </div>
          <button
            onClick={handleMaxFlow}
            data-tip="Raise the target as far as the budget and supply limits allow"
            className="w-full py-2 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 font-bold text-xs transition"
          >
            Max Flow From These Limits
          </button>
          </>)}
          {sidebarTab === 'machines' && (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="bg-[#12151e] border border-[#222a3b] p-2">
                  <div className="text-[10px] text-slate-500 uppercase">Machines to build</div>
                  <div className="text-slate-100 font-bold text-base">{Math.round(machineSummary.totalMachines)}</div>
                </div>
                <div className="bg-[#12151e] border border-[#222a3b] p-2">
                  <div className="text-[10px] text-slate-500 uppercase">Machine types</div>
                  <div className="text-slate-100 font-bold text-base">{machineSummary.types}</div>
                </div>
                <div className="bg-[#12151e] border border-[#222a3b] p-2" data-tip="Draw with every built machine running at once">
                  <div className="text-[10px] text-slate-500 uppercase">{euUnit()} full load</div>
                  <div className="text-amber-300 font-bold text-base">{formatEU(machineSummary.useMax)}</div>
                </div>
                <div className="bg-[#12151e] border border-[#222a3b] p-2" data-tip="Average draw at the planned rate">
                  <div className="text-[10px] text-slate-500 uppercase">{euUnit()} average</div>
                  <div className="text-amber-400/80 font-bold text-base">{formatEU(machineSummary.useAvg)}</div>
                </div>
                {machineSummary.genMax > 0 && (
                  <div className="col-span-2 bg-[#211a0f] border border-amber-700/50 p-2">
                    <div className="text-[10px] text-amber-500/80 uppercase">Generated</div>
                    <div className="text-amber-300 font-bold">+{formatEU(machineSummary.genAvg)} <span className="text-[10px] text-slate-400 font-normal">average · up to +{formatEU(machineSummary.genMax)}</span></div>
                  </div>
                )}
              </div>

              {(() => {
                const sliderTiers = TIER_ORDER.slice(0, TIER_ORDER.indexOf('UHV') + 1);
                const idx = sliderTiers.indexOf(maxTier);
                const info = TIERS[maxTier];
                const above = machineSummary.list.filter((r) => r.tier && TIER_ORDER.indexOf(r.tier as VoltageTier) > TIER_ORDER.indexOf(maxTier));
                return (
                  <div className="bg-[#12151e] border border-[#222a3b] p-2">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="uppercase font-bold text-cyan-400 tracking-wider">Max tier</span>
                      <span className="px-1.5 py-0.5 border text-[10px] font-bold" style={{ backgroundColor: info.badgeBg, borderColor: info.badgeBorder, color: info.color }}>{maxTier}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={sliderTiers.length - 1}
                      value={idx < 0 ? sliderTiers.length - 1 : idx}
                      onChange={(e) => setMaxTier(sliderTiers[Number(e.target.value)])}
                      className="w-full accent-cyan-400"
                      data-tip="Highest tier you can build; Auto Ratio stays at or below it" aria-label="Highest tier you can build; Auto Ratio stays at or below it"
                    />
                    <div className="flex justify-between text-[9px] text-slate-500">
                      {sliderTiers.map((t) => <span key={t} style={{ color: t === maxTier ? TIERS[t].color : undefined }}>{t}</span>)}
                    </div>
                    <div className="mt-2 pt-2 border-t border-[#222a3b] space-y-1 text-[11px]">
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer" data-tip="Let Auto Ratio swap in multiblocks that run the same recipe">
                        <input type="checkbox" checked={useLargeMachines} onChange={(e) => setUseLargeMachines(e.target.checked)} className="accent-cyan-400" />
                        Large machines for Auto Ratio
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setMultiSettings(true); }}
                          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 border border-[#2b3548] text-slate-300 hover:text-cyan-300 hover:border-cyan-500/50 text-[10px]"
                          data-tip={`Choose which large machines Auto Ratio may use${disabledMultis.size ? ` (${disabledMultis.size} turned off)` : ''}`}
                        >
                          <PixelIcon name="settings" className="w-2.5 h-2.5" /> Settings
                        </button>
                      </label>
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer" data-tip="Let Auto Ratio add parallel hatches (4x IV to 256x UV, up to max tier)">
                        <input type="checkbox" checked={parallelAccess} onChange={(e) => setParallelAccess(e.target.checked)} className="accent-cyan-400" />
                        Access to Parallel Control Hatches
                      </label>
                    </div>
                    <div className="mt-2 pt-2 border-t border-[#222a3b] space-y-1">
                      <button
                        onClick={startBuild}
                        disabled={!machineSummary.list.length}
                        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-bold text-[11px] uppercase tracking-wider disabled:opacity-40"
                        data-tip="Step through building this flow in game"
                      >
                        <Factory className="w-3.5 h-3.5" /> Build mode
                      </button>
                      <div className="text-[10px] text-slate-500 leading-snug">Walks you through building the flow: the raw inputs to have ready, then each machine in order (suppliers first), where every input comes from and where every output goes, what to split, and a pipe for each link.</div>
                    </div>
                    {above.length > 0 && (
                      <div className="text-[10px] text-rose-400 mt-1">
                        {above.reduce((a, r) => a + r.machines, 0)} machines are above {maxTier}: run Auto Ratio to bring them down.
                      </div>
                    )}
                  </div>
                );
              })()}

              {noDemandIds.size > 0 && (
                <div className="border border-slate-600/60 bg-[#151922] p-2 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase font-bold text-slate-300 tracking-wider flex-1">Unused machines ({noDemandIds.size})</span>
                    <button onClick={handleRemoveNoDemand} className="px-1.5 py-0.5 border border-rose-700/50 text-rose-300 hover:bg-rose-950 text-[10px] font-bold" data-tip="Remove them and their links (undo-able)">Remove all</button>
                  </div>
                  <div className="text-[10px] text-slate-500 leading-snug">Not running at this rate: nothing uses what they make, or other machines already cover it. They're greyed out on the canvas. Click one to find it.</div>
                  <div className="flex flex-wrap gap-1">
                    {logicNodes.filter((n) => noDemandIds.has(n.instanceId)).map((n) => (
                      <button key={n.instanceId} onClick={() => goToNode(n.instanceId)} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-400 hover:text-slate-100 hover:border-slate-400 text-[10px] text-left" data-tip={flows.nodes.get(n.instanceId)?.idleReason === 'covered' ? 'NOT NEEDED: other machines already cover what it makes' : 'NO DEMAND: nothing uses what it makes'}>
                        {n.multi?.name ?? n.recipe.machineName} · {n.recipe.recipeName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] uppercase font-bold text-cyan-400 tracking-wider mb-1.5 flex items-center justify-between gap-2">
                  <span>Machines to build</span>
                  <div className="flex border border-[#2b3548] text-[10px] normal-case tracking-normal">
                    {([['machine', 'By machine'], ['tier', 'By tier']] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setMachineSort(k)} className={`px-1.5 py-0.5 ${machineSort === k ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 -mt-1 mb-1.5">Click a row to find it on the canvas.</div>
                {machineSummary.list.length === 0 ? <div className="text-slate-500 text-xs italic">No machines yet.</div> : (
                  <>
                    <div className="flex items-center gap-2 mb-1.5 text-[10px]">
                      <span className="text-slate-400 flex-1">
                        Built {machineSummary.list.filter((r) => built.has(r.key)).reduce((a, r) => a + r.machines, 0)} / {Math.round(machineSummary.totalMachines)} machines
                      </span>
                      <button onClick={() => updateBuilt(new Set(machineSummary.list.map((r) => r.key)))} className="px-1.5 py-0.5 border border-emerald-700/50 text-emerald-300 hover:bg-emerald-950">Select all</button>
                      <button onClick={() => updateBuilt(new Set())} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737]">Deselect all</button>
                    </div>
                    {(machineSort === 'machine' ? machineGroups : [{ name: '', total: 0, rows: machineSummary.list }]).map((g) => (
                      <div key={g.name || 'all'} className={g.name ? 'border border-[#2b3548] mb-2' : 'space-y-1'}>
                        {g.name && (
                          <div className="flex items-center gap-2 px-2 py-1 bg-[#1a2030] border-b border-[#2b3548] text-xs">
                            <MachineIcon recipe={g.rows[0].recipe} tier={(g.rows[0].tier || 'LV') as never} machines={db?.machines} tierCasings={db?.tierCasings} variant={g.rows[0].node.gen && g.rows[0].recipe.machineId ? db?.generatorVariants[g.rows[0].recipe.machineId]?.find((v) => v.id === g.rows[0].node.gen!.variantId) : g.rows[0].node.multi && g.rows[0].recipe.machineId ? db?.machineVariants[g.rows[0].recipe.machineId]?.find((v) => v.id === g.rows[0].node.multi!.variantId) : undefined} size={20} />
                            <span className="font-bold text-slate-100 flex-1 break-words min-w-0">{g.name}</span>
                            <span className="text-slate-300 font-bold">×{g.total}</span>
                          </div>
                        )}
                        <div className={g.name ? 'p-1 space-y-1' : 'space-y-1'}>
                          {g.rows.map((r) => {
                            const info = r.tier ? TIERS[r.tier as keyof typeof TIERS] : undefined;
                            const done = built.has(r.key);
                            return (
                              <div key={r.key} className={`flex items-center gap-2 bg-[#12151e] border p-1.5 text-xs ${done ? 'border-emerald-700/50 opacity-70' : 'border-[#222a3b]'} ${r.machines === 0 ? 'opacity-50' : ''}`}>
                                <button
                                  onClick={() => { const next = new Set(built); if (done) next.delete(r.key); else next.add(r.key); updateBuilt(next); }}
                                  className={done ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-200'}
                                  data-tip={done ? 'Built — click to untick' : 'Tick off once these are crafted'}
                                >
                                  {done ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => goToNext(`machines|${r.key}`, r.nodeIds)}
                                  className="flex-1 min-w-0 flex items-center gap-2 text-left hover:text-cyan-200"
                                  data-tip={`${compact(r.needed)} machines' worth of work${r.nodeIds.length > 1 ? ` across ${r.nodeIds.length} recipes — click again for the next` : ' — click to show on canvas'}`}
                                >
                                  {!g.name && <span className="font-bold text-slate-200 break-words min-w-0 flex-1">{r.name}</span>}
                                  <span className="px-1.5 py-0.5 border text-[10px] font-bold flex-shrink-0" style={info ? { backgroundColor: info.badgeBg, borderColor: info.badgeBorder, color: info.color } : undefined}>{r.tierLabel}</span>
                                  {g.name && <span className="text-[10px] text-slate-500 flex-1 break-words min-w-0">{r.nodeIds.length > 1 ? `used for ${r.nodeIds.length} recipes` : r.recipe.recipeName}</span>}
                                  <span className={`text-[10px] ${r.gen ? 'text-amber-300' : 'text-amber-400/80'}`} data-tip={`${r.gen ? 'Generates' : 'Draws'} up to ${formatEU(r.eutMax)} with all built machines running; ${formatEU(r.eutAvg)} on average`}>
                                    {r.gen ? '+' : ''}{formatEU(r.eutMax)}
                                  </span>
                                  <span className={`font-bold w-10 text-right ${done ? 'text-emerald-300 line-through' : 'text-slate-100'}`}>×{r.machines}</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}


        </aside>
      )}

      {showGuide && <Guide onClose={() => setShowGuide(false)} />}
      <TooltipLayer />

      {confirm && (
        <div className="fixed inset-0 bg-black/70 z-[75] flex items-center justify-center p-4" onMouseDown={() => setConfirm(null)}>
          <div onMouseDown={(e) => e.stopPropagation()} className="w-[420px] max-w-full bg-[#161a24] border border-[#2b3548] shadow-2xl p-4 space-y-3">
            <div className="text-slate-200 font-bold uppercase tracking-wider text-xs">{confirm.title}</div>
            <div className="text-sm text-slate-300">{confirm.body}</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 text-xs font-bold hover:bg-[#202737]">Cancel</button>
              {confirm.actions.map((a) => (
                <button
                  key={a.label}
                  autoFocus={a.kind != null}
                  onClick={() => { setConfirm(null); a.run(); }}
                  className={`px-3 py-1.5 border text-xs font-bold ${a.kind === 'danger' ? 'bg-rose-950 hover:bg-rose-900 border-rose-500/60 text-rose-200' : a.kind === 'primary' ? 'bg-emerald-950 hover:bg-emerald-900 border-emerald-500/50 text-emerald-300' : 'border-[#2b3548] text-slate-200 hover:bg-[#202737]'}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {(buildSheet || buildPanel) && (() => {
        const sheet = {
          pack: MODPACKS.find((m) => m.id === PACK)?.name ?? '',
          flowName: currentSave?.name ?? 'Untitled flow',
          groups: buildGroups,
          totals: { machines: machineSummary.totalMachines, types: buildGroups.length, useMax: machineSummary.useMax, useAvg: machineSummary.useAvg, genAvg: machineSummary.genAvg },
          machines: db?.machines,
          tierCasings: db?.tierCasings,
          pixelFont,
        };
        return (
          <>
            {buildPanel && <BuildImageModal sheet={sheet} onExport={(layout, format) => void exportBuildImage(layout, format)} onClose={() => setBuildPanel(false)} />}
            {/* Off screen: only rendered to be captured by the image export. */}
            {buildSheet && <div style={{ position: 'fixed', left: -10000, top: 0 }}><BuildSheet ref={buildSheetRef} {...sheet} layout={buildSheet} /></div>}
          </>
        );
      })()}

      {exporting && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center">
          <div className="bg-[#161a24] border border-sky-500/50 px-5 py-4 flex items-center gap-3 shadow-2xl">
            <Loader2 className="w-5 h-5 text-sky-300 animate-spin" />
            <div>
              <div className="text-sm text-slate-100 font-bold">Rendering image…</div>
              <div className="text-[11px] text-slate-400">Drawing {nodes.length} nodes at high resolution. Big flows take a few seconds.</div>
            </div>
          </div>
        </div>
      )}

      {saveDialog != null && (() => {
        const match = saves.find((x) => x.name.toLowerCase() === saveDialog.trim().toLowerCase());
        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onMouseDown={() => { afterSave.current = null; setSaveDialog(null); }}>
            <form
              onSubmit={(e) => { e.preventDefault(); handleSaveAs(saveDialog); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-[400px] max-w-full bg-[#161a24] border border-[#2b3548] shadow-2xl p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-slate-200 font-bold uppercase tracking-wider text-xs">
                <Save className="w-4 h-4 text-emerald-400" /> Save flow
              </div>
              <input
                autoFocus
                value={saveDialog}
                onChange={(e) => setSaveDialog(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => { if (e.key === 'Escape') setSaveDialog(null); }}
                placeholder="Name, e.g. Gasoline line"
                maxLength={64}
                className="w-full bg-[#12151e] border border-[#2b3548] focus:border-cyan-400 outline-none px-2.5 py-1.5 text-sm text-slate-100"
              />
              <div className="text-[11px] text-slate-500 min-h-4">
                {match ? <span className="text-amber-300">This replaces the saved flow "{match.name}".</span> : saveDialog.trim() ? 'Saved as a new flow in this browser.' : 'Give the flow a name.'}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { afterSave.current = null; setSaveDialog(null); }} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 text-xs font-bold hover:bg-[#202737]">Cancel</button>
                <button type="submit" disabled={!saveDialog.trim()} className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/50 text-emerald-300 text-xs font-bold disabled:opacity-40">
                  {match ? 'Replace' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {multiSettings && db && (
        <MultiblockSettings db={db} disabled={disabledMultis} onChange={updateDisabledMultis} onClose={() => setMultiSettings(false)} />
      )}
      {profileOpen && (
        <ProfileModal
          user={user}
          pack={PACK}
          currentFlow={renderSaves({ onlyCurrent: true })}
      pixelFont={pixelFont}
      onPixelFont={setPixelFont}
          activity={activity}
          onSeen={markSeen}
          onOpenActivity={openActivity}
          onClose={() => setProfileOpen(false)}
          onOpenYourBuilds={() => { setProfileOpen(false); exitView(); setLinkedFlow(null); setBuildsTab('mine'); setPage('builds'); setNavKey((k) => k + 1); }}
          onNewFlow={() => { setProfileOpen(false); handleNewFlow(); }}
          onModeration={user?.mod ? () => { setProfileOpen(false); setModOpen(true); } : undefined}
          onLogin={() => { setProfileOpen(false); setAuthPrompt({}); }}
          onError={showError}
        />
      )}
      {modOpen && user?.mod && <ModerationModal onClose={() => setModOpen(false)} onError={showError} />}
      {user?.needsRename && !user.needsUsername && (
        // A moderator flagged this username: pick a new one before anything else (closing logs out).
        <AuthModal rename onClose={() => void logout()} onDone={() => setToast('Username changed. Thanks!')} />
      )}
      {user?.needsUsername && !authPrompt && (
        // First Google sign-in: pick a username before anything else (closing logs back out).
        <AuthModal pickUsername onClose={() => { afterUsername.current = undefined; void logout(); }} onDone={() => { setToast('Welcome! Your account is ready'); const then = afterUsername.current; afterUsername.current = undefined; then?.(); }} />
      )}
      {exportPanel && <ExportImageModal onExport={(o) => void exportFlowImage(o)} onPreview={(o) => captureFlow(o, 1600)} onClose={() => setExportPanel(false)} />}
      {suggestOpen && (
        <SuggestPackModal
          loggedIn={!!user}
          onLogin={() => { setSuggestOpen(false); setAuthPrompt({ reason: 'Log in to suggest a modpack', then: () => setSuggestOpen(true) }); }}
          onClose={() => setSuggestOpen(false)}
          onDone={setToast}
        />
      )}
      {authPrompt && (
        <AuthModal
          reason={authPrompt.reason}
          onClose={() => setAuthPrompt(null)}
          // A first Google sign-in picks a username first; whatever was waiting runs after that.
          onDone={() => { const then = authPrompt.then; setAuthPrompt(null); if (currentUser()?.needsUsername) afterUsername.current = then; else then?.(); }}
        />
      )}
      {shareFlow && (
        <ShareBuildModal
          flow={{ ...shareFlow.flow, origin: user ? { author: user.username, authorId: user.uid } : undefined } as typeof shareFlow.flow}
          defaultName={shareFlow.name}
          sourceFlowId={shareFlow.id}
          pack={PACK}
          onClose={() => setShareFlow(null)}
          onShared={(b) => { setShareFlow(null); copyLink(b.id, b.name, true); }}
        />
      )}
      {toast && (
        <div key={toast.id} className="toast-in fixed bg-[#161a24] border border-cyan-500/50 text-cyan-200 text-xs px-3 py-1.5 z-[45] shadow-xl max-w-[92vw] flex items-center gap-3" style={{ bottom: '5%', left: sidebarOpen && page === 'canvas' && window.innerWidth >= 768 ? 'calc((100% - 432px) / 2)' : '50%' }} onMouseDown={(e) => e.stopPropagation()}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button onClick={() => { toast.undo!(); setToast(null); }} className="px-2 py-0.5 border border-cyan-500/60 text-cyan-200 hover:bg-cyan-900/60 font-bold">Undo</button>
          )}
        </div>
      )}
      {importOpen && <ImportModal onFiles={(f) => void handleImportFiles(f)} onClose={() => setImportOpen(false)} />}
      {search && db && (
        <SearchModal
          db={db}
          mode={search.mode}
          item={search.item ?? null}
          currentRecipe={search.mode === 'change_recipe' ? searchNode?.recipe ?? null : null}
          onSelect={handleSelectRecipe}
          makeGen={makeGen}
          onAddSupply={handleAddSupply}
          onAddOutput={handleAddOutput}
          onBestRoute={handleBestRoute}
          openInputCount={search.mode === 'input_supplier' && searchNode ? openInputs(searchNode).length : 0}
          onClose={() => setSearch(null)}
        />
      )}

      {building && page === 'canvas' && (
        <BuildMode
          steps={buildStepList}
          step={buildStep ?? 0}
          onStep={setBuildStep}
          onExit={() => setBuildStep(null)}
          onFocus={goToNode}
          anchor={(() => {
            // Where the step's machine is on screen, so the card sits just left of it (and follows panning).
            const st = buildStepList[buildStep ?? 0];
            const n = st?.kind === 'machine' ? nodes.find((x) => x.instanceId === st.nodeId) : undefined;
            const c = canvasRef.current?.getBoundingClientRect();
            if (!n || !c) return null;
            const r = rectOf(n);
            return { nodeLeft: c.left + pan.x + r.x * zoom, top: c.top + pan.y + r.y * zoom, width: Math.round(Math.min(560, Math.max(380, r.w * zoom))), minTop: c.top + 48 };
          })()}
        />
      )}

      {/* View mode: what's on screen, and the way out */}
      {viewing && page === 'canvas' && (
        <div className="absolute top-[52px] left-1/2 -translate-x-1/2 z-40 max-w-[92vw] flex items-center gap-2 px-3 py-1.5 bg-[#161a24]/95 border border-cyan-500/60 shadow-2xl text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
          <span className="text-cyan-200 font-bold whitespace-nowrap">View only</span>
          <span className="text-slate-400 truncate">"{viewFlow.build.name}" by {viewFlow.build.author}</span>
          {ownSaveFor(viewFlow.build)
            ? <button onClick={() => editOrCopy(viewFlow.build)} className="px-2 py-0.5 border border-emerald-500 bg-emerald-700 hover:bg-emerald-600 text-white font-bold whitespace-nowrap" data-tip="Open your own flow to change it">Edit your flow</button>
            : <button onClick={() => openBuild(viewFlow.build)} className="px-2 py-0.5 border border-emerald-500 bg-emerald-700 hover:bg-emerald-600 text-white font-bold whitespace-nowrap" data-tip="Save your own copy to change">Create copy</button>}
          <button onClick={() => { exitView(); setPage('builds'); }} className="px-2 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737] font-bold whitespace-nowrap" data-tip="Back to the flow's page">Close</button>
        </div>
      )}

      {/* Manual counts: under the header on the left (editing only; phones just view flows) */}
      {page === 'canvas' && !viewing && !building && (
        <button
          onClick={() => toggleManualCounts(!manualCounts)}
          onMouseDown={(e) => e.stopPropagation()}
          role="switch"
          aria-checked={manualCounts}
          className={`absolute top-[52px] left-3 z-30 hidden md:flex items-center gap-2 h-7 px-2 border text-[11px] font-bold shadow-xl transition-colors ${manualCounts ? 'bg-amber-950/80 border-amber-400 text-amber-200' : 'bg-[#161a24]/90 border-[#2b3548] text-slate-400 hover:text-slate-200'}`}
          data-tip={manualCounts
            ? 'Manual counts on: new machines start at 1 and keep the count you set. Auto Ratio still sizes them when you click it. Click to let counts follow demand.'
            : 'Manual counts off: machine counts follow demand. Click to set every count yourself.'}
        >
          <span className={`relative w-7 h-3.5 border transition-colors ${manualCounts ? 'bg-amber-500/40 border-amber-400' : 'bg-[#0f131c] border-[#3a4660]'}`}>
            <span className={`absolute top-[1px] w-2.5 h-2.5 transition-all ${manualCounts ? 'left-[14px] bg-amber-300' : 'left-[1px] bg-slate-500'}`} />
          </span>
          Manual counts
        </button>
      )}

      {/* Flow name: under the header on the right, moving left of the side panel with the energy box */}
      {page === 'canvas' && (viewing || currentSave || nodes.length > 0) && (
        <div
          className={`absolute top-[52px] z-30 max-w-[40vw] text-[11px] text-slate-300 bg-[#161a24]/90 border border-[#262f42] px-2 h-7 flex items-center shadow-xl transition-[right] duration-200 ease-out max-md:max-w-[60vw] ${sidebarOpen ? 'max-md:hidden' : ''}`}
          style={{ right: sidebarOpen ? 432 : 12 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {viewing
            ? <span className="truncate" data-tip-cut="" data-tip={viewFlow.build.name}>{viewFlow.build.name}</span>
            : (
              <EditableText
                value={currentSave?.name ?? 'Untitled flow'}
                onCommit={(name) => (currentSave ? handleRenameSave(currentSave.id, name) : handleSaveAs(name))}
                title="Click to rename"
              />
            )}
        </div>
      )}

      {/* Energy box floats bottom-right, moving left of the side panel when it's open */}
      <div
        // Phones: spans the bottom edge and scrolls sideways if it doesn't fit; hidden under the full-screen panel.
        className={`absolute bottom-3 z-30 text-[11px] text-slate-400 whitespace-nowrap shadow-2xl transition-[right] duration-200 ease-out max-md:left-2 max-md:!right-2 max-md:bottom-2 ${page === 'builds' || building ? 'hidden' : ''} ${sidebarOpen ? 'max-md:hidden' : ''}`}
        style={{ right: sidebarOpen && page === 'canvas' ? 432 : 12, left: toolAbove && page === 'canvas' && !viewing ? 12 : undefined }}
        onMouseDown={(e) => e.stopPropagation()}
        ref={energyRef}
        data-readonly={viewing ? '' : undefined}
      >
        {/* Energy: budget, use, generation and net */}
        <div
          className={`flex items-center px-2.5 gap-2.5 h-8 text-xs leading-none border transition-colors max-md:overflow-x-auto max-md:text-[10px] max-md:gap-1.5 max-md:px-1.5 max-md:h-7 ${powerPositive ? 'bg-[#2a2109] border-amber-400/80 shadow-[0_0_12px_rgba(251,191,36,0.25)]' : 'bg-[#161a24] border-[#262f42]'}`}
          data-tip={powerPositive ? 'Your generators cover everything this flow draws' : undefined}
        >
          {/* Phones: canvas settings (desktop has them in the bottom-left toolbar) */}
          <span className="md:hidden flex-shrink-0">
            <Dropdown label={<PixelIcon name="settings" className="w-3 h-3" />} className="!h-6 !px-1.5 bg-[#1b2230] border-[#2b3548] text-slate-300" tip="Canvas settings">
              {(close) => {
                const toggle = (label: string, on: boolean, run: () => void, help: string) => (
                  <button key={label} onClick={run} className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[#202737]">
                    <span className={`mt-0.5 w-3 h-3 border flex-shrink-0 ${on ? 'bg-cyan-400 border-cyan-300' : 'border-slate-500'}`} />
                    <span className="min-w-0">
                      <span className={`block font-bold ${on ? 'text-cyan-200' : 'text-slate-300'}`}>{label}</span>
                      <span className="block text-[10px] text-slate-500 leading-snug">{help}</span>
                    </span>
                  </button>
                );
                return (
                  <>
                    <button onClick={() => { close(); handleAutoSort(); }} disabled={!nodes.length} className="w-full px-3 py-2 text-left hover:bg-[#202737] disabled:opacity-40">
                      <span className="block font-bold text-cyan-300">Auto sort</span>
                      <span className="block text-[10px] text-slate-500 leading-snug">Tidy the cards into columns, inputs on the left (undo-able)</span>
                    </button>
                    <div className="border-t border-[#283244] my-1" />
                    {toggle('Snap', snapOn, () => setSnapOn((v) => !v), 'Line cards up while dragging')}
                    {toggle('Flow animation', flowAnim, () => setFlowAnim((v) => !v), 'Animate every wire (off is smoother)')}
                    {toggle('Flow labels', showLabels, toggleLabels, 'Supplied / needed panels on each wire')}
                  </>
                );
              }}
            </Dropdown>
          </span>
          <button
            onClick={() => setBudgetOn((v) => !v)}
            className={`px-1.5 py-1 min-h-6 border text-[10px] font-bold leading-none flex-shrink-0 ${budgetOn ? 'border-emerald-500/60 text-emerald-300 bg-emerald-950/40' : 'border-[#2b3548] text-slate-500'}`}
            data-tip={budgetOn ? 'EU/t budget is on: Auto Ratio and Max Flow stay inside it. Click to turn it off.' : 'EU/t budget is off: nothing is limited by power. Click to turn it on.'}
          >
            BUDGET {budgetOn ? 'ON' : 'OFF'}
          </button>
          {budgetOn && (
            <EditableValue
              value={budget}
              unit="eu"
              display={formatEU(budget)}
              onCommit={(v) => setBudget(Math.max(0, Math.round(v)))}
              className={`min-h-6 ${eutStatus === 'danger' ? 'text-red-400' : eutStatus === 'warning' ? 'text-amber-300' : 'text-emerald-400'}`}
              title="Click to change the EU/t budget"
            />
          )}
          <div className="h-4 w-[1px] bg-slate-700/60" />
          <span className="text-slate-400">USED:</span>
          <span className={`font-bold ${eutStatus === 'danger' ? 'text-red-400' : eutStatus === 'warning' ? 'text-amber-300' : 'text-slate-300'}`}>{formatEU(flows.euConsumed)}</span>
          {flows.euGenerated > 0 && (
            <>
              <div className="h-4 w-[1px] bg-slate-700/60" />
              <span className="text-slate-400">GEN:</span>
              <span className="font-bold text-amber-300">+{formatEU(flows.euGenerated)}</span>
              <div className="h-4 w-[1px] bg-slate-700/60" />
              <span className="text-slate-400">NET:</span>
              <span className={`font-bold ${powerPositive ? 'text-yellow-300' : 'text-rose-400'}`}>{netEU >= 0 ? '+' : '-'}{formatEU(Math.abs(netEU))}</span>
            </>
          )}
        </div>
      </div>
      {/* Inside the root so it follows the pixel-font setting */}
      <ConsentBanner />
    </div>
  );
}

export default App;
