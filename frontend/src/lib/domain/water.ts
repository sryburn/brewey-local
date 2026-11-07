/**
 * Brewing water behavior compatible with brewing-water-calculator 2.0.0.
 * Analysis/coefficients adapted from Scott Ryburn's MIT library (see water.LICENSE).
 * The optimizer solves the same nonnegative least-squares problem synchronously.
 */
const ions = ['Ca', 'Mg', 'Na', 'SO4', 'Cl', 'HCO3'] as const
type Ion = typeof ions[number]
type Profile = Record<Ion, number>
const columns = [
  [232.8, 0, 0, 557.9, 0, 0], // Gypsum (CaSO4·2H2O)
  [272.6, 0, 0, 0, 482.3, 0], // Calcium chloride (CaCl2·2H2O)
  [0, 98.6, 0, 389.6, 0, 0], // Epsom salt (MgSO4·7H2O)
  [0, 0, 393.4, 0, 606.6, 0], // Table salt
  [0, 0, 273.6, 0, 0, 726.4], // Baking soda
]
const saltNames = ['Gypsum (CaSO4)', 'Calcium Chloride (CaCl2)', 'Epsom Salt (MgSO4)', 'Table Salt (NaCl)', 'Baking Soda (NaHCO3)']
const saltFields = ['gypsum_caso4_grams', 'calcium_chloride_cacl2_grams', 'epsom_salt_mgso4_grams', 'table_salt_nacl_grams', 'baking_soda_nahco3_grams'] as const
const ionFields = ['ca_ppm', 'mg_ppm', 'na_ppm', 'so4_ppm', 'cl_ppm', 'hco3_ppm'] as const
type IonField = typeof ionFields[number]
type StoredProfile = Record<IonField, number>
export type MetricWater = Partial<Record<IonField | `base_${IonField}` | 'volume_liters', number | null>>

export interface WaterCalculations {
  success: true
  salt_additions: Record<typeof saltFields[number], number>
  calculated_profile: StoredProfile
  deviations: StoredProfile
  total_salt_weight_grams: number
  water_analysis: {
    alkalinity_ppm: number
    residual_alkalinity: number
    sulfate_chloride_ratio: number
    sulfate_chloride_balance: string
    total_hardness_ppm: number
    effective_hardness_ppm: number
    color_range: string
  }
}

interface BrewingAnalysis {
  alkalinity: number
  residualAlkalinity: number
  sulfateChlorideRatio: number | null
  sulfateChlorideBalance: string
  totalHardness: number
  effectiveHardness: number
  colorRange: string
}

export interface WaterFailure {
  success: false
  error: string
  additions: Record<string, number>
  calculatedProfile: Profile
  deviations: Profile
  totalSaltWeight: 0
  brewingAnalysis: BrewingAnalysis
}

const display = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits || 0
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0)

function solve(matrix: number[][], rhs: number[]): number[] | null {
  const rows = matrix.map((row, i) => [...row, rhs[i]])
  for (let pivot = 0; pivot < rows.length; pivot++) {
    let best = pivot
    for (let i = pivot + 1; i < rows.length; i++) if (Math.abs(rows[i][pivot]) > Math.abs(rows[best][pivot])) best = i
    if (Math.abs(rows[best][pivot]) < 1e-10) return null
    ;[rows[pivot], rows[best]] = [rows[best], rows[pivot]]
    const divisor = rows[pivot][pivot]
    for (let j = pivot; j <= rows.length; j++) rows[pivot][j] /= divisor
    for (let i = 0; i < rows.length; i++) {
      if (i === pivot) continue
      const factor = rows[i][pivot]
      for (let j = pivot; j <= rows.length; j++) rows[i][j] -= factor * rows[pivot][j]
    }
  }
  return rows.map(row => row[rows.length])
}

/** Five salts mean only 32 active sets; exhaustive NNLS gives the global optimum. */
function optimize(needed: number[]): number[] {
  let best = [0, 0, 0, 0, 0]
  let bestError = dot(needed, needed)
  for (let mask = 1; mask < 32; mask++) {
    const active = columns.map((_, i) => i).filter(i => (mask & (1 << i)) !== 0)
    const matrix = active.map(i => active.map(j => dot(columns[i], columns[j])))
    const solution = solve(matrix, active.map(i => dot(columns[i], needed)))
    if (!solution || solution.some(value => value < -1e-12 || !Number.isFinite(value))) continue
    const candidate = [0, 0, 0, 0, 0]
    active.forEach((index, i) => { candidate[index] = Math.max(0, solution[i]) })
    const residual = needed.map((value, ion) => columns.reduce((sum, column, salt) => sum + column[ion] * candidate[salt], 0) - value)
    const error = dot(residual, residual)
    if (error < bestError) { best = candidate; bestError = error }
  }
  return best
}

export function calculateWaterAnalysis(profile: Profile): BrewingAnalysis {
  const alkalinity = profile.HCO3 * (50 / 61)
  const effectiveHardness = profile.Ca / 1.4 + profile.Mg / 1.7
  const residualAlkalinity = alkalinity - effectiveHardness
  const ratio = profile.Cl > 0 ? profile.SO4 / profile.Cl : null
  const sulfateChlorideBalance = ratio === null ? 'N/A (No Chloride)'
    : ratio < 0.4 ? 'Very Malty' : ratio < 0.6 ? 'Malty' : ratio < 0.8 ? 'Slightly Malty'
      : ratio < 1.2 ? 'Balanced' : ratio < 2 ? 'Slightly Bitter' : ratio < 3 ? 'Bitter' : 'Very Bitter'
  const colorRange = residualAlkalinity < 0 ? '2-8 EBC (Pilsner)'
    : residualAlkalinity < 50 ? '8-20 EBC (Pale)' : residualAlkalinity < 100 ? '20-35 EBC (Amber)'
      : residualAlkalinity < 150 ? '35-50 EBC (Brown)' : residualAlkalinity < 200 ? '50-60 EBC (Porter)'
        : residualAlkalinity < 250 ? '60-70 EBC (Stout)' : '50-70 EBC (Porter/Stout)*'
  return {
    alkalinity: display(alkalinity), residualAlkalinity: display(residualAlkalinity),
    sulfateChlorideRatio: ratio === null ? null : display(ratio, 2), sulfateChlorideBalance,
    totalHardness: display(profile.Ca + profile.Mg), effectiveHardness: display(effectiveHardness), colorRange,
  }
}

export function calculateWater(water: MetricWater): WaterCalculations | WaterFailure | null {
  // Zero is a known base value; null/undefined mean unknown and must not become RO.
  if (ionFields.some(field => water[`base_${field}`] == null)) return null
  const base = Object.fromEntries(ions.map((ion, i) => [ion, water[`base_${ionFields[i]}`]!])) as Profile
  const target = Object.fromEntries(ions.map((ion, i) => [ion, water[ionFields[i]] ?? 0])) as Profile
  const volume = water.volume_liters
  const errors: string[] = []
  if (typeof volume !== 'number' || !Number.isFinite(volume)) errors.push('volume must be a valid number')
  else if (volume <= 0) errors.push('volume must be positive')
  else if (volume < 0.1 || volume > 1000) errors.push('volume must be between 0.1 and 1000 liters')
  const limits: Record<Ion, number> = { Ca: 1000, Mg: 200, Na: 500, SO4: 2000, Cl: 1000, HCO3: 1000 }
  for (const [name, profile] of [['base', base], ['target', target]] as const) {
    for (const ion of ions) {
      if (!Number.isFinite(profile[ion])) errors.push(`${name} profile: ${ion} must be a valid number`)
      else if (profile[ion] < 0 || profile[ion] > limits[ion]) errors.push(`${name} profile: ${ion} must be between 0 and ${limits[ion]} ppm`)
    }
  }
  if (errors.length) return {
    success: false, error: `Input validation failed: ${errors.join(', ')}`,
    additions: Object.fromEntries(saltNames.map(name => [name, 0])), calculatedProfile: base,
    deviations: Object.fromEntries(ions.map(ion => [ion, 0])) as Profile,
    totalSaltWeight: 0, brewingAnalysis: calculateWaterAnalysis(base),
  }
  const additionsPerLiter = optimize(ions.map(ion => target[ion] - base[ion]))
  const preciseProfile = ions.map((ion, i) => base[ion] + columns.reduce((sum, column, j) => sum + column[i] * additionsPerLiter[j], 0))
  // Profile/deviations use precise amounts, even if displayed salt grams round to 0.
  const amounts = additionsPerLiter.map(value => Math.max(0, display(value * volume!)))
  const achieved = Object.fromEntries(ions.map((ion, i) => [ion, display(preciseProfile[i])])) as Profile
  const analysis = calculateWaterAnalysis(achieved)
  return {
    success: true,
    salt_additions: Object.fromEntries(saltFields.map((field, i) => [field, amounts[i]])) as WaterCalculations['salt_additions'],
    calculated_profile: Object.fromEntries(ionFields.map((field, i) => [field, achieved[ions[i]]])) as StoredProfile,
    deviations: Object.fromEntries(ionFields.map((field, i) => [field, display(preciseProfile[i] - target[ions[i]])])) as StoredProfile,
    total_salt_weight_grams: display(amounts.reduce((sum, grams) => sum + grams, 0)),
    water_analysis: {
      alkalinity_ppm: analysis.alkalinity, residual_alkalinity: analysis.residualAlkalinity,
      // The legacy MCP adapter converts the package's no-chloride null ratio to 0.
      sulfate_chloride_ratio: analysis.sulfateChlorideRatio ?? 0,
      sulfate_chloride_balance: analysis.sulfateChlorideBalance,
      total_hardness_ppm: analysis.totalHardness, effective_hardness_ppm: analysis.effectiveHardness,
      color_range: analysis.colorRange,
    },
  }
}
