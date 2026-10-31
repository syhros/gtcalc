import React from 'react';
import { ArrowRightToLine, Route, Target, Unlink, Zap } from 'lucide-react';
import { PixelIcon } from './PixelIcon';
import { TIERS, type CanvasNode, type GeneratorVariant, type MachineInfo, type MachineVariant, type RecipeItem, type RotorInfo, type VoltageTier } from '../types';
import { nodeInputs, type NodeFlow } from '../solver';
import { itemsMatch } from '../recipeData';
import { compact, formatChance, formatEU, formatRate, useUnits, visibleColor } from '../format';
import { MachineIcon } from './MachineIcon';
import { EditableValue } from './RateInput';
import { ItemIcon } from './ItemIcon';

export const NODE_WIDTH = 360;
export const NODE_WIDE = 450; // cards with machine dropdowns (generators, multiblock choice)
export const NODE_TARGET_WIDE = 530; // a target with several outputs: room for each output's target button
const PARALLEL_HATCHES = [
  { parallel: 1, name: 'No parallel hatch' },
  { parallel: 4, name: 'Parallel Control Hatch (IV) — 4x' },
  { parallel: 16, name: 'Advanced Parallel Hatch (LuV) — 16x' },
  { parallel: 64, name: 'Elite Parallel Hatch (ZPM) — 64x' },
  { parallel: 256, name: 'Ultimate Parallel Hatch (UV) — 256x' },
];
export const SUPPLY_WIDTH = 260;

export interface LinkHint { side: 'in' | 'out'; item: RecipeItem; nodeId: string }

interface Props {
  node: CanvasNode;
  flow: NodeFlow | undefined;
  machines?: Record<string, MachineInfo>;
  tierCasings?: Partial<Record<VoltageTier, string>>;
  genVariants?: GeneratorVariant[];
  machineVariants?: MachineVariant[];
  onMultiChange?: (node: CanvasNode, change: { variantId?: string | null; parallel?: number }) => void;
  rotors?: RotorInfo[];
  connectedInputs: Set<string>;
  connectedOutputs: Set<string>;
  linkHint: LinkHint | null;
  registerEl: (id: string, el: HTMLDivElement | null) => void;
  onHeaderMouseDown: (e: React.MouseEvent, node: CanvasNode) => void;
  onTierStep: (node: CanvasNode, dir: 1 | -1) => void;
  onSetCount: (node: CanvasNode, count: number) => void;
  onToggleCountMode: (node: CanvasNode) => void;
  onSetTarget: (node: CanvasNode) => void;
  onRemove: (node: CanvasNode) => void;
  onChangeRecipe: (node: CanvasNode) => void;
  onPortMouseDown: (e: React.MouseEvent, node: CanvasNode, side: 'in' | 'out', item: RecipeItem) => void;
  onPortClick: (node: CanvasNode, side: 'in' | 'out', item: RecipeItem) => void;
  onTargetRate: (node: CanvasNode, itemId: string, perSec: number) => void;
  onTargetEUt: (node: CanvasNode, eut: number) => void;
  manualCounts?: boolean;
  readOnly?: boolean; // view mode: no header controls except the target marker // every count is the player's own: no per-machine PINNED badge
  onGenChange: (node: CanvasNode, change: { variantId?: string; boostOn?: boolean; rotorId?: string }) => void;
  onSupplyLimit: (node: CanvasNode, limit: number | undefined) => void;
  onRoute?: (node: CanvasNode) => void; // Output nodes: plan a Best Route that makes the item
  variants?: RecipeItem[]; // Input/Output nodes for an item with several types (GTNH ores)
  onVariant?: (node: CanvasNode, item: RecipeItem) => void;
  onUnlink: (node: CanvasNode, port?: { side: 'in' | 'out'; itemId: string }) => void;
  pulse?: number; // set when 'Go to' jumps here: plays a glow ring (changes restart it)
  dimmed?: boolean; // another node or wire is hovered and this isn't connected to it
  selected?: boolean; // picked with the Select tool
  onHover?: (node: CanvasNode | null) => void;
}

type Theme = { border: string; bg: string; header: string; headerBorder: string; glow: string; label: string };
function theme(isTarget: boolean, isGenerator: boolean, isMultiblock: boolean): Theme {
  if (isGenerator) {
    return isTarget
      ? { border: '#fcd34d', bg: 'rgba(51,39,15,0.94)', header: 'rgba(146,64,14,0.42)', headerBorder: 'rgba(251,191,36,0.6)', glow: '0 0 34px rgba(251,191,36,0.55), inset 0 0 30px rgba(251,191,36,0.10)', label: '#fcd34d' }
      : { border: '#fbbf24', bg: 'rgba(37,29,18,0.94)', header: 'rgba(69,26,3,0.5)', headerBorder: 'rgba(245,158,11,0.4)', glow: '0 0 22px rgba(251,191,36,0.22)', label: 'rgba(251,191,36,0.8)' };
  }
  if (isTarget) {
    return { border: '#22d3ee', bg: 'rgba(26,53,80,0.95)', header: 'rgba(22,78,99,0.5)', headerBorder: 'rgba(34,211,238,0.6)', glow: '0 0 32px rgba(6,182,212,0.5), inset 0 0 34px rgba(6,182,212,0.14)', label: '#67e8f9' };
  }
  if (isMultiblock) {
    return { border: '#e2e8f0', bg: 'rgba(31,37,51,0.95)', header: 'rgba(203,213,225,0.13)', headerBorder: 'rgba(203,213,225,0.35)', glow: '0 0 22px rgba(226,232,240,0.16), inset 0 0 24px rgba(226,232,240,0.04)', label: '#cbd5e1' };
  }
  return { border: '#334155', bg: 'rgba(22,26,36,0.95)', header: 'rgba(40,50,68,0.4)', headerBorder: '#283244', glow: 'none', label: '#64748b' };
}

/** Is this row a valid drop target for the link being dragged? */
function linkState(hint: LinkHint | null, nodeId: string, side: 'in' | 'out', item: RecipeItem): 'match' | 'dim' | null {
  if (!hint || hint.nodeId === nodeId) return null;
  if (hint.side === side) return 'dim';
  return itemsMatch(hint.item, item) ? 'match' : 'dim';
}

const PortNub = ({ side, color, connected }: { side: 'in' | 'out'; color: string; connected: boolean }) => (
  <span
    className={`absolute top-1/2 -translate-y-1/2 w-2 h-3 ${side === 'in' ? '-left-[19px]' : '-right-[19px]'}`}
    style={{ backgroundColor: color, opacity: connected ? 1 : 0.35 }}
  />
);

/** Machine count: shown short (1.2k) so it fits; the exact number appears while editing. */
function CountInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? compact(value)}
      onFocus={(e) => { setDraft(String(value)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => {
        const text = e.target.value.replace(/[^\d]/g, '');
        setDraft(text);
        if (text) onChange(Math.max(0, parseInt(text, 10)));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
      onMouseDown={(e) => e.stopPropagation()}
      className="w-12 h-6 bg-[#171d2b] border border-[#2c374c] text-center text-amber-300 font-bold text-xs"
      data-tip={value >= 1000 ? `${value.toLocaleString()} machines` : undefined} aria-label="Machine count"
    />
  );
}

const UnlinkPort = ({ onClick, side }: { onClick: () => void; side: 'in' | 'out' }) => (
  <button
    onMouseDown={(e) => e.stopPropagation()}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`absolute -top-2 ${side === 'in' ? '-left-2' : '-right-2'} hidden group-hover:flex w-4 h-4 items-center justify-center bg-rose-950 border border-rose-500/60 text-rose-300 text-[10px] leading-none z-10 hover:bg-rose-800`}
    data-tip="Disconnect this port"
  >
    ✕
  </button>
);

const PortDot = ({ item, connected }: { item: RecipeItem; connected: boolean }) => (
  <ItemIcon id={item.id} color={item.iconColor} size={16} glow={connected} />
);

/** Mouse-over handlers for hover highlighting (wired on the card root). */
const hoverProps = (props: Props) => ({
  onMouseEnter: () => props.onHover?.(props.node),
  onMouseLeave: () => props.onHover?.(null),
});

/**
 * Stable ref callback for the card element. An inline ref is called with null then the
 * element on every render, which re-registered the card with the ResizeObserver; that
 * fired a full re-measure (forced layout of every card) plus an extra render on each drag frame.
 */
function useNodeRef(props: Props) {
  const { registerEl, node } = props;
  const id = node.instanceId;
  return React.useCallback((el: HTMLDivElement | null) => registerEl(id, el), [registerEl, id]);
}

export const NodeCard = React.memo(function NodeCard(props: Props) {
  useUnits(); // memoised: re-render when the display units change
  if (props.node.recipe.kind === 'supply') return <SupplyCard {...props} />;
  if (props.node.recipe.kind === 'output') return <OutputCard {...props} />;
  return <MachineCard {...props} />;
});

function MachineCard(props: Props) {
  const { node, flow, machines, tierCasings, connectedInputs, connectedOutputs, genVariants, rotors, linkHint } = props;
  const nodeRef = useNodeRef(props);
  const recipe = node.recipe;
  const gen = node.gen;
  const isTarget = !!node.isTarget;
  const isGenerator = !!recipe.generatesEU || recipe.kind === 'generator';
  const multi = node.multi;
  const multiVariant = multi ? props.machineVariants?.find((v) => v.id === multi.variantId) : undefined;
  const isMultiblock = !!recipe.multiblock || recipe.kind === 'multiblock' || (gen != null && gen.kind !== 'single') || !!multi;
  const hasMachineChoice = !recipe.generatesEU && !recipe.boiler && !!props.machineVariants?.length;
  // The machine's own multiblock (when it takes a parallel hatch) is not another machine to pick.
  const selfVariant = props.machineVariants?.find((v) => v.self);
  const otherMachines = props.machineVariants?.filter((v) => !v.self) ?? [];
  const width = isTarget && !isGenerator && recipe.outputs.length > 1 ? NODE_TARGET_WIDE
    : (gen && (genVariants?.length ?? 0) > 1) || hasMachineChoice || gen?.kind === 'turbine' ? NODE_WIDE : NODE_WIDTH;
  const isBoiler = !!recipe.boiler;
  const t = theme(isTarget, isGenerator, isMultiblock);
  const stats = flow?.stats;
  const variant = gen ? genVariants?.find((v) => v.id === gen.variantId) : undefined;
  const machineName = gen && gen.kind !== 'single' ? gen.name : multi ? multi.name : recipe.machineName;
  const shownTier: VoltageTier = gen?.kind === 'engine' ? gen.tier! : gen?.kind === 'turbine' ? gen.holderTier ?? gen.tier! : node.selectedTier;
  const tierInfo = TIERS[shownTier];
  const auto = flow ? (flow.isSink ? isTarget && (node.targetRate != null || node.targetEUt != null) : node.countMode !== 'manual') : true;
  const targetItemId = node.targetRate?.itemId ?? recipe.outputs[0]?.id;
  const inputs = stats ? nodeInputs(node, stats) : recipe.inputs;
  const durationSec = stats?.durationSec ?? recipe.baseDurationSec;

  const tierLabel = (() => {
    if (gen?.kind === 'engine') return gen.boostOn ? `${stats?.parallel ?? 0}x BOOST` : `${stats?.parallel ?? 0}x PAR`;
    if (gen?.kind === 'turbine') return 'HOLDER';
    if (gen?.kind === 'boiler') return `${compact(gen.steamPerTick ?? 0)} steam/t`;
    if (stats?.tierLocked) return 'FIXED';
    if (multi && stats && stats.parallel > 1) return `${stats.parallel}x PAR${stats.overclocks ? ` +${stats.overclocks} OC` : ''}`;
    if (isGenerator) return stats && stats.parallel > 1 ? `${stats.parallel}x PAR` : 'BASE';
    return stats && stats.overclocks > 0 ? `+${stats.overclocks} OC` : 'BASE';
  })();
  const tierTitle = gen?.kind === 'engine' ? 'Large engines run at a fixed tier'
    : gen?.kind === 'boiler' ? 'Steam per tick at full temperature and 100% throttle. Fuel burns for the same time in every boiler, so bigger boilers make more steam from each fuel item.'
    : gen?.kind === 'turbine' ? 'Rotor holder tier (left-click up / right-click down). Each tier above the turbine doubles power and adds 10% efficiency.'
    : stats?.tierLocked ? 'This machine does not overclock'
    : isGenerator ? 'Left-click: tier up | Right-click: tier down. Each tier runs 4x parallel: 4x EU and 4x fuel.'
    : 'Left-click: tier up | Right-click: tier down';

  return (
    <div
      ref={nodeRef}
      data-node={node.instanceId}
      className={`absolute pointer-events-auto border-[3px] p-3 flex flex-col gap-2 text-xs transition-opacity duration-150 ${props.dimmed ? 'opacity-25' : flow?.idle && !isTarget ? 'opacity-45 grayscale-[60%] hover:opacity-100 hover:grayscale-0' : ''} ${props.selected ? 'outline outline-2 outline-offset-4 outline-cyan-400' : ''}`}
      // Fixed width so cards line up; long names wrap over several lines (between words).
      style={{ left: node.x, top: node.y, width, boxShadow: t.glow, borderColor: t.border, background: t.bg }}
      {...hoverProps(props)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {props.pulse != null && <div key={props.pulse} className="node-pulse" />}
      {/* Header: drag handle */}
      <div className="flex flex-col border-b pb-2 cursor-move p-1.5" style={{ background: t.header, borderColor: t.headerBorder }} onMouseDown={(e) => props.onHeaderMouseDown(e, node)}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-slate-100 text-sm min-w-0">
            <MachineIcon recipe={recipe} tier={node.selectedTier} machines={machines} tierCasings={tierCasings} variant={variant ?? multiVariant} size={26} />
            <span className="break-normal leading-tight" data-tip={machineName}>{machineName}</span>
          </div>
          <div className="relative flex items-center gap-1 flex-shrink-0" onMouseDown={(e) => e.stopPropagation()}>
            {/* Under the header buttons, over the recipe line's free space: showing or hiding it never
                changes the card's size. */}
            {!auto && !flow?.isSink && !props.manualCounts && (
              <button
                onClick={() => props.onSetCount(node, -1)}
                className="absolute right-0 top-full mt-1 h-4 px-1 border border-amber-500/60 bg-[#1a1608] text-amber-300 text-[9px] font-bold leading-none z-[1]"
                data-tip="This count is pinned (you typed it). Click to let it follow demand again."
              >
                PINNED ✕
              </button>
            )}
            {!props.readOnly && connectedInputs.size + connectedOutputs.size > 0 && (
              <button onClick={() => props.onUnlink(node)} className="w-5 h-5 bg-[#1e2535] hover:bg-rose-950 border border-[#2d3a52] hover:border-rose-500/50 flex items-center justify-center text-slate-300 hover:text-rose-300" data-tip="Disconnect this machine from everything" aria-label="Disconnect this machine from everything">
                <Unlink className="w-3 h-3" />
              </button>
            )}
            {!props.readOnly && <button onClick={() => props.onChangeRecipe(node)} className="w-5 h-5 bg-[#1e2535] hover:bg-[#2b384e] border border-[#2d3a52] flex items-center justify-center text-slate-300" data-tip="Change recipe for this machine" aria-label="Change recipe for this machine">
              <PixelIcon name="settings" className="w-3 h-3" />
            </button>}
            {(!props.readOnly || isTarget) && <button
              onClick={() => props.onSetTarget(node)}
              className={`w-5 h-5 border flex items-center justify-center ${
                isTarget
                  ? 'bg-blue-700 border-blue-300 text-white shadow-[0_0_8px_rgba(96,165,250,0.8)]'
                  : 'bg-[#1b2230] border-[#2c374c] text-slate-400 hover:text-slate-200'
              }`}
              data-tip={isTarget ? 'Target machine' : 'Set as target'} aria-label={isTarget ? 'Target machine' : 'Set as target'}
            >
              <PixelIcon name="target" className="w-3 h-3" />
            </button>}
            {!props.readOnly && <button onClick={() => props.onRemove(node)} className="w-5 h-5 bg-rose-950/80 hover:bg-rose-900 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold" data-tip="Remove machine" aria-label="Remove machine">
              <PixelIcon name="cross" className="w-2.5 h-2.5" />
            </button>}
          </div>
        </div>
        <div className="text-[11px] text-slate-400 font-normal mt-1 flex items-center gap-1.5 flex-wrap">
          <span>({recipe.recipeName})</span>
          {recipe.circuit != null && <span className="px-1 border border-slate-600 text-slate-300 text-[10px]" data-tip="Programmed circuit configuration">⚙ {recipe.circuit}</span>}
          {recipe.source === 'builtin' && <span className="px-1 border border-sky-700 text-sky-300 text-[10px]" data-tip="Base GTCEu recipe (built-in until a GTCEu recipe dump is imported)">GT base</span>}
        </div>
      </div>

      {/* Controls */}
      {/* [contain:inline-size]: these rows fit the card instead of widening it (they wrap
          between whole items), so the card's width follows its names and ports. */}
      <div data-detail="controls" className="grid grid-cols-[auto_1fr] gap-2 bg-[#12151e]/90 p-2 border border-[#222a3b] [contain:inline-size]">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-slate-400 text-[11px]">Count:</span>
          <CountInput value={flow ? flow.machines : node.count} onChange={(v) => props.onSetCount(node, v)} />
          <div className="flex flex-col">
            <button onClick={() => props.onSetCount(node, (flow?.machines ?? node.count) + 1)} className="w-4 h-3 bg-[#1b2333] hover:bg-[#253249] border border-[#2c3a52] flex items-center justify-center text-slate-300" data-tip="Increment count" aria-label="Increment count">
              <PixelIcon name="up" className="w-2 h-[5px]" />
            </button>
            <button onClick={() => props.onSetCount(node, Math.max(0, (flow?.machines ?? node.count) - 1))} className="w-4 h-3 bg-[#1b2333] hover:bg-[#253249] border border-[#2c3a52] flex items-center justify-center text-slate-300" data-tip="Decrement count" aria-label="Decrement count">
              <PixelIcon name="down" className="w-2 h-[5px]" />
            </button>
          </div>
          <button onClick={() => props.onSetCount(node, Math.max(1, (flow?.machines ?? node.count) * 2))} className="h-6 px-1.5 text-[10px] bg-[#1b2333] hover:bg-[#253249] border border-[#2c3a52] text-slate-400 font-bold ml-0.5">x2</button>
          <button
            onClick={() => props.onToggleCountMode(node)}
            className={`w-6 h-6 flex-shrink-0 ml-0.5 border flex items-center justify-center ${node.setupLocked ? 'border-amber-500/70 text-amber-300 bg-amber-950/40' : 'border-emerald-600/50 text-emerald-400'}`}
            data-tip={node.setupLocked
              ? 'Machine locked: Auto Ratio keeps this tier and machine type (the count still follows demand). Click to unlock.'
              : 'Click to lock this machine\'s tier and type, so Auto Ratio leaves them alone (the count still follows demand).'}
          >
            {node.setupLocked ? <PixelIcon name="lock" className="w-3 h-3" /> : <PixelIcon name="unlock" className="w-3 h-3" />}
          </button>
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <button
            data-tier-button
            disabled={stats?.tierLocked || gen?.kind === 'engine'}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onTierStep(node, 1); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); props.onTierStep(node, -1); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ backgroundColor: tierInfo.badgeBg, borderColor: tierInfo.badgeBorder, color: tierInfo.color }}
            className="px-2.5 py-0.5 font-bold border text-xs tracking-wider shadow hover:brightness-110 active:scale-95 transition disabled:opacity-70 disabled:cursor-not-allowed"
            data-tip={tierTitle}
          >
            {shownTier}
          </button>
          <span className="text-[11px] text-slate-400 font-bold whitespace-nowrap" data-tip={tierTitle}>{tierLabel}</span>
        </div>

        {/* Multiblock alternative + parallel hatch */}
        {hasMachineChoice && (
          <div data-detail="extra" className="col-span-2 flex items-center gap-1.5 flex-wrap pt-1 border-t border-[#1e2538] text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
            {otherMachines.length > 0 && (
            <select
              value={multi && !multiVariant?.self ? multi.variantId : ''}
              onChange={(e) => props.onMultiChange?.(node, { variantId: e.target.value || null })}
              className="w-full min-w-0 bg-[#171d2b] border border-[#2c374c] text-slate-200 px-1 py-0.5 text-[11px]"
              data-tip="Machine running this recipe: the basic machine, or a multiblock that can run it" aria-label="Machine running this recipe: the basic machine, or a multiblock that can run it"
            >
              <option value="">{recipe.machineName}{recipe.multiblock ? '' : ' (single block)'}</option>
              {otherMachines.map((v) => <option key={v.id} value={v.id}>{v.name}{v.parallel ? ' (parallel hatch)' : ''}</option>)}
            </select>
            )}
            {(multiVariant?.parallel || (selfVariant && !multi)) && (
              <select
                value={multi?.parallel ?? 1}
                onChange={(e) => props.onMultiChange?.(node, { parallel: Number(e.target.value) })}
                className="w-full min-w-0 bg-[#171d2b] border border-[#2c374c] text-slate-200 px-1 py-0.5 text-[11px]"
                data-tip="Parallel hatch: this many crafts run at once (EU/t x the same). If the tier badge has power to spare, the combined recipe also overclocks." aria-label="Parallel hatch: this many crafts run at once (EU/t x the same). If the tier badge has power to spare, the combined recipe also overclocks."
              >
                {PARALLEL_HATCHES.map((h) => <option key={h.parallel} value={h.parallel}>{h.name}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Generator machine choice */}
        {(isGenerator || isBoiler) && genVariants && genVariants.length > 0 && gen && (
          <div data-detail="extra" className="col-span-2 flex items-center gap-1.5 flex-wrap pt-1 border-t border-[#1e2538] text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
            {genVariants.length > 1 && (
              <select
                value={gen.variantId}
                onChange={(e) => props.onGenChange(node, { variantId: e.target.value })}
                className="w-full min-w-0 bg-[#171d2b] border border-[#2c374c] text-slate-200 px-1 py-0.5 text-[11px]"
                data-tip="Machine burning this fuel" aria-label="Machine burning this fuel"
              >
                {genVariants.map((v) => <option key={v.id} value={v.id}>{v.kind === 'single' ? `${v.name} (LV-${v.maxTier})` : v.kind === 'boiler' ? `${v.name} (${compact(v.steamPerTick ?? 0)} steam/t)` : `${v.name} (${v.tier})`}</option>)}
              </select>
            )}
            {gen.kind === 'engine' && gen.boost && (
              <label className="flex items-center gap-1 text-slate-300 cursor-pointer" data-tip={`Boost: ${gen.boost.perTick} mB/t of ${gen.extras?.find((x) => x.boostOnly)?.name ?? 'oxygen'}. Doubles parallels (fuel use) and multiplies output by ${gen.boost.factor * 2} overall. Needs a dynamo hatch one tier above the engine.`}>
                <input type="checkbox" checked={!!gen.boostOn} onChange={(e) => props.onGenChange(node, { boostOn: e.target.checked })} className="accent-amber-400" />
                {gen.extras?.find((x) => x.boostOnly)?.name ?? 'Oxygen'} boost
              </label>
            )}
            {gen.kind === 'turbine' && rotors && (
              <select
                value={gen.rotor?.id}
                onChange={(e) => props.onGenChange(node, { rotorId: e.target.value })}
                className="w-full min-w-0 bg-[#171d2b] border border-[#2c374c] text-slate-200 px-1 py-0.5 text-[11px]"
                data-tip="Turbine rotor: power sets max output, efficiency stretches each craft (less fuel)" aria-label="Turbine rotor: power sets max output, efficiency stretches each craft (less fuel)"
              >
                {rotors.map((r) => <option key={r.id} value={r.id}>{r.name} rotor — {r.power}% pwr / {r.efficiency}% eff</option>)}
              </select>
            )}
          </div>
        )}

        <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1 border-t border-[#1e2538] text-[11px] whitespace-nowrap">
          <div className="flex items-center gap-1 font-bold">
            <Zap className={`w-3.5 h-3.5 ${isGenerator ? 'fill-amber-300 text-amber-300' : 'fill-amber-400 text-amber-400'}`} />
            <span className={isGenerator ? 'text-amber-300' : 'text-amber-400'} data-tip="Per machine at the selected tier / setup">
              {isGenerator ? '+' : ''}{formatEU(stats?.eutPerMachine ?? recipe.baseEUt)}
            </span>
            <span className="text-slate-500 text-[10px]">/machine</span>
          </div>
          <div className="text-cyan-300 font-bold" data-tip="Craft duration at the selected tier">
            {durationSec.toFixed(2)}s
            <span className="text-slate-400 text-[10px] ml-1">({stats?.durationTicks ?? recipe.durationTicks}t)</span>
          </div>
        </div>
        {recipe.startEU != null && <div className="col-span-2 text-[10px] text-slate-400">Start-up cost: <span className="text-amber-300">{compact(recipe.startEU)} EU</span> per craft</div>}
        {gen?.kind === 'turbine' && stats && stats.eutPerMachine === 0 && <div className="col-span-2 text-[10px] text-rose-400">Rotor too weak: turbine output must exceed the fuel recipe's {recipe.baseEUt} EU/t.</div>}
      </div>

      {/* Blank machine (added from the machine list): ask for a recipe */}
      {recipe.id.startsWith('blank:') && (
        <button
          onClick={() => props.onChangeRecipe(node)}
          onMouseDown={(e) => e.stopPropagation()}
          className="py-2 border border-dashed border-cyan-500/60 text-cyan-300 hover:bg-cyan-950/40 font-bold text-xs"
        >
          Pick a recipe for this machine
        </button>
      )}

      {/* Inputs / outputs */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="space-y-1 min-w-0">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">Inputs</div>
          {inputs.map((inp, idx) => {
            const rate = flow?.inputRates[inp.id] ?? 0;
            const connected = connectedInputs.has(inp.id);
            const color = visibleColor(inp.iconColor);
            const ls = linkState(linkHint, node.instanceId, 'in', inp);
            return (
              <div
                key={`${inp.id}-${idx}`}
                data-port={`in:${inp.id}`}
                data-tip="Drag to link"
                onMouseDown={(e) => props.onPortMouseDown(e, node, 'in', inp)}
                onClick={() => props.onPortClick(node, 'in', inp)}
                className={`group relative min-h-7 py-0.5 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 px-1.5 border cursor-pointer hover:border-cyan-400 transition-colors ${connected ? 'bg-[#151b27]' : 'bg-[#121620] border-[#222a3b]'} ${ls === 'match' ? 'ring-2 ring-emerald-400' : ls === 'dim' ? 'opacity-40' : ''}`}
                style={connected ? { borderColor: `${color}88` } : undefined}
              >
                <PortNub side="in" color={color} connected={connected} />
                {connected && <UnlinkPort side="in" onClick={() => props.onUnlink(node, { side: 'in', itemId: inp.id })} />}
                <div className="flex items-center gap-1.5">
                  <PortDot item={inp} connected={connected} />
                  <span className="text-slate-200 break-normal leading-tight">{inp.name}</span>
                </div>
                <span className="text-rose-400 font-mono whitespace-nowrap font-bold ml-auto">
                  {inp.consumed === false ? <span className="text-slate-500">NC</span> : `-${formatRate(rate, inp.unit)}`}
                </span>
              </div>
            );
          })}
          {inputs.length === 0 && <div className="text-slate-600 italic text-[10px]">none</div>}
        </div>

        <div className="space-y-1 min-w-0">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5 text-right">Outputs</div>
          {isGenerator && (
            <div className="h-7 flex items-center justify-between gap-1 px-1.5 border bg-[#211a0f] border-amber-500/50" data-tip="Average EU/t generated by all machines">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
                <span className="font-bold text-amber-300">Energy</span>
              </div>
              {isTarget ? (
                <EditableValue
                  value={flow?.eutAvg ?? 0}
                  unit="eu"
                  display={`+${formatEU(flow?.eutAvg ?? 0)}`}
                  onCommit={(v) => props.onTargetEUt(node, v)}
                  className="text-amber-300"
                  title="Click to change the target EU/t"
                />
              ) : (
                <span className="text-amber-300 font-mono whitespace-nowrap font-bold ml-auto">+{formatEU(flow?.eutAvg ?? 0)}</span>
              )}
            </div>
          )}
          {recipe.outputs.map((out, idx) => {
            const rate = flow?.outputRates[out.id] ?? 0;
            const connected = connectedOutputs.has(out.id);
            const color = visibleColor(out.iconColor);
            const ls = linkState(linkHint, node.instanceId, 'out', out);
            const editable = isTarget && !isGenerator;
            return (
              <div
                key={`${out.id}-${idx}`}
                data-port={`out:${out.id}`}
                data-tip="Drag to link"
                onMouseDown={(e) => props.onPortMouseDown(e, node, 'out', out)}
                onClick={() => props.onPortClick(node, 'out', out)}
                className={`group relative min-h-7 py-0.5 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 px-1.5 border cursor-pointer hover:border-cyan-400 transition-colors ${connected ? 'bg-[#151b27]' : 'bg-[#121620] border-[#222a3b]'} ${ls === 'match' ? 'ring-2 ring-emerald-400' : ls === 'dim' ? 'opacity-40' : ''}`}
                style={connected ? { borderColor: `${color}88` } : undefined}
              >
                {connected && <UnlinkPort side="out" onClick={() => props.onUnlink(node, { side: 'out', itemId: out.id })} />}
                <div className="flex items-center gap-1.5">
                  <PortDot item={out} connected={connected} />
                  <span className={`break-normal leading-tight font-bold ${isTarget && out.id === targetItemId ? (isGenerator ? 'text-amber-300' : 'text-cyan-300') : 'text-slate-200'}`}>{out.name}</span>
                  {out.chance != null && <span className="text-[10px] font-bold text-amber-300/90 border border-amber-500/40 px-0.5 leading-none py-px" data-tip={`Chanced output: ${formatChance(out.chance)} per craft (the rate already counts it)`}>{formatChance(out.chance)}</span>}
                </div>
                {editable ? (
                  <EditableValue
                    value={rate}
                    unit={out.unit}
                    display={`+${formatRate(rate, out.unit)}`}
                    onCommit={(v) => props.onTargetRate(node, out.id, v)}
                    className="text-emerald-400 ml-auto"
                    title="Click to change the target output rate"
                  />
                ) : (
                  <span className="text-emerald-400 font-mono whitespace-nowrap font-bold ml-auto">+{formatRate(rate, out.unit)}</span>
                )}
                {/* A target with several outputs: pick which one the target rate is for (the rest scale with it) */}
                {editable && recipe.outputs.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); if (out.id !== targetItemId) props.onTargetRate(node, out.id, rate); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`w-5 h-5 flex-shrink-0 border flex items-center justify-center ${out.id === targetItemId ? 'bg-blue-700 border-blue-300 text-white' : 'bg-[#1b2230] border-[#2c374c] text-slate-500 hover:text-slate-200'}`}
                    data-tip={out.id === targetItemId ? 'The target rate is for this output; the other outputs scale with it' : 'Make this output the target (keeps the current rate; click the rate to change it)'} aria-label={out.id === targetItemId ? 'The target rate is for this output; the other outputs scale with it' : 'Make this output the target (keeps the current rate; click the rate to change it)'}
                  >
                    <PixelIcon name="target" className="w-3 h-3" />
                  </button>
                )}
                <PortNub side="out" color={color} connected={connected} />
              </div>
            );
          })}
          {recipe.outputs.length === 0 && !isGenerator && <div className="text-slate-600 italic text-[10px] text-right">none</div>}
        </div>
      </div>

      {/* Footer */}
      <div data-detail="footer" className="bg-[#12151e]/90 px-2 py-1 border border-[#222a3b] flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-slate-400 [contain:inline-size]">
        <div className="flex items-center gap-1.5 min-w-0" data-tip="Machines needed to sustain this rate, and how busy the built machines are">
          <span className="whitespace-nowrap">Needs <strong className={flow?.capped ? 'text-rose-400' : 'text-slate-200'}>{compact(flow?.machinesNeeded ?? 0)}</strong></span>
          <div className="w-14 h-1.5 bg-[#1e2433] border border-[#2a3346]">
            <div className={`h-full ${flow?.capped ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, (flow?.utilization ?? 0) * 100)}%` }} />
          </div>
          <span>{Math.round((flow?.utilization ?? 0) * 100)}%</span>
          {!isGenerator && flow && <span className="text-amber-400 font-bold whitespace-nowrap">{formatEU(flow.eutAvg)}</span>}
        </div>
        {flow?.idle && flow.idleReason === 'covered' ? (
          <span className="font-bold text-slate-400 whitespace-nowrap" data-tip="Everything this machine makes is already covered by byproducts or other machines, so it isn't needed at this rate.">
            NOT NEEDED
          </span>
        ) : flow?.idle ? (
          <span
            className="font-bold text-amber-400 whitespace-nowrap"
            data-tip={`Nothing outside its loop needs anything from this machine, so it isn't running.\nConnect one of its products (${recipe.outputs.filter((o) => !connectedOutputs.has(o.id)).map((o) => o.name).join(', ') || 'none free'}) to a machine that uses it, or make it the target.`}
          >
            NO DEMAND
          </span>
        ) : (
          <span className="font-bold whitespace-nowrap" style={{ color: t.label }}>{isTarget ? 'FINAL TARGET' : flow?.isSink ? 'END OF LINE' : flow?.capped ? 'LIMITED' : 'INTERMEDIATE'}</span>
        )}
      </div>
    </div>
  );
}

/** `color` blended into the dark card background (plain rgb, so image export keeps it). */
function mix(color: string, amount: number) {
  const n = parseInt(color.replace('#', '').slice(0, 6), 16);
  const bg = [16, 20, 28];
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `rgb(${c.map((v, i) => Math.round(bg[i] + (v - bg[i]) * amount)).join(',')})`;
}

/** Raw input: something you supply yourself (a tank, an AE2 export, another base). */
/** Which type of the item (GTNH: Iron Ore on stone, basalt, Mars...): swaps it, keeping the links. */
function VariantPicker({ props, item }: { props: Props; item: RecipeItem | undefined }) {
  if (!item || !props.variants || props.variants.length < 2 || !props.onVariant) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
      <span className="text-slate-400">Type</span>
      <select
        value={item.id}
        disabled={props.readOnly}
        onChange={(e) => { const v = props.variants!.find((x) => x.id === e.target.value); if (v) props.onVariant!(props.node, v); }}
        className="min-w-0 flex-1 bg-[#12151e] border border-fuchsia-500/50 text-fuchsia-200 px-1 py-0.5"
        data-tip="Which type of this item you're using: each has its own recipes" aria-label="Which type of this item you're using: each has its own recipes"
      >
        {props.variants.map((v) => <option key={v.id} value={v.id}>{v.variant ?? v.name}</option>)}
      </select>
    </div>
  );
}

function SupplyCard(props: Props) {
  const { node, flow, connectedOutputs, linkHint } = props;
  const nodeRef = useNodeRef(props);
  const item = node.recipe.outputs[0];
  const color = visibleColor(item?.iconColor);
  const used = flow?.outputRates[item?.id] ?? 0;
  const limit = node.supplyLimit;
  const capped = !!flow?.capped;
  const connected = item ? connectedOutputs.has(item.id) : false;
  const ls = item ? linkState(linkHint, node.instanceId, 'out', item) : null;

  return (
    <div
      ref={nodeRef}
      data-node={node.instanceId}
      className={`absolute pointer-events-auto border-[3px] p-2.5 flex flex-col gap-2 text-xs transition-opacity duration-150 ${props.dimmed ? 'opacity-25' : ''} ${props.selected ? 'outline outline-2 outline-offset-4 outline-cyan-400' : ''}`}
      style={{
        left: node.x,
        top: node.y,
        width: SUPPLY_WIDTH,
        borderColor: `${color}cc`,
        // The item's colour, muted, like the target card's tint.
        background: `linear-gradient(160deg, ${mix(color, 0.3)} 0%, ${mix(color, 0.16)} 100%)`,
        boxShadow: `0 0 22px ${color}44, inset 0 0 26px ${color}1f`,
      }}
      {...hoverProps(props)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {props.pulse != null && <div key={props.pulse} className="node-pulse" />}
      <div className="flex items-center justify-between gap-2 cursor-move border-b border-white/10 pb-1.5" onMouseDown={(e) => props.onHeaderMouseDown(e, node)}>
        <div className="flex items-center gap-1.5 font-bold text-slate-100 min-w-0">
          <ArrowRightToLine className="w-4 h-4 flex-shrink-0" style={{ color }} />
          {item && <ItemIcon id={item.id} color={item.iconColor} size={22} />}
          <span className="uppercase tracking-wider text-[10px] text-slate-300">Input</span>
        </div>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          {connected && (
            <button onClick={() => props.onUnlink(node)} className="w-5 h-5 bg-[#1e2535] hover:bg-rose-950 border border-[#2d3a52] flex items-center justify-center text-slate-300 hover:text-rose-300" data-tip="Disconnect this input from everything" aria-label="Disconnect this input from everything">
              <Unlink className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => props.onRemove(node)} className="w-5 h-5 bg-rose-950/80 hover:bg-rose-900 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold" data-tip="Remove input" aria-label="Remove input"><PixelIcon name="cross" className="w-2.5 h-2.5" /></button>
        </div>
      </div>

      <VariantPicker props={props} item={item} />
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">Supply limit</span>
        <EditableValue
          value={limit ?? NaN}
          unit={item?.unit ?? 'item'}
          display={limit == null ? '∞ unlimited' : formatRate(limit, item?.unit ?? 'item')}
          onCommit={(v) => props.onSupplyLimit(node, Number.isFinite(v) ? v : undefined)}
          allowEmpty
          placeholder="∞"
          className="text-amber-300"
          title="Click to change how much you can supply; empty means unlimited"
        />
      </div>

      {item && (
        <div
          data-port={`out:${item.id}`}
                data-tip="Drag to link"
          onMouseDown={(e) => props.onPortMouseDown(e, node, 'out', item)}
          onClick={() => props.onPortClick(node, 'out', item)}
          className={`group relative min-h-7 py-0.5 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 px-1.5 border cursor-pointer hover:border-cyan-400 transition-colors bg-[#151b27] ${ls === 'match' ? 'ring-2 ring-emerald-400' : ls === 'dim' ? 'opacity-40' : ''}`}
          style={{ borderColor: `${color}88` }}
        >
          <div className="flex items-center gap-1.5">
            <PortDot item={item} connected={connected} />
            <span className="break-normal leading-tight font-bold text-slate-200">{item.name}</span>
          </div>
          {/* Click the rate to set how much you supply (same as the Supply limit above) */}
          <EditableValue
            value={limit ?? used}
            unit={item.unit}
            display={`+${formatRate(used, item.unit)}`}
            onCommit={(v) => props.onSupplyLimit(node, Number.isFinite(v) ? v : undefined)}
            allowEmpty
            placeholder="∞"
            className={`ml-auto ${capped ? 'text-rose-400' : 'text-emerald-400'}`}
            title="Click to set how much you supply; empty means unlimited"
          />
          <PortNub side="out" color={color} connected={connected} />
        </div>
      )}
      <div className={`text-[10px] font-bold text-right [contain:inline-size] ${capped ? 'text-rose-400' : 'text-slate-500'}`}>
        {capped ? 'LIMITED — demand exceeds supply' : limit != null && limit > 0 ? `${Math.round((used / limit) * 100)}% of supply used` : 'RAW INPUT'}
      </div>
    </div>
  );
}

/** An Output node: what the line is for. Its one input takes the item at the rate you want. */
function OutputCard(props: Props) {
  const { node, flow, connectedInputs, linkHint } = props;
  const nodeRef = useNodeRef(props);
  const item = node.recipe.inputs[0];
  const color = visibleColor(item?.iconColor);
  const wanted = node.supplyLimit ?? 0;
  const got = item ? flow?.inputRates[item.id] ?? 0 : 0;
  const connected = item ? connectedInputs.has(item.id) : false;
  const ls = item ? linkState(linkHint, node.instanceId, 'in', item) : null;

  return (
    <div
      ref={nodeRef}
      data-node={node.instanceId}
      className={`absolute pointer-events-auto border-[3px] p-2.5 flex flex-col gap-2 text-xs transition-opacity duration-150 ${props.dimmed ? 'opacity-25' : ''} ${props.selected ? 'outline outline-2 outline-offset-4 outline-cyan-400' : ''}`}
      style={{
        left: node.x,
        top: node.y,
        width: SUPPLY_WIDTH,
        borderColor: '#22d3ee',
        background: `linear-gradient(160deg, ${mix(color, 0.3)} 0%, rgba(26,53,80,0.95) 100%)`,
        boxShadow: '0 0 28px rgba(6,182,212,0.45), inset 0 0 26px rgba(6,182,212,0.12)',
      }}
      {...hoverProps(props)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {props.pulse != null && <div key={props.pulse} className="node-pulse" />}
      <div className="flex items-center justify-between gap-2 cursor-move border-b border-white/10 pb-1.5" onMouseDown={(e) => props.onHeaderMouseDown(e, node)}>
        <div className="flex items-center gap-1.5 font-bold text-slate-100 min-w-0">
          <Target className="w-4 h-4 flex-shrink-0 text-cyan-300" />
          {item && <ItemIcon id={item.id} color={item.iconColor} size={22} />}
          <span className="uppercase tracking-wider text-[10px] text-cyan-200">Output</span>
        </div>
        {!props.readOnly && (
          <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
            {connected && (
              <button onClick={() => props.onUnlink(node)} className="w-5 h-5 bg-[#1e2535] hover:bg-rose-950 border border-[#2d3a52] flex items-center justify-center text-slate-300 hover:text-rose-300" data-tip="Disconnect this output from everything" aria-label="Disconnect this output from everything">
                <Unlink className="w-3 h-3" />
              </button>
            )}
            <button onClick={() => props.onRemove(node)} className="w-5 h-5 bg-rose-950/80 hover:bg-rose-900 border border-rose-500/30 flex items-center justify-center text-rose-300 font-bold" data-tip="Remove output" aria-label="Remove output"><PixelIcon name="cross" className="w-2.5 h-2.5" /></button>
          </div>
        )}
      </div>

      <VariantPicker props={props} item={item} />
      {item && (
        <div
          data-port={`in:${item.id}`}
          data-tip="Click to pick what makes it, or drag to link"
          onMouseDown={(e) => props.onPortMouseDown(e, node, 'in', item)}
          onClick={() => props.onPortClick(node, 'in', item)}
          className={`group relative min-h-7 py-0.5 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 px-1.5 border cursor-pointer hover:border-cyan-400 transition-colors bg-[#151b27] ${ls === 'match' ? 'ring-2 ring-emerald-400' : ls === 'dim' ? 'opacity-40' : ''}`}
          style={{ borderColor: `${color}88` }}
        >
          <PortNub side="in" color={color} connected={connected} />
          <div className="flex items-center gap-1.5">
            <PortDot item={item} connected={connected} />
            <span className="break-normal leading-tight font-bold text-slate-200">{item.name}</span>
          </div>
          <EditableValue
            value={wanted}
            unit={item.unit}
            display={formatRate(wanted, item.unit)}
            onCommit={(v) => { if (Number.isFinite(v) && v > 0) props.onSupplyLimit(node, v); }}
            className="ml-auto text-cyan-300"
            title="Click to set how much you want"
          />
        </div>
      )}
      {item && !connected && props.onRoute && !props.readOnly ? (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => props.onRoute!(node)}
          className="flex items-center justify-center gap-1.5 px-2 py-1 bg-[#211a2e] hover:bg-[#2d2340] border border-violet-500/50 text-violet-200 text-[11px] font-bold"
          data-tip={'Experimental. Adds the cheapest chain of machines that makes this from raw resources, then runs Auto Ratio and Auto Sort.\nStays at or below your max tier.'}
        >
          <Route className="w-3.5 h-3.5" /> Best route
        </button>
      ) : (
        <div className="text-[10px] font-bold text-right [contain:inline-size] text-slate-500">
          {connected ? `END OF LINE · ${formatRate(got, item?.unit ?? 'item')}` : 'NOT LINKED'}
        </div>
      )}
    </div>
  );
}
