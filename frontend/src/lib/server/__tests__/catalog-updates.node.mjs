import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { getDatabase, closeDatabase, CATALOG_TABLES, RELATION_TABLES } from '../database.ts'
import { getRepository } from '../repository.ts'
import { importDatabaseSnapshot } from '../migration.ts'
import styles from '../style-catalog.json' with { type: 'json' }
import corrections from '../reference-catalog-updates.json' with { type: 'json' }

// Synthetic brewing properties; only correction identities come from compatibility rules.
const defaults = {
    grains: {grain_type:'base',color_ebc:5,extract_potential:0.8,must_mash:true,origin:'Test'},
    hops: {hop_type:'aroma',form:'pellet',alpha_acid_percent:5,origin:'Test'},
    misc_ingredients: {ingredient_type:'other'},
}
const catalog = {grains:[],hops:[],yeasts:[],misc_ingredients:[],beer_styles:styles}
for (const c of corrections.updates) catalog[c.table].push({id:c.id,name:c.name,...defaults[c.table],notes:'Synthetic fixture.',created_at:'2020-01-01T00:00:00Z',updated_at:'2020-01-01T00:00:00Z',...Object.fromEntries(Object.entries(c.changes).map(([k,v])=>[k,v.to]))})


const folder = mkdtempSync(join(tmpdir(), 'brewey-catalog-'))
function sandbox(name, operation) {
    const previous = process.env.BREWEY_DATABASE_PATH
    closeDatabase(); process.env.BREWEY_DATABASE_PATH = join(folder, name + '.sqlite')
    const seeded = getDatabase()
    for (const table of CATALOG_TABLES) for (const row of catalog[table]) seeded.prepare(`INSERT OR IGNORE INTO ${table}(id,data) VALUES(?,?)`).run(row.id,JSON.stringify(row))
    try { operation() } finally {
        closeDatabase()
        if (previous === undefined) delete process.env.BREWEY_DATABASE_PATH
        else process.env.BREWEY_DATABASE_PATH = previous
    }
}
after(() => { closeDatabase(); rmSync(folder, { recursive: true, force: true }) })
function payload(db, table, id) { return JSON.parse(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id).data) }
function oldCatalog(db) {
    db.prepare('DELETE FROM installation_settings WHERE key=?').run('reference_catalog_revision')
    for (const correction of corrections.updates) {
        const row = payload(db, correction.table, correction.id)
        for (const [field, values] of Object.entries(correction.changes)) row[field] = values.from
        db.prepare(`UPDATE ${correction.table} SET data=? WHERE id=?`).run(JSON.stringify(row), correction.id)
    }
}
function personalRows(db) {
    return Object.fromEntries(['users', 'sessions', 'user_profiles', 'recipes', ...RELATION_TABLES].map(table =>
        [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'sessions' ? 'hash' : 'id'}`).all()]))
}

test('existing catalogue update preserves IDs, personal rows, recipe references and calculations across restart', () => sandbox('upgrade', () => {
    let db = getDatabase()
    db.prepare('INSERT INTO users(id,username,password_hash,user_metadata) VALUES(?,?,?,?)').run('brewer', 'brewer', 'synthetic-password-hash', '{"kept":true}')
    db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run('synthetic-session', 'brewer', 9999999999999)
    const repository = getRepository('brewer')
    repository.updateProfile({ profile: 'Synthetic brewer', preferences: { kept: true } })
    const oats = catalog.grains.find(row => row.name === 'Gladfield Rolled Oats (BLM)')
    const recipe = repository.createRecipe({ name: 'Catalogue upgrade fixture' })
    repository.addRelation('recipe_grains', recipe.id, { grain_id: oats.id, amount_kg: 0.5 })
    oldCatalog(db)
    const personal = personalRows(db), calculations = repository.getCalculations(recipe.id)
    const ids = Object.fromEntries(CATALOG_TABLES.map(table => [table, db.prepare(`SELECT id FROM ${table} ORDER BY id`).all()]))
    closeDatabase(); db = getDatabase()
    assert.deepEqual(personalRows(db), personal)
    assert.deepEqual(getRepository('brewer').getCalculations(recipe.id), calculations)
    for (const table of CATALOG_TABLES) assert.deepEqual(db.prepare(`SELECT id FROM ${table} ORDER BY id`).all(), ids[table])
    for (const correction of corrections.updates)
        for (const [field, values] of Object.entries(correction.changes)) assert.equal(payload(db, correction.table, correction.id)[field], values.to)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    const updated = db.prepare('SELECT data FROM grains ORDER BY id').all()
    closeDatabase(); assert.deepEqual(getDatabase().prepare('SELECT data FROM grains ORDER BY id').all(), updated)
}))

test('corrections guard previous field values, names and IDs and preserve unrelated custom fields', () => sandbox('guards', () => {
    const db = getDatabase(); oldCatalog(db)
    const oats = corrections.updates.find(row => row.name === 'Gladfield Rolled Oats (BLM)')
    const custom = payload(db, oats.table, oats.id)
    Object.assign(custom, { grain_type: 'specialty', notes: 'Preserve customized notes', extract_potential: 0.731 })
    db.prepare('UPDATE grains SET data=? WHERE id=?').run(JSON.stringify(custom), oats.id)
    const renamed = corrections.updates.find(row => row.name === 'Gladfield Rolled Wheat (BLM)')
    const renamedRow = payload(db, renamed.table, renamed.id); renamedRow.name = 'Independent reference entry'
    db.prepare('UPDATE grains SET data=? WHERE id=?').run(JSON.stringify(renamedRow), renamed.id)
    const foreignId = 'independent-catalog-id'
    db.prepare('INSERT INTO grains(id,data) VALUES(?,?)').run(foreignId, JSON.stringify({ ...custom, id: foreignId, grain_type: 'base' }))
    closeDatabase(); const updated = getDatabase()
    assert.deepEqual(payload(updated, oats.table, oats.id), custom)
    assert.deepEqual(payload(updated, renamed.table, renamed.id), renamedRow)
    assert.equal(payload(updated, 'grains', foreignId).grain_type, 'base')
}))

test('failed startup correction rolls back all catalogue rows and revision before a safe retry', () => sandbox('rollback', () => {
    let db = getDatabase(); oldCatalog(db)
    const before = Object.fromEntries(CATALOG_TABLES.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
    db.exec("CREATE TRIGGER reject_grain_update BEFORE UPDATE ON grains BEGIN SELECT RAISE(ABORT,'synthetic update failure'); END;")
    closeDatabase()
    assert.throws(() => getDatabase(), /synthetic update failure/)
    db = new DatabaseSync(process.env.BREWEY_DATABASE_PATH)
    for (const table of CATALOG_TABLES) assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(), before[table])
    assert.equal(db.prepare('SELECT value FROM installation_settings WHERE key=?').get('reference_catalog_revision'), undefined)
    db.exec('DROP TRIGGER reject_grain_update'); db.close()
    assert.equal(getDatabase().prepare('SELECT value FROM installation_settings WHERE key=?').get('reference_catalog_revision').value, '1')
}))

test('PostgreSQL reference IDs resolve by exact unique name while ambiguous entries stay untouched', () => sandbox('postgres-ids', () => {
    let db = getDatabase(); oldCatalog(db)
    const importedIds = new Map()
    for (const correction of corrections.updates) {
        const row = payload(db, correction.table, correction.id), id = randomUUID()
        row.id = id; importedIds.set(correction.name, id)
        db.prepare(`DELETE FROM ${correction.table} WHERE id=?`).run(correction.id)
        db.prepare(`INSERT INTO ${correction.table}(id,data) VALUES(?,?)`).run(id, JSON.stringify(row))
    }
    const ambiguous = corrections.updates.find(row => row.name === 'Gladfield Rolled Wheat (BLM)')
    const duplicate = payload(db, ambiguous.table, importedIds.get(ambiguous.name)); duplicate.id = randomUUID()
    db.prepare('INSERT INTO grains(id,data) VALUES(?,?)').run(duplicate.id, JSON.stringify(duplicate))
    db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run('brewer', 'brewer', 'synthetic-hash')
    const repository = getRepository('brewer'), recipe = repository.createRecipe({ name: 'Preserved PostgreSQL IDs' })
    const oats = importedIds.get('Gladfield Rolled Oats (BLM)')
    repository.addRelation('recipe_grains', recipe.id, { grain_id: oats, amount_kg: 0.5 })
    const before = personalRows(db), calculations = repository.getCalculations(recipe.id)
    closeDatabase(); db = getDatabase()
    for (const correction of corrections.updates) {
        const row = payload(db, correction.table, importedIds.get(correction.name))
        assert.equal(row.id, importedIds.get(correction.name))
        for (const [field, values] of Object.entries(correction.changes)) assert.equal(row[field], correction.name === ambiguous.name ? values.from : values.to)
    }
    assert.equal(payload(db, 'grains', duplicate.id).grain_type, 'base')
    assert.deepEqual(personalRows(db), before)
    assert.deepEqual(getRepository('brewer').getCalculations(recipe.id), calculations)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
}))

test('explicit snapshot import reconciles its catalogue even when initialization already recorded the revision', () => sandbox('import', () => {
    const db = getDatabase(), snapshot = structuredClone(catalog)
    assert.equal(db.prepare('SELECT value FROM installation_settings WHERE key=?').get('reference_catalog_revision').value, '1')
    const rows = new Map()
    for (const correction of corrections.updates) {
        const row = snapshot[correction.table].find(row => row.id === correction.id)
        row.id = randomUUID(); rows.set(correction.name, row)
        for (const [field, values] of Object.entries(correction.changes)) row[field] = values.from
    }
    importDatabaseSnapshot(snapshot)
    for (const correction of corrections.updates) {
        const row = payload(db, correction.table, rows.get(correction.name).id)
        for (const [field, values] of Object.entries(correction.changes)) assert.equal(row[field], values.to)
    }
    closeDatabase(); assert.equal(getDatabase().prepare('PRAGMA foreign_key_check').all().length, 0)
}))
