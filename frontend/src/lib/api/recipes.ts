import type { Recipe, RecipeWithCalculations, RecipeWithIngredients, RecipeMashStep, RecipeFermentationStep } from '@/types/database'
import { localApi } from './http'

// Ownership is checked by the server's session, never by a supplied browser ID.
export async function getUserRecipes(userId: string) {
  void userId
  const recipes: RecipeWithCalculations[] = []
  let offset = 0
  try {
    while (true) {
      const response = await fetch(`/api/v1/recipes?limit=200&offset=${offset}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) return { data: null, error: result.error || 'Unable to load recipes' }
      if (!Array.isArray(result.data)) return { data: null, error: 'Invalid recipe response' }
      recipes.push(...result.data)
      offset += result.data.length
      if (!result.meta || offset >= result.meta.total || result.data.length === 0) return { data: recipes, error: null }
    }
  } catch (error) { return { data: null, error: error instanceof Error ? error.message : 'Unable to load recipes' } }
}
export async function getRecipeWithIngredients(recipeId: string) {
  const result = await localApi<RecipeWithIngredients>(`/api/v1/recipes/${encodeURIComponent(recipeId)}`)
  if (result.data?.recipe_hops) result.data.recipe_hops = result.data.recipe_hops.map(hop => ({ ...hop,
    hops: hop.hops ? { ...hop.hops, alpha_acid_percent: hop.alpha_acid_percent_override ?? hop.hops.alpha_acid_percent } : undefined }))
  return result
}
export async function getRecipeCalculations(recipeId: string) { return localApi<RecipeWithCalculations>(`/api/v1/recipes/${encodeURIComponent(recipeId)}/calculations`) }
export async function createRecipe(recipe: Omit<Recipe, 'id' | 'created_at' | 'updated_at'>) {
  const body: Partial<typeof recipe> = { ...recipe }
  delete body.user_id
  return localApi<Recipe>('/api/v1/recipes', 'POST', body)
}
export async function updateRecipe(recipeId: string, updates: Partial<Omit<Recipe, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) { return localApi<Recipe>(`/api/v1/recipes/${encodeURIComponent(recipeId)}`, 'PATCH', updates) }
export async function deleteRecipe(recipeId: string) { return localApi<null>(`/api/v1/recipes/${encodeURIComponent(recipeId)}`, 'DELETE') }
export async function getRecipeSteps<T extends 'mash' | 'fermentation'>(recipeId: string, type: T) { return localApi<T extends 'mash' ? RecipeMashStep[] : RecipeFermentationStep[]>(`/api/v1/recipes/${encodeURIComponent(recipeId)}/steps/${type}`) }
