export interface NativeImportResult {
  success: boolean
  recipeId?: string
  recipeName?: string
  error?: string
  missingIngredients?: MissingIngredient[]
  unresolvedIngredients?: UnresolvedIngredient[]
  constraintViolations?: ConstraintViolation[]
}

export interface ConstraintViolation {
  type: 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'mash_step' | 'fermentation_step'
  item: string
  field: string
  value: unknown
  reason: string
}

export interface UnresolvedIngredient {
  type: 'grain' | 'hop' | 'yeast' | 'misc'
  id: string
  name?: string
  reason: 'id_not_found' | 'name_not_found' | 'both_failed'
}

export interface MissingIngredient {
  type: 'grain' | 'hop' | 'yeast' | 'misc'
  id: string
  name?: string
}

// Validation, ingredient resolution and atomic writes belong to the local server.
export async function importNativeRecipe(content: string, userId: string): Promise<NativeImportResult> {
  void userId
  try {
    let payload
    try { payload = JSON.parse(content) } catch { return { success: false, error: 'Invalid JSON format in recipe file' } }
    if (payload?.format !== 'brewey-native' || !payload.recipe?.name) return { success: false, error: 'Not a valid native Brewey format file' }
    const response = await fetch('/api/v1/recipes/import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await response.json()
    if (!response.ok) return { success: false, error: result.error || 'Recipe import failed', missingIngredients: result.missingIngredients, unresolvedIngredients: result.unresolvedIngredients, constraintViolations: result.constraintViolations }
    return { success: true, recipeId: result.data.id, recipeName: result.data.name }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Recipe import failed' } }
}
