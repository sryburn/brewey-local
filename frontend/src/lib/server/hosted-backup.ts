import { randomUUID } from 'node:crypto';
import { backup } from 'node:sqlite';
import { mkdtemp, readFile, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedExportDatabase, CATALOG_TABLES, RELATION_TABLES, transaction } from './database.ts';
import { mapHostedIngredients } from './hosted-ingredients.ts';
import { BrewingApplication, recipeFields, relationFields } from './application-service.ts';
import { CAPABILITIES } from '../../types/access.ts';
import { hashPassword } from './password.ts';
import { normalizeUsername } from './identity.ts';
import { RepositoryError, type RecordData } from './repository.ts';

export interface HostedSnapshot {
    format: 'brewey-hosted-v1';
    user_id: string;
    tables: Record<string, RecordData[]>;
    calculations: RecordData[];
}
const relations = [
    ['recipe_grains', 'grains', 'grain'], ['recipe_hops', 'hops', 'hop'],
    ['recipe_yeasts', 'yeasts', 'yeast'], ['recipe_misc', 'misc_ingredients', 'misc'],
    ['recipe_water', 'water', 'water'], ['recipe_mash_steps', 'mash_steps', 'mash'],
    ['recipe_fermentation_steps', 'fermentation_steps', 'fermentation'],
] as const;
const pick = (row: RecordData, keys: readonly string[]) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const fail = (message: string): never => { throw new RepositoryError(message); };

/** Server-only: verifiedUserId MUST come from verified hosted authentication, never request JSON.
 * A fresh, isolated database per export; never changes process env or the local runtime database.
 */
export async function createHostedBackup(snapshot: HostedSnapshot, verifiedUserId: string, credentials: { username: string; password: string }): Promise<Buffer> {
    const username = normalizeUsername(credentials.username);
    const passwordHash = await hashPassword(credentials.password);
    if (!snapshot || snapshot.format !== 'brewey-hosted-v1' || !verifiedUserId || snapshot.user_id !== verifiedUserId) fail('Invalid authenticated hosted snapshot.');
    let tables = snapshot.tables;
    for (const table of ['recipes', 'user_profiles', ...CATALOG_TABLES, ...RELATION_TABLES]) {
        if (!Array.isArray(tables?.[table]) || tables[table].length > 100000) fail('Incomplete or oversized hosted snapshot.');
        const ids = new Set<string>();
        for (const row of tables[table]) {
            if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) fail('Invalid or duplicate snapshot record.');
            ids.add(row.id);
        }
    }
    if (tables.recipes.length > 10000 || tables.user_profiles.length > 1) fail('Hosted library exceeds export limits.');
    const owned = new Set(tables.recipes.map(row => row.id));
    if (tables.recipes.some(row => row.user_id !== verifiedUserId) || tables.user_profiles.some(row => row.id !== verifiedUserId) || RELATION_TABLES.some(table => tables[table].some(row => !owned.has(row.recipe_id)))) fail('Hosted snapshot contains data belonging to another account.');
    if (!Array.isArray(snapshot.calculations) || snapshot.calculations.length !== owned.size || new Set(snapshot.calculations.map(row => row.id)).size !== owned.size || snapshot.calculations.some(row => !owned.has(row.id))) fail('Incomplete hosted recipe calculations.');
    const mapped = mapHostedIngredients(tables);
    tables = mapped.tables;
    const grouped = new Map<string, Map<string, RecordData[]>>();
    for (const table of RELATION_TABLES) {
        const byRecipe = new Map<string, RecordData[]>();
        for (const row of tables[table]) {
            const rows = byRecipe.get(row.recipe_id) || []; rows.push(row); byRecipe.set(row.recipe_id, rows);
        }
        grouped.set(table, byRecipe);
    }
    const db = createHostedExportDatabase();
    let staging: string | undefined;
    try {
        const userId = randomUUID();
        transaction(db, () => {
            db.prepare('INSERT INTO users(id,username,password_hash,is_admin) VALUES(?,?,?,1)').run(userId, username, passwordHash);
            db.prepare("UPDATE installation_settings SET value='true' WHERE key='setup_complete'").run();
            db.prepare('INSERT INTO installation_settings(key,value) VALUES(?,?)').run('hosted_ingredient_migration', JSON.stringify({ version: 1, ...mapped.summary }));
            for (const table of CATALOG_TABLES) {
                const insert = db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
                for (const row of tables[table]) insert.run(row.id, JSON.stringify(row));
            }
            const app = new BrewingApplication({ userId, permissions: [...CAPABILITIES] }, () => db);
            const profile = tables.user_profiles[0];
            if (profile) app.updateProfile({ profile: profile.profile || '', unit_system: profile.unit_system || 'metric', preferences: {} });
            const expected = new Map(snapshot.calculations.map(row => [row.id, row]));
            const tolerance = { calculated_og: 0.0005, calculated_fg: 0.0005, calculated_abv: 0.005, calculated_ibu: 0.05, calculated_ebc: 0.05 };
            for (const original of tables.recipes) {
                const payload: RecordData = { format: 'brewey-native', version: '1.0.0', recipe: pick(original, recipeFields) };
                for (const [table, key, kind] of relations) payload[key] = (grouped.get(table)!.get(original.id) || []).map(row => pick(row, relationFields[kind]));
                const recipe = app.importRecipe(payload);
                const actual = app.calculations(recipe.id), baseline = expected.get(original.id)!;
                for (const [key, delta] of Object.entries(tolerance)) {
                    const before = baseline[key], after = actual[key as keyof typeof tolerance];
                    if (before == null && after == null) continue;
                    if (typeof before !== 'number' || !Number.isFinite(before) || typeof after !== 'number' || !Number.isFinite(after) || Math.abs(before - after) > delta) fail(`Recipe “${original.name}” has a calculation that differs from hosted Brewey (${key}). Export stopped; no incomplete backup was produced.`);
                }
                // Source timestamps are data, not identity or authority.
                if (![original.created_at, original.updated_at].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) fail('Invalid recipe timestamps.');
                db.prepare('UPDATE recipes SET created_at=?,updated_at=? WHERE id=?').run(original.created_at, original.updated_at, recipe.id);
            }
            if (db.prepare('PRAGMA foreign_key_check').all().length) fail('Invalid exported database references.');
        });
        staging = await mkdtemp(join(tmpdir(), 'brewey-hosted-export-'));
        const output = join(staging, 'brewey.sqlite');
        await backup(db, output); await chmod(output, 0o600);
        if ((await stat(output)).size > 100 * 1024 * 1024) fail('This library exceeds the 100 MiB backup limit.');
        return await readFile(output);
    } finally { db.close(); if (staging) await rm(staging, { recursive: true, force: true }); }
}
