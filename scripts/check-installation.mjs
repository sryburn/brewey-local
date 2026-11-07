#!/usr/bin/env node
// Exercises a built production server with disposable data and no agent connection.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createHostedExportDatabase, CATALOG_TABLES, RELATION_TABLES } from '../frontend/src/lib/server/database.ts'
import { createHostedBackup } from '../frontend/src/lib/server/hosted-backup.ts'
import { BrewingApplication } from '../frontend/src/lib/server/application-service.ts'
import { CAPABILITIES } from '../frontend/src/types/access.ts'
import styleMetadata from '../frontend/src/lib/server/style-catalog.json' with { type: 'json' }
import { seedIngredients } from '../frontend/src/lib/server/__tests__/fixtures/ingredients.ts'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'brewey-installation-check-'))
const sample = name => Buffer.from(`<Grain><F_G_NAME>${name}</F_G_NAME><F_G_TYPE>0</F_G_TYPE><F_G_COLOR>2</F_G_COLOR><F_G_YIELD>80</F_G_YIELD><F_G_RECOMMEND_MASH>1</F_G_RECOMMEND_MASH></Grain>`)
const first = sample('Installation Test Malt'), second = sample('Retry Test Malt')
await writeFile(join(root, 'first.bsmx'), first)
await writeFile(join(root, 'identities.json'), JSON.stringify({version:1}))
const style = styleMetadata[0]
const styleBytes = Buffer.from(JSON.stringify({styleguide:{version:'2021',category:[{subcategory:[{id:style.number,name:style.name,impression:'Synthetic downloaded style.'}]}]}}))
await writeFile(join(root, 'styles-config.json'), JSON.stringify({locations:[{path:'styles-source.json',sha256:createHash('sha256').update(styleBytes).digest('hex')}],targets:[{number:style.number,name:style.name}]}))
await writeFile(join(root, 'manifest.json'), JSON.stringify({version:1,registry:'identities.json',styles:'styles-config.json',sources:[first,second].map((bytes,index)=>({id:index?'second':'first',format:'bsmx',priority:10,required:!index,locations:[{path:(index?'second':'first')+'.bsmx',sha256:createHash('sha256').update(bytes).digest('hex')}]}))}))
const socket = createServer()
socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const credentials = { username: 'synthetic-owner', password: 'synthetic-installation-password' }
let child, exited, cookie = ''
async function start(name) {
  const data = join(root, name)
  await mkdir(data, { recursive: true, mode: 0o700 })
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: frontend, stdio: 'ignore', env: {
      PATH: process.env.PATH, HOME: root, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      APP_ORIGIN: origin, BREWEY_INGREDIENT_MANIFEST: join(root,'manifest.json'), BREWEY_INGREDIENT_OFFLINE: 'true', BREWEY_DATA_DIR: data, BREWEY_DATABASE_PATH: join(data, 'brewey.sqlite'),
    },
  })
  exited = once(child, 'exit')
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(child.exitCode, null, 'Production server exited before becoming healthy')
    if (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false)) return
    await delay(200)
  }
  throw new Error('Production server did not become healthy')
}
async function stop() {
  if (child && child.exitCode === null) child.kill('SIGTERM')
  if (exited) await exited
  child = undefined; exited = undefined
}
async function call(path, { method = 'GET', body, status = 200, authenticated = true, requestOrigin = origin } = {}) {
  const response = await fetch(origin + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Origin: requestOrigin, ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  })
  assert.equal(response.status, status, `${method} ${path} returned an unexpected status`)
  return response
}
function upload(bytes) {
  const form = new FormData()
  form.set('file', new File([bytes], 'synthetic.sqlite', { type: 'application/vnd.sqlite3' }))
  return form
}
async function login(path = '/api/auth/signin') {
  const response = await call(path, { method: 'POST', body: credentials, authenticated: false })
  cookie = response.headers.getSetCookie().find(value => value.startsWith('brewey-session=')).split(';')[0]
  assert.equal((await response.json()).user.is_admin, true)
}
async function waitForIngredients() {
  for(let attempt=0;attempt<100;attempt++) { const state=await (await call('/api/admin/ingredients')).json();if(state.state!=='running')return state;await delay(100) }
  throw new Error('Ingredient setup did not finish')
}
async function hostedFixture() {
  const db = createHostedExportDatabase()
  try {
    seedIngredients(db)
    db.prepare('INSERT INTO users(id,username,password_hash,is_admin) VALUES(?,?,?,1)').run('cloud-owner', 'cloud-owner', 'synthetic-unused-hash')
    const app = new BrewingApplication({ userId: 'cloud-owner', permissions: [...CAPABILITIES] }, () => db)
    const recipe = app.createRecipe({ name: 'Hosted migration rehearsal', brewing_notes: 'Synthetic brewing notes', tasting_notes: 'Synthetic tasting notes' })
    const hop = app.searchCatalog('hop').items[0]
    db.prepare('UPDATE hops SET data=? WHERE id=?').run(JSON.stringify({ ...hop, name: 'Saaz', origin: 'United States', alpha_acid_percent: 6 }), hop.id)
    app.addRelation('grain', recipe.id, { grain_id: app.searchCatalog('grain').items[0].id, amount_kg: 4 })
    app.addRelation('hop', recipe.id, { hop_id: hop.id, amount_grams: 20, use_type: 'boil', time_minutes: 60 })
    app.addRelation('yeast', recipe.id, { yeast_id: app.searchCatalog('yeast').items[0].id, amount_units: 1, unit_type: 'packets' })
    app.addRelation('misc', recipe.id, { misc_id: app.searchCatalog('misc').items[0].id, amount_units: 2, unit_type: 'grams', use_type: 'mash' })
    app.addRelation('water', recipe.id, { name: 'Synthetic water', volume_liters: 25, ca_ppm: 50 })
    app.addRelation('mash', recipe.id, { step_order: 1, name: 'Mash', temperature_c: 65, duration_minutes: 60 })
    app.addRelation('fermentation', recipe.id, { step_order: 1, name: 'Primary', temperature_c: 18, duration_days: 7 })
    app.updateProfile({ profile: 'Synthetic brewer', unit_system: 'imperial' })
    const tables = Object.fromEntries([...CATALOG_TABLES, ...RELATION_TABLES, 'recipes', 'user_profiles'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all().map(row => {
      if (RELATION_TABLES.includes(table)) return { ...JSON.parse(row.data), id: row.id, recipe_id: row.recipe_id, created_at: row.created_at }
      return row.data ? JSON.parse(row.data) : row
    })]))
    const calculations = app.calculations(recipe.id)
    const bytes = await createHostedBackup({ format: 'brewey-hosted-v1', user_id: 'cloud-owner', tables, calculations: [calculations] }, 'cloud-owner', credentials)
    return { bytes, calculations }
  } finally { db.close() }
}
try {
  await start('source')
  assert.equal((await (await call('/api/auth/setup')).json()).needsSetup, true)
  await call('/api/auth/signup', { method: 'POST', body: credentials, requestOrigin: 'https://untrusted.invalid', status: 403 })
  await login('/api/auth/signup')
  await call('/api/auth/signup', { method: 'POST', body: credentials, status: 403 })
  await call('/api/admin/backup', { authenticated: false, status: 401 })
  await call('/api/admin/ingredients', { authenticated: false, status: 401 })
  await call('/api/admin/ingredients', { method: 'POST', requestOrigin: 'https://untrusted.invalid', status: 403 })
  assert.equal((await (await call('/api/admin/ingredients')).json()).counts.grains,0)
  await call('/api/admin/ingredients', { method: 'POST', status: 202 })
  const partial=await waitForIngredients();assert.equal(partial.state,'partial');assert.deepEqual(partial.missing,['second','bjcp-2021-styles']);assert.equal(partial.counts.grains,1)
  await writeFile(join(root,'second.bsmx'),second)
  await writeFile(join(root,'styles-source.json'),styleBytes)
  await call('/api/admin/ingredients', { method: 'POST', status: 202 })
  const ready=await waitForIngredients();assert.equal(ready.state,'ready');assert.equal(ready.counts.grains,2)
  const downloadedStyle = (await (await call('/api/v1/catalog/style/' + style.id)).json()).data
  assert.equal(downloadedStyle.overall_impression, 'Synthetic downloaded style.')
  assert.equal(downloadedStyle.og_min, style.og_min)
  const recipe = (await (await call('/api/v1/recipes', { method: 'POST', body: { name: 'Synthetic installation recipe', batch_size_liters: 20 }, status: 201 })).json()).data
  const malt=(await (await call('/api/v1/catalog/grain?limit=1')).json()).data[0]
  await call(`/api/v1/recipes/${recipe.id}/ingredients/grain`,{method:'POST',body:{grain_id:malt.id,amount_kg:4},status:201})
  const bytes = await (await call('/api/admin/backup')).arrayBuffer()
  assert.equal(new TextDecoder().decode(bytes.slice(0, 16)), 'SQLite format 3\u0000')
  await stop(); await start('source')
  await login()
  assert.equal((await (await call('/api/v1/recipes/' + recipe.id)).json()).data.name, recipe.name)
  await stop(); cookie = ''; await start('restored')
  const preview = await (await call('/api/auth/setup/restore?mode=preview', { method: 'POST', body: upload(bytes) })).json()
  assert.equal(preview.accounts, 1); assert.equal(preview.recipes, 1)
  assert.equal((await (await call('/api/auth/setup')).json()).needsSetup, true)
  const result = await (await call('/api/auth/setup/restore?mode=restore', { method: 'POST', body: upload(bytes) })).json()
  assert.equal(result.restartRequired, true)
  await Promise.race([exited, delay(10000).then(() => { throw new Error('Restore did not exit for supervisor restart') })])
  await stop(); await start('restored'); await login()
  assert.equal((await (await call('/api/v1/recipes/' + recipe.id)).json()).data.name, recipe.name)
  await call('/api/auth/setup/restore?mode=preview', { method: 'POST', body: upload(bytes), status: 403 })
  const hosted = await hostedFixture()
  await stop(); cookie = ''; await start('hosted-restored')
  const hostedPreview = await (await call('/api/auth/setup/restore?mode=preview', { method: 'POST', body: upload(hosted.bytes) })).json()
  assert.equal(hostedPreview.recipes, 1); assert.equal(hostedPreview.accounts, 1)
  await call('/api/auth/setup/restore?mode=restore', { method: 'POST', body: upload(hosted.bytes) })
  await Promise.race([exited, delay(10000).then(() => { throw new Error('Hosted restore did not exit') })])
  await stop(); await start('hosted-restored'); await login()
  const migrated = (await (await call('/api/v1/recipes')).json()).data[0]
  const details = (await (await call('/api/v1/recipes/' + migrated.id)).json()).data
  assert.equal(details.name, 'Hosted migration rehearsal')
  assert.equal(details.brewing_notes, 'Synthetic brewing notes')
  for (const table of RELATION_TABLES) assert.equal(details[table].length, 1)
  assert.equal(details.recipe_hops[0].hop_id, '788bb695-5a95-5ba4-997e-5cd84813520a')
  const beforeSetup = (await (await call('/api/v1/recipes/' + migrated.id + '/calculations')).json()).data
  for (const key of ['calculated_og', 'calculated_fg', 'calculated_abv', 'calculated_ibu', 'calculated_ebc']) assert.equal(beforeSetup[key], hosted.calculations[key])
  await call('/api/admin/ingredients', { method: 'POST', status: 202 })
  assert.equal((await waitForIngredients()).state, 'ready')
  assert.deepEqual((await (await call('/api/v1/recipes/' + migrated.id + '/calculations')).json()).data, beforeSetup)
  console.log('PASS: production first-owner setup, manifest download, partial catalogue, retry, ingredient recipe reference, origin checks, backup access, restart persistence, first-run preview/restore, process exit, restored login and recipe identity.')
  console.log('PASS: hosted export → HTTP first-run restore → restart → sign-in → all seven recipe relation types, stable ingredient mapping, calculations and catalogue setup.')
} finally { await stop(); await rm(root, { recursive: true, force: true }) }
