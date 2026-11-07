import { memo } from 'react'
import type { RecipeFermentationStep } from '@/types/database'
import { FermentationStepItem } from '../ingredient-items/fermentation-step-item'

// Custom conical fermenter icon
const FermenterIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <path d="M 5,21 V 5 C 5,3.8954305 5.8954305,3 7,3 h 10 c 1.104569,0 2,0.8954305 2,2 v 16" />
    <path d="M 5,13 V 5 C 5,3.8954305 5.8954305,3 7,3 h 10 c 1.104569,0 2,0.8954305 2,2 v 16" />
    <path d="M 19,13 12,20.862266 5,13 V 5 C 5,3.8954305 5.8954305,3 7,3 h 10 c 1.104569,0 2,0.8954305 2,2 z" />
  </svg>
)

interface FermentationStepsListProps {
  sortedFermentationSteps: RecipeFermentationStep[]
  expandedFermentationSteps: Set<string>
  toggleFermentationStepExpansion: (stepId: string) => void
  isMobileExpanded: boolean
}

export const FermentationStepsList = memo<FermentationStepsListProps>(({
  sortedFermentationSteps,
  expandedFermentationSteps,
  toggleFermentationStepExpansion,
  isMobileExpanded
}) => {
  return (
    <div
      className={`mb-6 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}
    >
      <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span className="text-gray-600 dark:text-gray-400" aria-hidden="true">
          <FermenterIcon />
        </span>
        <span>Fermentation</span>
        {!sortedFermentationSteps.length && (
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
            - No fermentation steps added
          </span>
        )}
      </h3>
      {sortedFermentationSteps.length > 0 && (
        <div className="space-y-2">
          {sortedFermentationSteps.map((fermentationStep) => (
            <FermentationStepItem
              key={fermentationStep.id}
              fermentationStep={fermentationStep}
              isExpanded={expandedFermentationSteps.has(fermentationStep.id)}
              onToggleExpansion={toggleFermentationStepExpansion}
            />
          ))}
        </div>
      )}
    </div>
  )
})

FermentationStepsList.displayName = 'FermentationStepsList'
