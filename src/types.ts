export type VoltageTier =
  | 'ULV' | 'LV' | 'MV' | 'HV' | 'EV' | 'IV' | 'LuV' | 'ZPM' | 'UV' | 'UHV'
  | 'UEV' | 'UIV' | 'UXV' | 'OpV' | 'MAX';

export type MachineKind = 'single' | 'multiblock' | 'generator' | 'supply' | 'output';

export interface TierInfo {
  tier: VoltageTier;
  voltage: number;
  color: string;
  badgeBg: string;
  badgeBorder: string;
}

export const TIERS: Record<VoltageTier, TierInfo> = {
  // Colours as in GregTech: ULV dark grey, LV grey, MV cyan, HV yellow, EV purple, IV dark blue,
  // LuV pink, ZPM red, UV teal.
  ULV: { tier: 'ULV', voltage: 8, color: '#8a8f98', badgeBg: '#26292f', badgeBorder: '#555b66' },
  LV:  { tier: 'LV',  voltage: 32, color: '#d1d5db', badgeBg: '#3f4450', badgeBorder: '#9ca3af' },
  MV:  { tier: 'MV',  voltage: 128, color: '#22d3ee', badgeBg: '#0e4552', badgeBorder: '#06b6d4' },
  HV:  { tier: 'HV',  voltage: 512, color: '#facc15', badgeBg: '#5c4a07', badgeBorder: '#eab308' },
  EV:  { tier: 'EV',  voltage: 2048, color: '#c084fc', badgeBg: '#4c1d95', badgeBorder: '#a855f7' },
  IV:  { tier: 'IV',  voltage: 8192, color: '#6b8cff', badgeBg: '#1e2a78', badgeBorder: '#3b5bdb' },
  LuV: { tier: 'LuV', voltage: 32768, color: '#f9a8d4', badgeBg: '#831843', badgeBorder: '#ec4899' },
  ZPM: { tier: 'ZPM', voltage: 131072, color: '#f87171', badgeBg: '#7f1d1d', badgeBorder: '#ef4444' },
  UV:  { tier: 'UV',  voltage: 524288, color: '#2dd4bf', badgeBg: '#134e4a', badgeBorder: '#14b8a6' },
  UHV: { tier: 'UHV', voltage: 2097152, color: '#fb923c', badgeBg: '#7c2d12', badgeBorder: '#f97316' },
  UEV: { tier: 'UEV', voltage: 8388608, color: '#a3e635', badgeBg: '#365314', badgeBorder: '#84cc16' },
  UIV: { tier: 'UIV', voltage: 33554432, color: '#818cf8', badgeBg: '#312e81', badgeBorder: '#6366f1' },
  UXV: { tier: 'UXV', voltage: 134217728, color: '#e879f9', badgeBg: '#701a75', badgeBorder: '#d946ef' },
  OpV: { tier: 'OpV', voltage: 536870912, color: '#f87171', badgeBg: '#7f1d1d', badgeBorder: '#ef4444' },
  MAX: { tier: 'MAX', voltage: 2147483647, color: '#f8fafc', badgeBg: '#334155', badgeBorder: '#e2e8f0' },
};

export const TIER_ORDER: VoltageTier[] = ['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UXV', 'OpV', 'MAX'];

export interface RecipeItem {
  id: string; // namespaced id, tags prefixed with '#'
  name: string;
  amount: number; // per craft, in mB or item count
  unit: 'mB' | 'item';
  iconColor?: string;
  chance?: number; // 0..1, expected-value multiplier for chanced outputs/inputs
  consumed?: boolean; // false for not-consumed inputs (catalysts, programmed circuits)
  isTag?: boolean;
  group?: string; // GTNH: items sharing a name (Iron Ore on stone, basalt, Mars...) share a group
  variant?: string; // and each says which type it is
  fixed?: boolean; // amount is per machine, not multiplied by generator parallels (lubricant, boost fluids)
}

export interface MachineRecipe {
  id: string;
  machineId?: string; // GT recipe type, e.g. 'chemical_reactor'
  machineName: string;
  recipeName: string;
  baseTier: VoltageTier;
  baseEUt: number; // EU/t consumed (or produced, for generators) at base tier
  baseDurationSec: number;
  durationTicks?: number;
  inputs: RecipeItem[];
  outputs: RecipeItem[];
  kind?: MachineKind;
  multiblock?: boolean;
  generatesEU?: boolean;
  boiler?: boolean; // large boiler fuel: makes steam, the boiler type sets how much
  circuit?: number;
  startEU?: number;
  conditions?: string[];
  source?: 'kubejs' | 'gtceu' | 'builtin' | 'user';
  nonGT?: boolean; // only makes items from other mods
  manual?: boolean; // made in a crafting grid or another mod's block, not a GregTech machine
}

export interface MachineInfo {
  name: string;
  kind: MachineKind;
  multiblock?: boolean;
  overlay?: string;
  casing?: string;
  tiered?: boolean;
  runsIn?: string[];
  parallel?: boolean; // a multiblock with its own recipe type that takes a parallel control hatch
  manual?: boolean; // crafting grid or another mod's recipe type (exported packs): no GregTech machine
}

export interface CanvasNode {
  instanceId: string;
  recipe: MachineRecipe;
  selectedTier: VoltageTier;
  count: number; // machines built when countMode is 'manual'
  countMode?: 'auto' | 'manual';
  x: number;
  y: number;
  isTarget?: boolean;
  targetRate?: { itemId: string; perSec: number }; // target node: desired output rate
  targetEUt?: number; // target generator: desired EU/t output
  supplyLimit?: number; // input (supply) nodes: max per second, undefined = unlimited; output nodes: wanted per second
  gen?: GeneratorConfig; // generator recipes: which machine burns the fuel
  multi?: MultiConfig; // processing recipes run in a larger multiblock (e.g. Large Pyrolyse Oven)
  setupLocked?: boolean; // Auto Ratio keeps this node's tier and machine type
}

/** A multiblock that can run a recipe type instead of the basic machine. */
export interface MachineVariant {
  id: string;
  name: string;
  overlay?: string;
  casing?: string;
  parallel: boolean; // accepts a parallel control hatch
  self?: boolean; // the recipe type's own multiblock (only its hatch is a choice), see hydrate()
}
export interface MultiConfig {
  variantId: string;
  name: string;
  parallel: number; // parallel hatch limit (1 = none)
}

export interface RotorInfo { id: string; name: string; power: number; efficiency: number }

export interface GeneratorVariant {
  id: string;
  kind: 'single' | 'engine' | 'turbine' | 'boiler';
  name: string;
  maxTier?: VoltageTier; // single-block generators
  tier?: VoltageTier; // multiblocks
  boost?: { fluid: string; perTick: number; factor: number };
  steamScale?: number; // boilers: water + steam per craft relative to the recipe (bronze)
  steamPerTick?: number;
  overlay?: string;
  casing?: string;
}

export interface ExtraInput extends RecipeItem {
  perTick: number; // consumed per tick of running
  boostOnly?: boolean;
}

export interface GeneratorConfig {
  variantId: string;
  kind: GeneratorVariant['kind'];
  name: string;
  tier?: VoltageTier;
  maxTier?: VoltageTier;
  boost?: GeneratorVariant['boost'];
  boostOn?: boolean;
  rotor?: RotorInfo;
  holderTier?: VoltageTier;
  steamScale?: number;
  steamPerTick?: number;
  extras?: ExtraInput[];
}

export interface Connection {
  id: string;
  sourceInstanceId: string;
  sourceItemId: string;
  targetInstanceId: string;
  targetItemId: string;
}
