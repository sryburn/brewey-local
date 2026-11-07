import { memo } from 'react'
import type { RecipeMisc } from '@/types/database'
import { formatMiscTiming } from '@/lib/utils/timing-formatters'

interface MiscItemProps {
  recipeMisc: RecipeMisc
  isExpanded: boolean
  onToggleExpansion: (id: string) => void
}

const formatIngredientType = (type: string) => {
  return type.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
}

const formatUseType = (useType: string) => {
  return useType.charAt(0).toUpperCase() + useType.slice(1)
}

export const MiscItem = memo<MiscItemProps>(({
  recipeMisc,
  isExpanded,
  onToggleExpansion
}) => {
  const miscIngredient = recipeMisc.misc_ingredients

  return (
    <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
      <div
        className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={() => onToggleExpansion(recipeMisc.id)}
      >
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words mr-4">
            {miscIngredient?.name || 'Unknown ingredient'}
          </span>
          <span className="inline-flex items-center whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
            {miscIngredient?.ingredient_type && (
              <span className="text-xs font-normal border rounded px-2 py-0.5 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">{formatIngredientType(miscIngredient.ingredient_type)}</span>
            )}
          </span>
        </div>
        <div className="text-right text-gray-800 dark:text-gray-200 whitespace-nowrap flex items-center justify-end">
          <div className="text-sm text-gray-600 dark:text-gray-400 mr-2 whitespace-nowrap">
            {formatMiscTiming(recipeMisc)}
          </div>
          <div className="font-medium mr-2 whitespace-nowrap">{recipeMisc.amount_units} {recipeMisc.unit_type}</div>
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
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Type:</span>
              <span className="ml-2 text-gray-800 dark:text-gray-200">
                {miscIngredient?.ingredient_type ? formatIngredientType(miscIngredient.ingredient_type) : 'N/A'}
              </span>
            </div>
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Use:</span>
              <span className="ml-2 text-gray-800 dark:text-gray-200">{formatUseType(recipeMisc.use_type)}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Amount:</span>
              <span className="ml-2 text-gray-800 dark:text-gray-200">
                {recipeMisc.amount_units} {recipeMisc.unit_type}
              </span>
            </div>
            {recipeMisc.time_minutes !== null && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Time:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">{recipeMisc.time_minutes} minutes</span>
              </div>
            )}
            {(recipeMisc.use_type === 'primary' || recipeMisc.use_type === 'secondary' || recipeMisc.use_type === 'aging') && 
             (recipeMisc.duration_days || recipeMisc.start_day) && (
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-400">Schedule:</span>
                <span className="ml-2 text-gray-800 dark:text-gray-200">
                  {recipeMisc.duration_days && `${recipeMisc.duration_days} day${recipeMisc.duration_days !== 1 ? 's' : ''}`}
                  {recipeMisc.duration_days && recipeMisc.start_day && ' '}
                  {recipeMisc.start_day && `starting day ${recipeMisc.start_day}`}
                </span>
              </div>
            )}
            {miscIngredient?.notes && (
              <div className="col-span-2">
                <span className="font-medium text-gray-600 dark:text-gray-400">Notes:</span>
                <p className="ml-2 text-sm leading-relaxed text-gray-800 dark:text-gray-200">{miscIngredient.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

MiscItem.displayName = 'MiscItem'
