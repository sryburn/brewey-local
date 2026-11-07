import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export interface BrewingClient {
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>
}

/** Request-scoped selection avoids mixing recipes between simultaneous chats. */
export class BrewingTools {
  private selectedRecipeId?: string
  readonly tools: Tool[]
  private definitions: Map<string, Tool>

  constructor(private client: BrewingClient, tools: Tool[], recipeId?: string) {
    this.selectedRecipeId = recipeId
    const select: Tool = {
      name: 'select_recipe', description: 'Select an accessible recipe for subsequent operations.',
      inputSchema: { type: 'object', properties: { recipe_id: { type: 'string' } }, required: ['recipe_id'] },
    }
    this.definitions = new Map([...tools, select].map(tool => [tool.name, tool]))
    this.tools = [...tools, select].map(tool => ({ ...tool, inputSchema: {
      ...tool.inputSchema,
      required: tool.name === 'select_recipe' ? tool.inputSchema.required : tool.inputSchema.required?.filter(field => field !== 'recipe_id'),
    } }))
  }

  async execute(name: string, input: Record<string, unknown>) {
    try {
      const definition = this.definitions.get(name)
      if (!definition) throw new Error('Unknown brewing tool.')
      const args = { ...input }
      if (definition.inputSchema.properties?.recipe_id && !args.recipe_id && this.selectedRecipeId) args.recipe_id = this.selectedRecipeId
      if (definition.inputSchema.required?.includes('recipe_id') && !args.recipe_id) throw new Error('Select a recipe first.')
      const result = await this.client.callTool(name === 'select_recipe' ? 'get_recipe_by_id' : name, args)
      const content = result.content.filter(item => item.type === 'text').map(item => (item as { text: string }).text).join('\n')
      let parsedResult: Record<string, unknown>
      try { parsedResult = JSON.parse(content) } catch { parsedResult = { content: result.content } }
      const success = !result.isError && parsedResult.success !== false
      if (success && (name === 'select_recipe' || name === 'create_recipe' || name === 'clone_recipe')) {
        const recipe = parsedResult.recipe as { id?: string } | undefined
        if (recipe?.id) this.selectedRecipeId = recipe.id
      }
      if (success && name === 'delete_recipe' && args.recipe_id === this.selectedRecipeId) this.selectedRecipeId = undefined
      return { success, content, parsedResult, ...(!success ? { errorMessage: String(parsedResult.error || content) } : {}) }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Brewing operation failed.'
      return { success: false, content: errorMessage, parsedResult: null, errorMessage }
    }
  }
}
