import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { RecipeDatabase } from '../recipeData';

/** Turn individual large machines on or off for Auto Ratio's "Use large machines". */
export function MultiblockSettings({ db, disabled, onChange, onClose }: {
  db: RecipeDatabase;
  disabled: Set<string>;
  onChange: (next: Set<string>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  // Every large machine once, with the machines whose recipes it can run.
  const list = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; parallel: boolean; replaces: string[] }>();
    for (const [machineId, variants] of Object.entries(db.machineVariants)) {
      const base = db.machines[machineId]?.name ?? machineId.replace(/_/g, ' ');
      for (const v of variants) {
        const row = byId.get(v.id) ?? { id: v.id, name: v.name, parallel: v.parallel, replaces: [] };
        if (!row.replaces.includes(base)) row.replaces.push(base);
        byId.set(v.id, row);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [db]);
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((r) => r.name.toLowerCase().includes(q) || r.replaces.some((x) => x.toLowerCase().includes(q))) : list;
  const toggle = (id: string) => {
    const next = new Set(disabled);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-[520px] max-w-full max-h-[80vh] flex flex-col bg-[#161a24] border border-[#2b3548] shadow-2xl text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-[#283244]">
          <div>
            <div className="font-bold text-sm text-slate-100">Large machines for Auto Ratio</div>
            <div className="text-[10px] text-slate-500">Unticked machines are never picked. {list.length - disabled.size} of {list.length} on.</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" data-tip="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-1.5 p-3 pb-2">
          <input
            autoFocus={window.matchMedia('(pointer: fine)').matches} // phones would zoom in on the box
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search machines"
            className="flex-1 bg-[#12151e] border border-[#2b3548] px-2 py-1 text-slate-200 outline-none focus:border-cyan-400"
          />
          <button onClick={() => onChange(new Set())} className="px-2 border border-emerald-700/50 text-emerald-300 hover:bg-emerald-950 font-bold">All on</button>
          <button onClick={() => onChange(new Set(list.map((r) => r.id)))} className="px-2 border border-rose-700/50 text-rose-300 hover:bg-rose-950 font-bold">All off</button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {shown.map((r) => (
            <label key={r.id} className={`flex items-start gap-2 p-1.5 border cursor-pointer ${disabled.has(r.id) ? 'border-[#222a3b] bg-[#12151e] opacity-60' : 'border-cyan-900/60 bg-cyan-950/10'}`}>
              <input type="checkbox" checked={!disabled.has(r.id)} onChange={() => toggle(r.id)} className="mt-0.5 accent-cyan-400" />
              <span className="min-w-0">
                <span className="font-bold text-slate-200">{r.name}</span>
                {r.parallel && <span className="ml-1.5 text-[9px] px-1 border border-violet-500/50 text-violet-300">PARALLEL</span>}
                <span className="block text-[10px] text-slate-500">Runs {r.replaces.join(', ')} recipes</span>
              </span>
            </label>
          ))}
          {!shown.length && <div className="text-slate-500 italic">Nothing matches.</div>}
        </div>
      </div>
    </div>
  );
}
