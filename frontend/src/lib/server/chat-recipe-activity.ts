import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type Activity = 'read' | 'modified';
interface RecipeActivityStore {
    recordRecipeActivity(turnId: string, recipeId: string, activity: Activity): void;
    captureRecipeActivity(turnId: string, recipeId: string): (activity: Activity) => void;
}

/** Receives resolved arguments and trusted results from the authenticated brewing core. */
export async function trackRecipeToolActivity(
    store: RecipeActivityStore, turnId: string, name: string, args: Record<string, unknown>,
    execute: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
    // Capture ownership/title before deletion, without recording an unsuccessful attempt.
    const deleted = name === 'delete_recipe' && typeof args.recipe_id === 'string'
        ? store.captureRecipeActivity(turnId, args.recipe_id) : undefined;
    const result = await execute();
    if (result.isError) return result;
    const content = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    let data: Record<string, unknown>;
    try { data = JSON.parse(content); } catch { return result; }
    if (!data || typeof data !== 'object' || data.success === false) return result;
    // Brewing changes are already committed. A metadata failure must never
    // report their success as a retryable mutation failure.
    const capture = (operation: () => void) => {
        try { operation(); } catch { console.warn('Unable to record chat recipe activity after a successful brewing operation.'); }
    };
    if (deleted) { capture(() => deleted('modified')); return result; }

    const record = (id: unknown, activity: Activity) => {
        if (typeof id === 'string') capture(() => store.recordRecipeActivity(turnId, id, activity));
    };
    const recipe = data.recipe as { id?: unknown } | undefined;
    if (name === 'search_recipes' && Array.isArray(data.recipes)) {
        for (const row of data.recipes) if (row && typeof row === 'object') record(row.id, 'read');
    } else if (name === 'get_recipe_by_id') {
        record(recipe?.id, 'read');
    } else if (name === 'find_styles_for_recipe') {
        record(args.recipe_id, 'read');
    } else if (name === 'clone_recipe') {
        record(args.recipe_id, 'read');
        record(recipe?.id, 'modified');
    } else if (name === 'create_recipe' || name === 'update_recipe') {
        record(recipe?.id, 'modified');
    } else if (/^(add|update|remove)_(grain|hop|yeast|misc|water|mash_step|fermentation_step)_(?:to|in|from)_recipe$/.test(name)) {
        // Relation IDs determine the actual target; model-provided recipe_id may differ.
        record(data.recipe_id, 'modified');
    }
    return result;
}
