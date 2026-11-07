import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { getDatabase, closeDatabase, SCHEMA_VERSION, CONVERSATION_TABLES } from '../database.ts'
import { applicationForUser } from '../application-service.ts'
import { conversationsForUser } from '../conversations.ts'
import { exportDatabaseSnapshot, importDatabaseSnapshot } from '../migration.ts'

const folder = mkdtempSync(join(tmpdir(), 'brewey-conversations-'))
function sandbox(name, operation) {
  const previous = process.env.BREWEY_DATABASE_PATH
  closeDatabase(); process.env.BREWEY_DATABASE_PATH = join(folder, name + '.sqlite')
  try {
    const db = getDatabase()
    for (const user of ['alice', 'bob']) db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(user, user, 'synthetic-hash')
    operation(db)
  } finally {
    closeDatabase()
    if (previous === undefined) delete process.env.BREWEY_DATABASE_PATH
    else process.env.BREWEY_DATABASE_PATH = previous
  }
}
after(() => { closeDatabase(); rmSync(folder, { recursive: true, force: true }) })
const input = (message = 'A brewing question') => ({ requestId: randomUUID(), message, adapterId: 'codex', model: 'fixture-model' })
function restore(snapshot, name) {
  closeDatabase(); process.env.BREWEY_DATABASE_PATH = join(folder, name + '.sqlite')
  return importDatabaseSnapshot(snapshot.tables)
}
function finish(service, id, content = 'A brewing answer', metadata = {}) {
  const turn = service.beginTurn(id, input())
  service.updateAssistant(turn.turnId, { content, metadata })
  service.finishTurn(turn.turnId, 'completed')
  return turn
}
function rows(db, table) { return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() }
// Synthetic already-migrated historical association, without fabricating turns.
function historical(service, recipeId) {
  const chat = service.create(), db = getDatabase(), recipe = db.prepare('SELECT name FROM recipes WHERE id=?').get(recipeId)
  db.prepare('INSERT INTO conversation_recipe_activities(id,conversation_id,recipe_key,recipe_id,recipe_title,activity,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(randomUUID(), chat.id, recipeId, recipeId, recipe.name, 'historical', chat.createdAt, chat.updatedAt)
  return service.get(chat.id).conversation
}
function schema3(db, attachments) {
  db.exec('DROP TABLE conversation_recipe_activities; ALTER TABLE conversation_turns DROP COLUMN selected_recipe_id; DROP INDEX conversations_current_user; CREATE UNIQUE INDEX conversations_current_scope ON conversations(user_id,scope_key) WHERE status=\'active\';')
  db.exec("UPDATE conversations SET status='archived'")
  for (const row of attachments) db.prepare('UPDATE conversations SET recipe_id=?,recipe_title=?,scope_key=?,status=?,updated_at=? WHERE id=?')
    .run(row.recipeId, row.recipeTitle, row.scope, row.status, row.updatedAt, row.id)
  db.exec("CREATE TRIGGER conversations_recipe_deleted BEFORE DELETE ON recipes BEGIN UPDATE conversations SET recipe_id=NULL,status='archived',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE recipe_id=OLD.id; END; PRAGMA user_version=3;")
}

test('activation restores only the last ordinary user message selection, independently of tool activity and compaction', () => sandbox('resume-selection', () => {
  const app = applicationForUser('alice'), store = conversationsForUser('alice');
  const first = app.createRecipe({ name: 'First IPA' }), last = app.createRecipe({ name: 'Last porter' });
  const chat = historical(store, first.id);
  assert.equal(store.activate(chat.id).resumeRecipeId, null);
  for (const recipe of [first, last]) {
    const turn = store.beginTurn(chat.id, { ...input(), selectedRecipeId: recipe.id });
    store.recordRecipeActivity(turn.turnId, first.id, 'modified');
    store.finishTurn(turn.turnId, 'completed');
  }
  const compact = store.beginTurn(chat.id, input('/compact'));
  store.finishTurn(compact.turnId, 'completed');
  store.create();
  assert.equal(store.activate(chat.id).resumeRecipeId, last.id);
  assert.equal(store.current().id, chat.id);
  assert.equal('resumeRecipeId' in store.current(), false);
  assert.equal('resumeRecipeId' in store.get(chat.id).conversation, false);
  const noSelection = store.beginTurn(chat.id, input());
  store.finishTurn(noSelection.turnId, 'completed');
  assert.equal(store.activate(chat.id).resumeRecipeId, null);
}));

test('activation never substitutes an older recipe for a deleted or unowned last selection', () => sandbox('resume-unavailable', db => {
  const app = applicationForUser('alice'), store = conversationsForUser('alice');
  const older = app.createRecipe({ name: 'Older recipe' }), deleted = app.createRecipe({ name: 'Deleted recipe' });
  const chat = store.current();
  for (const recipe of [older, deleted]) {
    const turn = store.beginTurn(chat.id, { ...input(), selectedRecipeId: recipe.id });
    store.finishTurn(turn.turnId, 'completed');
  }
  app.deleteRecipe(deleted.id);
  assert.equal(store.activate(chat.id).resumeRecipeId, null);
  const foreign = applicationForUser('bob').createRecipe({ name: 'Private recipe' });
  db.prepare('UPDATE conversation_turns SET selected_recipe_id=? WHERE conversation_id=?').run(foreign.id, chat.id);
  assert.equal(store.activate(chat.id).resumeRecipeId, null);
  assert.throws(() => conversationsForUser('bob').activate(chat.id), error => error.status === 404);
}));

test('schema3 upgrade preserves every transcript/native row and historical attachment with deterministic global current', () => sandbox('unified-migration', db => {
  const store = conversationsForUser('alice'), app = applicationForUser('alice')
  const recipe = app.createRecipe({ name: 'Legacy live recipe' }), deletedId = randomUUID()
  const general = store.create(); finish(store, general.id)
  store.saveSummary(general.id, { summary: 'Preserved summary', throughSequence: 2 })
  store.setBinding(general.id, 'codex', { threadId: 'native-preserved', throughSequence: 2 })
  const attached = store.create(); finish(store, attached.id)
  const deleted = store.create(); finish(store, deleted.id)
  const sameDate = '2026-09-30T10:00:00.000Z', olderDate = '2026-09-29T10:00:00.000Z'
  schema3(db, [
    { id: general.id, recipeId: null, recipeTitle: null, scope: 'general', status: 'active', updatedAt: sameDate },
    { id: attached.id, recipeId: recipe.id, recipeTitle: 'Original recipe snapshot', scope: 'recipe:' + recipe.id, status: 'active', updatedAt: sameDate },
    { id: deleted.id, recipeId: null, recipeTitle: 'Deleted legacy recipe', scope: 'recipe:' + deletedId, status: 'archived', updatedAt: olderDate },
  ])
  const before = rows(db, 'conversations'), turns = rows(db, 'conversation_turns')
  const retained = Object.fromEntries(['users', 'recipes', 'conversation_messages', 'conversation_events'].map(table => [table, rows(db, table)]))
  const bindings = db.prepare('SELECT * FROM conversation_bindings').all(), threads = db.prepare('SELECT * FROM conversation_threads').all()
  closeDatabase(); const migrated = getDatabase(), winner = [general.id, attached.id].sort()[0]
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 4)
  for (const [table, expected] of Object.entries(retained)) assert.deepEqual(rows(migrated, table), expected)
  assert.deepEqual(rows(migrated, 'conversation_turns').map(row => ({ ...row })), turns.map(row => ({ ...row, selected_recipe_id: null })))
  assert.deepEqual(migrated.prepare('SELECT * FROM conversation_bindings').all(), bindings)
  assert.deepEqual(migrated.prepare('SELECT * FROM conversation_threads').all(), threads)
  assert.deepEqual(rows(migrated, 'conversations').map(row => ({ ...row })), before.map(row => ({ ...row, recipe_id: null, recipe_title: null, scope_key: 'general', status: row.status === 'active' && row.id !== winner ? 'archived' : row.status })))
  assert.equal(store.current().id, winner)
  const ledger = rows(migrated, 'conversation_recipe_activities')
  for (const old of before.filter(row => row.scope_key.startsWith('recipe:'))) {
    assert.deepEqual({ ...ledger.find(row => row.conversation_id === old.id) }, { id: 'historical:' + old.id, conversation_id: old.id, turn_id: null, recipe_key: old.scope_key.slice(7), recipe_id: old.recipe_id, recipe_title: old.recipe_title, activity: 'historical', created_at: old.created_at, updated_at: old.updated_at })
  }
  store.activate(deleted.id)
  assert.deepEqual(store.current().recipes, [{ recipeId: deletedId, recipeTitle: 'Deleted legacy recipe', deleted: true, activities: ['historical'] }])
  finish(store, deleted.id)
  assert.equal(store.get(deleted.id).messages.length, 4)
  assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length, 0)
}))

test('schema4 migration rolls back schema and attachment edits on failure then retries', () => sandbox('unified-rollback', db => {
  const store = conversationsForUser('alice'), chat = store.current()
  schema3(db, [{ id: chat.id, recipeId: null, recipeTitle: null, scope: 'general', status: 'active', updatedAt: chat.updatedAt }])
  const before = rows(db, 'conversations')
  db.exec('CREATE TABLE conversation_recipe_activities(synthetic TEXT)')
  closeDatabase(); assert.throws(() => getDatabase(), /conversation_recipe_activities already exists/)
  const raw = new DatabaseSync(process.env.BREWEY_DATABASE_PATH)
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 3)
  assert.deepEqual(rows(raw, 'conversations'), before)
  assert.equal(raw.prepare('PRAGMA table_info(conversation_turns)').all().some(row => row.name === 'selected_recipe_id'), false)
  assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE name='conversations_current_scope'").get())
  raw.exec('DROP TABLE conversation_recipe_activities'); raw.close()
  assert.equal(getDatabase().prepare('PRAGMA user_version').get().user_version, 4)
}))

test('per-turn recipe metadata is owned, idempotent, searchable and independent of the current chat', () => sandbox('recipe-activity', db => {
  const store = conversationsForUser('alice'), app = applicationForUser('alice'), chat = store.current()
  const first = app.createRecipe({ name: 'Selected ale' }), second = app.createRecipe({ name: 'Read and modified lager' })
  const foreign = applicationForUser('bob').createRecipe({ name: 'Foreign recipe' })
  assert.throws(() => store.beginTurn(chat.id, { ...input(), selectedRecipeId: foreign.id }), error => error.status === 404)
  assert.equal(rows(db, 'conversation_turns').length, 0)
  const request = { ...input(), selectedRecipeId: first.id }, turn = store.beginTurn(chat.id, request)
  store.recordRecipeActivity(turn.turnId, first.id, 'selected')
  store.recordRecipeActivity(turn.turnId, second.id, 'read')
  store.recordRecipeActivity(turn.turnId, second.id, 'modified')
  store.recordRecipeActivity(turn.turnId, second.id, 'read')
  assert.equal(rows(db, 'conversation_recipe_activities').length, 3)
  assert.throws(() => store.recordRecipeActivity(turn.turnId, foreign.id, 'modified'), error => error.status === 404)
  assert.throws(() => store.recordRecipeActivity(turn.turnId, first.id, 'historical'), error => error.status === 400)
  assert.equal(store.beginTurn(chat.id, request).replayed, true)
  assert.equal(store.current().id, chat.id)
  assert.deepEqual(store.current().recipes.map(row => [row.recipeId, row.activities]).sort(), [[first.id, ['selected']], [second.id, ['read', 'modified']]].sort())
  app.updateRecipe(second.id, { name: 'Renamed current recipe' })
  assert.deepEqual(store.list('renamed CURRENT').map(row => row.id), [chat.id])
  assert.deepEqual(store.list('Read and modified').map(row => row.id), [chat.id])
  assert.deepEqual(store.list(second.id).map(row => row.id), [chat.id])
  assert.deepEqual(conversationsForUser('bob').list('Selected ale'), [])
  store.finishTurn(turn.turnId, 'completed')
  assert.throws(() => store.recordRecipeActivity(turn.turnId, first.id, 'read'), error => error.status === 409)
  const next = store.beginTurn(chat.id, input()); store.finishTurn(next.turnId, 'completed')
  assert.equal(rows(db, 'conversation_recipe_activities').length, 3)
  assert.equal(rows(db, 'conversation_turns')[0].selected_recipe_id === first.id || rows(db, 'conversation_turns')[1].selected_recipe_id === first.id, true)
  const snapshot = exportDatabaseSnapshot(); restore(snapshot, 'activity-restored')
  assert.deepEqual(exportDatabaseSnapshot().tables, snapshot.tables)
}))

test('captured deletion activity retains stable identity and replay while expired recorders cannot write', () => sandbox('activity-delete', db => {
  const store = conversationsForUser('alice'), app = applicationForUser('alice'), chat = store.current()
  const recipe = app.createRecipe({ name: 'Removed stout' }), request = { ...input(), selectedRecipeId: recipe.id }
  const turn = store.beginTurn(chat.id, request), completed = store.captureRecipeActivity(turn.turnId, recipe.id)
  app.deleteRecipe(recipe.id); completed('modified')
  assert.deepEqual(store.current().recipes, [{ recipeId: recipe.id, recipeTitle: 'Removed stout', deleted: true, activities: ['selected', 'modified'] }])
  assert.equal(store.beginTurn(chat.id, request).replayed, true)
  assert.throws(() => store.beginTurn(chat.id, { ...request, selectedRecipeId: null }), error => error.status === 409)
  store.finishTurn(turn.turnId, 'completed')
  assert.equal(store.beginTurn(chat.id, request).replayed, true)
  const live = app.createRecipe({ name: 'Future recipe' }), next = store.beginTurn(chat.id, input())
  const stale = store.captureRecipeActivity(next.turnId, live.id)
  db.prepare('UPDATE conversation_turns SET lease_expires_at=0 WHERE id=?').run(next.turnId)
  assert.throws(() => stale('read'), error => error.status === 409)
  assert.equal(rows(db, 'conversation_recipe_activities').length, 2)
  store.get(chat.id) // persist expiry recovery after the rejected transaction rolls back
  finish(store, chat.id)
}))

test('selected recipe claim rolls back atomically when metadata persistence fails', () => sandbox('activity-rollback', db => {
  const store = conversationsForUser('alice'), recipe = applicationForUser('alice').createRecipe({ name: 'Atomic selected recipe' }), chat = store.current()
  const before = rows(db, 'conversations')
  db.exec("CREATE TRIGGER fail_activity BEFORE INSERT ON conversation_recipe_activities BEGIN SELECT RAISE(ABORT,'synthetic activity failure'); END;")
  assert.throws(() => store.beginTurn(chat.id, { ...input(), selectedRecipeId: recipe.id }), /synthetic activity failure/)
  assert.deepEqual(rows(db, 'conversations'), before)
  assert.equal(rows(db, 'conversation_turns').length, 0)
  assert.equal(rows(db, 'conversation_messages').length, 0)
  db.exec('DROP TRIGGER fail_activity')
  finish(store, chat.id)
}))

test('explicit schema3 JSON restore applies the same global-current transform without mutating its input', () => sandbox('legacy-json-source', () => {
  const store = conversationsForUser('alice'), recipe = applicationForUser('alice').createRecipe({ name: 'Legacy JSON recipe' })
  const general = store.current(); finish(store, general.id)
  store.setBinding(general.id, 'codex', { threadId: 'legacy-json-native', throughSequence: 2 })
  const attached = store.create(); finish(store, attached.id)
  const deleted = store.create(); finish(store, deleted.id)
  const snapshot = exportDatabaseSnapshot(), deletedId = randomUUID(), timestamp = '2026-09-30T12:00:00.000Z'
  delete snapshot.tables.conversation_recipe_activities
  for (const turn of snapshot.tables.conversation_turns) delete turn.selected_recipe_id
  for (const row of snapshot.tables.conversations) {
    row.status = row.id === deleted.id ? 'archived' : 'active'; row.updated_at = timestamp
    if (row.id === attached.id) Object.assign(row, { recipe_id: recipe.id, recipe_title: recipe.name, scope_key: 'recipe:' + recipe.id })
    if (row.id === deleted.id) Object.assign(row, { recipe_id: null, recipe_title: 'Deleted JSON title', scope_key: 'recipe:' + deletedId })
  }
  const original = structuredClone(snapshot), winner = [general.id, attached.id].sort()[0]
  const counts = restore(snapshot, 'legacy-json-restored'), restored = exportDatabaseSnapshot()
  assert.deepEqual(snapshot, original)
  assert.equal(counts.conversation_recipe_activities, 2)
  assert.equal(store.current().id, winner)
  for (const table of ['conversation_messages', 'conversation_events', 'conversation_bindings', 'conversation_threads', 'recipes', 'users']) assert.deepEqual(restored.tables[table], original.tables[table])
  assert.deepEqual(restored.tables.conversation_turns, original.tables.conversation_turns.map(row => ({ ...row, selected_recipe_id: null })))
  assert.deepEqual(restored.tables.conversations, original.tables.conversations.map(row => ({ ...row, recipe_id: null, recipe_title: null, scope_key: 'general', status: row.status === 'active' && row.id !== winner ? 'archived' : row.status })))
  assert.deepEqual(store.get(deleted.id).conversation.recipes, [{ recipeId: deletedId, recipeTitle: 'Deleted JSON title', deleted: true, activities: ['historical'] }])
  store.activate(deleted.id); finish(store, deleted.id)
}))

test('activity snapshot validation rejects foreign recipes, foreign turns and mismatched selected metadata atomically', () => sandbox('invalid-activity-source', () => {
  const alice = conversationsForUser('alice'), bob = conversationsForUser('bob')
  const recipe = applicationForUser('alice').createRecipe({ name: 'Alice snapshot recipe' }), foreign = applicationForUser('bob').createRecipe({ name: 'Bob snapshot recipe' })
  const chat = alice.current(), claim = alice.beginTurn(chat.id, { ...input(), selectedRecipeId: recipe.id })
  alice.finishTurn(claim.turnId, 'completed')
  const bobTurn = finish(bob, bob.current().id), valid = exportDatabaseSnapshot()
  const modifications = [
    snapshot => { Object.assign(snapshot.tables.conversation_recipe_activities[0], { recipe_key: foreign.id, recipe_id: foreign.id }) },
    snapshot => { snapshot.tables.conversation_recipe_activities[0].turn_id = bobTurn.turnId },
    snapshot => { snapshot.tables.conversation_recipe_activities[0].activity = 'historical' },
    snapshot => { snapshot.tables.conversation_turns.find(row => row.id === claim.turnId).selected_recipe_id = foreign.id },
  ]
  for (const [index, mutate] of modifications.entries()) {
    const snapshot = structuredClone(valid); mutate(snapshot)
    closeDatabase(); process.env.BREWEY_DATABASE_PATH = join(folder, 'invalid-activity-' + index + '.sqlite')
    assert.throws(() => importDatabaseSnapshot(snapshot.tables), /invalid conversation recipe activity/)
    const db = getDatabase()
    assert.equal(rows(db, 'users').length, 0)
    for (const table of CONVERSATION_TABLES) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
  }
}))

test('fresh schema and schema2 upgrade retain every existing table and initialize no conversations', () => sandbox('migration', db => {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
  const recipe = applicationForUser('alice').createRecipe({ name: 'Preserved recipe' })
  applicationForUser('alice').updateProfile({ profile: 'Preserved profile' })
  db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run('synthetic-session', 'alice', 99999999999)
  const before = Object.fromEntries(['users', 'recipes', 'user_profiles', 'sessions', 'grains', 'hops', 'yeasts', 'misc_ingredients', 'beer_styles'].map(table => [table, table === 'sessions' ? db.prepare('SELECT * FROM sessions').all() : rows(db, table)]))
  db.exec('DROP TABLE conversation_recipe_activities; DROP TABLE conversation_threads; DROP TABLE conversation_bindings; DROP TABLE conversation_events; DROP TABLE conversation_messages; DROP TABLE conversation_turns; DROP TABLE conversations; PRAGMA user_version=2;')
  closeDatabase(); const migrated = getDatabase()
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
  for (const [table, previous] of Object.entries(before)) assert.deepEqual(table === 'sessions' ? migrated.prepare('SELECT * FROM sessions').all() : rows(migrated, table), previous)
  assert.equal(migrated.prepare('SELECT count(*) AS n FROM conversations').get().n, 0)
  assert.equal(applicationForUser('alice').getRecipe(recipe.id).name, 'Preserved recipe')
  assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length, 0)
}))

test('schema3 migration failure rolls back its new tables and version, then retries safely', () => sandbox('migration-rollback', db => {
  db.exec('DROP TABLE conversation_recipe_activities; DROP TABLE conversation_threads; DROP TABLE conversation_bindings; DROP TABLE conversation_events; DROP TABLE conversation_messages; DROP TABLE conversation_turns; DROP TABLE conversations; PRAGMA user_version=2; CREATE TABLE conversation_events(synthetic TEXT);')
  const previous = rows(db, 'users')
  closeDatabase()
  assert.throws(() => getDatabase(), /conversation_events already exists/)
  const raw = new DatabaseSync(process.env.BREWEY_DATABASE_PATH)
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 2)
  assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='conversations'").get(), undefined)
  assert.deepEqual(rows(raw, 'users'), previous)
  raw.exec('DROP TABLE conversation_events'); raw.close()
  assert.equal(getDatabase().prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
}))

test('one current conversation, new/archive/activate and transcript reopen preserve history independently of recipes', () => sandbox('history', db => {
  let service = conversationsForUser('alice')
  const recipe = applicationForUser('alice').createRecipe({ name: 'Session IPA' })
  const general = service.current(), original = historical(service, recipe.id)
  assert.equal(service.current().id, original.id)
  assert.notEqual(general.id, original.id)
  finish(service, original.id)
  const fresh = service.create()
  assert.equal(service.get(original.id).conversation.status, 'archived')
  assert.equal(service.get(fresh.id).messages.length, 0)
  assert.deepEqual(service.list().map(chat => chat.id), [original.id])
  assert.equal(db.prepare('SELECT count(*) AS n FROM conversations').get().n, 3)
  service.activate(original.id)
  assert.equal(service.current().id, original.id)
  assert.equal(service.get(fresh.id).conversation.status, 'archived')
  closeDatabase(); service = conversationsForUser('alice')
  const saved = service.get(original.id)
  assert.equal(saved.messages.length, 2)
  assert.equal(saved.messages[0].type, 'user'); assert.equal(saved.messages[1].content, 'A brewing answer')
  assert.equal(typeof saved.messages[0].timestamp, 'string')
  service.remove(fresh.id)
  assert.equal(applicationForUser('alice').getRecipe(recipe.id).name, 'Session IPA')
  assert.deepEqual(service.list().map(chat => chat.id), [original.id])
}))

test('history and search hide empty chats without deleting them; the first saved message makes them eligible', () => sandbox('empty-history', db => {
  const store = conversationsForUser('alice'), empty = store.current()
  store.rename(empty.id, 'Hidden renamed draft')
  const before = rows(db, 'conversations')
  for (const query of ['', 'Hidden', empty.id]) assert.deepEqual(store.list(query), [])
  assert.deepEqual(rows(db, 'conversations'), before)
  assert.equal(store.current().id, empty.id)
  assert.equal(store.get(empty.id).messages.length, 0)

  const noteChat = store.create({ title: 'First saved note' })
  assert.deepEqual(store.list('First saved note'), [])
  store.appendNote(noteChat.id, 'Persisted activity note')
  assert.deepEqual(store.list().map(chat => chat.id), [noteChat.id])
  assert.deepEqual(store.list('persisted activity').map(chat => chat.id), [noteChat.id])

  const failed = store.create(), failure = store.beginTurn(failed.id, input('Saved failed question'))
  assert.ok(store.list().some(chat => chat.id === failed.id))
  store.finishTurn(failure.turnId, 'failed', 'Synthetic agent failure')
  const interrupted = store.create(), interruption = store.beginTurn(interrupted.id, input('Saved interrupted question'))
  store.finishTurn(interruption.turnId, 'interrupted')
  assert.deepEqual(store.list().map(chat => chat.id).sort(), [noteChat.id, failed.id, interrupted.id].sort())
  assert.deepEqual(store.list('failed').map(chat => chat.id), [failed.id])
  assert.deepEqual(store.list('interrupted').map(chat => chat.id), [interrupted.id])
  assert.equal(store.current().id, interrupted.id)
  assert.equal(db.prepare('SELECT count(*) AS n FROM conversations').get().n, 4)
  assert.equal(store.get(empty.id).conversation.status, 'archived')
  assert.deepEqual(conversationsForUser('bob').list(), [])
}))

test('every conversation, turn, binding, summary and recipe lookup enforces owner isolation', () => sandbox('isolation', () => {
  const alice = conversationsForUser('alice'), bob = conversationsForUser('bob')
  const recipe = applicationForUser('alice').createRecipe({ name: 'Private recipe' })
  const chat = historical(alice, recipe.id), turn = alice.beginTurn(chat.id, input())
  const denied = [
    () => bob.get(chat.id), () => bob.getContext(chat.id), () => bob.activate(chat.id), () => bob.remove(chat.id),
    () => bob.beginTurn(chat.id, input()), () => bob.getBinding(chat.id, 'codex'),
    () => bob.setBinding(chat.id, 'codex', { threadId: 'thread', throughSequence: 0 }),
    () => bob.invalidateBinding(chat.id, 'codex'), () => bob.markCompacted(chat.id),
    () => bob.saveSummary(chat.id, { summary: 'summary', throughSequence: 2 }),
    () => bob.heartbeat(turn.turnId), () => bob.updateAssistant(turn.turnId, { content: 'overwrite' }),
    () => bob.recordEvent(turn.turnId, { type: 'text', content: 'overwrite' }), () => bob.finishTurn(turn.turnId, 'completed'),
    () => bob.create({ carryFromId: chat.id }),
    () => bob.assertIdle(chat.id), () => bob.appendNote(chat.id, 'Unowned note'),
    () => bob.listBindings(chat.id), () => bob.listThreads(chat.id), () => bob.claimDeletion(chat.id, randomUUID()),
    () => bob.rename(chat.id, 'Unowned title'),
    () => bob.captureRecipeActivity(turn.turnId, recipe.id), () => bob.recordRecipeActivity(turn.turnId, recipe.id, 'read'),
  ]
  for (const operation of denied) assert.throws(operation, error => error.status === 404)
  assert.deepEqual(bob.list(), [])
  assert.throws(() => conversationsForUser('unknown'), error => error.status === 404)
  alice.finishTurn(turn.turnId, 'interrupted')
}))

test('new titles derive locally from the first accepted message and remain stable across replay and later turns', () => sandbox('automatic-title', db => {
  let service = conversationsForUser('alice'), chat = service.current()
  assert.equal(chat.title, 'New chat')
  assert.equal(db.prepare('SELECT title FROM conversations WHERE id=?').get(chat.id).title, '')
  assert.throws(() => service.beginTurn(chat.id, input(' \n ')), error => error.status === 400)
  assert.equal(service.get(chat.id).conversation.title, 'New chat')
  closeDatabase(); service = conversationsForUser('alice')
  const request = input('  Help\n me\t brew   a dry stout.  '), turn = service.beginTurn(chat.id, request)
  assert.equal(service.get(chat.id).conversation.title, 'Help me brew a dry stout.')
  assert.equal(service.beginTurn(chat.id, request).replayed, true)
  service.finishTurn(turn.turnId, 'failed')
  assert.equal(service.get(chat.id).conversation.title, 'Help me brew a dry stout.')
  const second = service.beginTurn(chat.id, input('An unrelated second question'))
  service.finishTurn(second.turnId, 'completed')
  service.rename(chat.id, 'My named stout')
  assert.equal(service.beginTurn(chat.id, request).replayed, true)
  closeDatabase()
  assert.equal(conversationsForUser('alice').get(chat.id).conversation.title, 'My named stout')
}))

test('automatic titles preserve Unicode graphemes and byte bounds, and skip compaction maintenance', () => sandbox('title-unicode', () => {
  const service = conversationsForUser('alice'), chat = service.current()
  const compact = service.beginTurn(chat.id, input('/compact'))
  service.finishTurn(compact.turnId, 'completed')
  assert.equal(service.get(chat.id).conversation.title, 'New chat')
  const family = '👨‍👩‍👧‍👦', turn = service.beginTurn(chat.id, input(family.repeat(40)))
  const title = service.get(chat.id).conversation.title
  assert.ok(Buffer.byteLength(title, 'utf8') <= 200)
  assert.ok(title.endsWith('…'))
  assert.match(title.slice(0, -1), /^(👨‍👩‍👧‍👦)+$/u)
  service.finishTurn(turn.turnId, 'completed')
  const controls = service.create()
  const controlled = service.beginTurn(controls.id, input('Brew\u0000 a\u0007 beer'))
  assert.equal(service.get(controls.id).conversation.title, 'Brew a beer')
  service.finishTurn(controlled.turnId, 'completed')
}))

test('explicit, manual and historical names are never replaced even when identical to defaults', () => sandbox('explicit-title', db => {
  const service = conversationsForUser('alice')
  for (const explicit of ['General conversation', '  Named\n\t chat  ']) {
    const chat = service.create({ title: explicit })
    finish(service, chat.id)
    assert.equal(service.get(chat.id).conversation.title, explicit.trim().replace(/\s+/g, ' '))
  }
  const recipeChat = service.create({ title: 'Recipe name conversation' })
  finish(service, recipeChat.id)
  assert.equal(service.get(recipeChat.id).conversation.title, 'Recipe name conversation')
  const renamed = service.create()
  service.rename(renamed.id, 'General conversation')
  finish(service, renamed.id)
  assert.equal(service.get(renamed.id).conversation.title, 'General conversation')
  const historical = service.create()
  db.prepare('UPDATE conversations SET title=? WHERE id=?').run('Historical default name', historical.id)
  finish(service, historical.id)
  assert.equal(service.get(historical.id).conversation.title, 'Historical default name')
}))

test('rename validates normalized titles, owner and idle claims while preserving full history and native context', () => sandbox('rename', () => {
  const service = conversationsForUser('alice'), chat = service.current()
  const turn = finish(service, chat.id)
  service.setBinding(chat.id, 'codex', { threadId: 'rename-native', throughSequence: 2 })
  const before = service.get(chat.id).messages, context = service.getContext(chat.id), binding = service.getBinding(chat.id, 'codex')
  assert.equal(service.rename(chat.id, ' \n  Brewer’s\t renamed   chat  ').title, 'Brewer’s renamed chat')
  assert.deepEqual(service.get(chat.id).messages, before)
  assert.deepEqual(service.getContext(chat.id), context)
  assert.deepEqual(service.getBinding(chat.id, 'codex'), binding)
  for (const invalid of ['', ' \t\n', 'x'.repeat(201), '🍺'.repeat(51), 'Title\u0000hidden', 'Title\u0085hidden', null, 42]) {
    assert.throws(() => service.rename(chat.id, invalid), error => error.status === 400)
    assert.equal(service.get(chat.id).conversation.title, 'Brewer’s renamed chat')
  }
  const running = service.beginTurn(chat.id, input())
  assert.throws(() => service.rename(chat.id, 'While running'), error => error.status === 409)
  service.finishTurn(running.turnId, 'completed')
  assert.equal(service.beginTurn(chat.id, { ...input(), requestId: getDatabase().prepare('SELECT request_id FROM conversation_turns WHERE id=?').get(turn.turnId).request_id }).replayed, true)
  const recipe = applicationForUser('alice').createRecipe({ name: 'Deleted name' }), tombstone = historical(service, recipe.id)
  applicationForUser('alice').deleteRecipe(recipe.id)
  assert.equal(service.rename(tombstone.id, 'Saved deleted-recipe history').recipes[0].deleted, true)
  assert.equal(service.get(tombstone.id).conversation.title, 'Saved deleted-recipe history')
  assert.throws(() => conversationsForUser('bob').rename(chat.id, 'No'), error => error.status === 404)
}))

test('server search finds literal case-insensitive content throughout owned history, excluding metadata', () => sandbox('search-content', () => {
  const alice = conversationsForUser('alice'), bob = conversationsForUser('bob'), chat = alice.current(), other = bob.current()
  finish(alice, chat.id, 'Older %_ literal quote\' and RÄUCHER ingredient discussion', { reasoningPreview: 'metadata-only-hidden-value' })
  for (let i = 0; i < 60; i++) finish(alice, chat.id, `Later answer ${i}`)
  finish(bob, other.id, 'Older %_ literal quote\' and RÄUCHER ingredient discussion')
  assert.equal(alice.get(chat.id).messages.some(message => message.content.includes('RÄUCHER')), false)
  for (const query of ['räucher', '%_', "quote'", 'OLDER']) assert.deepEqual(alice.list(query).map(item => item.id), [chat.id])
  assert.deepEqual(alice.list('metadata-only-hidden-value'), [])
  assert.deepEqual(alice.list('_literal-not-present'), [])
  assert.deepEqual(alice.list(' \t ' ).map(item => item.id), [chat.id])
  assert.throws(() => alice.list('x'.repeat(201)), error => error.status === 400)
  assert.throws(() => alice.list(null), error => error.status === 400)
}))

test('search includes titles, current and snapshotted recipe names/IDs and retains owned deleted history', () => sandbox('search-fields', () => {
  const alice = conversationsForUser('alice'), recipe = applicationForUser('alice').createRecipe({ name: 'Original Saison' })
  const general = alice.create({ title: 'Planning LÄGER' }); finish(alice, general.id)
  const recipeChat = historical(alice, recipe.id); finish(alice, recipeChat.id)
  assert.deepEqual(alice.list('läger').map(chat => chat.id), [general.id])
  assert.deepEqual(alice.list(recipeChat.id.toUpperCase()).map(chat => chat.id), [recipeChat.id])
  assert.deepEqual(alice.list(recipe.id.toUpperCase()).map(chat => chat.id), [recipeChat.id])
  assert.deepEqual(alice.list('saison').map(chat => chat.id), [recipeChat.id])
  applicationForUser('alice').updateRecipe(recipe.id, { name: 'Current Tripel' })
  assert.deepEqual(alice.list('tripel').map(chat => chat.id), [recipeChat.id])
  applicationForUser('alice').deleteRecipe(recipe.id)
  assert.deepEqual(alice.list('saison').map(chat => chat.id), [recipeChat.id])
  assert.deepEqual(alice.list(recipe.id).map(chat => chat.id), [recipeChat.id])
  assert.equal(alice.list('saison')[0].recipes[0].deleted, true)
  assert.deepEqual(conversationsForUser('bob').list('saison'), [])
}))

test('idle activity notes preserve user provenance, advance context, and never fabricate assistant replies', () => sandbox('notes', () => {
  const service = conversationsForUser('alice'), chat = service.current()
  finish(service, chat.id)
  service.setBinding(chat.id, 'codex', { threadId: 'note-thread', throughSequence: 2 })
  assert.equal(service.listBindings(chat.id).length, 1)
  const note = service.appendNote(chat.id, 'The brewer changed the batch size to 25 litres.')
  assert.equal(note.type, 'user'); assert.equal(note.metadata.activityNote, true); assert.equal(note.turnId, null)
  assert.equal(service.get(chat.id).messages.length, 3)
  assert.equal(service.getContext(chat.id).contextRevision, 1)
  assert.equal(service.getBinding(chat.id, 'codex'), null)
  assert.equal(service.listThreads(chat.id).length, 1)
  service.saveSummary(chat.id, { summary: 'Includes the explicit brewer activity note.', throughSequence: note.sequence })
  const turn = service.beginTurn(chat.id, input())
  assert.throws(() => service.appendNote(chat.id, 'Concurrent change'), error => error.status === 409)
  service.finishTurn(turn.turnId, 'completed')
}))

test('historical native threads survive binding invalidation and deletion claims lock archived/deleted scopes', () => sandbox('delete-claim', () => {
  const service = conversationsForUser('alice'), recipe = applicationForUser('alice').createRecipe({ name: 'Deletion fixture' })
  const chat = historical(service, recipe.id)
  finish(service, chat.id)
  service.setBinding(chat.id, 'codex', { threadId: 'first-thread', throughSequence: 2 })
  service.setBinding(chat.id, 'codex', { threadId: 'second-thread', throughSequence: 2 })
  service.invalidateBinding(chat.id, 'codex')
  assert.equal(service.listThreads(chat.id).length, 2)
  service.create()
  applicationForUser('alice').deleteRecipe(recipe.id)
  const requestId = randomUUID(), claim = service.claimDeletion(chat.id, requestId)
  assert.equal(claim.userMessageId, ''); assert.equal(claim.assistantMessageId, '')
  assert.equal(service.claimDeletion(chat.id, requestId).replayed, true)
  assert.equal(service.get(chat.id).messages.length, 2)
  assert.throws(() => service.beginTurn(service.current().id, input()), error => error.status === 409)
  assert.throws(() => service.remove(chat.id), error => error.status === 409)
  assert.equal(service.listThreads(chat.id).length, 2)
  service.finishTurn(claim.turnId, 'failed', 'Synthetic native deletion failure')
  assert.equal(service.get(chat.id).messages.length, 2)
  const retry = service.claimDeletion(chat.id, randomUUID())
  service.remove(chat.id, retry.turnId)
  assert.throws(() => service.get(chat.id), error => error.status === 404)
  assert.equal(getDatabase().prepare('SELECT count(*) AS n FROM conversation_threads').get().n, 0)
}))

test('operator JSON round trip preserves transcripts, summaries, notes, bindings, events, tombstones and IDs', () => sandbox('snapshot-source', () => {
  const service = conversationsForUser('alice'), recipe = applicationForUser('alice').createRecipe({ name: 'Snapshot recipe' })
  const chat = historical(service, recipe.id), turn = service.beginTurn(chat.id, input())
  service.recordEvent(turn.turnId, { type: 'tool_call', tool_id: 'snapshot-tool', tool_name: 'get_recipe_by_id', tool_args: { recipe_id: recipe.id } })
  service.recordEvent(turn.turnId, { type: 'tool_result', tool_id: 'snapshot-tool', tool_name: 'get_recipe_by_id', tool_result: { name: recipe.name } })
  service.updateAssistant(turn.turnId, { content: 'Saved answer' }); service.finishTurn(turn.turnId, 'completed')
  service.setBinding(chat.id, 'codex', { threadId: 'old-thread', throughSequence: 2 })
  service.appendNote(chat.id, 'Brewer activity note')
  service.saveSummary(chat.id, { summary: 'Stored summary', throughSequence: 3 })
  service.setBinding(chat.id, 'codex', { threadId: 'new-thread', throughSequence: 3 })
  const general = service.current(); finish(service, general.id)
  const deletedRecipe = applicationForUser('alice').createRecipe({ name: 'Deleted snapshot recipe' }), tombstone = historical(service, deletedRecipe.id)
  applicationForUser('alice').deleteRecipe(deletedRecipe.id)
  const before = exportDatabaseSnapshot()
  assert.ok(before.tables.conversation_messages.every(message => typeof message.metadata === 'object'))
  restore(before, 'snapshot-destination')
  assert.deepEqual(exportDatabaseSnapshot().tables, before.tables)
  assert.equal(conversationsForUser('alice').getContext(chat.id).summary, 'Stored summary')
  assert.equal(conversationsForUser('alice').get(tombstone.id).conversation.recipes[0].deleted, true)
  closeDatabase(); assert.equal(getDatabase().prepare('PRAGMA foreign_key_check').all().length, 0)
}))

test('snapshot restore rejects cross-owner recipes/turns/messages and malformed scope/turn references atomically', () => sandbox('snapshot-invalid-source', () => {
  const alice = conversationsForUser('alice'), bob = conversationsForUser('bob')
  const recipe = applicationForUser('alice').createRecipe({ name: 'Owned recipe' }), chat = historical(alice, recipe.id), other = bob.current()
  finish(alice, chat.id)
  const valid = exportDatabaseSnapshot(), modifications = [
    snapshot => { Object.assign(snapshot.tables.conversations.find(row => row.id === chat.id), { user_id: 'bob', status: 'archived' }) },
    snapshot => { snapshot.tables.conversation_turns[0].user_id = 'bob' },
    snapshot => { snapshot.tables.conversation_messages[0].conversation_id = other.id },
    snapshot => { snapshot.tables.conversations.find(row => row.id === chat.id).scope_key = 'recipe:' + recipe.id },
    snapshot => { snapshot.tables.conversation_turns[0].user_message_id = 'missing-message' },
  ]
  for (let i = 0; i < modifications.length; i++) {
    const malformed = structuredClone(valid); modifications[i](malformed)
    closeDatabase(); process.env.BREWEY_DATABASE_PATH = join(folder, 'snapshot-invalid-' + i + '.sqlite')
    assert.throws(() => importDatabaseSnapshot(malformed.tables), /invalid conversation/)
    const db = getDatabase()
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM recipes').get().n, 0)
    for (const table of CONVERSATION_TABLES) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
  }
}))

test('snapshot running-turn restore interrupts partial work immediately and preserves native cleanup ledger', () => sandbox('snapshot-running-source', () => {
  const service = conversationsForUser('alice'), chat = service.current(), turn = service.beginTurn(chat.id, input())
  service.updateAssistant(turn.turnId, { content: 'Partial before operator snapshot', metadata: { reasoningPreview: 'Saved reasoning' } })
  service.recordEvent(turn.turnId, { type: 'tool_result', tool_id: 'saved-tool', tool_name: 'create_recipe', tool_result: { id: 'synthetic-reference' } })
  service.setBinding(chat.id, 'codex', { threadId: 'running-native', throughSequence: 0, turnId: turn.turnId })
  const snapshot = exportDatabaseSnapshot()
  // Old snapshots without a ledger still retain IDs from their current binding.
  delete snapshot.tables.conversation_threads
  const counts = restore(snapshot, 'snapshot-running-destination'), restored = conversationsForUser('alice')
  assert.equal(counts.conversation_bindings, 0); assert.equal(counts.conversation_threads, 1)
  assert.equal(restored.get(chat.id).conversation.running, false)
  const partial = restored.get(chat.id).messages[1]
  assert.equal(partial.content, 'Partial before operator snapshot')
  assert.equal(partial.metadata.turnStatus, 'interrupted')
  assert.equal(partial.metadata.toolCalls[0].status, 'success')
  assert.equal(restored.getBinding(chat.id, 'codex'), null)
  assert.equal(restored.listThreads(chat.id)[0].threadId, 'running-native')
  assert.equal(restored.beginTurn(chat.id, { requestId: getDatabase().prepare('SELECT request_id FROM conversation_turns WHERE id=?').get(turn.turnId).request_id, message: 'A brewing question', adapterId: 'codex', model: 'fixture-model' }).replayed, true)
  const next = restored.beginTurn(chat.id, input()); restored.finishTurn(next.turnId, 'completed')
}))

test('recipe deletion preserves resumable current history and stable historical associations', () => sandbox('tombstone', db => {
  const service = conversationsForUser('alice'), recipe = applicationForUser('alice').createRecipe({ name: 'Deleted recipe title' })
  const general = service.current(), recipeChat = historical(service, recipe.id)
  finish(service, recipeChat.id)
  applicationForUser('alice').deleteRecipe(recipe.id)
  const deleted = service.get(recipeChat.id)
  assert.deepEqual(deleted.conversation.recipes, [{ recipeId: recipe.id, recipeTitle: 'Deleted recipe title', deleted: true, activities: ['historical'] }])
  assert.equal(deleted.conversation.status, 'active')
  assert.equal(deleted.messages.length, 2)
  assert.equal(service.current().id, recipeChat.id)
  assert.deepEqual(service.list().map(chat => chat.id), [recipeChat.id])
  service.activate(general.id)
  service.activate(recipeChat.id)
  const resumed = service.beginTurn(recipeChat.id, input('Continue with another recipe'))
  service.finishTurn(resumed.turnId, 'completed')
  service.appendNote(recipeChat.id, 'Recipe deletion retained the discussion')
  assert.equal(service.get(recipeChat.id).messages.length, 5)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  db.prepare('DELETE FROM users WHERE id=?').run('alice')
  assert.equal(db.prepare('SELECT count(*) AS n FROM conversations').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM conversation_messages').get().n, 0)
}))

test('request replay is idempotent, mismatched reuse fails, and DB enforces one running turn per user', () => sandbox('idempotence', db => {
  const alice = conversationsForUser('alice'), bob = conversationsForUser('bob')
  const other = alice.current(), general = alice.create()
  const request = input(), claim = alice.beginTurn(general.id, request), replay = alice.beginTurn(general.id, request)
  assert.equal(replay.replayed, true); assert.equal(replay.turnId, claim.turnId)
  assert.throws(() => alice.beginTurn(general.id, { ...request, message: 'different' }), error => error.status === 409)
  assert.throws(() => alice.beginTurn(other.id, request), error => error.status === 409)
  assert.throws(() => alice.beginTurn(other.id, input()), error => error.status === 409)
  for (const operation of [() => alice.create(), () => alice.remove(general.id), () => alice.activate(general.id)]) assert.throws(operation, error => error.status === 409)
  const second = new DatabaseSync(process.env.BREWEY_DATABASE_PATH)
  try {
    const existing = rows(db, 'conversation_turns')[0]
    assert.throws(() => second.prepare('INSERT INTO conversation_turns(id,conversation_id,user_id,request_id,user_message_id,assistant_message_id,adapter_id,input_message,status,created_at,updated_at,lease_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), other.id, 'alice', randomUUID(), 'other-user', 'other-assistant', 'codex', 'other', 'running', existing.created_at, existing.updated_at, Date.now() + 100000), /UNIQUE constraint failed/)
  } finally { second.close() }
  const bobClaim = bob.beginTurn(bob.current().id, input())
  bob.finishTurn(bobClaim.turnId, 'completed')
  alice.finishTurn(claim.turnId, 'completed')
  const completeReplay = alice.beginTurn(general.id, request)
  assert.equal(completeReplay.status, 'completed'); assert.equal(completeReplay.replayed, true)
  assert.equal(alice.get(general.id).messages.length, 2)
  alice.activate(other.id)
  const next = alice.beginTurn(other.id, input()); alice.finishTurn(next.turnId, 'completed')
}))

test('partial assistant text, reasoning and tools persist while live leases survive reopen; expired leases recover safely', () => sandbox('recovery', db => {
  let service = conversationsForUser('alice')
  const chat = service.current(), claim = service.beginTurn(chat.id, input())
  service.updateAssistant(claim.turnId, { content: 'Partial answer', metadata: { reasoningPreview: 'Partial reasoning' } })
  service.recordEvent(claim.turnId, { type: 'tool_call', tool_id: 'call1', tool_name: 'get_recipe_by_id', tool_args: { recipe_id: 'synthetic' } })
  service.recordEvent(claim.turnId, { type: 'tool_result', tool_id: 'call1', tool_name: 'get_recipe_by_id', tool_result: { name: 'Result' } })
  service.updateAssistant(claim.turnId, { content: 'More partial answer' })
  const oldExpiry = db.prepare('SELECT lease_expires_at FROM conversation_turns WHERE id=?').get(claim.turnId).lease_expires_at
  service.heartbeat(claim.turnId)
  assert.ok(db.prepare('SELECT lease_expires_at FROM conversation_turns WHERE id=?').get(claim.turnId).lease_expires_at >= oldExpiry)
  closeDatabase(); service = conversationsForUser('alice')
  assert.equal(service.get(chat.id).conversation.running, true)
  assert.equal(service.getContext(chat.id).messages.length, 0)
  const partial = service.get(chat.id).messages[1]
  assert.equal(partial.content, 'More partial answer'); assert.equal(partial.metadata.reasoningPreview, 'Partial reasoning')
  assert.equal(partial.metadata.toolCalls[0].status, 'success'); assert.equal(partial.metadata.toolCalls[0].result.name, 'Result')
  getDatabase().prepare('UPDATE conversation_turns SET lease_expires_at=? WHERE id=?').run(Date.now() - 1, claim.turnId)
  closeDatabase(); service = conversationsForUser('alice')
  const recovered = service.get(chat.id)
  assert.equal(recovered.conversation.running, false)
  assert.equal(recovered.messages[1].content, 'More partial answer')
  assert.equal(recovered.messages[1].metadata.turnStatus, 'interrupted')
  assert.equal(service.getContext(chat.id).messages.length, 2)
  assert.throws(() => service.updateAssistant(claim.turnId, { content: 'Late write' }), error => error.status === 409)
  const next = service.beginTurn(chat.id, input()); service.finishTurn(next.turnId, 'completed')
}))

test('full transcript paging keeps more than50 messages and native bindings/summary compaction preserve archives', () => sandbox('paging', () => {
  const service = conversationsForUser('alice'), chat = service.current()
  for (let i = 0; i < 36; i++) finish(service, chat.id, 'Answer ' + i)
  assert.equal(service.getContext(chat.id).messages.length, 72)
  const page = service.get(chat.id, { limit: 20 })
  assert.equal(page.messages.length, 20); assert.equal(page.hasMore, true); assert.equal(page.messages[0].sequence, 53)
  const previous = service.get(chat.id, { limit: 100, before: page.nextBefore })
  assert.equal(previous.messages.length, 52); assert.equal(previous.messages[0].sequence, 1); assert.equal(previous.hasMore, false)
  service.setBinding(chat.id, 'codex', { threadId: 'native-thread', throughSequence: 72, model: 'fixture-model' })
  service.markCompacted(chat.id)
  assert.equal(service.getBinding(chat.id, 'codex').threadId, 'native-thread')
  const claim = service.beginTurn(chat.id, input())
  assert.throws(() => service.saveSummary(chat.id, { summary: 'Summary', throughSequence: 70 }), error => error.status === 409)
  service.saveSummary(chat.id, { summary: 'Authoritative read-only summary', throughSequence: 70, turnId: claim.turnId })
  assert.equal(service.getBinding(chat.id, 'codex'), null)
  const context = service.getContext(chat.id)
  assert.equal(context.summaryThroughSequence, 70); assert.equal(context.contextRevision, 1); assert.equal(context.lastSequence, 72)
  assert.deepEqual(context.messages.map(row => row.sequence), [71, 72])
  assert.throws(() => service.saveSummary(chat.id, { summary: 'Invalid', throughSequence: 74, turnId: claim.turnId }), error => error.status === 400)
  assert.throws(() => service.setBinding(chat.id, 'codex', { threadId: 'stale', throughSequence: 72, contextRevision: 0, turnId: claim.turnId }), error => error.status === 409)
  service.setBinding(chat.id, 'codex', { threadId: 'replacement', throughSequence: 72, contextRevision: 1, turnId: claim.turnId })
  service.finishTurn(claim.turnId, 'completed')
  assert.equal(service.get(chat.id).messages.length, 74)
  const carried = service.create({ carryFromId: chat.id })
  assert.equal(service.getContext(carried.id).summary, context.summary)
  assert.equal(service.getContext(carried.id).messages.length, 4)
  assert.notEqual(service.get(carried.id).messages[0].id, previous.messages[0].id)
  assert.equal(service.get(chat.id).messages.length, 74)
}))

test('failed begin/event writes roll back claims, transcript, lease and sequence; payload limits are explicit', () => sandbox('rollback', db => {
  const service = conversationsForUser('alice'), chat = service.current()
  db.exec("CREATE TRIGGER fail_messages BEFORE INSERT ON conversation_messages BEGIN SELECT RAISE(ABORT,'synthetic message failure'); END;")
  assert.throws(() => service.beginTurn(chat.id, input()), /synthetic message failure/)
  assert.equal(rows(db, 'conversation_turns').length, 0); assert.equal(service.get(chat.id).messages.length, 0)
  assert.equal(rows(db, 'conversations')[0].next_sequence, 0)
  db.exec('DROP TRIGGER fail_messages')
  const claim = service.beginTurn(chat.id, input())
  assert.throws(() => service.updateAssistant(claim.turnId, { content: 'x'.repeat(1024 * 1024 + 1) }), error => error.status === 400)
  const before = rows(db, 'conversation_turns')
  db.exec("CREATE TRIGGER fail_events BEFORE INSERT ON conversation_events BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END;")
  assert.throws(() => service.recordEvent(claim.turnId, { type: 'text', content: 'uncommitted' }), /synthetic event failure/)
  assert.deepEqual(rows(db, 'conversation_turns'), before)
  assert.equal(rows(db, 'conversation_events').length, 0)
  db.exec('DROP TRIGGER fail_events')
  service.updateAssistant(claim.turnId, { content: 'Retained partial answer' })
  service.finishTurn(claim.turnId, 'failed', 'Synthetic provider failure')
  const partial = service.get(chat.id).messages[1]
  assert.equal(partial.content, 'Retained partial answer'); assert.equal(partial.metadata.turnStatus, 'failed')
  assert.equal(partial.metadata.error, 'Synthetic provider failure')
  assert.equal(partial.metadata.isStreaming, false)
}))
