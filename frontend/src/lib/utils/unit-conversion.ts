/**
 * Unit conversion utilities for metric/US Customary (imperial) units
 * 
 * Backend uses 'imperial' as identifier, frontend displays 'US Customary'
 */

export type UnitSystem = 'metric' | 'imperial'

/**
 * Conversion constants and functions
 */
export const conversions = {
  // Weight
  kgToLbs: (kg: number): number => kg * 2.20462,
  lbsToKg: (lbs: number): number => lbs / 2.20462,
  gramsToOz: (g: number): number => g * 0.035274,
  ozToGrams: (oz: number): number => oz / 0.035274,
  
  // Volume
  litersToGallons: (l: number): number => l * 0.264172,
  gallonsToLiters: (gal: number): number => gal / 0.264172,
  litersToQuarts: (l: number): number => l * 1.05669,
  quartsToLiters: (qt: number): number => qt / 1.05669,
  
  // Temperature
  celsiusToFahrenheit: (c: number): number => c * 9/5 + 32,
  fahrenheitToCelsius: (f: number): number => (f - 32) * 5/9,
  
  // Color
  ebcToSrm: (ebc: number): number => ebc * 0.508,
  srmToEbc: (srm: number): number => srm / 0.508,
  
  // Mash thickness (L/kg to qt/lb)
  mashThicknessToQtPerLb: (lPerKg: number): number => lPerKg * 0.479306,
  mashThicknessToLPerKg: (qtPerLb: number): number => qtPerLb / 0.479306,
}

/**
 * Detect which unit system data is in based on property names
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function detectUnitSystem(data: any): UnitSystem | null {
  if (!data || typeof data !== 'object') return null
  
  // Check for metric properties
  if ('amount_kg' in data || 'amount_grams' in data || 
      'temperature_c' in data || 'volume_liters' in data ||
      'batch_size_liters' in data || 'calculated_ebc' in data) {
    return 'metric'
  }
  
  // Check for imperial properties
  if ('amount_lb' in data || 'amount_oz' in data || 
      'temperature_f' in data || 'volume_gallons' in data ||
      'batch_size_gallons' in data || 'calculated_srm' in data) {
    return 'imperial'
  }
  
  return null
}

/**
 * Clear opposite unit properties to prevent stale data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearOppositeUnitProperties<T extends Record<string, any>>(
  obj: T, 
  unitSystem: UnitSystem
): T {
  const result = { ...obj }
  
  if (unitSystem === 'metric') {
    // Clear imperial properties
    delete result.amount_lb
    delete result.amount_oz
    delete result.temperature_f
    delete result.end_temperature_f
    delete result.volume_gallons
    delete result.batch_size_gallons
    delete result.mash_thickness_qt_per_lb
    delete result.calculated_srm
  } else {
    // Clear metric properties
    delete result.amount_kg
    delete result.amount_grams
    delete result.temperature_c
    delete result.end_temperature_c
    delete result.volume_liters
    delete result.batch_size_liters
    delete result.calculated_ebc
  }
  
  return result
}

/**
 * Get display label for unit system
 */
export function getUnitSystemLabel(unitSystem: UnitSystem): string {
  return unitSystem === 'metric' ? 'Metric' : 'US'
}

/**
 * Format weight for display
 */
export function formatWeight(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  userPreference: UnitSystem,
  precision: number = 1
): string {
  // Try user's preferred unit first (no conversion needed)
  if (userPreference === 'imperial') {
    if (item.amount_lb !== undefined && item.amount_lb !== null) {
      return `${(item.amount_lb as number).toFixed(precision)} lbs`
    }
    if (item.amount_oz !== undefined && item.amount_oz !== null) {
      return `${(item.amount_oz as number).toFixed(precision)} oz`
    }
  } else {
    if (item.amount_kg !== undefined && item.amount_kg !== null) {
      return `${(item.amount_kg as number).toFixed(precision)} kg`
    }
    if (item.amount_grams !== undefined && item.amount_grams !== null) {
      return `${(item.amount_grams as number).toFixed(precision)} g`
    }
  }
  
  // Fall back to conversion if needed
  if (userPreference === 'imperial') {
    if (item.amount_kg !== undefined && item.amount_kg !== null) {
      return `${conversions.kgToLbs(item.amount_kg as number).toFixed(precision)} lbs`
    }
    if (item.amount_grams !== undefined && item.amount_grams !== null) {
      return `${conversions.gramsToOz(item.amount_grams as number).toFixed(precision)} oz`
    }
  } else {
    if (item.amount_lb !== undefined && item.amount_lb !== null) {
      return `${conversions.lbsToKg(item.amount_lb as number).toFixed(precision)} kg`
    }
    if (item.amount_oz !== undefined && item.amount_oz !== null) {
      return `${conversions.ozToGrams(item.amount_oz as number).toFixed(precision)} g`
    }
  }
  
  return 'N/A'
}

/**
 * Format volume for display
 */
export function formatVolume(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  userPreference: UnitSystem,
  precision: number = 2
): string {
  // Try user's preferred unit first
  if (userPreference === 'imperial' && item.volume_gallons !== undefined && item.volume_gallons !== null) {
    return `${(item.volume_gallons as number).toFixed(precision)} gal`
  }
  if (userPreference === 'metric' && item.volume_liters !== undefined && item.volume_liters !== null) {
    return `${(item.volume_liters as number).toFixed(precision)} L`
  }
  
  // Fall back to conversion
  if (userPreference === 'imperial' && item.volume_liters !== undefined && item.volume_liters !== null) {
    return `${conversions.litersToGallons(item.volume_liters as number).toFixed(precision)} gal`
  }
  if (userPreference === 'metric' && item.volume_gallons !== undefined && item.volume_gallons !== null) {
    return `${conversions.gallonsToLiters(item.volume_gallons as number).toFixed(precision)} L`
  }
  
  return 'N/A'
}

/**
 * Format batch size for display
 */
export function formatBatchSize(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  userPreference: UnitSystem,
  precision: number = 1
): string {
  // Try user's preferred unit first
  if (userPreference === 'imperial' && item.batch_size_gallons !== undefined && item.batch_size_gallons !== null) {
    return `${(item.batch_size_gallons as number).toFixed(precision)} gal`
  }
  if (userPreference === 'metric' && item.batch_size_liters !== undefined && item.batch_size_liters !== null) {
    return `${(item.batch_size_liters as number).toFixed(precision)} L`
  }
  
  // Fall back to conversion
  if (userPreference === 'imperial' && item.batch_size_liters !== undefined && item.batch_size_liters !== null) {
    return `${conversions.litersToGallons(item.batch_size_liters as number).toFixed(precision)} gal`
  }
  if (userPreference === 'metric' && item.batch_size_gallons !== undefined && item.batch_size_gallons !== null) {
    return `${conversions.gallonsToLiters(item.batch_size_gallons as number).toFixed(precision)} L`
  }
  
  return 'N/A'
}

/**
 * Format temperature for display
 */
export function formatTemperature(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  userPreference: UnitSystem,
  precision: number = 0
): string {
  // Try user's preferred unit first
  if (userPreference === 'imperial' && item.temperature_f !== undefined && item.temperature_f !== null) {
    return `${(item.temperature_f as number).toFixed(precision)}°F`
  }
  if (userPreference === 'metric' && item.temperature_c !== undefined && item.temperature_c !== null) {
    return `${(item.temperature_c as number).toFixed(precision)}°C`
  }
  
  // Fall back to conversion
  if (userPreference === 'imperial' && item.temperature_c !== undefined && item.temperature_c !== null) {
    return `${Math.round(conversions.celsiusToFahrenheit(item.temperature_c as number))}°F`
  }
  if (userPreference === 'metric' && item.temperature_f !== undefined && item.temperature_f !== null) {
    return `${Math.round(conversions.fahrenheitToCelsius(item.temperature_f as number))}°C`
  }
  
  return 'N/A'
}

/**
 * Format temperature range for display (used in fermentation steps)
 */
export function formatTemperatureRange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  userPreference: UnitSystem
): string {
  const startTemp = formatTemperature(item, userPreference, 0)
  
  // Check for end temperature
  const hasEndTemp = (item.end_temperature_c !== undefined && item.end_temperature_c !== null) ||
                     (item.end_temperature_f !== undefined && item.end_temperature_f !== null)
  
  if (!hasEndTemp) {
    return startTemp
  }
  
  // Format end temperature
  let endTemp: string
  if (userPreference === 'imperial' && item.end_temperature_f !== undefined && item.end_temperature_f !== null) {
    endTemp = `${Math.round(item.end_temperature_f as number)}°F`
  } else if (userPreference === 'metric' && item.end_temperature_c !== undefined && item.end_temperature_c !== null) {
    endTemp = `${Math.round(item.end_temperature_c as number)}°C`
  } else if (userPreference === 'imperial' && item.end_temperature_c !== undefined && item.end_temperature_c !== null) {
    endTemp = `${Math.round(conversions.celsiusToFahrenheit(item.end_temperature_c as number))}°F`
  } else if (userPreference === 'metric' && item.end_temperature_f !== undefined && item.end_temperature_f !== null) {
    endTemp = `${Math.round(conversions.fahrenheitToCelsius(item.end_temperature_f as number))}°C`
  } else {
    return startTemp
  }
  
  return `${startTemp} → ${endTemp}`
}

/**
 * Format mash thickness for display
 */
export function formatMashThickness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  userPreference: UnitSystem,
  precision: number = 1
): string {
  // Try user's preferred unit first
  if (userPreference === 'imperial' && item.mash_thickness_qt_per_lb !== undefined && item.mash_thickness_qt_per_lb !== null) {
    return `${(item.mash_thickness_qt_per_lb as number).toFixed(precision)} qt/lb`
  }
  if (userPreference === 'metric' && item.mash_thickness !== undefined && item.mash_thickness !== null) {
    return `${(item.mash_thickness as number).toFixed(precision)} L/kg`
  }
  
  // Fall back to conversion
  if (userPreference === 'imperial' && item.mash_thickness !== undefined && item.mash_thickness !== null) {
    return `${conversions.mashThicknessToQtPerLb(item.mash_thickness as number).toFixed(precision)} qt/lb`
  }
  if (userPreference === 'metric' && item.mash_thickness_qt_per_lb !== undefined && item.mash_thickness_qt_per_lb !== null) {
    return `${conversions.mashThicknessToLPerKg(item.mash_thickness_qt_per_lb as number).toFixed(precision)} L/kg`
  }
  
  return 'N/A'
}

/**
 * Format color for display
 */
export function formatColor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  userPreference: UnitSystem
): string {
  // Try user's preferred unit first
  if (userPreference === 'imperial' && item.calculated_srm !== undefined && item.calculated_srm !== null) {
    return `${Math.round(item.calculated_srm as number)} SRM`
  }
  if (userPreference === 'metric' && item.calculated_ebc !== undefined && item.calculated_ebc !== null) {
    return `${Math.round(item.calculated_ebc as number)} EBC`
  }
  
  // Fall back to conversion
  if (userPreference === 'imperial' && item.calculated_ebc !== undefined && item.calculated_ebc !== null) {
    return `${Math.round(conversions.ebcToSrm(item.calculated_ebc as number))} SRM`
  }
  if (userPreference === 'metric' && item.calculated_srm !== undefined && item.calculated_srm !== null) {
    return `${Math.round(conversions.srmToEbc(item.calculated_srm as number))} EBC`
  }
  
  return 'N/A'
}

/**
 * Get numeric value for temperature (for calculations/comparisons)
 */
export function getTemperatureValue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  preferredUnit: UnitSystem = 'metric'
): number | null {
  if (preferredUnit === 'metric') {
    if (item.temperature_c !== undefined && item.temperature_c !== null) {
      return item.temperature_c as number
    }
    if (item.temperature_f !== undefined && item.temperature_f !== null) {
      return conversions.fahrenheitToCelsius(item.temperature_f as number)
    }
  } else {
    if (item.temperature_f !== undefined && item.temperature_f !== null) {
      return item.temperature_f as number
    }
    if (item.temperature_c !== undefined && item.temperature_c !== null) {
      return conversions.celsiusToFahrenheit(item.temperature_c as number)
    }
  }
  
  return null
}

/**
 * Get numeric value for weight (for calculations/comparisons)
 */
export function getWeightValue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  preferredUnit: UnitSystem = 'metric'
): number | null {
  if (preferredUnit === 'metric') {
    if (item.amount_kg !== undefined && item.amount_kg !== null) {
      return item.amount_kg as number
    }
    if (item.amount_grams !== undefined && item.amount_grams !== null) {
      return item.amount_grams as number
    }
    if (item.amount_lb !== undefined && item.amount_lb !== null) {
      return conversions.lbsToKg(item.amount_lb as number)
    }
    if (item.amount_oz !== undefined && item.amount_oz !== null) {
      return conversions.ozToGrams(item.amount_oz as number)
    }
  } else {
    if (item.amount_lb !== undefined && item.amount_lb !== null) {
      return item.amount_lb as number
    }
    if (item.amount_oz !== undefined && item.amount_oz !== null) {
      return item.amount_oz as number
    }
    if (item.amount_kg !== undefined && item.amount_kg !== null) {
      return conversions.kgToLbs(item.amount_kg as number)
    }
    if (item.amount_grams !== undefined && item.amount_grams !== null) {
      return conversions.gramsToOz(item.amount_grams as number)
    }
  }
  
  return null
}

