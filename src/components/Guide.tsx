import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, Connection, MachineRecipe, RecipeItem, VoltageTier } from '../types';
import { solveFlows } from '../solver';
import { setConsent } from '../consent';
import { NodeCard } from './NodeCard';
import { BookOpen, Factory, Scale, X } from 'lucide-react';
import { TIERS, type VoltageTier as Tier } from '../types';
import { PixelIcon, type PixelIconName } from './PixelIcon';
import { SiteFooter } from './SiteFooter';

interface Section { id: string; title: string; body: React.ReactNode }

const K = ({ children }: { children: React.ReactNode }) => (
  <kbd className="px-1 py-px border border-[#3a4560] bg-[#1b2230] text-slate-200 text-[11px]">{children}</kbd>
);
const B = ({ children }: { children: React.ReactNode }) => <strong className="text-slate-100">{children}</strong>;
const H = ({ children }: { children: React.ReactNode }) => <h3 className="text-cyan-300 font-bold text-sm mt-4 mb-1.5">{children}</h3>;
const P = ({ children }: { children: React.ReactNode }) => <p className="mb-2 leading-relaxed">{children}</p>;
const L = ({ children }: { children: React.ReactNode }) => <ul className="list-disc pl-5 space-y-1 mb-2">{children}</ul>;
/** A screenshot from the app (public/guide, made by promo/guide-shots.mjs). */
const Pic = ({ src, w, h, alt, narrow }: { src: string; w: number; h: number; alt: string; narrow?: boolean }) => (
  <img src={src} width={w} height={h} loading="lazy" alt={alt} className={`h-auto border border-[#283244] my-2 ${narrow ? 'max-w-[320px] w-full' : 'w-full'}`} />
);
/** Swatch standing in for an item icon in the panel example. */
const Sw = ({ c }: { c: string }) => <span className="w-3.5 h-3.5 flex-shrink-0 border border-black/40" style={{ background: c }} />;
const TierTag = ({ t }: { t: Tier }) => (
  <span className="px-1.5 py-0.5 border text-[10px] font-bold" style={{ backgroundColor: TIERS[t].badgeBg, borderColor: TIERS[t].badgeBorder, color: TIERS[t].color }}>{t}</span>
);
// Example data: a GTCEu nitric acid line at 1 B/s.
const DEMO_RAW: [string, string, string, string][] = [
  ['Air', '#94a3b8', '4 B/s', 'Gas Collector x2'], ['Water', '#3b82f6', '1.5 B/s', 'Ore Washer, Chemical Reactor'],
  ['Saltpeter Ore', '#e5e7eb', '2/s', 'Macerator'], ['Hydrogen', '#1e3a8a', '3 B/s', 'Large Chemical Reactor'],
];
const DEMO_OUT: [string, string, string, string, boolean][] = [
  ['Nitric Acid', '#d8b4fe', '1 B/s', 'target', false], ['Oxygen', '#93c5fd', '+250 mB/s', 'spare', true],
  ['Stone Dust', '#a8a29e', '+0.5/s', 'spare', true], ['Saltpeter Dust', '#fafaf9', '+0.2/s', 'spare', true],
];
const DEMO_MACHINES: [string, Tier, number, string][] = [
  ['Gas Collector', 'MV', 2, 'Air'], ['Centrifuge', 'MV', 8, 'Air separation'], ['Macerator', 'LV', 2, 'Saltpeter Ore'],
  ['Ore Washer', 'LV', 1, 'Crushed Saltpeter Ore'], ['Chemical Reactor', 'HV', 1, 'Nitrogen Dioxide'], ['Large Chemical Reactor', 'HV', 2, 'Nitric Acid'],
];

/** The side panel, with example data, opened from the guide (Balances and Machines tabs). */
function PanelDemo({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'balances' | 'machines'>('balances');
  const head = 'text-[11px] uppercase font-bold text-cyan-400 tracking-wider mb-2';
  return (
    <div className="fixed inset-0 z-[70]" onMouseDown={(e) => { e.stopPropagation(); onClose(); }}>
      <aside className="panel-in absolute right-0 top-0 bottom-0 w-full md:w-[420px] bg-[#161a24] md:border-l-2 border-cyan-500/30 p-4 flex flex-col gap-3 shadow-2xl overflow-hidden text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="flex-1 grid grid-cols-2 gap-1 bg-[#10131b] border border-[#283244] p-1">
            {([['balances', 'Balances', Scale], ['machines', 'Machines', Factory]] as const).map(([t, label, Icon]) => (
              <button key={t} onClick={() => setTab(t)} className={`flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold uppercase tracking-wider border transition ${tab === t ? 'bg-cyan-950/80 border-cyan-400/70 text-cyan-200' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#1a2030]'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[#202737] text-slate-400 hover:text-slate-200" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="text-[10px] text-amber-300/80 border border-amber-700/40 bg-amber-950/20 px-2 py-1">Example: a nitric acid line at 1 B/s. Your own panel shows your flow.</div>
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {tab === 'balances' ? (
            <>
              <div>
                <div className={`${head} flex justify-between`}><span>Supplied raw inputs ({DEMO_RAW.length})</span><span className="text-[10px] text-slate-500 normal-case">Available /s</span></div>
                <div className="space-y-1.5">
                  {DEMO_RAW.map(([name, c, rate, users]) => (
                    <div key={name} className="bg-[#12151e] border border-[#222a3b] p-2">
                      <div className="flex items-center gap-2">
                        <Sw c={c} />
                        <span className="font-bold text-slate-100 flex-1">{name}</span>
                        <span className="w-20 bg-[#0f131c] border border-[#2b3548] px-1.5 py-0.5 text-slate-500 text-right">∞</span>
                      </div>
                      <div className="text-[10px] mt-1"><span className="text-rose-400 font-bold">Required: {rate}</span> <span className="text-slate-500">· {users}</span></div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className={head}>Outputs &amp; byproducts ({DEMO_OUT.length})</div>
                <div className="space-y-1.5">
                  {DEMO_OUT.map(([name, c, rate, kind, spare]) => (
                    <div key={name} className="bg-[#12151e] border border-[#222a3b] p-2">
                      <div className="flex items-center gap-2">
                        <Sw c={c} />
                        <span className="font-bold text-slate-100 flex-1">{name}</span>
                        <span className={`px-1.5 py-0.5 border font-bold ${spare ? 'border-emerald-600/60 text-emerald-300' : 'border-cyan-500/60 text-cyan-200'}`}>{rate}</span>
                      </div>
                      <div className="flex gap-1 mt-1.5 text-[10px]">
                        <span className="px-1.5 py-0.5 border border-amber-600/50 text-amber-300">Go to</span>
                        {spare && <span className="px-1.5 py-0.5 border border-[#2b3548] text-slate-300">Find uses…</span>}
                        <span className="text-slate-500 self-center">{kind}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="w-full px-3 py-2 border border-cyan-500/60 bg-cyan-950/40 text-cyan-200 font-bold uppercase text-center text-[11px]">Max flow from these limits</div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {[['Machines', '16', 'text-slate-100'], ['Kinds', '6', 'text-slate-100'], ['EU/t full', '3.1k', 'text-amber-300']].map(([l, v, c]) => (
                  <div key={l} className="bg-[#12151e] border border-[#222a3b] p-2"><div className="text-[10px] text-slate-500 uppercase">{l}</div><div className={`font-bold text-base ${c}`}>{v}</div></div>
                ))}
              </div>
              <div className="bg-[#12151e] border border-[#222a3b] p-2 space-y-1">
                <div className="flex items-center justify-between"><span className="text-[11px] uppercase font-bold text-cyan-400 tracking-wider">Max tier</span><TierTag t="HV" /></div>
                <div className="h-1.5 bg-[#0f131c] border border-[#2b3548]"><div className="h-full w-1/3 bg-cyan-500/70" /></div>
                <div className="text-[11px] text-slate-300 pt-1">☑ Large machines for Auto Ratio · ☐ Parallel Control Hatches</div>
                <div className="mt-2 px-2 py-1.5 border border-emerald-500/60 bg-emerald-950 text-emerald-200 font-bold uppercase text-center text-[11px]">Build mode</div>
              </div>
              <div>
                <div className={head}>Machines to build</div>
                <div className="space-y-1">
                  {DEMO_MACHINES.map(([name, t, n, recipe], k) => (
                    <div key={name} className="flex items-center gap-2 bg-[#12151e] border border-[#222a3b] p-1.5">
                      <span className={`w-3.5 h-3.5 border ${k < 2 ? 'border-emerald-400 bg-emerald-700' : 'border-slate-500'}`} />
                      <span className={`font-bold flex-1 ${k < 2 ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{name}<span className="text-slate-500 font-normal"> · {recipe}</span></span>
                      <TierTag t={t} />
                      <span className="font-bold w-8 text-right">×{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function PanelDemoButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="my-2 px-3 py-1.5 border border-cyan-500/60 bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-200 font-bold text-xs inline-flex items-center gap-1.5">
        <Scale className="w-3.5 h-3.5" /> Show the side panel (example)
      </button>
      {open && <PanelDemo onClose={() => setOpen(false)} />}
    </>
  );
}

const Example = ({ children }: { children: React.ReactNode }) => (
  <div className="border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 my-2 leading-relaxed">{children}</div>
);

/** A card button as it appears on a machine, shown inline in the text. */
const Btn = ({ icon, tone = 'slate' }: { icon: PixelIconName; tone?: 'slate' | 'blue' | 'rose' | 'amber' | 'green' }) => {
  const cls = {
    slate: 'bg-[#1e2535] border-[#2d3a52] text-slate-300',
    blue: 'bg-blue-700 border-blue-300 text-white',
    rose: 'bg-rose-950/80 border-rose-500/40 text-rose-300',
    amber: 'bg-amber-950/40 border-amber-500/70 text-amber-300',
    green: 'border-emerald-600/50 text-emerald-400',
  }[tone];
  return <span className={`inline-flex w-5 h-5 align-middle items-center justify-center border mx-0.5 ${cls}`}><PixelIcon name={icon} className="w-3 h-3" /></span>;
};

// ---------------------------------------------------------------- example cards
/** A recipe item for the guide's example machines. */
const item = (id: string, name: string, amount: number, iconColor: string, unit: RecipeItem['unit'] = 'mB'): RecipeItem => ({ id, name, amount, unit, iconColor });
const recipe = (id: string, machineName: string, recipeName: string, baseTier: VoltageTier, baseEUt: number, sec: number, inputs: RecipeItem[], outputs: RecipeItem[]): MachineRecipe =>
  ({ id: `guide:${id}`, machineName, recipeName, baseTier, baseEUt, baseDurationSec: sec, inputs, outputs });
const NAPHTHA = item('gtceu:naphtha', 'Naphtha', 1000, '#f2c94c');
const RECIPES = {
  distill: recipe('distill', 'Distillation Tower', 'Naphtha', 'MV', 120, 4, [item('gtceu:light_fuel', 'Light Fuel', 1000, '#d97706')], [{ ...NAPHTHA, amount: 800 }]),
  rawGas: recipe('raw_gasoline', 'Large Chemical Reactor', 'Raw Gasoline', 'HV', 480, 5, [{ ...NAPHTHA, amount: 1600 }], [item('gtceu:raw_gasoline', 'Raw Gasoline', 2000, '#ea580c')]),
  gasoline: recipe('gasoline', 'Chemical Reactor', 'Gasoline', 'HV', 480, 0.5, [item('gtceu:raw_gasoline', 'Raw Gasoline', 10000, '#ea580c'), item('gtceu:toluene', 'Toluene', 1000, '#92400e')], [item('gtceu:gasoline', 'Gasoline', 11000, '#f59e0b')]),
};
const node = (id: string, r: MachineRecipe, x: number, y: number, target?: boolean): CanvasNode =>
  ({ instanceId: `guide-${id}`, recipe: r, selectedTier: r.baseTier, count: 1, countMode: 'auto', x, y, ...(target ? { isTarget: true } : {}) });
const noop = () => {};
const HANDLERS = {
  registerEl: noop, onHeaderMouseDown: noop, onTierStep: noop, onSetCount: noop, onToggleCountMode: noop, onSetTarget: noop,
  onRemove: noop, onChangeRecipe: noop, onPortMouseDown: noop, onPortClick: noop, onTargetRate: noop, onTargetEUt: noop,
  onGenChange: noop, onSupplyLimit: noop, onUnlink: noop,
};

/**
 * Real machine cards (the same NodeCard as the canvas, solved by the same solver) drawn at a
 * smaller scale, so the guide's pictures always match what you see on the canvas.
 */
function GuideScene({ nodes, connections = [], width, height, scale: wanted = 0.72, children }: {
  nodes: CanvasNode[]; connections?: Connection[]; width: number; height: number; scale?: number; children?: React.ReactNode;
}) {
  const flows = useMemo(() => solveFlows(nodes, connections), [nodes, connections]);
  // Narrow screens: shrink the picture to fit the page instead of overflowing it.
  const scale = Math.min(wanted, (window.innerWidth - 40) / width);
  return (
    <div className="relative my-3 border border-[#283244] bg-[#11141c] overflow-hidden pointer-events-none" style={{ width: width * scale, height: height * scale }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
        {nodes.map((n) => (
          <NodeCard
            key={n.instanceId}
            node={n}
            flow={flows.nodes.get(n.instanceId)}
            connectedInputs={new Set(connections.filter((c) => c.targetInstanceId === n.instanceId).map((c) => c.targetItemId))}
            connectedOutputs={new Set(connections.filter((c) => c.sourceInstanceId === n.instanceId).map((c) => c.sourceItemId))}
            linkHint={null}
            {...HANDLERS}
          />
        ))}
        {children}
      </div>
    </div>
  );
}

const LINK_NODES = [node('distill', RECIPES.distill, 20, 20), node('rawgas', RECIPES.rawGas, 500, 20, true)];
const PARTS_NODES = [node('gasoline', RECIPES.gasoline, 0, 0, true)];

/** Animated demo: press on an output, drag to the next machine's input, release, linked. */
function LinkDemo() {
  const naphtha = NAPHTHA.iconColor!;
  const box = useRef<HTMLDivElement>(null);
  // Where the two Naphtha ports actually are (fonts change card heights), in scene units, so
  // the wire and the cursor line up with them.
  const [pts, setPts] = useState<{ x1: number; x2: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const scene = el?.querySelector<HTMLElement>('.origin-top-left');
    const out = el?.querySelector<HTMLElement>('[data-node="guide-distill"] [data-port="out:gtceu:naphtha"]');
    const inp = el?.querySelector<HTMLElement>('[data-node="guide-rawgas"] [data-port="in:gtceu:naphtha"]');
    if (!scene || !out || !inp) return;
    const b = scene.getBoundingClientRect();
    const k = b.width / scene.offsetWidth; // the scene's scale
    const o = out.getBoundingClientRect();
    const i = inp.getBoundingClientRect();
    setPts({ x1: (o.right - b.left) / k + 9, x2: (i.left - b.left) / k - 9, y: (o.top + o.height / 2 - b.top) / k });
  }, []);
  return (
    <div ref={box}>
      <GuideScene nodes={LINK_NODES} width={900} height={300}>
        {pts && (
          <>
            <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
              <g className="demo-wire">
                <path d={`M ${pts.x1} ${pts.y} H ${pts.x2}`} stroke="#0b0f17" strokeWidth={6} />
                <path d={`M ${pts.x1} ${pts.y} H ${pts.x2}`} stroke={naphtha} strokeWidth={2.5} />
                <path d={`M ${pts.x2 - 6} ${pts.y - 5} L ${pts.x2} ${pts.y} L ${pts.x2 - 6} ${pts.y + 5} Z`} fill={naphtha} />
              </g>
              <path className="demo-drag" d={`M ${pts.x1} ${pts.y} H ${pts.x2 + 30}`} stroke={naphtha} strokeWidth={2.5} fill="none" />
            </svg>
            <div className="demo-cursor absolute pointer-events-none" style={{ left: pts.x1 - 30, top: pts.y - 4, ['--demo-dx' as string]: `${pts.x2 - pts.x1 + 60}px` }}>
              <svg className="demo-press" width="22" height="28" viewBox="0 0 8 10" shapeRendering="crispEdges">
                <path d="M0 0h1v1H0zM0 1h2v1H0zM0 2h3v1H0zM0 3h4v1H0zM0 4h5v1H0zM0 5h6v1H0zM0 6h3v1H0zM0 7h1v1H0zM3 6h1v2H3zM4 8h1v2H4z" fill="#fff" stroke="#000" strokeWidth={0.15} />
              </svg>
            </div>
          </>
        )}
      </GuideScene>
      <div className="-mt-2 mb-2 text-[10px] text-slate-500">Press on an output, drag to the next machine's matching input, release.</div>
    </div>
  );
}

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Getting started',
    body: (
      <>
        <P>The calculator works backwards from one machine, the <B>target</B>. You say how much it should make, and every machine connected upstream resizes to feed it.</P>
        <L>
          <li><B>Add your first machine.</B> Right-click the canvas, or press <B>+ Add a new node</B>. Search by item (what you want to make), by machine, or across all recipes. The first machine you add becomes the target. To make another machine the target, press its target button <Btn icon="target" /> (it turns blue <Btn icon="target" tone="blue" /> on the target).</li>
          <li><B>Set the rate.</B> Click the target's output number (e.g. <i>+11 B/s</i>) and type a rate such as <i>2B</i>, <i>500</i> or <i>20k</i>. A generator target takes an EU/t figure instead.</li>
          <li><B>Add suppliers.</B> Click an input on a card to find machines that make it, or drag from the input onto another card or onto empty canvas.</li>
          <li><B>Link everything at once.</B> Press <B>Auto Connect</B> to wire every input to every machine on the canvas that makes it.</li>
          <li><B>Pick tiers.</B> Press <B>Auto Ratio</B> to choose tiers for every machine. The mode buttons next to it decide how (see Auto Ratio).</li>
        </L>
        <P>Inputs that nothing on the canvas supplies are <B>raw inputs</B>: things you provide yourself. They're listed in the side panel (the ☰ button, top right) under Balances.</P>
        <P>How to link two machines is shown in <B>Linking machines</B>.</P>
        <H>The parts of a machine card</H>
        <div className="flex flex-col md:flex-row gap-4 items-start my-2">
          <div className="flex-shrink-0"><GuideScene nodes={PARTS_NODES} width={360} height={330} scale={0.85} /></div>
          <L>
            <li><Btn icon="settings" /> changes the machine's recipe.</li>
            <li><Btn icon="target" /> makes it the target; blue <Btn icon="target" tone="blue" /> means it already is.</li>
            <li><Btn icon="cross" tone="rose" /> removes the machine.</li>
            <li><Btn icon="unlock" tone="green" /> / <Btn icon="lock" tone="amber" /> locks its tier and machine type for Auto Ratio.</li>
            <li>The coloured badge (here <B>HV</B>) is the tier: left-click up, right-click down.</li>
            <li>Inputs are on the left (red, per second), outputs on the right (green). The coloured tabs on the edges are where wires attach.</li>
          </L>
        </div>
      </>
    ),
  },
  {
    id: 'packs',
    title: 'Modpacks and item types',
    body: (
      <>
        <P>Pick the modpack from the menu at the top left: <B>GregTech</B> (plain GTCEu), <B>Sky Greg</B> or <B>GT New Horizons</B>. Each keeps its own recipes, canvas and saves. Missing yours? <B>Suggest a pack</B> at the bottom of that menu.</P>
        <P>In GT New Horizons many items share a name: Iron Ore comes in a dozen stones and planets, each with its own recipes. Search shows them as one entry with the number of types, and a <B>Type</B> picker chooses which one. Input and Output nodes have the same picker, so you can place "Iron Ore" and pick the kind you mine.</P>
        <Pic src="/guide/item-types.webp" w={2000} h={747} alt="Search for iron ore: one Iron Ore entry with 15 types, and a Type picker set to Stone" />
      </>
    ),
  },
  {
    id: 'numbers',
    title: 'How the numbers work',
    body: (
      <>
        <P>Recipe amounts are <B>per craft</B>. Cards show <B>per second</B>: amount ÷ craft time × machines. Hover a card to see where each input comes from and where each output goes; hover a wire to see what it carries.</P>
        <H>The solver</H>
        <P>The whole canvas is solved at once as an optimisation. It follows four rules:</P>
        <L>
          <li>Every connected input gets fully supplied by its wires.</li>
          <li>No machine sends out more than it makes. Extra is allowed and shows as surplus.</li>
          <li>The target and end-of-line machines run at the rate you set.</li>
          <li>Among all the ways to do that, it picks the cheapest: lowest average EU/t, plus a small cost per machine.</li>
        </L>
        <P>So byproducts and spare outputs are used before any machine runs harder, and when several machines can supply an input, the cheaper route wins.</P>
        <H>Card labels</H>
        <L>
          <li><B>FINAL TARGET</B>: the machine everything else feeds.</li>
          <li><B>INTERMEDIATE</B>: feeds something else on the canvas.</li>
          <li><B>END OF LINE</B>: sends nothing anywhere, so it runs at its own count.</li>
          <li><B>LIMITED</B>: its count is pinned below what's needed. The wire it feeds shows <i>Short</i>.</li>
          <li><B>NOT NEEDED</B>: everything it makes is already covered by byproducts or cheaper machines.</li>
          <li><B>NO DEMAND</B>: nothing outside its loop uses its products. Connect one of them onward, or make it the target.</li>
          <li>Both kinds are greyed out on the canvas and listed under <B>Unused machines</B> in the Machines tab. <B>Remove unused</B> in the top bar deletes them all (undo-able).</li>
        </L>
        <H>Wire panels (flow labels)</H>
        <P>Each wire can show <B>Supplied</B> (the share of the source's output on that wire) and <B>Needed</B>. <i>Balanced</i> means they match, <i>Surplus</i> means spare, and <i>Short</i> means nothing can make enough.</P>
      </>
    ),
  },
  {
    id: 'tiers',
    title: 'Tiers, overclocking and generators',
    body: (
      <>
        <P>The coloured badge on a card is its tier. <B>Left-click</B> steps up, <B>right-click</B> steps down. Past the top (or your Max tier) it wraps back to the recipe's base tier.</P>
        <H>Overclocking</H>
        <P>Each tier above the recipe's base tier halves the craft time (rounded down, never below 1 tick) and multiplies EU/t by 4. That doubles the energy per craft, which is why base tier is the most efficient. The label beside the badge shows the overclocks (e.g. <i>+2 OC</i>), or <i>FIXED</i> for recipes that don't use power.</P>
        <H>Generators</H>
        <L>
          <li><B>Single-block generators (LV to HV):</B> each tier runs 4 parallels, so 4× the fuel and 4× the EU.</li>
          <li><B>Large Combustion Engine (EV) and Extreme Combustion Engine (IV):</B> parallels = engine voltage ÷ recipe EU/t. They also burn 1 mB of lubricant every 72 ticks. The boost (LCE: 1 mB/t oxygen; ECE: 4 mB/t liquid oxygen) doubles the parallels and makes each one give 1.5× (LCE) or 2× (ECE) the EU.</li>
          <li><B>Large turbines:</B> max output = 2 × turbine voltage × rotor power % × 2 per holder tier above the turbine. Efficiency = rotor efficiency × (100 + 10 per holder tier above) %, at least 100%. Higher efficiency stretches each craft, so the same output burns less fuel. On a turbine the badge is the <B>rotor holder</B> tier.</li>
          <li><B>Large boilers:</B> steam per tick at full heat is 800 (Bronze), 1,792 (Steel), 3,200 (Titanium) or 6,400 (Tungstensteel). Fuel burns for the same time in every boiler, so a bigger boiler makes more steam per fuel item. Water = steam ÷ 160.</li>
        </L>
        <P>Pick the generator or boiler type on its card, or in the add-node window before adding it.</P>
      </>
    ),
  },
  {
    id: 'setup',
    title: 'Machine counts, lock and multiblocks',
    body: (
      <>
        <H>Count</H>
        <P>By default the count follows demand, rounded up to whole machines. The footer shows the exact need and how busy the machines are. Typing a count <B>pins</B> it; press <B>PINNED ✕</B> to let it follow demand again. A pinned count that's too low turns the card <i>LIMITED</i>. <B>x2</B> doubles the count.</P>
        <H>Lock</H>
        <P>The padlock <Btn icon="unlock" tone="green" /> keeps the card's <B>tier and machine type</B> when you run Auto Ratio; locked it shows <Btn icon="lock" tone="amber" />. The count still follows demand. Use it for machines you've already built.</P>
        <H>Multiblocks and parallel hatches</H>
        <P>Many recipes can run in a larger multiblock (GTCEu's large machines and the pack's own, such as the Large Pyrolysis Chamber). Choose it in the dropdown on the card. If it takes a parallel control hatch, a second dropdown picks it: 4× (IV), 16× (LuV), 64× (ZPM) or 256× (UV).</P>
        <P>A hatch runs that many crafts at once, using that many times the EU/t. The tier badge is the energy hatch tier. Any power left at that tier then overclocks the combined recipe.</P>
        <Example>
          <B>Example: Pyrolyse Oven at IV.</B> A plain oven overclocks 3 times: 8× speed for 6,144 EU/t. The Large Pyrolysis Chamber with a 4× hatch spends that power on 4 parallels first, leaving room for 2 overclocks: 4 × 4 = 16× the work for the same 6,144 EU/t. That's twice a plain oven, so 4 ovens become 2 chambers. Parallels are energy-efficient, but they use the power overclocking would have taken; one tier higher recovers the rest.
        </Example>
      </>
    ),
  },
  {
    id: 'auto',
    title: 'Auto Ratio, budget, Always Running and manual counts',
    body: (
      <>
        <P><B>Auto Ratio</B> picks every machine's tier (and with the options below, its machine type), then lets the counts follow demand. Locked cards keep their tier and type. It never goes above your <B>Max tier</B> (Machines tab).</P>
        <img src="/guide/auto-ratio.webp" width={2000} height={1243} loading="lazy" alt="Before: a Gas Collector, one Centrifuge and the Chemical Reactor target making 250 mB/s of ammonia, with the Centrifuge LIMITED. After Auto Ratio: 6 Centrifuges, every machine balanced." className="w-full h-auto border border-[#283244] my-2" style={{ imageRendering: 'auto' }} />
        <L>
          <li><B>Max Efficiency:</B> everything at base tier. Lowest EU/t, most machines.</li>
          <li><B>Min Machines:</B> repeatedly takes the upgrade that saves the most whole machines per extra EU/t, until the EU/t budget is used.</li>
          <li><B>Balanced:</B> the same upgrades in the same order, but it stops after a third of the extra EU/t Min Machines would use. The best savings come first, so you keep most of the reduction for much less power.</li>
        </L>
        <H>Budget</H>
        <P>The energy box at the bottom right shows the budget, what the line uses, what generators make, and the net (yellow when generation covers everything). Click the budget to change it. <B>BUDGET ON/OFF</B> decides whether Auto Ratio and Max Flow must stay inside it. If even base tiers are over budget, Auto Ratio says so and overclocks nothing.</P>
        <H>Always Running</H>
        <P>With <B>Always Running</B> (24/7) on, Auto Ratio first rounds the target up to whole machines running non-stop, then sizes everything upstream to feed them.</P>
        <Example>A Chemical Reactor making Gasoline needs 20 B/s Raw Gasoline and 2 B/s Toluene per machine at full speed. Always Running sets the target to 22 B/s (one machine flat out), and the Toluene and Raw Gasoline lines scale to match.</Example>
        <H>Manual machine counts</H>
        <P>By default, counts follow demand: link a machine's inputs and the machines feeding it scale up to match. Turn on <B>Manual counts</B> (the switch at the top left of the canvas, under the header) to set counts yourself. New machines start at 1 and keep whatever count you set. A machine that can't keep up shows <B>LIMITED</B> and its <B>Needs</B> figure in red. Clicking Auto Ratio still sizes every machine, and the counts it picks stay put. The Auto Ratio lock is off while manual counts are on.</P>
        <H>Large machines and parallel hatches</H>
        <P>In the Machines tab, under Max tier: <B>Large machines for Auto Ratio</B> lets it swap a machine for a multiblock running the same recipe. <B>Access to Parallel Control Hatches</B> also lets it fit hatches you can make at your max tier, but only where the energy tier can power every parallel.</P>
      </>
    ),
  },
  {
    id: 'linking',
    title: 'Linking machines',
    body: (
      <>
        <LinkDemo />
        <L>
          <li><B>Drag from a port</B> (an input or output row) to a card. It links to the matching port. Drop on empty canvas to pick a new machine for that spot.</li>
          <li><B>Drag an existing link again</B> to remove just that link.</li>
          <li><B>Right-click while dragging</B> cancels.</li>
          <li><B>Click a port</B> to search for machines that make (input) or use (output) that item.</li>
          <li><B>Auto Connect</B> removes every link, then links each input to every machine that makes it (exact items first, tag matches only if nothing makes the exact item).</li>
          <li><B>Clear links</B> removes every link. The unlink button in a card's header removes that card's links, the ✕ on a hovered port removes that port's links, and the ✕ on a wire panel removes one link.</li>
        </L>
        <P>When you add a machine from an output, a bar above it offers to <B>allocate all spare</B> supply: Yes sets its count to the most machines the spare can feed (e.g. 10 engines for 2,050 mB/s of gasoline).</P>
        <P>Every remove action can be undone from the message at the bottom, or with <K>Ctrl</K>+<K>Z</K>.</P>
      </>
    ),
  },
  {
    id: 'inputs',
    title: 'Inputs, limits and Max Flow',
    body: (
      <>
        <P>An <B>Input</B> node is something you supply yourself: a tank, an AE2 export, another base. Add one from the add-node window's <B>Inputs (raw supply)</B> tab, or with <B>Supply it myself</B> when searching from an input. Click its supply limit to set how much is available per second; empty means unlimited.</P>
        <P>Raw inputs without an Input node are listed in Balances, each with its own limit box.</P>
        <P><B>Max Flow</B> scales the target to the highest rate every limit allows: the EU/t budget (when on), Input node limits, raw input limits and pinned counts. It tells you which limit is the bottleneck.</P>
      </>
    ),
  },
  {
    id: 'output',
    title: 'Output nodes and Best Route',
    body: (
      <>
        <P>An <B>Output</B> node is the thing you want to make, with the rate you want. Search for the item in the add-node window and click <B>Output</B> next to <B>Input</B> (or <B>End the line here</B> when searching from a machine's output). Click its rate to change it.</P>
        <Pic src="/guide/output-node.webp" w={640} h={368} alt="An Output node for Nitric Acid at 1 B/s, with a Best route button" narrow />
        <P>While nothing feeds it, the card shows <B>Best route</B>: it plans the cheapest chain of machines that makes the item from raw resources (ores, logs, water, air), stays at or below your max tier, then runs Auto Ratio and Auto Sort on the result. Clicking an input on any machine offers the same for that input.</P>
        <Pic src="/guide/best-route.webp" w={2000} h={1040} alt="The chain Best Route planned for nitric acid: air split by a centrifuge, ores processed, chemical reactors feeding the Output node" />
        <P>Best Route is a starting point: swap any recipe for another, change tiers, or link in machines you already have.</P>
      </>
    ),
  },
  {
    id: 'loops',
    title: 'Loops and recycling',
    body: (
      <>
        <P>Loops need no special setup: connect them, and the solver balances them, because a byproduct that's already being made costs nothing extra.</P>
        <Example>
          <B>Example: hydrogen sulfide.</B> The Chemical Reactors that desulfurise fuels (Sulfuric Heavy Fuel + Hydrogen → Heavy Fuel + Hydrogen Sulfide) make Hydrogen Sulfide as a byproduct. An Electrolyzer splits Hydrogen Sulfide into Sulfur and Hydrogen. Link Hydrogen Sulfide into the Electrolyzer and its Hydrogen back into the reactors. The loop then covers part of the hydrogen the reactors need. The rest comes from your other hydrogen source (e.g. a Limonite centrifuge), or shows <i>Short</i> if there is none.
        </Example>
        <P>If nothing outside a loop needs any of its products, its machines show <i>NO DEMAND</i>. Link one of its outputs onward or make it the target.</P>
      </>
    ),
  },
  {
    id: 'panel',
    title: 'Side panel (☰)',
    body: (
      <>
        <PanelDemoButton />
        <H>Balances</H>
        <L>
          <li><B>Supplied raw inputs</B>, with a limit box for each, and your Input nodes.</li>
          <li><B>Outputs & byproducts.</B> <i>Surplus</i> shows only spare outputs. For each spare: chips link it into machines on the canvas that can use it, <B>Go to</B> pans to the machine making it (click again for the next one), and <B>Find uses</B> searches recipes that take it.</li>
          <li><B>Max Flow From These Limits</B>: the same as Max Flow.</li>
        </L>
        <H>Machines</H>
        <L>
          <li>Totals: machines to build, machine types, EU/t at full load and on average, and generation.</li>
          <li><B>Max tier</B> slider and the two Auto Ratio options.</li>
          <li><B>Machines to build</B>, grouped by machine or sorted by tier. Tick rows off as you craft them (kept per flow); Select all / Deselect all. Click a row to find it on the canvas.</li>
          <li><B>Build mode</B> walks you through building the flow in game: first the raw inputs to have ready, then each machine in order (suppliers first). Every step shows where each input comes from and each output goes, what to split or merge, and for fluids the rate in mB/t with a GregTech CEu fluid pipe that carries it. The canvas can't be edited meanwhile; step with the bar at the top or the arrow keys, and <K>Esc</K> leaves.</li>
        </L>
        <H>Saves</H>
        <L>
          <li><B>Save</B> (<K>Ctrl</K>+<K>S</K>) overwrites the open flow; <B>Save as</B> makes a copy under a new name.</li>
          <li><B>New flow</B> starts an <i>Untitled flow-NN</i> draft that saves itself. Opening another flow offers to save changes or name the draft first.</li>
          <li>Each save can be opened, renamed, deleted (with a confirmation) or exported as .json; the open one also as .jpg.</li>
          <li>Saves are kept in this browser only, separately for each modpack. Use Export all / Import to move them.</li>
        </L>
      </>
    ),
  },
  {
    id: 'export',
    title: 'Export and import',
    body: (
      <L>
        <li><B>This flow (.json)</B>: the canvas as a file you can import later.</li>
        <li><B>This flow as an image</B>: the whole flow, not just what's on screen. A panel lets you pick the detail level (advanced, basic or simple cards), wire labels, the background grid, the resolution (Max, 4K, HD, SD) and JPG or PNG, with a preview that updates as you change them.</li>
        <li><B>All saves (.json)</B>: every saved flow in one file.</li>
        <li><B>Machine list (.txt)</B>: the Machines tab list in its current sort, with machines to build, types, EU/t at full load and on average, generation and net EU/t.</li>
        <li><B>Build list as an image</B>: every machine and each recipe it runs (tier, count, EU/t, and what it takes and makes per second), in a Grid, List or Checklist layout, as JPG or PNG.</li>
        <li><B>Import a .json into Saves</B>: a single flow or a whole saves file. Clashing names get a number added.</li>
      </L>
    ),
  },
  {
    id: 'canvas',
    title: 'Canvas tools and shortcuts',
    body: (
      <>
        <L>
          <li><B>Pan</B>: drag the background. <B>Zoom</B>: mouse wheel. The % button (top right) resets both.</li>
          <li><B>Auto Sort</B>: tidies the nodes into columns following the flow. Loops are broken where a wire already runs backwards.</li>
          <li><B>Snap</B>: while dragging, lines a node up with other nodes and lines its ports up with the ports it's wired to, so wires run straight.</li>
          <li><B>Flow</B>: animates dashes along every wire. Off keeps big flows smooth; hovered wires animate either way.</li>
          <li><B>Add / Remove flow labels</B>: shows or hides the wire panels. Turning them on moves nodes apart where a panel needs room.</li>
          <li><B>Hover</B>: Direct keeps a hovered node's own links lit, Chain keeps everything upstream and downstream lit, Off fades nothing. The info panels show either way.</li>
          <li><B>Undo / Redo</B>: the arrows, or <K>Ctrl</K>+<K>Z</K> and <K>Ctrl</K>+<K>Y</K>.</li>
          <li>The arrow at the start of the toolbar shows or hides the controls help.</li>
          <li><B>Modpack menu</B> (top left): plain GregTech (GTCEu) or the Sky Greg modpack's recipes, each with its own canvas and saves. It remembers your choice. <B>Aa</B> switches the pixel font on or off.</li>
        </L>
      </>
    ),
  },
];

/** In-app guide: section list on the left, the chosen section on the right. */
export function Guide({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const idx = SECTIONS.indexOf(section);
  const back = (cls: string) => (
    <button disabled={idx === 0} onClick={() => setActive(SECTIONS[idx - 1].id)} className={`px-3 py-1.5 border border-[#2b3548] bg-[#161a24] text-slate-300 hover:bg-[#202737] disabled:opacity-30 text-xs font-bold ${cls}`} data-tip={idx > 0 ? SECTIONS[idx - 1].title : undefined}>
      ← Back
    </button>
  );
  const next = (cls: string) => idx < SECTIONS.length - 1 ? (
    <button onClick={() => setActive(SECTIONS[idx + 1].id)} className={`px-3 py-1.5 border border-fuchsia-500/60 text-fuchsia-200 bg-fuchsia-950/80 hover:bg-fuchsia-900/60 text-xs font-bold ${cls}`} data-tip={SECTIONS[idx + 1].title}>
      Next →
    </button>
  ) : (
    <button onClick={onClose} className={`px-3 py-1.5 border border-fuchsia-500/60 text-fuchsia-200 bg-fuchsia-950/80 hover:bg-fuchsia-900/60 text-xs font-bold ${cls}`}>Done</button>
  );
  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center md:items-start justify-center p-0 md:px-4 md:pt-[10vh]" onMouseDown={onClose}>
      {/* Desktop: pinned 10% from the top with a fixed minimum height, so the panel only grows
          downwards and Back / Next stay in the same place on every step. */}
      <div className="w-[980px] max-w-full h-full md:h-auto md:min-h-[560px] md:max-h-[86vh] bg-[#161a24] md:border border-fuchsia-500/50 shadow-2xl flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
        <div className="h-11 border-b border-[#283244] px-3 md:px-4 flex items-center gap-2 bg-[#141822] flex-shrink-0">
          <div className="flex items-center gap-2 text-fuchsia-300 font-bold uppercase tracking-wider text-xs flex-shrink-0">
            <BookOpen className="w-4 h-4" /> Guide
          </div>
          {/* Phones: the sections are a dropdown instead of a side list */}
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            className="md:hidden flex-1 min-w-0 bg-[#12151e] border border-fuchsia-500/50 text-fuchsia-100 text-xs px-1.5 py-1"
            aria-label="Guide section"
          >
            {SECTIONS.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
          </select>
          <button onClick={onClose} className="ml-auto w-7 h-7 hover:bg-[#202737] flex items-center justify-center text-slate-400 hover:text-slate-200 flex-shrink-0" data-tip="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 relative">
          <nav className="hidden md:block w-56 border-r border-[#283244] p-2 space-y-0.5 overflow-y-auto flex-shrink-0">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`w-full text-left px-2 py-1.5 text-xs border ${s.id === active ? 'bg-fuchsia-950/50 border-fuchsia-500/60 text-fuchsia-200' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#1a2030]'}`}
              >
                <span className="text-slate-500 mr-1.5">{i + 1}.</span>{s.title}
              </button>
            ))}
            {/* Back / Next sit right under the list, so they stay at the same height on every page */}
            <div className="flex gap-1 pt-2 mt-1 border-t border-[#283244]">
              {back('flex-1 px-2')}
              {next('flex-1 px-2')}
            </div>
          </nav>
          <div key={active} className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-5 pb-16 md:pb-5 text-xs text-slate-300 min-w-0">{/* key: each page starts scrolled to the top */}
            <h2 className="text-fuchsia-200 font-bold text-base mb-3">{section.title}</h2>
            {section.body}
            <SiteFooter className="mt-6 pt-3 border-t border-[#283244]">
              <button onClick={() => setConsent(null)} className="hover:text-cyan-300" data-tip="Choose again whether to share anonymous visit stats">Cookie settings</button>
            </SiteFooter>
          </div>
          {/* Phones: Back / Next in the bottom-right corner, within thumb reach */}
          <div className="md:hidden absolute right-3 bottom-3 flex gap-1.5 shadow-2xl">
            <span className="self-center text-[10px] text-slate-500 mr-1">{idx + 1}/{SECTIONS.length}</span>
            {back('')}
            {next('')}
          </div>
        </div>
      </div>
    </div>
  );
}
