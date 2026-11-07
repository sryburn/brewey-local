import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CAPABILITIES } from '../../types/access.ts';
import { legacyUsername } from './identity.ts';
import { applyReferenceCatalogUpdates } from './catalog-updates.ts';
import styleCatalog from './style-catalog.json' with { type: 'json' };
const state = globalThis as typeof globalThis & {
    __breweySqlite?: {
        path: string;
        db: DatabaseSync;
    };
    __breweyDatabaseMaintenance?: boolean;
    __breweyDatabaseBackups?: number;
};
export const SCHEMA_VERSION = 4;
export const CATALOG_TABLES = ['grains', 'hops', 'yeasts', 'misc_ingredients', 'beer_styles'] as const;
export const RELATION_TABLES = ['recipe_grains', 'recipe_hops', 'recipe_yeasts', 'recipe_misc', 'recipe_water', 'recipe_mash_steps', 'recipe_fermentation_steps'] as const;
export const CONVERSATION_TABLES = ['conversations', 'conversation_turns', 'conversation_messages', 'conversation_events', 'conversation_bindings', 'conversation_threads', 'conversation_recipe_activities'] as const;
export class DatabaseMaintenanceError extends Error {
    readonly status = 503;
    constructor() { super('Brewey is restoring its database. Restart the application before continuing.'); }
}
export function databasePath(): string { return process.env.BREWEY_DATABASE_PATH || resolve(process.env.BREWEY_DATA_DIR || '.runtime', 'brewey.sqlite'); }
/** One local connection per application process. SQLite serializes concurrent writers. */
export function getDatabase(): DatabaseSync {
    if (state.__breweyDatabaseMaintenance) throw new DatabaseMaintenanceError();
    const path = databasePath();
    if (state.__breweySqlite?.path === path)
        return state.__breweySqlite.db;
    closeDatabase();
    const db = openApplicationDatabase(path);
    state.__breweySqlite = { path, db };
    return db;
}
/** Trusted schema reference; never opens an uploaded file or replaces runtime state. */
export function createSchemaReference(version = SCHEMA_VERSION): DatabaseSync { return openApplicationDatabase(':memory:', version); }
/** Isolated hosted export: current schema/styles, without the historical ingredient seed. */
export function createHostedExportDatabase(): DatabaseSync { return openApplicationDatabase(':memory:', SCHEMA_VERSION); }
/** Only call for an isolated backup after its historical schema has been verified. */
export function upgradeBackupDatabase(path: string): void { openApplicationDatabase(path).close(); }
function openApplicationDatabase(path: string, targetVersion = SCHEMA_VERSION): DatabaseSync {
    if (path !== ':memory:')
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    // Set the main file's mode before creating WAL/SHM so they inherit private permissions.
    if (path !== ':memory:')
        chmodSync(path, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    try {
        const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
        if (version > SCHEMA_VERSION)
            throw new Error('The database schema is newer than this Brewey application.');
        if (version === 0)
            transaction(db, () => {
                db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
          user_metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(user_metadata)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
        CREATE INDEX sessions_user_id ON sessions(user_id);
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        CREATE TABLE user_profiles (id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, profile TEXT NOT NULL DEFAULT '',
          unit_system TEXT NOT NULL DEFAULT 'metric' CHECK(unit_system IN ('metric','imperial')), preferences TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(preferences)), updated_at TEXT NOT NULL);
      `);
                for (const table of CATALOG_TABLES)
                    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));`);
                db.exec(`CREATE TABLE recipes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, description TEXT, batch_size_liters REAL NOT NULL CHECK(batch_size_liters>0),
        boil_time_minutes REAL NOT NULL CHECK(boil_time_minutes>=0), efficiency_percent REAL NOT NULL CHECK(efficiency_percent>0 AND efficiency_percent<=100),
        mash_thickness REAL CHECK(mash_thickness IS NULL OR mash_thickness>0), brewing_notes TEXT, tasting_notes TEXT,
        bjcp_style_id TEXT REFERENCES beer_styles(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX recipes_owner_updated ON recipes(user_id, updated_at DESC);`);
                const catalog = ['grains', 'hops', 'yeasts', 'misc_ingredients', null, null, null];
                RELATION_TABLES.forEach((table, index) => {
                    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
          ${catalog[index] ? `catalog_id TEXT NOT NULL REFERENCES ${catalog[index]}(id),` : ''}
          data TEXT NOT NULL CHECK(json_valid(data)), created_at TEXT NOT NULL);
          CREATE INDEX ${table}_recipe ON ${table}(recipe_id);`);
                });
                for (const table of CATALOG_TABLES) {
                    const insert = db.prepare(`INSERT INTO ${table}(id,data) VALUES (?,?)`);
                    for (const row of table === 'beer_styles' ? styleCatalog : [])
                        insert.run(row.id, JSON.stringify(row));
                }
                db.exec(`PRAGMA user_version = 1`);
            });
        if (version < 2 && targetVersion >= 2) {
            // Rebuild only the users table to make email optional. Disable FK
            // actions outside the transaction so dependent IDs/data stay intact.
            db.exec('PRAGMA foreign_keys = OFF');
            try {
                transaction(db, () => {
                    db.exec(`CREATE TABLE users_v2 (
                        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                        email TEXT UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
                        user_metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(user_metadata)),
                        is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)),
                        identity_provider TEXT NOT NULL DEFAULT 'local' CHECK(identity_provider IN ('local','os')),
                        external_subject TEXT UNIQUE,
                        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    );
                    CREATE TABLE installation_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
                    const existing = db.prepare('SELECT * FROM users ORDER BY created_at,id').all() as Array<{id:string,email:string,password_hash:string,user_metadata:string,created_at:string,updated_at:string}>;
                    const used = new Set<string>();
                    const insert = db.prepare('INSERT INTO users_v2(id,username,email,password_hash,user_metadata,is_admin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
                    existing.forEach((user,index) => insert.run(user.id,legacyUsername(user.email,user.id,used),user.email,user.password_hash,user.user_metadata,index===0?1:0,user.created_at,user.updated_at));
                    db.exec('DROP TABLE users; ALTER TABLE users_v2 RENAME TO users;');
                    db.prepare('INSERT INTO installation_settings(key,value) VALUES(?,?)').run('setup_complete',existing.length?'true':'false');
                    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_tokens'").get()) {
                        for (const token of db.prepare('SELECT id,scopes FROM api_tokens').all() as Array<{id:string,scopes:string}>) {
                            let parsed: unknown;
                            try { parsed = JSON.parse(token.scopes); } catch { parsed = []; }
                            const permissions = Array.isArray(parsed) && parsed.some(scope=>scope==='api'||scope==='mcp') ? [...CAPABILITIES] : CAPABILITIES.filter(scope=>Array.isArray(parsed)&&parsed.includes(scope));
                            db.prepare('UPDATE api_tokens SET scopes=? WHERE id=?').run(JSON.stringify(permissions),token.id);
                        }
                    }
                    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Account migration found invalid data references.');
                    db.exec('PRAGMA user_version = 2');
                });
            } finally { db.exec('PRAGMA foreign_keys = ON'); }
        }
        if (version < 3 && targetVersion >= 3) transaction(db, () => {
            // Acquire the writer lock, then recheck: another application
            // process may have completed this migration while we waited.
            db.prepare('UPDATE installation_settings SET value=value WHERE key=?').run('setup_complete');
            if (Number(db.prepare('PRAGMA user_version').get()?.user_version) >= 3) return;
            db.exec(`
                CREATE TABLE conversations (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL, recipe_title TEXT,
                    scope_key TEXT NOT NULL, title TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('active','archived')),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, compacted_at TEXT,
                    summary TEXT, summary_through_sequence INTEGER NOT NULL DEFAULT 0 CHECK(summary_through_sequence>=0),
                    context_revision INTEGER NOT NULL DEFAULT 0 CHECK(context_revision>=0),
                    next_sequence INTEGER NOT NULL DEFAULT 0 CHECK(next_sequence>=0)
                );
                CREATE UNIQUE INDEX conversations_current_scope ON conversations(user_id,scope_key) WHERE status='active';
                CREATE INDEX conversations_owner_updated ON conversations(user_id,updated_at DESC);
                CREATE TABLE conversation_turns (
                    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
                    user_message_id TEXT NOT NULL, assistant_message_id TEXT NOT NULL,
                    adapter_id TEXT NOT NULL, model TEXT, input_message TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('running','completed','interrupted','failed')),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_expires_at INTEGER NOT NULL, error TEXT,
                    UNIQUE(user_id,request_id)
                );
                CREATE UNIQUE INDEX conversation_turns_one_running_user ON conversation_turns(user_id) WHERE status='running';
                CREATE INDEX conversation_turns_conversation ON conversation_turns(conversation_id,created_at);
                CREATE TABLE conversation_messages (
                    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    turn_id TEXT REFERENCES conversation_turns(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL CHECK(sequence>0), type TEXT NOT NULL CHECK(type IN ('user','assistant','system','action')),
                    content TEXT NOT NULL, timestamp TEXT NOT NULL,
                    metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata)),
                    UNIQUE(conversation_id,sequence)
                );
                CREATE TABLE conversation_events (
                    id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL CHECK(sequence>0), timestamp TEXT NOT NULL, event TEXT NOT NULL CHECK(json_valid(event)),
                    UNIQUE(turn_id,sequence)
                );
                CREATE TABLE conversation_bindings (
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    adapter_id TEXT NOT NULL, thread_id TEXT NOT NULL, through_sequence INTEGER NOT NULL CHECK(through_sequence>=0),
                    context_revision INTEGER NOT NULL CHECK(context_revision>=0), model TEXT,
                    PRIMARY KEY(conversation_id,adapter_id)
                );
                CREATE TABLE conversation_threads (
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    adapter_id TEXT NOT NULL, thread_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY(conversation_id,adapter_id,thread_id)
                );
                CREATE TRIGGER conversations_recipe_deleted BEFORE DELETE ON recipes BEGIN
                    UPDATE conversations SET recipe_id=NULL,status='archived',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                    WHERE recipe_id=OLD.id;
                END;
                PRAGMA user_version = 3;
            `);
        });
        if (version < 4 && targetVersion >= 4) transaction(db, () => {
            db.prepare('UPDATE installation_settings SET value=value WHERE key=?').run('setup_complete');
            if (Number(db.prepare('PRAGMA user_version').get()?.user_version) >= 4) return;
            if (db.prepare('SELECT c.id FROM conversations c JOIN recipes r ON r.id=c.recipe_id WHERE c.user_id<>r.user_id LIMIT 1').get()) throw new Error('Conversation migration found invalid recipe ownership.');
            db.exec(`
                ALTER TABLE conversation_turns ADD COLUMN selected_recipe_id TEXT;
                CREATE TABLE conversation_recipe_activities (
                    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    turn_id TEXT REFERENCES conversation_turns(id) ON DELETE CASCADE,
                    recipe_key TEXT NOT NULL CHECK(length(recipe_key)>0), recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
                    recipe_title TEXT NOT NULL,
                    activity TEXT NOT NULL CHECK(activity IN ('selected','read','modified','historical')),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX conversation_recipe_activity_unique ON conversation_recipe_activities(conversation_id,recipe_key,activity,coalesce(turn_id,''));
                CREATE INDEX conversation_recipe_activity_conversation ON conversation_recipe_activities(conversation_id);
                CREATE INDEX conversation_recipe_activity_recipe ON conversation_recipe_activities(recipe_id);
                INSERT INTO conversation_recipe_activities(id,conversation_id,turn_id,recipe_key,recipe_id,recipe_title,activity,created_at,updated_at)
                    SELECT 'historical:'||c.id,c.id,NULL,coalesce(c.recipe_id,substr(c.scope_key,8)),c.recipe_id,
                        coalesce(c.recipe_title,r.name,'Recipe'),'historical',c.created_at,c.updated_at
                    FROM conversations c LEFT JOIN recipes r ON r.id=c.recipe_id
                    WHERE c.recipe_id IS NOT NULL OR substr(c.scope_key,1,7)='recipe:';
                DROP INDEX conversations_current_scope;
                UPDATE conversations SET status='archived' WHERE status='active' AND id NOT IN (
                    SELECT id FROM (SELECT id,row_number() OVER(PARTITION BY user_id ORDER BY updated_at DESC,id ASC) AS position
                        FROM conversations WHERE status='active') WHERE position=1
                );
                UPDATE conversations SET scope_key='general',recipe_id=NULL,recipe_title=NULL;
                CREATE UNIQUE INDEX conversations_current_user ON conversations(user_id) WHERE status='active';
                DROP TRIGGER conversations_recipe_deleted;
                PRAGMA user_version = 4;
            `);
        });
        if (targetVersion >= 2) transaction(db, () => applyReferenceCatalogUpdates(db));
        if (path !== ':memory:')
            chmodSync(path, 0o600);
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
    // Savepoints make repository operations composable inside clone/import transactions.
    const name = `brew_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
        const value = operation();
        db.exec(`RELEASE ${name}`);
        return value;
    }
    catch (error) {
        db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
    }
}
export function closeDatabase(): void { state.__breweySqlite?.db.close(); delete state.__breweySqlite; }
/** A prepared download is tied to the installation which authorized it. */
export function claimDatabaseBackup(): { release(): void } {
    getDatabase();
    state.__breweyDatabaseBackups = (state.__breweyDatabaseBackups || 0) + 1;
    let released = false;
    return { release() { if (!released) { released = true; state.__breweyDatabaseBackups!--; } } };
}
/** One-process restore barrier. Success deliberately leaves it set until restart. */
export function claimDatabaseMaintenance(): { path: string; releaseOnFailure(): void } {
    const db = getDatabase(), path = databasePath();
    if (path === ':memory:') throw new Error('Restore requires a persistent SQLite database.');
    if (state.__breweyDatabaseBackups) throw Object.assign(new Error('Wait for backup preparation to finish before restoring.'), { status: 409 });
    if (db.prepare("SELECT id FROM conversation_turns WHERE status='running' LIMIT 1").get()) {
        const error = new Error('Wait for all chats and chat maintenance to finish before restoring.');
        throw Object.assign(error, { status: 409 });
    }
    state.__breweyDatabaseMaintenance = true;
    try {
        const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        if (Number(checkpoint?.busy) !== 0) throw new Error('The database is busy. Stop other database processes before restoring.');
        closeDatabase();
    } catch (error) { state.__breweyDatabaseMaintenance = false; throw error; }
    return { path, releaseOnFailure() { state.__breweyDatabaseMaintenance = false; } };
}
