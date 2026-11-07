/** Metric-only equivalents of the final Brewey PostgreSQL calculation functions. */
export interface MetricRecipe {
  batch_size_liters?: number | null
  efficiency_percent?: number | null
  boil_time_minutes?: number | null
  recipe_grains?: Array<{
    amount_kg: number | null
    grains?: { extract_potential: number | null; color_ebc: number | null; must_mash?: boolean | null } | null
  }>
  recipe_hops?: Array<{
    amount_grams: number | null
    time_minutes?: number | null
    use_type: string
    temperature_c?: number | null
    alpha_acid_percent_override?: number | null
    hops?: { alpha_acid_percent: number | null; form?: string | null } | null
  }>
  recipe_yeasts?: Array<{
    amount_units?: number | null
    yeasts?: { attenuation_percent: number | null } | null
  }>
  recipe_mash_steps?: Array<{ temperature_c: number | null; duration_minutes: number | null }>
}

export interface RecipeCalculations {
  calculated_og: number | null
  calculated_fg: number | null
  calculated_abv: number | null
  calculated_ibu: number | null
  calculated_ebc: number | null
}

/** PostgreSQL NUMERIC ROUND uses half-away-from-zero, unlike Math.round. */
export function roundNumeric(value: number, digits: number): number {
  if (!Number.isFinite(value)) throw new RangeError('A finite calculation result is required')
  const [coefficient, exponent = '0'] = Math.abs(value).toString().split('e')
  const shifted = Number(`${coefficient}e${Number(exponent) + digits}`)
  // Compensate for binary arithmetic at decimal ties, without changing precision.
  const rounded = Math.round(shifted + Number.EPSILON * Math.max(1, shifted) * 4)
  return (Math.sign(value) * rounded) / 10 ** digits || 0
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validBatch(recipe: MetricRecipe): number | null {
  return finite(recipe.batch_size_liters) && recipe.batch_size_liters > 0 ? recipe.batch_size_liters : null
}

export function calculateOg(recipe: MetricRecipe): number | null {
  const volume = validBatch(recipe)
  if (volume === null) return null
  const efficiency = recipe.efficiency_percent ?? 75
  if (!finite(efficiency)) return null
  let points = 0
  for (const addition of recipe.recipe_grains ?? []) {
    if (!addition.grains) continue // Matches the SQL inner join.
    const { extract_potential, must_mash } = addition.grains
    if (!finite(addition.amount_kg) || !finite(extract_potential)) return null
    points += (addition.amount_kg * extract_potential * 384 * (must_mash ? efficiency / 100 : 1)) / volume
  }
  return roundNumeric(1 + points / 1000, 3)
}

export function calculateFg(recipe: MetricRecipe, og?: number | null): number | null {
  const originalGravity = og ?? calculateOg(recipe)
  if (originalGravity === null || !finite(originalGravity)) return null
  const attenuations = (recipe.recipe_yeasts ?? [])
    .map(addition => addition.yeasts?.attenuation_percent)
    .filter(finite)
  // The SQL AVG weights each yeast row equally, not by packet/gram quantity.
  const base = attenuations.length ? attenuations.reduce((sum, value) => sum + value, 0) / attenuations.length : 75
  let temperatureMinutes = 0
  let duration = 0
  for (const step of recipe.recipe_mash_steps ?? []) {
    if (!finite(step.temperature_c) || !finite(step.duration_minutes)) continue
    if (step.temperature_c >= 62 && step.temperature_c <= 72) {
      temperatureMinutes += step.temperature_c * step.duration_minutes
      duration += step.duration_minutes
    }
  }
  let attenuation = base
  if (duration >= 20) {
    const adjustment = Math.max(-0.143, Math.min(0.173, (67 - temperatureMinutes / duration) * 0.03))
    const durationPenalty = duration >= 30 ? 0 : (30 - duration) * 0.005
    attenuation *= 1 + adjustment - durationPenalty
  }
  attenuation = Math.max(50, Math.min(95, attenuation))
  return roundNumeric(originalGravity - ((originalGravity - 1) * attenuation) / 100, 3)
}

export function calculateAbv(og: number | null, fg: number | null): number | null {
  return og === null || fg === null ? null : roundNumeric((og - fg) * 131.25, 2)
}

export function whirlpoolUtilization(temperature: number | null | undefined): number {
  // SQL CASE falls through to 0.02 for NULL, rather than guessing 80°C.
  if (temperature == null) return 0.02
  if (temperature >= 95) return 0.75
  if (temperature >= 90) return 0.49
  if (temperature >= 85) return 0.36
  if (temperature >= 80) return 0.23
  if (temperature >= 75) return 0.165
  if (temperature >= 70) return 0.1
  if (temperature >= 65) return 0.07
  if (temperature >= 60) return 0.043
  return 0.02
}

export function calculateIbu(recipe: MetricRecipe, og?: number | null): number | null {
  const volume = validBatch(recipe)
  const originalGravity = og ?? calculateOg(recipe)
  if (volume === null || originalGravity === null || !finite(originalGravity)) return null
  const gravityFactor = 1.65 * 0.000125 ** (originalGravity - 1)
  let ibu = 0
  for (const addition of recipe.recipe_hops ?? []) {
    if (!addition.hops || !['boil', 'first_wort', 'whirlpool'].includes(addition.use_type)) continue
    const minutes = addition.use_type === 'first_wort' ? recipe.boil_time_minutes ?? 60 : addition.time_minutes
    if (minutes == null) continue
    const alpha = addition.alpha_acid_percent_override ?? addition.hops.alpha_acid_percent
    if (!finite(minutes) || !finite(addition.amount_grams) || !finite(alpha)) return null
    let utilization = (1 - Math.exp(-0.04 * minutes)) / 4.15
    if (addition.use_type === 'whirlpool') utilization *= whirlpoolUtilization(addition.temperature_c)
    if (addition.use_type === 'first_wort') utilization *= 1.1
    const form = addition.hops.form
    const formFactor = form === 'pellet' ? 1.1 : form === 'plug' ? 1.02 : 1
    ibu += (addition.amount_grams * 1000 * (alpha / 100) * utilization * gravityFactor * formFactor) / volume
  }
  return roundNumeric(ibu, 1)
}

export function calculateEbc(recipe: MetricRecipe): number | null {
  const volume = validBatch(recipe)
  if (volume === null) return null
  let mcu = 0
  for (const addition of recipe.recipe_grains ?? []) {
    const color = addition.grains?.color_ebc
    if (finite(addition.amount_kg) && finite(color)) mcu += (addition.amount_kg * color * 4.236) / volume
  }
  return mcu <= 0 ? 0 : roundNumeric(1.97 * 1.4922 * mcu ** 0.6859, 1)
}

export function calculateRecipe(recipe: MetricRecipe): RecipeCalculations {
  const og = calculateOg(recipe)
  const fg = calculateFg(recipe, og)
  return {
    calculated_og: og,
    calculated_fg: fg,
    calculated_abv: calculateAbv(og, fg),
    calculated_ibu: calculateIbu(recipe, og),
    calculated_ebc: calculateEbc(recipe),
  }
}
