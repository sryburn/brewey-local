import { randomUUID } from 'node:crypto';
import { getDatabase, transaction } from './database.ts';
import { applicationForUser } from './application-service.ts';
import type { Conversation, ConversationActivation, ConversationRecipe, RecipeActivity, ConversationMessage, ConversationPage, ConversationContext, ConversationTurn, ConversationTurnStatus, ConversationBinding, ConversationEvent } from '../../types/conversation.ts';
import type { DatabaseSync } from 'node:sqlite';

type Row = Record<string, string | number | null>;
export const CONVERSATION_TURN_LEASE_MS = 120_000;
const MAX_CONTENT_BYTES = 1024 * 1024;
export class ConversationError extends Error {
    readonly status: number;
    constructor(message: string, status = 400) { super(message); this.name = 'ConversationError'; this.status = status; }
}
function identifier(value: unknown, name = 'ID'): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new ConversationError(`Invalid ${name}.`);
}
function text(value: unknown, name: string, maximum: number, allowEmpty = false): asserts value is string {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || Buffer.byteLength(value, 'utf8') > maximum)
        throw new ConversationError(`${name} must be ${allowEmpty ? '' : 'nonempty '}text of at most ${maximum} bytes.`);
}
function json(value: unknown, name: string): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConversationError(`${name} must be an object.`);
    let serialized: string;
    try { serialized = JSON.stringify(value); } catch { throw new ConversationError(`${name} must be JSON.`); }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) throw new ConversationError(`${name} exceeds 1 MiB.`);
    return serialized;
}
function integer(value: unknown, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new ConversationError(`Invalid ${name}.`);
}
function normalizedTitle(value: unknown): string {
    if (typeof value !== 'string') throw new ConversationError('Title must be text.');
    const title = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
    text(title, 'Title', 200);
    if (/\p{Cc}/u.test(title)) throw new ConversationError('Title cannot contain control characters.');
    return title;
}
function firstMessageTitle(value: string): string {
    const normalized = value.normalize('NFC').replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim();
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized), part => part.segment);
    const selected = segments.slice(0, 80);
    while (selected.length && Buffer.byteLength(selected.join(''), 'utf8') > 197) selected.pop();
    return selected.join('') + (selected.length < segments.length ? '…' : '');
}
function displayTitle(row: Row): string {
    return String(row.title) || 'New chat';
}
function message(row: Row): ConversationMessage {
    return { id: String(row.id), type: row.type as ConversationMessage['type'], content: String(row.content), timestamp: String(row.timestamp), sequence: Number(row.sequence), turnId: row.turn_id == null ? null : String(row.turn_id), metadata: JSON.parse(String(row.metadata)) };
}
function endAssistant(db: DatabaseSync, assistantId: string, status: Exclude<ConversationTurnStatus, 'running'>, error?: string) {
    const row = db.prepare('SELECT metadata FROM conversation_messages WHERE id=?').get(assistantId);
    if (!row) return;
    const metadata = { ...JSON.parse(String(row.metadata)), isStreaming: false, isExecutingTool: false, isComplete: status === 'completed', turnStatus: status, ...(error ? { error } : {}) };
    db.prepare('UPDATE conversation_messages SET metadata=? WHERE id=?').run(JSON.stringify(metadata), assistantId);
}
function recoverExpired(db: DatabaseSync, userId: string) {
    const now = Date.now(), timestamp = new Date(now).toISOString();
    // UPDATE acquires the writer lock before any read. Only expired leases are
    // recovered: opening another application process cannot cancel live work.
    const expired = db.prepare("UPDATE conversation_turns SET status='interrupted',error='Turn lease expired; partial transcript retained.',updated_at=? WHERE user_id=? AND status='running' AND lease_expires_at<=? RETURNING assistant_message_id,conversation_id")
        .all(timestamp, userId, now);
    for (const row of expired) {
        endAssistant(db, String(row.assistant_message_id), 'interrupted', 'Turn lease expired; partial transcript retained.');
        db.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?').run(timestamp, String(row.conversation_id), userId);
    }
}

/** Only construct for an independently verified browser session, never a client-supplied owner. */
export function conversationsForUser(userId: string) {
    identifier(userId, 'user ID');
    if (!getDatabase().prepare('SELECT id FROM users WHERE id=?').get(userId)) throw new ConversationError('Account not found.', 404);
    function run<T>(operation: (db: DatabaseSync) => T): T {
        const db = getDatabase();
        return transaction(db, () => { recoverExpired(db, userId); return operation(db); });
    }
    function owned(db: DatabaseSync, id: string): Row {
        identifier(id, 'conversation ID');
        const row = db.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(id, userId) as Row | undefined;
        if (!row) throw new ConversationError('Conversation not found.', 404);
        return row;
    }
    function running(db: DatabaseSync, id: string): Row | undefined {
        return db.prepare("SELECT * FROM conversation_turns WHERE conversation_id=? AND user_id=? AND status='running'").get(id, userId) as Row | undefined;
    }
    function guard(db: DatabaseSync, id: string, turnId?: string) {
        const claim = running(db, id);
        if (claim && claim.id !== turnId) throw new ConversationError('This conversation is running. Wait or cancel it first.', 409);
        if (turnId && (!claim || claim.id !== turnId)) throw new ConversationError('The conversation turn is no longer running.', 409);
    }
    function wire(db: DatabaseSync, row: Row): Conversation {
        const recipes = new Map<string, ConversationRecipe>();
        const activityOrder: RecipeActivity[] = ['historical', 'selected', 'read', 'modified'];
        for (const activity of db.prepare(`SELECT a.*,r.name AS current_title FROM conversation_recipe_activities a
            LEFT JOIN recipes r ON r.id=a.recipe_id AND r.user_id=? WHERE a.conversation_id=? ORDER BY a.updated_at,a.id`).all(userId, String(row.id))) {
            const key = String(activity.recipe_key), previous = recipes.get(key);
            recipes.set(key, { recipeId: key, recipeTitle: String(activity.current_title ?? activity.recipe_title), deleted: activity.current_title == null,
                activities: activityOrder.filter(kind => kind === activity.activity || previous?.activities.includes(kind)) });
        }
        return { id: String(row.id), recipes: [...recipes.values()], title: displayTitle(row), status: row.status as Conversation['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), compactedAt: row.compacted_at == null ? null : String(row.compacted_at), running: !!running(db, String(row.id)) };
    }
    function context(db: DatabaseSync, row: Row): ConversationContext {
        const messages = db.prepare("SELECT m.* FROM conversation_messages m LEFT JOIN conversation_turns t ON t.id=m.turn_id WHERE m.conversation_id=? AND m.sequence>? AND (t.id IS NULL OR t.status<>'running') ORDER BY m.sequence")
            .all(String(row.id), Number(row.summary_through_sequence)).map(value => message(value as Row));
        const last = db.prepare("SELECT max(m.sequence) AS sequence FROM conversation_messages m LEFT JOIN conversation_turns t ON t.id=m.turn_id WHERE m.conversation_id=? AND (t.id IS NULL OR t.status<>'running')").get(String(row.id));
        return { messages, summary: row.summary == null ? null : String(row.summary), summaryThroughSequence: Number(row.summary_through_sequence), contextRevision: Number(row.context_revision), lastSequence: Number(last?.sequence || 0) };
    }
    function create(db: DatabaseSync, input: { title?: string; carryFromId?: string }): Conversation {
        if (Object.keys(input).some(key => !['title', 'carryFromId'].includes(key))) throw new ConversationError('Invalid conversation fields.');
        const title = input.title === undefined ? '' : normalizedTitle(input.title);
        let carried: ConversationContext | undefined;
        if (input.carryFromId) {
            const previous = owned(db, input.carryFromId); guard(db, input.carryFromId);
            carried = context(db, previous);
        }
        const current = db.prepare("SELECT id FROM conversations WHERE user_id=? AND status='active'").get(userId);
        if (current) guard(db, String(current.id));
        const timestamp = new Date().toISOString(), id = randomUUID();
        db.prepare("UPDATE conversations SET status='archived',updated_at=? WHERE user_id=? AND status='active'").run(timestamp, userId);
        db.prepare('INSERT INTO conversations(id,user_id,recipe_id,recipe_title,scope_key,title,status,created_at,updated_at,summary,context_revision,compacted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, userId, null, null, 'general', title, 'active', timestamp, timestamp, carried?.summary ?? null, carried?.summary ? 1 : 0, carried?.summary ? timestamp : null);
        if (carried) {
            let sequence = 0;
            for (const old of carried.messages) db.prepare('INSERT INTO conversation_messages(id,conversation_id,sequence,type,content,timestamp,metadata) VALUES(?,?,?,?,?,?,?)')
                .run(randomUUID(), id, ++sequence, old.type, old.content, old.timestamp, json({ ...old.metadata, carriedFromConversationId: input.carryFromId, carriedFromMessageId: old.id }, 'Message metadata'));
            db.prepare('UPDATE conversations SET next_sequence=? WHERE id=?').run(sequence, id);
            for (const association of db.prepare('SELECT * FROM conversation_recipe_activities WHERE conversation_id=?').all(input.carryFromId!)) {
                db.prepare(`INSERT OR IGNORE INTO conversation_recipe_activities(id,conversation_id,recipe_key,recipe_id,recipe_title,activity,created_at,updated_at) VALUES(?,?,?,?,?,'historical',?,?)`)
                    .run(randomUUID(), id, association.recipe_key, association.recipe_id, association.recipe_title, timestamp, timestamp);
            }
        }
        return wire(db, owned(db, id));
    }
    function ownedTurn(db: DatabaseSync, turnId: string): Row {
        identifier(turnId, 'turn ID');
        const row = db.prepare('SELECT t.* FROM conversation_turns t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.user_id=? AND c.user_id=?').get(turnId, userId, userId) as Row | undefined;
        if (!row) throw new ConversationError('Conversation turn not found.', 404);
        return row;
    }
    function touch(db: DatabaseSync, turn: Row) {
        if (turn.status !== 'running') throw new ConversationError('The conversation turn is no longer running.', 409);
        const timestamp = new Date().toISOString();
        db.prepare("UPDATE conversation_turns SET updated_at=?,lease_expires_at=? WHERE id=? AND user_id=? AND status='running'").run(timestamp, Date.now() + CONVERSATION_TURN_LEASE_MS, String(turn.id), userId);
        db.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?').run(timestamp, String(turn.conversation_id), userId);
    }
    function captureRecipeActivity(turnId: string, recipeId: string): (activity: Exclude<RecipeActivity, 'historical'>) => void {
        identifier(recipeId, 'recipe ID');
        const captured = run(db => {
            touch(db, ownedTurn(db, turnId));
            return applicationForUser(userId).getRecipe(recipeId);
        });
        return activity => {
            if (!['selected', 'read', 'modified'].includes(activity)) throw new ConversationError('Invalid recipe activity.');
            run(db => {
                const turn = ownedTurn(db, turnId); touch(db, turn);
                const live = db.prepare('SELECT name FROM recipes WHERE id=? AND user_id=?').get(recipeId, userId);
                const timestamp = new Date().toISOString();
                db.prepare(`INSERT INTO conversation_recipe_activities(id,conversation_id,turn_id,recipe_key,recipe_id,recipe_title,activity,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET recipe_id=excluded.recipe_id,recipe_title=excluded.recipe_title,updated_at=excluded.updated_at`)
                    .run(randomUUID(), String(turn.conversation_id), turnId, recipeId, live ? recipeId : null, live?.name ?? captured.name, activity, timestamp, timestamp);
            });
        };
    }
    return {
        list(q = ''): Conversation[] {
            if (typeof q !== 'string') throw new ConversationError('Search must be text.');
            const search = q.trim().normalize('NFC');
            text(search, 'Search', 200, true);
            return run(db => {
                const parameters: string[] = [userId];
                let where = 'c.user_id=? AND EXISTS(SELECT 1 FROM conversation_messages saved WHERE saved.conversation_id=c.id)';
                if (search) {
                    // SQLite's built-in lower/NOCASE only folds ASCII. This deterministic
                    // scalar handles Unicode and instr keeps %, _ and quotes literal.
                    db.function('brewey_conversation_fold', { deterministic: true }, value => typeof value === 'string' ? value.normalize('NFC').toLowerCase() : '');
                    const fields = ["CASE WHEN c.title<>'' THEN c.title ELSE 'New chat' END", 'c.id'];
                    where += ' AND (' + fields.map(field => `instr(brewey_conversation_fold(${field}),?)>0`).join(' OR ') + ` OR EXISTS(SELECT 1 FROM conversation_recipe_activities a LEFT JOIN recipes r ON r.id=a.recipe_id AND r.user_id=c.user_id WHERE a.conversation_id=c.id AND
                        (instr(brewey_conversation_fold(a.recipe_key),?)>0 OR instr(brewey_conversation_fold(a.recipe_title),?)>0 OR instr(brewey_conversation_fold(r.name),?)>0))
                        OR EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id=c.id AND instr(brewey_conversation_fold(m.content),?)>0))`;
                    parameters.push(...Array(fields.length + 4).fill(search.toLowerCase()));
                }
                return db.prepare(`SELECT c.* FROM conversations c WHERE ${where} ORDER BY c.updated_at DESC,c.id`).all(...parameters).map(row => wire(db, row as Row));
            });
        },
        current(): Conversation {
            return run(db => {
                const row = db.prepare("SELECT * FROM conversations WHERE user_id=? AND status='active'").get(userId);
                return row ? wire(db, row as Row) : create(db, {});
            });
        },
        create(input: { title?: string; carryFromId?: string } = {}): Conversation {
            return run(db => create(db, input));
        },
        get(id: string, options: { before?: number; limit?: number } = {}): ConversationPage {
            const limit = options.limit ?? 100;
            integer(limit, 'message limit', 1, 500);
            if (options.before !== undefined) integer(options.before, 'message cursor', 1);
            return run(db => {
                const row = owned(db, id);
                const rows = db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?')
                    .all(id, options.before ?? Number.MAX_SAFE_INTEGER, limit + 1);
                const hasMore = rows.length > limit, selected = rows.slice(0, limit).reverse().map(value => message(value as Row));
                return { conversation: wire(db, row), messages: selected, hasMore, nextBefore: hasMore ? selected[0].sequence : null };
            });
        },
        rename(id: string, title: string): Conversation {
            const normalized = normalizedTitle(title);
            return run(db => {
                owned(db, id); guard(db, id);
                db.prepare('UPDATE conversations SET title=?,updated_at=? WHERE id=? AND user_id=?').run(normalized, new Date().toISOString(), id, userId);
                return wire(db, owned(db, id));
            });
        },
        activate(id: string): ConversationActivation {
            return run(db => {
                owned(db, id); guard(db, id);
                const current = db.prepare("SELECT id FROM conversations WHERE user_id=? AND status='active'").get(userId);
                if (current) guard(db, String(current.id));
                const timestamp = new Date().toISOString();
                db.prepare("UPDATE conversations SET status='archived',updated_at=? WHERE user_id=? AND status='active'").run(timestamp, userId);
                db.prepare("UPDATE conversations SET status='active',updated_at=? WHERE id=? AND user_id=?").run(timestamp, id, userId);
                // Inspect the last ordinary user message, not the last non-null
                // selection or a recipe subsequently read/modified by the agent.
                // LEFT JOIN keeps a missing/deleted selection from falling back
                // to an older turn. Compaction is a context operation, not a message.
                const last = db.prepare(`SELECT r.id AS recipe_id FROM conversation_messages m
                    LEFT JOIN conversation_turns t ON t.id=m.turn_id AND t.user_id=?
                    LEFT JOIN recipes r ON r.id=t.selected_recipe_id AND r.user_id=?
                    WHERE m.conversation_id=? AND m.type='user' AND (t.id IS NULL OR t.input_message<>'/compact')
                    ORDER BY m.sequence DESC LIMIT 1`).get(userId, userId, id);
                return { ...wire(db, owned(db, id)), resumeRecipeId: last?.recipe_id == null ? null : String(last.recipe_id) };
            });
        },
        remove(id: string, turnId?: string): void {
            run(db => {
                owned(db, id); guard(db, id, turnId);
                if (turnId) {
                    const turn = ownedTurn(db, turnId);
                    if (turn.input_message !== '/delete' || turn.assistant_message_id !== '') throw new ConversationError('Only a deletion claim can remove running history.', 409);
                }
                db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(id, userId);
            });
        },
        claimDeletion(id: string, requestId: string): ConversationTurn {
            identifier(requestId, 'request ID');
            return run(db => {
                owned(db, id);
                const duplicate = db.prepare('SELECT * FROM conversation_turns WHERE user_id=? AND request_id=?').get(userId, requestId) as Row | undefined;
                if (duplicate) {
                    if (duplicate.conversation_id !== id || duplicate.input_message !== '/delete' || duplicate.assistant_message_id !== '') throw new ConversationError('Request ID was already used for a different operation.', 409);
                    return { turnId: String(duplicate.id), userMessageId: '', assistantMessageId: '', replayed: true, status: duplicate.status as ConversationTurnStatus };
                }
                if (db.prepare("SELECT id FROM conversation_turns WHERE user_id=? AND status='running'").get(userId)) throw new ConversationError('Another conversation turn is running. Wait or cancel it first.', 409);
                const idOfTurn = randomUUID(), timestamp = new Date().toISOString();
                db.prepare('INSERT INTO conversation_turns(id,conversation_id,user_id,request_id,user_message_id,assistant_message_id,adapter_id,input_message,status,created_at,updated_at,lease_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
                    .run(idOfTurn, id, userId, requestId, '', '', 'maintenance', '/delete', 'running', timestamp, timestamp, Date.now() + CONVERSATION_TURN_LEASE_MS);
                return { turnId: idOfTurn, userMessageId: '', assistantMessageId: '', replayed: false, status: 'running' };
            });
        },
        assertIdle(id: string): Conversation {
            return run(db => { const row = owned(db, id); guard(db, id); return wire(db, row); });
        },
        appendNote(id: string, content: string): ConversationMessage {
            text(content, 'Activity note', 100_000);
            return run(db => {
                const row = owned(db, id); guard(db, id);
                const messageId = randomUUID(), timestamp = new Date().toISOString(), sequence = Number(row.next_sequence) + 1;
                db.prepare('INSERT INTO conversation_messages(id,conversation_id,sequence,type,content,timestamp,metadata) VALUES(?,?,?,?,?,?,?)')
                    .run(messageId, id, sequence, 'user', content, timestamp, '{"activityNote":true}');
                db.prepare('UPDATE conversations SET next_sequence=?,context_revision=context_revision+1,updated_at=? WHERE id=? AND user_id=?').run(sequence, timestamp, id, userId);
                db.prepare('DELETE FROM conversation_bindings WHERE conversation_id=?').run(id);
                return message(db.prepare('SELECT * FROM conversation_messages WHERE id=?').get(messageId) as Row);
            });
        },
        captureRecipeActivity,
        recordRecipeActivity(turnId: string, recipeId: string, activity: Exclude<RecipeActivity, 'historical'>): void { captureRecipeActivity(turnId, recipeId)(activity); },
        beginTurn(id: string, input: { requestId: string; message: string; adapterId: string; model?: string; selectedRecipeId?: string | null }): ConversationTurn {
            identifier(input.requestId, 'request ID'); identifier(input.adapterId, 'adapter ID');
            text(input.message, 'Message', 100_000);
            if (input.model !== undefined) identifier(input.model, 'model');
            if (input.selectedRecipeId != null) identifier(input.selectedRecipeId, 'selected recipe ID');
            return run(db => {
                const row = owned(db, id);
                const duplicate = db.prepare('SELECT * FROM conversation_turns WHERE user_id=? AND request_id=?').get(userId, input.requestId) as Row | undefined;
                if (duplicate) {
                    if (duplicate.conversation_id !== id || duplicate.input_message !== input.message || duplicate.adapter_id !== input.adapterId || duplicate.model !== (input.model ?? null) || duplicate.selected_recipe_id !== (input.selectedRecipeId ?? null)) throw new ConversationError('Request ID was already used for a different turn.', 409);
                    return { turnId: String(duplicate.id), userMessageId: String(duplicate.user_message_id), assistantMessageId: String(duplicate.assistant_message_id), replayed: true, status: duplicate.status as ConversationTurnStatus };
                }
                if (row.status !== 'active') throw new ConversationError('Activate this conversation before chatting.', 409);
                if (input.selectedRecipeId) applicationForUser(userId).getRecipe(input.selectedRecipeId);
                if (db.prepare("SELECT id FROM conversation_turns WHERE user_id=? AND status='running'").get(userId)) throw new ConversationError('Another conversation turn is running. Wait or cancel it first.', 409);
                const timestamp = new Date().toISOString(), turnId = randomUUID(), userMessageId = randomUUID(), assistantMessageId = randomUUID(), sequence = Number(row.next_sequence);
                db.prepare('INSERT INTO conversation_turns(id,conversation_id,user_id,request_id,user_message_id,assistant_message_id,adapter_id,model,input_message,status,created_at,updated_at,lease_expires_at,selected_recipe_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    .run(turnId, id, userId, input.requestId, userMessageId, assistantMessageId, input.adapterId, input.model ?? null, input.message, 'running', timestamp, timestamp, Date.now() + CONVERSATION_TURN_LEASE_MS, input.selectedRecipeId ?? null);
                const insert = db.prepare('INSERT INTO conversation_messages(id,conversation_id,turn_id,sequence,type,content,timestamp,metadata) VALUES(?,?,?,?,?,?,?,?)');
                insert.run(userMessageId, id, turnId, sequence + 1, 'user', input.message, timestamp, '{}');
                insert.run(assistantMessageId, id, turnId, sequence + 2, 'assistant', '', timestamp, JSON.stringify({ isStreaming: true, isComplete: false, adapterId: input.adapterId, ...(input.model ? { model: input.model } : {}) }));
                // Empty persisted titles identify only newly untitled chats. Explicit
                // names (even identical to a default) and historical names are retained.
                const title = String(row.title) || (input.message.trim() === '/compact' ? '' : firstMessageTitle(input.message));
                db.prepare('UPDATE conversations SET next_sequence=?,updated_at=?,title=? WHERE id=? AND user_id=?').run(sequence + 2, timestamp, title, id, userId);
                if (input.selectedRecipeId) captureRecipeActivity(turnId, input.selectedRecipeId)('selected');
                return { turnId, userMessageId, assistantMessageId, replayed: false, status: 'running' };
            });
        },
        heartbeat(turnId: string): void { run(db => touch(db, ownedTurn(db, turnId))); },
        updateAssistant(turnId: string, input: { content: string; metadata?: Record<string, unknown> }): void {
            text(input.content, 'Assistant content', MAX_CONTENT_BYTES, true);
            if (input.metadata !== undefined) json(input.metadata, 'Assistant metadata');
            run(db => {
                const turn = ownedTurn(db, turnId); touch(db, turn);
                const previous = db.prepare('SELECT metadata FROM conversation_messages WHERE id=?').get(String(turn.assistant_message_id));
                const metadata = json({ ...JSON.parse(String(previous?.metadata || '{}')), ...input.metadata, isStreaming: true, isComplete: false }, 'Assistant metadata');
                db.prepare('UPDATE conversation_messages SET content=?,metadata=? WHERE id=? AND conversation_id=?').run(input.content, metadata, String(turn.assistant_message_id), String(turn.conversation_id));
            });
        },
        recordEvent(turnId: string, event: Record<string, unknown>): ConversationEvent {
            const serialized = json(event, 'Turn event');
            return run(db => {
                const turn = ownedTurn(db, turnId); touch(db, turn);
                const sequence = Number(db.prepare('SELECT coalesce(max(sequence),0)+1 AS next FROM conversation_events WHERE turn_id=?').get(turnId)?.next);
                const id = randomUUID(), timestamp = new Date().toISOString();
                db.prepare('INSERT INTO conversation_events(id,turn_id,sequence,timestamp,event) VALUES(?,?,?,?,?)').run(id, turnId, sequence, timestamp, serialized);
                if (['tool_call', 'tool_result', 'tool_error'].includes(String(event.type))) {
                    const previous = db.prepare('SELECT metadata FROM conversation_messages WHERE id=?').get(String(turn.assistant_message_id));
                    const metadata = JSON.parse(String(previous?.metadata || '{}')) as Record<string, unknown>;
                    const calls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls as Array<Record<string, unknown>> : [];
                    let call = calls.find(item => event.tool_id ? item.id === event.tool_id : item.name === event.tool_name && item.status === 'pending');
                    if (!call) { call = { ...(event.tool_id ? { id: event.tool_id } : {}), name: event.tool_name, timestamp }; calls.push(call); }
                    if (event.type === 'tool_call') Object.assign(call, { parameters: event.tool_args, status: 'pending' });
                    else if (event.type === 'tool_result') Object.assign(call, { result: event.tool_result, status: 'success' });
                    else Object.assign(call, { error: event.error || event.content || 'Tool failed.', status: 'error' });
                    db.prepare('UPDATE conversation_messages SET metadata=? WHERE id=?').run(json({ ...metadata, toolCalls: calls }, 'Assistant metadata'), String(turn.assistant_message_id));
                }
                return { id, turnId, sequence, timestamp, event: JSON.parse(serialized) };
            });
        },
        finishTurn(turnId: string, status: Exclude<ConversationTurnStatus, 'running'>, error?: string): Conversation {
            if (!['completed', 'interrupted', 'failed'].includes(status)) throw new ConversationError('Invalid completed turn status.');
            if (error !== undefined) text(error, 'Turn error', 10_000, true);
            return run(db => {
                const turn = ownedTurn(db, turnId);
                if (turn.status === 'running') {
                    const timestamp = new Date().toISOString();
                    db.prepare('UPDATE conversation_turns SET status=?,error=?,updated_at=? WHERE id=? AND user_id=?').run(status, error ?? null, timestamp, turnId, userId);
                    endAssistant(db, String(turn.assistant_message_id), status, error);
                    db.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?').run(timestamp, String(turn.conversation_id), userId);
                }
                return wire(db, owned(db, String(turn.conversation_id)));
            });
        },
        getContext(id: string): ConversationContext { return run(db => context(db, owned(db, id))); },
        saveSummary(id: string, input: { summary: string; throughSequence: number; turnId?: string }): void {
            text(input.summary, 'Conversation summary', 100_000);
            integer(input.throughSequence, 'summary sequence', 1);
            run(db => {
                const row = owned(db, id); guard(db, id, input.turnId);
                const complete = context(db, row);
                if (input.throughSequence < Number(row.summary_through_sequence) || input.throughSequence > complete.lastSequence) throw new ConversationError('Summary must cover existing finished history.');
                const boundary = db.prepare("SELECT m.type,m.metadata,t.status FROM conversation_messages m LEFT JOIN conversation_turns t ON t.id=m.turn_id WHERE m.conversation_id=? AND m.sequence=?").get(id, input.throughSequence);
                const activityNote = boundary?.type === 'user' && JSON.parse(String(boundary.metadata)).activityNote === true;
                if (!boundary || (!activityNote && boundary.type !== 'assistant') || boundary.status === 'running') throw new ConversationError('Summary must end after a finished assistant message or activity note.');
                const timestamp = new Date().toISOString();
                db.prepare('UPDATE conversations SET summary=?,summary_through_sequence=?,context_revision=context_revision+1,compacted_at=?,updated_at=? WHERE id=? AND user_id=?')
                    .run(input.summary, input.throughSequence, timestamp, timestamp, id, userId);
                db.prepare('DELETE FROM conversation_bindings WHERE conversation_id=?').run(id);
            });
        },
        markCompacted(id: string, turnId?: string): void {
            run(db => { owned(db, id); guard(db, id, turnId); const timestamp = new Date().toISOString(); db.prepare('UPDATE conversations SET compacted_at=?,updated_at=? WHERE id=? AND user_id=?').run(timestamp, timestamp, id, userId); });
        },
        getBinding(id: string, adapterId: string): ConversationBinding | null {
            identifier(adapterId, 'adapter ID');
            return run(db => {
                const conversation = owned(db, id);
                const row = db.prepare('SELECT * FROM conversation_bindings WHERE conversation_id=? AND adapter_id=?').get(id, adapterId) as Row | undefined;
                if (!row || row.context_revision !== conversation.context_revision) return null;
                return { threadId: String(row.thread_id), throughSequence: Number(row.through_sequence), contextRevision: Number(row.context_revision), ...(row.model == null ? {} : { model: String(row.model) }) };
            });
        },
        listBindings(id: string): Array<ConversationBinding & { adapterId: string }> {
            return run(db => {
                owned(db, id);
                return db.prepare('SELECT * FROM conversation_bindings WHERE conversation_id=? ORDER BY adapter_id').all(id).map(value => {
                    const row = value as Row;
                    return { adapterId: String(row.adapter_id), threadId: String(row.thread_id), throughSequence: Number(row.through_sequence), contextRevision: Number(row.context_revision), ...(row.model == null ? {} : { model: String(row.model) }) };
                });
            });
        },
        listThreads(id: string): Array<{ adapterId: string; threadId: string; createdAt: string }> {
            return run(db => {
                owned(db, id);
                return db.prepare('SELECT * FROM conversation_threads WHERE conversation_id=? ORDER BY created_at,adapter_id,thread_id').all(id)
                    .map(row => ({ adapterId: String(row.adapter_id), threadId: String(row.thread_id), createdAt: String(row.created_at) }));
            });
        },
        setBinding(id: string, adapterId: string, input: { threadId: string; throughSequence: number; contextRevision?: number; model?: string; turnId?: string }): void {
            identifier(adapterId, 'adapter ID'); identifier(input.threadId, 'thread ID');
            integer(input.throughSequence, 'binding sequence', 0);
            if (input.contextRevision !== undefined) integer(input.contextRevision, 'context revision', 0);
            if (input.model !== undefined) identifier(input.model, 'model');
            run(db => {
                const row = owned(db, id); guard(db, id, input.turnId);
                if (input.throughSequence > Number(row.next_sequence)) throw new ConversationError('Binding sequence exceeds saved transcript.');
                const revision = input.contextRevision ?? Number(row.context_revision);
                if (revision !== Number(row.context_revision)) throw new ConversationError('Conversation context changed; discard the stale thread binding.', 409);
                db.prepare('INSERT OR IGNORE INTO conversation_threads(conversation_id,adapter_id,thread_id,created_at) VALUES(?,?,?,?)').run(id, adapterId, input.threadId, new Date().toISOString());
                db.prepare('INSERT INTO conversation_bindings(conversation_id,adapter_id,thread_id,through_sequence,context_revision,model) VALUES(?,?,?,?,?,?) ON CONFLICT(conversation_id,adapter_id) DO UPDATE SET thread_id=excluded.thread_id,through_sequence=excluded.through_sequence,context_revision=excluded.context_revision,model=excluded.model')
                    .run(id, adapterId, input.threadId, input.throughSequence, revision, input.model ?? null);
            });
        },
        invalidateBinding(id: string, adapterId: string, turnId?: string): void {
            identifier(adapterId, 'adapter ID');
            run(db => { owned(db, id); guard(db, id, turnId); db.prepare('DELETE FROM conversation_bindings WHERE conversation_id=? AND adapter_id=?').run(id, adapterId); });
        },
    };
}
