import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDatabase, closeDatabase } from '../database.ts'
import { applicationForUser } from '../application-service.ts'
import { conversationsForUser } from '../conversations.ts'
import { runConversationChat, compactConversation, portableConversationHistory } from '../conversation-chat.ts'
import { AgentHarnessError } from '../../harness/types.ts'

const folder = mkdtempSync(join(tmpdir(), 'brewey-conversation-chat-'))
async function sandbox(name, operation) {
  const previous = process.env.BREWEY_DATABASE_PATH
  closeDatabase(); process.env.BREWEY_DATABASE_PATH = join(folder, `${name}.sqlite`)
  try {
    for (const user of ['alice', 'bob']) getDatabase().prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(user, user, 'synthetic-hash')
    await operation()
  } finally {
    closeDatabase()
    if (previous === undefined) delete process.env.BREWEY_DATABASE_PATH
    else process.env.BREWEY_DATABASE_PATH = previous
  }
}
after(() => { closeDatabase(); rmSync(folder, { recursive: true, force: true }) })
const tool = { name: 'update_recipe', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } }
function fake({ adapterId = 'codex', persistent = true, stream, compact } = {}) {
  const calls = [], compactCalls = []
  const harness = {
    adapterId,
    capabilities: { persistentThreads: persistent, contextCompaction: Boolean(compact) },
    async streamChat(params) {
      calls.push(params)
      if (stream) return stream(params, calls.length)
      const threadId = params.threadId || `${adapterId}-thread-${calls.length}`
      await params.onThreadReady?.(threadId)
      params.onEvent({ type: 'text', content: 'Synthetic brewing answer.' })
      params.onEvent({ type: 'done' })
      return { threadId, turnId: randomUUID(), status: 'completed' }
    },
    ...(compact ? { async compactThread(params) { compactCalls.push(params); return compact(params) } } : {}),
  }
  return { harness, calls, compactCalls }
}
async function chat(store, id, harness, extra = {}) {
  const context = store.getContext(id), events = []
  const message = extra.message || 'Current question'
  const requestId = extra.requestId || randomUUID()
  const turn = store.beginTurn(id, { requestId, message, adapterId: harness.adapterId, model: 'fixture-model' })
  assert.equal(turn.replayed, false)
  await runConversationChat({
    userId: 'alice', conversationId: id, turn, context, harness,
    systemPrompt: 'Current canonical recipe facts', message, model: 'fixture-model',
    reasoningEffort: 'medium', verbosity: 'low', availableTools: [tool],
    executeTool: async () => { throw new Error('Unexpected tool execution') },
    abortSignal: new AbortController().signal, onEvent: event => events.push(event), ...extra,
  })
  return { turn, events, requestId }
}
function seed(store, id, content, metadata = {}) {
  const turn = store.beginTurn(id, { requestId: randomUUID(), message: 'Earlier question', adapterId: 'codex' })
  store.updateAssistant(turn.turnId, { content, metadata }); store.finishTurn(turn.turnId, 'completed')
  return turn
}
function status(turn) { return getDatabase().prepare('SELECT status FROM conversation_turns WHERE id=?').get(turn.turnId).status }
function assistant(store, id) { return store.get(id).messages.filter(row => row.type === 'assistant').at(-1) }
function durableEvents(turn) { return getDatabase().prepare('SELECT event FROM conversation_events WHERE turn_id=? ORDER BY sequence').all(turn.turnId).map(row => JSON.parse(row.event)) }

test('persistent start and resume survive database reopen, refresh context each turn and avoid history replay', () => sandbox('resume', async () => {
  let store = conversationsForUser('alice')
  const id = store.current(null).id
  seed(store, id, 'Earlier recipe decision')
  const agent = fake({ stream: async (params, count) => {
    const threadId = params.threadId || 'durable-native-id'
    await params.onThreadReady(threadId)
    // Native inference starts only after the binding is already durable.
    assert.equal(conversationsForUser('alice').getBinding(id, 'codex').threadId, threadId)
    params.onEvent({ type: 'text', content: `Answer ${count}` })
    return { threadId, turnId: `turn-${count}`, status: 'completed' }
  } })
  const first = await chat(store, id, agent.harness, { systemPrompt: 'Recipe volume: 20 L', message: 'First current question' })
  assert.equal(agent.calls[0].persistent, true)
  assert.equal(agent.calls[0].threadId, undefined)
  assert.equal(agent.calls[0].conversationHistory.filter(row => row.content.includes('Earlier recipe decision')).length, 1)
  assert.equal(agent.calls[0].conversationHistory.some(row => row.content.includes('First current question')), false)
  assert.deepEqual(first.events.map(row => row.type), ['text', 'done'])
  closeDatabase(); store = conversationsForUser('alice')
  await chat(store, id, agent.harness, { systemPrompt: 'Recipe volume: 24 L', message: 'Second current question' })
  assert.equal(agent.calls[1].threadId, 'durable-native-id')
  assert.deepEqual(agent.calls[1].conversationHistory, [])
  assert.equal(agent.calls[1].systemPrompt, 'Recipe volume: 24 L')
  assert.equal(agent.calls[1].reasoningEffort, 'medium')
  assert.equal(agent.calls[1].verbosity, 'low')
  assert.equal(store.getBinding(id, 'codex').throughSequence, store.getContext(id).lastSequence)
  assert.equal(store.get(id).messages.length, 6)
}))

for (const code of ['THREAD_MISSING', 'THREAD_TOOLS_CHANGED']) {
  test(`${code} safely rebuilds the same adapter with saved history and emits no fatal error`, () => sandbox(code, async () => {
    const store = conversationsForUser('alice'), id = store.current(null).id
    seed(store, id, 'Use the saved pale malt decision')
    store.setBinding(id, 'codex', { threadId: 'missing-native', throughSequence: 2 })
    const agent = fake({ stream: async (params, count) => {
      if (count === 1) {
        assert.equal(params.threadId, 'missing-native')
        params.onEvent({ type: 'error', error_code: code, error: 'Cannot resume' })
        throw new AgentHarnessError(code, 'Cannot resume')
      }
      assert.equal(params.threadId, undefined)
      assert.equal(params.conversationHistory.filter(row => row.content.includes('saved pale malt decision')).length, 1)
      await params.onThreadReady('rebuilt-native')
      params.onEvent({ type: 'text', content: 'Continued using saved decisions.' })
      return { threadId: 'rebuilt-native', turnId: 'rebuilt-turn', status: 'completed' }
    } })
    const result = await chat(store, id, agent.harness)
    assert.equal(agent.calls.length, 2)
    assert.deepEqual(result.events.map(row => row.type), ['context_restored', 'text', 'done'])
    assert.equal(durableEvents(result.turn).some(row => row.type === 'error'), false)
    assert.equal(status(result.turn), 'completed')
    assert.equal(store.getBinding(id, 'codex').threadId, 'rebuilt-native')
    assert.equal(store.get(id).messages.length, 4)
  }))
}

test('adapter switch uses portable transcript and completed tool results without reusing another native binding', () => sandbox('adapter-switch', async () => {
  const store = conversationsForUser('alice'), id = store.current(null).id
  seed(store, id, 'The recipe is called Golden Ale', { toolCalls: [{ id: 'old-tool', name: 'update_recipe', parameters: { name: 'Golden Ale' }, status: 'success', result: { recipe_id: 'synthetic', name: 'Golden Ale' } }] })
  const codex = fake(); await chat(store, id, codex.harness)
  const independent = fake({ adapterId: 'independent' })
  await chat(store, id, independent.harness)
  const request = independent.calls[0]
  assert.equal(request.threadId, undefined)
  assert.equal(request.conversationHistory.filter(row => row.content.includes('Previously executed brewing tool calls/results')).length, 1)
  assert.ok(request.conversationHistory.some(row => row.content.includes('Golden Ale')))
  assert.equal(request.availableTools[0], tool)
  assert.equal(store.listBindings(id).length, 2)
  assert.notEqual(store.getBinding(id, 'codex').threadId, store.getBinding(id, 'independent').threadId)
  assert.throws(() => conversationsForUser('bob').get(id), /not found/i)
}))

test('disconnect retains completed recipe mutation and tool result, and request replay creates no duplicate turn', () => sandbox('interrupted-tools', async () => {
  const store = conversationsForUser('alice')
  const app = applicationForUser('alice'), recipe = app.createRecipe({ name: 'Before mutation' })
  const id = store.current(recipe.id).id, abort = new AbortController()
  let executions = 0
  const agent = fake({ stream: async params => {
    await params.onThreadReady('interrupted-native')
    params.onEvent({ type: 'tool_call', tool_id: 'tool-1', tool_name: 'update_recipe', tool_args: { name: 'Saved after disconnect' } })
    const result = await params.executeTool({ toolName: 'update_recipe', toolCallId: 'tool-1', toolInput: { name: 'Saved after disconnect' }, abortSignal: params.abortSignal })
    abort.abort()
    // A completed mutation can arrive after the browser has disconnected.
    params.onEvent({ type: 'tool_result', tool_id: 'tool-1', tool_name: 'update_recipe', tool_result: result.parsedResult })
    params.onEvent({ type: 'text', content: 'The recipe change was saved.' })
    return { threadId: 'interrupted-native', turnId: 'interrupted-turn', status: 'interrupted' }
  } })
  const result = await chat(store, id, agent.harness, {
    message: 'Rename the recipe', abortSignal: abort.signal,
    executeTool: async ({ toolInput }) => {
      executions++; const saved = app.updateRecipe(recipe.id, toolInput)
      return { success: true, content: 'Saved', parsedResult: { id: saved.id, name: saved.name } }
    },
  })
  assert.equal(app.getRecipe(recipe.id).name, 'Saved after disconnect')
  assert.equal(status(result.turn), 'interrupted')
  assert.equal(assistant(store, id).metadata.isStreaming, false)
  assert.equal(assistant(store, id).metadata.toolCalls[0].status, 'success')
  assert.equal(assistant(store, id).metadata.toolCalls[0].result.name, 'Saved after disconnect')
  assert.ok(durableEvents(result.turn).some(row => row.type === 'tool_result'))
  assert.equal(result.events.some(row => row.type === 'done'), false)
  const replay = store.beginTurn(id, { requestId: result.requestId, message: 'Rename the recipe', adapterId: 'codex', model: 'fixture-model' })
  assert.equal(replay.replayed, true)
  assert.equal(replay.turnId, result.turn.turnId)
  assert.equal(agent.calls.length, 1)
  assert.equal(executions, 1)
  assert.equal(store.get(id).messages.length, 2)
  const next = fake({ adapterId: 'independent', persistent: false })
  await chat(store, id, next.harness)
  assert.ok(next.calls[0].conversationHistory.some(row => row.content.includes('Do not repeat actions automatically.') && row.content.includes('Saved after disconnect')))
  assert.equal(executions, 1)
}))

test('fallback compaction has no tools, rolls summaries forward and retains the full original transcript', () => sandbox('fallback', async () => {
  const store = conversationsForUser('alice'), id = store.current(null).id
  for (let index = 0; index < 3; index++) seed(store, id, `Original-${index}:` + 'x'.repeat(20_000))
  const original = store.get(id).messages.map(row => ({ id: row.id, content: row.content }))
  let summaryCalls = 0
  const agent = fake({ persistent: false, stream: async params => {
    if (params.availableTools.length === 0) {
      summaryCalls++
      assert.equal(params.persistent, false)
      assert.equal(params.showReasoning, false)
      assert.equal(params.conversationHistory, undefined)
      assert.match(params.systemPrompt, /Tools are unavailable/)
      await assert.rejects(params.executeTool({ toolName: 'update_recipe' }), /cannot execute brewing tools/)
      const fragment = JSON.parse(params.message)
      assert.equal(fragment.priorSummary, summaryCalls === 1 ? '' : `Summary-${summaryCalls - 1}: preserved decisions`)
      params.onEvent({ type: 'text', content: `Summary-${summaryCalls}: preserved decisions` })
    } else {
      assert.equal(params.availableTools[0], tool)
      assert.equal(params.conversationHistory.length, 1)
      assert.match(params.conversationHistory[0].content, /Saved conversation summary/)
      params.onEvent({ type: 'text', content: 'Answer from compacted context' })
    }
    return { threadId: 'ephemeral', turnId: randomUUID(), status: 'completed' }
  } })
  const result = await chat(store, id, agent.harness)
  assert.ok(summaryCalls >= 2)
  assert.equal(agent.calls.length, summaryCalls + 1)
  assert.equal(status(result.turn), 'completed')
  assert.deepEqual(store.get(id).messages.slice(0, original.length).map(row => ({ id: row.id, content: row.content })), original)
  assert.equal(store.getContext(id).summary, `Summary-${summaryCalls}: preserved decisions`)
  assert.equal(store.getContext(id).summaryThroughSequence, 6)
  assert.ok(store.get(id).conversation.compactedAt)
  assert.equal(store.getBinding(id, 'codex'), null)
  assert.equal(result.events.filter(row => row.type === 'context_compacted').length, 1)
}))

for (const cancelled of [false, true]) {
  test(`native manual compaction ${cancelled ? 'cancellation' : 'failure'} retains history and never marks success`, () => sandbox(`compact-${cancelled}`, async () => {
    const store = conversationsForUser('alice'), id = store.current(null).id
    seed(store, id, 'Original uncompressed discussion')
    store.setBinding(id, 'codex', { threadId: 'native-for-compaction', throughSequence: 2 })
    const binding = store.getBinding(id, 'codex'), abort = new AbortController()
    const agent = fake({ compact: async params => {
      assert.equal(params.threadId, binding.threadId)
      params.onEvent({ type: 'context_compacting', content: 'Native compaction started' })
      if (cancelled) abort.abort()
      throw new AgentHarnessError(cancelled ? 'TURN_CANCELLED' : 'COMPACTION_FAILED', 'Synthetic compaction failure')
    } })
    await assert.rejects(compactConversation({ userId: 'alice', conversationId: id, requestId: randomUUID(), harness: agent.harness, abortSignal: abort.signal }), /Synthetic compaction failure/)
    assert.equal(agent.compactCalls.length, 1)
    assert.equal(agent.calls.length, 0)
    assert.equal(store.get(id).conversation.compactedAt, null)
    assert.equal(store.getContext(id).summary, null)
    assert.deepEqual(store.getBinding(id, 'codex'), binding)
    const saved = assistant(store, id)
    assert.equal(saved.metadata.turnStatus, cancelled ? 'interrupted' : 'failed')
    assert.equal(saved.metadata.isStreaming, false)
    assert.doesNotMatch(saved.content, /Context compacted/)
    assert.equal(store.get(id).messages[1].content, 'Original uncompressed discussion')
  }))
}

test('fallback summary failure preserves prior transcript and native binding and records failed turn', () => sandbox('summary-failure', async () => {
  const store = conversationsForUser('alice'), id = store.current(null).id
  seed(store, id, 'Full transcript: ' + 'y'.repeat(50_000))
  const original = store.get(id).messages[1].content
  const agent = fake({ persistent: false, stream: async params => {
    assert.deepEqual(params.availableTools, [])
    params.onEvent({ type: 'text', content: 'Incomplete summary' })
    return { threadId: 'temporary', turnId: randomUUID(), status: 'failed' }
  } })
  const result = await chat(store, id, agent.harness)
  assert.equal(agent.calls.length, 1)
  assert.equal(status(result.turn), 'failed')
  assert.equal(store.getContext(id).summary, null)
  assert.equal(store.get(id).conversation.compactedAt, null)
  assert.equal(store.get(id).messages[1].content, original)
  assert.equal(result.events.some(row => row.type === 'done' || row.type === 'context_compacted'), false)
  assert.match(result.events.find(row => row.type === 'error').error, /could not complete context compaction/)
  assert.ok(portableConversationHistory(store.getContext(id)).some(row => row.content.includes(original)))
}))

test('started turn failure never retries inference or replays a completed tool mutation', () => sandbox('started-failure', async () => {
  const store = conversationsForUser('alice'), id = store.current(null).id
  let executions = 0
  const agent = fake({ stream: async params => {
    await params.onThreadReady('started-native')
    params.onEvent({ type: 'tool_call', tool_id: 'completed-tool', tool_name: 'update_recipe', tool_args: {} })
    const result = await params.executeTool({ toolName: 'update_recipe', toolCallId: 'completed-tool', toolInput: {}, abortSignal: params.abortSignal })
    params.onEvent({ type: 'tool_result', tool_id: 'completed-tool', tool_name: 'update_recipe', tool_result: result.parsedResult })
    params.onEvent({ type: 'text', content: 'Partial answer' })
    params.onEvent({ type: 'error', error_code: 'RPC_ERROR', error: 'Connection failed after the tool completed' })
    throw new AgentHarnessError('RPC_ERROR', 'Connection failed after the tool completed')
  } })
  const result = await chat(store, id, agent.harness, { executeTool: async () => { executions++; return { success: true, content: 'Completed', parsedResult: { saved: true } } } })
  assert.equal(agent.calls.length, 1)
  assert.equal(executions, 1)
  assert.equal(status(result.turn), 'failed')
  assert.equal(result.events.filter(row => row.type === 'error').length, 1)
  assert.equal(result.events.some(row => row.type === 'done' || row.type === 'context_restored'), false)
  assert.equal(assistant(store, id).content, 'Partial answer')
  assert.equal(assistant(store, id).metadata.toolCalls[0].status, 'success')
}))

test('successful native compaction keeps the binding and transcript while advancing past the slash command', () => sandbox('compact-success', async () => {
  const store = conversationsForUser('alice'), id = store.current(null).id
  seed(store, id, 'Native context should keep this discussion')
  store.setBinding(id, 'codex', { threadId: 'native-compact-success', throughSequence: 2 })
  const agent = fake({ compact: async params => {
    assert.equal(conversationsForUser('alice').get(id).conversation.compactedAt, null)
    params.onEvent({ type: 'context_compacted', thread_id: params.threadId, automatic: false })
  } })
  const requestId = randomUUID()
  const compacted = await compactConversation({ userId: 'alice', conversationId: id, requestId, harness: agent.harness, abortSignal: new AbortController().signal })
  assert.ok(compacted.compactedAt)
  assert.equal(store.getContext(id).summary, null)
  assert.equal(store.get(id).messages[1].content, 'Native context should keep this discussion')
  assert.equal(assistant(store, id).metadata.isSlashCommand, true)
  assert.equal(assistant(store, id).metadata.turnStatus, 'completed')
  assert.equal(store.getBinding(id, 'codex').threadId, 'native-compact-success')
  assert.equal(store.getBinding(id, 'codex').throughSequence, 4)
  assert.equal(store.getBinding(id, 'codex').contextRevision, 0)
  assert.equal(portableConversationHistory(store.getContext(id)).some(row => row.content.startsWith('Context compacted.')), false)
  await compactConversation({ userId: 'alice', conversationId: id, requestId, harness: agent.harness, abortSignal: new AbortController().signal })
  assert.equal(agent.compactCalls.length, 1)
  await chat(store, id, agent.harness)
  assert.equal(agent.calls[0].threadId, 'native-compact-success')
  assert.deepEqual(agent.calls[0].conversationHistory, [])
}))

test('expired turn cannot execute a brewing mutation even before another client recovers it', () => sandbox('lease-tool-guard', async () => {
  const store = conversationsForUser('alice'), id = store.current(null).id
  let mutations = 0
  const agent = fake({ stream: async params => {
    getDatabase().prepare("UPDATE conversation_turns SET lease_expires_at=0 WHERE user_id='alice' AND status='running'").run()
    await params.executeTool({ toolName: 'update_recipe', toolInput: { name: 'Should not execute' }, abortSignal: params.abortSignal })
    return { status: 'completed', threadId: 'unexpected' }
  } })
  const result = await chat(store, id, agent.harness, { executeTool: async () => { mutations++; return { success: true, content: 'Unexpected' } } })
  assert.equal(mutations, 0)
  assert.equal(status(result.turn), 'interrupted')
  assert.equal(store.get(id).conversation.running, false)
}))

test('expired nonpersistent completion never emits done for an interrupted saved turn', () => sandbox('lease-completion-guard', async () => {
  const store = conversationsForUser('alice'), id = store.current(null).id
  const agent = fake({ persistent: false, stream: async () => {
    getDatabase().prepare("UPDATE conversation_turns SET lease_expires_at=0 WHERE user_id='alice' AND status='running'").run()
    return { status: 'completed', threadId: 'ephemeral' }
  } })
  const result = await chat(store, id, agent.harness)
  assert.equal(status(result.turn), 'interrupted')
  assert.equal(result.events.some(event => event.type === 'done'), false)
  assert.equal(result.events.some(event => event.type === 'error'), true)
}))
