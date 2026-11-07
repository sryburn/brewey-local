import { createRecipe, getRecipeWithIngredients, getUserRecipes } from './recipes'
import { importNativeRecipe } from '@/lib/utils/native-import'
import type { Recipe } from '@/types/database'
beforeEach(() => { global.fetch = jest.fn() })
function reply(value: unknown, ok = true) { jest.mocked(fetch).mockResolvedValue({ ok, status: ok ? 200 : 400, json: async () => value } as Response) }
test('recipe list and creation use the verified session rather than a supplied account ID', async () => {
  reply({ data: [] }); await getUserRecipes('untrusted-id')
  expect(fetch).toHaveBeenLastCalledWith('/api/v1/recipes?limit=200&offset=0', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
  reply({ data: { id: 'created' } }); await createRecipe({ name: 'Recipe', user_id: 'untrusted-id' } as Omit<Recipe, 'id' | 'created_at' | 'updated_at'>)
  expect(fetch).toHaveBeenLastCalledWith('/api/v1/recipes', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Recipe' }) }))
})
test('recipe detail preserves the effective alpha-acid override used by the recipe pane', async () => {
  reply({ data: { id: 'recipe', recipe_hops: [{ alpha_acid_percent_override: 8, hops: { alpha_acid_percent: 5 } }] } })
  const result = await getRecipeWithIngredients('recipe')
  expect(result.data?.recipe_hops?.[0].hops?.alpha_acid_percent).toBe(8)
})
test('native import submits one atomic server operation and preserves actionable import errors', async () => {
  const payload = { format: 'brewey-native', version: '1.0', recipe: { name: 'Imported' }, grains: [{ grain_id: 'missing' }] }
  const unresolvedIngredients = [{ type: 'grain', id: 'missing', reason: 'both_failed' }]
  reply({ error: 'Ingredient not found', unresolvedIngredients }, false)
  expect(await importNativeRecipe(JSON.stringify(payload), 'untrusted-id')).toEqual(expect.objectContaining({ success: false, error: 'Ingredient not found', unresolvedIngredients }))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/api/v1/recipes/import', expect.objectContaining({ credentials: 'same-origin', body: JSON.stringify(payload) }))
})
