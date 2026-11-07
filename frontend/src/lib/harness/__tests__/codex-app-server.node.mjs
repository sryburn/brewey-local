import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CodexAppServerHarness } from '../codex-app-server.ts'
const binary = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url))
await chmod(binary, 0o700)
async function fixture(t, mode = '', options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'brewey-harness-test-'))
  const cwd = join(home, 'work')
  await mkdir(cwd)
  if (mode) await writeFile(join(cwd, 'mock-mode'), mode)
  const harness = new CodexAppServerHarness({ binary, codexHome: home, cwd, ...options })
  t.after(async () => { harness.close(); await rm(home, { recursive: true, force: true }) })
  return { harness, home }
}
function chat(message, events, overrides = {}) {
  return { message, systemPrompt: 'Help brew.', availableTools: [{ name: 'calculate_recipe', description: 'Calculate', inputSchema: { type: 'object' } }], executeTool: async () => ({ success: true, content: '{"recipe":{"id":"recipe-1"}}', parsedResult: { recipe: { id: 'recipe-1' } } }), onEvent: event => events.push(event), ...overrides }
}
test('handshake, isolated auth environment, login, and paginated models', async t => {
  const original = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-owner-key-do-not-inherit'
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original })
  const { harness, home } = await fixture(t)
  const status = await harness.account()
  assert.equal(status.account.type, 'chatgpt')
  assert.equal(status.diagnostic.hasOwnerKey, false)
  assert.equal(status.diagnostic.home, join(home, 'user'))
  assert.equal(status.diagnostic.codexHome, home)
  assert.equal((await harness.models()).length, 2)
  assert.equal((await harness.login()).type, 'chatgptDeviceCode')
  assert.deepEqual(await harness.cancelLogin('login-1'), { status: 'canceled' })
  await harness.logout()
  await assert.rejects(harness.login('apiKey'), error => error.code === 'AUTH')
})
test('uses catalog default and streams filtered text, reasoning summaries, actual usage', async t => {
  const { harness } = await fixture(t)
  const events = []
  const usages = []
  const result = await harness.streamChat(chat('Hello', events, { showReasoning: true, onUsage: usage => usages.push(usage) }))
  assert.equal(result.status, 'completed')
  assert.deepEqual(events.map(event => event.type), ['text', 'reasoning', 'done'])
  assert.equal(events[0].content, 'Hello brewer.')
  assert.equal(events[2].usage.input_tokens, 8)
  assert.equal(usages[0].model, 'catalog-default')
  const status = await harness.account()
  assert.equal(status.diagnostic.captured.dynamicTools[0].name, 'brewing')
  assert.equal(status.diagnostic.captured.dynamicTools[0].type, 'namespace')
  assert.equal(status.diagnostic.captured.ephemeral, true)
})
test('executes only registered dynamic tools and emits compatible recipe events', async t => {
  const { harness } = await fixture(t)
  const events = []
  let executions = 0
  await harness.streamChat(chat('tool', events, { executeTool: async call => {
    executions++
    assert.equal(call.toolName, 'calculate_recipe')
    assert.equal(call.toolInput.recipe_id, 'recipe-1')
    return { success: true, content: 'recipe result', parsedResult: { recipe: { id: 'recipe-1' } } }
  } }))
  assert.equal(executions, 1)
  assert.equal(events.find(event => event.type === 'tool_result').tool_result.recipe.id, 'recipe-1')
  events.length = 0
  await harness.streamChat(chat('tool unknown', events, { executeTool: async () => { executions++; throw new Error('Must not execute') } }))
  assert.equal(executions, 1)
  assert.equal(events.find(event => event.type === 'tool_error').error, 'Unknown brewing tool.')
})
test('tool failure is returned to agent; failed turn is never emitted as done', async t => {
  const { harness } = await fixture(t)
  const events = []
  await harness.streamChat(chat('tool', events, { executeTool: async () => { throw new Error('Calculation failed') } }))
  assert.equal(events.find(event => event.type === 'tool_error').error, 'Calculation failed')
  events.length = 0
  const result = await harness.streamChat(chat('failure', events))
  assert.equal(result.status, 'failed')
  assert.deepEqual(events.map(event => event.type), ['error'])
})
test('cancels active turn and rejects overlapping chats', async t => {
  const { harness } = await fixture(t)
  const events = []
  const abort = new AbortController()
  const started = new Promise(resolveStart => harness.onNotification((method) => { if (method === 'turn/started') resolveStart() }))
  const turn = harness.streamChat(chat('wait', events, { abortSignal: abort.signal }))
  await started
  await assert.rejects(harness.streamChat(chat('Hello', events)), error => error.code === 'BUSY')
  abort.abort()
  const result = await turn
  assert.equal(result.status, 'interrupted')
  assert.equal(events.length, 0)
  assert.equal((await harness.streamChat(chat('Hello', events))).status, 'completed')
})
test('transport crash and malformed protocol reject promptly and can reconnect', async t => {
  const { harness } = await fixture(t, '', { requestTimeoutMs: 500 })
  for (const message of ['crash', 'malformed']) {
    const events = []
    await assert.rejects(harness.streamChat(chat(message, events)), error => ['UNAVAILABLE', 'PROTOCOL'].includes(error.code))
    assert.equal(events.at(-1).type, 'error')
    assert.equal((await harness.streamChat(chat('Hello', []))).status, 'completed')
  }
})
test('requires app ChatGPT login; never executes API-key fallback', async t => {
  for (const mode of ['unauthenticated', 'apiKey']) {
    const { harness } = await fixture(t, mode)
    await assert.rejects(harness.streamChat(chat('Hello', [])), error => error.code === 'AUTH')
  }
})
test('bounded turn/tool timeouts and invalid model are explicit', async t => {
  const { harness } = await fixture(t, '', { turnTimeoutMs: 150, toolTimeoutMs: 20 })
  await assert.rejects(harness.streamChat(chat('Hello', [], { model: 'unavailable' })), error => error.code === 'MODEL')
  await assert.rejects(harness.streamChat(chat('Hello', [], { reasoningEffort: 'ultra' })), error => error.code === 'MODEL')
  const events = []
  await harness.streamChat(chat('tool', events, { executeTool: () => new Promise(() => {}) }))
  assert.match(events.find(event => event.type === 'tool_error').error, /timed out/)
  await assert.rejects(harness.streamChat(chat('wait', [])), error => error.code === 'TIMEOUT')
})
test('refuses personal Codex home and aliases', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'brewey-home-alias-'))
  const originalHome = process.env.HOME
  const userHome = join(dir, 'owner')
  const owner = join(userHome, '.codex')
  await mkdir(owner, { recursive: true })
  process.env.HOME = userHome
  t.after(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await rm(dir, { recursive: true, force: true })
  })
  assert.equal(homedir(), userHome)
  const direct = new CodexAppServerHarness({ codexHome: owner, binary })
  await assert.rejects(direct.account(), error => error.code === 'CONFIGURATION')
  const alias = join(dir, 'alias')
  await symlink(owner, alias)
  const linked = new CodexAppServerHarness({ codexHome: alias, binary })
  await assert.rejects(linked.account(), error => error.code === 'CONFIGURATION')
  const userHomeAlias = join(dir, 'user-home-alias')
  await symlink(userHome, userHomeAlias)
  const linkedUserHome = new CodexAppServerHarness({ codexHome: userHomeAlias, binary })
  await assert.rejects(linkedUserHome.account(), error => error.code === 'CONFIGURATION')
})

test('a disconnected event sink cannot start a mutation', async t => {
  const { harness } = await fixture(t)
  let executions = 0
  const result = await harness.streamChat(chat('tool', [], {
    onEvent: () => { throw new Error('Stream disconnected') },
    executeTool: async () => { executions++; return { success: true, content: 'Should not execute' } },
  }))
  assert.equal(result.status, 'interrupted')
  assert.equal(executions, 0)
})

test('forwards native verbosity to thread config and supported effort to turn/start', async t => {
  const { harness } = await fixture(t)
  for (const verbosity of ['low', 'medium', 'high']) {
    const result = await harness.streamChat(chat('Hello', [], { verbosity, reasoningEffort: 'medium', showReasoning: true }))
    assert.equal(result.status, 'completed')
    const status = await harness.account()
    assert.deepEqual(status.diagnostic.captured.config, { model_verbosity: verbosity })
    assert.equal(status.diagnostic.capturedTurn.effort, 'medium')
    assert.equal(status.diagnostic.capturedTurn.summary, 'auto')
    assert.equal(Object.hasOwn(status.diagnostic.capturedTurn, 'verbosity'), false)
    assert.equal(Object.hasOwn(status.diagnostic.capturedTurn, 'model_verbosity'), false)
  }
})

test('default verbosity matches the displayed Low and reasoning visibility is independent of effort', async t => {
  const { harness } = await fixture(t)
  await harness.streamChat(chat('Hello', []))
  let status = await harness.account()
  assert.deepEqual(status.diagnostic.captured.config, { model_verbosity: 'low' })
  assert.equal(Object.hasOwn(status.diagnostic.capturedTurn, 'effort'), false)
  assert.equal(status.diagnostic.capturedTurn.summary, 'none')
  const events = []
  await harness.streamChat(chat('Hello', events, { reasoningEffort: 'medium', showReasoning: false }))
  status = await harness.account()
  assert.equal(status.diagnostic.capturedTurn.effort, 'medium')
  assert.equal(status.diagnostic.capturedTurn.summary, 'none')
  assert.equal(events.some(event => event.type === 'reasoning'), false)
})

test('invalid verbosity and unsupported effort fail before starting an inference turn', async t => {
  const { harness } = await fixture(t)
  for (const verbosity of ['detailed', '', null, 5]) {
    const events = []
    await assert.rejects(harness.streamChat(chat('Hello', events, { verbosity })), error => error.code === 'MODEL')
    assert.match(events.at(-1).error, /verbosity/)
  }
  await assert.rejects(harness.streamChat(chat('Hello', [], { reasoningEffort: 'ultra' })), error => error.code === 'MODEL')
  const status = await harness.account()
  assert.deepEqual(status.diagnostic.captured, {})
  assert.deepEqual(status.diagnostic.capturedTurn, {})
})

test('persistent native threads resume across process restarts with fresh context and no duplicated transcript', async t => {
  const { harness, home } = await fixture(t)
  const ready = []
  await harness.streamChat(chat('Initial', [], { persistent: true, systemPrompt: 'Initial recipe batch20', conversationHistory: [{ role: 'user', content: 'Historical only once' }], onThreadReady: async id => { ready.push(id) } }))
  let status = await harness.account()
  assert.equal(status.diagnostic.captured.ephemeral, false)
  assert.match(status.diagnostic.capturedTurn.input[0].text, /Historical only once/)
  harness.close()
  const second = new CodexAppServerHarness({ binary, codexHome: home, cwd: join(home, 'work') })
  t.after(() => second.close())
  await second.streamChat(chat('Continue', [], { persistent: true, threadId: ready[0], systemPrompt: 'Fresh recipe batch25', conversationHistory: [{ role: 'user', content: 'Historical only once' }], onThreadReady: id => ready.push(id) }))
  status = await second.account()
  assert.deepEqual(ready, ['thread-1', 'thread-1'])
  assert.equal(status.diagnostic.capturedResume.developerInstructions, 'Fresh recipe batch25')
  assert.match(status.diagnostic.capturedTurn.input[0].text, /Fresh recipe batch25/)
  assert.doesNotMatch(status.diagnostic.capturedTurn.input[0].text, /Historical only once/)
  assert.equal(status.diagnostic.capturedResume.config.model_verbosity, 'low')
  assert.equal(status.diagnostic.capturedResume.sandbox, 'read-only')
  assert.equal(status.diagnostic.capturedResume.approvalPolicy, 'never')
})

test('native binding is awaited before inference and failed binding never starts a turn', async t => {
  const { harness } = await fixture(t)
  let turnStarts = -1
  await harness.streamChat(chat('Initial', [], { persistent: true, onThreadReady: async () => { turnStarts = (await harness.account()).diagnostic.turnStarts } }))
  assert.equal(turnStarts, 0)
  await assert.rejects(harness.streamChat(chat('Next', [], { persistent: true, onThreadReady: async () => { throw new Error('Binding not saved') } })), /Binding not saved/)
  assert.equal((await harness.account()).diagnostic.turnStarts, 1)
})

test('missing native rollouts and changed tools are explicit safe pre-inference rebuild errors', async t => {
  const { harness, home } = await fixture(t)
  await harness.streamChat(chat('Initial', [], { persistent: true }))
  await writeFile(join(home, 'work', 'mock-mode'), 'missing')
  await assert.rejects(harness.streamChat(chat('Resume', [], { threadId: 'thread-1' })), error => error.code === 'THREAD_MISSING')
  await writeFile(join(home, 'work', 'mock-mode'), '')
  const availableTools = [{ name: 'different_recipe_tool', inputSchema: { type: 'object' } }]
  await assert.rejects(harness.streamChat(chat('Resume', [], { threadId: 'thread-1', availableTools })), error => error.code === 'THREAD_TOOLS_CHANGED')
  assert.equal((await harness.account()).diagnostic.turnStarts, 1)
  for (const mode of ['resume-busy', 'resume-permission']) {
    await writeFile(join(home, 'work', 'mock-mode'), mode)
    await assert.rejects(harness.streamChat(chat('Resume', [], { threadId: 'thread-1' })), error => error.code === 'THREAD_RESUME_FAILED')
  }
  assert.equal((await harness.account()).diagnostic.turnStarts, 1)
})

test('resumed dynamic calls remain limited to the current authenticated tool executor', async t => {
  const { harness } = await fixture(t)
  await harness.streamChat(chat('Initial', [], { persistent: true }))
  let executed = 0
  const events = []
  await harness.streamChat(chat('tool unknown', events, { threadId: 'thread-1', executeTool: async () => { executed++; throw Error('Never') } }))
  assert.equal(executed, 0)
  assert.equal(events.find(event => event.type === 'tool_error').error, 'Unknown brewing tool.')
})

test('manual compaction waits for matching item and successful turn completion, not RPC acknowledgment', async t => {
  const { harness } = await fixture(t)
  await harness.streamChat(chat('Initial', [], { persistent: true }))
  const events = []
  let resolved = false
  const compactStarted = new Promise(resolveStart => harness.onNotification(method => { if (method === 'turn/started') resolveStart() }))
  const compaction = harness.compactThread({ threadId: 'thread-1', onEvent: event => events.push(event) }).then(() => { resolved = true })
  await compactStarted
  assert.equal(resolved, false)
  assert.deepEqual(events, [])
  await compaction
  assert.deepEqual(events, [{ type: 'context_compacted', thread_id: 'thread-1', automatic: false }])
})

test('compaction errors, failed turns, wrong items, transport failures and timeouts do not report success', async t => {
  for (const mode of ['compact-fail', 'compact-error', 'compact-no-item', 'compact-wrong-item', 'compact-crash', 'compact-wait']) {
    const { harness, home } = await fixture(t, '', { turnTimeoutMs: 150, requestTimeoutMs: 300 })
    await harness.streamChat(chat('Initial', [], { persistent: true }))
    await writeFile(join(home, 'work', 'mock-mode'), mode)
    const events = []
    await assert.rejects(harness.compactThread({ threadId: 'thread-1', onEvent: event => events.push(event) }), error => ['COMPACTION_FAILED', 'PROTOCOL', 'UNAVAILABLE', 'TIMEOUT'].includes(error.code))
    assert.deepEqual(events, [])
  }
})

test('compaction shares busy/cancel isolation with chats, logout and deletion', async t => {
  const { harness, home } = await fixture(t)
  await harness.streamChat(chat('Initial', [], { persistent: true }))
  await writeFile(join(home, 'work', 'mock-mode'), 'compact-wait')
  const started = new Promise(resolveStart => harness.onNotification(method => { if (method === 'turn/started') resolveStart() }))
  const events = [], abort = new AbortController()
  const compact = harness.compactThread({ threadId: 'thread-1', abortSignal: abort.signal, onEvent: event => events.push(event) })
  await started
  await assert.rejects(harness.streamChat(chat('Concurrent', [])), error => error.code === 'BUSY')
  await assert.rejects(harness.compactThread({ threadId: 'thread-1' }), error => error.code === 'BUSY')
  await assert.rejects(harness.deleteThread('thread-1'), error => error.code === 'BUSY')
  await assert.rejects(harness.logout(), error => error.code === 'BUSY')
  await harness.cancelTurn()
  await assert.rejects(compact, error => error.code === 'ABORTED')
  assert.deepEqual(events, [])
  await writeFile(join(home, 'work', 'mock-mode'), '')
  await harness.compactThread({ threadId: 'thread-1', onEvent: event => events.push(event) })
  assert.equal(events.length, 1)
  abort.abort()
  await assert.rejects(harness.compactThread({ threadId: 'thread-1', abortSignal: abort.signal }), error => error.code === 'ABORTED')
})

test('automatic compaction status follows a successful matching turn without exposing internal summaries', async t => {
  const { harness } = await fixture(t)
  const events = []
  await harness.streamChat(chat('auto-compact', events, { persistent: true }))
  assert.equal(events.filter(event => event.type === 'context_compacted').length, 1)
  assert.deepEqual(events.find(event => event.type === 'context_compacted'), { type: 'context_compacted', thread_id: 'thread-1', automatic: true })
  events.length = 0
  await harness.streamChat(chat('auto-compact failure', events, { threadId: 'thread-1' }))
  assert.equal(events.some(event => event.type === 'context_compacted'), false)
})

test('native permanent deletion removes its schema marker and forbids path traversal', async t => {
  const { harness } = await fixture(t)
  await harness.streamChat(chat('Initial', [], { persistent: true }))
  await harness.deleteThread('thread-1')
  await assert.rejects(harness.streamChat(chat('Resume', [], { threadId: 'thread-1' })), error => error.code === 'THREAD_TOOLS_CHANGED')
  await assert.rejects(harness.deleteThread('../owner'), error => error.code === 'CONFIGURATION')
  await assert.rejects(harness.compactThread({ threadId: '../owner' }), error => error.code === 'CONFIGURATION')
})


test('native deletion is idempotent only for exact missing rollouts, not permission failures', async t => {
  const { harness, home } = await fixture(t)
  await harness.streamChat(chat('Initial', [], { persistent: true }))
  await writeFile(join(home, 'work', 'mock-mode'), 'delete-permission')
  await assert.rejects(harness.deleteThread('thread-1'), error => error.code === 'RPC')
  await writeFile(join(home, 'work', 'mock-mode'), '')
  await harness.streamChat(chat('Resume', [], { threadId: 'thread-1' }))
  await writeFile(join(home, 'work', 'mock-mode'), 'delete-missing')
  await harness.deleteThread('thread-1')
  await assert.rejects(harness.streamChat(chat('Resume', [], { threadId: 'thread-1' })), error => error.code === 'THREAD_TOOLS_CHANGED')
})


test('rebuild-safe error codes are available before inference but never inferred from turn-start failures', async t => {
  const { harness, home } = await fixture(t)
  await harness.streamChat(chat('Initial', [], { persistent: true }))
  const events = []
  await writeFile(join(home, 'work', 'mock-mode'), 'missing')
  await assert.rejects(harness.streamChat(chat('Resume', events, { threadId: 'thread-1' })), error => error.code === 'THREAD_MISSING')
  assert.equal(events.at(-1).error_code, 'THREAD_MISSING')
  events.length = 0
  await writeFile(join(home, 'work', 'mock-mode'), 'turn-missing')
  await assert.rejects(harness.streamChat(chat('Resume', events, { threadId: 'thread-1' })), error => error.code === 'RPC')
  assert.equal(events.at(-1).error_code, 'RPC')
})
