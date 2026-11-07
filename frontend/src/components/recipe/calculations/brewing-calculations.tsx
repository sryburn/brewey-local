import { memo } from 'react'
import type { RecipeCalculations } from '@/types/database'
import { ebcToHex, ebcToRgb, idealTextColorForBackground, borderHexForBackground } from '@/lib/beer-color'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { conversions } from '@/lib/utils/unit-conversion'

interface BrewingCalculationsProps {
  calculations: RecipeCalculations | null
  recipeLoading: boolean
  isMobileExpanded: boolean
}

export const BrewingCalculations = memo<BrewingCalculationsProps>(({
  calculations,
  recipeLoading,
  isMobileExpanded
}) => {
  const displayUnits = useRecipeStore((state) => state.displayUnits)
  
  return (
    <div className={`${
      !isMobileExpanded ? 'md:mb-6 mb-3' : 'mb-6'
    }`}>
      
      
      {/* Calculations Grid */}
      <div className={`${
        recipeLoading ? 'mb-6' : ''
      }`}>
        {recipeLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : calculations ? (
          <>
            <div className="grid grid-cols-6 gap-2 lg:gap-4 mb-4">
              <div className="p-2 lg:p-3 rounded-lg text-center bg-blue-50 dark:bg-blue-900 border border-blue-600 dark:border-blue-700">
                <div className="text-sm sm:text-base md:text-lg lg:text-xl font-bold text-blue-600 dark:text-blue-400">
                  {calculations.calculated_og || 'N/A'}
                </div>
                <div className="text-[9px] sm:text-[10px] md:text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  <span className="2xl:hidden">OG</span>
                  <span className="hidden 2xl:inline">Original Gravity</span>
                </div>
              </div>
              <div className="p-2 lg:p-3 rounded-lg text-center bg-orange-50 dark:bg-orange-900 border border-orange-600 dark:border-orange-700">
                <div className="text-sm sm:text-base md:text-lg lg:text-xl font-bold text-orange-600 dark:text-orange-400">
                  {calculations.calculated_fg || 'N/A'}
                </div>
                <div className="text-[9px] sm:text-[10px] md:text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  <span className="2xl:hidden">FG</span>
                  <span className="hidden 2xl:inline">Final Gravity</span>
                </div>
              </div>
              <div className="p-2 lg:p-3 rounded-lg text-center bg-yellow-50 dark:bg-yellow-900 border border-yellow-600 dark:border-yellow-700">
                <div className="text-sm sm:text-base md:text-lg lg:text-xl font-bold text-yellow-600 dark:text-yellow-400">
                  {calculations.calculated_abv == null ? 'N/A' : `${Number(calculations.calculated_abv).toFixed(1)}%`}
                </div>
                <div className="text-[9px] sm:text-[10px] md:text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">ABV</div>
              </div>
              <div className="p-2 lg:p-3 rounded-lg text-center bg-green-50 dark:bg-green-900 border border-green-600 dark:border-green-700">
                <div className="text-sm sm:text-base md:text-lg lg:text-xl font-bold text-green-600 dark:text-green-400">
                  {calculations.calculated_ibu || 'N/A'}
                </div>
                <div className="text-[9px] sm:text-[10px] md:text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">IBU</div>
              </div>
              <div className="p-2 lg:p-3 rounded-lg text-center bg-violet-50 dark:bg-violet-900 border border-violet-600 dark:border-violet-700">
                <div className="text-sm sm:text-base md:text-lg lg:text-xl font-bold text-violet-600 dark:text-violet-400">
                  {(() => {
                    const og = calculations.calculated_og
                    const ibu = calculations.calculated_ibu
                    if (og == null || ibu == null || og <= 1) return 'N/A'
                    const denom = (og - 1) * 1000
                    if (denom === 0) return 'N/A'
                    const ratio = ibu / denom
                    return ratio.toFixed(3)
                  })()}
                </div>
                <div className="text-[9px] sm:text-[10px] md:text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  <span className="2xl:hidden">IBU/OG</span>
                  <span className="hidden 2xl:inline">Bitterness Ratio</span>
                </div>
              </div>
              {(() => {
                // Get color value (EBC or SRM depending on user preference)
                const ebc = calculations.calculated_ebc
                const srm = calculations.calculated_srm
                
                // Determine which value to display based on user preference
                let colorValue: number | null = null
                let colorLabel: string
                let ebcForColor: number | null = null
                
                if (displayUnits === 'imperial') {
                  // User prefers imperial - show SRM
                  colorLabel = 'SRM'
                  if (srm !== undefined && srm !== null) {
                    // We have SRM from MCP
                    colorValue = srm
                    ebcForColor = conversions.srmToEbc(srm)
                  } else if (ebc !== undefined && ebc !== null) {
                    // Convert EBC to SRM (from DB query)
                    colorValue = conversions.ebcToSrm(ebc)
                    ebcForColor = ebc
                  }
                } else {
                  // User prefers metric - show EBC
                  colorLabel = 'EBC'
                  if (ebc !== undefined && ebc !== null) {
                    // We have EBC
                    colorValue = ebc
                    ebcForColor = ebc
                  } else if (srm !== undefined && srm !== null) {
                    // Convert SRM to EBC (from MCP imperial response)
                    colorValue = conversions.srmToEbc(srm)
                    ebcForColor = colorValue
                  }
                }
                
                if (!ebcForColor && ebcForColor !== 0) {
                  return (
                    <div className="p-2 lg:p-3 rounded-lg text-center bg-red-50 dark:bg-red-900 border border-red-600 dark:border-red-700">
                      <div className="text-lg lg:text-2xl font-bold text-red-600 dark:text-red-400">N/A</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">{colorLabel}</div>
                    </div>
                  )
                }
                const rgb = ebcToRgb(ebcForColor)
                const bg = ebcToHex(ebcForColor)
                const text = idealTextColorForBackground(rgb)
                const border = borderHexForBackground(rgb)
                return (
                  <div className="p-2 lg:p-3 rounded-lg text-center" style={{ backgroundColor: bg, border: `1px solid ${border}` }}>
                    <div className="text-sm sm:text-base md:text-lg lg:text-xl font-bold" style={{ color: text }}>
                      {Math.round(colorValue || 0)}
                    </div>
                    <div className="text-[9px] sm:text-[10px] md:text-xs whitespace-nowrap" style={{ color: text }}>{colorLabel}</div>
                  </div>
                )
              })()}
            </div>

            {/* Parameters moved to RecipeHeader */}
          </>
        ) : (
          <div className="text-center p-4 text-gray-500 dark:text-gray-400">
            No calculations available
          </div>
        )}
      </div>
    </div>
  )
})

BrewingCalculations.displayName = 'BrewingCalculations' 