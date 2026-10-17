import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';

/** Centre-screen import: drop up to 10 .json files (our flows, backups or GTNH Planner exports). */
export function ImportModal({ onFiles, onClose }: { onFiles: (files: File[]) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-[480px] max-w-full bg-[#161a24] border border-[#2b3548] shadow-2xl p-4 space-y-3 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm text-slate-100">Import flows</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" data-tip="Close"><X className="w-4 h-4" /></button>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}
          className={`w-full h-40 flex flex-col items-center justify-center gap-2 border-2 border-dashed transition ${over ? 'border-cyan-400 bg-cyan-950/30 text-cyan-200' : 'border-[#33405a] text-slate-400 hover:border-[#4a5a7a]'}`}
        >
          <Upload className="w-6 h-6" />
          <span className="font-bold">Drop .json files here, or click to pick</span>
          <span className="text-[10px] text-slate-500">Up to 10 at once. Each becomes a flow in Saves.</span>
        </button>
        <div className="text-[11px] text-emerald-300/90">Flows from GTNH Planner are supported.</div>
        <div className="text-[10px] text-slate-500 leading-snug">
          Also reads flows exported from here (single flows or an all-saves backup). GTNH Planner flows bring their own recipes, with machine counts pinned as in the planner.
        </div>
        <input ref={input} type="file" multiple accept=".json,application/json" className="hidden" onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
