import { memo } from 'react'
import type { RecipeGrain } from '@/types/database'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { formatWeight } from '@/lib/utils/unit-conversion'

interface GrainItemProps {
  recipeGrain: RecipeGrain
  isExpanded: boolean
  onToggleExpansion: (id: string) => void
}

export const GrainItem = memo<GrainItemProps>(({
  recipeGrain,
  isExpanded,
  onToggleExpansion
}) => {
  const grain = recipeGrain.grains
  const displayUnits = useRecipeStore((state) => state.displayUnits)
  
  const formatLabel = (value?: string | null) => {
    if (!value) return ''
    return value
      .toString()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }

  return (
    <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
      <div
        className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={() => onToggleExpansion(recipeGrain.id)}
      >
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words mr-4">
            {grain?.name || 'Unknown grain'}
          </span>
          <span className="inline-flex items-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
            {grain?.grain_type ? (
              <span className="text-xs font-normal border rounded px-2 py-0.5 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                {formatLabel(grain.grain_type)}
              </span>
            ) : null}
          </span>
        </div>
        <div className="text-right text-gray-800 dark:text-gray-200 whitespace-nowrap flex items-center justify-end">
          <div className="font-medium mr-2 whitespace-nowrap">{formatWeight(recipeGrain, displayUnits)}</div>
          <svg
            className={`w-4 h-4 transition-transform duration-200 text-gray-400 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t animate-recipeFadeIn border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {grain?.color_ebc !== undefined && grain?.color_ebc !== null && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Color:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{grain.color_ebc} EBC</span>
              </div>
            )}
            {grain?.extract_potential !== undefined && grain?.extract_potential !== null && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Extract:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{grain.extract_potential}</span>
              </div>
            )}
            {grain?.must_mash !== undefined && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Must Mash:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{grain.must_mash ? 'Yes' : 'No'}</span>
              </div>
            )}
            {grain?.origin && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Origin:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{grain.origin}</span>
              </div>
            )}
            {grain?.notes && (
              <div className="col-span-2">
                <span className="font-medium text-gray-600 dark:text-gray-400">Notes:</span>
                <p className="ml-2 text-sm leading-relaxed text-gray-800 dark:text-gray-200">{grain.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

GrainItem.displayName = 'GrainItem' 