import { debug } from '@/lib/debug'
import type { RecipeGrain, RecipeHop, RecipeYeast, RecipeMisc, RecipeWater, RecipeMashStep, RecipeFermentationStep, RecipeMetadata } from '@/types/database'

// MCP Tool Result Types
interface MCPToolResult {
  success: boolean
  message?: string
}

interface MCPRecipeGrainResult extends MCPToolResult {
  recipe_grain: {
    id: string
    recipe_id: string
    grain_id: string
    amount_kg: number
  }
}

interface MCPRecipeHopResult extends MCPToolResult {
  recipe_hop: {
    id: string
    recipe_id: string
    hop_id: string
    amount_grams: number
    time_minutes: number
    use_type: string
    created_at: string
    alpha_acid_percent_override?: number | null
    temperature_c?: number | null
    dry_hop_duration_days?: number | null
    dry_hop_start_day?: number | null
  }
}

interface MCPRecipeYeastResult extends MCPToolResult {
  recipe_yeast: {
    id: string
    recipe_id: string
    yeast_id: string
    amount_units: number
    unit_type: string
  }
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
  updated_calculations?: {
    og: number
    fg: number
    abv: number
    ibu: number
    ebc: number
  }
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
  updated_calculations?: {
    og: number
    fg: number
    abv: number
    ibu: number
    ebc: number
  }
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
  updated_calculations?: {
    og: number
    fg: number
    abv: number
    ibu: number
    ebc: number
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

interface MCPSelectRecipeResult extends MCPToolResult {
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

interface MCPDeleteResult extends MCPToolResult {
  recipe_id: string
  removed_item: {
    id: string
    type: 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'misc_ingredient' | 'mash_step' | 'fermentation_step'
  }
  updated_calculations?: {
    og: number
    fg: number
    abv: number
    ibu: number
    ebc: number
  }
}

type MCPAllResults = MCPRecipeGrainResult | MCPRecipeHopResult | MCPRecipeYeastResult | MCPRecipeMiscResult | MCPRecipeWaterResult | MCPRecipeMashStepResult | MCPRecipeFermentationStepResult | MCPRecipeResult | MCPSelectRecipeResult | MCPDeleteResult | MCPToolResult

// Ingredient and Step Update Data Types
interface IngredientUpdateData {
  data: RecipeGrain | RecipeHop | RecipeYeast | RecipeMisc | RecipeWater | RecipeMashStep | RecipeFermentationStep
  type: 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'mash_step' | 'fermentation_step'
}

// These will trigger client-side store updates through various mechanisms
// The exact implementation depends on how we want to communicate server->client

// Server-side recipe update logging removed - all handled client-side

export async function getRecipeDataFromToolResult(
  toolName: string, 
  toolResult: MCPAllResults
): Promise<{ recipeId: string | null, ingredientData?: RecipeGrain | RecipeHop | RecipeYeast | RecipeMisc | RecipeWater | RecipeMashStep | RecipeFermentationStep, ingredientType?: 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'mash_step' | 'fermentation_step', recipeMetadata?: RecipeMetadata, calculations?: unknown }> {
  try {
    // Special handling for select_recipe
    if (toolName === 'select_recipe') {
      // The tool result should have a recipe with at least an ID
      if ('recipe' in toolResult && toolResult.recipe && typeof toolResult.recipe === 'object' && 'id' in toolResult.recipe) {
        return { 
          recipeId: (toolResult.recipe as { id: string }).id
        }
      }
      // Fallback if the structure is different
      if ('recipe_id' in toolResult && typeof toolResult.recipe_id === 'string') {
        return { recipeId: toolResult.recipe_id }
      }
    }
    
    // Validate tool result structure
    if (!toolResult?.success) {
      return { recipeId: null }
    }
    
    // All MCP operations now return recipe_id directly!
    if ('recipe_grain' in toolResult) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      // Merge recipe_grain with grain_details if available
      let grainData = toolResult.recipe_grain as RecipeGrain
      if ('grain_details' in toolResult && toolResult.grain_details) {
        grainData = {
          ...grainData,
          grains: toolResult.grain_details
        } as RecipeGrain
      }
      
      return { 
        recipeId: uuidRegex.test(toolResult.recipe_grain.recipe_id) ? toolResult.recipe_grain.recipe_id : null,
        ingredientData: grainData,
        ingredientType: 'grain',
        calculations: ('updated_calculations' in toolResult && toolResult.updated_calculations) ? toolResult.updated_calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } : undefined
      }
    }
    
    if ('recipe_hop' in toolResult) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      // Merge recipe_hop with hop_details if available
      let hopData = toolResult.recipe_hop as RecipeHop
      if ('hop_details' in toolResult && toolResult.hop_details) {
        hopData = {
          ...hopData,
          hops: toolResult.hop_details
        } as RecipeHop
      }
      
      return { 
        recipeId: uuidRegex.test(toolResult.recipe_hop.recipe_id) ? toolResult.recipe_hop.recipe_id : null,
        ingredientData: hopData,
        ingredientType: 'hop',
        calculations: ('updated_calculations' in toolResult && toolResult.updated_calculations) ? toolResult.updated_calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } : undefined
      }
    }
    
    if ('recipe_yeast' in toolResult) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      // Merge recipe_yeast with yeast_details if available
      let yeastData = toolResult.recipe_yeast as RecipeYeast
      if ('yeast_details' in toolResult && toolResult.yeast_details) {
        yeastData = {
          ...yeastData,
          yeasts: toolResult.yeast_details
        } as RecipeYeast
      }
      
      return { 
        recipeId: uuidRegex.test(toolResult.recipe_yeast.recipe_id) ? toolResult.recipe_yeast.recipe_id : null,
        ingredientData: yeastData,
        ingredientType: 'yeast',
        calculations: 'updated_calculations' in toolResult ? toolResult.updated_calculations : undefined
      }
    }
    
    if ('recipe_misc' in toolResult) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      const miscResult = toolResult as MCPRecipeMiscResult
      
      // Merge recipe_misc with misc_details
      const miscData = {
        ...miscResult.recipe_misc,
        misc_ingredients: miscResult.misc_details
      } as RecipeMisc
      
      return { 
        recipeId: uuidRegex.test(miscResult.recipe_misc.recipe_id) ? miscResult.recipe_misc.recipe_id : null,
        ingredientData: miscData,
        ingredientType: 'misc',
        calculations: miscResult.updated_calculations ? miscResult.updated_calculations : undefined
      }
    }

    if ('recipe_water' in toolResult) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      const waterResult = toolResult as MCPRecipeWaterResult
      
      return { 
        recipeId: uuidRegex.test(waterResult.recipe_water.recipe_id) ? waterResult.recipe_water.recipe_id : null,
        ingredientData: waterResult.recipe_water as RecipeWater,
        ingredientType: 'water'
      }
    }

    if ('recipe_mash_step' in toolResult) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      const mashStepResult = toolResult as MCPRecipeMashStepResult
      
      return { 
        recipeId: uuidRegex.test(mashStepResult.recipe_mash_step.recipe_id) ? mashStepResult.recipe_mash_step.recipe_id : null,
        ingredientData: mashStepResult.recipe_mash_step as RecipeMashStep,
        ingredientType: 'mash_step',
        calculations: mashStepResult.updated_calculations ? mashStepResult.updated_calculations : undefined
      }
    }

    if ('recipe_fermentation_step' in toolResult) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      const fermentationStepResult = toolResult as MCPRecipeFermentationStepResult
      
      return { 
        recipeId: uuidRegex.test(fermentationStepResult.recipe_fermentation_step.recipe_id) ? fermentationStepResult.recipe_fermentation_step.recipe_id : null,
        ingredientData: fermentationStepResult.recipe_fermentation_step as RecipeFermentationStep,
        ingredientType: 'fermentation_step',
        calculations: fermentationStepResult.updated_calculations ? fermentationStepResult.updated_calculations : undefined
      }
    }
    
    // DELETE operations now return recipe_id directly too!
    if (('recipe_id' in toolResult && 'removed_item' in toolResult) || ('deleted_recipe_id' in toolResult)) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      
      // For ingredient removal operations
      if ('recipe_id' in toolResult && toolResult.recipe_id && 'removed_item' in toolResult && toolResult.removed_item) {
        const removedItem = toolResult.removed_item as { id: string, type: 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'misc_ingredient' | 'mash_step' | 'fermentation_step' }
        
        // Map backend type names to frontend type names
        const mapIngredientType = (backendType: string): 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'mash_step' | 'fermentation_step' => {
          switch (backendType) {
            case 'misc_ingredient':
              return 'misc'
            case 'grain':
            case 'hop': 
            case 'yeast':
            case 'misc':
            case 'water':
            case 'mash_step':
            case 'fermentation_step':
              return backendType as 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'mash_step' | 'fermentation_step'
            default:
              return 'misc' // Default fallback
          }
        }
        
        const frontendType = mapIngredientType(removedItem.type)
        
        // Create fake data with just the ID for removal
        const ingredientData = { id: removedItem.id } as RecipeGrain | RecipeHop | RecipeYeast | RecipeMisc | RecipeWater | RecipeMashStep | RecipeFermentationStep
        
        return { 
          recipeId: uuidRegex.test(toolResult.recipe_id) ? toolResult.recipe_id : null,
          ingredientData: ingredientData,
          ingredientType: frontendType,
          calculations: 'updated_calculations' in toolResult ? toolResult.updated_calculations : undefined
        }
      }
      
      // For delete_recipe operation
      if ('deleted_recipe_id' in toolResult && toolResult.deleted_recipe_id && typeof toolResult.deleted_recipe_id === 'string') {
        return { 
          recipeId: uuidRegex.test(toolResult.deleted_recipe_id) ? toolResult.deleted_recipe_id : null
        }
      }
    }

    // Recipe-level operations: create_recipe, clone_recipe, update_recipe
    if ('recipe' in toolResult && toolResult.recipe && typeof toolResult.recipe === 'object' && 'id' in toolResult.recipe) {
      // Type the recipe object based on the expected MCP response structure
      const recipe = toolResult.recipe as {
        id: string
        user_id: string
        name: string
        description: string | null
        batch_size_liters: number
        boil_time_minutes: number | null
        efficiency_percent: number | null
        mash_thickness: number | null
        brewing_notes: string | null
        tasting_notes: string | null
        bjcp_style_id: string | null
        created_at: string
        updated_at: string | null
        calculated_og?: number
        calculated_fg?: number
        calculated_abv?: number
        calculated_ibu?: number
        calculated_ebc?: number
        bjcp_style_summary?: {
          name: string
          number: string
          category: string
          vital_statistics: {
            og_min: number
            og_max: number
            fg_min: number
            fg_max: number
            abv_min: number
            abv_max: number
            ibu_min: number
            ibu_max: number
            ebc_min: number
            ebc_max: number
          }
        }
      }
      
      return { 
        recipeId: recipe.id,
        recipeMetadata: {
          id: recipe.id,
          user_id: recipe.user_id,
          name: recipe.name,
          description: recipe.description,
          batch_size_liters: recipe.batch_size_liters,
          boil_time_minutes: recipe.boil_time_minutes ?? 60,
          efficiency_percent: recipe.efficiency_percent ?? 75,
          mash_thickness: recipe.mash_thickness,
          brewing_notes: recipe.brewing_notes,
          tasting_notes: recipe.tasting_notes,
          bjcp_style_id: recipe.bjcp_style_id,
          created_at: recipe.created_at,
          updated_at: recipe.updated_at ?? recipe.created_at,
          beer_style: recipe.bjcp_style_summary ? {
            id: recipe.bjcp_style_id || '',
            name: recipe.bjcp_style_summary.name,
            number: recipe.bjcp_style_summary.number,
            category: recipe.bjcp_style_summary.category,
            category_number: '', // Not provided in MCP response, set default
            style_guide: 'BJCP', // Default to BJCP
            og_min: recipe.bjcp_style_summary.vital_statistics.og_min,
            og_max: recipe.bjcp_style_summary.vital_statistics.og_max,
            fg_min: recipe.bjcp_style_summary.vital_statistics.fg_min,
            fg_max: recipe.bjcp_style_summary.vital_statistics.fg_max,
            abv_min: recipe.bjcp_style_summary.vital_statistics.abv_min,
            abv_max: recipe.bjcp_style_summary.vital_statistics.abv_max,
            ibu_min: recipe.bjcp_style_summary.vital_statistics.ibu_min,
            ibu_max: recipe.bjcp_style_summary.vital_statistics.ibu_max,
            ebc_min: recipe.bjcp_style_summary.vital_statistics.ebc_min,
            ebc_max: recipe.bjcp_style_summary.vital_statistics.ebc_max,
            // Set default null values for fields not provided in MCP response
            overall_impression: null,
            aroma: null,
            appearance: null,
            flavor: null,
            mouthfeel: null,
            comments: null,
            history: null,
            characteristic_ingredients: null,
            style_comparison: null,
            commercial_examples: null,
            entry_instructions: null,
            tags: null,
            created_at: null,
            updated_at: null
          } : null
        },
        calculations: recipe.calculated_og ? {
          og: recipe.calculated_og,
          fg: recipe.calculated_fg,
          abv: recipe.calculated_abv,
          ibu: recipe.calculated_ibu,
          ebc: recipe.calculated_ebc
        } : ('updated_calculations' in toolResult ? toolResult.updated_calculations : undefined)
      }
    }
    
    return { recipeId: null }
  } catch (error) {
    debug.error('Failed to get recipe data from tool result:', error)
    return { recipeId: null }
  }
}

// Client-side helper functions for recipe update handling
export function shouldTriggerUpdate(toolName: string): boolean {
  const recipeModificationTools = [
    'create_recipe', 'update_recipe', 'delete_recipe', 'clone_recipe',
    'add_grain_to_recipe', 'add_hop_to_recipe', 'add_yeast_to_recipe', 'add_misc_to_recipe', 'add_water_to_recipe',
    'add_mash_step_to_recipe', 'add_fermentation_step_to_recipe',
    'update_grain_in_recipe', 'update_hop_in_recipe', 'update_yeast_in_recipe', 'update_misc_in_recipe', 'update_water_in_recipe',
    'update_mash_step_in_recipe', 'update_fermentation_step_in_recipe',
    'remove_grain_from_recipe', 'remove_hop_from_recipe', 'remove_yeast_from_recipe', 'remove_misc_from_recipe', 'remove_water_from_recipe',
    'remove_mash_step_from_recipe', 'remove_fermentation_step_from_recipe',
    'select_recipe'  // New tool for recipe selection
  ]
  return recipeModificationTools.includes(toolName)
}

export function getUpdateAction(toolName: string): 'refresh_list' | 'refresh_details' | 'add_recipe' | 'delete_recipe_efficient' | 'update_recipe_efficient' | 'select_recipe' {
  switch (toolName) {
    case 'create_recipe':
    case 'clone_recipe':
      return 'add_recipe'
    case 'delete_recipe':
      return 'delete_recipe_efficient'
    case 'update_recipe':
      return 'update_recipe_efficient'
    case 'select_recipe':
      return 'select_recipe'
    default:
      return 'refresh_details' // Ingredient operations
  }
}

// Export types for use in other modules
export type { MCPAllResults, IngredientUpdateData, MCPToolResult, MCPRecipeGrainResult, MCPRecipeHopResult, MCPRecipeYeastResult, MCPRecipeMiscResult, MCPRecipeWaterResult, MCPRecipeMashStepResult, MCPRecipeFermentationStepResult, MCPRecipeResult, MCPSelectRecipeResult, MCPDeleteResult } 