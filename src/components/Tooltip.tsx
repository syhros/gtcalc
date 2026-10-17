import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * One tooltip for the whole app. Any element with `data-tip="..."` shows it after a short
 * hover, above the element (below if there's no room), wrapped to a few lines. Use "\n" in
 * the text for a line break. Replaces the browser's own `title` popups. Add `data-tip-cut` to
 * show it only when the element's text is cut off (for full names on truncated labels).
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; cx: number; top: number; bottom: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    const hide = () => {
      current = null;
      clearTimeout(timer);
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      setTip(null);
      if (!el) return;
      // data-tip-cut: only when the text is actually cut off (a name that fits needs no tooltip).
      if (el.hasAttribute('data-tip-cut') && el.scrollWidth <= el.clientWidth + 1) return;
      timer = setTimeout(() => {
        const text = el.dataset.tip;
        if (!text || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({ text, cx: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }, 350);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('wheel', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Place it once its size is known: centred on the element, kept inside the window.
  useLayoutEffect(() => {
    if (!tip || !box.current) { setPos(null); return; }
    const w = box.current.offsetWidth;
    const h = box.current.offsetHeight;
    const left = Math.min(window.innerWidth - w - 6, Math.max(6, tip.cx - w / 2));
    const top = tip.top - h - 8 >= 4 ? tip.top - h - 8 : tip.bottom + 8;
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      data-export-skip=""
      className="fixed z-[100] pointer-events-none max-w-[320px] px-2 py-1 text-[10px] font-bold leading-snug whitespace-pre-line normal-case bg-[#0f131c] border border-cyan-500/60 text-cyan-100 shadow-xl"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {tip.text}
    </div>
  );
}
