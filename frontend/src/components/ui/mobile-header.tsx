'use client'

import Image from 'next/image'
import { responsiveUtils } from '@/lib/design-system'
import { RecipeSelector } from '@/components/ui/recipe-selector'

interface MobileHeaderProps {
  onMenuToggle: () => void
  isMenuOpen: boolean
  // Recipe selector props
  selectedRecipeId?: string
  userRecipes?: Array<{id: string, name: string}>
  onRecipeChange?: (recipeId: string) => void
}

export default function MobileHeader({ onMenuToggle, isMenuOpen, selectedRecipeId, userRecipes, onRecipeChange }: MobileHeaderProps) {
  // Hard guard: never render on desktop to avoid duplicate header glitches from CSS interactions
  if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
    return null
  }
  return (
    <div className={`${responsiveUtils.mobile.visibility.showOnMobileBlock} md:hidden block flex-shrink-0 px-4 border-b bg-white border-gray-200 dark:bg-gray-950 dark:border-gray-800`}>
      <div className={`flex items-center justify-between ${responsiveUtils.mobile.sizing.headerHeight}`}>
        {/* Condensed Logo */}
        <div className="h-8">
          <Image
            src="/brewey-logo-light.webp"
            alt="Brewey Logo"
            height={32}
            width={120}
            className="object-contain h-full w-auto transition-all duration-200 dark:hidden"
            priority
          />
          <Image
            src="/brewey-logo-dark.webp"
            alt="Brewey Logo"
            height={32}
            width={120}
            className="object-contain transition-all duration-200 hidden dark:block"
            style={{ height: '100%' }}
            priority
          />
        </div>

        {/* Recipe Selector - Mobile Only */}
        {userRecipes && userRecipes.length > 0 && onRecipeChange && (
          <div className="flex-1 mx-4">
            <div className="relative bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                              <RecipeSelector
                  selectedRecipeId={selectedRecipeId || null}
                  userRecipes={userRecipes || []}
                  onRecipeChange={onRecipeChange!}
                  className="w-full bg-transparent border-none text-center text-sm font-medium text-gray-800 dark:text-gray-200 focus:outline-none appearance-none px-3 py-2 pr-8 rounded-lg"
                />
              <svg 
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        {/* Hamburger Menu Button */}
        <button
          onClick={onMenuToggle}
          className={`${responsiveUtils.mobile.sizing.touchTarget} ${responsiveUtils.mobile.interactions.touchHover} ${responsiveUtils.mobile.interactions.tapTarget} rounded-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors duration-200`}
          aria-label="Toggle menu"
          aria-expanded={isMenuOpen}
        >
{isMenuOpen ? (
            /* X Icon when menu is open */
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            /* Hamburger Icon when menu is closed */
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M0 6h24M0 12h24M0 18h24" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
} 