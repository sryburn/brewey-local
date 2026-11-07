import { create } from 'zustand'
import { getUserRecipes, getRecipeWithIngredients, getRecipeCalculations, getRecipeSteps } from '@/lib/api/recipes'
import type { 
  RecipeWithCalculations, 
  RecipeMetadata, 
  RecipeCalculations, 
  RecipeGrain, 
  RecipeHop, 
  RecipeYeast, 
  RecipeMisc, 
  RecipeWater, 
  RecipeMashStep, 
  RecipeFermentationStep 
} from '@/types/database'
import { debug } from '@/lib/debug'
import { getProfile } from '@/lib/api/profile'
import { detectUnitSystem, clearOppositeUnitProperties, type UnitSystem } from '@/lib/utils/unit-conversion'

// MCP Tool Result Types
interface MCPToolResult {
  success: boolean
  message?: string
}

// Updated calculations format from MCP responses
interface MCPCalculations {
  og: number
  fg: number  
  abv: number
  ibu: number
  ebc?: number  // Metric
  srm?: number  // Imperial/US Customary
}

interface MCPRecipeGrainResult extends MCPToolResult {
  recipe_grain: {
    id: string
    recipe_id: string
    grain_id: string
    amount_kg: number
  }
  grain_details?: {
    id: string
    name: string
    grain_type: string
    color_ebc: number
    extract_potential: number
    must_mash: boolean
    origin: string
    description: string
    notes: string
  }
  updated_calculations?: MCPCalculations
}

interface MCPRecipeHopResult extends MCPToolResult {
  recipe_hop: {
    id: string
    recipe_id: string
    hop_id: string
    amount_grams: number
    time_minutes: number
    use_type: string
    alpha_acid_percent_override?: number | null
    temperature_c?: number | null
    dry_hop_duration_days?: number | null
    dry_hop_start_day?: number | null
  }
  hop_details?: {
    id: string
    name: string
    hop_type: string
    alpha_acid_percent: number
    beta_acid_percent: number
    form: string
    origin: string
    description: string
    notes: string
  }
  updated_calculations?: MCPCalculations
}

interface MCPRecipeYeastResult extends MCPToolResult {
  recipe_yeast: {
    id: string
    recipe_id: string
    yeast_id: string
    amount_units: number
    unit_type: string
  }
  yeast_details?: {
    id: string
    name: string
    yeast_type: string
    form: string
    attenuation_percent: number
    temperature_range_min: number
    temperature_range_max: number
    laboratory: string
    product_id: string
    description: string
    notes: string
  }
  updated_calculations?: MCPCalculations
}

interface MCPRecipeMiscResult extends MCPToolResult {
  recipe_misc: {
    id: string
    recipe_id: string
    misc_id: string
    amount_units: number
    unit_type: string
    use_type: string
    time_minutes: number | null
    start_day?: number | null
    duration_days?: number | null
  }
  misc_details: {
    id: string
    name: string
    ingredient_type: string
    notes: string
  }
  updated_calculations?: MCPCalculations
}

interface MCPRecipeMashStepResult extends MCPToolResult {
  recipe_mash_step: {
    id: string
    recipe_id: string
    step_order: number
    name: string
    temperature_c: number
    duration_minutes: number
    description: string | null
    created_at: string
  }
  updated_calculations?: MCPCalculations
}

interface MCPRecipeFermentationStepResult extends MCPToolResult {
  recipe_fermentation_step: {
    id: string
    recipe_id: string
    step_order: number
    name: string
    temperature_c: number
    end_temperature_c: number | null
    duration_days: number
    description: string | null
    created_at: string
  }
  updated_calculations?: MCPCalculations
}

interface MCPRecipeResult extends MCPToolResult {
  recipe: {
    id: string
    name: string
    description?: string
    batch_size_liters: number
    boil_time_minutes?: number
    efficiency_percent?: number
    user_id: string
    created_at: string
    updated_at?: string
  }
}

interface MCPRecipeWaterResult extends MCPToolResult {
  recipe_water: {
    id: string
    recipe_id: string
    name: string
    volume_liters: number
    ca_ppm: number | null
    cl_ppm: number | null
    hco3_ppm: number | null
    mg_ppm: number | null
    na_ppm: number | null
    so4_ppm: number | null
    created_at: string
  }
  updated_calculations?: MCPCalculations
}

interface MCPDeleteResult extends MCPToolResult {
  recipe_id?: string  // For ingredient removal operations
  deleted_recipe_id?: string  // For delete_recipe operation
  removed_item?: {
    id: string
    type: 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'misc_ingredient'
  }
  updated_calculations?: MCPCalculations
}

type MCPAllResults = MCPRecipeGrainResult | MCPRecipeHopResult | MCPRecipeYeastResult | MCPRecipeMiscResult | MCPRecipeWaterResult | MCPRecipeMashStepResult | MCPRecipeFermentationStepResult | MCPRecipeResult | MCPDeleteResult | MCPToolResult

// Ingredient Update Data Types
interface IngredientUpdateData {
  data: RecipeGrain | RecipeHop | RecipeYeast | RecipeMisc | RecipeWater | RecipeMashStep | RecipeFermentationStep
  type: 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'mash_step' | 'fermentation_step'
}

interface RecipeState {
  // Data
  userRecipes: RecipeWithCalculations[]
  selectedRecipeId: string | null
  recipeMetadata: RecipeMetadata | null
  grains: RecipeGrain[]
  hops: RecipeHop[]
  yeasts: RecipeYeast[]
  misc: RecipeMisc[]
  water: RecipeWater[]
  mashSteps: RecipeMashStep[]
  fermentationSteps: RecipeFermentationStep[]
  calculations: RecipeCalculations | null
  userId: string | null
  displayUnits: UnitSystem
  
  // UI State  
  loading: boolean
  recipeLoading: boolean
  expandedGrains: Set<string>
  expandedHops: Set<string>
  expandedYeasts: Set<string>
  expandedMisc: Set<string>
  expandedWater: Set<string>
  expandedMashSteps: Set<string>
  expandedFermentationSteps: Set<string>
  expandedBrewingNotes: boolean
  expandedTastingNotes: boolean
  isMobileExpanded: boolean
}

interface RecipeActions {
  // Data Actions
  loadUserRecipes: (userId?: string, showLoading?: boolean) => Promise<void>
  loadRecipeDetails: (recipeId: string) => Promise<void>
  refreshCalculations: () => Promise<void>
  setSelectedRecipe: (recipeId: string | null) => void
  setUserId: (userId: string | null) => void
  loadUserPreferences: (userId: string) => Promise<void>
  
  // UI Actions
  toggleGrainExpansion: (grainId: string) => void
  toggleHopExpansion: (hopId: string) => void  
  toggleYeastExpansion: (yeastId: string) => void
  toggleMiscExpansion: (miscId: string) => void
  toggleWaterExpansion: (waterId: string) => void
  toggleMashStepExpansion: (stepId: string) => void
  toggleFermentationStepExpansion: (stepId: string) => void
  toggleBrewingNotesExpansion: () => void
  toggleTastingNotesExpansion: () => void
  setMobileExpanded: (expanded: boolean) => void
  
  // Notes Update
  updateRecipeMetadata: (updatedMetadata: RecipeMetadata) => void
  
  // Update Actions (called by server)
  triggerRefreshList: () => Promise<void>
  triggerRefreshDetails: (recipeId: string) => Promise<void>
  triggerRefreshCalculations: () => Promise<void>
  
  // Incremental updates (more efficient)
  updateSingleGrain: (grainData: RecipeGrain, calculations?: MCPCalculations) => void
  updateSingleHop: (hopData: RecipeHop, calculations?: MCPCalculations) => void
  updateSingleYeast: (yeastData: RecipeYeast, calculations?: MCPCalculations) => void
  updateSingleMisc: (miscData: RecipeMisc, calculations?: MCPCalculations) => void
  updateSingleWater: (waterData: RecipeWater) => void
  updateSingleMashStep: (stepData: RecipeMashStep, calculations?: MCPCalculations) => void
  updateSingleFermentationStep: (stepData: RecipeFermentationStep, calculations?: MCPCalculations) => void
  removeSingleGrain: (grainId: string, calculations?: MCPCalculations) => void
  removeSingleHop: (hopId: string, calculations?: MCPCalculations) => void
  removeSingleYeast: (yeastId: string, calculations?: MCPCalculations) => void
  removeSingleMisc: (miscId: string, calculations?: MCPCalculations) => void
  removeSingleWater: (waterId: string) => void
  removeSingleMashStep: (stepId: string, calculations?: MCPCalculations) => void
  removeSingleFermentationStep: (stepId: string, calculations?: MCPCalculations) => void
  
  // Recipe switching (when chatbot modifies different recipe) 
  switchToRecipe: (recipeId: string) => Promise<void>
  
  // Efficient recipe list operations
  addRecipeToList: (recipe: RecipeMetadata, calculations?: MCPCalculations) => void
  removeRecipeFromList: (recipeId: string) => void
  
  // Clear all recipe state (used during sign out/account deletion)
  clearRecipeState: () => void
}

// Invalidates pending responses whenever account data is reset or switched.
let recipeIdentityGeneration = 0
let recipeDetailGeneration = 0

const useRecipeStore = create<RecipeState & RecipeActions>()((set, get) => ({
  // Initial State
  userRecipes: [],
  selectedRecipeId: null,
  recipeMetadata: null,
  grains: [],
  hops: [],
  yeasts: [],
  misc: [],
  water: [],
  mashSteps: [],
  fermentationSteps: [],
  calculations: null,
  userId: null,
  displayUnits: 'metric',
  loading: false,
  recipeLoading: false,
  expandedGrains: new Set<string>(),
  expandedHops: new Set<string>(),
  expandedYeasts: new Set<string>(),
  expandedMisc: new Set<string>(),
  expandedWater: new Set<string>(),
  expandedMashSteps: new Set<string>(),
  expandedFermentationSteps: new Set<string>(),
  expandedBrewingNotes: false,
  expandedTastingNotes: false,
  isMobileExpanded: false,

      // Data Actions Implementation
      loadUserRecipes: async (userId?: string, showLoading = true) => {
        const generation = recipeIdentityGeneration
        if (userId && userId !== get().userId) return
        try {
          // Check if already loading to prevent duplicate calls
          const currentState = get()
          if (currentState.loading) {
            debug.log('⏭️ Skipping loadUserRecipes - already loading')
            return
          }

          if (showLoading) {
            set({ loading: true })
          }

          debug.log('📋 Loading user recipes...')
          
          // Use provided userId or get from store state
          const finalUserId = userId || currentState.userId
          if (!finalUserId) {
            debug.log('⚠️ No user ID available for recipe loading')
            set({ loading: false })
            return
          }

          const { data, error } = await getUserRecipes(finalUserId)
          if (generation !== recipeIdentityGeneration || finalUserId !== get().userId) return
          
          if (error) {
            debug.error('❌ Failed to load user recipes:', error)
            set({ loading: false })
            return
          }

          debug.log('✅ User recipes loaded:', data?.length || 0)
          
          // Auto-select most recently updated recipe if none selected or selected doesn't exist
          const state = get()
          const currentSelected = state.selectedRecipeId
          const recipes = data || []
          
          let recipeToSelect: string | null = null
          
          if (recipes.length > 0) {
            // Check if current selection still exists
            const currentExists = currentSelected && recipes.find(r => r.id === currentSelected)
            
            if (!currentExists) {
              // Select most recently updated recipe
              const sortedByUpdated = recipes.sort((a, b) => 
                new Date(b.updated_at || b.created_at).getTime() - 
                new Date(a.updated_at || a.created_at).getTime()
              )
              recipeToSelect = sortedByUpdated[0].id
              debug.log('🎯 Auto-selecting most recent recipe:', recipeToSelect)
            }
          }
          
          set({ 
            userRecipes: recipes,
            loading: false,
            ...(recipeToSelect && { selectedRecipeId: recipeToSelect })
          })

        } catch (error) {
          if (generation !== recipeIdentityGeneration) return
          debug.error('❌ Unexpected error loading user recipes:', error)
          set({ loading: false })
        }
      },
      
      loadRecipeDetails: async (recipeId: string) => {
        const generation = recipeIdentityGeneration
        const detailGeneration = ++recipeDetailGeneration
        if (!get().userId) return
        try {
          set({ recipeLoading: true })
          debug.log('🔍 Loading recipe details for:', recipeId)

          const { data, error } = await getRecipeWithIngredients(recipeId)
          if (generation !== recipeIdentityGeneration || detailGeneration !== recipeDetailGeneration) return
          
          if (error) {
            if (error === 'Recipe not found') {
              // Recipe was deleted or doesn't exist - clear selection silently
              debug.log('Recipe not found, clearing selection:', recipeId)
                          set({
              selectedRecipeId: null,
              recipeMetadata: null,
              grains: [],
              hops: [],
              yeasts: [],
              misc: [],
              water: [],
              mashSteps: [],
              fermentationSteps: [],
              calculations: null,
              recipeLoading: false 
            })
              return
            }
            debug.error('❌ Failed to load recipe details:', error)
            set({ recipeLoading: false })
            return
          }

          if (!data) {
            debug.error('❌ No recipe data returned')
            set({ recipeLoading: false })
            return
          }

          // Fetch calculations directly from database (no dependency on userRecipes)
          const { data: calculationsData, error: calcError } = await getRecipeCalculations(recipeId)
          if (generation !== recipeIdentityGeneration || detailGeneration !== recipeDetailGeneration) return
          const calculations = calculationsData ? {
            calculated_og: calculationsData.calculated_og,
            calculated_fg: calculationsData.calculated_fg,
            calculated_abv: calculationsData.calculated_abv,
            calculated_ibu: calculationsData.calculated_ibu,
            calculated_ebc: calculationsData.calculated_ebc,
            batch_size_liters: data.batch_size_liters,
            boil_time_minutes: data.boil_time_minutes,
            efficiency_percent: data.efficiency_percent,
            mash_thickness: data.mash_thickness
          } : null
          
          if (calcError) {
            debug.warn('⚠️ Failed to load calculations, proceeding without them:', calcError)
          }

          // Fetch mash steps
          const { data: mashSteps, error: mashError } = await getRecipeSteps(recipeId, 'mash')
          if (generation !== recipeIdentityGeneration || detailGeneration !== recipeDetailGeneration) return

          if (mashError) {
            debug.warn('⚠️ Failed to load mash steps:', mashError)
          }

          // Fetch fermentation steps  
          const { data: fermentationSteps, error: fermentError } = await getRecipeSteps(recipeId, 'fermentation')
          if (generation !== recipeIdentityGeneration || detailGeneration !== recipeDetailGeneration) return

          if (fermentError) {
            debug.warn('⚠️ Failed to load fermentation steps:', fermentError)
          }

          debug.log('✅ Recipe details loaded successfully')
          set({
            recipeMetadata: {
              id: data.id,
              user_id: data.user_id,
              name: data.name,
              description: data.description,
              batch_size_liters: data.batch_size_liters,
              boil_time_minutes: data.boil_time_minutes,
              efficiency_percent: data.efficiency_percent,
              mash_thickness: data.mash_thickness,
              brewing_notes: data.brewing_notes,
              tasting_notes: data.tasting_notes,
              bjcp_style_id: data.bjcp_style_id,
              created_at: data.created_at,
              updated_at: data.updated_at,
              beer_style: data.beer_styles || null
            },
            grains: data.recipe_grains || [],
            hops: data.recipe_hops || [],
            yeasts: data.recipe_yeasts || [],
            misc: data.recipe_misc || [],
            water: data.recipe_water || [],
            mashSteps: mashSteps || [],
            fermentationSteps: fermentationSteps || [],
            calculations,
            recipeLoading: false
          })

        } catch (error) {
          if (generation !== recipeIdentityGeneration || detailGeneration !== recipeDetailGeneration) return
          debug.error('❌ Unexpected error loading recipe details:', error)
          set({ recipeLoading: false })
        }
      },

      refreshCalculations: async () => {
        const state = get()
        if (state.selectedRecipeId) {
          debug.log('🔄 Refreshing calculations...')
          await get().loadUserRecipes(state.userId || undefined, false) // Reload to get updated calculations
        }
      },

      setSelectedRecipe: (recipeId: string | null) => {
        if (get().selectedRecipeId !== recipeId) recipeDetailGeneration += 1
        debug.log('📌 Setting selected recipe:', recipeId)
        set({ selectedRecipeId: recipeId })
        
        // Save to user-scoped localStorage key
        const currentUserId = get().userId
        if (currentUserId) {
          const userKey = `brewey-recipe-ui-state-${currentUserId}`
          if (recipeId) {
            localStorage.setItem(userKey, JSON.stringify({ selectedRecipeId: recipeId }))
            debug.log('💾 Saved selectedRecipeId to user-scoped key:', userKey)
          } else {
            localStorage.removeItem(userKey)
            debug.log('🗑️ Removed user-scoped selectedRecipeId key:', userKey)
          }
        }
      },

      setUserId: (userId: string | null) => {
        const currentUserId = get().userId
        if (currentUserId !== userId) {
          get().clearRecipeState()
          debug.log('👤 Setting user ID:', userId)
          
          // Load this user's saved selectedRecipeId from user-scoped key
          let savedRecipeId: string | null = null
          if (userId) {
            const userKey = `brewey-recipe-ui-state-${userId}`
            const saved = localStorage.getItem(userKey)
            if (saved) {
              try {
                const parsed = JSON.parse(saved)
                savedRecipeId = parsed.selectedRecipeId || null
                debug.log('📥 Loaded savedRecipeId from user-scoped key:', userKey, savedRecipeId)
              } catch (e) {
                debug.error('❌ Failed to parse saved recipe selection:', e)
              }
            }
          }
          
          set({ userId, selectedRecipeId: savedRecipeId })
        }
      },

      loadUserPreferences: async (userId: string) => {
        const generation = recipeIdentityGeneration
        if (userId !== get().userId) return
        try {
          const { data } = await getProfile()
          if (generation !== recipeIdentityGeneration || userId !== get().userId) return
          const unitSystem = data?.unit_system || 'metric'
          debug.log('📐 Loaded user unit preference:', unitSystem)
          set({ displayUnits: unitSystem })
        } catch (error) {
          if (generation !== recipeIdentityGeneration) return
          debug.warn('⚠️ Failed to load user preferences, defaulting to metric:', error)
          set({ displayUnits: 'metric' })
        }
      },

      // UI Actions Implementation
      toggleGrainExpansion: (grainId: string) => {
        set((state) => {
          const newSet = new Set(state.expandedGrains)
          if (newSet.has(grainId)) {
            newSet.delete(grainId)
          } else {
            newSet.add(grainId)
          }
          return { expandedGrains: newSet }
        })
      },

      toggleHopExpansion: (hopId: string) => {
        set((state) => {
          const newSet = new Set(state.expandedHops)
          if (newSet.has(hopId)) {
            newSet.delete(hopId)
          } else {
            newSet.add(hopId)
          }
          return { expandedHops: newSet }
        })
      },

      toggleYeastExpansion: (yeastId: string) => {
        set((state) => {
          const newSet = new Set(state.expandedYeasts)
          if (newSet.has(yeastId)) {
            newSet.delete(yeastId)
          } else {
            newSet.add(yeastId)
          }
          return { expandedYeasts: newSet }
        })
      },

      toggleMiscExpansion: (miscId: string) => {
        set((state) => {
          const newSet = new Set(state.expandedMisc)
          if (newSet.has(miscId)) {
            newSet.delete(miscId)
          } else {
            newSet.add(miscId)
          }
          return { expandedMisc: newSet }
        })
      },

      toggleWaterExpansion: (waterId: string) => {
        set((state) => {
          const newSet = new Set(state.expandedWater)
          if (newSet.has(waterId)) {
            newSet.delete(waterId)
          } else {
            newSet.add(waterId)
          }
          return { expandedWater: newSet }
        })
      },

      toggleMashStepExpansion: (stepId: string) => {
        set((state) => {
          const newSet = new Set(state.expandedMashSteps)
          if (newSet.has(stepId)) {
            newSet.delete(stepId)
          } else {
            newSet.add(stepId)
          }
          return { expandedMashSteps: newSet }
        })
      },

      toggleFermentationStepExpansion: (stepId: string) => {
        set((state) => {
          const newSet = new Set(state.expandedFermentationSteps)
          if (newSet.has(stepId)) {
            newSet.delete(stepId)
          } else {
            newSet.add(stepId)
          }
          return { expandedFermentationSteps: newSet }
        })
      },

      toggleBrewingNotesExpansion: () => {
        set((state) => ({ expandedBrewingNotes: !state.expandedBrewingNotes }))
      },

      toggleTastingNotesExpansion: () => {
        set((state) => ({ expandedTastingNotes: !state.expandedTastingNotes }))
      },

      setMobileExpanded: (expanded: boolean) => {
        set({ isMobileExpanded: expanded })
      },

      // Notes Update Implementation
      updateRecipeMetadata: (updatedMetadata: RecipeMetadata) => {
        debug.log('📝 Updating recipe metadata:', updatedMetadata.id)
        
        // Clear opposite units from metadata
        const unitSystem = detectUnitSystem(updatedMetadata)
        const cleanedMetadata = unitSystem 
          ? clearOppositeUnitProperties(updatedMetadata, unitSystem)
          : updatedMetadata
        
        set({ recipeMetadata: cleanedMetadata })
      },

      // Update Actions Implementation
      triggerRefreshList: async () => {
        debug.log('🔄 Triggering recipe list refresh...')
        const state = get()
        await get().loadUserRecipes(state.userId || undefined, false)
      },

      triggerRefreshDetails: async (recipeId: string) => {
        debug.log('🔄 Triggering recipe details refresh for:', recipeId)
        await get().loadRecipeDetails(recipeId)
      },

      triggerRefreshCalculations: async () => {
        debug.log('🔄 Triggering calculations refresh...')
        await get().refreshCalculations()
      },

      // Incremental Updates Implementation
      updateSingleGrain: (grainData: RecipeGrain, calculations?: MCPCalculations) => {
        set((state) => {
          const unitSystem = detectUnitSystem(grainData)
          
          const updatedGrains = state.grains.map(grain => {
            if (grain.id !== grainData.id) return grain
            
            // Merge to preserve nested 'grains' object
            const merged = { ...grain, ...grainData }
            
            // Clear opposite unit to prevent stale data
            return unitSystem ? clearOppositeUnitProperties(merged, unitSystem) : merged
          })
          
          // If grain doesn't exist, add it
          if (!state.grains.find(g => g.id === grainData.id)) {
            const cleanedData = unitSystem 
              ? clearOppositeUnitProperties(grainData, unitSystem)
              : grainData
            updatedGrains.push(cleanedData)
          }
          debug.log('🌾 Updated single grain:', grainData.id)
          
          // Update calculations if provided from MCP response
          const newState: { grains: RecipeGrain[], calculations?: RecipeCalculations } = { grains: updatedGrains }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }

          }
          return newState
        })
        
        // Only refresh calculations if not provided from MCP
        if (!calculations) {
          get().refreshCalculations()
        }
      },

      updateSingleHop: (hopData: RecipeHop, calculations?: MCPCalculations) => {
        set((state) => {
          const unitSystem = detectUnitSystem(hopData)
          const existingHop = state.hops.find(h => h.id === hopData.id)
          
          const updatedHops = state.hops.map(hop => {
            if (hop.id !== hopData.id) return hop
            
            // Merge the hop data
            const updatedHop = { ...hop, ...hopData }
            
            // If we have existing hop details and an override is being set/changed
            if (hop.hops && 'alpha_acid_percent_override' in hopData) {
              // Use fresh hop details if provided by MCP, otherwise fall back to existing store data
              const originalAlpha = hopData.hops?.alpha_acid_percent ?? hop.hops.alpha_acid_percent
              const effectiveAlpha = hopData.alpha_acid_percent_override ?? originalAlpha
              
              // Update the nested hops object with the effective alpha acid value
              updatedHop.hops = {
                ...hop.hops,
                ...(hopData.hops || {}), // Merge any fresh hop details from MCP
                alpha_acid_percent: effectiveAlpha
              }
            } else if (hopData.hops) {
              // Use provided hop details
              updatedHop.hops = hopData.hops
            } else {
              // Preserve existing hop details
              updatedHop.hops = hop.hops
            }
            
            // Clear opposite unit to prevent stale data
            return unitSystem ? clearOppositeUnitProperties(updatedHop, unitSystem) : updatedHop
          })
          
          // If hop doesn't exist, add it
          if (!existingHop) {
            // Process alpha acid override for new hops
            let newHop = { ...hopData }
            if (hopData.hops && 'alpha_acid_percent_override' in hopData && hopData.alpha_acid_percent_override !== null && hopData.alpha_acid_percent_override !== undefined) {
              // Apply the override to the hop details for display
              newHop.hops = {
                ...hopData.hops,
                alpha_acid_percent: hopData.alpha_acid_percent_override
              }
            }
            newHop = unitSystem ? clearOppositeUnitProperties(newHop, unitSystem) : newHop
            updatedHops.push(newHop)
          }
          
          debug.log('🍺 Updated single hop:', hopData.id)
          
          // Update calculations if provided from MCP response
          const newState: { hops: RecipeHop[], calculations?: RecipeCalculations } = { hops: updatedHops }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }

          }
          return newState
        })
        
        // Only refresh calculations if not provided from MCP
        if (!calculations) {
          get().refreshCalculations()
        }
      },

      updateSingleYeast: (yeastData: RecipeYeast, calculations?: MCPCalculations) => {
        set((state) => {
          const unitSystem = detectUnitSystem(yeastData)
          
          const updatedYeasts = state.yeasts.map(yeast => {
            if (yeast.id !== yeastData.id) return yeast
            
            // Merge to preserve nested 'yeasts' object
            const merged = { ...yeast, ...yeastData }
            
            // Clear opposite unit to prevent stale data
            return unitSystem ? clearOppositeUnitProperties(merged, unitSystem) : merged
          })
          
          // If yeast doesn't exist, add it
          if (!state.yeasts.find(y => y.id === yeastData.id)) {
            const cleanedData = unitSystem 
              ? clearOppositeUnitProperties(yeastData, unitSystem)
              : yeastData
            updatedYeasts.push(cleanedData)
          }
          debug.log('🦠 Updated single yeast:', yeastData.id)
          
          // Update calculations if provided from MCP response
          const newState: { yeasts: RecipeYeast[], calculations?: RecipeCalculations } = { yeasts: updatedYeasts }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }

          }
          return newState
        })
        
        // Only refresh calculations if not provided from MCP
        if (!calculations) {
          get().refreshCalculations()
        }
      },

      updateSingleMisc: (miscData: RecipeMisc, calculations?: MCPCalculations) => {
        set((state) => {
          const unitSystem = detectUnitSystem(miscData)
          const existingMisc = state.misc.find(m => m.id === miscData.id)
          
          const updatedMisc = state.misc.map(misc => {
            if (misc.id !== miscData.id) return misc
            
            const merged = {
              ...misc, 
              ...miscData,
              // Preserve existing ingredient details if new data doesn't have them
              misc_ingredients: miscData.misc_ingredients || misc.misc_ingredients
            }
            
            // Clear opposite unit to prevent stale data
            return unitSystem ? clearOppositeUnitProperties(merged, unitSystem) : merged
          })
          
          // If misc doesn't exist, add it
          if (!existingMisc) {
            const cleanedData = unitSystem 
              ? clearOppositeUnitProperties(miscData, unitSystem)
              : miscData
            updatedMisc.push(cleanedData)
          }
          
          // Update calculations if provided from MCP response
          const newState: { misc: RecipeMisc[], calculations?: RecipeCalculations } = { misc: updatedMisc }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }
          }
          return newState
        })
        
        // Misc ingredients don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
        // No need to refresh calculations
      },

      updateSingleWater: (waterData: RecipeWater) => {
        set((state) => {
          const unitSystem = detectUnitSystem(waterData)
          const existingWater = state.water.find(w => w.id === waterData.id)
          
          const updatedWater = state.water.map(water => {
            if (water.id !== waterData.id) return water
            
            const merged = { ...water, ...waterData }
            
            // Clear opposite unit to prevent stale data
            return unitSystem ? clearOppositeUnitProperties(merged, unitSystem) : merged
          })
          
          // If water doesn't exist, add it
          if (!existingWater) {
            const cleanedData = unitSystem 
              ? clearOppositeUnitProperties(waterData, unitSystem)
              : waterData
            updatedWater.push(cleanedData)
          }
          debug.log('💧 Updated single water:', waterData.id)
          
          return { water: updatedWater }
        })
        
        // Water changes don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
      },

      removeSingleGrain: (grainId: string, calculations?: MCPCalculations) => {
        set((state) => {
          debug.log('🗑️ Removing single grain:', grainId)
          
          // Update calculations if provided from MCP response
          const newState: { grains: RecipeGrain[], calculations?: RecipeCalculations } = { 
            grains: state.grains.filter(grain => grain.id !== grainId)
          }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }

          }
          return newState
        })
        
        // Only refresh calculations if not provided from MCP
        if (!calculations) {
          get().refreshCalculations()
        }
      },

      removeSingleHop: (hopId: string, calculations?: MCPCalculations) => {
        set((state) => {
          debug.log('🗑️ Removing single hop:', hopId)
          
          // Update calculations if provided from MCP response
          const newState: { hops: RecipeHop[], calculations?: RecipeCalculations } = { 
            hops: state.hops.filter(hop => hop.id !== hopId)
          }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }

          }
          return newState
        })
        
        // Only refresh calculations if not provided from MCP
        if (!calculations) {
          get().refreshCalculations()
        }
      },

      removeSingleYeast: (yeastId: string, calculations?: MCPCalculations) => {
        set((state) => {
          debug.log('🗑️ Removing single yeast:', yeastId)
          
          // Update calculations if provided from MCP response
          const newState: { yeasts: RecipeYeast[], calculations?: RecipeCalculations } = { 
            yeasts: state.yeasts.filter(yeast => yeast.id !== yeastId)
          }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }

          }
          return newState
        })
        
        // Only refresh calculations if not provided from MCP
        if (!calculations) {
          get().refreshCalculations()
        }
      },

      removeSingleMisc: (miscId: string, calculations?: MCPCalculations) => {
        set((state) => {
          
          // Update calculations if provided from MCP response
          const newState: { misc: RecipeMisc[], calculations?: RecipeCalculations } = { 
            misc: state.misc.filter(misc => misc.id !== miscId)
          }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }
          }
          
          return newState
        })
        
        // Misc ingredients don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
        // No need to refresh calculations
      },

      removeSingleWater: (waterId: string) => {
        set((state) => {
          debug.log('🗑️ Removing single water:', waterId)
          
          return { 
            water: state.water.filter(water => water.id !== waterId)
          }
        })
        
        // Water changes don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
      },

      // Mash Step Methods
      updateSingleMashStep: (stepData: RecipeMashStep, calculations?: MCPCalculations) => {
        set((state) => {
          const unitSystem = detectUnitSystem(stepData)
          
          const updatedSteps = state.mashSteps.map(step => {
            if (step.id !== stepData.id) return step
            
            const merged = { ...step, ...stepData }
            
            // Clear opposite unit to prevent stale data
            return unitSystem ? clearOppositeUnitProperties(merged, unitSystem) : merged
          })
          
          // If step doesn't exist, add it
          if (!state.mashSteps.find(s => s.id === stepData.id)) {
            const cleanedData = unitSystem 
              ? clearOppositeUnitProperties(stepData, unitSystem)
              : stepData
            updatedSteps.push(cleanedData)
          }
          debug.log('🥢 Updated single mash step:', stepData.id)
          
          // Update calculations if provided from MCP response
          const newState: { mashSteps: RecipeMashStep[], calculations?: RecipeCalculations } = { mashSteps: updatedSteps }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }
          }
          return newState
        })
        
        // Mash steps don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
        // No need to refresh calculations
      },

      updateSingleFermentationStep: (stepData: RecipeFermentationStep, calculations?: MCPCalculations) => {
        set((state) => {
          const unitSystem = detectUnitSystem(stepData)
          
          const updatedSteps = state.fermentationSteps.map(step => {
            if (step.id !== stepData.id) return step
            
            const merged = { ...step, ...stepData }
            
            // Clear opposite unit to prevent stale data
            return unitSystem ? clearOppositeUnitProperties(merged, unitSystem) : merged
          })
          
          // If step doesn't exist, add it
          if (!state.fermentationSteps.find(s => s.id === stepData.id)) {
            const cleanedData = unitSystem 
              ? clearOppositeUnitProperties(stepData, unitSystem)
              : stepData
            updatedSteps.push(cleanedData)
          }
          debug.log('🍻 Updated single fermentation step:', stepData.id)
          
          // Update calculations if provided from MCP response
          const newState: { fermentationSteps: RecipeFermentationStep[], calculations?: RecipeCalculations } = { fermentationSteps: updatedSteps }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }
          }
          return newState
        })
        
        // Fermentation steps don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
        // No need to refresh calculations
      },

      removeSingleMashStep: (stepId: string, calculations?: MCPCalculations) => {
        set((state) => {
          debug.log('🗑️ Removing single mash step:', stepId)
          
          // Update calculations if provided from MCP response
          const newState: { mashSteps: RecipeMashStep[], calculations?: RecipeCalculations } = { 
            mashSteps: state.mashSteps.filter(step => step.id !== stepId)
          }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }
          }
          return newState
        })
        
        // Mash steps don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
        // No need to refresh calculations
      },

      removeSingleFermentationStep: (stepId: string, calculations?: MCPCalculations) => {
        set((state) => {
          debug.log('🗑️ Removing single fermentation step:', stepId)
          
          // Update calculations if provided from MCP response
          const newState: { fermentationSteps: RecipeFermentationStep[], calculations?: RecipeCalculations } = { 
            fermentationSteps: state.fermentationSteps.filter(step => step.id !== stepId)
          }
          if (calculations) {
            newState.calculations = {
              calculated_og: calculations.og,
              calculated_fg: calculations.fg,
              calculated_abv: calculations.abv,
              calculated_ibu: calculations.ibu,
              calculated_ebc: calculations.ebc || null,
              calculated_srm: calculations.srm || null,
              batch_size_liters: state.recipeMetadata?.batch_size_liters || 20,
              boil_time_minutes: state.recipeMetadata?.boil_time_minutes || 60,
              efficiency_percent: state.recipeMetadata?.efficiency_percent || 75,
              mash_thickness: state.recipeMetadata?.mash_thickness || null
            }
          }
          return newState
        })
        
        // Fermentation steps don't affect brewing calculations (OG, FG, ABV, IBU, EBC)
        // No need to refresh calculations
      },

      // Recipe switching implementation
      switchToRecipe: async (recipeId: string) => {
        debug.log('🔄 Switching to recipe:', recipeId)
        set({ selectedRecipeId: recipeId })
        await get().loadRecipeDetails(recipeId)
      },

      // Efficient recipe list operations
      addRecipeToList: (recipe: RecipeMetadata, calculations?: MCPCalculations) => {
        set((state) => {
          // Create a RecipeWithCalculations object from the recipe metadata
          const newRecipe: RecipeWithCalculations = {
            id: recipe.id,
            user_id: recipe.user_id,
            name: recipe.name,
            description: recipe.description,
            batch_size_liters: recipe.batch_size_liters,
            boil_time_minutes: recipe.boil_time_minutes,
            efficiency_percent: recipe.efficiency_percent,
            mash_thickness: recipe.mash_thickness,
            brewing_notes: recipe.brewing_notes,
            tasting_notes: recipe.tasting_notes,
            bjcp_style_id: recipe.bjcp_style_id,
            created_at: recipe.created_at,
            updated_at: recipe.updated_at,
            calculated_og: calculations?.og ?? null,
            calculated_fg: calculations?.fg ?? null,
            calculated_abv: calculations?.abv ?? null,
            calculated_ibu: calculations?.ibu ?? null,
            calculated_ebc: calculations?.ebc ?? null
          }
          
          debug.log('➕ Adding recipe to list:', recipe.id)
          
          // Add to the beginning of the list (most recent)
          const updatedRecipes = [newRecipe, ...state.userRecipes]
          
          return {
            userRecipes: updatedRecipes,
            selectedRecipeId: recipe.id // Auto-select the new recipe
          }
        })
      },

      removeRecipeFromList: (recipeId: string) => {
        const generation = recipeIdentityGeneration
        set((state) => {
          debug.log('➖ Removing recipe from list:', recipeId)
          
          const updatedRecipes = state.userRecipes.filter(recipe => recipe.id !== recipeId)
          
          // Determine new selection
          let newSelectedId = state.selectedRecipeId
          let shouldLoadNewRecipe = false
          
          if (state.selectedRecipeId === recipeId) {
            // Deleted recipe was selected, need to auto-select next most recent
            if (updatedRecipes.length > 0) {
              // Select most recently updated recipe
              const sortedByUpdated = updatedRecipes.sort((a, b) => 
                new Date(b.updated_at || b.created_at).getTime() - 
                new Date(a.updated_at || a.created_at).getTime()
              )
              newSelectedId = sortedByUpdated[0].id
              shouldLoadNewRecipe = true
              debug.log('🎯 Auto-selecting most recent recipe after deletion:', newSelectedId)
            } else {
              // No recipes left
              newSelectedId = null
              debug.log('📭 No recipes remaining after deletion')
            }
          }
          
          const newState = {
            userRecipes: updatedRecipes,
            selectedRecipeId: newSelectedId,
            // Clear recipe details if the deleted recipe was currently loaded
            ...(state.selectedRecipeId === recipeId && {
              recipeMetadata: null,
              grains: [],
              hops: [],
              yeasts: [],
              misc: [],
              water: [],
              mashSteps: [],
              fermentationSteps: [],
              calculations: null
            })
          }
          
          // Load the new recipe details if we auto-selected one
          if (shouldLoadNewRecipe && newSelectedId) {
            // Use setTimeout to ensure state update completes first
            setTimeout(() => {
              if (generation !== recipeIdentityGeneration) return
              debug.log('🔄 Loading details for auto-selected recipe:', newSelectedId)
              get().loadRecipeDetails(newSelectedId)
            }, 0)
          }
          
          return newState
        })
      },

      // Clear all recipe state (used during sign out/account deletion)
      clearRecipeState: () => {
        recipeIdentityGeneration += 1
        debug.log('🧹 Clearing recipe state')
        set({
          userId: null,
          displayUnits: 'metric',
          selectedRecipeId: null,
          recipeMetadata: null,
          grains: [],
          hops: [],
          yeasts: [],
          misc: [],
          water: [],
          mashSteps: [],
          fermentationSteps: [],
          calculations: null,
          recipeLoading: false,
          userRecipes: [],
          loading: false,
          expandedGrains: new Set(),
          expandedHops: new Set(),
          expandedYeasts: new Set(),
          expandedMisc: new Set(),
          expandedWater: new Set(),
          expandedMashSteps: new Set(),
          expandedFermentationSteps: new Set(),
          expandedBrewingNotes: false,
          expandedTastingNotes: false,
          isMobileExpanded: false
        })
      }
    }))

export { useRecipeStore, type IngredientUpdateData, type MCPAllResults } 