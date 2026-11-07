/** @jest-environment node */
import { seedIngredients } from '@/lib/server/__tests__/fixtures/ingredients'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDatabase, closeDatabase } from '@/lib/server/database'
import { createToken, listTokens, revokeToken, updateToken } from '@/lib/server/tokens'
import { CAPABILITIES } from '@/types/access'
import { GET as listRecipes, POST as createRecipe } from './recipes/route'
import { GET as getRecipe, PATCH as updateRecipe, DELETE as deleteRecipe } from './recipes/[id]/route'
import { POST as cloneRecipe } from './recipes/[id]/clone/route'
import { GET as exportRecipe } from './recipes/[id]/export/route'
import { POST as importRecipe } from './recipes/import/route'
import { GET as calculations } from './recipes/[id]/calculations/route'
import { GET as findStyles } from './recipes/[id]/styles/route'
import { GET as searchCatalog } from './catalog/[kind]/route'
import { GET as getCatalog } from './catalog/[kind]/[id]/route'
import { POST as addIngredient, GET as listIngredients } from './recipes/[id]/ingredients/[kind]/route'
import { GET as getIngredient, PATCH as editIngredient, DELETE as removeIngredient } from './recipes/[id]/ingredients/[kind]/[itemId]/route'
import { POST as addStep, GET as listSteps } from './recipes/[id]/steps/[kind]/route'
import { PATCH as editStep, DELETE as removeStep } from './recipes/[id]/steps/[kind]/[itemId]/route'
import { GET as getProfile, PATCH as editProfile } from './profile/route'
import { POST as mcp } from '../mcp/route'

jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
const directory = mkdtempSync(join(tmpdir(), 'brewey-http-v1-'))
const previousDatabase = process.env.BREWEY_DATABASE_PATH
const previousOrigin = process.env.APP_ORIGIN
let alice: string, reader: string, bob: string
function request(path: string, token?: string, method = 'GET', data?: unknown) {
  return new Request('https://brewey.test/api/v1' + path, {
    method, headers: { Origin: 'https://brewey.test', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  })
}
const context = (values: Record<string, string>) => ({ params: Promise.resolve(values) })
async function data(response: Response) { expect(response.status).toBeLessThan(300); return (await response.json()).data }
beforeAll(() => {
  closeDatabase()
  process.env.BREWEY_DATABASE_PATH = join(directory, 'http.sqlite')
  process.env.APP_ORIGIN = 'https://brewey.test'
  seedIngredients(getDatabase())
  const insert = getDatabase().prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)')
  insert.run('alice', 'alice', 'fixture')
  insert.run('bob', 'bob', 'fixture')
  alice = createToken('alice', { name: 'HTTP test owner', scopes: [...CAPABILITIES] }).token
  reader = createToken('alice', { name: 'HTTP test reader', scopes: ['recipes:read'] }).token
  bob = createToken('bob', { name: 'HTTP test other owner', scopes: [...CAPABILITIES] }).token
})
afterAll(() => {
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
  if (previousDatabase === undefined) delete process.env.BREWEY_DATABASE_PATH; else process.env.BREWEY_DATABASE_PATH = previousDatabase
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin
})

test('actual PAT boundary denies anonymous, read-only mutations, wrong domain access and other owners', async () => {
  expect((await listRecipes(request('/recipes'))).status).toBe(401)
  const created = await createRecipe(request('/recipes', alice, 'POST', { name: 'Private boundary' }))
  expect(created.status).toBe(201)
  const recipe = await data(created)
  expect((await getRecipe(request('/recipes/' + recipe.id, reader), context({ id: recipe.id }))).status).toBe(200)
  const denied = await updateRecipe(request('/recipes/' + recipe.id, reader, 'PATCH', { name: 'Denied' }), context({ id: recipe.id }))
  expect(denied.status).toBe(403)
  expect(denied.headers.get('X-RateLimit-Remaining')).not.toBeNull()
  expect((await getRecipe(request('/recipes/' + recipe.id, bob), context({ id: recipe.id }))).status).toBe(404)
  expect((await deleteRecipe(request('/recipes/' + recipe.id, bob, 'DELETE'), context({ id: recipe.id }))).status).toBe(404)
  expect((await getProfile(request('/profile', reader))).status).toBe(403)
  expect((await searchCatalog(request('/catalog/grain', reader), context({ kind: 'grain' }))).status).toBe(403)
  expect((await findStyles(request('/styles', reader), context({ id: recipe.id }))).status).toBe(403)
  const writeOnly = createToken('alice', { name: 'Write implies read', scopes: ['recipes:write'] }).token
  expect((await getRecipe(request('/recipes/' + recipe.id, writeOnly), context({ id: recipe.id }))).status).toBe(200)
  await deleteRecipe(request('/recipes/' + recipe.id, alice, 'DELETE'), context({ id: recipe.id }))
})

test('lists page/filter/order strictly and preserve owner-controlled IDs and metric fields', async () => {
  const ids: string[] = []
  for (const name of ['Page Z', 'Page A', 'Unmatched']) ids.push((await data(await createRecipe(request('/recipes', alice, 'POST', { name, batch_size_liters: 20 })))).id)
  const response = await listRecipes(request('/recipes?q=Page&sort=name&limit=1&offset=1', alice))
  const result = await response.json()
  expect(result.meta).toEqual({ total: 2, limit: 1, offset: 1 })
  expect(result.data[0].name).toBe('Page Z')
  expect(response.headers.get('X-RateLimit-Limit')).toBe('1000')
  expect(result.data[0].batch_size_liters).toBe(20)
  for (const path of ['/recipes?limit=501', '/recipes?sort=unknown', '/recipes?limit=1&limit=2', '/recipes?min_abv=5&max_abv=1', '/recipes?name=ok&user_id=bob']) expect((await listRecipes(request(path, alice))).status).toBe(400)
  expect((await createRecipe(request('/recipes', alice, 'POST', { name: 'Impersonated', user_id: 'bob' }))).status).toBe(400)
  expect((await createRecipe(request('/recipes', alice, 'POST', { name: 'Imperial misuse', batch_size_gallons: 5 }))).status).toBe(400)
  for (const id of ids) await deleteRecipe(request('/recipes/' + id, alice, 'DELETE'), context({ id }))
})

test('catalogue paging and relation CRUD share calculations, timing, recipe ownership and process ordering', async () => {
  const catalogResponse = await searchCatalog(request('/catalog/grain?q=pilsner&limit=1', alice), context({ kind: 'grain' }))
  const catalogue = await catalogResponse.json()
  expect(catalogue.meta.limit).toBe(1)
  expect(catalogue.meta.total).toBeGreaterThan(0)
  const grain = catalogue.data[0]
  expect((await data(await getCatalog(request('/catalog/grain/' + grain.id, alice), context({ kind: 'grain', id: grain.id })))).id).toBe(grain.id)
  expect((await searchCatalog(request('/catalog/grain?min_alpha_acid_percent=1', alice), context({ kind: 'grain' }))).status).toBe(400)
  expect((await searchCatalog(request('/catalog/unknown', alice), context({ kind: 'unknown' }))).status).toBe(404)
  const recipe = await data(await createRecipe(request('/recipes', alice, 'POST', { name: 'All operations' })))
  const second = await data(await createRecipe(request('/recipes', alice, 'POST', { name: 'Wrong path' })))
  const params = { id: recipe.id, kind: 'grain' }
  const added = await data(await addIngredient(request('/ingredients/grain', alice, 'POST', { grain_id: grain.id, amount_kg: 4 }), context(params)))
  expect((await data(await calculations(request('/calculations', alice), context({ id: recipe.id })))).calculated_og).toBeGreaterThan(1)
  const styles = await data(await findStyles(request('/styles?keywords=pilsner,lager&limit=2', alice), context({ id: recipe.id })))
  expect(styles.matching_styles.length).toBeLessThanOrEqual(2)
  expect(styles.recipe.id).toBe(recipe.id)
  expect((await findStyles(request('/styles?limit=501', alice), context({ id: recipe.id }))).status).toBe(400)
  expect((await listIngredients(request('/ingredients/grain', alice), context(params))).status).toBe(200)
  expect((await getIngredient(request('/ingredient', alice), context({ id: second.id, kind: 'grain', itemId: added.id }))).status).toBe(404)
  expect((await editIngredient(request('/ingredient', bob, 'PATCH', { amount_kg: 9 }), context({ ...params, itemId: added.id }))).status).toBe(404)
  expect((await data(await editIngredient(request('/ingredient', alice, 'PATCH', { amount_kg: 5 }), context({ ...params, itemId: added.id })))).amount_kg).toBe(5)
  const hops = await data(await searchCatalog(request('/catalog/hop?limit=1', alice), context({ kind: 'hop' })))
  expect((await addIngredient(request('/ingredients/hop', alice, 'POST', { hop_id: hops[0].id, amount_grams: 25, use_type: 'boil', time_minutes: 61 }), context({ id: recipe.id, kind: 'hop' }))).status).toBe(400)
  const first = await data(await addStep(request('/steps/mash', alice, 'POST', { name: 'First', temperature_c: 65, duration_minutes: 30 }), context({ id: recipe.id, kind: 'mash' })))
  const next = await data(await addStep(request('/steps/mash', alice, 'POST', { name: 'Next', temperature_c: 67, duration_minutes: 30 }), context({ id: recipe.id, kind: 'mash' })))
  await editStep(request('/step', alice, 'PATCH', { step_order: 1 }), context({ id: recipe.id, kind: 'mash', itemId: next.id }))
  expect((await data(await listSteps(request('/steps/mash', alice), context({ id: recipe.id, kind: 'mash' })))).map((step: { name: string }) => step.name)).toEqual(['Next', 'First'])
  await removeStep(request('/step', alice, 'DELETE'), context({ id: recipe.id, kind: 'mash', itemId: next.id }))
  expect((await data(await listSteps(request('/steps/mash', alice), context({ id: recipe.id, kind: 'mash' }))))[0].step_order).toBe(1)
  expect(first.id).toBeDefined()
  await removeIngredient(request('/ingredient', alice, 'DELETE'), context({ ...params, itemId: added.id }))
  for (const id of [recipe.id, second.id]) await deleteRecipe(request('/recipes/' + id, alice, 'DELETE'), context({ id }))
})

test('native export/import/clone and profile preserve metric storage with isolated new IDs', async () => {
  const styles = await data(await searchCatalog(request('/catalog/style?limit=1', alice), context({ kind: 'style' })))
  const recipe = await data(await createRecipe(request('/recipes', alice, 'POST', { name: 'Portable', brewing_notes: 'Metric export', batch_size_liters: 23, bjcp_style_id: styles[0].id })))
  const exported = await exportRecipe(request('/export', alice), context({ id: recipe.id }))
  expect(exported.headers.get('Content-Disposition')).toBe('attachment; filename="recipe.brewey"')
  const native = await exported.json()
  expect(native.format).toBe('brewey-native')
  expect(native.recipe.bjcp_style_number).toBe(styles[0].number)
  expect(native.data).toBeUndefined()
  const imported = await data(await importRecipe(request('/import', alice, 'POST', native)))
  expect(imported.id).not.toBe(recipe.id)
  expect(imported.batch_size_liters).toBe(23)
  const clone = await data(await cloneRecipe(request('/clone', alice, 'POST', { name: 'Cloned' }), context({ id: recipe.id })))
  expect(clone.id).not.toBe(recipe.id)
  expect((await cloneRecipe(request('/clone', alice, 'POST', { name: 'Bad', user_id: 'bob' }), context({ id: recipe.id }))).status).toBe(400)
  const profile = await data(await editProfile(request('/profile', alice, 'PATCH', { profile: 'Fixture', unit_system: 'imperial', preferences: { example: true } })))
  expect(profile.unit_system).toBe('imperial')
  expect((await data(await getProfile(request('/profile', bob)))).profile).not.toBe('Fixture')
  expect((await data(await getRecipe(request('/recipe', alice), context({ id: recipe.id })))).batch_size_liters).toBe(23)
  for (const id of [recipe.id, imported.id, clone.id]) await deleteRecipe(request('/recipes/' + id, alice, 'DELETE'), context({ id }))
})

test('body errors and PAT expiry/revocation/rate exhaustion have deterministic status and headers', async () => {
  for (const [payload, status] of [['{', 400], ['[]', 400], [JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }), 413]] as const) {
    expect((await createRecipe(new Request('https://brewey.test/api/v1/recipes', { method: 'POST', headers: { Authorization: 'Bearer ' + alice, 'Content-Type': 'application/json' }, body: payload }))).status).toBe(status)
  }
  expect((await createRecipe(new Request('https://brewey.test/api/v1/recipes', { method: 'POST', headers: { Authorization: 'Bearer ' + alice }, body: '{}' }))).status).toBe(415)
  const limited = createToken('alice', { name: 'One request', scopes: ['recipes:read'], rate_limit_per_hour: 1 }).token
  expect((await listRecipes(request('/recipes', limited))).status).toBe(200)
  const exhausted = await listRecipes(request('/recipes', limited))
  expect(exhausted.status).toBe(429)
  expect(exhausted.headers.get('X-RateLimit-Remaining')).toBe('0')
  expect(Number(exhausted.headers.get('Retry-After'))).toBeGreaterThan(0)
  const revoked = createToken('alice', { name: 'Revoked', scopes: ['recipes:read'] }).token
  const row = listTokens('alice').find(token => 'name' in token && token.name === 'Revoked')! as Record<string, unknown>
  revokeToken('alice', String(row.id))
  expect((await listRecipes(request('/recipes', revoked))).status).toBe(401)
  const expired = createToken('alice', { name: 'Expired', scopes: ['recipes:read'] }).token
  const expiredRow = listTokens('alice').find(token => 'name' in token && token.name === 'Expired')! as Record<string, unknown>
  updateToken('alice', String(expiredRow.id), { expires_at: new Date(Date.now() + 10000).toISOString() })
  getDatabase().prepare('UPDATE api_tokens SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', String(expiredRow.id))
  expect((await listRecipes(request('/recipes', expired))).status).toBe(401)
})

test('MCP protocol errors keep the same quota window and headers as HTTP', async () => {
  const token = createToken('alice', { name: 'Shared protocol quota', scopes: ['recipes:read'], rate_limit_per_hour: 3 }).token
  const rpc = (body: string) => new Request('https://brewey.test/api/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body })
  const malformed = await mcp(rpc('{'))
  expect(malformed.status).toBe(400)
  expect(malformed.headers.get('X-RateLimit-Remaining')).toBe('2')
  const unknown = await mcp(rpc(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown' })))
  expect((await unknown.json()).error.code).toBe(-32601)
  expect(unknown.headers.get('X-RateLimit-Remaining')).toBe('1')
  const last = await listRecipes(request('/recipes', token))
  expect(last.status).toBe(200)
  expect(last.headers.get('X-RateLimit-Remaining')).toBe('0')
  expect((await mcp(rpc(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })))).status).toBe(429)
})
