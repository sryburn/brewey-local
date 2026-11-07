import { memo, useState } from 'react'
import type { RecipeWater } from '@/types/database'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { formatVolume } from '@/lib/utils/unit-conversion'

interface WaterItemProps {
  recipeWater: RecipeWater
  isExpanded: boolean
  onToggleExpansion: (id: string) => void
}

export const WaterItem = memo<WaterItemProps>(({
  recipeWater,
  isExpanded,
  onToggleExpansion
}) => {
  const [activeTab, setActiveTab] = useState<'salts' | 'profiles' | 'analysis'>('salts')
  const displayUnits = useRecipeStore((state) => state.displayUnits)
  
  const formatPpm = (value: number | null, unit: string = 'ppm') => {
    if (value === null || value === undefined) return '—'
    return `${value} ${unit}`
  }

  const formatGrams = (value: number) => {
    return `${value.toFixed(1)}g`
  }

  const formatDeviation = (value: number) => {
    const sign = value >= 0 ? '+' : ''
    const color = Math.abs(value) > 5 ? 'text-orange-600' : 'text-gray-500'
    return <span className={`${color} text-xs`}>{sign}{value.toFixed(1)}</span>
  }

  const hasCalculations = recipeWater.water_calculations?.success
  const calcs = recipeWater.water_calculations

  return (
    <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
      <div
        className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
        onClick={() => onToggleExpansion(recipeWater.id)}
      >
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words mr-4">
            {recipeWater.name}
          </span>
        </div>
        <div className="text-right text-gray-800 dark:text-gray-200 whitespace-nowrap flex items-center justify-end">
          <div className="font-medium mr-2 whitespace-nowrap">{formatVolume(recipeWater, displayUnits)}</div>
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
          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 dark:border-gray-600 mb-3 -mx-1">
            <button
              onClick={() => setActiveTab('salts')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === 'salts'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Salt Additions
            </button>
            <button
              onClick={() => setActiveTab('profiles')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === 'profiles'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Profiles
            </button>
            <button
              onClick={() => setActiveTab('analysis')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === 'analysis'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Analysis
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'salts' && (
            <div className="space-y-3">
              {hasCalculations && calcs ? (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                  <div className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                    Required Salt Additions ({formatGrams(calcs.total_salt_weight_grams)} total)
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    {calcs.salt_additions.gypsum_caso4_grams > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-700 dark:text-gray-300">Gypsum (CaSO₄):</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{formatGrams(calcs.salt_additions.gypsum_caso4_grams)}</span>
                      </div>
                    )}
                    {calcs.salt_additions.calcium_chloride_cacl2_grams > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-700 dark:text-gray-300">Calcium Chloride (CaCl₂):</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{formatGrams(calcs.salt_additions.calcium_chloride_cacl2_grams)}</span>
                      </div>
                    )}
                    {calcs.salt_additions.epsom_salt_mgso4_grams > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-700 dark:text-gray-300">Epsom Salt (MgSO₄):</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{formatGrams(calcs.salt_additions.epsom_salt_mgso4_grams)}</span>
                      </div>
                    )}
                    {calcs.salt_additions.table_salt_nacl_grams > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-700 dark:text-gray-300">Table Salt (NaCl):</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{formatGrams(calcs.salt_additions.table_salt_nacl_grams)}</span>
                      </div>
                    )}
                    {calcs.salt_additions.baking_soda_nahco3_grams > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-700 dark:text-gray-300">Baking Soda (NaHCO₃):</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{formatGrams(calcs.salt_additions.baking_soda_nahco3_grams)}</span>
                      </div>
                    )}
                    {Object.values(calcs.salt_additions).every(v => v === 0) && (
                      <div className="text-gray-500 text-center py-2">No salt additions needed</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 text-sm">
                  <div className="text-orange-900 dark:text-orange-100">
                    Your base water profile is needed to calculate required salt additions. Ask Brewey for help if you are unsure what your base water profile is. Once known, add your base water profile to your Profile (in settings) so that Brewey has this info available in future.
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'profiles' && (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-600">
                      <th className="text-left py-2 text-gray-600 dark:text-gray-400">Ion</th>
                      <th className="text-center py-2 text-gray-600 dark:text-gray-400">Base</th>
                      <th className="text-center py-2 text-gray-600 dark:text-gray-400">Target</th>
                      <th className="text-center py-2 text-gray-600 dark:text-gray-400">{hasCalculations ? 'Calculated*' : 'Calculated'}</th>
                      <th className="text-center py-2 text-gray-600 dark:text-gray-400">Deviation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                    <tr>
                      <td className="py-2 font-medium text-gray-800 dark:text-gray-200">Ca²⁺</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations ? formatPpm(recipeWater.base_ca_ppm) : 'N/A'}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{formatPpm(recipeWater.ca_ppm)}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations && calcs ? formatPpm(calcs.calculated_profile.ca_ppm) : 'N/A'}</td>
                      <td className="text-center">{hasCalculations && calcs ? formatDeviation(calcs.deviations.ca_ppm) : <span className="text-gray-800 dark:text-gray-200">N/A</span>}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-800 dark:text-gray-200">Mg²⁺</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations ? formatPpm(recipeWater.base_mg_ppm) : 'N/A'}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{formatPpm(recipeWater.mg_ppm)}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations && calcs ? formatPpm(calcs.calculated_profile.mg_ppm) : 'N/A'}</td>
                      <td className="text-center">{hasCalculations && calcs ? formatDeviation(calcs.deviations.mg_ppm) : <span className="text-gray-800 dark:text-gray-200">N/A</span>}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-800 dark:text-gray-200">Na⁺</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations ? formatPpm(recipeWater.base_na_ppm) : 'N/A'}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{formatPpm(recipeWater.na_ppm)}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations && calcs ? formatPpm(calcs.calculated_profile.na_ppm) : 'N/A'}</td>
                      <td className="text-center">{hasCalculations && calcs ? formatDeviation(calcs.deviations.na_ppm) : <span className="text-gray-800 dark:text-gray-200">N/A</span>}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-800 dark:text-gray-200">SO₄²⁻</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations ? formatPpm(recipeWater.base_so4_ppm) : 'N/A'}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{formatPpm(recipeWater.so4_ppm)}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations && calcs ? formatPpm(calcs.calculated_profile.so4_ppm) : 'N/A'}</td>
                      <td className="text-center">{hasCalculations && calcs ? formatDeviation(calcs.deviations.so4_ppm) : <span className="text-gray-800 dark:text-gray-200">N/A</span>}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-800 dark:text-gray-200">Cl⁻</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations ? formatPpm(recipeWater.base_cl_ppm) : 'N/A'}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{formatPpm(recipeWater.cl_ppm)}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations && calcs ? formatPpm(calcs.calculated_profile.cl_ppm) : 'N/A'}</td>
                      <td className="text-center">{hasCalculations && calcs ? formatDeviation(calcs.deviations.cl_ppm) : <span className="text-gray-800 dark:text-gray-200">N/A</span>}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium text-gray-800 dark:text-gray-200">HCO₃⁻</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations ? formatPpm(recipeWater.base_hco3_ppm) : 'N/A'}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{formatPpm(recipeWater.hco3_ppm)}</td>
                      <td className="text-center text-gray-800 dark:text-gray-200">{hasCalculations && calcs ? formatPpm(calcs.calculated_profile.hco3_ppm) : 'N/A'}</td>
                      <td className="text-center">{hasCalculations && calcs ? formatDeviation(calcs.deviations.hco3_ppm) : <span className="text-gray-800 dark:text-gray-200">N/A</span>}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {hasCalculations && (
                <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                  *Calculated from best-fit salt additions. Exact target matching is often not possible, small deviations are normal.
                </div>
              )}
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-3">
              {hasCalculations && calcs ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-600 dark:text-gray-400">Alkalinity:</span>
                    <span className="ml-2 text-gray-800 dark:text-gray-200">{formatPpm(calcs.water_analysis.alkalinity_ppm)}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600 dark:text-gray-400">Residual Alkalinity:</span>
                    <span className="ml-2 text-gray-800 dark:text-gray-200">{calcs.water_analysis.residual_alkalinity.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600 dark:text-gray-400">SO₄/Cl Ratio:</span>
                    <span className="ml-2 text-gray-800 dark:text-gray-200">{calcs.water_analysis.sulfate_chloride_ratio.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600 dark:text-gray-400">Balance:</span>
                    <span className="ml-2 text-gray-800 dark:text-gray-200">{calcs.water_analysis.sulfate_chloride_balance}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600 dark:text-gray-400">Total Hardness:</span>
                    <span className="ml-2 text-gray-800 dark:text-gray-200">{formatPpm(calcs.water_analysis.total_hardness_ppm)}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600 dark:text-gray-400">Color Range:</span>
                    <span className="ml-2 text-gray-800 dark:text-gray-200">{calcs.water_analysis.color_range}</span>
                  </div>
                </div>
              ) : (
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 text-sm">
                  <div className="text-orange-900 dark:text-orange-100">
                    Your base water profile is needed to provide a water analysis. Ask Brewey for help if you are unsure what your base water profile is. Once known, add your base water profile to your Profile (in settings) so that Brewey has this info available in future.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

WaterItem.displayName = 'WaterItem'
