import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import metadata from './tool-metadata.json' with { type: 'json' };
import type { RecordData } from './repository.ts';
import { BrewingApplication, applicationForUser, type RelationKind, type CatalogKind } from './application-service.ts';
import type { Capability } from '../../types/access.ts';
import { hasCapability } from './access.ts';
import { installationDocument } from './installation-documents.ts';
const poundsToKg = 0.45359237, ouncesToGrams = 28.349523125, gallonsToLiters = 3.785411784;
const quartPerPoundToLiterPerKg = 0.946352946 / poundsToKg;
const relationNames: Record<string, RelationKind> = { grain: 'grain', hop: 'hop', yeast: 'yeast', misc: 'misc', water: 'water', mash_step: 'mash', fermentation_step: 'fermentation' };
const detailNames: Record<string, string> = { grain: 'grains', hop: 'hops', yeast: 'yeasts', misc: 'misc_ingredients' };
const catalogNames: Record<string, CatalogKind> = { search_grains: 'grain', search_hops: 'hop', search_yeasts: 'yeast', search_misc_ingredients: 'misc' };
function limit(value: unknown, fallback: number): number { return Math.max(1, Math.min(500, Number(value) || fallback)); }
function metricInput(input: RecordData, imperial: boolean): RecordData {
    const data = { ...input };
    if (imperial) {
        const conversions: Record<string, [
            string,
            (value: number) => number
        ]> = {
            amount_lb: ['amount_kg', value => value * poundsToKg], amount_oz: ['amount_grams', value => value * ouncesToGrams],
            batch_size_gallons: ['batch_size_liters', value => value * gallonsToLiters], volume_gallons: ['volume_liters', value => value * gallonsToLiters],
            temperature_f: ['temperature_c', value => (value - 32) * 5 / 9], end_temperature_f: ['end_temperature_c', value => (value - 32) * 5 / 9],
            min_batch_size_gallons: ['min_batch_size', value => value * gallonsToLiters], max_batch_size_gallons: ['max_batch_size', value => value * gallonsToLiters],
            min_color_srm: ['min_color_ebc', value => value * 1.97], max_color_srm: ['max_color_ebc', value => value * 1.97],
            min_temperature_f: ['min_temperature', value => (value - 32) * 5 / 9], max_temperature_f: ['max_temperature', value => (value - 32) * 5 / 9],
        };
        for (const [key, [target, convert]] of Object.entries(conversions))
            if (key in data) {
                data[target] = data[key] == null ? null : convert(data[key]);
                delete data[key];
            }
        if (data.mash_thickness != null)
            data.mash_thickness *= quartPerPoundToLiterPerKg;
    }
    if (data.misc_ingredient_id !== undefined)
        data.misc_id = data.misc_ingredient_id;
    return data;
}
/** Convert only physical dimensions; persisted/browser values always remain metric. */
function unitsOutput(value: unknown, imperial: boolean): unknown {
    if (!imperial)
        return value;
    if (Array.isArray(value))
        return value.map(row => unitsOutput(row, true));
    if (value === null || typeof value !== 'object')
        return value;
    const row = value as RecordData, result: RecordData = {};
    const conversions: Record<string, [
        string,
        (value: number) => number
    ]> = {
        amount_kg: ['amount_lb', v => v / poundsToKg], amount_grams: ['amount_oz', v => v / ouncesToGrams], batch_size_liters: ['batch_size_gallons', v => v / gallonsToLiters],
        volume_liters: ['volume_gallons', v => v / gallonsToLiters], temperature_c: ['temperature_f', v => v * 9 / 5 + 32], end_temperature_c: ['end_temperature_f', v => v * 9 / 5 + 32],
        temperature_range_min: ['temperature_range_min_f', v => v * 9 / 5 + 32], temperature_range_max: ['temperature_range_max_f', v => v * 9 / 5 + 32],
        calculated_ebc: ['calculated_srm', v => v / 1.97], color_ebc: ['color_srm', v => v / 1.97], ebc_min: ['srm_min', v => v / 1.97], ebc_max: ['srm_max', v => v / 1.97],
        total_grains_kg: ['total_grains_lb', v => v / poundsToKg], mash_thickness: ['mash_thickness_qt_per_lb', v => v / quartPerPoundToLiterPerKg],
    };
    for (const [key, item] of Object.entries(row)) {
        const conversion = conversions[key];
        if (conversion)
            result[conversion[0]] = item == null ? null : conversion[1](item);
        else
            result[key] = unitsOutput(item, true);
    }
    return result;
}
function validateArgs(schema: RecordData, args: RecordData): void {
    for (const key of schema.required || [])
        if (args[key] === undefined)
            throw new Error(`${key} is required.`);
    function valid(rule: RecordData, value: unknown): boolean {
        if (rule.anyOf)
            return rule.anyOf.some((child: RecordData) => valid(child, value));
        if (rule.type === 'null')
            return value === null;
        if (rule.type === 'array')
            return Array.isArray(value) && value.every(item => valid(rule.items || {}, item));
        if (rule.type === 'object')
            return !!value && typeof value === 'object' && !Array.isArray(value);
        if (rule.type && typeof value !== rule.type)
            return false;
        if (typeof value === 'number' && (!Number.isFinite(value) || (rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum)))
            return false;
        return !rule.enum || rule.enum.includes(value);
    }
    for (const [key, value] of Object.entries(args))
        if (schema.properties?.[key] && !valid(schema.properties[key], value))
            throw new Error(`Invalid ${key}.`);
}
function calculations(repo: BrewingApplication, id: string) {
    const row = repo.calculations(id);
    return { og: row.calculated_og, fg: row.calculated_fg, abv: row.calculated_abv, ibu: row.calculated_ibu, ebc: row.calculated_ebc };
}
function styleOutput(style: RecordData): RecordData {
    const vital_statistics = Object.fromEntries(['og', 'fg', 'abv', 'ibu', 'ebc'].flatMap(field => ['min', 'max'].map(end => [`${field}_${end}`, style[`${field}_${end}`] ?? null])));
    const result: RecordData = { ...style, vital_statistics };
    for (const key of Object.keys(vital_statistics))
        delete result[key];
    return result;
}
function recipeOutput(repo: BrewingApplication, id: string): RecordData {
    const recipe = repo.getRecipe(id), calculated = repo.calculations(id);
    const result: RecordData = { ...recipe, ...calculated, total_grains_kg: recipe.recipe_grains.reduce((sum, row) => sum + row.amount_kg, 0) };
    const kinds = ['grain', 'hop', 'yeast', 'misc', 'water', 'mash_step', 'fermentation_step'];
    const targets = ['grains', 'hops', 'yeasts', 'misc_ingredients', 'water', 'mash_steps', 'fermentation_steps'];
    kinds.forEach((kind, index) => {
        const table = relationNames[kind], rows = repo.listRelations(table, id);
        result[targets[index]] = rows.map(row => {
            const clean = { ...row, [`recipe_${kind}_id`]: row.id };
            if (detailNames[kind]) {
                const details = { ...row[detailNames[kind]], [`${kind === 'misc' ? 'misc_ingredient' : kind}_id`]: row[`${kind}_id`] };
                if (kind === 'hop')
                    details.alpha_acid_percent = row.alpha_acid_percent_override ?? details.alpha_acid_percent;
                clean[`${kind}_details`] = details;
                delete clean[detailNames[kind]];
            }
            return clean;
        });
        delete result[{ grain: 'recipe_grains', hop: 'recipe_hops', yeast: 'recipe_yeasts', misc: 'recipe_misc', water: 'recipe_water', mash: 'recipe_mash_steps', fermentation: 'recipe_fermentation_steps' }[table]];
    });
    if (recipe.beer_styles) {
        const style = styleOutput(recipe.beer_styles);
        result.bjcp_style_summary = { name: style.name, number: style.number, category: style.category, vital_statistics: style.vital_statistics };
    }
    delete result.beer_styles;
    return result;
}
export function brewingToolCapabilities(name: string): Capability[] {
    if (['get_terms_of_use', 'get_privacy_policy'].includes(name)) return [];
    if (name === 'update_user_profile') return ['profile:write'];
    if (name === 'find_styles_for_recipe') return ['recipes:read', 'catalog:read'];
    if (name.startsWith('search_') && name !== 'search_recipes' || name === 'get_style_by_id') return ['catalog:read'];
    if (name === 'get_recipe_by_id' || name === 'search_recipes') return ['recipes:read'];
    return ['recipes:write'];
}
export function listBrewingTools(userId: string, permissions?: Capability[]): Tool[] {
    const unit = applicationForUser(userId).unitSystem();
    const tools = structuredClone(metadata[unit]) as Tool[];
    return permissions ? tools.filter(tool => brewingToolCapabilities(tool.name).every(capability => hasCapability({ userId, permissions }, capability))) : tools;
}
export async function callBrewingTool(userId: string, name: string, args: Record<string, unknown> = {}, permissions?: Capability[]): Promise<CallToolResult> {
    try {
        const repo = permissions ? new BrewingApplication({ userId, permissions }) : applicationForUser(userId), imperial = repo.unitSystem() === 'imperial';
        const definition = listBrewingTools(userId, permissions).find(tool => tool.name === name);
        if (!definition)
            throw new Error('Unknown brewing tool.');
        validateArgs(definition.inputSchema, args);
        const data = metricInput(args, imperial);
        let result: RecordData;
        if (catalogNames[name]) {
            const table = catalogNames[name], filters: RecordData = { ...data, limit: limit(data.limit, 20) };
            for (const direction of ['min', 'max']) {
                if (data[`${direction}_alpha_acid`] !== undefined) {
                    filters[`${direction}_alpha_acid_percent`] = data[`${direction}_alpha_acid`];
                    delete filters[`${direction}_alpha_acid`];
                }
                if (data[`${direction}_beta_acid`] !== undefined) {
                    filters[`${direction}_beta_acid_percent`] = data[`${direction}_beta_acid`];
                    delete filters[`${direction}_beta_acid`];
                }
                if (data[`${direction}_attenuation`] !== undefined) {
                    filters[`${direction}_attenuation_percent`] = data[`${direction}_attenuation`];
                    delete filters[`${direction}_attenuation`];
                }
                if (data[`${direction}_temperature`] !== undefined) {
                    filters[direction === 'min' ? 'min_temperature_range_min' : 'max_temperature_range_max'] = data[`${direction}_temperature`];
                    delete filters[`${direction}_temperature`];
                }
            }
            const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]));
            result = { success: true, [{ grain: 'grains', hop: 'hops', yeast: 'yeasts', misc: 'misc_ingredients', style: 'beer_styles' }[table]]: repo.searchCatalog(table, query).items };
        }
        else if (name === 'create_recipe') {
            if (imperial && data.batch_size_liters === undefined)
                data.batch_size_liters = 5 * gallonsToLiters;
            const row = repo.createRecipe(Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'recipe_id')) as Parameters<BrewingApplication['createRecipe']>[0]);
            result = { success: true, recipe: recipeOutput(repo, row.id) };
        }
        else if (name === 'get_recipe_by_id')
            result = { success: true, recipe: recipeOutput(repo, data.recipe_id) };
        else if (name === 'update_recipe') {
            repo.updateRecipe(data.recipe_id, Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'recipe_id')));
            result = { success: true, recipe: recipeOutput(repo, data.recipe_id) };
        }
        else if (name === 'clone_recipe') {
            const row = repo.cloneRecipe(data.recipe_id, data.new_name);
            result = { success: true, recipe: recipeOutput(repo, row.id) };
        }
        else if (name === 'delete_recipe') {
            repo.deleteRecipe(data.recipe_id);
            result = { success: true, deleted_recipe_id: data.recipe_id, message: 'Recipe deleted.' };
        }
        else if (name === 'search_recipes') {
            const rows = repo.listRecipes(Object.fromEntries(Object.entries({ ...data, limit: limit(data.limit, 10) }).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]))).items;
            result = { success: true, recipes: rows };
        }
        else if (name === 'update_user_profile') {
            const profile = repo.updateProfile({ profile: data.profile });
            result = { success: true, message: 'Profile updated successfully', profile: profile.profile, updated_at: profile.updated_at };
        }
        else if (name === 'search_beer_styles') {
            const rows = repo.searchCatalog('style', { ...(data.search ? { q: data.search } : {}), limit: String(limit(data.limit, 20)) }).items.map(styleOutput);
            result = { styles: rows, total_count: rows.length, returned_count: rows.length };
        }
        else if (name === 'get_style_by_id') {
            const style = repo.searchCatalog('style', { limit: '500' }).items.find(row => row.id === data.style_id || row.number.toLowerCase() === data.style_id.toLowerCase());
            if (!style)
                throw new Error('Beer style not found.');
            result = { style: styleOutput(style) };
        }
        else if (name === 'find_styles_for_recipe') {
            const matched = repo.findStyles(data.recipe_id, data.keywords || [], limit(data.limit, 10));
            result = { ...matched, matching_styles: matched.matching_styles.map(row => ({ ...row, style: styleOutput(row.style) })) };
        }
        else if (name === 'get_terms_of_use' || name === 'get_privacy_policy')
            result = { success: true, document: installationDocument(name === 'get_terms_of_use' ? 'terms_of_use' : 'privacy_policy') };
        else {
            const match = name.match(/^(add|update|remove)_(grain|hop|yeast|misc|water|mash_step|fermentation_step)_(?:to|in|from)_recipe$/);
            if (!match)
                throw new Error('Unknown brewing operation.');
            const [, action, kind] = match, table = relationNames[kind];
            let row: RecordData;
            if (action === 'add') {
                row = repo.addRelation(table, data.recipe_id, Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'recipe_id' && key !== 'misc_ingredient_id')));
            }
            else if (action === 'update') {
                const previous = repo.getRelationById(table, data[`recipe_${kind}_id`]);
                row = repo.updateRelation(table, previous.recipe_id, data[`recipe_${kind}_id`], Object.fromEntries(Object.entries(data).filter(([key]) => !['recipe_id', `recipe_${kind}_id`, 'misc_ingredient_id'].includes(key))));
            }
            else {
                const previous = repo.getRelationById(table, data[`recipe_${kind}_id`]);
                row = repo.removeRelation(table, previous.recipe_id, data[`recipe_${kind}_id`]);
            }
            result = { success: true, recipe_id: row.recipe_id, updated_calculations: calculations(repo, row.recipe_id) };
            if (action === 'remove')
                Object.assign(result, { message: 'Recipe item removed.', removed_item: { id: row.id, type: kind } });
            else {
                result[`recipe_${kind}`] = row;
                if (detailNames[kind])
                    result[`${kind}_details`] = row[detailNames[kind]];
            }
        }
        const converted = unitsOutput(result, imperial) as RecordData;
        // Short calculation keys use the same colour unit as the rest of the MCP response.
        if (imperial && converted.updated_calculations) {
            converted.updated_calculations.srm = converted.updated_calculations.ebc == null ? null : converted.updated_calculations.ebc / 1.97;
            delete converted.updated_calculations.ebc;
        }
        return { content: [{ type: 'text', text: JSON.stringify(converted) }] };
    }
    catch (error) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Brewing operation failed.' }) }] };
    }
}
