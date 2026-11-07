import { seedIngredients } from './fixtures/ingredients.ts'
import nodeTest, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup } from 'node:sqlite'
import { CAPABILITIES } from '../../../types/access.ts'
import { createSchemaReference, getDatabase, closeDatabase } from '../database.ts'
import { createHostedBackup } from '../hosted-backup.ts'
import { applicationForUser, BrewingApplication } from '../application-service.ts'
import { exportDatabaseSnapshot } from '../migration.ts'
import { previewFirstRunBackup, restoreFirstRunBackup, restoreDatabaseBackup, createDatabaseBackup } from '../database-backup.ts'
import { hashPassword, signIn, register, needsSetup } from '../auth.ts'
import { ingredientSetupStatus, startIngredientSetup } from '../ingredient-setup.ts'
const root = await mkdtemp(join(tmpdir(), 'brewey-hosted-roundtrip-'))
const originalPath = process.env.BREWEY_DATABASE_PATH
const password = 'synthetic-new-local-password'
const oldHash = await hashPassword('synthetic-source-password')
function test(name, operation) {
  nodeTest(name, async () => {
    const previous = process.env.BREWEY_DATABASE_PATH
    try { await operation() } finally {
      closeDatabase(); delete globalThis.__breweyDatabaseMaintenance
      if (previous === undefined) delete process.env.BREWEY_DATABASE_PATH
      else process.env.BREWEY_DATABASE_PATH = previous
    }
  })
}
function open(name) {
  closeDatabase(); delete globalThis.__breweyDatabaseMaintenance
  process.env.BREWEY_DATABASE_PATH = join(root, name + '.sqlite')
  return getDatabase()
}
function restart() { closeDatabase(); delete globalThis.__breweyDatabaseMaintenance; return getDatabase() }
after(async () => { closeDatabase(); delete globalThis.__breweyDatabaseMaintenance; if (originalPath === undefined) delete process.env.BREWEY_DATABASE_PATH; else process.env.BREWEY_DATABASE_PATH = originalPath; await rm(root, { recursive: true, force: true }) })
function source() {
  const db = open(crypto.randomUUID()); seedIngredients(db)
  db.prepare('INSERT INTO users(id,username,password_hash,is_admin) VALUES(?,?,?,1)').run('alice', 'alice', oldHash)
  db.prepare("UPDATE installation_settings SET value='true' WHERE key='setup_complete'").run()
  const app = applicationForUser('alice')
  const recipe = app.createRecipe({ name: 'Synthetic cloud recipe', brewing_notes: 'Mash notes', tasting_notes: 'Tasting notes', boil_time_minutes: 60 })
  app.addRelation('grain', recipe.id, { grain_id: app.searchCatalog('grain', {}).items[0].id, amount_kg: 4 })
  app.addRelation('hop', recipe.id, { hop_id: app.searchCatalog('hop', {}).items[0].id, amount_grams: 25, time_minutes: 60, use_type: 'boil', alpha_acid_percent_override: 5 })
  app.addRelation('mash', recipe.id, { step_order: 1, name: 'Saccharification', temperature_c: 65, duration_minutes: 60 })
  app.addRelation('fermentation', recipe.id, { step_order: 1, name: 'Primary', temperature_c: 18, duration_days: 7 })
  app.updateProfile({ profile: 'Synthetic brewer', unit_system: 'imperial', preferences: { agent: 'must-not-export' } })
  return { format: 'brewey-hosted-v1', user_id: 'alice', tables: exportDatabaseSnapshot().tables, calculations: [app.calculations(recipe.id)] }
}
test('hosted export is an ordinary restorable backup with isolated new credentials and calculation fidelity', async () => {
  const snapshot = source(), sourcePath = process.env.BREWEY_DATABASE_PATH
  const bytes = await createHostedBackup(snapshot, 'alice', { username: 'local-owner', password })
  assert.equal(process.env.BREWEY_DATABASE_PATH, sourcePath)
  assert.equal(applicationForUser('alice').listRecipes().total, 1)
  open('first-install')
  assert.deepEqual(await previewFirstRunBackup(bytes), { accounts: 1, recipes: 1, conversations: 0, schemaVersion: 4, upgradedFrom: null })
  assert.equal(needsSetup(), true)
  await restoreFirstRunBackup(bytes); restart()
  const { user } = await signIn('local-owner', password)
  assert.equal(user.is_admin, true)
  const app = applicationForUser(user.id), recipe = app.listRecipes().items[0]
  assert.equal(recipe.name, 'Synthetic cloud recipe')
  assert.equal(recipe.brewing_notes, 'Mash notes')
  assert.equal(app.getRecipe(recipe.id).recipe_mash_steps.length, 1)
  for (const key of ['calculated_og','calculated_fg','calculated_abv','calculated_ibu','calculated_ebc']) assert.equal(app.calculations(recipe.id)[key], snapshot.calculations[0][key])
  assert.equal(app.getProfile().unit_system, 'imperial')
  assert.deepEqual(app.getProfile().preferences, {})
  await assert.rejects(signIn('local-owner', 'synthetic-source-password'))
  await assert.rejects(restoreFirstRunBackup(bytes), error => error.status === 403)
  const download = await createDatabaseBackup(user.id)
  try { await restoreDatabaseBackup(user.id, await readFile(download.path)) } finally { await download.cleanup() }
  restart()
  assert.equal((await signIn('local-owner', password)).user.id, user.id)
})
test('export rejects foreign ownership, missing rows, broken timing and changed calculations without modifying source', async () => {
  const valid = source()
  for (const mutate of [
    s => { s.user_id = 'bob' },
    s => { s.tables.recipes[0].user_id = 'bob' },
    s => { s.tables.recipe_grains[0].recipe_id = 'foreign' },
    s => { delete s.tables.recipe_water },
    s => { s.calculations = [] },
    s => { s.calculations[0].calculated_og += 0.1 },
    s => { delete s.tables.recipe_hops[0].time_minutes },
  ]) {
    const invalid = structuredClone(valid); mutate(invalid)
    await assert.rejects(createHostedBackup(invalid, 'alice', { username: 'local-owner', password }))
  }
  assert.equal(applicationForUser('alice').listRecipes().total, 1)
})
test('simultaneous hosted exports keep accounts and databases separate', async () => {
  const snapshot = source()
  const results = await Promise.all(['owner-one','owner-two'].map(username => createHostedBackup(snapshot, 'alice', { username, password })))
  for (let index = 0; index < results.length; index++) {
    open('concurrent-' + index); await restoreFirstRunBackup(results[index]); restart()
    assert.equal((await signIn(index ? 'owner-two' : 'owner-one', password)).user.username, index ? 'owner-two' : 'owner-one')
    assert.equal(getDatabase().prepare('SELECT count(*) AS n FROM users').get().n, 1)
  }
})
test('mapped hosted ingredients survive empty-cache partial setup, retry, restart and a second restore', async () => {
  const snapshot = source(), db = getDatabase(), app = applicationForUser('alice')
  const canonical = '788bb695-5a95-5ba4-997e-5cd84813520a'
  const hop = snapshot.tables.hops[0]
  Object.assign(hop, { name: 'Saaz', origin: 'United States', form: 'pellet', alpha_acid_percent: 6 })
  db.prepare('UPDATE hops SET data=? WHERE id=?').run(JSON.stringify(hop), hop.id)
  snapshot.calculations = [app.calculations(snapshot.tables.recipes[0].id)]
  const bytes = await createHostedBackup(snapshot, 'alice', { username: 'migration-owner', password })
  open('mapped-restore'); await restoreFirstRunBackup(bytes); restart()
  const { user } = await signIn('migration-owner', password), restored = applicationForUser(user.id)
  const recipe = restored.listRecipes().items[0]
  assert.equal(restored.getRecipe(recipe.id).recipe_hops[0].hop_id, canonical)
  assert.equal(getDatabase().prepare('SELECT count(*) n FROM hops').get().n, 1)
  assert.equal(getDatabase().prepare('SELECT count(*) n FROM grains').get().n, 1)
  assert.equal(getDatabase().prepare('SELECT count(*) n FROM yeasts').get().n, 0)
  const before = restored.calculations(recipe.id)
  const keys = ['BREWEY_INGREDIENT_MANIFEST', 'BREWEY_INGREDIENT_CACHE', 'BREWEY_INGREDIENT_OFFLINE']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const local = Buffer.from('<Grain><F_G_NAME>New Synthetic Malt</F_G_NAME><F_G_TYPE>0</F_G_TYPE><F_G_COLOR>2</F_G_COLOR><F_G_YIELD>80</F_G_YIELD><F_G_RECOMMEND_MASH>1</F_G_RECOMMEND_MASH></Grain>')
  const download = Buffer.from('<Hops><F_H_NAME>Saaz U.S.</F_H_NAME><F_H_ORIGIN>United States</F_H_ORIGIN><F_H_FORM>0</F_H_FORM><F_H_TYPE>1</F_H_TYPE><F_H_ALPHA>3</F_H_ALPHA></Hops>')
  const manifest = join(root, 'migration-manifest.json')
  await writeFile(join(root, 'migration-identities.json'), JSON.stringify({ version: 1 }))
  await writeFile(join(root, 'local.bsmx'), local)
  await writeFile(manifest, JSON.stringify({ version: 1, registry: 'migration-identities.json', sources: [local, download].map((data, i) => ({ id: i ? 'missing-hops' : 'local', format: 'bsmx', priority: 10, required: !i, locations: [{ path: i ? 'missing.bsmx' : 'local.bsmx', sha256: createHash('sha256').update(data).digest('hex') }] })) }))
  Object.assign(process.env, { BREWEY_INGREDIENT_MANIFEST: manifest, BREWEY_INGREDIENT_CACHE: join(root, 'empty-cache'), BREWEY_INGREDIENT_OFFLINE: 'true' })
  async function runSetup() {
    startIngredientSetup(user.id)
    for (let attempt = 0; attempt < 200; attempt++) {
      const status = ingredientSetupStatus(user.id)
      if (status.state !== 'running') return status
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('Ingredient setup timed out')
  }
  try {
    assert.equal((await runSetup()).state, 'partial')
    assert.deepEqual(restored.calculations(recipe.id), before)
    await writeFile(join(root, 'missing.bsmx'), download)
    assert.equal((await runSetup()).state, 'ready')
    assert.equal(getDatabase().prepare('SELECT count(*) n FROM hops').get().n, 1)
    assert.equal(JSON.parse(getDatabase().prepare('SELECT data FROM hops WHERE id=?').get(canonical).data).alpha_acid_percent, 6)
    restart(); assert.deepEqual(applicationForUser(user.id).calculations(recipe.id), before)
    const backup = await createDatabaseBackup(user.id)
    let saved; try { saved = await readFile(backup.path) } finally { await backup.cleanup() }
    open('mapped-second-restore'); await restoreFirstRunBackup(saved); restart()
    assert.equal((await signIn('migration-owner', password)).user.id, user.id)
    assert.deepEqual(applicationForUser(user.id).calculations(recipe.id), before)
  } finally { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key] }
})
test('empty hosted libraries export no ingredient seed', async () => {
  const snapshot = source()
  for (const table of ['recipes', 'recipe_grains', 'recipe_hops', 'recipe_mash_steps', 'recipe_fermentation_steps']) snapshot.tables[table] = []
  snapshot.calculations = []
  const bytes = await createHostedBackup(snapshot, 'alice', { username: 'empty-owner', password })
  open('empty-export'); await restoreFirstRunBackup(bytes); restart()
  for (const table of ['grains', 'hops', 'yeasts', 'misc_ingredients']) assert.equal(getDatabase().prepare(`SELECT count(*) n FROM ${table}`).get().n, 0)
})
test('recognised schema 2/3 backups upgrade on a staged copy, preserve accounts, and do not change input', async () => {
  for (const version of [2, 3]) {
    const db = createSchemaReference(version), path = join(root, `v${version}.sqlite`)
    db.prepare('INSERT INTO users(id,username,password_hash,is_admin) VALUES(?,?,?,1)').run('historical', 'historical', oldHash)
    db.prepare("UPDATE installation_settings SET value='true' WHERE key='setup_complete'").run()
    const app = new BrewingApplication({ userId: 'historical', permissions: CAPABILITIES }, () => db)
    const recipe = app.createRecipe({ name: 'Historical recipe', brewing_notes: 'Saved notes' })
    if (version === 3) {
      db.prepare("INSERT INTO conversations(id,user_id,recipe_id,recipe_title,scope_key,title,status,created_at,updated_at,next_sequence) VALUES('old-chat','historical',?,?,?,'Old chat','active',?,?,1)").run(recipe.id, recipe.name, 'recipe:' + recipe.id, recipe.created_at, recipe.updated_at)
      db.prepare("INSERT INTO conversation_messages(id,conversation_id,sequence,type,content,timestamp) VALUES('old-message','old-chat',1,'user','Saved historical message',?)").run(recipe.created_at)
    }
    await backup(db, path); db.close()
    const bytes = await readFile(path)
    open('upgrade-' + version)
    assert.equal((await previewFirstRunBackup(bytes)).upgradedFrom, version)
    assert.deepEqual(await readFile(path), bytes)
    await restoreFirstRunBackup(bytes); restart()
    assert.equal((await signIn('historical', 'synthetic-source-password')).user.id, 'historical')
    assert.equal(applicationForUser('historical').getRecipe(recipe.id).brewing_notes, 'Saved notes')
    if (version === 3) {
      assert.equal(getDatabase().prepare('SELECT content FROM conversation_messages').get().content, 'Saved historical message')
      assert.equal(getDatabase().prepare('SELECT scope_key FROM conversations').get().scope_key, 'general')
      assert.equal(getDatabase().prepare('SELECT recipe_id FROM conversation_recipe_activities').get().recipe_id, recipe.id)
    }
  }
})
test('first-run restore respects disabled setup and owner creation winning while upload is staged', async () => {
  const bytes = await createHostedBackup(source(), 'alice', { username: 'local-owner', password })
  open('disabled')
  const previous = process.env.DISABLE_SIGNUP; process.env.DISABLE_SIGNUP = 'true'
  try { await assert.rejects(previewFirstRunBackup(bytes), error => error.status === 403); await assert.rejects(restoreFirstRunBackup(bytes), error => error.status === 403) }
  finally { if (previous === undefined) delete process.env.DISABLE_SIGNUP; else process.env.DISABLE_SIGNUP = previous }
  open('race')
  const restore = restoreFirstRunBackup(bytes)
  // The staged write yields. Model an owner setup committed before the maintenance barrier.
  const db = getDatabase()
  db.prepare('INSERT INTO users(id,username,password_hash,is_admin) VALUES(?,?,?,1)').run('winner', 'winner', oldHash)
  db.prepare("UPDATE installation_settings SET value='true' WHERE key='setup_complete'").run()
  await assert.rejects(restore, error => error.status === 403)
  assert.equal((await signIn('winner', 'synthetic-source-password')).user.id, 'winner')
  open('restore-wins')
  const results = await Promise.allSettled([register('late-owner', password), restoreFirstRunBackup(bytes)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const winner = results[0].status === 'fulfilled' ? 'late-owner' : 'local-owner'
  restart(); assert.equal((await signIn(winner, password)).user.username, winner)
})
