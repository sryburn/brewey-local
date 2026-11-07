import { useRecipeStore } from './recipe-store'
import { getUserRecipes, getRecipeWithIngredients, getRecipeCalculations, getRecipeSteps } from '@/lib/api/recipes'
import type { RecipeWithCalculations, RecipeWithIngredients, RecipeMashStep, RecipeFermentationStep } from '@/types/database'

jest.mock('@/lib/api/recipes', () => ({ getUserRecipes: jest.fn(), getRecipeWithIngredients: jest.fn(), getRecipeCalculations: jest.fn(), getRecipeSteps: jest.fn() }))

jest.mock('@/lib/api/profile', () => ({ getProfile: jest.fn().mockResolvedValue({ data: null, error: null }) }))

beforeEach(() => { useRecipeStore.getState().clearRecipeState(); useRecipeStore.getState().setUserId('user-one') })

test('a pending previous-account recipe list cannot repopulate after an identity change', async () => {
  let resolveRecipes: (value: Awaited<ReturnType<typeof getUserRecipes>>) => void = () => {}
  jest.mocked(getUserRecipes).mockImplementation(() => new Promise(resolve => { resolveRecipes = resolve }))
  const pending = useRecipeStore.getState().loadUserRecipes('user-one')
  useRecipeStore.getState().setUserId('user-two')
  const privateRecipe = { id: 'private-recipe', user_id: 'user-one', name: 'Previous account recipe' } as RecipeWithCalculations
  resolveRecipes({ data: [privateRecipe], error: null })
  await pending
  expect(useRecipeStore.getState().userId).toBe('user-two')
  expect(useRecipeStore.getState().userRecipes).toEqual([])
  expect(useRecipeStore.getState().selectedRecipeId).toBeNull()
  expect(useRecipeStore.getState().loading).toBe(false)
})

test('a pending previous-account recipe detail stops before fetching more data after signout', async () => {
  let resolveDetails: (value: Awaited<ReturnType<typeof getRecipeWithIngredients>>) => void = () => {}
  jest.mocked(getRecipeWithIngredients).mockImplementation(() => new Promise(resolve => { resolveDetails = resolve }))
  const pending = useRecipeStore.getState().loadRecipeDetails('private-recipe')
  useRecipeStore.getState().clearRecipeState()
  resolveDetails({ data: { id: 'private-recipe', user_id: 'user-one', name: 'Private' } as RecipeWithIngredients, error: null })
  await pending
  expect(getRecipeCalculations).not.toHaveBeenCalled()
  expect(useRecipeStore.getState().userId).toBeNull()
  expect(useRecipeStore.getState().recipeMetadata).toBeNull()
  expect(useRecipeStore.getState().recipeLoading).toBe(false)
})

test('canonical detail refresh replaces every process step after insertion or reorder', async () => {
  const recipeId = 'recipe-one'
  useRecipeStore.setState({ selectedRecipeId: recipeId, mashSteps: [{ id: 'old', step_order: 1 }] as RecipeMashStep[] })
  jest.mocked(getRecipeWithIngredients).mockResolvedValue({ data: { id: recipeId, user_id: 'user-one', name: 'Recipe' } as RecipeWithIngredients, error: null })
  jest.mocked(getRecipeCalculations).mockResolvedValue({ data: null, error: null })
  const mash = [{ id: 'inserted', step_order: 1 }, { id: 'old', step_order: 2 }] as RecipeMashStep[]
  const fermentation = [{ id: 'warm', step_order: 1 }, { id: 'cool', step_order: 2 }] as RecipeFermentationStep[]
  jest.mocked(getRecipeSteps).mockResolvedValueOnce({ data: mash, error: null }).mockResolvedValueOnce({ data: fermentation, error: null })
  await useRecipeStore.getState().triggerRefreshDetails(recipeId)
  expect(useRecipeStore.getState().mashSteps).toEqual(mash)
  expect(useRecipeStore.getState().fermentationSteps).toEqual(fermentation)
})

test('a late process refresh cannot replace the pane after selecting a different recipe', async () => {
  let finish: (value: Awaited<ReturnType<typeof getRecipeWithIngredients>>) => void = () => {}
  jest.mocked(getRecipeWithIngredients).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  useRecipeStore.setState({ selectedRecipeId: 'old-recipe' })
  const refresh = useRecipeStore.getState().triggerRefreshDetails('old-recipe')
  useRecipeStore.getState().setSelectedRecipe('new-recipe')
  finish({ data: { id: 'old-recipe', user_id: 'user-one', name: 'Old recipe' } as RecipeWithIngredients, error: null })
  await refresh
  expect(useRecipeStore.getState().selectedRecipeId).toBe('new-recipe')
  expect(useRecipeStore.getState().recipeMetadata).toBeNull()
  expect(getRecipeSteps).not.toHaveBeenCalled()
})
