import { memo } from 'react'
import { Wheat } from 'lucide-react'
import type { RecipeGrain } from '@/types/database'
import { GrainItem } from '../ingredient-items'

interface GrainsListProps {
  sortedGrains: RecipeGrain[]
  expandedGrains: Set<string>
  toggleGrainExpansion: (grainId: string) => void
  isMobileExpanded: boolean
}

export const GrainsList = memo<GrainsListProps>(({
  sortedGrains,
  expandedGrains,
  toggleGrainExpansion,
  isMobileExpanded
}) => {
  return (
    <div
      className={`mb-6 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}
    >
      <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <Wheat className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span>Fermentables</span>
        {!sortedGrains.length && (
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
            - No grains added
          </span>
        )}
      </h3>
      {sortedGrains.length > 0 && (
        <div className="space-y-2">
          {sortedGrains.map((recipeGrain) => (
            <GrainItem
              key={recipeGrain.id}
              recipeGrain={recipeGrain}
              isExpanded={expandedGrains.has(recipeGrain.id)}
              onToggleExpansion={toggleGrainExpansion}
            />
          ))}
        </div>
      )}
    </div>
  )
})

GrainsList.displayName = 'GrainsList' 