import { useSyncExternalStore } from 'react';

/**
 * Display units, chosen once (first launch or sign-up) and changeable in the profile window:
 * rates per second or per minute, power in EU/t or EU/s. Everything is calculated per second
 * and per tick; only the text shown (and typed back) changes. Kept in this browser.
 */
export interface Units { rate: 's' | 'min'; power: 't' | 's' }
const UNITS_KEY = 'gt_calc_units';
let units: Units = (() => {
  try { const u = JSON.parse(localStorage.getItem(UNITS_KEY) ?? 'null'); if (u && (u.rate === 's' || u.rate === 'min') && (u.power === 't' || u.power === 's')) return u; } catch { /* storage blocked */ }
  return { rate: 's', power: 't' };
})();
const unitListeners = new Set<() => void>();
export const getUnits = () => units;
/** Has the user picked their units yet (first-launch / sign-up prompt)? */
export const unitsChosen = () => { try { return localStorage.getItem(UNITS_KEY) != null; } catch { return true; } };
export function setUnits(u: Units) {
  units = u;
  try { localStorage.setItem(UNITS_KEY, JSON.stringify(u)); } catch { /* storage blocked */ }
  unitListeners.forEach((fn) => fn());
}
/** Re-render when the display units change. */
export function useUnits(): Units {
  return useSyncExternalStore((fn) => { unitListeners.add(fn); return () => { unitListeners.delete(fn); }; }, getUnits);
}
/** The power unit's label, and an EU/t figure converted to it. */
export const euUnit = () => (units.power === 's' ? 'EU/s' : 'EU/t');
export const euValue = (eut: number) => (units.power === 's' ? eut * 20 : eut);

const trim = (n: number, digits: number) => {
  const s = n.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

// Always the shortest form from 1,000 up: 1.82k, 436k, 2.15G. GTCEu stores EU/t as a long, so
// nothing goes past E (9.22E is the largest possible value).
const SCALES: [number, string][] = [[1, ''], [1e3, 'k'], [1e6, 'M'], [1e9, 'G'], [1e12, 'T'], [1e15, 'P'], [1e18, 'E']];

/** Compact number: 1234 -> 1.23k, 2500000 -> 2.5M, 999999 -> 1M. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a < 10) {
    if (a >= 0.01 || a === 0) return trim(n, 2);
    return trim(n, Math.min(20, 1 - Math.floor(Math.log10(a)))); // two significant digits, no "1e-7"
  }
  for (let i = 0; i < SCALES.length; i++) {
    const [v, s] = SCALES[i];
    const last = i === SCALES.length - 1;
    if (!last && a >= SCALES[i + 1][0]) continue;
    const x = n / v;
    const text = trim(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);
    if (!last && Math.abs(Number(text)) >= 1000) continue; // 999.6k rounds to 1000k: show 1M
    return `${text}${s}`;
  }
  return String(n);
}

/** A per-second rate in the chosen unit (per second or per minute), 1000 mB = 1 B. */
export function formatRate(perSec: number, unit: 'mB' | 'item'): string {
  const perMin = units.rate === 'min';
  const n = perMin ? perSec * 60 : perSec;
  const per = perMin ? '/min' : '/s';
  if (unit === 'mB') return n >= 1000 ? `${compact(n / 1000)} B${per}` : `${compact(n)} mB${per}`;
  if (!perMin && perSec > 0 && perSec < 0.1) return `${compact(perSec * 60)}/min`; // slow item rates read better per minute
  return `${compact(n)}${per}`;
}

export function formatAmount(amount: number, unit: 'mB' | 'item'): string {
  return unit === 'mB' ? `${amount.toLocaleString()} mB` : `${amount.toLocaleString()}x`;
}

/** An EU/t figure in the chosen power unit (EU/t, or EU/s = 20 ticks). */
export function formatEU(eut: number): string {
  return `${compact(euValue(eut))} ${euUnit()}`;
}

/**
 * Parse a typed rate. Accepts "1000", "1,000", "1.5B", "2.5 B/s", "20k", "500mB", "30/min",
 * "2k EU/s". A bare number is in the chosen display unit (per second or per minute; EU/t or
 * EU/s). Returned per second (fluids in mB) and per tick for EU.
 */
export function parseRate(text: string, unit: 'mB' | 'item' | 'eu'): number | null {
  // Commas only as thousands separators ("1,000"), so "1,5" is refused rather than read as 15.
  const m = /^\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)\s*(k|g|t|m(?!b|in))?\s*(mb|b|l)?\s*(\/s|\/min|\/m|eu\/t|eu\/s|eu)?\s*$/i.exec(text);
  if (!m) return null;
  if (m[3] && unit !== 'mB') return null; // a fluid unit on an item or EU field
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = m[2]?.toLowerCase();
  if (mult === 'k') n *= 1e3;
  else if (mult === 'm') n *= 1e6;
  else if (mult === 'g') n *= 1e9;
  else if (mult === 't') n *= 1e12;
  const u = m[3]?.toLowerCase();
  if (unit === 'mB' && (u === 'b' || u === 'l')) n *= 1000;
  const per = m[4]?.toLowerCase();
  if (unit === 'eu') {
    if (per === 'eu/s' || (per !== 'eu/t' && units.power === 's')) n /= 20; // per tick
  } else if (per === '/min' || per === '/m' || (!per && units.rate === 'min')) n /= 60;
  return n;
}

/** Lift very dark item colours so wires stay visible on the dark canvas. */
export function visibleColor(hex: string | undefined): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return '#22d3ee';
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum >= 0.35) return hex;
  const t = Math.min(0.6, (0.35 - lum) / 0.35 + 0.2);
  return '#' + rgb.map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
}

/** An output's chance as a percentage: 50%, 11.1%, 2.5%, 0.56%. */
export function formatChance(chance: number): string {
  const p = chance * 100;
  const s = p >= 10 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toPrecision(2);
  return `${String(Number(s))}%`;
}
