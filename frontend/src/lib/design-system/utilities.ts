/**
 * Brewey Design System - Theme Utilities
 * 
 * Helper functions and utilities for common theming patterns.
 * These make it easier to apply consistent styling across components.
 */

import { componentStyles, backgroundPatterns } from './components'

// Utility to combine multiple class strings, filtering out falsy values
export const cn = (...classes: (string | undefined | null | false)[]): string => {
  return classes.filter(Boolean).join(' ')
}

// Common theme-aware component builders
export const themeUtils = {
  // Card component builder
  card: (options: { 
    interactive?: boolean
    className?: string 
  } = {}) => {
    const { interactive = false, className = '' } = options
    const baseClasses = interactive 
      ? componentStyles.cardInteractive.combined
      : componentStyles.card.combined
    
    return cn(baseClasses, className)
  },

  // Button component builder
  button: (variant: 'primary' | 'secondary' | 'danger' | 'icon' = 'primary', className?: string) => {
    return cn(componentStyles.button[variant].combined, className)
  },

  // Input component builder
  input: (className?: string) => {
    return cn(componentStyles.input.combined, className)
  },

  // Text component builder
  text: (type: 'heading' | 'body' | 'small', variant: string, className?: string) => {
    const baseClass = componentStyles.text[type][variant as keyof typeof componentStyles.text[typeof type]]
    return cn(baseClass, className)
  },

  // Layout component builder
  layout: (type: keyof typeof componentStyles.layout, className?: string) => {
    return cn(componentStyles.layout[type], className)
  },

  // Status indicator builder
  status: (type: keyof typeof componentStyles.status, className?: string) => {
    return cn(componentStyles.status[type], className)
  },
}

// Background pattern utilities
export const backgroundUtils = {
  // Chat background with pattern (returns style object for inline styles)
  chatBackground: () => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    return {
      backgroundColor: isDark ? '#0f0a08' : '#fef7df',
      backgroundImage: isDark 
        ? `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23554433' fill-opacity='0.4' fill-rule='evenodd'/%3E%3C/svg%3E")`
        : `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23ffe073' fill-opacity='0.36' fill-rule='evenodd'/%3E%3C/svg%3E")`
    }
  },

  // Chat background classes (for Tailwind approach)
  chatClasses: 'bg-amber-50 dark:bg-stone-900',
  
  // Recipe background classes
  recipeClasses: 'bg-white dark:bg-gray-900',
}

// Scrollbar utilities (for components that need custom scrollbars)
export const scrollbarUtils = {
  // Chat input scrollbar
  chatInput: 'chat-input-scrollbar-dark',
  
  // Chat pane scrollbar
  chatPane: 'chat-pane-scrollbar-dark',
  
  // Recipe pane scrollbar
  recipePane: 'recipe-pane-scrollbar-dark',
  
}

// Animation utilities
export const animationUtils = {
  // Fade in animation (used for expandable ingredients)
  fadeIn: 'animate-recipeFadeIn',
  
  // Loading spinner
  spinner: 'animate-spin rounded-full border-b-2 border-blue-600 dark:border-amber-400',
  
  // Pulse animation for loading states
  pulse: 'animate-pulse',
}

// Common component combinations used throughout the app
export const componentCombos = {
  // Expandable card header (used in recipe ingredients)
  expandableCardHeader: cn(
    'flex justify-between items-center p-3 cursor-pointer transition-colors',
    'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
  ),

  // Expandable card content (used in recipe ingredients)
  expandableCardContent: cn(
    'px-3 pb-3 pt-1 border-t animate-recipeFadeIn',
    'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
  ),

  // Icon with rotation (used for expand/collapse arrows)
  expandIcon: (expanded: boolean) => cn(
    'w-4 h-4 transition-transform duration-200 text-gray-400',
    expanded ? 'rotate-180' : ''
  ),

  // Message bubble base (used in chat)
  messageBubble: cn(
    'rounded-lg p-4 max-w-[80%] break-words',
    'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
  ),

  // Form field wrapper
  formField: 'space-y-1',

  // Form label
  formLabel: 'block text-sm font-medium text-gray-700 dark:text-gray-300',

  // Error message
  errorMessage: 'text-sm text-red-600 dark:text-red-400',

  // Success message
  successMessage: 'text-sm text-green-600 dark:text-green-400',
}

// Responsive utilities
export const responsiveUtils = {
  // Container with responsive padding
  container: 'container mx-auto px-4 sm:px-6 lg:px-8',
  
  // Responsive grid
  grid: {
    cols1: 'grid grid-cols-1',
    cols2: 'grid grid-cols-1 md:grid-cols-2',
    cols3: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    cols4: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
    cols5: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5', // Used in calculations
  },
  
  // Responsive spacing
  spacing: {
    section: 'py-8 md:py-12 lg:py-16',
    element: 'mb-4 md:mb-6',
  },

  // Mobile-specific layout utilities
  mobile: {
    // Layout switching
    layout: {
      // Switch from row (desktop) to column (mobile) 
      dualToSingle: 'flex flex-col md:flex-row',
      // Single column mobile, dual column desktop
      singleColumn: 'flex flex-col',
      dualColumn: 'md:flex md:flex-row',
      // Panel sizing for mobile/desktop
      halfWidth: 'w-full md:w-1/2',
      fullWidth: 'w-full',
    },

    // Show/hide utilities for mobile elements
    visibility: {
      // Hide on mobile, show on desktop (max-md:hidden avoids hidden+md:* ordering issues in Tailwind v4)
      hideOnMobile: 'max-md:hidden md:flex',
      hideOnMobileBlock: 'max-md:hidden',
      hideOnMobileInline: 'max-md:hidden md:inline',
      // Show on mobile, hide on desktop
      showOnMobile: 'flex md:hidden',
      showOnMobileBlock: 'block md:hidden',
      showOnMobileInline: 'inline md:hidden',
    },

    // Mobile-specific sizing
    sizing: {
      // Mobile header height (condensed)
      headerHeight: 'h-12 md:h-20',
      // Mobile touch targets (minimum 44px for accessibility)
      touchTarget: 'min-h-[44px] min-w-[44px]',
      // Mobile safe spacing
      safeSpacing: 'p-3 md:p-4',
      safePadding: 'px-3 py-2 md:px-4 md:py-3',
    },

    // Mobile interaction states
    interactions: {
      // Touch-friendly hover states
      touchHover: 'active:bg-gray-100 dark:active:bg-gray-700 md:hover:bg-gray-50 md:dark:hover:bg-gray-800',
      // Tap target areas
      tapTarget: 'cursor-pointer select-none',
    },
  },
}

// Export everything for easy access
export {
  componentStyles,
  backgroundPatterns,
}