import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TIERS } from '../types';
import { formatRate } from '../format';
import { pipeRate, type BuildLink, type BuildStep } from '../buildMode';
import { ItemIcon } from './ItemIcon';

/** Build mode's bar (step back / forward, exit) and the card for the current step. */
export function BuildMode({ steps, step, onStep, onExit, onFocus, anchor }: {
  steps: BuildStep[];
  step: number;
  onStep: (n: number) => void;
  onExit: () => void;
  onFocus: (nodeId: string) => void;
  /** The step machine's place on screen: the card goes just left of it when there is room. */
  anchor: { nodeLeft: number; top: number; width: number; minTop: number } | null;
}) {
  const s = steps[Math.min(step, steps.length - 1)];
  const [have, setHave] = useState<Set<string>>(() => new Set());
  // ← / → step, Esc leaves (not while typing).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight') onStep(Math.min(steps.length - 1, step + 1));
      else if (e.key === 'ArrowLeft') onStep(Math.max(0, step - 1));
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step, steps.length, onStep, onExit]);
  if (!s) return null;
  const title = s.kind === 'raw' ? 'Gather the raw inputs' : s.kind === 'done' ? 'Done' : `Build ${s.machines}× ${s.name}`;
  const machineSteps = steps.filter((x) => x.kind === 'machine').length;
  const link = (l: BuildLink, unit: 'mB' | 'item', dir: 'from' | 'to') => (
    <div key={l.connId} className="pl-6 text-xs text-slate-400 leading-snug mt-0.5">
      {dir === 'from' ? '← from ' : '→ to '}
      <button onClick={() => onFocus(l.otherId)} className="text-cyan-300 hover:underline font-bold">{l.otherName}</button>
      {' '}<span className="text-slate-300">{formatRate(l.perSec, unit)}</span>
      <span className="text-slate-500"> ({pipeRate(l.perSec, unit)})</span>
      {l.pipe && <div className="text-violet-300">pipe: {l.pipe}</div>}
    </div>
  );
  const info = s.kind === 'machine' && s.tier ? TIERS[s.tier as keyof typeof TIERS] : undefined;
  const beside = !!anchor && s.kind === 'machine' && anchor.nodeLeft - 24 - anchor.width >= 12;
  return (
    <>
      <div className="absolute top-[52px] left-1/2 -translate-x-1/2 z-40 max-w-[92vw] flex items-center gap-2 px-3 py-1.5 bg-[#161a24]/95 border border-emerald-500/70 shadow-2xl text-[11px]" onMouseDown={(e) => e.stopPropagation()}>
        <span className="text-emerald-300 font-bold whitespace-nowrap uppercase">Build mode</span>
        <span className="text-slate-400 whitespace-nowrap">Step {step + 1} / {steps.length}</span>
        <button onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0} className="px-1.5 py-0.5 border border-[#2b3548] text-slate-200 hover:bg-[#202737] disabled:opacity-30" data-tip="Previous step (←)"><ChevronLeft className="w-3.5 h-3.5" /></button>
        <button onClick={() => onStep(Math.min(steps.length - 1, step + 1))} disabled={step >= steps.length - 1} className="px-1.5 py-0.5 border border-emerald-600/70 bg-emerald-950 text-emerald-200 hover:bg-emerald-900 disabled:opacity-30" data-tip="Next step (→)"><ChevronRight className="w-3.5 h-3.5" /></button>
        <button onClick={onExit} className="px-2 py-0.5 border border-[#2b3548] text-slate-300 hover:bg-[#202737] font-bold whitespace-nowrap" data-tip="Leave build mode (Esc)">Exit build mode</button>
      </div>

      <div
        className={`${beside ? 'fixed' : 'absolute top-[92px] left-3 max-h-[calc(100%-110px)]'} z-30 w-[420px] max-w-[calc(100vw-24px)] overflow-y-auto bg-[#161a24]/95 border-2 border-emerald-500/60 shadow-2xl text-sm transition-[left,top] duration-200`}
        style={beside && anchor ? { left: anchor.nodeLeft - 24 - anchor.width, top: Math.max(anchor.minTop, anchor.top), width: anchor.width, maxHeight: `calc(100vh - ${Math.max(anchor.minTop, anchor.top) + 16}px)` } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-[#283244] bg-[#12201a]">
          <div className="text-[11px] uppercase tracking-wider text-emerald-400">{s.kind === 'raw' ? 'Before you start' : s.kind === 'done' ? 'Finished' : `Machine ${step} of ${machineSteps}`}</div>
          <div className="font-bold text-base text-slate-100 break-words">{title}</div>
          {s.kind === 'machine' && (
            <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs">
              <span className="px-1.5 py-0.5 border text-xs font-bold" style={info ? { backgroundColor: info.badgeBg, borderColor: info.badgeBorder, color: info.color } : undefined}>{s.tierLabel}</span>
              <span className="text-slate-300">{s.recipeName}</span>
              {s.circuit != null && <span className="px-1 border border-slate-600 text-slate-300 text-[10px]">circuit {s.circuit}</span>}
            </div>
          )}
        </div>

        <div className="p-3 space-y-3">
          {s.kind === 'raw' && (
            <>
              <p className="text-slate-400 text-xs">Make sure you can supply these before building. Tick each one off.</p>
              {s.items.length === 0 && s.supplies.length === 0 && <div className="text-slate-500 italic">Nothing: every input is made on the canvas.</div>}
              {s.items.map((r) => (
                <label key={r.item.id} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={have.has(r.item.id)} onChange={() => setHave((h) => { const n = new Set(h); if (n.has(r.item.id)) n.delete(r.item.id); else n.add(r.item.id); return n; })} className="mt-0.5 accent-emerald-500" />
                  <ItemIcon id={r.item.id} color={r.item.iconColor} size={18} />
                  <span className="flex-1 min-w-0">
                    <span className={`font-bold ${have.has(r.item.id) ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{r.item.name}</span>
                    <span className="text-rose-300 font-bold"> {formatRate(r.perSec, r.item.unit)}</span>
                    <span className="block text-xs text-slate-500">for {r.users.join(', ')}</span>
                  </span>
                </label>
              ))}
              {s.supplies.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-slate-500 mb-1">Input nodes</div>
                  {s.supplies.map((x, k) => <div key={k} className="text-slate-300">{x.name} <span className="text-rose-300 font-bold">{formatRate(x.perSec, x.unit)}</span></div>)}
                </div>
              )}
            </>
          )}

          {s.kind === 'machine' && (
            <>
              <div>
                <div className="text-xs uppercase tracking-wider text-rose-300 mb-1.5">Inputs</div>
                <div className="space-y-1.5">
                  {s.inputs.map((i) => (
                    <div key={i.item.id}>
                      <div className="flex items-center gap-1.5">
                        <ItemIcon id={i.item.id} color={i.item.iconColor} size={18} />
                        <span className="text-slate-100 flex-1 min-w-0 break-words">{i.item.name}</span>
                        <span className="text-rose-300 font-bold whitespace-nowrap">{formatRate(i.perSec, i.item.unit)}</span>
                      </div>
                      {i.raw && <div className="pl-6 text-xs text-amber-300">raw input: you supply it ({pipeRate(i.perSec, i.item.unit)})</div>}
                      {i.from.length > 1 && <div className="pl-6 text-xs text-amber-300 font-bold">merge {i.from.length} supplies into this input</div>}
                      {i.from.map((l) => link(l, i.item.unit, 'from'))}
                    </div>
                  ))}
                  {s.inputs.length === 0 && <div className="text-slate-500 italic">None</div>}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-emerald-300 mb-1.5">Outputs</div>
                <div className="space-y-1.5">
                  {s.outputs.map((o) => (
                    <div key={o.item.id}>
                      <div className="flex items-center gap-1.5">
                        <ItemIcon id={o.item.id} color={o.item.iconColor} size={18} />
                        <span className="text-slate-100 flex-1 min-w-0 break-words">{o.item.name}</span>
                        <span className="text-emerald-300 font-bold whitespace-nowrap">{formatRate(o.perSec, o.item.unit)}</span>
                      </div>
                      {o.to.length > 1 && <div className="pl-6 text-xs text-amber-300 font-bold">split {o.to.length} ways</div>}
                      {o.to.map((l) => link(l, o.item.unit, 'to'))}
                      {o.spare > 1e-6 && <div className="pl-6 text-xs text-slate-500">spare {formatRate(o.spare, o.item.unit)}: store it, void it or use it elsewhere</div>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {s.kind === 'done' && (
            <>
              <p className="text-slate-300">That's all {Math.round(s.machines)} machines. The line makes:</p>
              {s.targets.map((t, k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <ItemIcon id={t.item.id} color={t.item.iconColor} size={18} />
                  <span className="text-slate-100 flex-1">{t.item.name}</span>
                  <span className="text-emerald-300 font-bold">{formatRate(t.perSec, t.item.unit)}</span>
                </div>
              ))}
              <button onClick={onExit} className="w-full px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-bold">Exit build mode</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
