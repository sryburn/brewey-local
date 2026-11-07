import { memo } from 'react'
import type { RecipeWithCalculations, RecipeMetadata, RecipeCalculations } from '@/types/database'
import { RecipeSelector } from '@/components/ui/recipe-selector'
import { StyleWarnings } from '@/components/recipe/style/style-warnings'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { formatBatchSize, formatMashThickness } from '@/lib/utils/unit-conversion'

interface RecipeHeaderProps {
  userRecipes: RecipeWithCalculations[]
  selectedRecipeId: string | null
  recipeMetadata: RecipeMetadata | null
  calculations: RecipeCalculations | null
  isMobileExpanded: boolean
  handleRecipeChange: (recipeId: string) => void
}

export const RecipeHeader = memo<RecipeHeaderProps>(({
  userRecipes,
  selectedRecipeId,
  recipeMetadata,
  calculations,
  isMobileExpanded,
  handleRecipeChange
}) => {
  const displayUnits = useRecipeStore((state) => state.displayUnits)
  
  return (
    <>
      {/* Recipe Selector - Top Left - Hidden on Mobile */}
      <div className="mb-4 max-md:hidden">
        <div 
          className="relative inline-flex items-center group rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Invisible select that covers the entire clickable area */}
          <RecipeSelector
            selectedRecipeId={selectedRecipeId}
            userRecipes={userRecipes}
            onRecipeChange={handleRecipeChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer focus:outline-none"
          />

          {/* Visible styled content */}
          <div className="flex items-center pointer-events-none">
            <span className="text-xl font-bold pr-2 text-gray-800 dark:text-gray-200">
              {recipeMetadata?.name || 'Loading...'}
            </span>
            <svg className="w-4 h-4 transition-colors text-gray-500 group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Recipe Description - Desktop always visible, mobile only when expanded */}
      <div className={`mb-4 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}>
        {recipeMetadata?.description ? (
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {recipeMetadata.description}
          </p>
        ) : null}
      </div>


      {/* Recipe Parameters - Under description */}
      <div className={`mb-4 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}>
        <div className="grid grid-cols-2 2xl:grid-cols-4 gap-x-[4.5rem] 2xl:gap-x-12 gap-y-2 text-sm text-gray-800 dark:text-gray-300">
          <div className="flex items-center justify-between 2xl:justify-start gap-2 whitespace-nowrap">
            <span>Batch Size:</span>
            <span className="font-bold">{recipeMetadata ? formatBatchSize(recipeMetadata, displayUnits) : 'N/A'}</span>
          </div>
          <div className="flex items-center justify-between 2xl:justify-start gap-2 whitespace-nowrap">
            <span>Boil Time:</span>
            <span className="font-bold">{recipeMetadata?.boil_time_minutes ?? 'N/A'} min</span>
          </div>
          <div className="flex items-center justify-between 2xl:justify-start gap-2 whitespace-nowrap">
            <span>Efficiency:</span>
            <span className="font-bold">{recipeMetadata?.efficiency_percent ?? 'N/A'}%</span>
          </div>
          <div className="flex items-center justify-between 2xl:justify-start gap-2 whitespace-nowrap">
            <span>Mash Thickness:</span>
            <span className="font-bold">{recipeMetadata ? formatMashThickness(recipeMetadata, displayUnits) : 'N/A'}</span>
          </div>
          {/* BJCP Style - Show in parameters section */}
          {recipeMetadata?.beer_style && (
            <div className="flex items-center gap-2 whitespace-nowrap col-span-2 2xl:col-span-4">
              <span>Style:</span>
              <span>
                <span className="font-bold">{recipeMetadata.beer_style.number} - {recipeMetadata.beer_style.name}</span> <span className="font-normal">({recipeMetadata.beer_style.category})</span>
              </span>
            </div>
          )}
        </div>
        
        {/* Style Warnings - Show below parameters */}
        {recipeMetadata?.beer_style && calculations && (
          <StyleWarnings 
            beerStyle={recipeMetadata.beer_style} 
            calculations={calculations} 
          />
        )}
      </div>
    </>
  )
})

RecipeHeader.displayName = 'RecipeHeader' 