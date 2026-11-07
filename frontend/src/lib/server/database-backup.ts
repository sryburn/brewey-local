import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, mkdtemp, chmod, copyFile, link, unlink, rm, open, realpath, writeFile, stat, rename } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { requireAdmin, needsSetup } from './auth.ts';
import { API_TOKEN_SCHEMA } from './tokens.ts';
import { CAPABILITIES } from '../../types/access.ts';
import { normalizeUsername } from './identity.ts';
import { databasePath, createSchemaReference, claimDatabaseMaintenance, claimDatabaseBackup, upgradeBackupDatabase, SCHEMA_VERSION, CATALOG_TABLES, RELATION_TABLES } from './database.ts';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export class BackupError extends Error {
    readonly status: number;
    constructor(message: string, status = 400) { super(message); this.status = status; }
}
type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
function schema(db: DatabaseSync): SchemaRow[] {
    return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all() as SchemaRow[];
}
function integrity(db: DatabaseSync) {
    const result = db.prepare('PRAGMA integrity_check').all();
    if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw new BackupError('The backup failed its SQLite integrity check.');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new BackupError('The backup contains invalid database references.');
}
function inspect(db: DatabaseSync) {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    integrity(db);
    const counts: Record<string, number> = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
        const identifier = '"' + String(name).replaceAll('"', '""') + '"';
        counts[String(name)] = Number(db.prepare(`SELECT count(*) AS count FROM ${identifier}`).get()?.count);
    }
    return { schemaVersion: Number(db.prepare('PRAGMA user_version').get()?.user_version), counts };
}

/** Shared operator/server machinery: online, committed-WAL-aware, standalone backup. */
export async function backupDatabase(database: string, output: string) {
    const sourcePath = await realpath(resolve(database)), outputPath = resolve(output);
    if (sourcePath === outputPath) throw new BackupError('Backup destination must differ from source.');
    await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(dirname(outputPath), '.brewey-backup-'));
    await chmod(staging, 0o700);
    const snapshot = join(staging, 'snapshot.sqlite'), restored = join(staging, 'restored.sqlite');
    let source: DatabaseSync | undefined, check: DatabaseSync | undefined, restore: DatabaseSync | undefined;
    try {
        const reserved = await open(snapshot, 'wx', 0o600); await reserved.close();
        source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec('PRAGMA busy_timeout=5000;');
        const pages = await backup(source, snapshot);
        source.close(); source = undefined;
        await chmod(snapshot, 0o600);
        check = new DatabaseSync(snapshot); check.exec('PRAGMA journal_mode=DELETE;');
        const expected = inspect(check); check.close(); check = undefined;
        await copyFile(snapshot, restored); await chmod(restored, 0o600);
        restore = new DatabaseSync(restored, { readOnly: true });
        const actual = inspect(restore); restore.close(); restore = undefined;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new BackupError('Backup restore verification failed.');
        const file = await open(snapshot, 'r'); try { await file.sync(); } finally { await file.close(); }
        await link(snapshot, outputPath); await unlink(snapshot);
        const directory = await open(dirname(outputPath), 'r'); try { await directory.sync(); } finally { await directory.close(); }
        return { success: true, pages, restore_verified: true, ...expected };
    } finally {
        for (const connection of [restore, check, source]) connection?.close();
        await rm(staging, { recursive: true, force: true }).catch(() => { console.warn('Unable to remove temporary SQLite backup files.'); });
    }
}

/** Entire SQLite installation; per-adapter files and external credentials are excluded. */
export async function createDatabaseBackup(adminId: string) {
    requireAdmin(adminId);
    const path = databasePath();
    if (path === ':memory:') throw new BackupError('Backup requires a persistent SQLite database.');
    const reservation = claimDatabaseBackup();
    let staging: string | undefined;
    try {
        staging = await mkdtemp(join(dirname(path), '.brewey-download-'));
        const output = join(staging, 'brewey.sqlite');
        await backupDatabase(path, output);
        const size = (await stat(output)).size;
        const directory = staging;
        return { path: output, size, cleanup: () => rm(directory, { recursive: true, force: true }) };
    } catch (error) { if (staging) await rm(staging, { recursive: true, force: true }).catch(() => { console.warn('Unable to remove temporary SQLite download files.'); }); throw error; }
    finally { reservation.release(); }
}

function jsonObject(value: unknown) {
    const parsed: unknown = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BackupError('Backup JSON fields must contain objects.');
    return parsed as Record<string, unknown>;
}
/** Compare all schema objects before executing migrations or inspecting data. */
function validateSchema(db: DatabaseSync) {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;');
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > SCHEMA_VERSION) throw new BackupError('This backup needs a newer Brewey release. Update Brewey before restoring it.');
    if (version < 2 || !Number.isInteger(version)) throw new BackupError('This Brewey backup version is not supported.');
    const actual = schema(db), reference = createSchemaReference(version);
    try {
        if (actual.some(row => row.name === 'api_tokens')) reference.exec(API_TOKEN_SCHEMA);
        if (JSON.stringify(actual) !== JSON.stringify(schema(reference))) throw new BackupError('The backup is not a compatible Brewey SQLite database.');
    } finally { reference.close(); }
    integrity(db);
    return version;
}
function validateCandidate(db: DatabaseSync) {
    validateSchema(db);
    const actual = schema(db);
    integrity(db);
    for (const row of db.prepare('SELECT username,user_metadata FROM users').iterate()) {
        if (normalizeUsername(row.username) !== row.username) throw new BackupError('The backup contains an invalid account name.');
        jsonObject(row.user_metadata);
    }
    for (const row of db.prepare('SELECT preferences FROM user_profiles').iterate()) jsonObject(row.preferences);
    for (const table of [...CATALOG_TABLES, ...RELATION_TABLES]) for (const row of db.prepare(`SELECT data FROM ${table}`).iterate()) jsonObject(row.data);
    for (const row of db.prepare('SELECT metadata FROM conversation_messages').iterate()) jsonObject(row.metadata);
    for (const row of db.prepare('SELECT event FROM conversation_events').iterate()) jsonObject(row.event);
    if (!db.prepare("SELECT id FROM users WHERE is_admin=1 AND identity_provider='local' AND (password_hash GLOB 'scrypt$*' OR password_hash GLOB '$2[aby]$*') LIMIT 1").get()) throw new BackupError('The backup must contain a local administrator account.');
    let usableAdmin = false;
    for (const row of db.prepare("SELECT password_hash FROM users WHERE is_admin=1 AND identity_provider='local'").iterate()) {
        if (/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(String(row.password_hash)) || /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(row.password_hash))) usableAdmin = true;
    }
    if (!usableAdmin) throw new BackupError('The backup must contain an administrator with usable local credentials.');
    if (actual.some(row => row.name === 'api_tokens')) for (const row of db.prepare('SELECT scopes FROM api_tokens').iterate()) {
        const scopes: unknown = JSON.parse(String(row.scopes));
        if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => !CAPABILITIES.includes(scope))) throw new BackupError('The backup contains invalid API token permissions.');
    }
    const invalid = [
        "SELECT id FROM conversations WHERE recipe_id IS NOT NULL OR recipe_title IS NOT NULL OR scope_key<>'general' LIMIT 1",
        'SELECT t.id FROM conversation_turns t JOIN conversations c ON c.id=t.conversation_id WHERE t.user_id<>c.user_id LIMIT 1',
        'SELECT m.id FROM conversation_messages m JOIN conversation_turns t ON t.id=m.turn_id WHERE m.conversation_id<>t.conversation_id LIMIT 1',
        `SELECT a.id FROM conversation_recipe_activities a JOIN conversations c ON c.id=a.conversation_id LEFT JOIN recipes r ON r.id=a.recipe_key LEFT JOIN conversation_turns t ON t.id=a.turn_id
         WHERE (r.id IS NOT NULL AND r.user_id<>c.user_id) OR (a.recipe_id IS NOT NULL AND a.recipe_id<>a.recipe_key)
            OR (a.turn_id IS NOT NULL AND t.conversation_id<>a.conversation_id) OR (a.activity='historical' AND a.turn_id IS NOT NULL)
            OR (a.activity<>'historical' AND a.turn_id IS NULL) OR length(a.recipe_key)>128 OR length(trim(a.recipe_title))=0 LIMIT 1`,
        `SELECT t.id FROM conversation_turns t WHERE t.selected_recipe_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_recipe_activities a WHERE a.turn_id=t.id AND a.activity='selected' AND a.recipe_key=t.selected_recipe_id) LIMIT 1`,
        `SELECT t.id FROM conversation_turns t LEFT JOIN conversation_messages u ON u.id=t.user_message_id LEFT JOIN conversation_messages a ON a.id=t.assistant_message_id
         WHERE NOT(t.input_message='/delete' AND t.user_message_id='' AND t.assistant_message_id='' AND t.adapter_id='maintenance')
           AND (u.id IS NULL OR a.id IS NULL OR u.conversation_id<>t.conversation_id OR a.conversation_id<>t.conversation_id OR u.turn_id IS NULL OR a.turn_id IS NULL OR u.turn_id<>t.id OR a.turn_id<>t.id OR u.type<>'user' OR a.type<>'assistant' OR u.sequence>=a.sequence) LIMIT 1`,
        `SELECT c.id FROM conversations c LEFT JOIN conversation_messages m ON m.conversation_id=c.id GROUP BY c.id HAVING c.next_sequence<coalesce(max(m.sequence),0) OR c.summary_through_sequence>c.next_sequence LIMIT 1`,
        'SELECT b.conversation_id FROM conversation_bindings b JOIN conversations c ON c.id=b.conversation_id WHERE b.through_sequence>c.next_sequence OR b.context_revision<>c.context_revision LIMIT 1',
    ];
    if (invalid.some(sql => !!db.prepare(sql).get())) throw new BackupError('The backup contains inconsistent chat ownership or history.');
    if (db.prepare("SELECT value FROM installation_settings WHERE key='setup_complete'").get()?.value !== 'true') throw new BackupError('The backup must contain a completed installation.');
    const revision = Number(db.prepare("SELECT value FROM installation_settings WHERE key='reference_catalog_revision'").get()?.value ?? 0);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new BackupError('The backup contains an invalid reference catalogue revision.');
}

export function requireFirstRunRestore() {
    if (process.env.DISABLE_SIGNUP === 'true' || !needsSetup()) throw new BackupError('First-run restore is closed. Sign in as an administrator to restore a backup.', 403);
}
function validateBytes(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BACKUP_BYTES) throw new BackupError('The backup must be at most 100 MiB.', 413);
    if (bytes.byteLength < 100 || Buffer.from(bytes.subarray(0, 16)).toString('binary') !== 'SQLite format 3\0' || bytes[18] !== 1 || bytes[19] !== 1) throw new BackupError('Choose a standalone SQLite backup file.');
}
async function prepareCandidate(candidate: string, bytes: Uint8Array) {
    validateBytes(bytes);
    await writeFile(candidate, bytes, { flag: 'wx', mode: 0o600 });
    let db: DatabaseSync | undefined;
    try {
        db = new DatabaseSync(candidate, { readOnly: true });
        const version = validateSchema(db);
        db.close(); db = undefined;
        if (version < SCHEMA_VERSION) upgradeBackupDatabase(candidate);
        db = new DatabaseSync(candidate);
        validateCandidate(db);
        db.exec('PRAGMA journal_mode=DELETE;');
        return {
            accounts: Number(db.prepare('SELECT count(*) AS n FROM users').get()?.n),
            recipes: Number(db.prepare('SELECT count(*) AS n FROM recipes').get()?.n),
            conversations: Number(db.prepare('SELECT count(*) AS n FROM conversations').get()?.n),
            schemaVersion: SCHEMA_VERSION, upgradedFrom: version < SCHEMA_VERSION ? version : null,
        };
    } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError('The backup could not be validated as a Brewey SQLite database.');
    } finally { db?.close(); }
}
export async function previewFirstRunBackup(bytes: Uint8Array) {
    requireFirstRunRestore(); validateBytes(bytes);
    const staging = await mkdtemp(join(dirname(databasePath()), '.brewey-preview-'));
    try {
        const result = await prepareCandidate(join(staging, 'candidate.sqlite'), bytes);
        requireFirstRunRestore();
        return result;
    } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function restoreFirstRunBackup(bytes: Uint8Array) {
    return installDatabaseBackup(requireFirstRunRestore, bytes);
}
/** Installs a validated supported-schema file; caller restarts after responding. */
export async function restoreDatabaseBackup(adminId: string, bytes: Uint8Array): Promise<{ restartRequired: true }> {
    return installDatabaseBackup(() => requireAdmin(adminId), bytes);
}
async function installDatabaseBackup(authorize: () => void, bytes: Uint8Array): Promise<{ restartRequired: true }> {
    authorize(); validateBytes(bytes);
    const path = databasePath(), staging = await mkdtemp(join(dirname(path), '.brewey-restore-'));
    const candidate = join(staging, 'candidate.sqlite'), safety = join(staging, 'before-restore.sqlite');
    let claim: ReturnType<typeof claimDatabaseMaintenance> | undefined, installed = false;
    try {
        await prepareCandidate(candidate, bytes);
        // Synchronous authorization + barrier closes both setup/restore races.
        authorize(); claim = claimDatabaseMaintenance();
        await backupDatabase(claim.path, safety);
        const db = new DatabaseSync(candidate);
        try {
            db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM conversation_bindings;');
            for (const row of db.prepare("SELECT id,assistant_message_id FROM conversation_turns WHERE status='running'").all()) {
                const error = 'Turn interrupted by database restore; partial transcript retained.';
                db.prepare("UPDATE conversation_turns SET status='interrupted',lease_expires_at=0,error=? WHERE id=?").run(error, String(row.id));
                const assistant = db.prepare('SELECT metadata FROM conversation_messages WHERE id=?').get(String(row.assistant_message_id));
                if (assistant) db.prepare('UPDATE conversation_messages SET metadata=? WHERE id=?').run(JSON.stringify({ ...jsonObject(assistant.metadata), isStreaming: false, isComplete: false, isExecutingTool: false, turnStatus: 'interrupted', error }), String(row.assistant_message_id));
            }
            db.exec('COMMIT; PRAGMA journal_mode=DELETE;'); integrity(db);
        } finally { db.close(); }
        const file = await open(candidate, 'r'); try { await file.sync(); } finally { await file.close(); }
        await rm(claim.path + '-wal', { force: true }); await rm(claim.path + '-shm', { force: true });
        await rename(candidate, claim.path); installed = true;
        // The atomic rename has committed the restore. Even an unsupported
        // directory fsync must return restartRequired rather than strand the
        // permanently blocked process behind an apparent failed restore.
        try {
            const directory = await open(dirname(claim.path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
        } catch { console.warn('SQLite restore was installed, but syncing the database directory failed. Restart required.'); }
        return { restartRequired: true };
    } finally {
        if (!installed) {
            claim?.releaseOnFailure();
            await rm(staging, { recursive: true, force: true }).catch(() => { console.warn('Unable to remove temporary SQLite restore files.'); });
        }
        // Successful restore retains exactly this private safety copy. The app
        // remains blocked; restarting discards all old async work and handles.
    }
}
