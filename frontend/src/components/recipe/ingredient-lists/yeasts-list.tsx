import { memo } from 'react'
import { FlaskConical } from 'lucide-react'
import type { RecipeYeast } from '@/types/database'
import { YeastItem } from '../ingredient-items'

interface YeastsListProps {
  sortedYeasts: RecipeYeast[]
  expandedYeasts: Set<string>
  toggleYeastExpansion: (yeastId: string) => void
  isMobileExpanded: boolean
}

export const YeastsList = memo<YeastsListProps>(({
  sortedYeasts,
  expandedYeasts,
  toggleYeastExpansion,
  isMobileExpanded
}) => {
  return (
    <div
      className={`mb-6 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}
    >
      <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
        <span>Yeast</span>
        {!sortedYeasts.length && (
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
            - No yeast added
          </span>
        )}
      </h3>
      {sortedYeasts.length > 0 && (
        <div className="space-y-2">
          {sortedYeasts.map((recipeYeast) => (
            <YeastItem
              key={recipeYeast.id}
              recipeYeast={recipeYeast}
              isExpanded={expandedYeasts.has(recipeYeast.id)}
              onToggleExpansion={toggleYeastExpansion}
            />
          ))}
        </div>
      )}
    </div>
  )
})

YeastsList.displayName = 'YeastsList' 