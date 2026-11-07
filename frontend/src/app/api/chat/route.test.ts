/** @jest-environment node */
import { POST } from './route'
const mockStream = jest.fn()
const mockAccount = jest.fn()
const mockModels = jest.fn()
const conversationId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const mockGet = jest.fn()
const mockBeginTurn = jest.fn()
const mockContext = jest.fn()
const mockCallTool = jest.fn()
const mockRecordRecipeActivity = jest.fn()
const mockHeartbeat = jest.fn()
const mockAdapter = { id: 'synthetic', displayName: 'Independent adapter', accountLabel: 'Example', description: 'Test', capabilities: { loginMethods: [], modelCatalog: true, streaming: true, brewingTools: true, cancellation: true, reasoningEffort: false, reasoningSummaries: false, verbosity: [] } }
const mockSelection = { adapterId: 'synthetic', preferences: { model: 'independent-model', reasoningEffort: null, verbosity: null } }
jest.mock('@/lib/server-session', () => ({ requireSameOrigin: jest.fn(), requireSession: async () => ({ user: { id: 'user', user_metadata: { chatSettings: { showReasoning: true } } } }), HttpError: class extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }, errorResponse: (error: Error & { status?: number }) => Response.json({ error: error.message }, { status: error.status || 500 }) }))
jest.mock('@/lib/user-harness', () => ({ getUserAgentSelection: () => mockSelection, getUserHarness: () => ({ adapterId: 'synthetic', capabilities: mockAdapter.capabilities, account: mockAccount, models: mockModels, streamChat: mockStream }) }))
jest.mock('@/lib/harness/registry', () => ({ getAgentAdapter: () => mockAdapter }))
jest.mock('@/lib/server/application-service', () => ({ applicationForUser: () => ({ getProfile: () => ({ profile: 'Synthetic brewer' }) }) }))
jest.mock('@/lib/server/brewing-service', () => ({ listBrewingTools: () => ['get_recipe_by_id', 'update_recipe'].map(name => ({ name, inputSchema: { type: 'object', properties: { recipe_id: { type: 'string' } }, required: ['recipe_id'] } })), callBrewingTool: (...args: unknown[]) => mockCallTool(...args) }))
jest.mock('@/lib/server/chat-recipe-updates', () => ({ canonicalRecipeToolResult: jest.fn() }))
jest.mock('@/lib/server/conversations', () => ({ conversationsForUser: () => ({ get: mockGet, getContext: mockContext, beginTurn: mockBeginTurn, heartbeat: mockHeartbeat, recordRecipeActivity: mockRecordRecipeActivity }) }))
jest.mock('@/lib/server/conversation-chat', () => ({ runConversationChat: (params: unknown) => mockStream(params) }))
function request(body: Record<string, unknown> = {}) { return new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, requestId, message: 'Help brew', ...body }) }) }
beforeEach(() => {
  mockGet.mockReset().mockReturnValue({ conversation: { id: conversationId, recipeId: null } })
  mockBeginTurn.mockReset().mockReturnValue({ turnId: 'turn', userMessageId: 'user-message', assistantMessageId: 'assistant-message', replayed: false })
  mockContext.mockReset().mockReturnValue({ messages: [], summary: null, contextRevision: 0, lastSequence: 0 })
  mockCallTool.mockReset().mockImplementation(async (_user, _name, args) => ({ content: [{ type: 'text', text: JSON.stringify({ success: true, recipe: { id: args.recipe_id, name: 'Selected beer' } }) }] }))
  mockRecordRecipeActivity.mockReset()
  mockHeartbeat.mockReset()
  mockAccount.mockReset().mockResolvedValue({ account: null, requiresAuthentication: false })
  mockModels.mockReset().mockResolvedValue([{ id: 'independent-model', isDefault: true }])
  mockStream.mockReset().mockImplementation(async params => { params.onEvent({ type: 'done' }); return { status: 'completed' } })
})
test('chat uses the selected generic adapter, stored preferences, shared profile and installation context', async () => {
  const response = await POST(request())
  expect(response.status).toBe(200)
  await response.text()
  expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({ model: 'independent-model', verbosity: undefined, reasoningEffort: undefined, showReasoning: false }))
  expect(mockStream.mock.calls[0][0].systemPrompt).toContain('active agent adapter is Independent adapter')
  expect(mockStream.mock.calls[0][0].systemPrompt).toContain('Brewer profile: Synthetic brewer')
})
test('authentication instruction names the selected adapter account and does not start chat', async () => {
  mockAccount.mockResolvedValue({ account: null, requiresAuthentication: true })
  const response = await POST(request())
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'Connect your Example account in Chat settings before chatting.' })
  expect(mockStream).not.toHaveBeenCalled()
})
test('unsupported preference fails before opening the stream with no runtime fallback', async () => {
  const response = await POST(request({ verbosity: 'high' }))
  expect(response.status).toBe(400)
  expect((await response.json()).error).toMatch(/does not support the selected verbosity/)
  expect(mockStream).not.toHaveBeenCalled()
})

test('client transcript and ownership arguments are rejected before inference', async () => {
  for (const body of [{ conversationHistory: [] }, { userId: 'another' }, { threadId: 'native' }]) {
    expect((await POST(request(body))).status).toBe(400)
  }
  expect(mockStream).not.toHaveBeenCalled()
})
test('an inaccessible conversation cannot start inference', async () => {
  mockGet.mockImplementation(() => { throw Object.assign(new Error('Conversation not found.'), { status: 404 }) })
  expect((await POST(request())).status).toBe(404)
  expect(mockAccount).not.toHaveBeenCalled()
  expect(mockStream).not.toHaveBeenCalled()
})
test('replayed request never executes another agent turn', async () => {
  mockBeginTurn.mockReturnValue({ replayed: true })
  expect((await POST(request())).status).toBe(409)
  expect(mockStream).not.toHaveBeenCalled()
})
test('context is read after the turn claim and asynchronous model validation', async () => {
  mockModels.mockImplementation(async () => {
    mockContext.mockReturnValue({ messages: [{ content: 'Other device finished' }], lastSequence: 2 })
    return [{ id: 'independent-model', isDefault: true }]
  })
  const response = await POST(request())
  await response.text()
  expect(mockStream.mock.calls[0][0].context.lastSequence).toBe(2)
  expect(mockContext.mock.invocationCallOrder[0]).toBeGreaterThan(mockBeginTurn.mock.invocationCallOrder[0])
})

test('current selection supplies context and turn metadata independently of historical recipe association', async () => {
  const currentRecipeId = '33333333-3333-4333-8333-333333333333'
  mockGet.mockReturnValue({ conversation: { id: conversationId, recipes: [{ recipeId: 'old-recipe', recipeTitle: 'Old beer', activities: ['historical'] }] } })
  const response = await POST(request({ currentRecipeId }))
  await response.text()
  expect(mockCallTool).toHaveBeenCalledWith('user', 'get_recipe_by_id', { recipe_id: currentRecipeId })
  expect(mockBeginTurn).toHaveBeenCalledWith(conversationId, expect.objectContaining({ selectedRecipeId: currentRecipeId }))
  expect(mockStream.mock.calls[0][0].systemPrompt).toContain('independent of recipe selection')
  expect(mockStream.mock.calls[0][0].systemPrompt).toContain(currentRecipeId)
  expect(mockStream.mock.calls[0][0].systemPrompt).not.toContain('old-recipe')
  // Context preload is represented by selected, not an agent read.
  expect(mockRecordRecipeActivity).not.toHaveBeenCalled()
})

test('without selection the agent is told explicitly, even when the history involves a recipe', async () => {
  mockGet.mockReturnValue({ conversation: { id: conversationId, recipes: [{ recipeId: 'old-recipe' }] } })
  const response = await POST(request())
  await response.text()
  expect(mockStream.mock.calls[0][0].systemPrompt).toContain('No recipe is currently selected')
  expect(mockCallTool).not.toHaveBeenCalled()
})

test('tool tracking uses resolved selection and only successful core results', async () => {
  const currentRecipeId = '33333333-3333-4333-8333-333333333333'
  mockStream.mockImplementation(async params => {
    await params.executeTool({ toolName: 'update_recipe', toolInput: {}, abortSignal: new AbortController().signal })
    mockCallTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: '{"success":false}' }] })
    await params.executeTool({ toolName: 'update_recipe', toolInput: { recipe_id: 'inaccessible' }, abortSignal: new AbortController().signal })
  })
  const response = await POST(request({ currentRecipeId }))
  await response.text()
  expect(mockRecordRecipeActivity).toHaveBeenCalledTimes(1)
  expect(mockRecordRecipeActivity).toHaveBeenCalledWith('turn', currentRecipeId, 'modified')
})

test('unowned current recipe fails before accepting a turn or storing selected metadata', async () => {
  mockCallTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: '{"success":false}' }] })
  expect((await POST(request({ currentRecipeId: '33333333-3333-4333-8333-333333333333' }))).status).toBe(404)
  expect(mockBeginTurn).not.toHaveBeenCalled()
  expect(mockStream).not.toHaveBeenCalled()
})
