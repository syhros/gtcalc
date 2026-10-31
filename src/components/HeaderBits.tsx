import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Cloud } from 'lucide-react';
import { flushSync, getSyncStatus, onSyncStatus } from '../cloudSync';

/**
 * A toolbar row that scrolls sideways when the window is too narrow for it. Arrows appear at
 * whichever end has more buttons hidden; click one (or use the mouse wheel) to scroll.
 */
export function ScrollRow({ children, className = '' }: { children: ReactNode | ((wide: boolean) => ReactNode); className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  // Children given as a function get `wide`: true while every button fits with its full label.
  const [wide, setWide] = useState(true);
  const wideNeeds = useRef(0); // the width the full labels took, so they come back once there's room
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => {
      setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
      setWide((w) => {
        if (w && el.scrollWidth > el.clientWidth + 1) { wideNeeds.current = el.scrollWidth; return false; }
        if (!w && el.clientWidth >= wideNeeds.current) return true;
        return w;
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    el.addEventListener('scroll', update, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', update); };
  }, []);
  const by = (dx: number) => row.current?.scrollBy({ left: dx, behavior: 'smooth' });
  const arrow = 'absolute top-1/2 -translate-y-1/2 z-10 h-7 w-6 flex items-center justify-center bg-[#161a24] border border-[#2b3548] text-cyan-300 hover:bg-[#202737] shadow-[0_0_10px_6px_#161a24]';
  return (
    <div className={`relative min-w-[72px] items-center ${className}`}>
      {more.left && <button onClick={() => by(-200)} className={`${arrow} left-0`} data-tip="More buttons" aria-label="More buttons"><ChevronLeft className="w-4 h-4" /></button>}
      <div
        ref={row}
        className="flex flex-1 items-center gap-2 md:gap-3 overflow-x-auto min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => { if (row.current && e.deltaY && !e.deltaX) row.current.scrollLeft += e.deltaY; }}
      >
        {typeof children === 'function' ? children(wide) : children}
      </div>
      {more.right && <button onClick={() => by(200)} className={`${arrow} right-0`} data-tip="More buttons" aria-label="More buttons"><ChevronRight className="w-4 h-4" /></button>}
    </div>
  );
}

/** Three right-pointing chevrons (Max Flow: push the flow as far as it goes). */
export function TripleChevron({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 22 16" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="square" aria-hidden="true">
      <path d="M2 3l5 5-5 5M8.5 3l5 5-5 5M15 3l5 5-5 5" />
    </svg>
  );
}

/** A floppy disk with a plus (Save as: a new copy). */
export function SaveAsIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v5" />
      <path d="M7 3v5h8M7 21v-7h6" />
      <path d="M19 16v6M16 19h6" />
    </svg>
  );
}

/** Cloud save status beside Save: green when on your account, grey when only saved here, pulsing blue while uploading. Click to sync now. */
export function CloudIcon() {
  const status = useSyncExternalStore(onSyncStatus, getSyncStatus, getSyncStatus);
  const tip = status === 'syncing' ? 'Saving to your account…' : status === 'pending' ? 'Saved here; it goes to your account within 30 seconds (click to send now)' : 'Your saved flows are backed up to your account';
  return (
    <button onClick={() => void flushSync()} data-tip={tip} aria-label={tip} className={`flex items-center px-1.5 border border-l-0 ${status === 'syncing' ? 'border-sky-500/60 bg-[#161a24] text-sky-400 animate-pulse' : status === 'pending' ? 'border-[#2b3548] bg-[#161a24] text-slate-500 hover:text-slate-300' : 'border-emerald-500/70 bg-emerald-950/80 text-emerald-300'}`}>
      <Cloud className="w-3.5 h-3.5" />
    </button>
  );
}
