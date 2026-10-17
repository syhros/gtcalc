import { Maximize2, Settings2, Zap } from 'lucide-react';
import { assetUrl } from '../recipeData';
import type { MachineInfo, MachineRecipe, VoltageTier } from '../types';

interface Props {
  recipe: MachineRecipe;
  tier: VoltageTier;
  machines?: Record<string, MachineInfo>;
  tierCasings?: Partial<Record<VoltageTier, string>>;
  variant?: { overlay?: string; casing?: string }; // a large engine/turbine/multiblock replacing the recipe's own machine
  size?: number;
}

/**
 * Machine picture built from the GTCEu textures: the casing (tier hull for single-block
 * machines, the multiblock's casing otherwise) with the machine's front overlay on top.
 * Animated textures are vertical strips; the box clips to the first frame.
 */
export function MachineIcon({ recipe, tier, machines, tierCasings, variant, size = 28 }: Props) {
  const base = recipe.machineId ? machines?.[recipe.machineId] : undefined;
  const info = variant?.overlay ? { ...base, overlay: variant.overlay, casing: variant.casing, tiered: false } : base;
  const casing = info?.tiered ? tierCasings?.[tier] ?? tierCasings?.LV : info?.casing;

  if (!info?.overlay && !casing) {
    const cls = 'flex-shrink-0';
    const style = { width: size * 0.6, height: size * 0.6 };
    if (recipe.generatesEU) return <Zap className={`${cls} text-amber-400 fill-amber-400`} style={style} />;
    if (recipe.kind === 'multiblock') return <Maximize2 className={`${cls} text-slate-300`} style={style} />;
    return <Settings2 className={`${cls} text-cyan-400`} style={style} />;
  }

  return (
    <div
      className="relative flex-shrink-0 overflow-hidden border border-black/60 bg-[#2a2f3a]"
      style={{ width: size, height: size }}
    >
      {casing && <img src={assetUrl(casing)} alt="" draggable={false} className="pixelated absolute left-0 top-0 w-full" />}
      {info?.overlay && <img src={assetUrl(info.overlay)} alt="" draggable={false} className="pixelated absolute left-0 top-0 w-full" />}
    </div>
  );
}
