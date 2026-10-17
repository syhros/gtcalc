import { useRef, useState } from 'react';
import { parseRate } from '../format';

interface Props {
  value: number; // per second (mB/s, items/s) or EU/t
  unit: 'mB' | 'item' | 'eu';
  display: string; // formatted value shown when not editing, e.g. "+25.6 mB/s"
  onCommit: (value: number) => void;
  className?: string;
  title?: string;
  placeholder?: string;
  allowEmpty?: boolean; // empty input commits NaN (e.g. "unlimited")
}

// Example inputs shown in the tooltip; parseRate (format.ts) accepts all of them.
const EXAMPLES: Record<Props['unit'], string> = {
  item: '100, 1k, 10k items/s',
  mB: '500 mB/s, 2B, 1.5kB',
  eu: '100, 10k, 1M EU/t',
};

const editText = (display: string) => display.replace(/^[+-]/, '').replace(/\/min$/, '/min');

/**
 * Shows a value as plain text; hovering hints it's editable, clicking turns it into an
 * input in place. Accepts "1.5B", "20k", "500 mB/s"; applies on Enter / blur.
 */
export function EditableValue({ value, unit, display, onCommit, className = '', title, placeholder, allowEmpty }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const commit = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current) { cancelled.current = false; return; }
    if (text == null) return;
    if (allowEmpty && text.trim() === '') { onCommit(NaN); return; }
    const n = parseRate(text.replace(/^\+/, ''), unit); // handles /min, EU/s and the display units
    if (n != null && n >= 0) onCommit(n);
  };

  if (draft != null) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={`editable-input w-20 min-w-0 bg-[#0f131c] border border-current/60 text-right font-bold px-1 leading-none outline-none ${className}`}
      />
    );
  }

  // Custom tooltip (not the browser's): what clicking does, plus example inputs for the unit.
  const hint = `${title ?? 'Click to edit'}\ne.g. ${EXAMPLES[unit]}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setDraft(Number.isFinite(value) || !allowEmpty ? editText(display) : ''); }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`editable-value font-mono whitespace-nowrap font-bold ${className}`}
      aria-label={hint}
      data-tip={hint}
    >
      {display}
    </button>
  );
}

/**
 * Text version of EditableValue (same hover lift and in-place input), e.g. the flow name.
 * Shows at most `showChars` characters (full text in the tooltip); input caps at `maxLength`.
 */
export function EditableText({ value, onCommit, maxLength = 64, showChars = 24, className = '', title = 'Click to rename', placeholder }: {
  value: string;
  onCommit: (value: string) => void;
  maxLength?: number;
  showChars?: number;
  className?: string;
  title?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    const text = draft?.trim();
    setDraft(null);
    if (cancelled.current) { cancelled.current = false; return; }
    if (text && text !== value) onCommit(text.slice(0, maxLength));
  };
  if (draft != null) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
          e.stopPropagation(); // keep canvas shortcuts (Delete, Ctrl+Z) out of the input
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`editable-input w-48 min-w-0 bg-[#0f131c] border border-current/60 font-bold px-1 leading-none outline-none ${className}`}
      />
    );
  }
  const shown = value.length > showChars ? `${value.slice(0, showChars - 1)}…` : value;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setDraft(value); }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`editable-value whitespace-nowrap font-bold ${className}`}
      data-tip={value.length > showChars ? `${value}\n${title}` : title} // the name only when it's cut short
    >
      {shown}
    </button>
  );
}
