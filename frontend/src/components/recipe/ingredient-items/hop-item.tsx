import { memo } from 'react'
import type { RecipeHop } from '@/types/database'
import { formatHopTiming } from '@/lib/utils/timing-formatters'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { formatWeight, formatTemperature } from '@/lib/utils/unit-conversion'

interface HopItemProps {
  recipeHop: RecipeHop
  isExpanded: boolean
  onToggleExpansion: (id: string) => void
}

export const HopItem = memo<HopItemProps>(({
  recipeHop,
  isExpanded,
  onToggleExpansion
}) => {
  const hop = recipeHop.hops
  const displayUnits = useRecipeStore((state) => state.displayUnits)

  return (
    <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
      <div
        className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={() => onToggleExpansion(recipeHop.id)}
      >
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words mr-4">
            {hop?.name || 'Unknown hop'}
          </span>
          <span className="inline-flex items-center whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
            {hop?.hop_type && (
              <span className="text-xs font-normal border rounded px-2 py-0.5 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">{hop.hop_type}</span>
            )}
          </span>
        </div>
        <div className="text-right text-gray-800 dark:text-gray-200 whitespace-nowrap flex items-center justify-end">
          <div className="text-sm text-gray-600 dark:text-gray-400 mr-2 whitespace-nowrap">
            {formatHopTiming(recipeHop)}
          </div>
          <div className="font-medium mr-2 whitespace-nowrap">{formatWeight(recipeHop, displayUnits)}</div>
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
            {hop?.alpha_acid_percent !== undefined && hop?.alpha_acid_percent !== null && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Alpha Acid:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{hop.alpha_acid_percent}%</span>
              </div>
            )}
            {hop?.beta_acid_percent !== undefined && hop?.beta_acid_percent !== null && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Beta Acid:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{hop.beta_acid_percent}%</span>
              </div>
            )}
            {hop?.form && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Form:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{hop.form}</span>
              </div>
            )}
            {hop?.origin && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Origin:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{hop.origin}</span>
              </div>
            )}
            {recipeHop.use_type === 'dry_hop' && (recipeHop.dry_hop_duration_days || recipeHop.dry_hop_start_day) && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Dry Hop Schedule:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">
                  {recipeHop.dry_hop_duration_days && `${recipeHop.dry_hop_duration_days} day${recipeHop.dry_hop_duration_days !== 1 ? 's' : ''}`}
                  {recipeHop.dry_hop_duration_days && recipeHop.dry_hop_start_day && ' '}
                  {recipeHop.dry_hop_start_day && `starting day ${recipeHop.dry_hop_start_day}`}
                </span>
              </div>
            )}
            {recipeHop.use_type === 'whirlpool' && (recipeHop.temperature_c || recipeHop.temperature_f) && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Temperature:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{formatTemperature(recipeHop, displayUnits)}</span>
              </div>
            )}
            {hop?.notes && (
              <div className="col-span-2">
                <span className="font-medium text-gray-600 dark:text-gray-400">Notes:</span>
                <p className="ml-2 text-sm leading-relaxed text-gray-800 dark:text-gray-200">{hop.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

HopItem.displayName = 'HopItem' 