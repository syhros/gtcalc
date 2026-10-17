import { forwardRef, useEffect, useRef, useState } from 'react';
import { TIERS, type MachineInfo, type MachineRecipe, type VoltageTier } from '../types';
import { euUnit, formatEU, formatRate } from '../format';
import { ItemIcon } from './ItemIcon';
import { MachineIcon } from './MachineIcon';

export type BuildLayout = 'grid' | 'list' | 'checklist';
const BUILD_LAYOUTS: [BuildLayout, string, string][] = [
  ['grid', 'Grid', 'A card per machine, each recipe with its inputs and outputs'],
  ['list', 'List', 'One table, grouped by machine'],
  ['checklist', 'Checklist', 'By tier, each machine with the input and circuit to set it up with, and boxes to tick off'],
];

export interface BuildIO { id: string; name: string; unit: 'mB' | 'item'; color?: string; perSec: number }
/** One recipe line: a node on the canvas. */
export interface BuildRow {
  key: string;
  recipe: MachineRecipe;
  recipeName: string;
  tier: string; // '' when the recipe uses no EU
  tierLabel: string;
  machines: number;
  eut: number; // full load, all machines
  gen: boolean;
  circuit?: number;
  inputs: BuildIO[];
  outputs: BuildIO[];
}
/** Everything built as one kind of block (machine, multiblock + hatch, generator). */
export interface BuildGroup { name: string; recipe: MachineRecipe; tier: string; total: number; rows: BuildRow[] }
export interface BuildTotals { machines: number; types: number; useMax: number; useAvg: number; genAvg: number }

const W: Record<BuildLayout, number> = { grid: 960, list: 820, checklist: 640 };

function TierBadge({ tier, label }: { tier: string; label: string }) {
  const info = tier ? TIERS[tier as keyof typeof TIERS] : undefined;
  return (
    <span className="px-1.5 py-0.5 border text-[10px] font-bold whitespace-nowrap" style={info ? { backgroundColor: info.badgeBg, borderColor: info.badgeBorder, color: info.color } : { borderColor: '#334155', color: '#94a3b8' }}>
      {label}
    </span>
  );
}

function Chips({ items, tone }: { items: BuildIO[]; tone: string }) {
  return (
    <span className="flex flex-wrap gap-1 min-w-0">
      {items.map((i) => (
        <span key={i.id} className="inline-flex items-center gap-1 px-1 py-0.5 bg-[#10131b] border border-[#222a3b] whitespace-nowrap max-w-full">
          <ItemIcon id={i.id} color={i.color} size={12} />
          <span className="text-slate-300 truncate min-w-0">{i.name}</span>
          <span className={`font-bold flex-shrink-0 ${tone}`}>{formatRate(i.perSec, i.unit)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * The build list as a picture: what to build, machine by machine and recipe by recipe, with tiers,
 * counts, EU/t and what each recipe takes and makes. Rendered off screen for the export and, scaled
 * down, as the preview.
 */
export const BuildSheet = forwardRef<HTMLDivElement, {
  layout: BuildLayout;
  pack: string;
  flowName: string;
  groups: BuildGroup[];
  totals: BuildTotals;
  machines?: Record<string, MachineInfo>;
  tierCasings?: Partial<Record<VoltageTier, string>>;
  pixelFont: boolean;
}>(function BuildSheet({ layout, pack, flowName, groups, totals, machines, tierCasings, pixelFont }, ref) {
  const net = totals.genAvg - totals.useAvg;
  const [today] = useState(() => new Date().toLocaleDateString());
  const icon = (recipe: MachineRecipe, tier: string, size = 22) => (
    <MachineIcon recipe={recipe} tier={(tier || 'LV') as VoltageTier} machines={machines} tierCasings={tierCasings} size={size} />
  );
  const stat = (label: string, value: string, cls = 'text-slate-100') => (
    <div className="bg-[#12151e] border border-[#222a3b] px-2 py-1.5">
      <div className="text-[10px] text-slate-500 uppercase">{label}</div>
      <div className={`font-bold text-sm ${cls}`}>{value}</div>
    </div>
  );
  const header = (
    <>
      <div className="flex items-end justify-between gap-3 border-b-2 border-cyan-500/40 pb-2">
        <div className="min-w-0">
          <div className="text-cyan-400 font-bold text-xs uppercase tracking-wider">{pack} build list</div>
          <div className="text-slate-100 font-bold text-lg break-words">{flowName}</div>
        </div>
        <div className="text-right whitespace-nowrap">
          <div className="text-cyan-400 font-bold text-xs uppercase tracking-wider">gtcalc.app</div>
          <div className="text-[10px] text-slate-500">{today}</div>
        </div>
      </div>
      <div className={`grid gap-1.5 ${layout === 'checklist' ? 'grid-cols-3' : 'grid-cols-5'}`}>
        {stat('Machines', String(Math.round(totals.machines)))}
        {stat('Kinds', String(totals.types))}
        {stat(`${euUnit()} full load`, formatEU(totals.useMax), 'text-amber-300')}
        {layout !== 'checklist' && stat('Generated', `+${formatEU(totals.genAvg)}`, 'text-amber-300')}
        {layout !== 'checklist' && stat(`Net ${euUnit()}`, `${net >= 0 ? '+' : '-'}${formatEU(Math.abs(net))}`, net >= 0 ? 'text-yellow-300' : 'text-rose-400')}
      </div>
    </>
  );

  let body: React.ReactNode;
  if (layout === 'grid') {
    body = (
      // Two flowing columns, so short and tall cards pack without gaps.
      <div className="columns-2 gap-2">
        {groups.map((g) => (
          <div key={g.name} className="border border-[#2b3548] bg-[#12151e] break-inside-avoid mb-2">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[#1a2030] border-b border-[#2b3548]">
              {icon(g.recipe, g.tier)}
              <span className="font-bold text-sm flex-1 min-w-0 break-words">{g.name}</span>
              <span className="font-bold text-base text-cyan-200">×{g.total}</span>
            </div>
            <div className="divide-y divide-[#1e2538]">
              {g.rows.map((r) => (
                <div key={r.key} className="px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <TierBadge tier={r.tier} label={r.tierLabel} />
                    <span className="font-bold text-slate-100">×{r.machines}</span>
                    <span className="text-slate-300 flex-1 min-w-0 break-words">{r.recipeName}{r.circuit != null ? ` · circuit ${r.circuit}` : ''}</span>
                    <span className={`text-[10px] whitespace-nowrap ${r.gen ? 'text-amber-300' : 'text-amber-400/80'}`}>{r.gen ? '+' : ''}{formatEU(r.eut)}</span>
                  </div>
                  {(r.inputs.length > 0 || r.outputs.length > 0) && (
                    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1 text-[10px]">
                      <Chips items={r.inputs} tone="text-rose-300" />
                      <span className="text-slate-500 px-0.5">→</span>
                      <Chips items={r.outputs} tone="text-emerald-300" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  } else if (layout === 'list') {
    body = (
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-[10px] uppercase text-slate-500 text-left">
            <th className="py-1 pr-2 font-normal">Tier</th>
            <th className="py-1 pr-2 font-normal text-right">Count</th>
            <th className="py-1 pr-2 font-normal">Recipe</th>
            <th className="py-1 pr-2 font-normal">Takes → makes (per machine group)</th>
            <th className="py-1 font-normal text-right">{euUnit()}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => [
            <tr key={`${g.name}-h`} className="bg-[#1a2030]">
              <td colSpan={5} className="px-2 py-1.5 border-t-2 border-[#2b3548]">
                <span className="inline-flex items-center gap-2 font-bold text-sm">{icon(g.recipe, g.tier, 20)} {g.name} <span className="text-cyan-200">×{g.total}</span></span>
              </td>
            </tr>,
            ...g.rows.map((r) => (
              <tr key={r.key} className="border-t border-[#1e2538] align-top">
                <td className="py-1.5 pr-2 pl-2"><TierBadge tier={r.tier} label={r.tierLabel} /></td>
                <td className="py-1.5 pr-2 text-right font-bold">×{r.machines}</td>
                <td className="py-1.5 pr-2 text-slate-200 max-w-[180px]">{r.recipeName}{r.circuit != null ? <span className="text-slate-500"> · circuit {r.circuit}</span> : null}</td>
                <td className="py-1.5 pr-2 text-[10px]">
                  <div className="space-y-1">
                    <Chips items={r.inputs} tone="text-rose-300" />
                    <div className="flex items-start gap-1"><span className="text-slate-500 pt-0.5">→</span><Chips items={r.outputs} tone="text-emerald-300" /></div>
                  </div>
                </td>
                <td className={`py-1.5 text-right whitespace-nowrap ${r.gen ? 'text-amber-300' : 'text-amber-400/80'}`}>{r.gen ? '+' : ''}{formatEU(r.eut)}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    );
  } else {
    // Checklist: every recipe line by tier, lowest first, so you build in the order you unlock things.
    const byTier = new Map<string, { group: BuildGroup; row: BuildRow }[]>();
    for (const g of groups) for (const r of g.rows) {
      const k = r.tier || 'No EU';
      if (!byTier.has(k)) byTier.set(k, []);
      byTier.get(k)!.push({ group: g, row: r });
    }
    const order = Object.keys(TIERS);
    const tiers = [...byTier.keys()].sort((a, b) => (order.indexOf(a) === -1 ? -1 : order.indexOf(a)) - (order.indexOf(b) === -1 ? -1 : order.indexOf(b)));
    body = (
      <div className="space-y-2">
        {tiers.map((t) => {
          const info = TIERS[t as keyof typeof TIERS];
          const lines = byTier.get(t)!;
          return (
            <div key={t}>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 border font-bold text-xs" style={info ? { backgroundColor: info.badgeBg, borderColor: info.badgeBorder, color: info.color } : { borderColor: '#334155', color: '#94a3b8' }}>{t}</span>
                <span className="h-px flex-1 bg-[#283244]" />
                <span className="text-[10px] text-slate-500">{lines.reduce((a, l) => a + l.row.machines, 0)} machines</span>
              </div>
              {lines.map(({ group, row }) => (
                <div key={row.key} className="flex items-center gap-2 py-1 border-b border-[#1e2538]">
                  <span className="w-3.5 h-3.5 border-2 border-slate-500 flex-shrink-0" />
                  <span className="font-bold w-9 text-right">{row.machines}×</span>
                  {icon(group.recipe, row.tier, 18)}
                  <span className="flex-1 min-w-0 break-words">
                    <span className="font-bold text-slate-100">{group.name}</span>
                    {/* What you set the machine up with: its input(s) and circuit. */}
                    <span className="text-slate-500"> · input: </span>
                    <span className="text-slate-300">{row.inputs.length ? row.inputs.map((i) => i.name).join(' + ') : 'none'}</span>
                    {row.circuit != null && <span className="text-slate-500"> · circuit {row.circuit}</span>}
                  </span>
                  <span className={`text-[10px] whitespace-nowrap ${row.gen ? 'text-amber-300' : 'text-amber-400/80'}`}>{row.gen ? '+' : ''}{formatEU(row.eut)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={ref} style={{ width: W[layout] }} className={`bg-[#161a24] text-slate-100 p-5 space-y-3 text-xs ${pixelFont ? 'pixel-font-all' : 'font-mono'}`}>
      {header}
      {body}
    </div>
  );
});

/** Pick a layout and format for the build list picture, with a live preview. */
export function BuildImageModal({ sheet, onExport, onClose }: {
  sheet: Omit<React.ComponentProps<typeof BuildSheet>, 'layout'>;
  onExport: (layout: BuildLayout, format: 'jpg' | 'png') => void;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<BuildLayout>(() => {
    try { const v = localStorage.getItem('gt_calc_build_layout'); return v === 'list' || v === 'checklist' ? v : 'grid'; } catch { return 'grid'; }
  });
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg');
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.6);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFit(Math.min(1, (el.clientWidth - 24) / W[layout]));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);
  const go = () => {
    try { localStorage.setItem('gt_calc_build_layout', layout); } catch { /* storage unavailable */ }
    onClose();
    onExport(layout, format);
  };
  const toggle = <T extends string>(value: T, current: T, set: (v: T) => void, label: string, tip?: string) => (
    <button key={value} onClick={() => set(value)} data-tip={tip} className={`flex-1 px-2 py-1.5 border font-bold -ml-px first:ml-0 ${current === value ? 'relative border-cyan-400 bg-cyan-950 text-cyan-100' : 'border-[#2b3548] text-slate-400 hover:text-slate-200 hover:bg-[#202737]'}`}>{label}</button>
  );
  return (
    <div className="fixed inset-0 bg-black/70 z-[65] flex items-center justify-center md:p-4" onMouseDown={onClose}>
      <div className="flex flex-col w-full h-full md:w-[max(70vw,760px)] md:h-[max(80vh,520px)] md:max-w-[96vw] md:max-h-[94vh] bg-[#161a24] md:border border-cyan-500/50 shadow-2xl text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#283244] flex-shrink-0">
          <div className="font-pixel-bold text-cyan-300 uppercase text-sm">Build list image</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" aria-label="Close">✕</button>
        </div>
        <div className="flex-1 min-h-0 p-3 md:p-4 flex flex-col md:grid md:grid-cols-[1fr_260px] gap-3 md:gap-4">
          <div ref={box} className="flex-1 min-h-[200px] overflow-auto bg-[#11141c] border border-[#283244] p-3">
            <div style={{ zoom: fit }}><BuildSheet {...sheet} layout={layout} /></div>
          </div>
          <div className="space-y-3 max-md:flex-shrink-0">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Layout</div>
              <div className="flex">{BUILD_LAYOUTS.map(([v, label, tip]) => toggle(v, layout, setLayout, label, tip))}</div>
              <div className="text-[10px] text-slate-500">{BUILD_LAYOUTS.find((l) => l[0] === layout)?.[2]}.</div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Format</div>
              <div className="flex">{toggle('jpg', format, setFormat, 'JPG', 'Smaller file')}{toggle('png', format, setFormat, 'PNG', 'Sharp text, bigger file')}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 font-bold hover:bg-[#202737]">Cancel</button>
              <button onClick={go} className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 font-bold">Export</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
