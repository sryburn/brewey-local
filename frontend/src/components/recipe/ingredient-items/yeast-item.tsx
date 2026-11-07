import { memo } from 'react'
import type { RecipeYeast } from '@/types/database'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { conversions } from '@/lib/utils/unit-conversion'

interface YeastItemProps {
  recipeYeast: RecipeYeast
  isExpanded: boolean
  onToggleExpansion: (id: string) => void
}

export const YeastItem = memo<YeastItemProps>(({
  recipeYeast,
  isExpanded,
  onToggleExpansion
}) => {
  const yeast = recipeYeast.yeasts
  const displayUnits = useRecipeStore((state) => state.displayUnits)

  return (
    <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
      <div
        className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={() => onToggleExpansion(recipeYeast.id)}
      >
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words mr-4">
            {yeast?.name || 'Unknown yeast'}
          </span>
          <span className="inline-flex items-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
            {yeast?.yeast_type && (
              <span className="text-xs font-normal border rounded px-2 py-0.5 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">{yeast.yeast_type}</span>
            )}
          </span>
        </div>
        <div className="text-right text-gray-800 dark:text-gray-200 whitespace-nowrap flex items-center justify-end">
          {/* No time label for yeast, but keep alignment consistent */}
          <div className="font-medium mr-2 whitespace-nowrap">{recipeYeast.amount_units} {recipeYeast.unit_type}</div>
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
            {yeast?.laboratory && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Laboratory:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{yeast.laboratory}</span>
              </div>
            )}
            {yeast?.form && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Form:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{yeast.form}</span>
              </div>
            )}
            {yeast?.product_id && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Product ID:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{yeast.product_id}</span>
              </div>
            )}
            {yeast?.attenuation_percent !== undefined && yeast?.attenuation_percent !== null && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Attenuation:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{yeast.attenuation_percent}%</span>
              </div>
            )}
            {(yeast?.temperature_range_min !== undefined && yeast?.temperature_range_min !== null) || (yeast?.temperature_range_max !== undefined && yeast?.temperature_range_max !== null) ? (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Temperature:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">
                  {yeast.temperature_range_min !== undefined && yeast.temperature_range_min !== null && yeast.temperature_range_max !== undefined && yeast.temperature_range_max !== null
                    ? displayUnits === 'imperial'
                      ? `${Math.round(conversions.celsiusToFahrenheit(yeast.temperature_range_min))}°F - ${Math.round(conversions.celsiusToFahrenheit(yeast.temperature_range_max))}°F`
                      : `${yeast.temperature_range_min}°C - ${yeast.temperature_range_max}°C`
                    : yeast.temperature_range_min !== undefined && yeast.temperature_range_min !== null
                      ? displayUnits === 'imperial'
                        ? `${Math.round(conversions.celsiusToFahrenheit(yeast.temperature_range_min))}°F+`
                        : `${yeast.temperature_range_min}°C+`
                      : displayUnits === 'imperial'
                        ? `Up to ${Math.round(conversions.celsiusToFahrenheit(yeast.temperature_range_max!))}°F`
                        : `Up to ${yeast.temperature_range_max}°C`
                  }
                </span>
              </div>
            ) : null}
            {yeast?.notes && (
              <div className="col-span-2">
                <span className="font-medium text-gray-600 dark:text-gray-400">Notes:</span>
                <p className="ml-2 text-sm leading-relaxed text-gray-800 dark:text-gray-200">{yeast.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

YeastItem.displayName = 'YeastItem' 