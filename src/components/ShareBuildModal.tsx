import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { CanvasNode, Connection } from '../types';
import { formatEU } from '../format';
import { analyzeFlow } from '../buildStats';
import { MAX_SCHEMATIC_BYTES, FLOW_TAGS, submitBuild, type Build, type FlowTag } from '../community';

const MAX_SCHEMATIC = MAX_SCHEMATIC_BYTES * 0.74; // base64 grows files by a third; one Firestore document holds it

/** Share the open flow to Community, with an optional description and schematic file. */
export function ShareBuildModal({ flow, defaultName, pack, sourceFlowId, onShared, onClose }: {
  flow: { nodes: CanvasNode[]; connections: Connection[]; targetEUtBudget: number };
  defaultName: string;
  pack: string;
  sourceFlowId?: string;
  onShared: (b: Build) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState<FlowTag | ''>('');
  const [schematic, setSchematic] = useState<{ name: string; dataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stats = useMemo(() => analyzeFlow(flow.nodes, flow.connections).stats, [flow]);
  /**
   * Only real schematic files: the right extension, and the contents must be what Schematica,
   * WorldEdit, Litematica and structure blocks all write (gzip-compressed NBT that starts with a
   * compound tag). A renamed image or text file is refused.
   */
  const pickFile = async (f: File | undefined) => {
    setError(null);
    setSchematic(null);
    if (!f) return;
    if (!/^[^/\\<>:"|?*]+\.(schematic|schem|litematic|nbt)$/i.test(f.name)) { setError('Only .schematic, .schem, .litematic or .nbt schematic files'); return; }
    if (f.size > MAX_SCHEMATIC) { setError('Schematic files can be up to 500 KB'); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) { setError('That isn\'t a schematic file (schematics are compressed NBT)'); return; }
    try {
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      const { value } = await reader.read();
      void reader.cancel();
      if (!value || value[0] !== 0x0a) throw new Error();
    } catch {
      setError('That file is damaged or isn\'t a schematic');
      return;
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    setSchematic({ name: f.name, dataUrl: `data:application/octet-stream;base64,${btoa(binary)}` });
  };
  const share = async () => {
    try {
      const b = await submitBuild({ name, description: description.trim().slice(0, 2000), pack, flow, stats, sourceFlowId, ...(schematic ? { schematic } : {}), ...(tag ? { tag } : {}) });
      onShared(b);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-[460px] max-w-full bg-[#161a24] border border-[#2b3548] shadow-2xl p-4 space-y-3 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm text-slate-100">Share flow to Community</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" data-tip="Close"><X className="w-4 h-4" /></button>
        </div>
        <label className="block space-y-1">
          <span className="text-slate-400">Name</span>
          <input autoFocus value={name} maxLength={64} onChange={(e) => setName(e.target.value)} className="w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400" />
        </label>
        <label className="block space-y-1">
          <span className="text-slate-400">Description (optional)</span>
          <textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="What it makes, what you need to build first, tips" className="w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400 resize-y" />
        </label>
        <label className="block space-y-1">
          <span className="text-slate-400">Tag (optional, helps people find it)</span>
          <select value={tag} onChange={(e) => setTag(e.target.value as FlowTag | '')} className="w-full bg-[#12151e] border border-[#2b3548] px-2 py-1.5 text-slate-100 outline-none focus:border-cyan-400">
            <option value="">No tag</option>
            {FLOW_TAGS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-slate-400">Schematic file (optional)</span>
          <input type="file" accept=".schematic,.schem,.litematic,.nbt" onChange={(e) => void pickFile(e.target.files?.[0])} className="block w-full text-slate-300 file:mr-2 file:px-2 file:py-1 file:border file:border-[#2b3548] file:bg-[#1a202c] file:text-slate-200" />
          {schematic && <span className="text-emerald-300">{schematic.name} attached</span>}
        </label>
        <div className="grid grid-cols-2 gap-1 p-2 border border-[#222a3b] bg-[#12151e] text-slate-400">
          <span>Machines: <b className="text-slate-200">{stats.machines}</b></span>
          <span>Tiers: <b className="text-amber-300">{stats.lowTier}–{stats.topTier}</b></span>
          <span>Uses: <b className="text-amber-400">{formatEU(stats.eutUse)}</b></span>
          <span>Makes: <b className="text-emerald-300">{stats.output?.name ?? 'no target'}</b></span>
        </div>
        {error && <div className="text-rose-300 font-bold">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 font-bold hover:bg-[#202737]">Cancel</button>
          <button onClick={() => void share()} disabled={!name.trim() || !flow.nodes.length} className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-bold disabled:opacity-40">Share</button>
        </div>
      </div>
    </div>
  );
}
