/** Image export options (the Export image panel), remembered in this browser. */
export interface ExportOptions {
  detail: 'advanced' | 'basic' | 'simple';
  labels: boolean; // wire labels (rates on the links)
  grid: boolean; // dotted background grid
  size: 'auto' | '4k' | 'hd' | 'sd';
  format: 'jpg' | 'png';
}
export const DEFAULT_EXPORT: ExportOptions = { detail: 'advanced', labels: true, grid: true, size: 'auto', format: 'jpg' };
/** Long side of the image, in pixels. */
export const EXPORT_SIZES: Record<Exclude<ExportOptions['size'], 'auto'>, number> = { '4k': 3840, hd: 1920, sd: 1280 };

export const EXPORT_KEY = 'gt_calc_export_opts';
export function loadExportOptions(): ExportOptions {
  try { return { ...DEFAULT_EXPORT, ...JSON.parse(localStorage.getItem(EXPORT_KEY) ?? '{}') }; } catch { return DEFAULT_EXPORT; }
}

