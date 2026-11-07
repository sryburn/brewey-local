import { CAPABILITIES, type AccessPrincipal, type Capability } from '../../types/access.ts';
import type { Recipe, RecipeWithCalculations } from '../../types/database.ts';
import { requireCapability } from './access.ts';
import { getRepository, RepositoryError, type RecordData, type FullRecipe, type RelationTable, type CatalogTable } from './repository.ts';
import { getDatabase, transaction } from './database.ts';
import { calculateVitalStatsScore, calculateTextScore, calculateTieredRanking, calculateParameterAnalysis } from './style-ranking.ts';

export type RecipeInput = Pick<Recipe, 'name'> & Partial<Pick<Recipe, 'description' | 'batch_size_liters' | 'boil_time_minutes' | 'efficiency_percent' | 'mash_thickness' | 'brewing_notes' | 'tasting_notes' | 'bjcp_style_id'>>;
export type RecipePatch = Partial<RecipeInput>;
export type ProfileInput = { profile?: string; unit_system?: 'metric' | 'imperial'; preferences?: Record<string, unknown> };
export type CatalogKind = 'grain' | 'hop' | 'yeast' | 'misc' | 'style';
export type RelationKind = 'grain' | 'hop' | 'yeast' | 'misc' | 'water' | 'mash' | 'fermentation';
export type Query = Record<string, string>;
export interface Page<T> { items: T[]; total: number; limit: number; offset: number }
export interface NativeRecipeExport { format: 'brewey-native'; version: '1.0.0'; exported_at: string; recipe: RecipePatch & { bjcp_style_number?: string }; grains: RecordData[]; hops: RecordData[]; yeasts: RecordData[]; misc_ingredients: RecordData[]; water: RecordData[]; mash_steps: RecordData[]; fermentation_steps: RecordData[] }
export const CATALOG_KINDS = { grain: 'grains', hop: 'hops', yeast: 'yeasts', misc: 'misc_ingredients', style: 'beer_styles' } as const satisfies Record<CatalogKind, CatalogTable>;
export const RELATION_KINDS = { grain: 'recipe_grains', hop: 'recipe_hops', yeast: 'recipe_yeasts', misc: 'recipe_misc', water: 'recipe_water', mash: 'recipe_mash_steps', fermentation: 'recipe_fermentation_steps' } as const satisfies Record<RelationKind, RelationTable>;
export const recipeFields = ['name', 'description', 'batch_size_liters', 'boil_time_minutes', 'efficiency_percent', 'mash_thickness', 'brewing_notes', 'tasting_notes', 'bjcp_style_id'];
export const relationFields: Record<RelationKind, string[]> = {
    grain: ['grain_id', 'amount_kg'], hop: ['hop_id', 'amount_grams', 'time_minutes', 'use_type', 'alpha_acid_percent_override', 'temperature_c', 'dry_hop_duration_days', 'dry_hop_start_day'],
    yeast: ['yeast_id', 'amount_units', 'unit_type'], misc: ['misc_id', 'amount_units', 'unit_type', 'use_type', 'time_minutes', 'start_day', 'duration_days'],
    water: ['name', 'volume_liters', 'ca_ppm', 'mg_ppm', 'na_ppm', 'so4_ppm', 'cl_ppm', 'hco3_ppm', 'base_ca_ppm', 'base_mg_ppm', 'base_na_ppm', 'base_so4_ppm', 'base_cl_ppm', 'base_hco3_ppm'],
    mash: ['step_order', 'name', 'temperature_c', 'duration_minutes', 'description'], fermentation: ['step_order', 'name', 'temperature_c', 'end_temperature_c', 'duration_days', 'description'],
};
const catalogText: Record<CatalogKind, string[]> = { grain: ['name', 'origin', 'grain_type', 'must_mash', 'notes'], hop: ['name', 'origin', 'hop_type', 'form', 'notes'], yeast: ['name', 'yeast_type', 'form', 'laboratory', 'product_id', 'notes'], misc: ['name', 'ingredient_type', 'notes'], style: ['name', 'number', 'category', 'category_number', 'style_guide'] };
const catalogNumbers: Record<CatalogKind, string[]> = { grain: ['color_ebc', 'extract_potential'], hop: ['alpha_acid_percent', 'beta_acid_percent'], yeast: ['attenuation_percent', 'temperature_range_min', 'temperature_range_max'], misc: [], style: ['og_min', 'og_max', 'fg_min', 'fg_max', 'abv_min', 'abv_max', 'ibu_min', 'ibu_max', 'ebc_min', 'ebc_max'] };
function object(input: unknown): RecordData {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RepositoryError('Expected a JSON object.');
    return input as RecordData;
}
function fields(input: unknown, allowed: readonly string[]): RecordData {
    const data = object(input);
    for (const key of Object.keys(data)) if (!allowed.includes(key)) throw new RepositoryError(`Unknown field: ${key}.`);
    return { ...data };
}
function id(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new RepositoryError('Invalid resource ID.');
}
function kind<T extends string>(value: T, mapping: Record<T, string>): string {
    if (!Object.hasOwn(mapping, value)) throw new RepositoryError('Unknown resource kind.');
    return mapping[value];
}
function integer(value: string | undefined, fallback: number, max: number, min = 0): number {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new RepositoryError('Invalid pagination value.');
    return Number(value);
}
function page<T>(items: T[], query: Query): Page<T> {
    const limit = integer(query.limit, 50, 500, 1), offset = integer(query.offset, 0, 1_000_000);
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}
function validateQuery(query: Query, allowed: string[], numbers: string[] = []) {
    for (const [key, value] of Object.entries(query)) {
        if (!allowed.includes(key) || typeof value !== 'string' || value.length > 500) throw new RepositoryError(`Invalid query parameter: ${key}.`);
        if (numbers.includes(key) && (!value.trim() || !Number.isFinite(Number(value)))) throw new RepositoryError(`Invalid numeric filter: ${key}.`);
    }
    if (query.direction && !['asc', 'desc'].includes(query.direction)) throw new RepositoryError('Sort direction must be asc or desc.');
    for (const key of numbers.filter(key => key.startsWith('min_'))) {
        const maximum = `max_${key.slice(4)}`;
        if (query[key] !== undefined && query[maximum] !== undefined && Number(query[key]) > Number(query[maximum])) throw new RepositoryError(`Minimum exceeds maximum: ${key.slice(4)}.`);
    }
}

/** Transport-independent, authenticated operations. Physical quantities use explicit metric fields. */
export class BrewingApplication {
    private readonly principal: AccessPrincipal;
    private readonly repo: ReturnType<typeof getRepository>;
    private readonly database: typeof getDatabase;
    constructor(principal: AccessPrincipal, database = getDatabase) {
        id(principal.userId);
        // Copy the authority so a caller cannot change it after constructing the service.
        this.principal = { userId: principal.userId, permissions: [...principal.permissions] };
        this.database = database;
        this.repo = getRepository(principal.userId, database);
    }
    private require(capability: Capability) { requireCapability(this.principal, capability); }
    getRecipe(recipeId: string): FullRecipe { this.require('recipes:read'); id(recipeId); return this.repo.getRecipe(recipeId); }
    calculations(recipeId: string): RecipeWithCalculations { this.require('recipes:read'); id(recipeId); return this.repo.getCalculations(recipeId); }
    createRecipe(input: RecipeInput): Recipe { this.require('recipes:write'); return this.repo.createRecipe(fields(input, recipeFields)); }
    updateRecipe(recipeId: string, input: RecipePatch): Recipe {
        this.require('recipes:write'); id(recipeId);
        const updates = fields(input, recipeFields);
        return transaction(this.database(), () => {
            const updated = this.repo.updateRecipe(recipeId, updates);
            if (updates.boil_time_minutes !== undefined) {
                for (const resourceKind of ['hop', 'misc'] as const) {
                    for (const row of this.repo.listRelations(RELATION_KINDS[resourceKind], recipeId)) {
                        if (row.use_type === 'boil' && row.time_minutes > updated.boil_time_minutes) throw new RepositoryError('Boil time cannot be shorter than an existing boil addition. Update addition times first.');
                        if (resourceKind === 'hop' && row.use_type === 'first_wort' && updated.boil_time_minutes <= 0) throw new RepositoryError('First-wort hops require a positive boil time.');
                    }
                }
            }
            return updated;
        });
    }
    deleteRecipe(recipeId: string): void { this.require('recipes:write'); id(recipeId); this.repo.deleteRecipe(recipeId); }
    cloneRecipe(recipeId: string, newName: string): Recipe { this.require('recipes:write'); id(recipeId); return this.repo.cloneRecipe(recipeId, newName); }
    getProfile() { this.require('profile:read'); return this.repo.getProfile(); }
    updateProfile(input: ProfileInput) { this.require('profile:write'); return this.repo.updateProfile(fields(input, ['profile', 'unit_system', 'preferences'])); }
    /** Unit preference formats an adapter's arguments; it does not grant access to the full profile. */
    unitSystem(): 'metric' | 'imperial' { return this.repo.getProfile().unit_system; }
    listRecipes(query: Query = {}): Page<RecipeWithCalculations> {
        this.require('recipes:read');
        const numbers = ['abv', 'ibu', 'ebc', 'batch_size'].flatMap(field => [`min_${field}`, `max_${field}`]);
        validateQuery(query, ['q', 'name', 'description', 'ingredient', 'sort', 'direction', 'limit', 'offset', ...numbers], numbers);
        const sort = query.sort || 'updated_at';
        if (!['name', 'created_at', 'updated_at'].includes(sort)) throw new RepositoryError('Invalid recipe sort field.');
        const rows = this.repo.listRecipes().filter(row => {
            const contains = (value: string | null | undefined, wanted?: string) => !wanted || (value || '').toLowerCase().includes(wanted.toLowerCase());
            if (!contains(`${row.name} ${row.description || ''}`, query.q) || !contains(row.name, query.name) || !contains(row.description, query.description)) return false;
            for (const field of ['abv', 'ibu', 'ebc', 'batch_size']) {
                const value = field === 'batch_size' ? row.batch_size_liters : row[`calculated_${field}` as keyof RecipeWithCalculations];
                if (query[`min_${field}`] !== undefined && (value == null || Number(value) < Number(query[`min_${field}`]))) return false;
                if (query[`max_${field}`] !== undefined && (value == null || Number(value) > Number(query[`max_${field}`]))) return false;
            }
            if (query.ingredient) {
                const recipe = this.repo.getRecipe(row.id);
                const names = [...recipe.recipe_grains.map(item => item.grains?.name), ...recipe.recipe_hops.map(item => item.hops?.name), ...recipe.recipe_yeasts.map(item => item.yeasts?.name), ...recipe.recipe_misc.map(item => item.misc_ingredients?.name)];
                if (!names.some(name => contains(name, query.ingredient) && name)) return false;
            }
            return true;
        });
        const direction = query.direction || (sort === 'name' ? 'asc' : 'desc');
        rows.sort((a, b) => {
            const key = sort as 'name' | 'created_at' | 'updated_at';
            const comparison = a[key].toLowerCase().localeCompare(b[key].toLowerCase());
            return (direction === 'desc' ? -comparison : comparison) || a.id.localeCompare(b.id);
        });
        return page(rows, query);
    }
    searchCatalog(resourceKind: CatalogKind, query: Query = {}): Page<RecordData> {
        this.require('catalog:read'); kind(resourceKind, CATALOG_KINDS);
        const numbers = catalogNumbers[resourceKind].flatMap(field => [`min_${field}`, `max_${field}`]);
        validateQuery(query, ['q', 'sort', 'direction', 'limit', 'offset', ...catalogText[resourceKind], ...numbers], numbers);
        if (query.must_mash && !['true', 'false'].includes(query.must_mash)) throw new RepositoryError('must_mash must be true or false.');
        if (query.sort && query.sort !== 'name') throw new RepositoryError('Catalog sort field must be name.');
        const filters = Object.fromEntries(Object.entries(query).filter(([key]) => !['sort', 'direction', 'limit', 'offset', 'q'].includes(key)));
        const rows = this.repo.matchingCatalog(CATALOG_KINDS[resourceKind], { ...filters, query: query.q });
        rows.sort((a, b) => (query.direction === 'desc' ? -1 : 1) * String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()) || String(a.id).localeCompare(String(b.id)));
        return page(rows, query);
    }
    getCatalog(resourceKind: CatalogKind, resourceId: string): RecordData {
        this.require('catalog:read'); kind(resourceKind, CATALOG_KINDS); id(resourceId);
        const result = this.repo.getCatalog(CATALOG_KINDS[resourceKind], resourceId);
        if (!result) throw new RepositoryError('Catalog item not found.', 404);
        return result;
    }
    listRelations(resourceKind: RelationKind, recipeId: string): RecordData[] { this.require('recipes:read'); kind(resourceKind, RELATION_KINDS); id(recipeId); return this.repo.listRelations(RELATION_KINDS[resourceKind], recipeId); }
    getRelationById(resourceKind: RelationKind, itemId: string): RecordData {
        this.require('recipes:read'); kind(resourceKind, RELATION_KINDS); id(itemId);
        return this.repo.getRelation(RELATION_KINDS[resourceKind], itemId);
    }
    getRelation(resourceKind: RelationKind, recipeId: string, itemId: string): RecordData {
        this.require('recipes:read'); kind(resourceKind, RELATION_KINDS); id(recipeId); id(itemId);
        const row = this.repo.getRelation(RELATION_KINDS[resourceKind], itemId);
        if (row.recipe_id !== recipeId) throw new RepositoryError('Recipe item not found.', 404);
        return row;
    }
    addRelation(resourceKind: RelationKind, recipeId: string, input: RecordData): RecordData {
        this.require('recipes:write'); kind(resourceKind, RELATION_KINDS); id(recipeId);
        const data = fields(input, relationFields[resourceKind]);
        this.normalizeTiming(resourceKind, data, recipeId);
        return this.repo.addRelation(RELATION_KINDS[resourceKind], recipeId, data);
    }
    updateRelation(resourceKind: RelationKind, recipeId: string, itemId: string, input: RecordData): RecordData {
        this.require('recipes:write'); const previous = this.getRelation(resourceKind, recipeId, itemId);
        const data = fields(input, relationFields[resourceKind]);
        this.normalizeTiming(resourceKind, data, recipeId, previous);
        return this.repo.updateRelation(RELATION_KINDS[resourceKind], itemId, data);
    }
    removeRelation(resourceKind: RelationKind, recipeId: string, itemId: string): RecordData {
        this.require('recipes:write'); this.getRelation(resourceKind, recipeId, itemId);
        return this.repo.removeRelation(RELATION_KINDS[resourceKind], itemId);
    }
    private normalizeTiming(resourceKind: RelationKind, data: RecordData, recipeId: string, previous?: RecordData, boilOverride?: number) {
        if (resourceKind !== 'hop' && resourceKind !== 'misc') return;
        const use = data.use_type || previous?.use_type || 'boil', boil = boilOverride ?? this.repo.getRecipe(recipeId).boil_time_minutes;
        const changed = previous && data.use_type && data.use_type !== previous.use_type;
        const effectiveTime = data.time_minutes !== undefined ? data.time_minutes : previous?.time_minutes;
        if (use === 'boil' && effectiveTime != null && effectiveTime > boil) throw new RepositoryError('Addition time cannot exceed the recipe boil time. Update boil_time_minutes first.');
        if (resourceKind === 'hop') {
            if (['boil', 'whirlpool'].includes(use) && effectiveTime == null) throw new RepositoryError(`time_minutes is required for ${use} hops.`);
            if (use === 'first_wort') { if (boil <= 0) throw new RepositoryError('The recipe must have a positive boil time for first_wort hops.'); data.time_minutes = null; }
            else if (use === 'dry_hop') data.time_minutes = null;
            if (use !== 'dry_hop') { if (changed) { data.dry_hop_duration_days = null; data.dry_hop_start_day = null; } else { delete data.dry_hop_duration_days; delete data.dry_hop_start_day; } }
            if (use === 'whirlpool' && data.temperature_c == null && (!previous || previous.use_type !== 'whirlpool')) data.temperature_c = 80;
            if (use !== 'whirlpool') data.temperature_c = null;
        } else {
            if (['primary', 'secondary', 'aging'].includes(use)) data.time_minutes = null;
            else if (use === 'bottling') { data.time_minutes = null; data.start_day = null; data.duration_days = null; }
            else if (changed) { data.start_day = null; data.duration_days = null; }
            else { delete data.start_day; delete data.duration_days; }
        }
    }
    importRecipe(input: RecordData): FullRecipe {
        this.require('recipes:write');
        const payload = fields(input, ['format', 'version', 'exported_at', 'exported_by', 'recipe', 'grains', 'hops', 'yeasts', 'misc_ingredients', 'water', 'mash_steps', 'fermentation_steps']);
        if (payload.format !== 'brewey-native') throw new RepositoryError('Invalid Brewey native recipe.');
        if (payload.version !== '1.0.0') throw new RepositoryError('Native recipe version must be 1.0.0.');
        const recipe = fields(payload.recipe, [...recipeFields, 'bjcp_style_number']);
        const nativeKeys = { grain: 'grains', hop: 'hops', yeast: 'yeasts', misc: 'misc_ingredients', water: 'water', mash: 'mash_steps', fermentation: 'fermentation_steps' } as const;
        const names = { grain: 'grain', hop: 'hop', yeast: 'yeast', misc: 'misc' } as const;
        const nested = { grain: 'grains', hop: 'hops', yeast: 'yeasts', misc: 'misc_ingredients' } as const;
        const normalized: RecordData = { ...payload, recipe };
        for (const resourceKind of Object.keys(nativeKeys) as RelationKind[]) {
            const rows = payload[nativeKeys[resourceKind]] ?? [];
            if (!Array.isArray(rows) || rows.length > 1000) throw new RepositoryError('Invalid native recipe ingredient list.');
            const catalogKind = resourceKind in names ? resourceKind as keyof typeof names : undefined;
            const extra = catalogKind ? [`${names[catalogKind]}_name`, `${names[catalogKind]}_details`, nested[catalogKind]] : [];
            normalized[nativeKeys[resourceKind]] = rows.map(original => {
                const row = fields(original, [...relationFields[resourceKind], ...extra]);
                if (catalogKind) {
                    const suppliedName = row[`${names[catalogKind]}_name`];
                    if (suppliedName !== undefined && (typeof suppliedName !== 'string' || suppliedName.length > 200)) throw new RepositoryError('Invalid native ingredient name.');
                    for (const key of [`${names[catalogKind]}_details`, nested[catalogKind]]) if (row[key] !== undefined) object(row[key]);
                }
                const values = Object.fromEntries(relationFields[resourceKind].filter(key => row[key] !== undefined).map(key => [key, row[key]]));
                // Validate the original addition before repository defaults can obscure a missing timing field.
                this.normalizeTiming(resourceKind, values, '', undefined, recipe.boil_time_minutes ?? 60);
                for (const key of relationFields[resourceKind]) delete row[key];
                return { ...row, ...values };
            });
        }
        return this.repo.importNativeRecipe(normalized).recipe;
    }
    exportRecipe(recipeId: string): NativeRecipeExport {
        const recipe = this.getRecipe(recipeId);
        const clean = (rows: RecordData[], allowed: string[]) => rows.map(row => Object.fromEntries(allowed.filter(key => row[key] !== undefined).map(key => [key, row[key]])));
        return { format: 'brewey-native', version: '1.0.0', exported_at: new Date().toISOString(), recipe: { ...Object.fromEntries(recipeFields.map(key => [key, recipe[key as keyof FullRecipe]])), ...(recipe.beer_styles ? { bjcp_style_number: recipe.beer_styles.number } : {}) }, grains: clean(recipe.recipe_grains, relationFields.grain).map((row,index) => ({ ...row, grain_name: recipe.recipe_grains[index].grains?.name })), hops: clean(recipe.recipe_hops, relationFields.hop).map((row,index) => ({ ...row, hop_name: recipe.recipe_hops[index].hops?.name })), yeasts: clean(recipe.recipe_yeasts, relationFields.yeast).map((row,index) => ({ ...row, yeast_name: recipe.recipe_yeasts[index].yeasts?.name })), misc_ingredients: clean(recipe.recipe_misc, relationFields.misc).map((row,index) => ({ ...row, misc_name: recipe.recipe_misc[index].misc_ingredients?.name })), water: clean(recipe.recipe_water, relationFields.water), mash_steps: clean(recipe.recipe_mash_steps, relationFields.mash), fermentation_steps: clean(recipe.recipe_fermentation_steps, relationFields.fermentation) };
    }
    findStyles(recipeId: string, keywords: string[] = [], resultLimit = 10) {
        this.require('recipes:read'); this.require('catalog:read');
        if (!Array.isArray(keywords) || keywords.some(word => typeof word !== 'string') || !Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 500) throw new RepositoryError('Invalid style matching arguments.');
        const recipe = this.getRecipe(recipeId), calculated = this.calculations(recipeId);
        const values = { og: calculated.calculated_og, fg: calculated.calculated_fg, abv: calculated.calculated_abv, ibu: calculated.calculated_ibu, ebc: calculated.calculated_ebc };
        const matching = this.repo.matchingCatalog('beer_styles').map(style => {
            const hasVitals = ['og', 'fg', 'abv', 'ibu', 'ebc'].some(field => style[`${field}_min`] != null);
            const vital = hasVitals ? calculateVitalStatsScore(values, style) : 0, text = calculateTextScore(keywords.filter(word => word.trim().length > 1), style), rank = calculateTieredRanking(vital, text, hasVitals);
            return { style, match_tier: rank.tier, match_score: rank.finalScore, vital_stats_score: vital, text_match_score: text, match_reasoning: rank.reasoning, parameter_analysis: hasVitals ? calculateParameterAnalysis(values, style) : null };
        }).filter(row => row.match_score > 0).sort((a, b) => a.match_tier - b.match_tier || b.match_score - a.match_score);
        return { recipe: { id: recipe.id, name: recipe.name, calculated_values: values }, matching_styles: matching.slice(0, resultLimit), total_matches: matching.length, returned_count: Math.min(matching.length, resultLimit) };
    }
}

/** Only for already-verified local sessions: external clients must pass their own limited principal. */
export function applicationForUser(userId: string): BrewingApplication { return new BrewingApplication({ userId, permissions: [...CAPABILITIES] }); }
