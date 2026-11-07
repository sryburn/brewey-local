'use client'

import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

export default function DarkModeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  if (!mounted) {
    // Return a placeholder with the same dimensions to avoid layout shift
    return (
      <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-700" />
    )
  }

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-200 focus:outline-none bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
    >
      {/* Beer glass with different beer colors */}
      <div className="relative">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="transition-all duration-200">
          {/* Beer liquid - shows what you can switch TO */}
          <path 
            d="M8 6v11c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V6H8z" 
            className="transition-colors duration-200 fill-amber-900 dark:fill-amber-400"
          />
          
          {/* Beer foam on top */}
          <ellipse 
            cx="12" 
            cy="6" 
            rx="4" 
            ry="1" 
            fill="#f9fafb"
          />
          
          {/* Simple handle */}
          <path 
            d="M16 9h1c.55 0 1 .45 1 1v2c0 .55-.45 1-1 1h-1" 
            fill="#d1d5db"
          />
        </svg>
      </div>
    </button>
  )
} 