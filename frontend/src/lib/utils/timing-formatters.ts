/**
 * Timing formatting utilities for hop and misc ingredient display
 */

import type { RecipeHop, RecipeMisc } from '@/types/database'

/**
 * Format hop timing information for display
 * Examples:
 * - "dry hop for 3 days on day 4"
 * - "dry hop for 3 days" 
 * - "dry hop on day 4"
 * - "dry hop"
 * - "whirlpool 15 min @ 75°C"
 * - "boil 60 min"
 */
export function formatHopTiming(recipeHop: RecipeHop): string {
  const useType = recipeHop.use_type.replace(/_/g, ' ').toLowerCase()
  
  switch (recipeHop.use_type) {
    case 'dry_hop': {
      const duration = recipeHop.dry_hop_duration_days
      const startDay = recipeHop.dry_hop_start_day
      
      let timing = 'dry hop'
      if (duration && startDay) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''} on day ${startDay}`
      } else if (duration) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''}`
      } else if (startDay) {
        timing += ` on day ${startDay}`
      }
      return timing
    }
    
    case 'whirlpool': {
      let timing = `${useType} ${recipeHop.time_minutes} min`
      if (recipeHop.temperature_c != null) {
        timing += ` @ ${recipeHop.temperature_c}°C`
      }
      return timing
    }
    
    case 'first_wort':
      return useType // First wort uses recipe boil time automatically
      
    default:
      return `${useType} ${recipeHop.time_minutes} min`
  }
}

/**
 * Format misc ingredient timing information for display
 * Examples:
 * - "primary for 5 days on day 2"
 * - "primary for 5 days"
 * - "primary on day 2" 
 * - "primary"
 * - "boil 15 min"
 * - "bottling"
 */
export function formatMiscTiming(recipeMisc: RecipeMisc): string {
  const useType = recipeMisc.use_type.replace(/_/g, ' ').toLowerCase()
  
  switch (recipeMisc.use_type) {
    case 'primary':
    case 'secondary':
    case 'aging': {
      const duration = recipeMisc.duration_days
      const startDay = recipeMisc.start_day
      
      let timing = useType
      if (duration && startDay) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''} on day ${startDay}`
      } else if (duration) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''}`
      } else if (startDay) {
        timing += ` on day ${startDay}`
      }
      return timing
    }
    
    case 'mash':
    case 'boil': {
      if (recipeMisc.time_minutes != null) {
        return `${useType} ${recipeMisc.time_minutes} min`
      }
      return useType
    }
    
    case 'bottling':
    default:
      return useType
  }
}

/**
 * Format hop timing for print view
 * Examples:
 * - "Dry hop for 3 days on day 4"
 * - "Whirlpool 15min @ 75°C"
 * - "Boil 60min"
 */
export function formatHopTimingForPrint(recipeHop: RecipeHop): string {
  const useType = recipeHop.use_type === 'first_wort' ? 'First wort' : 
                  recipeHop.use_type === 'dry_hop' ? 'Dry hop' :
                  recipeHop.use_type.charAt(0).toUpperCase() + recipeHop.use_type.slice(1)
  
  switch (recipeHop.use_type) {
    case 'dry_hop': {
      const duration = recipeHop.dry_hop_duration_days
      const startDay = recipeHop.dry_hop_start_day
      
      let timing = useType
      if (duration && startDay) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''} on day ${startDay}`
      } else if (duration) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''}`
      } else if (startDay) {
        timing += ` on day ${startDay}`
      }
      return timing
    }
    
    case 'whirlpool': {
      let timing = `${useType} ${recipeHop.time_minutes}min`
      if (recipeHop.temperature_c != null) {
        timing += ` @ ${recipeHop.temperature_c}°C`
      }
      return timing
    }
    
    case 'first_wort':
      return useType
      
    default:
      return `${useType} ${recipeHop.time_minutes}min`
  }
}

/**
 * Format misc timing for print view
 * Examples:
 * - "Primary for 5 days on day 2"
 * - "Boil 15min"
 */
export function formatMiscTimingForPrint(recipeMisc: RecipeMisc): string {
  const useType = recipeMisc.use_type.charAt(0).toUpperCase() + recipeMisc.use_type.slice(1)
  
  switch (recipeMisc.use_type) {
    case 'primary':
    case 'secondary':
    case 'aging': {
      const duration = recipeMisc.duration_days
      const startDay = recipeMisc.start_day
      
      let timing = useType
      if (duration && startDay) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''} on day ${startDay}`
      } else if (duration) {
        timing += ` for ${duration} day${duration !== 1 ? 's' : ''}`
      } else if (startDay) {
        timing += ` on day ${startDay}`
      }
      return timing
    }
    
    case 'mash':
    case 'boil': {
      if (recipeMisc.time_minutes != null) {
        return `${useType} ${recipeMisc.time_minutes}min`
      }
      return useType
    }
    
    case 'bottling':
    default:
      return useType
  }
}

/**
 * Get sort priority for dry hop timing
 * Items without start day get priority 0 (sorted first)
 * Items with start day get their start day as priority
 */
export function getDryHopSortPriority(recipeHop: RecipeHop): number {
  if (recipeHop.use_type === 'dry_hop') {
    return recipeHop.dry_hop_start_day ?? 0
  }
  return 0
}

/**
 * Get sort priority for fermentation timing
 * Items without start day get priority 0 (sorted first)
 * Items with start day get their start day as priority
 */
export function getFermentationSortPriority(recipeMisc: RecipeMisc): number {
  if (recipeMisc.use_type === 'primary' || recipeMisc.use_type === 'secondary' || recipeMisc.use_type === 'aging') {
    return recipeMisc.start_day ?? 0
  }
  return 0
}
