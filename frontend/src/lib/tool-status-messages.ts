/**
 * User-friendly tool call status messages for the chat interface.
 * Provides contextual, brewing-specific messages instead of generic loading indicators.
 */

export interface ToolStatusConfig {
  starting: string
  success?: string
  error?: string
}

export const TOOL_STATUS_MESSAGES: Record<string, ToolStatusConfig> = {
  // Recipe Operations
  create_recipe: {
    starting: "Creating your new recipe",
    success: "Recipe created successfully",
    error: "Failed to create recipe"
  },
  update_recipe: {
    starting: "Updating recipe details",
    success: "Recipe updated",
    error: "Failed to update recipe"
  },
  delete_recipe: {
    starting: "Removing recipe",
    success: "Recipe deleted",
    error: "Failed to delete recipe"
  },
  clone_recipe: {
    starting: "Duplicating recipe",
    success: "Recipe cloned",
    error: "Failed to clone recipe"
  },

  // Grain Operations
  add_grain_to_recipe: {
    starting: "Adding grain to recipe",
    success: "Grain added",
    error: "Failed to add grain"
  },
  update_grain_in_recipe: {
    starting: "Updating grain amount",
    success: "Grain updated",
    error: "Failed to update grain"
  },
  remove_grain_from_recipe: {
    starting: "Removing grain",
    success: "Grain removed",
    error: "Failed to remove grain"
  },

  // Hop Operations
  add_hop_to_recipe: {
    starting: "Adding hops to recipe",
    success: "Hops added",
    error: "Failed to add hops"
  },
  update_hop_in_recipe: {
    starting: "Updating hop schedule",
    success: "Hops updated",
    error: "Failed to update hops"
  },
  remove_hop_from_recipe: {
    starting: "Removing hops",
    success: "Hops removed",
    error: "Failed to remove hops"
  },

  // Yeast Operations
  add_yeast_to_recipe: {
    starting: "Adding yeast to recipe",
    success: "Yeast added",
    error: "Failed to add yeast"
  },
  update_yeast_in_recipe: {
    starting: "Updating yeast details",
    success: "Yeast updated",
    error: "Failed to update yeast"
  },
  remove_yeast_from_recipe: {
    starting: "Removing yeast",
    success: "Yeast removed",
    error: "Failed to remove yeast"
  },

  // Misc/Adjunct Operations
  add_misc_to_recipe: {
    starting: "Adding ingredient to recipe",
    success: "Ingredient added",
    error: "Failed to add ingredient"
  },
  update_misc_in_recipe: {
    starting: "Updating ingredient",
    success: "Ingredient updated",
    error: "Failed to update ingredient"
  },
  remove_misc_from_recipe: {
    starting: "Removing ingredient",
    success: "Ingredient removed",
    error: "Failed to remove ingredient"
  },

  // Water Operations
  add_water_to_recipe: {
    starting: "Adding water profile",
    success: "Water profile added",
    error: "Failed to add water profile"
  },
  update_water_in_recipe: {
    starting: "Updating water profile",
    success: "Water profile updated",
    error: "Failed to update water profile"
  },
  remove_water_from_recipe: {
    starting: "Removing water profile",
    success: "Water profile removed",
    error: "Failed to remove water profile"
  },

  // Mash Operations
  add_mash_step_to_recipe: {
    starting: "Adding mash step",
    success: "Mash step added",
    error: "Failed to add mash step"
  },
  update_mash_step_in_recipe: {
    starting: "Updating mash step",
    success: "Mash step updated",
    error: "Failed to update mash step"
  },
  remove_mash_step_from_recipe: {
    starting: "Removing mash step",
    success: "Mash step removed",
    error: "Failed to remove mash step"
  },

  // Fermentation Operations
  add_fermentation_step_to_recipe: {
    starting: "Adding fermentation step",
    success: "Fermentation step added",
    error: "Failed to add fermentation step"
  },
  update_fermentation_step_in_recipe: {
    starting: "Updating fermentation step",
    success: "Fermentation step updated",
    error: "Failed to update fermentation step"
  },
  remove_fermentation_step_from_recipe: {
    starting: "Removing fermentation step",
    success: "Fermentation step removed",
    error: "Failed to remove fermentation step"
  },

  // Lookup Operations
  search_grains: {
    starting: "Looking up grain options",
    success: "Found grain options",
    error: "Failed to find grains"
  },
  search_hops: {
    starting: "Looking up hop varieties",
    success: "Found hop options",
    error: "Failed to find hops"
  },
  search_yeasts: {
    starting: "Looking up yeast strains",
    success: "Found yeast options",
    error: "Failed to find yeasts"
  },
  search_misc_ingredients: {
    starting: "Looking up miscellaneous ingredients",
    success: "Found ingredient options",
    error: "Failed to find ingredients"
  },
  get_recipe_by_id: {
    starting: "Loading recipe details",
    success: "Recipe loaded",
    error: "Failed to load recipe"
  },
  search_recipes: {
    starting: "Searching recipes",
    success: "Recipe search completed",
    error: "Failed to search recipes"
  },

  // Calculation Operations
  calculate_og: {
    starting: "Calculating original gravity",
    success: "Gravity calculated",
    error: "Failed to calculate gravity"
  },
  calculate_ibu: {
    starting: "Calculating bitterness",
    success: "IBU calculated",
    error: "Failed to calculate IBU"
  },
  calculate_ebc: {
    starting: "Calculating color",
    success: "Color calculated",
    error: "Failed to calculate color"
  },

  // Beer Style Operations
  search_beer_styles: {
    starting: "Looking up beer styles",
    success: "Beer styles loaded",
    error: "Failed to load beer styles"
  },
  get_style_by_id: {
    starting: "Loading style details",
    success: "Style details loaded",
    error: "Failed to load style details"
  },
  find_styles_for_recipe: {
    starting: "Finding matching styles",
    success: "Style matches found",
    error: "Failed to find matching styles"
  },

  // User Profile Operations
  update_user_profile: {
    starting: "Updating your profile",
    success: "Profile updated successfully",
    error: "Failed to update profile"
  }
}

/**
 * Get a user-friendly status message for a tool operation
 */
export function getToolStatusMessage(
  toolName: string,
  status: 'starting' | 'success' | 'error',
  toolArgs?: Record<string, unknown>
): string {
  const config = TOOL_STATUS_MESSAGES[toolName]
  if (!config) {
    // Fallback for unknown tools
    return status === 'starting' ? 'Working on it...' :
           status === 'success' ? 'Done' :
           'Something went wrong'
  }

  let message = config[status] || config.starting

  // Add contextual details from tool arguments for certain operations
  if (status === 'starting' && toolArgs) {
    message = enhanceMessageWithContext(toolName, message, toolArgs)
  }

  return message
}

/**
 * Enhance status messages with specific ingredient names or quantities when available
 */
function enhanceMessageWithContext(toolName: string, baseMessage: string, toolArgs: Record<string, unknown>): string {
  try {
    // Add specific ingredient/amount info when available
    if (toolName.includes('grain')) {
      if (toolArgs.grain_name && typeof toolArgs.grain_name === 'string') {
        const amount = toolArgs.amount_kg ? ` (${toolArgs.amount_kg}kg)` : ''
        return toolName.includes('remove') ?
          `Removing ${toolArgs.grain_name}` :
          `Adding ${toolArgs.grain_name}${amount}`
      }
      // Handle grain operations with just amount
      if (toolName === 'add_grain_to_recipe' && toolArgs.amount_kg) {
        return `Adding ${toolArgs.amount_kg}kg grain to recipe`
      }
    }

    if (toolName.includes('hop')) {
      if (toolArgs.hop_name && typeof toolArgs.hop_name === 'string') {
        const amount = toolArgs.amount_grams ? ` (${toolArgs.amount_grams}g)` : ''
        return toolName.includes('remove') ?
          `Removing ${toolArgs.hop_name} hops` :
          `Adding ${toolArgs.hop_name} hops${amount}`
      }
      // Handle hop operations with just amount
      if (toolName === 'add_hop_to_recipe' && toolArgs.amount_grams) {
        return `Adding ${toolArgs.amount_grams}g hops to recipe`
      }
    }

    if (toolName.includes('yeast')) {
      if (toolArgs.yeast_name && typeof toolArgs.yeast_name === 'string') {
        return toolName.includes('remove') ?
          `Removing ${toolArgs.yeast_name} yeast` :
          `Adding ${toolArgs.yeast_name} yeast`
      }
      // Handle yeast operations with amount and unit
      if (toolName === 'add_yeast_to_recipe' && toolArgs.amount_units && toolArgs.unit_type) {
        return `Adding ${toolArgs.amount_units} ${toolArgs.unit_type} yeast to recipe`
      }
    }

    if (toolName.includes('misc')) {
      if (toolArgs.misc_name && typeof toolArgs.misc_name === 'string') {
        return toolName.includes('remove') ?
          `Removing ${toolArgs.misc_name}` :
          `Adding ${toolArgs.misc_name}`
      }
      // Handle misc operations with amount and unit
      if (toolName === 'add_misc_to_recipe' && toolArgs.amount_units && toolArgs.unit_type) {
        return `Adding ${toolArgs.amount_units} ${toolArgs.unit_type} ingredient to recipe`
      }
    }

    // Water operations
    if (toolName.includes('water')) {
      if (toolName === 'add_water_to_recipe' && toolArgs.name && toolArgs.volume_liters) {
        return `Adding ${toolArgs.volume_liters}L ${toolArgs.name} water`
      }
      if (toolName === 'add_water_to_recipe' && toolArgs.volume_liters) {
        return `Adding ${toolArgs.volume_liters}L water to recipe`
      }
    }

    // Mash step operations
    if (toolName === 'add_mash_step_to_recipe') {
      if (toolArgs.name && toolArgs.temperature_c && toolArgs.duration_minutes) {
        return `Adding ${toolArgs.name} mash step (${toolArgs.temperature_c}°C for ${toolArgs.duration_minutes}min)`
      }
      if (toolArgs.temperature_c && toolArgs.duration_minutes) {
        return `Adding mash step (${toolArgs.temperature_c}°C for ${toolArgs.duration_minutes}min)`
      }
    }

    // Fermentation step operations
    if (toolName === 'add_fermentation_step_to_recipe') {
      if (toolArgs.name && toolArgs.temperature_c && toolArgs.duration_days) {
        return `Adding ${toolArgs.name} fermentation step (${toolArgs.temperature_c}°C for ${toolArgs.duration_days}d)`
      }
      if (toolArgs.temperature_c && toolArgs.duration_days) {
        return `Adding fermentation step (${toolArgs.temperature_c}°C for ${toolArgs.duration_days}d)`
      }
    }

    // Recipe operations with recipe name
    if (toolName === 'create_recipe' && toolArgs.name && typeof toolArgs.name === 'string') {
      return `Creating "${toolArgs.name}"`
    }

    if (toolName === 'clone_recipe' && toolArgs.new_name && typeof toolArgs.new_name === 'string') {
      return `Cloning recipe as "${toolArgs.new_name}"`
    }

    // Search operations
    if (toolName === 'search_recipes' && toolArgs.name_filter && typeof toolArgs.name_filter === 'string') {
      return `Searching recipes for "${toolArgs.name_filter}"`
    }

    if (toolName === 'search_grains' && toolArgs.name_filter && typeof toolArgs.name_filter === 'string') {
      return `Looking up "${toolArgs.name_filter}" grains`
    }

    if (toolName === 'search_hops' && toolArgs.name_filter && typeof toolArgs.name_filter === 'string') {
      return `Looking up "${toolArgs.name_filter}" hops`
    }

    if (toolName === 'search_yeasts' && toolArgs.name_filter && typeof toolArgs.name_filter === 'string') {
      return `Looking up "${toolArgs.name_filter}" yeasts`
    }

    if (toolName === 'search_misc_ingredients' && toolArgs.name_filter && typeof toolArgs.name_filter === 'string') {
      return `Looking up "${toolArgs.name_filter}" ingredients`
    }

    // Style operations
    if (toolName === 'search_beer_styles' && toolArgs.search && typeof toolArgs.search === 'string') {
      return `Searching for "${toolArgs.search}" styles`
    }

  } catch {
    // If anything goes wrong with enhancement, fall back to base message
  }

  return baseMessage
}

/**
 * Get the default status message when no tool is executing
 */
export function getDefaultStatusMessage(isExecutingTool: boolean): string {
  return isExecutingTool ? 'Brewey is working...' : 'Brewey is thinking...'
}

