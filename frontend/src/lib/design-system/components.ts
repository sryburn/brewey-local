/**
 * Brewey Design System - Component Utilities
 * 
 * Common styling patterns and component utilities using Tailwind classes.
 * These replace the verbose conditional styling throughout the app.
 */

// Common component styling patterns
export const componentStyles = {
  // Card components (used in recipe ingredients, chat messages, etc.)
  card: {
    base: 'rounded-lg overflow-hidden transition-all duration-300 ease-in-out',
    light: 'bg-white border border-gray-200',
    dark: 'bg-gray-800 border border-gray-700',
    combined: 'rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
  },

  // Interactive card (clickable/hoverable)
  cardInteractive: {
    base: 'rounded-lg overflow-hidden transition-all duration-300 ease-in-out cursor-pointer',
    light: 'bg-white hover:bg-gray-100 border border-gray-200',
    dark: 'bg-gray-800 hover:bg-gray-700 border border-gray-700',
    combined: 'rounded-lg overflow-hidden transition-all duration-300 ease-in-out cursor-pointer bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700',
  },

  // Button variants
  button: {
    // Primary button (main actions)
    primary: {
      base: 'px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed',
      light: 'text-white bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
      dark: 'text-white bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
      combined: 'px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed text-white bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    },
    
    // Secondary button (less prominent actions)
    secondary: {
      base: 'px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed',
      light: 'text-gray-700 bg-gray-100 hover:bg-gray-200 border-gray-300 hover:border-gray-400 focus:ring-amber-500',
      dark: 'text-stone-200 bg-stone-700 hover:bg-stone-600 border-stone-600 hover:border-stone-500 focus:ring-amber-500',
      combined: 'px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-stone-200 bg-gray-100 dark:bg-stone-700 hover:bg-gray-200 dark:hover:bg-stone-600 border-gray-300 dark:border-stone-600 hover:border-gray-400 dark:hover:border-stone-500 focus:ring-amber-500',
    },

    // Danger button (destructive actions)
    danger: {
      base: 'px-3 py-1.5 text-xs rounded-md border transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed',
      light: 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100 focus:ring-red-500',
      dark: 'bg-red-900 text-red-200 border-red-700 hover:bg-red-800 focus:ring-red-500',
      combined: 'px-3 py-1.5 text-xs rounded-md border transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed bg-red-50 dark:bg-red-900 text-red-600 dark:text-red-200 border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-800 focus:ring-red-500',
    },

    // Icon button (small, square buttons)
    icon: {
      base: 'flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed',
      light: 'bg-gray-200 hover:bg-gray-300 text-gray-700 focus:ring-amber-500',
      dark: 'bg-gray-700 hover:bg-gray-600 text-gray-200 focus:ring-amber-500',
      combined: 'flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 focus:ring-amber-500',
    },
  },

  // Input components
  input: {
    base: 'w-full border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:border-transparent transition-colors disabled:cursor-not-allowed',
    light: 'border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:ring-blue-500 disabled:bg-gray-100',
    dark: 'border-stone-600 bg-stone-700 text-stone-100 placeholder-stone-400 focus:ring-amber-500 disabled:bg-stone-800',
    combined: 'w-full border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:border-transparent transition-colors disabled:cursor-not-allowed border-gray-300 dark:border-stone-600 bg-white dark:bg-stone-700 text-gray-900 dark:!text-stone-100 placeholder-gray-500 dark:placeholder-stone-400 focus:ring-blue-500 dark:focus:ring-amber-500 disabled:bg-gray-100 dark:disabled:bg-stone-800',
  },

  // Text styles
  text: {
    // Headings
    heading: {
      h1: 'text-3xl font-bold text-gray-900 dark:text-gray-100',
      h2: 'text-lg font-semibold text-gray-800 dark:text-gray-200',
      h3: 'text-base font-medium text-gray-900 dark:text-gray-100',
    },
    
    // Body text
    body: {
      primary: 'text-gray-900 dark:text-gray-100',
      secondary: 'text-gray-600 dark:text-gray-400',
      muted: 'text-gray-500 dark:text-gray-500',
    },
    
    // Small text
    small: {
      primary: 'text-sm text-gray-800 dark:text-gray-200',
      secondary: 'text-sm text-gray-600 dark:text-gray-400',
      muted: 'text-xs text-gray-500 dark:text-gray-500',
    },
  },

  // Layout components
  layout: {
    // Main backgrounds
    appBackground: 'bg-gray-50 dark:bg-gray-900',
    
    // Panel backgrounds
    chatPanel: 'bg-amber-50 dark:bg-stone-900',
    recipePanel: 'bg-white dark:bg-gray-900',
    
    // Header
    header: 'bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800',
    
    // Dividers
    divider: 'border-gray-200 dark:border-gray-700',
  },

  // Status indicators
  status: {
    success: 'text-green-600 dark:text-green-400',
    error: 'text-red-600 dark:text-red-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    info: 'text-blue-600 dark:text-blue-400',
  },

  // Loading states
  loading: {
    spinner: 'animate-spin rounded-full border-b-2 border-blue-600 dark:border-amber-400',
    skeleton: 'animate-pulse bg-gray-200 dark:bg-gray-700 rounded',
  },
} as const

// Helper functions for common patterns
export const getButtonClasses = (variant: keyof typeof componentStyles.button) => {
  return componentStyles.button[variant].combined
}

export const getCardClasses = (interactive = false) => {
  return interactive ? componentStyles.cardInteractive.combined : componentStyles.card.combined
}

export const getTextClasses = (type: 'heading' | 'body' | 'small', variant: string) => {
  return componentStyles.text[type][variant as keyof typeof componentStyles.text[typeof type]]
}

// Background pattern utilities (for the complex chat/recipe backgrounds)
export const backgroundPatterns = {
  // Chat panel background with pattern
  chatBackground: (isDark: boolean) => ({
    backgroundColor: isDark ? '#0f0a08' : '#fef7df',
    backgroundImage: isDark 
      ? `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23554433' fill-opacity='0.4' fill-rule='evenodd'/%3E%3C/svg%3E")`
      : `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23ffe073' fill-opacity='0.36' fill-rule='evenodd'/%3E%3C/svg%3E")`
  }),
}