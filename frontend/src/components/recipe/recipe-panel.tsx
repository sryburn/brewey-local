'use client'

import { useEffect, useCallback, useRef, useMemo } from 'react'
import Image from 'next/image'

import { useRecipeStore } from '@/lib/stores/recipe-store'
import { getDryHopSortPriority, getFermentationSortPriority } from '@/lib/utils/timing-formatters'
import { useMobile } from '@/lib/hooks/useMobile'
import { GrainsList, HopsList, YeastsList, MiscList, WaterList, MashStepsList, FermentationStepsList } from './ingredient-lists'
import { BrewingCalculations } from './calculations/brewing-calculations'
import { RecipeHeader } from './header/recipe-header'
import { RecipeNotes } from './notes/recipe-notes'

interface RecipePanelProps {
  onRecipeSelected?: (recipeId: string) => void
}

const RecipePanel = ({ onRecipeSelected }: RecipePanelProps) => {
  
  // Replace useReducer with Zustand store subscriptions
  const {
    // Data
    userRecipes,
    selectedRecipeId,
    recipeMetadata,
    grains,
    hops,
    yeasts,
    misc,
    water,
    mashSteps,
    fermentationSteps,
    calculations,
    loading,
    recipeLoading,
    // UI State
    expandedGrains,
    expandedHops,
    expandedYeasts,
    expandedMisc,
    expandedWater,
    expandedMashSteps,
    expandedFermentationSteps,
    expandedBrewingNotes,
    expandedTastingNotes,
    isMobileExpanded,
    // Actions
    loadRecipeDetails,
    setSelectedRecipe,
    toggleGrainExpansion,
    toggleHopExpansion,
    toggleYeastExpansion,
    toggleMiscExpansion,
    toggleWaterExpansion,
    toggleMashStepExpansion,
    toggleFermentationStepExpansion,
    toggleBrewingNotesExpansion,
    toggleTastingNotesExpansion,
    updateRecipeMetadata,
    setMobileExpanded
  } = useRecipeStore()
  
  // Ref for the actual scrollable container (inner panel area)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const isMobile = useMobile()

  // =============================================================================
  // REFS & COMPUTED VALUES
  // =============================================================================
  
  // Track previous mobile state to detect actual transitions
  const prevMobileRef = useRef(isMobile)

  // Memoized sorted ingredient arrays (for performance)
  const sortedGrains = useMemo(() => 
    grains.sort((a, b) => b.amount_kg - a.amount_kg), // Descending by weight
    [grains]
  )
  
  const sortedHops = useMemo(() => {
    const hopSortPriority = {
      'mash': 1,
      'first_wort': 2,
      'boil': 3,
      'whirlpool': 4,
      'dry_hop': 5
    } as const
    
    return hops.sort((a, b) => {
      const priorityA = hopSortPriority[a.use_type as keyof typeof hopSortPriority] || 999
      const priorityB = hopSortPriority[b.use_type as keyof typeof hopSortPriority] || 999
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB
      }
      
      // Within same use type, sort by time
      if (a.use_type === 'boil' || a.use_type === 'first_wort' || a.use_type === 'whirlpool') {
        // For boil and whirlpool, higher time first (60min before 30min)
        return b.time_minutes - a.time_minutes
      } else if (a.use_type === 'dry_hop') {
        // For dry hop, sort by start day (items without start day first)
        return getDryHopSortPriority(a) - getDryHopSortPriority(b)
      } else {
        // For mash, lower time first
        return a.time_minutes - b.time_minutes
      }
    })
  }, [hops])
  
  const sortedYeasts = useMemo(() => 
    yeasts.sort((a, b) => (a.yeasts?.name || '').localeCompare(b.yeasts?.name || '')), // Alphabetically by name
    [yeasts]
  )
  
  const sortedMisc = useMemo(() => {
    const miscSortPriority = {
      'mash': 1,
      'boil': 2,
      'primary': 3,
      'secondary': 4,
      'bottling': 5,
      'aging': 6
    } as const
    
    return misc.sort((a, b) => {
      const priorityA = miscSortPriority[a.use_type as keyof typeof miscSortPriority] || 999
      const priorityB = miscSortPriority[b.use_type as keyof typeof miscSortPriority] || 999
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB
      }
      
      // Within same use type, sort appropriately
      if (a.use_type === 'primary' || a.use_type === 'secondary' || a.use_type === 'aging') {
        // For fermentation stages, sort by start day (items without start day first)
        const startDayA = getFermentationSortPriority(a)
        const startDayB = getFermentationSortPriority(b)
        if (startDayA !== startDayB) {
          return startDayA - startDayB
        }
      }
      
      // Default sort by name
      return (a.misc_ingredients?.name || '').localeCompare(b.misc_ingredients?.name || '')
    })
  }, [misc])

  const sortedWater = useMemo(() => 
    water.sort((a, b) => a.name.localeCompare(b.name)), // Alphabetically by name
    [water]
  )

  const sortedMashSteps = useMemo(() => 
    mashSteps.sort((a, b) => a.step_order - b.step_order), 
    [mashSteps]
  )
  
  const sortedFermentationSteps = useMemo(() => 
    fermentationSteps.sort((a, b) => a.step_order - b.step_order), 
    [fermentationSteps]
  )

  // =============================================================================
  // MOBILE & UI STATE MANAGEMENT
  // =============================================================================
  
  // Handle mobile/desktop transitions
  useEffect(() => {
    const wasMobile = prevMobileRef.current
    
    // Only handle transitions when mobile state actually changes
    if (isMobile !== wasMobile) {
      if (!isMobile && !isMobileExpanded) {
        // Mobile → Desktop (collapsed): Expand
        setMobileExpanded(true)
      } else if (isMobile && !wasMobile) {
        // Desktop → Mobile: Always collapse
        setMobileExpanded(false)
      }
    }
    
    // Update ref for next time
    prevMobileRef.current = isMobile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]) // Intentionally exclude isMobileExpanded to prevent expand/collapse flicker

  // Mobile toggle handlers (memoized for performance)
  const handleMobileToggle = useCallback(() => {
    const newExpanded = !isMobileExpanded
    // If expanding from collapsed, reset scroll position to ensure clean start (mobile only)
    if (newExpanded && scrollContainerRef.current && isMobile) {
      scrollContainerRef.current.scrollTop = 0
    }
    setMobileExpanded(newExpanded)
  }, [isMobile, isMobileExpanded, setMobileExpanded])

  const handleMobileCollapse = useCallback(() => {
    // Reset scroll position to top before collapsing to prevent misalignment (mobile only)
    if (scrollContainerRef.current && isMobile) {
      scrollContainerRef.current.scrollTop = 0
    }
    
    setMobileExpanded(false)
  }, [isMobile, setMobileExpanded])

  // =============================================================================
  // COMPONENT LIFECYCLE & EFFECTS
  // =============================================================================
  
  // Load recipe details when selection changes
  useEffect(() => {
    if (selectedRecipeId) {
      loadRecipeDetails(selectedRecipeId)
    }
  }, [selectedRecipeId, loadRecipeDetails])

  // =============================================================================
  // USER INTERACTION HANDLERS
  // =============================================================================
  
  const handleRecipeChange = useCallback((recipeId: string) => {
    setSelectedRecipe(recipeId)
    // Notify parent component about recipe selection
    onRecipeSelected?.(recipeId)
  }, [setSelectedRecipe, onRecipeSelected])

  // =============================================================================
  // RENDER
  // =============================================================================

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading your recipes...</p>
        </div>
      </div>
    )
  }

  if (userRecipes.length === 0) {
    // On mobile, hide the recipe panel entirely when there are no recipes
    if (isMobile) {
      return null
    }
    
    // On desktop, show the empty state with sad Brewey
    return (
      <div className="h-full flex items-center justify-center bg-stone-100 dark:bg-gray-900">
        <div className="text-center max-w-md px-4">
          <div className="mb-6">
            <Image
              src="/sad-brewey.png"
              alt="Sad Brewey - No recipes yet"
              width={120}
              height={120}
              className="mx-auto opacity-60"
            />
          </div>
          <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">No Recipes Yet</h3>
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            Start a chat with Brewey to create your first recipe.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div 
      className={`flex flex-col bg-stone-100 dark:bg-gray-900 transition-all duration-300 ease-in-out ${isMobile ? 'overflow-hidden' : ''} md:h-full md:relative absolute top-0 left-0 right-0 z-30`}
      style={{
        // Define CSS custom properties
        '--collapsed-recipe-height': '130px',
        '--mobile-header-height': '48px',
        // Use CSS custom properties for height calculation
        ...(isMobile && {
          height: isMobileExpanded 
            ? 'calc(100svh - var(--mobile-header-height, 48px) - var(--chat-input-height, 86px))'  // Expanded: small viewport height for mobile
            : 'var(--collapsed-recipe-height, 130px)'  // Collapsed: CSS custom property with fallback
        }),
        // Desktop uses fixed height
        ...(!isMobile && {
          height: '100%'
        })
      } as React.CSSProperties & Record<`--${string}`, string>}
    >
      {/* Recipe Content - Scrollable */}
      <div 
        className={`${
          isMobile && !isMobileExpanded 
            ? 'pt-4 px-4 pb-0' // No bottom padding when collapsed on mobile
            : 'p-4' // Normal padding otherwise
        } recipe-pane-scrollbar ${
          !isMobile || isMobileExpanded 
            ? 'flex-1 overflow-y-auto' 
            : 'flex-shrink-0'
        } ${
          isMobile && !isMobileExpanded ? 'cursor-pointer' : ''
        }`}
        style={{
          // When collapsed on mobile, hide overflow but use natural height
          ...(isMobile && !isMobileExpanded && {
            overflow: 'hidden'
          }),
          // Prevent parent/window from stealing scroll during keyboard interactions
          overscrollBehavior: 'contain'
        }}
        ref={scrollContainerRef}
        onClick={isMobile && !isMobileExpanded ? handleMobileToggle : undefined}
      >
        <div>
          {/* Recipe Header */}
          <RecipeHeader
            userRecipes={userRecipes}
            selectedRecipeId={selectedRecipeId}
            recipeMetadata={recipeMetadata}
            calculations={calculations}
            isMobileExpanded={isMobileExpanded}
            handleRecipeChange={handleRecipeChange}
          />

          {/* Calculations */}
          <BrewingCalculations
            calculations={calculations}
            recipeLoading={recipeLoading}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Grains */}
          <GrainsList
            sortedGrains={sortedGrains}
            expandedGrains={expandedGrains}
            toggleGrainExpansion={toggleGrainExpansion}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Hops */}
          <HopsList
            sortedHops={sortedHops}
            expandedHops={expandedHops}
            toggleHopExpansion={toggleHopExpansion}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Yeasts */}
          <YeastsList
            sortedYeasts={sortedYeasts}
            expandedYeasts={expandedYeasts}
            toggleYeastExpansion={toggleYeastExpansion}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Misc Ingredients */}
          <MiscList
            sortedMisc={sortedMisc}
            expandedMisc={expandedMisc}
            toggleMiscExpansion={toggleMiscExpansion}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Water */}
          <WaterList
            sortedWater={sortedWater}
            expandedWater={expandedWater}
            toggleWaterExpansion={toggleWaterExpansion}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Mash Steps */}
          <MashStepsList
            sortedMashSteps={sortedMashSteps}
            expandedMashSteps={expandedMashSteps}
            toggleMashStepExpansion={toggleMashStepExpansion}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Fermentation Steps */}
          <FermentationStepsList
            sortedFermentationSteps={sortedFermentationSteps}
            expandedFermentationSteps={expandedFermentationSteps}
            toggleFermentationStepExpansion={toggleFermentationStepExpansion}
            isMobileExpanded={isMobileExpanded}
          />

          {/* Recipe Notes */}
          <RecipeNotes
            recipeMetadata={recipeMetadata}
            isMobileExpanded={isMobileExpanded}
            isMobile={isMobile}
            expandedBrewingNotes={expandedBrewingNotes}
            expandedTastingNotes={expandedTastingNotes}
            toggleBrewingNotesExpansion={toggleBrewingNotesExpansion}
            toggleTastingNotesExpansion={toggleTastingNotesExpansion}
            onNotesUpdate={updateRecipeMetadata}
            scrollContainerRef={scrollContainerRef}
          />
        </div>
      </div>

      {/* Mobile Visual Indicator - Only visible on mobile */}
      <div className="md:hidden flex-shrink-0">
        
        {!isMobileExpanded ? (
          // Collapsed state: Clickable expand indicator
          <button
            onClick={handleMobileToggle}
            className="w-full flex items-center justify-center py-2 bg-stone-100 dark:bg-gray-900 transition-colors"
            aria-label="Expand recipe panel"
          >
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Expand
              </span>
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
        ) : (
          // Expanded state: Show collapse button as additional touch area
          <button
            onClick={handleMobileCollapse}
            className="w-full flex items-center justify-center py-2 bg-stone-100 dark:bg-gray-900 border-t border-stone-200 dark:border-gray-700 transition-colors"
            aria-label="Collapse recipe panel"
          >
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Collapse
              </span>
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </div>
          </button>
        )}
      </div>

    </div>
  )
}

export default RecipePanel 