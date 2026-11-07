import { memo, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { RecipeMashStep } from '@/types/database'
import { MashStepItem } from '../ingredient-items/mash-step-item'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { getTemperatureValue } from '@/lib/utils/unit-conversion'

// Custom mash paddle icon
const MashPaddleIcon = () => (
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
    <path d="M21.56 4.56a1.5 1.5 0 0 1 0 2.122l-.47.47a3 3 0 0 1-4.212-.03 3 3 0 0 1 0-4.243l.44-.44a1.5 1.5 0 0 1 2.121 0z" />
    <path d="m9 15 7.879-7.878" />
    <rect
      style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.747, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      width="5.236"
      height="7.628"
      x="14.45"
      y="3.118"
      transform="matrix(0.6237,0.7817,-0.7092,0.705,0,0)"
    />
  </svg>
)

interface MashStepsListProps {
  sortedMashSteps: RecipeMashStep[]
  expandedMashSteps: Set<string>
  toggleMashStepExpansion: (stepId: string) => void
  isMobileExpanded: boolean
}

export const MashStepsList = memo<MashStepsListProps>(({
  sortedMashSteps,
  expandedMashSteps,
  toggleMashStepExpansion,
  isMobileExpanded
}) => {
  const displayUnits = useRecipeStore((state) => state.displayUnits)
  
  // Calculate total mash time in conversion temperature range (62-72°C / 144-162°F)
  const conversionTime = useMemo(() => {
    return sortedMashSteps.reduce((total, step) => {
      // Get temperature in Celsius for comparison
      const tempC = getTemperatureValue(step, 'metric')
      if (tempC !== null && tempC >= 62 && tempC <= 72) {
        return total + step.duration_minutes
      }
      return total
    }, 0)
  }, [sortedMashSteps])

  // Show warning if there are mash steps but insufficient conversion time
  const showConversionWarning = sortedMashSteps.length > 0 && conversionTime < 20

  return (
    <div
      className={`mb-6 ${!isMobileExpanded ? 'max-md:hidden' : ''}`}
    >
      <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span className="text-orange-500 dark:text-orange-300" aria-hidden="true">
          <MashPaddleIcon />
        </span>
        <span>Mash</span>
        {!sortedMashSteps.length && (
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
            - No mash steps added
          </span>
        )}
      </h3>
      
      {/* Conversion time warning */}
      {showConversionWarning && (
        <div className="mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-orange-800 dark:text-orange-200">
              Warning: Mash must be between {displayUnits === 'imperial' ? '144-162°F' : '62-72°C'} for at least 20mins to calculate conversion. Using default values for FG and ABV calculations
            </div>
          </div>
        </div>
      )}

      {sortedMashSteps.length > 0 && (
        <div className="space-y-2">
          {sortedMashSteps.map((mashStep) => (
            <MashStepItem
              key={mashStep.id}
              mashStep={mashStep}
              isExpanded={expandedMashSteps.has(mashStep.id)}
              onToggleExpansion={toggleMashStepExpansion}
            />
          ))}
        </div>
      )}
    </div>
  )
})

MashStepsList.displayName = 'MashStepsList'
