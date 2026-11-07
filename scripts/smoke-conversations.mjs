#!/usr/bin/env node
// Explicitly provisioned disposable successor accounts only. No inference or owner auth.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
const origin = process.env.BREWEY_SMOKE_ORIGIN || 'http://localhost:3100'
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Use a disposable loopback installation.')
const command = process.argv[2] || 'create'
const statePath = resolve(process.env.BREWEY_CHAT_SMOKE_STATE || '.runtime/chat-smoke.json')
async function call(path, account, { method = 'GET', body, status = 200, headers = {} } = {}) {
  const response = await fetch(new URL(path, origin), { method, signal: AbortSignal.timeout(45000), headers: {
    Origin: origin, ...(account ? { Cookie: account.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  assert.equal(response.status, status, `${method} ${path} unexpected status`)
  return { response, value: await response.json() }
}
async function login(account) {
  assert(account.username.startsWith('chat-smoke-'), 'Use disposable chat smoke users only.')
  const { response, value } = await call('/api/auth/signin', null, { method: 'POST', body: { username: account.username, password: account.password } })
  assert.equal(value.user.id, account.id)
  account.cookie = response.headers.getSetCookie().find(row => row.startsWith('brewey-session=')).split(';')[0]
}
let state
if (command === 'create') {
  assert(process.env.BREWEY_SMOKE_ACCOUNTS_FILE, 'Supply a protected disposable-account file.')
  const { users } = JSON.parse(await readFile(process.env.BREWEY_SMOKE_ACCOUNTS_FILE, 'utf8'))
  assert.equal(users.length, 2)
  state = { kind: 'brewey-chat-smoke-v1', origin, users }
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 })
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
  for (const user of users) await login(user)
  const [one, two] = users
  await call('/api/conversations', null, { status: 401 })
  const general = (await call('/api/conversations/current', one)).value.data
  assert.deepEqual(general.recipes, [])
  const recipe = (await call('/api/v1/recipes', one, { method: 'POST', body: { name: 'Chat smoke recipe', batch_size_liters: 20 }, status: 201 })).value.data
  assert.equal((await call('/api/conversations/current', one)).value.data.id, general.id)
  await call('/api/conversations/current?recipeId=general', one, { status: 400 })
  await call('/api/conversations', one, { method: 'POST', body: { recipeId: recipe.id }, status: 400 })
  await call('/api/conversations/' + general.id, two, { status: 404 })
  await call('/api/conversations', one, { method: 'POST', body: { userId: two.id }, status: 400 })
  await call('/api/conversations', one, { method: 'POST', body: {}, headers: { Origin: 'https://untrusted.invalid' }, status: 403 })
  const pat = (await call('/api/tokens/create', one, { method: 'POST', body: { name: 'Chat smoke brewing-only', scopes: ['recipes:read'] } })).value.token
  await call('/api/conversations', null, { headers: { Authorization: 'Bearer ' + pat }, status: 401 })
  for (let index = 0; index < 105; index++) await call('/api/conversations/' + general.id + '/note', one, { method: 'POST', body: { content: `Synthetic saved decision ${index}` } })
  const page = (await call('/api/conversations/' + general.id + '?limit=100', one)).value.data
  assert.equal(page.messages.length, 100); assert.equal(page.hasMore, true)
  const older = (await call(`/api/conversations/${general.id}?before=${page.nextBefore}&limit=100`, one)).value.data
  assert.equal(older.messages.length, 5); assert.equal(older.hasMore, false)
  assert.equal(older.messages[0].content, 'Synthetic saved decision 0')
  const renamed = (await call('/api/conversations/' + general.id, one, { method: 'PATCH', body: { title: 'Saved smoke decisions' } })).value.data
  assert.equal(renamed.title, 'Saved smoke decisions')
  assert((await call('/api/conversations?q=' + encodeURIComponent('decision 0'), one)).value.data.some(row => row.id === general.id))
  assert.equal((await call('/api/conversations?q=' + encodeURIComponent('decision 0'), two)).value.data.length, 0)
  const carried = (await call('/api/conversations', one, { method: 'POST', body: { carryFromId: general.id } })).value.data
  assert.equal((await call('/api/conversations/' + carried.id + '?limit=500', one)).value.data.messages.length, 105)
  assert.equal((await call('/api/conversations/' + general.id, one)).value.data.conversation.status, 'archived')
  const cleared = (await call('/api/conversations', one, { method: 'POST', body: {} })).value.data
  assert.equal((await call('/api/conversations/' + cleared.id, one)).value.data.messages.length, 0)
  assert.equal((await call('/api/conversations', one)).value.data.filter(row => row.status === 'active').length, 1)
  await call('/api/conversations/' + general.id + '/activate', one, { method: 'POST', body: {} })
  assert.equal((await call('/api/conversations/current', one)).value.data.id, general.id)
  await call('/api/chat', one, { method: 'POST', body: { conversationId: general.id, requestId: randomUUID(), message: 'Synthetic unconnected check', currentRecipeId: recipe.id, conversationMetadata: { mode: 'chat' } }, status: 409 })
  assert.deepEqual((await call('/api/conversations/' + general.id, one)).value.data.conversation.recipes, [])
  await call('/api/conversations/' + general.id + '/compact', one, { method: 'POST', body: {}, status: 409 })
  await call('/api/conversations/' + cleared.id, one, { method: 'DELETE' })
  await call('/api/v1/recipes/' + recipe.id, one, { method: 'DELETE' })
  await call('/api/conversations/' + carried.id + '/activate', one, { method: 'POST', body: {} })
  await call('/api/conversations/' + carried.id + '/note', one, { method: 'POST', body: { content: 'Synthetic continued global history' } })
  await call('/api/conversations/' + general.id + '/activate', one, { method: 'POST', body: {} })
  state.generalId = general.id; state.carriedId = carried.id
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
  console.log('PASS: global history/current, clear/reopen/carry, paging/search/rename, recipe-independent resumption, owner/PAT/origin boundaries and unconnected-agent handling; no inference. State retained for restart checks.')
} else {
  state = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(state.kind, 'brewey-chat-smoke-v1'); assert.equal(state.origin, origin)
  for (const user of state.users) await login(user)
  const [one, two] = state.users
  if (command === 'verify') {
    assert.equal((await call('/api/conversations/current', one)).value.data.id, state.generalId)
    assert.equal((await call('/api/conversations/' + state.generalId + '?limit=500', one)).value.data.messages.length, 105)
    assert.equal((await call('/api/conversations/' + state.carriedId + '?limit=500', one)).value.data.messages.length, 106)
    await call('/api/conversations/' + state.generalId, two, { status: 404 })
    console.log('PASS: complete transcripts, global current selection, carried history and ownership survive restart.')
  } else {
    assert.equal(command, 'cleanup')
    for (const user of state.users) await call('/api/auth/user', user, { method: 'DELETE', body: { password: user.password } })
    await unlink(statePath)
    console.log('PASS: removed only disposable chat accounts, owned history and application agent homes.')
  }
}
