import { useState } from 'react';
import { getUnits, setUnits, useUnits, type Units } from '../format';

const OPTIONS: { key: keyof Units; label: string; choices: [Units[keyof Units], string, string][] }[] = [
  { key: 'rate', label: 'Amounts', choices: [['s', 'Per second', '2.5 B/s'], ['min', 'Per minute', '150 B/min']] },
  { key: 'power', label: 'Power', choices: [['t', 'EU per tick', '480 EU/t'], ['s', 'EU per second', '9.6k EU/s']] },
];

const SHORT: Record<string, string> = { srate: '/s', minrate: '/m', tpower: 'EU/t', spower: 'EU/s' };

/** Two toggle rows: amounts per second / minute, power per tick / second. */
export function UnitsPicker({ value, onChange }: { value: Units; onChange: (change: Partial<Units>) => void }) {
  return (
    <div className="space-y-2">
      {OPTIONS.map((o) => (
        <div key={o.key} className="space-y-1">
          {/* Heading with an example of each, then short toggles like the welcome panel's */}
          <div className="flex items-baseline gap-2 text-[11px]">
            <span className="uppercase tracking-wider text-slate-400">{o.label}</span>
            <span className="text-[10px] text-slate-500">e.g. {o.choices.map((c) => c[2]).join(' or ')}</span>
          </div>
          <div className="flex h-8">
            {o.choices.map(([v, label]) => (
              <button
                key={v}
                onClick={() => onChange({ [o.key]: v })}
                data-tip={label}
                className={`flex-1 font-bold border ${value[o.key] === v ? 'border-cyan-400 bg-cyan-950 text-cyan-100' : 'border-[#2b3548] text-slate-400 hover:text-slate-200 hover:bg-[#202737]'}`}
              >
                {SHORT[v + o.key]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Profile window version: changes apply straight away. */
/** The units as two compact toggles ("/s" "/m" and "EU/t" "EU/s"), sized like the welcome panel's buttons. */
export function UnitsToggles() {
  const units = useUnits();
  const seg = (on: boolean) => `flex-1 px-3 font-bold text-xs tracking-wider border-2 ${on ? 'border-cyan-400 bg-cyan-950 text-cyan-100' : 'border-[#2b3548] bg-[#12151e] text-slate-400 hover:text-slate-200'}`;
  const row = (key: keyof Units, choices: [string, string, string][]) => (
    <div className="flex h-[46px]" data-tip={key === 'rate' ? 'Show amounts per second or per minute' : 'Show power in EU per tick or EU per second'}>
      {choices.map(([v, label]) => (
        <button key={v} onClick={() => setUnits({ ...getUnits(), [key]: v })} className={seg(units[key] === v)}>{label}</button>
      ))}
    </div>
  );
  return <>{row('rate', [['s', '/s', ''], ['min', '/m', '']])}{row('power', [['t', 'EU/t', ''], ['s', 'EU/s', '']])}</>;
}

/** Profile version: amounts and power side by side on one row, applied straight away. */
export function UnitsSetting() {
  const units = useUnits();
  return (
    <>
      {OPTIONS.map((o) => (
        <div key={o.key} className="space-y-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-400" data-tip={`e.g. ${o.choices.map((c) => c[2]).join(' or ')}`}>{o.label}</div>
          <div className="flex h-7">
            {o.choices.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setUnits({ ...getUnits(), [o.key]: v })}
                data-tip={`${label} (${o.choices.find((c) => c[0] === v)?.[2]})`}
                className={`flex-1 px-1.5 font-bold border whitespace-nowrap ${units[o.key] === v ? 'border-cyan-400 bg-cyan-950 text-cyan-100' : 'border-[#2b3548] text-slate-400 hover:text-slate-200 hover:bg-[#202737]'}`}
              >
                {SHORT[v + o.key]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Asked once: on first launch, and again after signing up if it was skipped. Skipping keeps
 * per second and EU/t without counting as a choice.
 */
export function UnitsModal({ onClose }: { onClose: () => void }) {
  const current = useUnits();
  const [pick, setPick] = useState<Units>(current);
  return (
    <div className="fixed inset-0 bg-black/70 z-[65] flex items-center justify-center p-4">
      <div className="w-[400px] max-w-full bg-[#161a24] border border-cyan-500/50 shadow-2xl p-4 space-y-3 text-xs">
        <div className="font-bold text-sm text-slate-100">Choose your units</div>
        <div className="text-slate-400">How should amounts and power be shown? You can change this any time in your profile.</div>
        <UnitsPicker value={pick} onChange={(c) => setPick((p) => ({ ...p, ...c }))} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 border border-[#2b3548] text-slate-300 font-bold hover:bg-[#202737]">Skip</button>
          <button onClick={() => { setUnits(pick); onClose(); }} className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 font-bold">Save</button>
        </div>
      </div>
    </div>
  );
}
