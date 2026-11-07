import { memo } from 'react'

interface RecipeSelectorProps {
  selectedRecipeId: string | null
  userRecipes: Array<{id: string, name: string}>
  onRecipeChange: (recipeId: string) => void
  className?: string
  disabled?: boolean
}

export const RecipeSelector = memo<RecipeSelectorProps>(({
  selectedRecipeId,
  userRecipes,
  onRecipeChange,
  className = '',
  disabled = false
}) => {
  return (
    <select
      id="recipe-selector"
      name="recipe-selector"
      autoComplete="off"
      value={selectedRecipeId || ''}
      onChange={(e) => onRecipeChange(e.target.value)}
      className={className}
      disabled={disabled}
      aria-label="Select recipe"
    >
      {userRecipes.map((recipe) => (
        <option key={recipe.id} value={recipe.id}>
          {recipe.name}
        </option>
      ))}
    </select>
  )
})

RecipeSelector.displayName = 'RecipeSelector' 