import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getDatabase, closeDatabase, claimDatabaseMaintenance, claimDatabaseBackup } from '../database.ts'
import { createDatabaseBackup, restoreDatabaseBackup, backupDatabase, MAX_BACKUP_BYTES } from '../database-backup.ts'
import { applicationForUser } from '../application-service.ts'
import { conversationsForUser } from '../conversations.ts'
import { hashPassword, signIn, sessionUser, secretHash } from '../auth.ts'
import { createToken } from '../tokens.ts'

const root = await mkdtemp(join(tmpdir(), 'brewey-backup-test-'))
const previous = process.env.BREWEY_DATABASE_PATH
const passwordHash = await hashPassword('synthetic-backup-password')
async function fixture(name, operation) {
  const previousPath = process.env.BREWEY_DATABASE_PATH
  closeDatabase(); delete globalThis.__breweyDatabaseMaintenance
  const directory = join(root, name)
  const { mkdir } = await import('node:fs/promises'); await mkdir(directory)
  process.env.BREWEY_DATABASE_PATH = join(directory, 'brewey.sqlite')
  const db = getDatabase()
  for (const id of ['alice', 'bob']) db.prepare('INSERT INTO users(id,username,password_hash,is_admin) VALUES(?,?,?,?)').run(id, id, passwordHash, Number(id === 'alice'))
  db.prepare("UPDATE installation_settings SET value='true' WHERE key='setup_complete'").run()
  try { await operation(db, directory) } finally {
    closeDatabase(); delete globalThis.__breweyDatabaseMaintenance
    if (previousPath === undefined) delete process.env.BREWEY_DATABASE_PATH
    else process.env.BREWEY_DATABASE_PATH = previousPath
  }
}
after(async () => { closeDatabase(); delete globalThis.__breweyDatabaseMaintenance; await rm(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.BREWEY_DATABASE_PATH; else process.env.BREWEY_DATABASE_PATH = previous })
const turnInput = () => ({ requestId: crypto.randomUUID(), message: 'Synthetic brewing question', adapterId: 'codex' })
async function bytesFromBackup() { const saved = await createDatabaseBackup('alice'); try { return await readFile(saved.path) } finally { await saved.cleanup() } }
async function changedBackup(directory, bytes, mutate) {
  const path = join(directory, crypto.randomUUID() + '.sqlite'); await writeFile(path, bytes, { mode: 0o600 })
  const db = new DatabaseSync(path); try { mutate(db) } finally { db.close() }
  return readFile(path)
}
function restart() { closeDatabase(); delete globalThis.__breweyDatabaseMaintenance; return getDatabase() }

test('administrator download is a private standalone consistent WAL snapshot and excludes external files', async () => fixture('save', async (db, directory) => {
  const app = applicationForUser('alice'), recipe = app.createRecipe({ name: 'Committed WAL recipe' })
  await writeFile(join(directory, 'external-auth.json'), 'synthetic external credential file')
  await assert.rejects(createDatabaseBackup('bob'), error => error.status === 403)
  const saved = await createDatabaseBackup('alice')
  assert.ok(saved.size > 100)
  assert.equal((await stat(saved.path)).mode & 0o777, 0o600)
  const copy = new DatabaseSync(saved.path, { readOnly: true })
  try {
    assert.equal(copy.prepare('SELECT name FROM recipes WHERE id=?').get(recipe.id).name, recipe.name)
    assert.equal(copy.prepare('PRAGMA journal_mode').get().journal_mode, 'delete')
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.equal(copy.prepare('SELECT count(*) AS n FROM users').get().n, 2)
  } finally { copy.close() }
  assert.equal(db.prepare('SELECT count(*) AS n FROM recipes').get().n, 1)
  assert.equal((await readdir(join(saved.path, '..'))).length, 1)
  await saved.cleanup(); await assert.rejects(stat(saved.path), error => error.code === 'ENOENT')
}))

test('shared operator backup refuses to overwrite existing backups', async () => fixture('operator', async (_db, directory) => {
  const output = join(directory, 'operator.sqlite')
  const first = await backupDatabase(process.env.BREWEY_DATABASE_PATH, output)
  assert.equal(first.restore_verified, true)
  const bytes = await readFile(output)
  await assert.rejects(backupDatabase(process.env.BREWEY_DATABASE_PATH, output), error => error.code === 'EEXIST')
  assert.deepEqual(await readFile(output), bytes)
}))

test('restore requires an administrator and bounded standalone current-schema input, preserving live data on rejection', async () => fixture('reject', async (db, directory) => {
  applicationForUser('alice').createRecipe({ name: 'Original live data' })
  const valid = await bytesFromBackup()
  await assert.rejects(restoreDatabaseBackup('bob', valid), error => error.status === 403)
  await assert.rejects(restoreDatabaseBackup('alice', new Uint8Array(MAX_BACKUP_BYTES + 1)), error => error.status === 413)
  await assert.rejects(restoreDatabaseBackup('alice', new Uint8Array(100)), /standalone/)
  const wal = Buffer.from(valid); wal[18] = 2; wal[19] = 2
  await assert.rejects(restoreDatabaseBackup('alice', wal), /standalone/)
  const attempts = [
    candidate => candidate.exec('PRAGMA user_version=3'),
    candidate => candidate.exec('CREATE VIEW unauthorized AS SELECT * FROM users'),
    candidate => candidate.exec("CREATE TRIGGER malicious AFTER DELETE ON sessions BEGIN DELETE FROM recipes; END"),
    candidate => candidate.exec("UPDATE users SET user_metadata='[]'"),
    candidate => candidate.exec('UPDATE users SET is_admin=0'),
    candidate => candidate.exec("UPDATE users SET password_hash='scrypt$invalid'"),
    candidate => candidate.exec("UPDATE installation_settings SET value='false' WHERE key='setup_complete'"),
    candidate => candidate.exec("UPDATE installation_settings SET value='invalid' WHERE key='reference_catalog_revision'"),
    candidate => candidate.exec("PRAGMA foreign_keys=OFF; INSERT INTO sessions(hash,user_id,expires_at) VALUES('invalid','missing-owner',1)"),
  ]
  for (const mutate of attempts) {
    const bytes = await changedBackup(directory, valid, mutate)
    await assert.rejects(restoreDatabaseBackup('alice', bytes), error => error.status === 400)
    assert.equal(getDatabase(), db)
    assert.equal(db.prepare('SELECT name FROM recipes').get().name, 'Original live data')
  }
}))

test('restoration rejects cross-owner chat metadata even when SQLite foreign keys are valid', async () => fixture('reject-owner', async (_db, directory) => {
  const store = conversationsForUser('alice'), chat = store.current(), turn = store.beginTurn(chat.id, turnInput())
  store.finishTurn(turn.turnId, 'completed')
  const recipe = applicationForUser('bob').createRecipe({ name: 'Foreign owned recipe' }), valid = await bytesFromBackup()
  const turnOwner = await changedBackup(directory, valid, candidate => candidate.prepare('UPDATE conversation_turns SET user_id=? WHERE id=?').run('bob', turn.turnId))
  await assert.rejects(restoreDatabaseBackup('alice', turnOwner), /ownership or history/)
  const recipeOwner = await changedBackup(directory, valid, candidate => candidate.prepare("INSERT INTO conversation_recipe_activities(id,conversation_id,turn_id,recipe_key,recipe_id,recipe_title,activity,created_at,updated_at) VALUES(?,?,NULL,?,?,?,'historical',?,?)")
    .run('foreign-activity', chat.id, recipe.id, recipe.id, recipe.name, chat.createdAt, chat.updatedAt))
  await assert.rejects(restoreDatabaseBackup('alice', recipeOwner), /ownership or history/)
}))

test('restore rejects live chat/deletion claims and snapshot preparation before closing live handles', async () => fixture('busy', async (db) => {
  const bytes = await bytesFromBackup(), store = conversationsForUser('alice'), chat = store.current()
  const turn = store.beginTurn(chat.id, turnInput())
  await assert.rejects(restoreDatabaseBackup('alice', bytes), error => error.status === 409)
  assert.equal(getDatabase(), db)
  store.finishTurn(turn.turnId, 'completed')
  const deletion = store.claimDeletion(chat.id, crypto.randomUUID())
  await assert.rejects(restoreDatabaseBackup('alice', bytes), error => error.status === 409)
  store.finishTurn(deletion.turnId, 'failed')
  const reservation = claimDatabaseBackup()
  assert.throws(claimDatabaseMaintenance, error => error.status === 409)
  reservation.release(); reservation.release()
  assert.equal(getDatabase(), db)
}))

test('failed restore after the barrier releases maintenance and reopens the original database', async () => fixture('failure', async (db) => {
  applicationForUser('alice').createRecipe({ name: 'Must survive failed restore' })
  const bytes = await bytesFromBackup(), path = process.env.BREWEY_DATABASE_PATH
  // Pin another WAL reader so the checkpoint cannot truncate committed frames.
  db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run('reader-base', 'alice', Date.now() + 10000)
  const reader = new DatabaseSync(path); reader.exec('BEGIN'); reader.prepare('SELECT * FROM users').all()
  db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run('reader-new-frame', 'alice', Date.now() + 10000)
  try { await assert.rejects(restoreDatabaseBackup('alice', bytes), /database is busy/) } finally { reader.exec('ROLLBACK'); reader.close() }
  assert.equal(getDatabase().prepare('SELECT name FROM recipes').get().name, 'Must survive failed restore')
}))

test('successful restore closes old handles, blocks all stale async database access, clears sessions/bindings and preserves a safety copy', async () => fixture('restore', async (db, directory) => {
  const app = applicationForUser('alice'), recipe = app.createRecipe({ name: 'Recipe in saved backup' })
  const store = conversationsForUser('alice'), chat = store.current(), turn = store.beginTurn(chat.id, { ...turnInput(), selectedRecipeId: recipe.id })
  store.updateAssistant(turn.turnId, { content: 'Partial saved reply', metadata: { isStreaming: true, isExecutingTool: true } })
  store.setBinding(chat.id, 'codex', { threadId: 'original-native-thread', throughSequence: 0, turnId: turn.turnId })
  const session = 'synthetic-browser-session'; db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(secretHash(session), 'alice', Date.now() + 100000)
  createToken('alice', { name: 'Saved PAT', scopes: ['recipes:read'] })
  const saved = await bytesFromBackup()
  store.finishTurn(turn.turnId, 'completed'); app.updateRecipe(recipe.id, { name: 'Newer live recipe' })
  let releaseStale
  const wait = new Promise(resolve => { releaseStale = resolve })
  const staleRequest = (async () => { await wait; return applicationForUser('alice').createRecipe({ name: 'Stale async new operation' }) })()
  await writeFile(join(directory, 'external-auth.json'), 'excluded synthetic agent state')
  assert.deepEqual(await restoreDatabaseBackup('alice', saved), { restartRequired: true })
  releaseStale()
  await assert.rejects(staleRequest, error => error.status === 503)
  assert.throws(getDatabase, error => error.status === 503)
  assert.throws(() => app.updateRecipe(recipe.id, { name: 'Stale mutation' }), error => error.status === 503)
  assert.throws(() => store.appendNote(chat.id, 'Stale continuation'), error => error.status === 503)
  assert.throws(() => db.prepare('SELECT 1'), /database is not open/)
  const safetyDirectories = (await readdir(directory)).filter(name => name.startsWith('.brewey-restore-'))
  assert.equal(safetyDirectories.length, 1)
  const safety = new DatabaseSync(join(directory, safetyDirectories[0], 'before-restore.sqlite'), { readOnly: true })
  try { assert.equal(safety.prepare('SELECT name FROM recipes').get().name, 'Newer live recipe') } finally { safety.close() }
  const restored = restart()
  assert.equal(restored.prepare('SELECT name FROM recipes').get().name, 'Recipe in saved backup')
  assert.equal(sessionUser(session), null)
  assert.equal(restored.prepare('SELECT count(*) AS n FROM sessions').get().n, 0)
  assert.equal(restored.prepare('SELECT count(*) AS n FROM api_tokens').get().n, 1)
  assert.equal(restored.prepare('SELECT count(*) AS n FROM conversation_bindings').get().n, 0)
  assert.equal(restored.prepare('SELECT count(*) AS n FROM conversation_threads').get().n, 1)
  const partial = conversationsForUser('alice').get(chat.id).messages[1]
  assert.equal(partial.content, 'Partial saved reply'); assert.equal(partial.metadata.turnStatus, 'interrupted')
  assert.equal(partial.metadata.isStreaming, false); assert.equal(partial.metadata.isExecutingTool, false)
  assert.equal(conversationsForUser('alice').get(chat.id).conversation.running, false)
  assert.equal((await signIn('alice', 'synthetic-backup-password')).user.id, 'alice')
  assert.equal(await readFile(join(directory, 'external-auth.json'), 'utf8'), 'excluded synthetic agent state')
}))
