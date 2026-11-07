import type { RecordData } from './repository.ts';
import { applicationForUser, type RelationKind } from './application-service.ts';
const relations: Record<string, RelationKind> = {
    grain: 'grain', hop: 'hop', yeast: 'yeast', misc: 'misc',
    water: 'water', mash_step: 'mash', fermentation_step: 'fermentation',
};
const nestedCatalog: Record<string, string> = { grain: 'grains', hop: 'hops', yeast: 'yeasts', misc: 'misc_ingredients' };
/** UI update data is metric even when the agent's tool text uses imperial units. */
export function canonicalRecipeToolResult(userId: string, name: string, result: unknown): unknown {
    if (!result || typeof result !== 'object' || Array.isArray(result))
        return result;
    const parsed = result as RecordData;
    if (parsed.success === false)
        return result;
    const relation = name.match(/^(add|update|remove)_(grain|hop|yeast|misc|water|mash_step|fermentation_step)_(?:to|in|from)_recipe$/);
    const recipeOperation = ['create_recipe', 'update_recipe', 'clone_recipe', 'select_recipe'].includes(name);
    if (!relation && !recipeOperation)
        return result;
    const repo = applicationForUser(userId);
    const relationRow = relation ? parsed[`recipe_${relation[2]}`] : undefined;
    const id = parsed.recipe?.id || relationRow?.recipe_id || parsed.recipe_id;
    if (typeof id !== 'string')
        return result;
    const recipe = repo.getRecipe(id);
    const values = repo.calculations(id);
    const canonical: RecordData = {
        ...parsed,
        updated_calculations: {
            og: values.calculated_og, fg: values.calculated_fg, abv: values.calculated_abv,
            ibu: values.calculated_ibu, ebc: values.calculated_ebc,
        },
    };
    if (recipeOperation) {
        canonical.recipe = { ...recipe, ...values };
        if (recipe.beer_styles) {
            const style = recipe.beer_styles;
            canonical.recipe.bjcp_style_summary = {
                name: style.name, number: style.number, category: style.category,
                vital_statistics: Object.fromEntries(['og', 'fg', 'abv', 'ibu', 'ebc'].flatMap(stat => ['min', 'max'].map(end => [`${stat}_${end}`, style[`${stat}_${end}` as keyof typeof style]]))),
            };
        }
    }
    if (relation && relation[1] !== 'remove' && typeof relationRow?.id === 'string') {
        const kind = relation[2];
        const row = repo.getRelation(relations[kind], id, relationRow.id);
        if (kind === 'hop' && row.hops) {
            row.hops = { ...row.hops, alpha_acid_percent: row.alpha_acid_percent_override ?? row.hops.alpha_acid_percent };
        }
        canonical[`recipe_${kind}`] = row;
        if (nestedCatalog[kind])
            canonical[`${kind}_details`] = row[nestedCatalog[kind]];
    }
    return canonical;
}
