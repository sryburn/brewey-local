import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { requireAdmin } from './auth.ts';
import { claimDatabaseBackup, databasePath, getDatabase, transaction } from './database.ts';
import { importStyleDescriptions } from './style-download.ts';

const KEY = 'ingredient_catalog_setup';
const tables = ['grains', 'hops', 'yeasts', 'misc_ingredients'] as const;
const relations = ['recipe_grains', 'recipe_hops', 'recipe_yeasts', 'recipe_misc'];
export type IngredientSetupStatus = {
    state: 'idle' | 'running' | 'ready' | 'partial' | 'failed';
    runId?: string; updatedAt: number; completed: number; total: number;
    phase?: string; counts: Record<string, number>; missing: string[];
    rejected?: number; error?: string;
};
function counts(db: DatabaseSync) { return Object.fromEntries(tables.map(table => [table, Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)])); }
function readStatus(db: DatabaseSync): IngredientSetupStatus {
    const row = db.prepare('SELECT value FROM installation_settings WHERE key=?').get(KEY);
    return row ? JSON.parse(String(row.value)) : { state: 'idle', updatedAt: 0, completed: 0, total: 0, counts: counts(db), missing: [] };
}
function save(db: DatabaseSync, status: IngredientSetupStatus) {
    db.prepare('INSERT INTO installation_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, JSON.stringify(status));
}
function recoverInterrupted(db: DatabaseSync) {
    const status = readStatus(db);
    if (status.state === 'running' && Date.now() - status.updatedAt > 60_000) {
        status.state = 'failed'; status.error = 'Ingredient setup was interrupted. Retry to continue using saved downloads.';
        save(db, status);
    }
    return status;
}
export function ingredientSetupStatus(adminId: string): IngredientSetupStatus {
    requireAdmin(adminId);
    return transaction(getDatabase(), () => recoverInterrupted(getDatabase()));
}

/** Generated output is still validated at the persistence boundary. */
function validateCatalogue(catalog: unknown): asserts catalog is Record<typeof tables[number], Array<Record<string, unknown> & { id: string }>> {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || Object.keys(catalog).sort().join() !== [...tables].sort().join()) throw new Error('Invalid ingredient catalogue.');
    const required: Record<string, string[]> = { grains: ['grain_type', 'color_ebc', 'extract_potential', 'must_mash'], hops: ['hop_type', 'form', 'alpha_acid_percent'], yeasts: ['yeast_type', 'form'], misc_ingredients: ['ingredient_type'] };
    const enums: Record<string, string[]> = { grain_type: ['base','specialty','adjunct','sugar','liquid_extract','dry_extract','fruit','juice','honey'], hop_type: ['bittering','aroma','aroma/bittering'], yeast_type: ['ale','lager','wine','champagne','wheat','brett','bacteria','other'], ingredient_type: ['water_agent','flavor','fining','spice','herb','wood','other','yeast_nutrient','wine_making','preservative','bottling','color'] };
    const fields: Record<string, string[]> = { grains: ['grain_type','color_ebc','extract_potential','must_mash','origin'], hops: ['alpha_acid_percent','beta_acid_percent','hop_type','form','origin'], yeasts: ['yeast_type','form','laboratory','product_id','attenuation_percent','temperature_range_min','temperature_range_max'], misc_ingredients: ['ingredient_type'] };
    const numbers: Record<string, [number, number]> = { color_ebc: [0,10000], extract_potential: [0,1], alpha_acid_percent: [0,100], beta_acid_percent: [0,100], attenuation_percent: [0,100], temperature_range_min: [-273.15,200], temperature_range_max: [-273.15,200] };
    const ids = new Set<string>(); let total = 0;
    for (const table of tables) {
        const rows = (catalog as Record<string, unknown>)[table];
        if (!Array.isArray(rows) || rows.length > 100_000) throw new Error('Invalid ingredient collection.');
        const names = new Set<string>();
        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.id) || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || names.has(row.name)) throw new Error('Invalid ingredient identity.');
            ids.add(row.id); names.add(row.name); total++;
            const allowed = ['id','name','notes','created_at','updated_at',...fields[table]];
            if (Object.keys(row).some(key => !allowed.includes(key)) || required[table].some(key => row[key] == null)) throw new Error('Invalid ingredient fields.');
            for (const [key, value] of Object.entries(row)) {
                if (numbers[key] && value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < numbers[key][0] || value > numbers[key][1])) throw new Error('Invalid ingredient number.');
                if (enums[key] && !enums[key].includes(String(value))) throw new Error('Invalid ingredient category.');
                if (!numbers[key] && key !== 'must_mash' && value != null && typeof value !== 'string') throw new Error('Invalid ingredient text.');
            }
            if (table === 'grains' && typeof row.must_mash !== 'boolean') throw new Error('Invalid mash flag.');
            if (table === 'hops' && !['pellet','whole','plug','extract','powder'].includes(row.form)) throw new Error('Invalid hop form.');
            if (table === 'yeasts' && !['liquid','dry','slant','culture'].includes(row.form)) throw new Error('Invalid yeast form.');
            if (row.temperature_range_min != null && row.temperature_range_max != null && row.temperature_range_min > row.temperature_range_max) throw new Error('Invalid temperature range.');
        }
    }
    if (!total) throw new Error('No usable ingredients were built.');
}

export function startIngredientSetup(adminId: string): IngredientSetupStatus {
    requireAdmin(adminId);
    const db = getDatabase(), path = databasePath();
    if (path === ':memory:') throw new Error('Ingredient setup requires a persistent database.');
    const claimed = transaction(db, () => {
        const current = recoverInterrupted(db);
        if (current.state === 'running') return { status: current, started: false };
        const status: IngredientSetupStatus = { state: 'running', runId: randomUUID(), updatedAt: Date.now(), completed: 0, total: 0, counts: counts(db), missing: [] };
        save(db, status); return { status, started: true };
    });
    if (!claimed.started) return claimed.status;
    const status = claimed.status;
    // Prevent database replacement while a child is preparing this installation.
    const reservation = claimDatabaseBackup();
    const directory = join(dirname(resolve(path)), 'ingredients');
    const output = join(directory, 'runs', status.runId!);
    const packaged = existsSync(resolve('catalog/manifest.json'));
    const manifest = resolve(process.env.BREWEY_INGREDIENT_MANIFEST || (packaged ? 'catalog/manifest.json' : '../catalog/manifest.json'));
    const builder = resolve(packaged ? 'scripts/build-ingredients.py' : '../scripts/build-ingredients.py');
    // This is private runtime storage, never a build-time asset to package.
    const cache = resolve(/* turbopackIgnore: true */ process.env.BREWEY_INGREDIENT_CACHE || join(directory, 'cache'));
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const update = () => { if (readStatus(db).runId === status.runId) { status.updatedAt = Date.now(); save(db, status); } };
    const fail = () => { status.state = 'failed'; status.error = 'Ingredient download or import failed. Your existing catalogue is unchanged. Retry to use saved downloads.'; try { update(); } catch { /* installation closed */ } };
    try {
        mkdirSync(output, { recursive: true, mode: 0o700 });
        const args = [builder, manifest, '--output', output, '--cache', cache, '--progress-json', '--network-budget', '300'];
        if (process.env.BREWEY_INGREDIENT_OFFLINE === 'true') args.push('--offline');
        const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONUNBUFFERED: '1' } });
        heartbeat = setInterval(() => { try { update(); } catch { child.kill(); } }, 10_000); heartbeat.unref();
        const timeout = setTimeout(() => child.kill('SIGKILL'), 7 * 60_000); timeout.unref();
        let buffer = '', failed = false;
        child.stdout.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            if (buffer.length > 64_000) { failed = true; child.kill(); return; }
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
                try {
                    const event = JSON.parse(line);
                    if (event.phase === 'sources' || event.phase === 'merge') {
                        status.phase = event.phase;
                        if (Number.isSafeInteger(event.completed) && Number.isSafeInteger(event.total) && event.completed >= 0 && event.total >= event.completed) { status.completed = event.completed; status.total = event.total; }
                        update();
                    }
                } catch { failed = true; child.kill(); }
            }
        });
        // Drain stderr without exposing paths or upstream response text to users.
        child.stderr.resume();
        child.on('error', () => { failed = true; });
        child.on('close', code => {
            clearTimeout(timeout); clearInterval(heartbeat);
            try {
                if (code !== 0 || failed) throw new Error('Builder failed.');
                requireAdmin(adminId);
                const raw = readFileSync(join(output, 'catalog.json'));
                if (raw.length > 32 * 1024 * 1024) throw new Error('Catalogue too large.');
                const catalog: unknown = JSON.parse(raw.toString()); validateCatalogue(catalog);
                const report = JSON.parse(readFileSync(join(output, 'build-report.json'), 'utf8'));
                const stylePath = join(output, 'styles.json');
                const styleText = existsSync(stylePath) ? readFileSync(stylePath) : Buffer.from('[]');
                if (styleText.length > 8 * 1024 * 1024) throw new Error('Styles too large.');
                const styles: unknown = JSON.parse(styleText.toString());
                transaction(db, () => {
                    if (readStatus(db).runId !== status.runId) throw new Error('Build superseded.');
                    for (const [index, table] of tables.entries()) {
                        const used = new Set(db.prepare(`SELECT DISTINCT catalog_id FROM ${relations[index]}`).all().map(row => row.catalog_id));
                        const insert = db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
                        for (const row of catalog[table]) if (!used.has(row.id)) insert.run(row.id, JSON.stringify(row));
                    }
                    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid ingredient references.');
                    importStyleDescriptions(db, styles);
                    status.missing = report.sources.filter((source: { status: string }) => source.status !== 'loaded').map((source: { id: string }) => source.id);
                    status.rejected = report.rejected.length;
                    status.state = report.partial || status.rejected ? 'partial' : 'ready';
                    status.counts = counts(db); status.phase = 'complete'; status.completed = status.total = report.sources.length;
                    db.prepare('INSERT INTO installation_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('ingredient_catalog_sha256', createHash('sha256').update(raw).digest('hex'));
                    update();
                });
            } catch { fail(); }
            finally { reservation.release(); }
        });
    } catch { clearInterval(heartbeat); fail(); reservation.release(); }
    return status;
}
