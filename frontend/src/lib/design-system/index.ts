/**
 * Brewey Design System
 * 
 * Centralized design system exports for consistent styling across the application.
 * This replaces scattered conditional styling with a systematic approach.
 */

// Export all color utilities
export * from './colors'

// Export all component utilities  
export * from './components'

// Export all theme utilities
export * from './utilities'

// Re-export commonly used utilities for convenience
export { 
  colors,
  getColor,
  type ColorKey,
  type ColorShade 
} from './colors'

export {
  componentStyles,
  getButtonClasses,
  getCardClasses,
  getTextClasses,
  backgroundPatterns
} from './components'

export {
  cn,
  themeUtils,
  backgroundUtils,
  scrollbarUtils,
  animationUtils,
  componentCombos,
  responsiveUtils
} from './utilities'