import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageDown, Maximize2, Minus, Plus, X } from 'lucide-react';
import { EXPORT_KEY, loadExportOptions, type ExportOptions } from '../exportOptions';
export type { ExportOptions };

type Choice<K extends keyof ExportOptions> = [ExportOptions[K], string, string];
const DETAIL: Choice<'detail'>[] = [['advanced', 'Advanced', 'Everything on each card: counts, tiers, machine choices and the footer'], ['basic', 'Basic', 'Cards without their footers and machine choices'], ['simple', 'Simple', 'Just each machine and its inputs and outputs']];
const SIZE: Choice<'size'>[] = [['auto', 'Max', 'As sharp as the browser allows (2x)'], ['4k', '4K', '3840 px on the long side'], ['hd', 'HD', '1920 px on the long side'], ['sd', 'SD', '1280 px on the long side']];
const FORMAT: Choice<'format'>[] = [['jpg', 'JPG', 'Smaller file'], ['png', 'PNG', 'Sharp text, bigger file']];
const ONOFF: Choice<'labels'>[] = [[true, 'On', ''], [false, 'Off', '']];

/** Export the flow as an image, with a few rendering options (remembered in this browser). */
export function ExportImageModal({ onExport, onPreview, onClose }: {
  onExport: (o: ExportOptions) => void;
  onPreview: (o: ExportOptions) => Promise<{ url: string; full: { w: number; h: number } }>;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<ExportOptions>(loadExportOptions);
  // Live preview: redrawn shortly after each change (the real export uses the same drawing).
  const [shot, setShot] = useState<{ url: string; full: { w: number; h: number }; for: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify({ ...opts, format: 'jpg', size: opts.size });
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      onPreview(opts).then((s) => { if (live) { setShot({ ...s, for: key }); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
    // key captures every option that changes the picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const stale = !shot || shot.for !== key;
  const row = <K extends keyof ExportOptions>(label: string, key: K, choices: Choice<K>[]) => (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="flex">
        {choices.map(([v, text, tip]) => (
          <button
            key={String(v)}
            onClick={() => setOpts({ ...opts, [key]: v })}
            data-tip={tip || undefined}
            className={`flex-1 px-2 py-1.5 border font-bold -ml-px first:ml-0 ${opts[key] === v ? 'relative border-cyan-400 bg-cyan-950 text-cyan-100' : 'border-[#2b3548] text-slate-400 hover:text-slate-200 hover:bg-[#202737]'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  const go = () => {
    try { localStorage.setItem(EXPORT_KEY, JSON.stringify(opts)); } catch { /* storage unavailable */ }
    onClose();
    onExport(opts);
  };
  return (
    // Desktop: about 70% of the window, preview beside the options. Phones: the whole screen, preview on
    // top and options below.
    <div className="fixed inset-0 bg-black/70 z-[65] flex items-center justify-center md:p-4" onMouseDown={onClose}>
      <div className="flex flex-col w-full h-full md:w-[max(70vw,760px)] md:h-[max(70vh,520px)] md:max-w-[96vw] md:max-h-[94vh] bg-[#161a24] md:border border-cyan-500/50 shadow-2xl text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#283244] flex-shrink-0">
          <div className="font-pixel-bold text-cyan-300 uppercase text-sm">Export image</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 p-3 md:p-4 flex flex-col md:grid md:grid-cols-[1fr_300px] gap-3 md:gap-4">
          <div className="flex flex-col gap-1.5 min-w-0 min-h-0 flex-1">
            <PanZoom url={shot?.url} dim={stale}>
              {!shot && !failed && <span className="text-slate-500">Drawing preview…</span>}
              {failed && <span className="text-rose-400">Couldn't draw a preview</span>}
              {shot && stale && <span className="absolute top-2 right-2 text-[10px] text-cyan-300 bg-[#161a24]/90 px-1.5 py-0.5 border border-cyan-500/40">Updating…</span>}
            </PanZoom>
            {shot && (
              <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                <span className="max-md:hidden">Scroll to zoom, drag to move, double-click to fit</span>
                <span className="md:hidden">Pinch to zoom, drag to move</span>
                <span>Export size: {shot.full.w.toLocaleString()} x {shot.full.h.toLocaleString()} px, {opts.format.toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="space-y-3 md:overflow-y-auto max-md:flex-shrink-0 max-md:max-h-[45vh] max-md:overflow-y-auto">
          {row('Detail level', 'detail', DETAIL)}
          <div className="grid grid-cols-2 gap-3">
            {row('Wire labels', 'labels', ONOFF)}
            {row('Background grid', 'grid', ONOFF as Choice<'grid'>[])}
          </div>
          {row('Resolution', 'size', SIZE)}
          {row('Format', 'format', FORMAT)}
          <div className="text-[10px] text-slate-500">{DETAIL.find((d) => d[0] === opts.detail)?.[2]}.</div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 font-bold hover:bg-[#202737]">Cancel</button>
            <button onClick={go} className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 font-bold inline-flex items-center gap-1.5"><ImageDown className="w-3.5 h-3.5" /> Export</button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The preview, zoomable and movable: the wheel or a pinch zooms around the pointer, dragging (mouse or
 * one finger) moves it, double-click or the fit button shows it whole again.
 */
function PanZoom({ url, dim, children }: { url?: string; dim: boolean; children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  /** Zoom by factor around (cx, cy), measured from the box centre, keeping that point in place. */
  const zoomAt = (factor: number, cx: number, cy: number) => setView((v) => {
    const s = Math.min(12, Math.max(1, v.s * factor));
    if (s === 1) return { s: 1, x: 0, y: 0 };
    const k = s / v.s;
    return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
  });
  const fromCentre = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Not passive, so the page itself doesn't scroll.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [cx, cy] = fromCentre(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, cx, cy);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const down = (e: React.PointerEvent) => {
    box.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: viewRef.current.s };
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const [cx, cy] = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
      const target = pinch.current.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d);
      zoomAt(target / viewRef.current.s, cx, cy);
      return;
    }
    if (viewRef.current.s > 1) setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const btn = 'w-7 h-7 flex items-center justify-center bg-[#161a24]/90 border border-[#2b3548] text-slate-300 hover:text-cyan-200 hover:border-cyan-500/60';
  return (
    <div
      ref={box}
      className={`relative flex-1 min-h-[200px] flex items-center justify-center bg-[#11141c] border border-[#283244] overflow-hidden select-none touch-none ${view.s > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => setView({ s: 1, x: 0, y: 0 })}
    >
      {url && (
        <img
          src={url}
          alt="Preview of the exported image"
          draggable={false}
          className={`max-w-full max-h-full object-contain transition-opacity ${dim ? 'opacity-40' : ''}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: 'center' }}
        />
      )}
      {children}
      {url && (
        <div className="absolute bottom-2 right-2 flex gap-1" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button className={btn} onClick={() => zoomAt(1 / 1.4, 0, 0)} aria-label="Zoom out" data-tip="Zoom out"><Minus className="w-3.5 h-3.5" /></button>
          <button className={btn} onClick={() => zoomAt(1.4, 0, 0)} aria-label="Zoom in" data-tip="Zoom in"><Plus className="w-3.5 h-3.5" /></button>
          <button className={btn} onClick={() => setView({ s: 1, x: 0, y: 0 })} aria-label="Fit" data-tip="Show it whole"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </div>
  );
}
