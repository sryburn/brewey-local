import { randomUUID } from 'node:crypto';
import type { Recipe, RecipeWithIngredients, RecipeWithCalculations, RecipeMashStep, RecipeFermentationStep } from '../../types/database.ts';
import { getDatabase, transaction, CATALOG_TABLES, RELATION_TABLES } from './database.ts';
import { calculateRecipe, calculateWater } from '../domain/index.ts';
// JSON values at the catalog/tool/import boundary are validated before storage.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RecordData = Record<string, any>;
export type CatalogTable = typeof CATALOG_TABLES[number];
export type RelationTable = typeof RELATION_TABLES[number];
export type FullRecipe = RecipeWithIngredients & {
    recipe_mash_steps: RecipeMashStep[];
    recipe_fermentation_steps: RecipeFermentationStep[];
};
export class RepositoryError extends Error {
    readonly status: number;
    constructor(message: string, status = 400) { super(message); this.name = 'RepositoryError'; this.status = status; }
}
const relationInfo = {
    recipe_grains: { catalog: 'grains', key: 'grain_id', nested: 'grains', fields: ['grain_id', 'amount_kg'], defaults: {} },
    recipe_hops: { catalog: 'hops', key: 'hop_id', nested: 'hops', fields: ['hop_id', 'amount_grams', 'time_minutes', 'use_type', 'alpha_acid_percent_override', 'temperature_c', 'dry_hop_duration_days', 'dry_hop_start_day'], defaults: { time_minutes: 0, use_type: 'boil', alpha_acid_percent_override: null, temperature_c: null, dry_hop_duration_days: null, dry_hop_start_day: null } },
    recipe_yeasts: { catalog: 'yeasts', key: 'yeast_id', nested: 'yeasts', fields: ['yeast_id', 'amount_units', 'unit_type'], defaults: { unit_type: 'packets' } },
    recipe_misc: { catalog: 'misc_ingredients', key: 'misc_id', nested: 'misc_ingredients', fields: ['misc_id', 'amount_units', 'unit_type', 'use_type', 'time_minutes', 'start_day', 'duration_days'], defaults: { unit_type: 'grams', use_type: 'boil', time_minutes: null, start_day: null, duration_days: null } },
    recipe_water: { catalog: null, key: null, nested: null, fields: ['name', 'volume_liters', 'ca_ppm', 'mg_ppm', 'na_ppm', 'so4_ppm', 'cl_ppm', 'hco3_ppm', 'base_ca_ppm', 'base_mg_ppm', 'base_na_ppm', 'base_so4_ppm', 'base_cl_ppm', 'base_hco3_ppm'], defaults: { ca_ppm: null, mg_ppm: null, na_ppm: null, so4_ppm: null, cl_ppm: null, hco3_ppm: null, base_ca_ppm: null, base_mg_ppm: null, base_na_ppm: null, base_so4_ppm: null, base_cl_ppm: null, base_hco3_ppm: null } },
    recipe_mash_steps: { catalog: null, key: null, nested: null, fields: ['step_order', 'name', 'temperature_c', 'duration_minutes', 'description'], defaults: { description: null } },
    recipe_fermentation_steps: { catalog: null, key: null, nested: null, fields: ['step_order', 'name', 'temperature_c', 'end_temperature_c', 'duration_days', 'description'], defaults: { description: null, end_temperature_c: null } },
} as const;
const recipeFields = ['name', 'description', 'batch_size_liters', 'boil_time_minutes', 'efficiency_percent', 'mash_thickness', 'brewing_notes', 'tasting_notes', 'bjcp_style_id'] as const;
function pick(data: RecordData, fields: readonly string[]): RecordData {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new RepositoryError('Expected an object.');
    return Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
}
function finite(value: unknown, name: string, min = 0, max = Number.MAX_VALUE): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
        throw new RepositoryError(`${name} must be a finite number between ${min} and ${max}.`);
}
function string(value: unknown, name: string, required = false, max = 100000): void {
    if (value == null && !required)
        return;
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
        throw new RepositoryError(`${name} must be ${required ? 'a nonempty' : 'a'} string (maximum ${max} characters).`);
}
function validateRecipe(row: RecordData): void {
    string(row.name, 'name', true, 200);
    finite(row.batch_size_liters, 'batch_size_liters', 0.001, 1000000);
    finite(row.boil_time_minutes, 'boil_time_minutes', 0, 1440);
    finite(row.efficiency_percent, 'efficiency_percent', 0.001, 100);
    if (row.mash_thickness != null)
        finite(row.mash_thickness, 'mash_thickness', 0.01, 100);
    for (const field of ['description', 'brewing_notes', 'tasting_notes', 'bjcp_style_id'])
        string(row[field], field);
}
function validateRelation(table: RelationTable, row: RecordData): void {
    for (const key of ['amount_kg', 'amount_grams', 'amount_units', 'volume_liters'])
        if (key in row)
            finite(row[key], key, 0.0000001);
    for (const key of ['time_minutes', 'dry_hop_duration_days', 'dry_hop_start_day', 'start_day', 'duration_days', 'duration_minutes'])
        if (row[key] != null)
            finite(row[key], key);
    for (const key of ['temperature_c', 'end_temperature_c'])
        if (row[key] != null)
            finite(row[key], key, -273.15, 200);
    if (row.alpha_acid_percent_override != null)
        finite(row.alpha_acid_percent_override, 'alpha_acid_percent_override', 0, 100);
    if (table === 'recipe_grains' && row.amount_kg === undefined)
        throw new RepositoryError('amount_kg is required.');
    if (table === 'recipe_hops' && row.amount_grams === undefined)
        throw new RepositoryError('amount_grams is required.');
    if (['recipe_yeasts', 'recipe_misc'].includes(table) && row.amount_units === undefined)
        throw new RepositoryError('amount_units is required.');
    if (table === 'recipe_hops' && !['boil', 'dry_hop', 'first_wort', 'whirlpool', 'mash'].includes(row.use_type))
        throw new RepositoryError('Invalid hop use_type.');
    if (table === 'recipe_yeasts' && !['packets', 'grams', 'ml', 'cells'].includes(row.unit_type))
        throw new RepositoryError('Invalid yeast unit_type.');
    if (table === 'recipe_misc') {
        if (!['grams', 'ml', 'tsp', 'tbsp', 'oz', 'tablets', 'drops', 'pieces'].includes(row.unit_type))
            throw new RepositoryError('Invalid misc unit_type.');
        if (!['mash', 'boil', 'primary', 'secondary', 'bottling', 'aging'].includes(row.use_type))
            throw new RepositoryError('Invalid misc use_type.');
    }
    if (table === 'recipe_water') {
        string(row.name, 'name', true, 200);
        if (row.volume_liters === undefined)
            throw new RepositoryError('volume_liters is required.');
        for (const key of relationInfo.recipe_water.fields.filter(x => x.endsWith('_ppm')))
            if (row[key] != null)
                finite(row[key], key, 0, 100000);
    }
    if (table.endsWith('_steps')) {
        string(row.name, 'name', true, 200);
        string(row.description, 'description');
        finite(row.step_order, 'step_order', 1, 10000);
        if (!Number.isInteger(row.step_order))
            throw new RepositoryError('step_order must be an integer.');
        finite(row.temperature_c, 'temperature_c', -273.15, 200);
        finite(row[table === 'recipe_mash_steps' ? 'duration_minutes' : 'duration_days'], 'duration', 0, 100000);
    }
}
function tableCheck(table: string, allowed: readonly string[]): void { if (!allowed.includes(table))
    throw new RepositoryError('Unknown repository table.'); }
export function getRepository(userId: string, database = getDatabase) {
    if (!userId)
        throw new RepositoryError('Authentication required.', 401);
    const db = database();
    function ownRecipe(id: string): Recipe {
        const row = db.prepare('SELECT * FROM recipes WHERE id=? AND user_id=?').get(id, userId);
        if (!row)
            throw new RepositoryError('Recipe not found or access denied.', 404);
        return row as unknown as Recipe;
    }
    function getCatalog(table: CatalogTable, id: string): RecordData | null {
        tableCheck(table, CATALOG_TABLES);
        if (typeof id !== 'string' || !id) return null;
        const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
        return row ? JSON.parse(String(row.data)) : null;
    }
    function matchingCatalog(table: CatalogTable, args: RecordData = {}): RecordData[] {
        tableCheck(table, CATALOG_TABLES);
        const rows = db.prepare(`SELECT data FROM ${table} ORDER BY json_extract(data,'$.name') COLLATE NOCASE`).all().map(row => JSON.parse(String(row.data)));
        return rows.filter(row => {
            for (const [key, value] of Object.entries(args)) {
                if (value == null || key === 'limit' || key === 'query')
                    continue;
                if (key === 'category_number') {
                    if (String(row[key]) !== String(value))
                        return false;
                }
                else if (key.startsWith('min_') || key.startsWith('max_')) {
                    const field = key.slice(4);
                    if (row[field] == null || (key.startsWith('min_') ? row[field] < value : row[field] > value))
                        return false;
                }
                else if (row[key] == null || !String(row[key]).toLowerCase().includes(String(value).toLowerCase()))
                    return false;
            }
            const query = args.query;
            if (query && !Object.values(row).join(' ').toLowerCase().includes(String(query).toLowerCase()))
                return false;
            return true;
        });
    }
    function searchCatalog(table: CatalogTable, args: RecordData = {}): RecordData[] {
        return matchingCatalog(table, args).slice(0, Math.max(1, Math.min(500, Number(args.limit) || 50)));
    }
    function parseRelation(table: RelationTable, row: RecordData): RecordData {
        const value = { ...JSON.parse(String(row.data)), id: row.id, recipe_id: row.recipe_id, created_at: row.created_at };
        const info = relationInfo[table];
        if (info.catalog && info.key && info.nested)
            value[info.nested] = getCatalog(info.catalog, value[info.key]);
        if (table === 'recipe_water')
            value.water_calculations = calculateWater(value);
        return value;
    }
    function listRelations(table: RelationTable, recipeId: string): RecordData[] {
        tableCheck(table, RELATION_TABLES);
        ownRecipe(recipeId);
        // Ownership is part of every relation query, not merely an earlier check.
        return db.prepare(`SELECT t.* FROM ${table} t JOIN recipes r ON r.id=t.recipe_id WHERE t.recipe_id=? AND r.user_id=? ORDER BY COALESCE(json_extract(t.data,'$.step_order'),0),t.created_at,t.id`).all(recipeId, userId).map(row => parseRelation(table, row));
    }
    function getRelation(table: RelationTable, id: string): RecordData {
        tableCheck(table, RELATION_TABLES);
        const row = db.prepare(`SELECT t.* FROM ${table} t JOIN recipes r ON r.id=t.recipe_id WHERE t.id=? AND r.user_id=?`).get(id, userId);
        if (!row)
            throw new RepositoryError('Recipe item not found or access denied.', 404);
        return parseRelation(table, row);
    }
    function reorderSteps(table: RelationTable, recipeId: string, movingId?: string, requestedOrder?: number): void {
        if (!table.endsWith('_steps'))
            return;
        const rows = listRelations(table, recipeId), moving = movingId ? rows.find(row => row.id === movingId) : undefined;
        const ordered = moving ? rows.filter(row => row.id !== movingId) : rows;
        if (moving)
            ordered.splice(Math.min(ordered.length, Math.max(0, (requestedOrder || 1) - 1)), 0, moving);
        for (const [rowIndex, row] of ordered.entries()) {
            const data = pick({ ...row, step_order: rowIndex + 1 }, relationInfo[table].fields);
            db.prepare(`UPDATE ${table} SET data=? WHERE id=? AND EXISTS(SELECT 1 FROM recipes WHERE recipes.id=${table}.recipe_id AND recipes.user_id=?)`).run(JSON.stringify(data), row.id, userId);
        }
    }
    function touchRecipe(id: string): void { db.prepare('UPDATE recipes SET updated_at=? WHERE id=? AND user_id=?').run(new Date().toISOString(), id, userId); }
    function getRecipe(id: string): FullRecipe {
        const recipe = ownRecipe(id) as FullRecipe;
        for (const table of RELATION_TABLES)
            Object.assign(recipe, { [table]: listRelations(table, id) });
        recipe.beer_styles = recipe.bjcp_style_id ? getCatalog('beer_styles', recipe.bjcp_style_id) as FullRecipe['beer_styles'] : null;
        return recipe;
    }
    function getCalculations(id: string): RecipeWithCalculations {
        const recipe = getRecipe(id);
        return { ...ownRecipe(id), ...calculateRecipe(recipe) };
    }
    function listRecipes(): RecipeWithCalculations[] {
        const rows = db.prepare('SELECT id FROM recipes WHERE user_id=? ORDER BY updated_at DESC,id').all(userId);
        return rows.map(row => getCalculations(String(row.id)));
    }
    function createRecipe(input: RecordData): Recipe {
        const data: RecordData = { description: null, batch_size_liters: 20, boil_time_minutes: 60, efficiency_percent: 75, mash_thickness: null, brewing_notes: null, tasting_notes: null, bjcp_style_id: null, ...pick(input, recipeFields) };
        validateRecipe(data);
        if (data.bjcp_style_id && !getCatalog('beer_styles', data.bjcp_style_id))
            throw new RepositoryError('Beer style not found.');
        const id = randomUUID(), now = new Date().toISOString();
        db.prepare(`INSERT INTO recipes(id,user_id,${recipeFields.join(',')},created_at,updated_at) VALUES (${Array(13).fill('?').join(',')})`).run(id, userId, ...recipeFields.map(key => data[key]), now, now);
        return ownRecipe(id);
    }
    function updateRecipe(id: string, input: RecordData): Recipe {
        return transaction(db, () => {
            const previous = ownRecipe(id), updates = pick(input, recipeFields);
            validateRecipe({ ...previous, ...updates });
            if (updates.bjcp_style_id && !getCatalog('beer_styles', updates.bjcp_style_id))
                throw new RepositoryError('Beer style not found.');
            const keys = Object.keys(updates);
            if (keys.length)
                db.prepare(`UPDATE recipes SET ${keys.map(key => `${key}=?`).join(',')},updated_at=? WHERE id=? AND user_id=?`).run(...keys.map(key => updates[key]), new Date().toISOString(), id, userId);
            return ownRecipe(id);
        });
    }
    function deleteRecipe(id: string): void { transaction(db, () => { ownRecipe(id); db.prepare('DELETE FROM recipes WHERE id=? AND user_id=?').run(id, userId); }); }
    function addRelation(table: RelationTable, recipeId: string, input: RecordData): RecordData {
        tableCheck(table, RELATION_TABLES);
        return transaction(db, () => {
            ownRecipe(recipeId);
            const info = relationInfo[table];
            const data: RecordData = { ...info.defaults, ...pick(input, info.fields) };
            if (table.endsWith('_steps') && data.step_order === undefined)
                data.step_order = listRelations(table, recipeId).reduce((max, row) => Math.max(max, row.step_order), 0) + 1;
            validateRelation(table, data);
            if (info.catalog && info.key && !getCatalog(info.catalog, data[info.key]))
                throw new RepositoryError(`${info.catalog} ingredient not found. Search the catalog first.`);
            const id = randomUUID(), now = new Date().toISOString();
            const args = [id, recipeId, ...(info.catalog && info.key ? [data[info.key]] : []), JSON.stringify(data), now];
            db.prepare(`INSERT INTO ${table}(id,recipe_id,${info.catalog ? 'catalog_id,' : ''}data,created_at) SELECT ${args.map(() => '?').join(',')} WHERE EXISTS(SELECT 1 FROM recipes WHERE id=? AND user_id=?)`).run(...args, recipeId, userId);
            reorderSteps(table, recipeId, id, data.step_order);
            touchRecipe(recipeId);
            return getRelation(table, id);
        });
    }
    function updateRelation(table: RelationTable, id: string, input: RecordData): RecordData {
        tableCheck(table, RELATION_TABLES);
        return transaction(db, () => {
            const previous = getRelation(table, id), info = relationInfo[table], data = pick({ ...previous, ...pick(input, info.fields) }, info.fields);
            validateRelation(table, data);
            if (info.catalog && info.key && !getCatalog(info.catalog, data[info.key]))
                throw new RepositoryError('Ingredient not found.');
            db.prepare(`UPDATE ${table} SET data=?${info.catalog ? ',catalog_id=?' : ''} WHERE id=? AND EXISTS(SELECT 1 FROM recipes WHERE recipes.id=${table}.recipe_id AND recipes.user_id=?)`).run(JSON.stringify(data), ...(info.catalog && info.key ? [data[info.key]] : []), id, userId);
            reorderSteps(table, previous.recipe_id, id, data.step_order);
            touchRecipe(previous.recipe_id);
            return getRelation(table, id);
        });
    }
    function removeRelation(table: RelationTable, id: string): RecordData {
        tableCheck(table, RELATION_TABLES);
        return transaction(db, () => {
            const row = getRelation(table, id);
            db.prepare(`DELETE FROM ${table} WHERE id=? AND EXISTS(SELECT 1 FROM recipes WHERE recipes.id=${table}.recipe_id AND recipes.user_id=?)`).run(id, userId);
            reorderSteps(table, row.recipe_id);
            touchRecipe(row.recipe_id);
            return row;
        });
    }
    function cloneRecipe(id: string, name: string): Recipe {
        return transaction(db, () => {
            const old = getRecipe(id), copy = createRecipe({ ...old, name });
            for (const table of RELATION_TABLES)
                for (const row of listRelations(table, id))
                    addRelation(table, copy.id, row);
            return copy;
        });
    }
    function getProfile(): {
        id: string;
        profile: string;
        unit_system: 'metric' | 'imperial';
        preferences: RecordData;
        updated_at: string | null;
    } {
        const row = db.prepare('SELECT * FROM user_profiles WHERE id=?').get(userId);
        return { id: userId, profile: String(row?.profile || ''), unit_system: row?.unit_system === 'imperial' ? 'imperial' : 'metric', preferences: JSON.parse(String(row?.preferences || '{}')), updated_at: row?.updated_at ? String(row.updated_at) : null };
    }
    function updateProfile(input: RecordData | string) {
        const updates = typeof input === 'string' ? { profile: input } : input;
        return transaction(db, () => {
            const profile = { ...getProfile(), ...pick(updates, ['profile', 'unit_system', 'preferences']) };
            string(profile.profile, 'profile', false, 10000);
            if (!['metric', 'imperial'].includes(profile.unit_system))
                throw new RepositoryError('Invalid unit system.');
            if (!profile.preferences || typeof profile.preferences !== 'object' || Array.isArray(profile.preferences))
                throw new RepositoryError('Preferences must be an object.');
            const now = new Date().toISOString();
            db.prepare('INSERT INTO user_profiles(id,profile,unit_system,preferences,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile,unit_system=excluded.unit_system,preferences=excluded.preferences,updated_at=excluded.updated_at').run(userId, profile.profile?.trim() || '', profile.unit_system, JSON.stringify(profile.preferences), now);
            return getProfile();
        });
    }
    function importNativeRecipe(payload: RecordData) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.format !== 'brewey-native' || !payload.recipe || typeof payload.recipe !== 'object' || Array.isArray(payload.recipe))
            throw new RepositoryError('Invalid Brewey native recipe.');
        if (payload.version !== undefined && payload.version !== '1.0.0')
            throw new RepositoryError('Unsupported Brewey native recipe version.');
        return transaction(db, () => {
            const recipeInput = { ...payload.recipe };
            if (recipeInput.bjcp_style_id && !getCatalog('beer_styles', recipeInput.bjcp_style_id)) {
                const style = recipeInput.bjcp_style_number ? searchCatalog('beer_styles', { number: recipeInput.bjcp_style_number, limit: 500 }).find(row => row.number.toLowerCase() === recipeInput.bjcp_style_number.toLowerCase()) : null;
                if (!style)
                    throw new RepositoryError('Beer style unavailable in this reference catalog.');
                recipeInput.bjcp_style_id = style.id;
            }
            const recipe = createRecipe(recipeInput);
            const keys = { recipe_grains: 'grains', recipe_hops: 'hops', recipe_yeasts: 'yeasts', recipe_misc: 'misc_ingredients', recipe_water: 'water', recipe_mash_steps: 'mash_steps', recipe_fermentation_steps: 'fermentation_steps' } as const;
            const missing: RecordData[] = [];
            for (const table of RELATION_TABLES) {
                const rows = payload[keys[table]] || [];
                if (!Array.isArray(rows) || rows.length > 1000)
                    throw new RepositoryError('Invalid recipe ingredient list.');
                for (const original of rows) {
                    const info = relationInfo[table], row = { ...original };
                    if (info.catalog && info.key) {
                        const details = original[`${table === 'recipe_misc' ? 'misc' : table.slice(7, -1)}_details`] || original[info.nested!] || original;
                        const id = row[info.key] || details[info.key] || details.id;
                        const ingredientName = details.name || original[`${table === 'recipe_misc' ? 'misc' : table.slice(7, -1)}_name`];
                        let catalog = getCatalog(info.catalog, id);
                        if (!catalog && ingredientName)
                            catalog = searchCatalog(info.catalog, { name: ingredientName, limit: 500 }).find(candidate => candidate.name.toLowerCase() === ingredientName.toLowerCase()) || null;
                        if (!catalog) {
                            missing.push({ type: info.catalog, name: ingredientName || id });
                            continue;
                        }
                        row[info.key] = catalog.id;
                    }
                    addRelation(table, recipe.id, row);
                }
            }
            if (missing.length)
                throw new RepositoryError(`Ingredients unavailable in the reference catalog: ${missing.map(row => row.name).join(', ')}. No recipe imported.`);
            return { success: true, recipeId: recipe.id, recipeName: recipe.name, recipe: getRecipe(recipe.id), missingIngredients: [] };
        });
    }
    return { userId, listRecipes, getRecipe, getCalculations, createRecipe, updateRecipe, deleteRecipe, cloneRecipe, getProfile, updateProfile, getCatalog, searchCatalog, matchingCatalog, listRelations, getRelation, addRelation, updateRelation, removeRelation, importNativeRecipe };
}
