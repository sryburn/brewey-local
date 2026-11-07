/**
 * Brewey Design System - Color Palette
 * 
 * Centralized color definitions extracted from existing components
 * to ensure consistency across the application.
 */

export const colors = {
  // Primary brand colors (amber/beer theme)
  primary: {
    50: '#fffbeb',
    100: '#fef3c7', 
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24', // Main amber color used throughout
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },

  // Secondary colors (blue for accents)
  secondary: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb', // Main blue used in auth and buttons
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },

  // Neutral grays (main UI colors)
  neutral: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },

  // Stone colors (used in dark theme)
  stone: {
    50: '#fafaf9',
    100: '#f5f5f4',
    200: '#e7e5e4',
    300: '#d6d3d1',
    400: '#a8a29e',
    500: '#78716c',
    600: '#57534e', // Used in dark scrollbars
    700: '#44403c',
    800: '#292524', // Used in dark backgrounds
    900: '#1c1917',
  },

  // Status colors
  success: {
    50: '#f0fdf4',
    100: '#dcfce7',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
  },

  error: {
    50: '#fef2f2',
    100: '#fee2e2',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
  },

  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },

  // Special background colors used in the app
  backgrounds: {
    // Chat panel backgrounds
    chatLight: '#fef7df', // Light cream background
    chatDark: '#0f0a08',  // Dark brown background
    
    // Recipe panel background
    recipeLight: '#ffffff',
    recipeDark: '#111827',
    
    // Main app background
    appLight: '#f9fafb',
    appDark: '#0a0a0a',
    
    // Header backgrounds
    headerLight: '#ffffff',
    headerDark: '#0a0a0a',
  },

  // Pattern colors for background textures
  patterns: {
    // Light theme pattern (yellow/amber dots)
    lightFill: '#ffe073',
    lightOpacity: '0.36',
    
    // Dark theme pattern (brown dots)
    darkFill: '#554433',
    darkOpacity: '0.4',
  },
} as const

// Type for color keys
export type ColorKey = keyof typeof colors
export type ColorShade = keyof typeof colors.primary

// Helper function to get color values
export const getColor = (color: ColorKey, shade?: ColorShade): string => {
  const colorValue = colors[color]
  
  if (shade && typeof colorValue === 'object' && colorValue !== null && shade in colorValue) {
    return (colorValue as Record<string, string>)[shade]
  }
  
  if (typeof colorValue === 'string') {
    return colorValue
  }
  
  // Fallback - return the first available value or empty string
  if (typeof colorValue === 'object' && colorValue !== null) {
    const firstKey = Object.keys(colorValue)[0]
    return (colorValue as Record<string, string>)[firstKey] || ''
  }
  
  return ''
}