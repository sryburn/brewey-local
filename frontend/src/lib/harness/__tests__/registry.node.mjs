import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentHarnessRegistry, listAgentAdapters } from '../registry.ts'
import { validateAgentPreferences } from '../preferences.ts'
import { installationAgentContext } from '../installation-context.ts'

const userA = '00000000-0000-4000-8000-000000000001'
const userB = '00000000-0000-4000-8000-000000000002'
const descriptor = { id: 'synthetic', displayName: 'Synthetic', accountLabel: 'Example', description: 'Test adapter', capabilities: { loginMethods: [{ id: 'example', label: 'Example sign-in' }], modelCatalog: true, streaming: true, brewingTools: true, cancellation: true, reasoningEffort: false, reasoningSummaries: false, verbosity: [] } }
function setup() {
  const contexts = [], calls = []
  const registry = new AgentHarnessRegistry().register({ descriptor, storageNamespace: 'synthetic', create(context) {
    contexts.push(context)
    return {
      adapterId: 'synthetic', capabilities: descriptor.capabilities,
      account: async () => ({ account: null, requiresAuthentication: false }),
      models: async () => [{ id: 'example-model', isDefault: true }],
      login: async method => ({ method, loginId: 'example-login', authUrl: 'https://example.invalid/login' }),
      cancelLogin: async id => { calls.push(['cancelLogin', id]) }, logout: async () => { calls.push(['logout']) },
      async streamChat(params) {
        params.onEvent({ type: 'start' })
        const result = await params.executeTool({ toolName: 'list_recipes', toolCallId: 'call', toolInput: {}, abortSignal: params.abortSignal || new AbortController().signal })
        params.onEvent({ type: 'tool_result', tool_name: 'list_recipes', tool_result: result })
        params.onEvent({ type: 'text_delta', content: 'Example reply' })
        params.onEvent({ type: 'done' })
        return { threadId: 'example-thread', turnId: 'example-turn', status: 'completed' }
      },
      cancelTurn: async () => { calls.push(['cancelTurn']) }, close: () => { calls.push(['close']) },
    }
  } })
  return { registry, contexts, calls }
}
const params = { systemPrompt: 'Brew', message: 'List', availableTools: [{ name: 'list_recipes', inputSchema: { type: 'object' } }], executeTool: async () => ({ success: true, content: '[]' }), onEvent: () => {} }

test('an independent adapter has isolated homes and unified account/model/login/tool stream/cancel lifecycle', async () => {
  const { registry, contexts, calls } = setup()
  const a = registry.create('synthetic', userA, '/tmp/application'), b = registry.create('synthetic', userB, '/tmp/application')
  assert.deepEqual(contexts.map(context => context.home), [`/tmp/application/synthetic/${userA}`, `/tmp/application/synthetic/${userB}`])
  assert.equal((await a.account()).requiresAuthentication, false)
  assert.deepEqual(await a.models(), [{ id: 'example-model', isDefault: true }])
  assert.equal((await a.login()).method, 'example')
  const events = [], tools = []
  const result = await a.streamChat({ ...params, model: 'example-model', onEvent: event => events.push(event), executeTool: async call => { tools.push(call); return { success: true, content: '[]' } } })
  assert.equal(result.status, 'completed')
  assert.deepEqual(events.map(event => event.type), ['start', 'tool_result', 'text_delta', 'done'])
  assert.equal(tools[0].toolName, 'list_recipes')
  assert.equal(tools[0].abortSignal.aborted, false)
  await a.cancelTurn(); await a.cancelLogin('example-login'); await a.logout(); a.close(); b.close()
  assert.deepEqual(calls.slice(0, 3), [['cancelTurn'], ['cancelLogin', 'example-login'], ['logout']])
})

test('unknown adapters never fall back, and only Codex is registered in production', () => {
  const { registry, contexts } = setup()
  assert.throws(() => registry.create('codex', userA, '/tmp/application'), /not installed/)
  assert.throws(() => registry.descriptor('removed'), /not installed/)
  assert.equal(contexts.length, 0)
  assert.deepEqual(listAgentAdapters().map(adapter => adapter.id), ['codex'])
  assert.throws(() => registry.create('synthetic', '../owner', '/tmp/application'), /authenticated user/)
  assert.throws(() => registry.create('synthetic', userA, '.runtime'), /absolute application/)
})

test('capability guard rejects unsupported settings and never invokes a different runtime', async () => {
  const { registry } = setup()
  const harness = registry.create('synthetic', userA, '/tmp/application')
  harness.capabilities.reasoningEffort = true
  assert.throws(() => harness.login('deviceCode'), /sign-in method/)
  for (const extra of [{ reasoningEffort: 'high' }, { showReasoning: true }, { verbosity: 'low' }, { persistent: true }, { threadId: 'saved-thread' }]) assert.throws(() => harness.streamChat({ ...params, ...extra }), /does not/)
  const snapshot = registry.list(); snapshot[0].capabilities.verbosity.push('high')
  assert.deepEqual(registry.descriptor('synthetic').capabilities.verbosity, [])
  assert.throws(() => registry.register({ descriptor, storageNamespace: '../escape', create: () => harness }), /Invalid adapter/)
})

test('live catalog and adapter capabilities validate preferences without Codex model assumptions', () => {
  const models = [{ id: 'example-model', isDefault: true }]
  assert.deepEqual(validateAgentPreferences({ model: 'example-model' }, descriptor, models), { model: 'example-model', reasoningEffort: null, verbosity: null })
  for (const input of [{ model: 'removed' }, { reasoningEffort: 'high' }, { verbosity: 'low' }, { verbosity: 1 }, []]) assert.throws(() => validateAgentPreferences(input, descriptor, models))
  const adjustable = { ...descriptor, capabilities: { ...descriptor.capabilities, reasoningEffort: true, verbosity: ['high'] } }
  const adjustableModels = [{ id: 'example-model', supportedReasoningEfforts: [{ reasoningEffort: 'careful', description: 'Careful' }] }]
  assert.deepEqual(validateAgentPreferences({ model: 'example-model', reasoningEffort: 'careful', verbosity: 'high' }, adjustable, adjustableModels), { model: 'example-model', reasoningEffort: 'careful', verbosity: 'high' })
  assert.throws(() => validateAgentPreferences({ reasoningEffort: 'low' }, adjustable, adjustableModels), /selected reasoning effort/)
  assert.match(installationAgentContext(descriptor), /active agent adapter is Synthetic/)
  assert.match(installationAgentContext(descriptor), /SQLite/)
})

test('the generic stream preserves adapter errors and cancellation signals', async () => {
  const { registry } = setup()
  const harness = registry.create('synthetic', userA, '/tmp/application')
  await assert.rejects(harness.streamChat({ ...params, executeTool: async () => { throw new Error('Example operation failed') } }), /Example operation failed/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(harness.streamChat({ ...params, abortSignal: abort.signal, executeTool: async call => { assert.equal(call.abortSignal.aborted, true); throw new Error('cancelled') } }), /cancelled/)
})


test('optional persistent operations are capability-driven at the generic registry boundary', async () => {
  const calls = []
  const { registry } = setup()
  const original = registry.create('synthetic', userA, '/tmp/application')
  assert.equal(original.compactThread, undefined)
  assert.equal(original.deleteThread, undefined)
  registry.register({ descriptor: { ...descriptor, id: 'persistent-example', capabilities: { ...descriptor.capabilities, persistentThreads: true, contextCompaction: true, automaticCompaction: true } }, storageNamespace: 'persistent-example', create: () => ({ ...original, adapterId: 'persistent-example', compactThread: async params => { calls.push(['compact', params.threadId]); params.onEvent?.({ type: 'context_compacted' }) }, deleteThread: async id => { calls.push(['delete', id]) } }) })
  const harness = registry.create('persistent-example', userA, '/tmp/application')
  const events = []
  await harness.compactThread({ threadId: 'example-thread', onEvent: event => events.push(event) })
  await harness.deleteThread('example-thread')
  assert.deepEqual(calls, [['compact', 'example-thread'], ['delete', 'example-thread']])
  assert.deepEqual(events, [{ type: 'context_compacted' }])
})
