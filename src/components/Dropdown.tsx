import React, { useRef, useState } from 'react';
import { PixelIcon } from './PixelIcon';

/**
 * Header dropdown: a button with the pixel arrow and a menu placed on screen (fixed), so a
 * header that clips its overflow can't cut it off. `children` gets a close() callback.
 */
export function Dropdown({ label, className = '', menuClassName = '', tip, children }: {
  label: React.ReactNode;
  className?: string;
  menuClassName?: string;
  tip?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const close = () => setAt(null);
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => {
          if (at) { close(); return; }
          const r = btn.current!.getBoundingClientRect();
          // Keep the 300px menu inside the window; open upwards from buttons low on the screen.
          const left = Math.max(6, Math.min(r.left, window.innerWidth - 306));
          setAt(r.top > window.innerHeight * 0.6 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
        }}
        className={`h-7 flex items-center gap-1.5 px-2 border transition ${className}`}
        data-tip={at ? undefined : tip}
      >
        {label}
        <PixelIcon name={at ? 'up' : 'down'} className="w-2.5 h-[6px] opacity-80" />
      </button>
      {at && (
        <>
          <div className="fixed inset-0 z-[55]" onMouseDown={close} />
          <div
            className={`fixed z-[56] flex flex-col w-[300px] max-w-[calc(100vw-12px)] bg-[#161a24] border border-[#2b3548] shadow-2xl py-1 text-xs normal-case tracking-normal whitespace-normal break-words ${menuClassName}`}
            style={{ left: at.left, top: at.top, bottom: at.bottom, maxHeight: `calc(100vh - ${(at.top ?? at.bottom ?? 0) + 8}px)`, overflowY: 'auto' }}
          >
            {children(close)}
          </div>
        </>
      )}
    </>
  );
}
