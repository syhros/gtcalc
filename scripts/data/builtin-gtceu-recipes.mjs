// Base GTCEu recipes for the petrochemical / gasoline chain, transcribed from the
// GregTech CEu Modern v7.5.3 source (data/recipe/serialized/chemistry/PetrochemRecipes.java,
// FuelRecipeChains.java, DistillationRecipes.java, misc/WoodMachineRecipes.java, misc/FuelRecipes.java).
//
// They are a stop-gap until a GTCEu recipe dump is imported: base GregTech recipes are
// generated in Java and are not in the modpack's KubeJS scripts. A recipe with the same
// id in a dump replaces the one here.
const f = (id, amount) => ({ id: id.includes(':') ? id : `gtceu:${id}`, amount, isTag: false });
const i = (id, amount = 1) => ({ id: id.replace(/^#/, ''), amount, isTag: id.startsWith('#') });

const r = (type, name, { ii = [], fi = [], io = [], fo = [], t, eut, circuit = null }) => ({
  id: `gtceu:${type}/${name}`,
  type,
  itemInputs: ii,
  fluidInputs: fi,
  itemOutputs: io,
  fluidOutputs: fo,
  duration: t,
  EUt: eut,
  circuit,
  conditions: [],
  extra: {},
});

const LV = 30, MV = 120, HV = 480;

const PYROLYSE = [
  // [id, circuit, uses nitrogen, fluid output, ticks, EU/t]
  ['log_to_charcoal_byproducts', 4, true, f('charcoal_byproducts', 4000), 320, 96],
  ['log_to_wood_tar', 9, false, f('wood_tar', 1500), 640, 64],
  ['log_to_wood_tar_nitrogen', 10, true, f('wood_tar', 1500), 320, 96],
  ['log_to_wood_gas', 5, false, f('wood_gas', 1500), 640, 64],
  ['log_to_wood_gas_nitrogen', 6, true, f('wood_gas', 1500), 320, 96],
  ['log_to_wood_vinegar', 7, false, f('wood_vinegar', 3000), 640, 64],
  ['log_to_wood_vinegar_nitrogen', 8, true, f('wood_vinegar', 3000), 320, 96],
  ['log_to_creosote', 1, false, f('creosote', 4000), 640, 64],
  ['log_to_creosote_nitrogen', 2, true, f('creosote', 4000), 320, 96],
];

export const BUILTIN_RECIPES = [
  // --- Gasoline
  r('chemical_reactor', 'gasoline', { fi: [f('raw_gasoline', 10000), f('toluene', 1000)], fo: [f('gasoline', 11000)], t: 10, eut: HV }),
  r('large_chemical_reactor', 'raw_gasoline', { fi: [f('naphtha', 16000), f('refinery_gas', 2000), f('methanol', 1000), f('acetone', 1000)], fo: [f('raw_gasoline', 20000)], t: 100, eut: HV, circuit: 24 }),

  // --- Oil distillation
  r('distillation_tower', 'distill_oil', { fi: [f('oil', 50)], fo: [f('sulfuric_heavy_fuel', 15), f('sulfuric_light_fuel', 50), f('sulfuric_naphtha', 20), f('sulfuric_gas', 60)], t: 20, eut: 96 }),
  r('distillation_tower', 'distill_light_oil', { fi: [f('oil_light', 150)], fo: [f('sulfuric_heavy_fuel', 10), f('sulfuric_light_fuel', 20), f('sulfuric_naphtha', 30), f('sulfuric_gas', 240)], t: 20, eut: 96 }),
  r('distillation_tower', 'distill_heavy_oil', { fi: [f('oil_heavy', 100)], fo: [f('sulfuric_heavy_fuel', 250), f('sulfuric_light_fuel', 45), f('sulfuric_naphtha', 15), f('sulfuric_gas', 60)], t: 20, eut: 288 }),
  r('distillation_tower', 'distill_raw_oil', { fi: [f('oil_medium', 100)], fo: [f('sulfuric_heavy_fuel', 10), f('sulfuric_light_fuel', 50), f('sulfuric_naphtha', 150), f('sulfuric_gas', 60)], t: 20, eut: 96 }),

  // --- Desulfurization
  r('chemical_reactor', 'desulfurize_heavy_fuel', { fi: [f('sulfuric_heavy_fuel', 8000), f('hydrogen', 2000)], fo: [f('hydrogen_sulfide', 1000), f('heavy_fuel', 8000)], t: 160, eut: LV }),
  r('chemical_reactor', 'desulfurize_light_fuel', { fi: [f('sulfuric_light_fuel', 12000), f('hydrogen', 2000)], fo: [f('hydrogen_sulfide', 1000), f('light_fuel', 12000)], t: 160, eut: LV }),
  r('chemical_reactor', 'desulfurize_naphtha', { fi: [f('sulfuric_naphtha', 12000), f('hydrogen', 2000)], fo: [f('hydrogen_sulfide', 1000), f('naphtha', 12000)], t: 160, eut: LV }),
  r('chemical_reactor', 'desulfurize_refinery_gas', { fi: [f('sulfuric_gas', 16000), f('hydrogen', 2000)], fo: [f('hydrogen_sulfide', 1000), f('refinery_gas', 16000)], t: 160, eut: LV }),
  r('chemical_reactor', 'desulfurize_natural_gas', { fi: [f('natural_gas', 16000), f('hydrogen', 2000)], fo: [f('hydrogen_sulfide', 1000), f('refinery_gas', 16000)], t: 160, eut: LV }),

  // --- Light hydro-cracking (cracker multiblock + chemical reactor variant)
  ...[['light_fuel', 'light_fuel'], ['heavy_fuel', 'heavy_fuel'], ['naphtha', 'naphtha'], ['refinery_gas', 'gas']].flatMap(([raw, cracked]) => [
    r('cracker', `lightly_hydro_crack_${raw}`, { fi: [f(raw, 1000), f('hydrogen', 2000)], fo: [f(`lightly_hydro_cracked_${cracked}`, 1000)], t: 80, eut: MV, circuit: 1 }),
    r('chemical_reactor', `lightly_hydro_crack_${raw}`, { fi: [f(raw, 500), f('hydrogen', 1000)], fo: [f(`lightly_hydro_cracked_${cracked}`, 250)], t: 80, eut: LV, circuit: 1 }),
  ]),

  // --- Cracked fuel / gas distillation
  r('distillation_tower', 'distill_refinery_gas', { fi: [f('refinery_gas', 1000)], fo: [f('butane', 60), f('propane', 70), f('ethane', 100), f('methane', 750), f('helium', 20)], t: 240, eut: MV }),
  r('distillation_tower', 'distill_lightly_hydro_cracked_heavy_fuel', { fi: [f('lightly_hydro_cracked_heavy_fuel', 1000)], fo: [f('light_fuel', 600), f('naphtha', 100), f('butane', 100), f('propane', 100), f('ethane', 75), f('methane', 75)], t: 120, eut: MV }),
  r('distillation_tower', 'distill_lightly_hydro_cracked_light_fuel', { fi: [f('lightly_hydro_cracked_light_fuel', 1000)], fo: [f('naphtha', 800), f('octane', 100), f('butane', 150), f('propane', 200), f('ethane', 125), f('methane', 125)], t: 120, eut: MV }),
  r('distillation_tower', 'distill_lightly_hydro_cracked_naphtha', { fi: [f('lightly_hydro_cracked_naphtha', 1000)], fo: [f('butane', 800), f('propane', 300), f('ethane', 250), f('methane', 250)], t: 120, eut: MV }),
  r('distillation_tower', 'distill_lightly_hydro_cracked_gas', { fi: [f('lightly_hydro_cracked_gas', 1000)], fo: [f('methane', 1400), f('hydrogen', 1340), f('helium', 20)], t: 120, eut: MV }),

  // --- Wood distillation
  r('distillation_tower', 'distill_charcoal_byproducts', { fi: [f('charcoal_byproducts', 1000)], io: [{ ...i('gtceu:charcoal_dust'), chance: 0.25 }], fo: [f('wood_tar', 250), f('wood_vinegar', 400), f('wood_gas', 250), f('dimethylbenzene', 100)], t: 40, eut: 256 }),
  r('distillation_tower', 'distill_wood_tar', { fi: [f('wood_tar', 1000)], fo: [f('creosote', 300), f('phenol', 75), f('benzene', 350), f('toluene', 75), f('dimethylbenzene', 200)], t: 40, eut: 256 }),
  r('distillation_tower', 'distill_wood_vinegar', { fi: [f('wood_vinegar', 1000)], fo: [f('acetic_acid', 100), f('minecraft:water', 500), f('ethanol', 10), f('methanol', 300), f('acetone', 50), f('methyl_acetate', 10)], t: 40, eut: 256 }),

  // --- Pyrolyse oven (16 burnable logs)
  ...PYROLYSE.map(([name, circuit, nitrogen, out, t, eut]) =>
    r('pyrolyse_oven', name, { ii: [i('#minecraft:logs_that_burn', 16)], fi: nitrogen ? [f('nitrogen', 1000)] : [], io: [i('minecraft:charcoal', 20)], fo: [out], t, eut, circuit })),
  r('pyrolyse_oven', 'log_to_heavy_oil', { ii: [i('#minecraft:logs_that_burn', 16)], io: [i('gtceu:ash_dust', 4)], fo: [f('oil_heavy', 200)], t: 320, eut: 192, circuit: 3 }),

  // --- Combustion generator fuels (LV generator, -32 EU/t)
  r('combustion_generator', 'gasoline', { fi: [f('gasoline', 1)], t: 50, eut: -32 }),
  r('combustion_generator', 'high_octane_gasoline', { fi: [f('high_octane_gasoline', 1)], t: 100, eut: -32 }),
  r('combustion_generator', 'toluene', { fi: [f('toluene', 1)], t: 10, eut: -32 }),
];
