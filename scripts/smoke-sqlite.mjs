#!/usr/bin/env node
// Only disposable successor accounts. State contains test credentials; keep private.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const origin = process.env.BREWEY_SMOKE_ORIGIN || 'http://localhost:3100'
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Use a disposable loopback installation')
const statePath = resolve('.runtime/sqlite-smoke.json'), command = process.argv[2] || 'create'
const headers = { Origin: origin, 'Content-Type': 'application/json' }
async function request(path, account, options = {}) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(45000), ...options, headers: { ...headers, ...(account ? { Cookie: account.cookie } : {}), ...options.headers } })
  return response
}
async function json(path, account, options = {}, status = 200) {
  const response = await request(path, account, options)
  assert.equal(response.status, status, `Unexpected status for ${path}`)
  return response.json()
}
const post = body => ({ method: 'POST', body: JSON.stringify(body) })
async function login(account) {
  const response = await request('/api/auth/signin', null, post(account))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.id, account.id)
  account.cookie = response.headers.getSetCookie().find(value => value.startsWith('brewey-session=')).split(';')[0]
}
async function connect(account) {
  const client = new Client({ name: 'brewey-sqlite-smoke', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${account.token}` } } }))
  return client
}
async function tool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  assert(!result.isError, `Tool failed: ${name}`)
  return JSON.parse(result.content.find(item => item.type === 'text').text)
}
let state
if (command === 'create') {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 })
  state = { kind: 'brewey-sqlite-smoke-v1', origin, users: [], recipe: null }
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
  assert(process.env.BREWEY_SMOKE_ACCOUNTS_FILE, 'Supply a protected file containing two pre-provisioned disposable accounts; public signup is closed.')
  const provisioned = JSON.parse(await readFile(process.env.BREWEY_SMOKE_ACCOUNTS_FILE, 'utf8'))
  assert.equal(provisioned.users.length, 2)
  for (const account of provisioned.users) {
    assert(account.username.startsWith('sqlite-smoke-') && account.id && account.password)
    await login(account)
    account.token = (await json('/api/tokens/create', account, post({ name: 'Disposable SQLite MCP/API check', scopes: ['recipes:read', 'recipes:write', 'catalog:read', 'profile:read', 'profile:write'] }))).token
    state.users.push(account)
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
  }
  const [one, two] = state.users, client = await connect(one)
  try {
    assert.equal((await client.listTools()).tools.length, 37)
    const created = await tool(client, 'create_recipe', { name: 'SQLite disposable persistence check', batch_size_liters: 20, brewing_notes: 'SQLite smoke notes' })
    state.recipe = created.recipe.id
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
    const grain = (await tool(client, 'search_grains', { name: 'Pilsner', limit: 1 })).grains[0]
    const hop = (await tool(client, 'search_hops', { name: 'Cascade', limit: 1 })).hops[0]
    const yeast = (await tool(client, 'search_yeasts', { name: 'US-05', limit: 1 })).yeasts[0]
    await tool(client, 'add_grain_to_recipe', { recipe_id: state.recipe, grain_id: grain.id, amount_kg: 4 })
    await tool(client, 'add_hop_to_recipe', { recipe_id: state.recipe, hop_id: hop.id, amount_grams: 25, use_type: 'boil', time_minutes: 60 })
    await tool(client, 'add_yeast_to_recipe', { recipe_id: state.recipe, yeast_id: yeast.id, amount_units: 1 })
    await tool(client, 'add_mash_step_to_recipe', { recipe_id: state.recipe, name: 'Mash', temperature_c: 66, duration_minutes: 60 })
    await tool(client, 'add_fermentation_step_to_recipe', { recipe_id: state.recipe, name: 'Primary', temperature_c: 19, duration_days: 10 })
    const calculations = (await json(`/api/v1/recipes/${state.recipe}/calculations`, one)).data
    assert(calculations.calculated_og > 1 && calculations.calculated_fg > 1 && calculations.calculated_abv > 0 && calculations.calculated_ibu > 0)
    state.calculations = calculations
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
    assert.equal((await request(`/api/v1/recipes/${state.recipe}`, two)).status, 404)
    assert.equal((await request(`/api/v1/recipes/${state.recipe}`, two, { method: 'DELETE' })).status, 404)
    const other = await connect(two)
    try { assert.equal((await other.callTool({ name: 'get_recipe_by_id', arguments: { recipe_id: state.recipe } })).isError, true) } finally { await other.close() }
    const imported = (await json('/api/v1/recipes/import', one, post({ format: 'brewey-native', version: '1.0.0', recipe: { name: 'Disposable native import' }, grains: [{ grain_id: grain.id, amount_kg: 4 }], mash_steps: [{ name: 'Mash', temperature_c: 66, duration_minutes: 60, step_order: 1 }] }), 201)).data
    assert(imported.id && imported.name === 'Disposable native import')
    await json(`/api/v1/recipes/${imported.id}`, one, { method: 'DELETE' })
    const count = (await json('/api/v1/recipes', one)).data.length
    assert.equal((await request('/api/v1/recipes/import', one, post({ format: 'brewey-native', recipe: { name: 'Must roll back' }, grains: [{ grain_id: 'missing', grain_name: 'Nonexistent', amount_kg: 4 }] }))).status, 400)
    assert.equal((await json('/api/v1/recipes', one)).data.length, count)
    await json('/api/v1/profile', one, { method: 'PATCH', body: JSON.stringify({ unit_system: 'imperial', profile: 'Disposable test brewer' }) })
    assert((await client.listTools()).tools.find(t => t.name === 'add_grain_to_recipe').inputSchema.properties.amount_lb)
    const imperial = await tool(client, 'get_recipe_by_id', { recipe_id: state.recipe })
    assert(Math.abs(imperial.recipe.batch_size_gallons - 20 / 3.785411784) < 1e-9)
    await json('/api/auth/user', one, { method: 'PATCH', body: JSON.stringify({ data: { codexReasoningEffort: 'high', codexVerbosity: 'low' } }) })
    assert.equal((await json('/api/auth/session', one)).user.user_metadata.codexReasoningEffort, 'high')
    const conversation = (await json('/api/conversations/current', one)).data
    assert.equal((await request('/api/chat', one, post({ conversationId: conversation.id, requestId: randomUUID(), message: 'Disposable unconnected check' }))).status, 409)
    assert.equal((await json('/api/agent/account', one)).account, null)
    assert((await json('/api/agent/models', one)).models.some(model => model.isDefault))
    assert.equal((await request('/api/v1/recipes', null)).status, 401)
    assert.equal((await request('/api/v1/recipes', one, { ...post({ name: 'Cross-origin' }), headers: { Origin: 'https://untrusted.invalid' } })).status, 403)
    const scoped = (await json('/api/tokens/create', one, post({ name: 'Scoped', scopes: ['recipes:read'], rateLimitPerHour: 2 }))).token
    const readonlyList = await request('/api/mcp', null, { ...post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), headers: { Authorization: `Bearer ${scoped}` } })
    assert.equal(readonlyList.status, 200)
    assert(!(await readonlyList.json()).result.tools.some(tool => tool.name === 'create_recipe'))
    assert.equal((await request('/api/v1/recipes', null, { headers: { Authorization: `Bearer ${scoped}` } })).status, 200)
    assert.equal((await request('/api/v1/recipes', null, { headers: { Authorization: `Bearer ${scoped}` } })).status, 429)
    if (process.env.BREWEY_SMOKE_DEVICE_LOGIN === '1') {
      const started = await json('/api/agent/login', one, post({ method: 'deviceCode' }))
      assert(started.loginId && started.userCode && started.verificationUrl)
      await json('/api/agent/login', one, { method: 'DELETE', body: JSON.stringify({ loginId: started.loginId }) })
    }
  } finally { await client.close() }
  console.log('PASS: SQLite HTTP/auth, actual MCP SDK37tools, metric/imperial brewing, native import/rollback, profile/preferences, ownership, scopes/rate limits, Codex isolation/models and CSRF. Test state retained for restart verification.')
} else {
  state = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(state.kind, 'brewey-sqlite-smoke-v1'); assert.equal(state.origin, origin)
  for (const account of state.users) { assert(account.username.startsWith('sqlite-smoke-')); await login(account) }
  if (command === 'verify') {
    const [one, two] = state.users
    assert.equal((await json('/api/v1/recipes', one)).data.length, 1)
    assert.equal((await json(`/api/v1/recipes/${state.recipe}`, one)).data.recipe_grains.length, 1)
    assert.deepEqual((await json(`/api/v1/recipes/${state.recipe}/calculations`, one)).data, state.calculations)
    assert.equal((await json('/api/v1/profile', one)).data.unit_system, 'imperial')
    assert.equal((await json('/api/auth/session', one)).user.user_metadata.codexReasoningEffort, 'high')
    assert.equal((await request(`/api/v1/recipes/${state.recipe}`, two)).status, 404)
    const client = await connect(one)
    try { assert.equal((await client.listTools()).tools.length, 37) } finally { await client.close() }
    console.log('PASS: accounts, recipe/ingredients/calculations, units/preferences, PAT and isolation persist after restart.')
  } else {
    assert.equal(command, 'cleanup')
    for (const account of state.users) await json('/api/auth/user', account, { method: 'DELETE', body: JSON.stringify({ password: account.password }) })
    await unlink(statePath)
    console.log('PASS: removed only disposable SQLite smoke accounts and their owned data/Codex homes.')
  }
}
await chmod(statePath, 0o600).catch(() => {})
