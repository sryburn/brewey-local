import { memo } from 'react'
import { Droplets } from 'lucide-react'
import type { RecipeWater } from '@/types/database'
import { WaterItem } from '../ingredient-items/water-item'

interface WaterListProps {
  sortedWater: RecipeWater[]
  expandedWater: Set<string>
  toggleWaterExpansion: (waterId: string) => void
  isMobileExpanded: boolean
}

export const WaterList = memo<WaterListProps>(({
  sortedWater,
  expandedWater,
  toggleWaterExpansion,
  isMobileExpanded
}) => {
  return (
    <div
      className={`mb-6 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}
    >
      <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <Droplets className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        <span>Water</span>
        {!sortedWater.length && (
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
            - No water profiles added
          </span>
        )}
      </h3>
      {sortedWater.length > 0 && (
        <div className="space-y-2">
          {sortedWater.map((recipeWater) => (
            <WaterItem
              key={recipeWater.id}
              recipeWater={recipeWater}
              isExpanded={expandedWater.has(recipeWater.id)}
              onToggleExpansion={toggleWaterExpansion}
            />
          ))}
        </div>
      )}
    </div>
  )
})

WaterList.displayName = 'WaterList'
