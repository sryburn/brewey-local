import { memo } from 'react'
import type { RecipeFermentationStep } from '@/types/database'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { formatTemperatureRange } from '@/lib/utils/unit-conversion'

interface FermentationStepItemProps {
  fermentationStep: RecipeFermentationStep
  isExpanded: boolean
  onToggleExpansion: (id: string) => void
}

export const FermentationStepItem = memo<FermentationStepItemProps>(({
  fermentationStep,
  isExpanded,
  onToggleExpansion
}) => {
  const displayUnits = useRecipeStore((state) => state.displayUnits)

  return (
    <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
      <div
        className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={() => onToggleExpansion(fermentationStep.id)}
      >
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words mr-4">
            {fermentationStep.name}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
            {formatTemperatureRange(fermentationStep, displayUnits)}
          </span>
          <span className="font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
            {fermentationStep.duration_days} {fermentationStep.duration_days === 1 ? 'day' : 'days'}
          </span>
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

      {isExpanded && fermentationStep.description && (
        <div className="px-3 pb-3 pt-1 border-t animate-recipeFadeIn border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">{fermentationStep.description}</p>
        </div>
      )}
    </div>
  )
})

FermentationStepItem.displayName = 'FermentationStepItem'
