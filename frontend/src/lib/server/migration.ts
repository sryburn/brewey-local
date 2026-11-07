import { getDatabase, transaction, CATALOG_TABLES, RELATION_TABLES, CONVERSATION_TABLES, SCHEMA_VERSION } from './database.ts';
import { type RecordData } from './repository.ts';
import { legacyUsername, normalizeUsername } from './identity.ts';
import { applyReferenceCatalogUpdates } from './catalog-updates.ts';
const conversationColumns: Record<typeof CONVERSATION_TABLES[number], readonly string[]> = {
    conversations: ['id', 'user_id', 'recipe_id', 'recipe_title', 'scope_key', 'title', 'status', 'created_at', 'updated_at', 'compacted_at', 'summary', 'summary_through_sequence', 'context_revision', 'next_sequence'],
    conversation_turns: ['id', 'conversation_id', 'user_id', 'request_id', 'user_message_id', 'assistant_message_id', 'adapter_id', 'model', 'input_message', 'status', 'created_at', 'updated_at', 'lease_expires_at', 'error', 'selected_recipe_id'],
    conversation_messages: ['id', 'conversation_id', 'turn_id', 'sequence', 'type', 'content', 'timestamp', 'metadata'],
    conversation_events: ['id', 'turn_id', 'sequence', 'timestamp', 'event'],
    conversation_bindings: ['conversation_id', 'adapter_id', 'thread_id', 'through_sequence', 'context_revision', 'model'],
    conversation_threads: ['conversation_id', 'adapter_id', 'thread_id', 'created_at'],
    conversation_recipe_activities: ['id', 'conversation_id', 'turn_id', 'recipe_key', 'recipe_id', 'recipe_title', 'activity', 'created_at', 'updated_at'],
};
function snapshotJsonObject(value: unknown): string {
    let decoded: unknown = value;
    if (typeof value === 'string') {
        try { decoded = JSON.parse(value); } catch { throw new Error('Invalid conversation JSON in snapshot.'); }
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Conversation metadata/events must be JSON objects.');
    return JSON.stringify(decoded);
}
/** Explicit administrator import. Accepts an in-memory snapshot; never discovers old data or credentials. */
export function importDatabaseSnapshot(snapshot: Record<string, RecordData[]>): Record<string, number> {
    const db = getDatabase();
    const tables = ['users', 'user_profiles', 'recipes', ...CATALOG_TABLES, ...RELATION_TABLES, ...CONVERSATION_TABLES];
    for (const table of tables) {
        const rows = snapshot[table] || [];
        if (!Array.isArray(rows))
            throw new Error(`Invalid snapshot table: ${table}`);
        const ids = new Set<string>();
        for (const row of rows) {
            const composite = table === 'conversation_bindings' || table === 'conversation_threads';
            const identity = composite ? JSON.stringify([row?.conversation_id, row?.adapter_id, ...(table === 'conversation_threads' ? [row?.thread_id] : [])]) : row?.id;
            if (!row || (composite ? typeof row.conversation_id !== 'string' || !row.conversation_id || typeof row.adapter_id !== 'string' || !row.adapter_id || typeof row.thread_id !== 'string' || !row.thread_id : typeof identity !== 'string' || !identity) || ids.has(identity))
                throw new Error(`Missing or duplicate ID in ${table}`);
            ids.add(identity);
        }
    }
    if (Number(db.prepare('SELECT count(*) AS count FROM users').get()?.count) || Number(db.prepare('SELECT count(*) AS count FROM recipes').get()?.count))
        throw new Error('Snapshot import requires an empty SQLite account and recipe database.');
    const counts: Record<string, number> = {};
    return transaction(db, () => {
        for (const table of CATALOG_TABLES) {
            if (snapshot[table])
                db.exec(`DELETE FROM ${table}`);
            const statement = db.prepare(`INSERT INTO ${table}(id,data) VALUES (?,?)`);
            for (const row of snapshot[table] || [])
                statement.run(row.id, JSON.stringify(row));
            counts[table] = (snapshot[table] || []).length;
        }
        const usernames = new Set<string>();
        const importedUsers = [...(snapshot.users || [])].sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
        for (const [index,row] of importedUsers.entries()) {
            if (!row.password_hash)
                throw new Error('Each imported user requires an explicitly transformed local password_hash.');
            const username = row.username ? normalizeUsername(row.username) : legacyUsername(row.email, row.id, new Set(usernames));
            if (usernames.has(username.toLowerCase())) throw new Error('Duplicate imported username.');
            usernames.add(username.toLowerCase());
            db.prepare('INSERT INTO users(id,username,email,password_hash,user_metadata,is_admin,identity_provider,external_subject,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(row.id, username, row.email || null, row.password_hash, typeof row.user_metadata === 'string' ? row.user_metadata : JSON.stringify(row.user_metadata || {}), row.is_admin === undefined ? Number(index === 0) : Number(!!row.is_admin), row.identity_provider || 'local', row.external_subject || null, row.created_at, row.updated_at || row.created_at);
        }
        counts.users = (snapshot.users || []).length;
        if (counts.users) db.prepare("INSERT OR REPLACE INTO installation_settings(key,value) VALUES('setup_complete','true')").run();
        for (const row of snapshot.user_profiles || []) {
            db.prepare('INSERT INTO user_profiles(id,profile,unit_system,preferences,updated_at) VALUES (?,?,?,?,?)').run(row.id, row.profile || '', (row.unit_system || row.preferences?.unit_system) === 'imperial' ? 'imperial' : 'metric', JSON.stringify(row.preferences || {}), row.updated_at || new Date().toISOString());
        }
        const fields = ['id', 'user_id', 'name', 'description', 'batch_size_liters', 'boil_time_minutes', 'efficiency_percent', 'mash_thickness', 'brewing_notes', 'tasting_notes', 'bjcp_style_id', 'created_at', 'updated_at'];
        const insertRecipe = db.prepare(`INSERT INTO recipes(${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
        for (const row of snapshot.recipes || [])
            insertRecipe.run(...fields.map(key => row[key] ?? null));
        counts.recipes = (snapshot.recipes || []).length;
        const ids = { recipe_grains: 'grain_id', recipe_hops: 'hop_id', recipe_yeasts: 'yeast_id', recipe_misc: 'misc_id' } as const;
        for (const table of RELATION_TABLES) {
            const catalogKey = ids[table as keyof typeof ids];
            const insert = db.prepare(`INSERT INTO ${table}(id,recipe_id,${catalogKey ? 'catalog_id,' : ''}data,created_at) VALUES (${Array(catalogKey ? 5 : 4).fill('?').join(',')})`);
            for (const row of snapshot[table] || []) {
                const data = { ...row };
                for (const key of ['id', 'recipe_id', 'created_at', 'water_calculations'])
                    delete data[key];
                if (table === 'recipe_misc' && !data.misc_id)
                    data.misc_id = data.misc_ingredient_id;
                insert.run(row.id, row.recipe_id, ...(catalogKey ? [data[catalogKey]] : []), JSON.stringify(data), row.created_at || new Date().toISOString());
            }
            counts[table] = (snapshot[table] || []).length;
        }
        let conversationRows = snapshot.conversations || [];
        const activityRows = [...(snapshot.conversation_recipe_activities || [])];
        if (snapshot.conversation_recipe_activities === undefined) {
            // Explicit older snapshots use per-recipe active scopes. Preserve their
            // original association before unifying current state, as schema4 does.
            const winners = new Map<string, RecordData>();
            for (const row of conversationRows) {
                const recipe = row.recipe_id ? db.prepare('SELECT user_id,name FROM recipes WHERE id=?').get(row.recipe_id) : null;
                if (recipe && recipe.user_id !== row.user_id) throw new Error('Snapshot contains invalid conversation ownership.');
                if (row.recipe_id ? row.scope_key !== 'recipe:' + row.recipe_id : row.scope_key !== 'general' && (typeof row.scope_key !== 'string' || !row.scope_key.startsWith('recipe:') || row.scope_key.length <= 7 || row.status !== 'archived'))
                    throw new Error('Snapshot contains invalid conversation scope.');
                if (row.recipe_id || String(row.scope_key).startsWith('recipe:')) activityRows.push({
                    id: 'historical:' + row.id, conversation_id: row.id, turn_id: null,
                    recipe_key: row.recipe_id || String(row.scope_key).slice(7), recipe_id: row.recipe_id ?? null,
                    recipe_title: row.recipe_title ?? recipe?.name ?? 'Recipe', activity: 'historical', created_at: row.created_at, updated_at: row.updated_at,
                });
                const previous = winners.get(String(row.user_id));
                if (row.status === 'active' && (!previous || String(row.updated_at) > String(previous.updated_at) || row.updated_at === previous.updated_at && String(row.id) < String(previous.id))) winners.set(String(row.user_id), row);
            }
            conversationRows = conversationRows.map(row => ({ ...row, recipe_id: null, recipe_title: null, scope_key: 'general', status: row.status === 'active' && winners.get(String(row.user_id))?.id !== row.id ? 'archived' : row.status }));
        }
        for (const table of CONVERSATION_TABLES) {
            const columns = conversationColumns[table];
            const insert = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
            const source = table === 'conversations' ? conversationRows : table === 'conversation_recipe_activities' ? activityRows : snapshot[table] || [];
            for (const row of source) insert.run(...columns.map(field => field === 'metadata' || field === 'event' ? snapshotJsonObject(row[field]) : row[field] ?? null));
            counts[table] = source.length;
        }
        if (db.prepare('SELECT c.id FROM conversations c JOIN recipes r ON r.id=c.recipe_id WHERE c.user_id<>r.user_id LIMIT 1').get()
            || db.prepare('SELECT t.id FROM conversation_turns t JOIN conversations c ON c.id=t.conversation_id WHERE t.user_id<>c.user_id LIMIT 1').get()
            || db.prepare('SELECT m.id FROM conversation_messages m JOIN conversation_turns t ON t.id=m.turn_id WHERE m.conversation_id<>t.conversation_id LIMIT 1').get())
            throw new Error('Snapshot contains invalid conversation ownership.');
        if (db.prepare(`SELECT id FROM conversations WHERE recipe_id IS NOT NULL OR recipe_title IS NOT NULL OR scope_key<>'general' LIMIT 1`).get())
            throw new Error('Snapshot contains invalid conversation scope.');
        if (db.prepare(`SELECT a.id FROM conversation_recipe_activities a JOIN conversations c ON c.id=a.conversation_id
            LEFT JOIN recipes r ON r.id=a.recipe_key LEFT JOIN conversation_turns t ON t.id=a.turn_id
            WHERE (r.id IS NOT NULL AND r.user_id<>c.user_id) OR (a.recipe_id IS NOT NULL AND a.recipe_id<>a.recipe_key)
              OR (a.turn_id IS NOT NULL AND t.conversation_id<>a.conversation_id)
              OR (a.activity='historical' AND a.turn_id IS NOT NULL) OR (a.activity<>'historical' AND a.turn_id IS NULL)
              OR length(a.recipe_key)>128 OR length(trim(a.recipe_title))=0 LIMIT 1`).get()
            || db.prepare(`SELECT t.id FROM conversation_turns t WHERE t.selected_recipe_id IS NOT NULL AND NOT EXISTS(
                SELECT 1 FROM conversation_recipe_activities a WHERE a.turn_id=t.id AND a.activity='selected' AND a.recipe_key=t.selected_recipe_id) LIMIT 1`).get())
            throw new Error('Snapshot contains invalid conversation recipe activity.');
        const malformedTurn = db.prepare(`SELECT t.id FROM conversation_turns t
            LEFT JOIN conversation_messages u ON u.id=t.user_message_id LEFT JOIN conversation_messages a ON a.id=t.assistant_message_id
            WHERE NOT(t.input_message='/delete' AND t.user_message_id='' AND t.assistant_message_id='' AND t.adapter_id='maintenance')
            AND (u.id IS NULL OR a.id IS NULL OR u.conversation_id<>t.conversation_id OR a.conversation_id<>t.conversation_id
              OR u.turn_id IS NULL OR a.turn_id IS NULL OR u.turn_id<>t.id OR a.turn_id<>t.id OR u.type<>'user' OR a.type<>'assistant' OR u.sequence>=a.sequence) LIMIT 1`).get();
        if (malformedTurn) throw new Error('Snapshot contains invalid conversation turn references.');
        if (db.prepare(`SELECT c.id FROM conversations c LEFT JOIN conversation_messages m ON m.conversation_id=c.id
            GROUP BY c.id HAVING c.next_sequence<coalesce(max(m.sequence),0) OR c.summary_through_sequence>c.next_sequence LIMIT 1`).get())
            throw new Error('Snapshot contains invalid conversation sequence state.');
        if (db.prepare(`SELECT b.conversation_id FROM conversation_bindings b JOIN conversations c ON c.id=b.conversation_id
            WHERE b.through_sequence>c.next_sequence OR b.context_revision<>c.context_revision LIMIT 1`).get())
            throw new Error('Snapshot contains stale conversation bindings.');
        // Preserve native IDs before clearing bindings for interrupted work.
        db.exec(`INSERT OR IGNORE INTO conversation_threads(conversation_id,adapter_id,thread_id,created_at)
            SELECT b.conversation_id,b.adapter_id,b.thread_id,c.created_at FROM conversation_bindings b JOIN conversations c ON c.id=b.conversation_id;`);
        // Restoring into the required empty destination cannot revive an old
        // worker. Retain its partial text/tools, release its claim and discard
        // native bindings; the thread ledger still supports explicit deletion.
        for (const turn of db.prepare("SELECT id,conversation_id,assistant_message_id FROM conversation_turns WHERE status='running'").all()) {
            const error = 'Turn interrupted by snapshot restore; partial transcript retained.';
            db.prepare("UPDATE conversation_turns SET status='interrupted',lease_expires_at=0,error=? WHERE id=?").run(error, String(turn.id));
            const assistant = db.prepare('SELECT metadata FROM conversation_messages WHERE id=?').get(String(turn.assistant_message_id));
            if (assistant) db.prepare('UPDATE conversation_messages SET metadata=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(String(assistant.metadata)), isStreaming: false, isComplete: false, isExecutingTool: false, turnStatus: 'interrupted', error }), String(turn.assistant_message_id));
            db.prepare('DELETE FROM conversation_bindings WHERE conversation_id=?').run(String(turn.conversation_id));
        }
        counts.conversation_bindings = Number(db.prepare('SELECT count(*) AS n FROM conversation_bindings').get()?.n);
        counts.conversation_threads = Number(db.prepare('SELECT count(*) AS n FROM conversation_threads').get()?.n);
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length)
            throw new Error('Snapshot contains invalid foreign-key relationships.');
        counts.user_profiles = (snapshot.user_profiles || []).length;
        for (const table of ['users', 'user_profiles', 'recipes', ...RELATION_TABLES, ...CONVERSATION_TABLES]) {
            if (table === 'conversation_bindings' || table === 'conversation_threads') continue;
            if (Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count) !== counts[table])
                throw new Error(`Imported row count mismatch: ${table}`);
        }
        for (const table of CATALOG_TABLES) {
            if (snapshot[table] && Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count) !== counts[table])
                throw new Error(`Imported catalog count mismatch: ${table}`);
            for (const row of snapshot[table] || [])
                if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id))
                    throw new Error(`Missing imported catalog ID: ${table}`);
        }
        if (CATALOG_TABLES.some(table => snapshot[table])) {
            // Initialization's ledger described the seed, not the catalogue
            // just imported. Reconcile known old metadata in the same rollback
            // boundary, preserving imported IDs and all brewing values.
            db.prepare('DELETE FROM installation_settings WHERE key=?').run('reference_catalog_revision');
            applyReferenceCatalogUpdates(db);
        }
        return counts;
    });
}
/** Administrative backup shape. Includes password hashes; callers must protect output like the database. */
export function exportDatabaseSnapshot(): {
    schemaVersion: number;
    tables: Record<string, RecordData[]>;
} {
    const db = getDatabase();
    return transaction(db, () => {
        const tables: Record<string, RecordData[]> = {};
        for (const table of ['users', 'user_profiles', 'recipes'])
            tables[table] = db.prepare(`SELECT * FROM ${table}`).all().map(row => {
                const result = { ...row } as RecordData;
                if (table === 'users')
                    result.user_metadata = JSON.parse(String(row.user_metadata));
                if (table === 'user_profiles')
                    result.preferences = JSON.parse(String(row.preferences));
                return result;
            });
        for (const table of CATALOG_TABLES)
            tables[table] = db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(String(row.data)));
        for (const table of RELATION_TABLES)
            tables[table] = db.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...JSON.parse(String(row.data)), id: row.id, recipe_id: row.recipe_id, created_at: row.created_at }));
        for (const table of CONVERSATION_TABLES)
            tables[table] = db.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row,
                ...(table === 'conversation_messages' ? { metadata: JSON.parse(String(row.metadata)) } : {}),
                ...(table === 'conversation_events' ? { event: JSON.parse(String(row.event)) } : {}),
            }));
        return { schemaVersion: SCHEMA_VERSION, tables };
    });
}
