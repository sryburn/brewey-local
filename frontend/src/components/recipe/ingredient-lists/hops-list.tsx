import { memo } from 'react'
import { Hop } from 'lucide-react'
import type { RecipeHop } from '@/types/database'
import { HopItem } from '../ingredient-items'

interface HopsListProps {
  sortedHops: RecipeHop[]
  expandedHops: Set<string>
  toggleHopExpansion: (hopId: string) => void
  isMobileExpanded: boolean
}

export const HopsList = memo<HopsListProps>(({
  sortedHops,
  expandedHops,
  toggleHopExpansion,
  isMobileExpanded
}) => {
  return (
    <div
      className={`mb-6 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}
    >
      <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <Hop className="w-4 h-4 text-green-600 dark:text-green-400" aria-hidden="true" />
        <span>Hops</span>
        {!sortedHops.length && (
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
            - No hops added
          </span>
        )}
      </h3>
      {sortedHops.length > 0 && (
        <div className="space-y-2">
          {sortedHops.map((recipeHop) => (
            <HopItem
              key={recipeHop.id}
              recipeHop={recipeHop}
              isExpanded={expandedHops.has(recipeHop.id)}
              onToggleExpansion={toggleHopExpansion}
            />
          ))}
        </div>
      )}
    </div>
  )
})

HopsList.displayName = 'HopsList' 