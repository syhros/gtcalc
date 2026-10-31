// Types for pack-recipes.mjs, for the unit tests.
export function writePacked(dataDir: string, name: string, data: { recipes: unknown[]; items: Record<string, unknown>; machines: Record<string, unknown> }, options?: { parts?: number; idPrefix?: string; partName?: string }): number[];
export function readRecipes(dataDir: string, name: string): Record<string, unknown> & { recipes: unknown[] };
