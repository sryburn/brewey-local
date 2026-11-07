import { useState, useCallback } from 'react'
import type { BeerStyle, RecipeCalculations } from '@/types/database'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { conversions } from '@/lib/utils/unit-conversion'

interface StyleWarningsProps {
  beerStyle: BeerStyle
  calculations: RecipeCalculations
}

interface Warning {
  parameter: string
  message: string
}

export const StyleWarnings = ({ beerStyle, calculations }: StyleWarningsProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const displayUnits = useRecipeStore((state) => state.displayUnits)

  const generateWarnings = useCallback((): Warning[] => {
    const warnings: Warning[] = []

    // Helper function to format range
    const formatRange = (min: number | null, max: number | null, unit: string = '') => {
      if (min !== null && max !== null) {
        return `${min}${unit} - ${max}${unit}`
      } else if (min !== null) {
        return `${min}${unit}+`
      } else if (max !== null) {
        return `up to ${max}${unit}`
      }
      return 'N/A'
    }
    
    // Helper function to format gravity range (always 3 decimal places)
    const formatGravityRange = (min: number | null, max: number | null) => {
      if (min !== null && max !== null) {
        return `${min.toFixed(3)} - ${max.toFixed(3)}`
      } else if (min !== null) {
        return `${min.toFixed(3)}+`
      } else if (max !== null) {
        return `up to ${max.toFixed(3)}`
      }
      return 'N/A'
    }
    
    // Helper function to format color range (rounded to 1 decimal)
    const formatColorRange = (min: number | null, max: number | null, unit: string = '') => {
      if (min !== null && max !== null) {
        return `${min.toFixed(1)}${unit} - ${max.toFixed(1)}${unit}`
      } else if (min !== null) {
        return `${min.toFixed(1)}${unit}+`
      } else if (max !== null) {
        return `up to ${max.toFixed(1)}${unit}`
      }
      return 'N/A'
    }

    // Helper function to calculate percentage deviation and direction
    const getDeviationInfo = (value: number, min: number | null, max: number | null, isGravity: boolean = false): { deviation: string, direction: 'higher' | 'lower' | null } => {
      try {
        if (isGravity) {
          // For gravity values, convert to gravity points (subtract 1, multiply by 1000)
          const valuePoints = (value - 1) * 1000
          
          if (min !== null && value < min) {
            const minPoints = (min - 1) * 1000
            if (minPoints === 0) return { deviation: '0%', direction: null }
            const deviation = ((minPoints - valuePoints) / minPoints * 100).toFixed(0)
            return { deviation: `${deviation}%`, direction: 'lower' }
          }
          if (max !== null && value > max) {
            const maxPoints = (max - 1) * 1000
            if (maxPoints === 0) return { deviation: '0%', direction: null }
            const deviation = ((valuePoints - maxPoints) / maxPoints * 100).toFixed(0)
            return { deviation: `${deviation}%`, direction: 'higher' }
          }
        } else {
          // For non-gravity values, use the original calculation
          if (min !== null && value < min) {
            if (min === 0) return { deviation: '0%', direction: null }
            const deviation = ((min - value) / min * 100).toFixed(0)
            return { deviation: `${deviation}%`, direction: 'lower' }
          }
          if (max !== null && value > max) {
            if (max === 0) return { deviation: '0%', direction: null }
            const deviation = ((value - max) / max * 100).toFixed(0)
            return { deviation: `${deviation}%`, direction: 'higher' }
          }
        }
        return { deviation: '0%', direction: null }
      } catch (error) {
        console.warn('Error calculating deviation:', error)
        return { deviation: '0%', direction: null }
      }
    }

    // Check OG
    if (calculations.calculated_og !== null && (beerStyle.og_min !== null || beerStyle.og_max !== null)) {
      const og = calculations.calculated_og
      const min = beerStyle.og_min
      const max = beerStyle.og_max
      
      if ((min !== null && og < min) || (max !== null && og > max)) {
        const { deviation, direction } = getDeviationInfo(og, min, max, true)
        const range = formatGravityRange(min, max)
        warnings.push({
          parameter: 'OG',
          message: `OG is ${direction} than target by ${deviation}, should be ${range}`
        })
      }
    }

    // Check FG
    if (calculations.calculated_fg !== null && (beerStyle.fg_min !== null || beerStyle.fg_max !== null)) {
      const fg = calculations.calculated_fg
      const min = beerStyle.fg_min
      const max = beerStyle.fg_max
      
      if ((min !== null && fg < min) || (max !== null && fg > max)) {
        const { deviation, direction } = getDeviationInfo(fg, min, max, true)
        const range = formatGravityRange(min, max)
        warnings.push({
          parameter: 'FG',
          message: `FG is ${direction} than target by ${deviation}, should be ${range}`
        })
      }
    }

    // Check ABV
    if (calculations.calculated_abv !== null && (beerStyle.abv_min !== null || beerStyle.abv_max !== null)) {
      const abv = calculations.calculated_abv
      const min = beerStyle.abv_min
      const max = beerStyle.abv_max
      
      if ((min !== null && abv < min) || (max !== null && abv > max)) {
        const { deviation, direction } = getDeviationInfo(abv, min, max)
        const range = formatRange(min, max, '%')
        warnings.push({
          parameter: 'ABV',
          message: `ABV is ${direction} than target by ${deviation}, should be ${range}`
        })
      }
    }

    // Check IBU
    if (calculations.calculated_ibu !== null && (beerStyle.ibu_min !== null || beerStyle.ibu_max !== null)) {
      const ibu = calculations.calculated_ibu
      const min = beerStyle.ibu_min
      const max = beerStyle.ibu_max
      
      if ((min !== null && ibu < min) || (max !== null && ibu > max)) {
        const { deviation, direction } = getDeviationInfo(ibu, min, max)
        const range = formatRange(min, max)
        warnings.push({
          parameter: 'IBU',
          message: `IBU is ${direction} than target by ${deviation}, should be ${range}`
        })
      }
    }

    // Check color (EBC or SRM based on user preference)
    if (displayUnits === 'imperial') {
      // Use SRM values for imperial/US Customary users
      const srm = calculations.calculated_srm || (calculations.calculated_ebc ? conversions.ebcToSrm(calculations.calculated_ebc) : null)
      const minSrm = beerStyle.srm_min !== undefined && beerStyle.srm_min !== null 
        ? beerStyle.srm_min 
        : (beerStyle.ebc_min ? conversions.ebcToSrm(beerStyle.ebc_min) : null)
      const maxSrm = beerStyle.srm_max !== undefined && beerStyle.srm_max !== null
        ? beerStyle.srm_max
        : (beerStyle.ebc_max ? conversions.ebcToSrm(beerStyle.ebc_max) : null)
      
      if (srm !== null && ((minSrm !== null && srm < minSrm) || (maxSrm !== null && srm > maxSrm))) {
        const { deviation, direction } = getDeviationInfo(srm, minSrm, maxSrm)
        const range = formatColorRange(minSrm, maxSrm, ' SRM')
        warnings.push({
          parameter: 'SRM',
          message: `SRM is ${direction} than target by ${deviation}, should be ${range}`
        })
      }
    } else {
      // Use EBC values for metric users
      if (calculations.calculated_ebc !== null && (beerStyle.ebc_min !== null || beerStyle.ebc_max !== null)) {
        const ebc = calculations.calculated_ebc
        const min = beerStyle.ebc_min
        const max = beerStyle.ebc_max
        
        if ((min !== null && ebc < min) || (max !== null && ebc > max)) {
          const { deviation, direction } = getDeviationInfo(ebc, min, max)
          const range = formatColorRange(min, max, ' EBC')
          warnings.push({
            parameter: 'EBC',
            message: `EBC is ${direction} than target by ${deviation}, should be ${range}`
          })
        }
      }
    }

    return warnings
  }, [beerStyle, calculations, displayUnits])

  const warnings = generateWarnings()

  if (warnings.length === 0) {
    return null
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
      >
        {isExpanded ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
        Show style warnings ({warnings.length})
      </button>
      
      {isExpanded && (
        <div className="mt-2 space-y-1">
          {warnings.map((warning) => (
            <div
              key={`${warning.parameter}-${warning.message}`}
              className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded border-l-4 border-red-500"
            >
              {warning.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
