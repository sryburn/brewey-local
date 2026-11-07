import { createHash } from 'node:crypto';
import index from './ingredient-migration-index.json' with { type: 'json' };
import { RepositoryError, type RecordData } from './repository.ts';

const fields: Record<string, string[]> = index.fields;
const selectors: Record<string, string | null> = index.selectors;
const relations = [
    ['grains', 'recipe_grains', 'grain_id'], ['hops', 'recipe_hops', 'hop_id'],
    ['yeasts', 'recipe_yeasts', 'yeast_id'], ['misc_ingredients', 'recipe_misc', 'misc_id'],
] as const;
const normal = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Match identity fields, never baseline UUIDs, approximate names or brewing values. */
export function canonicalIngredientId(table: string, row: RecordData): string | null {
    if (!fields[table]) return null;
    return selectors[JSON.stringify([table, ...fields[table].map(field => normal(row[field]))])] ?? null;
}

function privateId(table: string, sourceId: string): string {
    const hex = createHash('sha256').update(JSON.stringify(['brewey-hosted-ingredient-v1', table, sourceId])).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function properties(row: RecordData): string {
    // Names/notes can differ between aliases. Retain distinct brewing properties.
    return JSON.stringify(Object.fromEntries(Object.keys(row).sort().filter(key => !['id', 'name', 'notes', 'created_at', 'updated_at'].includes(key)).map(key => [key, row[key]])));
}

/** Operates on an export copy only. Missing downloads never prevent recipe restore. */
export function mapHostedIngredients(source: Record<string, RecordData[]>) {
    const tables = { ...source };
    const summary = { mapped: 0, preserved: 0, variants: 0, merged: 0 };
    for (const [table, relation, foreignKey] of relations) {
        const referenced = new Set(source[relation].map(row => row[foreignKey]));
        const available = new Map(source[table].map(row => [row.id, row]));
        if ([...referenced].some(id => typeof id !== 'string' || !available.has(id))) throw new RepositoryError('A recipe ingredient is missing from the hosted snapshot.');
        const mapped = new Map<string, string>(), rows = new Map<string, RecordData>();
        const variants = new Map<string, Map<string, string>>();
        for (const oldId of [...referenced].sort()) {
            const row = available.get(oldId)!;
            const canonical = canonicalIngredientId(table, row);
            let id = canonical ?? privateId(table, oldId);
            if (canonical) {
                const group = variants.get(canonical) ?? new Map<string, string>();
                const signature = properties(row);
                id = group.get(signature) ?? (group.size ? privateId(table, oldId) : canonical);
                group.set(signature, id); variants.set(canonical, group);
                if (id === canonical) summary.mapped++;
                else summary.variants++;
            } else summary.preserved++;
            mapped.set(oldId, id);
            if (rows.has(id)) summary.merged++;
            else rows.set(id, { ...row, id });
        }
        tables[table] = [...rows.values()];
        tables[relation] = source[relation].map(row => ({ ...row, [foreignKey]: mapped.get(row[foreignKey])! }));
    }
    return { tables, summary };
}
