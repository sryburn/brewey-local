import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { ReadableStream } from 'node:stream/web'
import ChatContainer from './chat-container'
import useChatStore from '@/lib/stores/chat-store'
import type { Message } from '@/types/chat'
import type { FileAttachment } from '@/types/attachments'

const mockTriggerRefreshDetails = jest.fn().mockResolvedValue(undefined)
const mockIncrementalProcessUpdate = jest.fn()
const mockSwitchToRecipe = jest.fn().mockResolvedValue(undefined)
const mockNativeImport = jest.fn()
const mockLoadUserRecipes = jest.fn().mockResolvedValue(undefined)
const mockSetSelectedRecipe = jest.fn()
let mockCurrentUser = { id: 'test-user', user_metadata: {} }
let mockOnSendMessage: ((message: string, file?: FileAttachment) => Promise<void>) | undefined
jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mockCurrentUser }) }))
jest.mock('@/lib/utils/native-import', () => ({ importNativeRecipe: (...args: unknown[]) => mockNativeImport(...args) }))
jest.mock('@/lib/utils/file-processing', () => ({ isNativeBreweyFormat: (content: string) => content === 'native-test' }))
jest.mock('@/lib/hooks/useMobile', () => ({ useMobile: () => false }))
jest.mock('@/lib/debug-logger', () => ({ debugLogger: new Proxy({}, { get: () => jest.fn() }) }))
jest.mock('@/lib/debug', () => ({ debug: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } }))
jest.mock('@/lib/stores/recipe-store', () => ({ useRecipeStore: Object.assign(() => ({
  triggerRefreshDetails: mockTriggerRefreshDetails, updateSingleMashStep: mockIncrementalProcessUpdate, updateSingleFermentationStep: mockIncrementalProcessUpdate, removeSingleMashStep: mockIncrementalProcessUpdate, removeSingleFermentationStep: mockIncrementalProcessUpdate,
  userRecipes: [], loading: false, setUserId: jest.fn(), switchToRecipe: mockSwitchToRecipe,
}), { getState: () => ({ loadUserRecipes: mockLoadUserRecipes, setSelectedRecipe: mockSetSelectedRecipe }) }) }))
jest.mock('./chat-input', () => ({ __esModule: true, default: function MockChatInput({ onSendMessage, isStreaming }: { onSendMessage: (message: string, file?: FileAttachment) => Promise<void>; isStreaming: boolean }) {
  mockOnSendMessage = onSendMessage
  return <>
    <button disabled={isStreaming} onClick={() => { void onSendMessage('Hello') }}>Send message</button>
    <button onClick={() => { void onSendMessage('Import', { id: 'file-1', name: 'recipe.brewey', type: 'text', size: 11, content: 'native-test', mimeType: 'application/json' }) }}>Import native</button>
  </>
} }))
jest.mock('./assistant-message', () => ({ __esModule: true, default: ({ message }: { message: Message }) => <div data-testid="assistant">{message.content}</div> }))
jest.mock('./user-message', () => ({ __esModule: true, default: ({ message }: { message: Message }) => <div>{message.content}</div> }))
jest.mock('./system-message', () => ({ __esModule: true, default: ({ message }: { message: Message }) => <div>{message.content}</div> }))
jest.mock('./action-message', () => ({ __esModule: true, default: () => null }))

function response(events: unknown[], status = 200) {
  const chunks = events.map(event => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  return {
    ok: status === 200, status, statusText: '',
    json: async () => ({ error: 'Connect your ChatGPT account in Chat settings before chatting.' }),
    body: new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close() } }),
  }
}

let mockChatFetch: jest.Mock
function conversation() {
  return { id: `${mockCurrentUser.id}-general`, recipes: [], title: 'Saved chat', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), compactedAt: null, running: false }
}

beforeEach(() => {
  mockCurrentUser = { id: 'test-user', user_metadata: {} }
  mockOnSendMessage = undefined
  mockChatFetch = jest.fn()
  global.fetch = jest.fn((path: string, options?: { method?: string }) => {
    if (path === '/api/chat') return mockChatFetch(path, options)
    const current = conversation()
    const data = path === '/api/conversations/current' ? current : path === '/api/conversations' ? [current] : {
      conversation: current, messages: useChatStore.getState().messages.map(message => ({ ...message, timestamp: message.timestamp.toISOString() })), hasMore: false, nextBefore: null,
    }
    return Promise.resolve({ ok: true, json: async () => ({ data }) })
  }) as typeof fetch
  mockNativeImport.mockReset()
  mockLoadUserRecipes.mockClear()
  mockSetSelectedRecipe.mockClear()
  act(() => useChatStore.getState().clearAll())
  mockSwitchToRecipe.mockClear()
  mockTriggerRefreshDetails.mockClear()
  mockIncrementalProcessUpdate.mockClear()
})
afterEach(() => { jest.restoreAllMocks() })

it('sends the current account’s chat preferences and uses updated preferences on the next message', async () => {
  mockCurrentUser = { id: 'test-user', user_metadata: { codexModel: 'model-one', codexReasoningEffort: 'high', codexVerbosity: 'low' } }
  mockChatFetch = jest.fn().mockResolvedValue(response([{ type: 'done' }]))
  const view = render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByText('Send message')).toBeEnabled())
  expect(JSON.parse(mockChatFetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({ model: 'model-one', reasoningEffort: 'high', verbosity: 'low' }))
  mockCurrentUser = { id: 'test-user', user_metadata: { codexModel: 'model-one', codexReasoningEffort: 'low', codexVerbosity: 'high' } }
  view.rerender(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByText('Send message')).toBeEnabled())
  expect(JSON.parse(mockChatFetch.mock.calls.at(-1)[1].body)).toEqual(expect.objectContaining({ reasoningEffort: 'low', verbosity: 'high' }))
})

it('shows an operational SSE error and releases the streaming input', async () => {
  mockChatFetch = jest.fn().mockResolvedValue(response([{ type: 'error', error: 'ChatGPT model limit reached.' }]))
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByTestId('assistant')).toHaveTextContent('Error: ChatGPT model limit reached.'))
  expect(screen.getByText('Send message')).toBeEnabled()
  expect(useChatStore.getState().messages.at(-1)?.metadata?.isStreaming).toBe(false)
})

it('keeps partial output and displays unexpected EOF without leaving streaming active', async () => {
  mockChatFetch = jest.fn().mockResolvedValue(response([{ type: 'text', content: 'Partial brewing answer.' }]))
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByTestId('assistant')).toHaveTextContent('The chat connection closed before the response completed.'))
  expect(screen.getByTestId('assistant')).toHaveTextContent('Partial brewing answer.')
  expect(screen.getByText('Send message')).toBeEnabled()
})

it('displays the route error for a preflight 409 response', async () => {
  mockChatFetch = jest.fn().mockResolvedValue(response([], 409))
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByTestId('assistant')).toHaveTextContent('Connect your ChatGPT account in Chat settings before chatting.'))
  expect(screen.getByText('Send message')).toBeEnabled()
  expect(mockChatFetch).toHaveBeenCalledTimes(1) // Never replay a duplicate/busy turn.
})

it('uses adapter tool events to select the recipe pane and complete normally', async () => {
  const recipeId = 'b82247c4-bfc4-4bf2-a8a0-81a244277e6f'
  mockChatFetch = jest.fn().mockResolvedValue(response([
    { type: 'tool_call', tool_id: 'call-1', tool_name: 'select_recipe', tool_args: { recipe_id: recipeId } },
    { type: 'tool_result', tool_id: 'call-1', tool_name: 'select_recipe', content: 'Selected recipe', tool_result: { success: true, recipe: { id: recipeId } } },
    { type: 'text', content: 'Recipe selected.' },
    { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } },
  ]))
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByTestId('assistant')).toHaveTextContent('Recipe selected.'))
  expect(mockSwitchToRecipe).toHaveBeenCalledWith(recipeId)
  expect(useChatStore.getState().currentRecipeContext).toBe(recipeId)
  expect(useChatStore.getState().conversation?.id).toBe('test-user-general')
  expect(screen.getByText('Send message')).toBeEnabled()
  expect(screen.getByTestId('assistant')).not.toHaveTextContent('Error:')
})

function deferred<T>() {
  let resolve!: (result: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

it('aborts on an identity switch and ignores the previous account’s late fetch response', async () => {
  const pending = deferred<ReturnType<typeof response>>()
  const fetchMock = jest.fn().mockReturnValue(pending.promise)
  mockChatFetch = fetchMock
  const view = render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
  mockCurrentUser = { id: 'other-user', user_metadata: {} }
  act(() => useChatStore.getState().clearAll())
  view.rerender(<ChatContainer />)
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(response([
    { type: 'text', content: 'Previous account private recipe.' },
    { type: 'tool_call', tool_id: 'old-call', tool_name: 'select_recipe', tool_args: {} },
    { type: 'tool_result', tool_id: 'old-call', tool_name: 'select_recipe', tool_result: { success: true, recipe: { id: 'old-recipe' } } },
    { type: 'done', usage: {} },
  ])))
  expect(useChatStore.getState().messages).toEqual([])
  expect(mockSwitchToRecipe).not.toHaveBeenCalled()
  expect(useChatStore.getState().currentRecipeContext).toBeNull()
})

it('a new account request cannot revive an old aborted SSE stream', async () => {
  let oldStream!: import('node:stream/web').ReadableStreamDefaultController<Uint8Array>
  const oldResponse = response([])
  oldResponse.body = new ReadableStream({ start(controller) { oldStream = controller } })
  const fetchMock = jest.fn().mockResolvedValueOnce(oldResponse).mockResolvedValueOnce(response([
    { type: 'text', content: 'New account answer.' }, { type: 'done', usage: {} },
  ]))
  mockChatFetch = fetchMock
  const view = render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  mockCurrentUser = { id: 'other-user', user_metadata: {} }
  act(() => useChatStore.getState().clearAll())
  view.rerender(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByTestId('assistant')).toHaveTextContent('New account answer.'))
  await act(async () => {
    oldStream.enqueue(new TextEncoder().encode('data: {"type":"system_message","content":"Old account private content"}\n\n'))
  })
  expect(useChatStore.getState().messages).toHaveLength(2)
  expect(screen.queryByText('Old account private content')).not.toBeInTheDocument()
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  expect(screen.getByText('Send message')).toBeEnabled()
})

it('does not set new-account recipe context after an old-account recipe switch resolves', async () => {
  const pendingSwitch = deferred<void>()
  mockSwitchToRecipe.mockReturnValueOnce(pendingSwitch.promise)
  const recipeId = 'b82247c4-bfc4-4bf2-a8a0-81a244277e6f'
  mockChatFetch = jest.fn().mockResolvedValue(response([
    { type: 'tool_call', tool_id: 'call-1', tool_name: 'select_recipe', tool_args: { recipe_id: recipeId } },
    { type: 'tool_result', tool_id: 'call-1', tool_name: 'select_recipe', tool_result: { success: true, recipe: { id: recipeId } } },
    { type: 'text', content: 'Old selection.' }, { type: 'done', usage: {} },
  ]))
  const view = render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(mockSwitchToRecipe).toHaveBeenCalledWith(recipeId))
  mockCurrentUser = { id: 'other-user', user_metadata: {} }
  act(() => useChatStore.getState().clearAll())
  view.rerender(<ChatContainer />)
  await act(async () => pendingSwitch.resolve())
  expect(useChatStore.getState().messages).toEqual([])
  expect(useChatStore.getState().currentRecipeContext).toBeNull()
})

it('ignores native-import results after identity switch', async () => {
  const pending = deferred<{ success: boolean; recipeId: string; recipeName: string }>()
  mockNativeImport.mockReturnValueOnce(pending.promise)
  const view = render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Import native'))
  await waitFor(() => expect(mockNativeImport).toHaveBeenCalledWith('native-test', 'test-user'))
  mockCurrentUser = { id: 'other-user', user_metadata: {} }
  act(() => useChatStore.getState().clearAll())
  view.rerender(<ChatContainer />)
  await act(async () => pending.resolve({ success: true, recipeId: 'old-recipe', recipeName: 'Private import' }))
  expect(useChatStore.getState().messages).toEqual([])
  expect(useChatStore.getState().currentRecipeContext).toBeNull()
})

it('aborts on unmount and does not restore messages from a late response', async () => {
  const pending = deferred<ReturnType<typeof response>>()
  const fetchMock = jest.fn().mockReturnValueOnce(pending.promise)
  mockChatFetch = fetchMock
  const view = render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  view.unmount()
  expect(useChatStore.getState().messages.at(-1)?.metadata?.isStreaming).toBe(false)
  act(() => useChatStore.getState().clearAll())
  await act(async () => pending.resolve(response([{ type: 'system_message', content: 'Late unmounted response' }])))
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  expect(useChatStore.getState().messages).toEqual([])
})

it.each([
  ['add_mash_step_to_recipe', 'mash_step', 'add'],
  ['update_mash_step_in_recipe', 'mash_step', 'update'],
  ['remove_mash_step_from_recipe', 'mash_step', 'remove'],
  ['add_fermentation_step_to_recipe', 'fermentation_step', 'add'],
  ['update_fermentation_step_in_recipe', 'fermentation_step', 'update'],
  ['remove_fermentation_step_from_recipe', 'fermentation_step', 'remove'],
])('reloads the complete process after %s so reordered sibling steps are refreshed', async (tool, kind, action) => {
  const recipeId = 'b82247c4-bfc4-4bf2-a8a0-81a244277e6f'
  act(() => useChatStore.getState().setCurrentRecipeContext(recipeId))
  const result = action === 'remove'
    ? { success: true, recipe_id: recipeId, removed_item: { id: 'step', type: kind } }
    : { success: true, recipe_id: recipeId, [`recipe_${kind}`]: { id: 'step', recipe_id: recipeId, step_order: 1 } }
  mockChatFetch = jest.fn().mockResolvedValue(response([
    { type: 'tool_call', tool_id: 'process-1', tool_name: tool, tool_args: { recipe_id: recipeId } },
    { type: 'tool_result', tool_id: 'process-1', tool_name: tool, tool_result: result },
    { type: 'done' },
  ]))
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(mockTriggerRefreshDetails).toHaveBeenCalledWith(recipeId))
  expect(mockIncrementalProcessUpdate).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByText('Send message')).toBeEnabled())
})

it('uses the selected adapter preferences and never leaks legacy Codex choices into another adapter', async () => {
  mockCurrentUser = { id: 'test-user', user_metadata: { agentAdapter: 'future-adapter', agentPreferences: { 'future-adapter': { model: 'native-model', reasoningEffort: 'low', verbosity: 'medium' } }, codexModel: 'legacy-codex', codexReasoningEffort: 'high', codexVerbosity: 'high' } }
  mockChatFetch = jest.fn().mockResolvedValue(response([{ type: 'done' }]))
  const view = render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByText('Send message')).toBeEnabled())
  expect(JSON.parse(mockChatFetch.mock.calls.at(-1)[1].body)).toEqual(expect.objectContaining({ model: 'native-model', reasoningEffort: 'low', verbosity: 'medium' }))
  mockCurrentUser = { id: 'test-user', user_metadata: { agentAdapter: 'future-adapter', codexModel: 'legacy-codex', codexReasoningEffort: 'high', codexVerbosity: 'high' } }
  view.rerender(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByText('Send message')).toBeEnabled())
  const next = JSON.parse(mockChatFetch.mock.calls.at(-1)[1].body)
  expect(next.model).toBeUndefined(); expect(next.reasoningEffort).toBeUndefined(); expect(next.verbosity).toBeUndefined()
})


it('uses durable SSE message IDs and sends no client transcript', async () => {
  mockChatFetch = jest.fn().mockResolvedValue(response([
    { type: 'conversation', conversation_id: 'test-user-general', user_message_id: 'saved-user-message', assistant_message_id: 'saved-assistant-message', turn_id: 'saved-turn' },
    { type: 'text', content: 'Saved answer' }, { type: 'done' },
  ]))
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Send message'))
  await waitFor(() => expect(screen.getByTestId('assistant')).toHaveTextContent('Saved answer'))
  expect(useChatStore.getState().messages.map(m => m.id)).toEqual(['saved-user-message', 'saved-assistant-message'])
  const payload = JSON.parse(mockChatFetch.mock.calls[0][1].body)
  expect(payload.conversationId).toBe('test-user-general')
  expect(payload.requestId).toEqual(expect.any(String))
  expect(payload.conversationHistory).toBeUndefined()
})

it('persists explicit native-import activity without file contents and preserves the active conversation', async () => {
  mockNativeImport.mockResolvedValue({ success: true, recipeId: 'imported-recipe', recipeName: 'Imported IPA' })
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  fireEvent.click(screen.getByText('Import native'))
  await waitFor(() => expect(mockSetSelectedRecipe).toHaveBeenCalledWith('imported-recipe'))
  const note = (fetch as jest.Mock).mock.calls.find(call => String(call[0]).endsWith('/note'))
  expect(JSON.parse(note[1].body)).toEqual({ content: 'Imported recipe: Imported IPA' })
  expect(note[1].body).not.toContain('native-test')
  expect(mockChatFetch).not.toHaveBeenCalled()
  expect(useChatStore.getState().conversation?.id).toBe('test-user-general')
  expect(useChatStore.getState().currentRecipeContext).toBe('imported-recipe')
})

const nativeFile: FileAttachment = { id: 'stale-file', name: 'recipe.brewey', type: 'text', size: 11, content: 'native-test', mimeType: 'application/json' }

it.each([
  ['account', false], ['account', true],
  ['conversation', false], ['conversation', true],
] as const)('rejects a stale send callback after a %s change (native import=%s)', async (change, importing) => {
  mockChatFetch.mockResolvedValue(response([{ type: 'text', content: 'Should never send.' }, { type: 'done' }]))
  mockNativeImport.mockResolvedValue({ success: true, recipeId: 'should-not-import', recipeName: 'Unexpected import' })
  const view = render(<ChatContainer />)
  await waitFor(() => {
    expect(useChatStore.getState().conversation).not.toBeNull()
    expect(useChatStore.getState().conversationLoading).toBe(false)
  })
  const staleSend = mockOnSendMessage!
  const originalId = useChatStore.getState().conversation!.id
  if (change === 'account') {
    mockCurrentUser = { id: 'other-user', user_metadata: {} }
    act(() => useChatStore.getState().clearAll())

  } else {
    act(() => useChatStore.setState({ conversation: { ...useChatStore.getState().conversation!, id: 'different-saved-chat' } }))
  }
  view.rerender(<ChatContainer />)
  await waitFor(() => {
    expect(useChatStore.getState().conversation).not.toBeNull()
    expect(useChatStore.getState().conversation!.id).not.toBe(originalId)
    expect(useChatStore.getState().conversationLoading).toBe(false)
  })
  const messagesBefore = useChatStore.getState().messages
  const conversationBefore = useChatStore.getState().conversation!.id
  await act(async () => { await staleSend('Stale request', importing ? nativeFile : undefined) })
  expect(mockChatFetch).not.toHaveBeenCalled()
  expect(mockNativeImport).not.toHaveBeenCalled()
  expect(mockSetSelectedRecipe).not.toHaveBeenCalled()
  expect(useChatStore.getState().messages).toEqual(messagesBefore)
  expect(useChatStore.getState().conversation?.id).toBe(conversationBefore)
  expect(useChatStore.getState().isTyping).toBe(false)
})

it('rejects a native import callback while a turn is already typing without interrupting it', async () => {
  mockNativeImport.mockResolvedValue({ success: true, recipeId: 'should-not-import', recipeName: 'Unexpected import' })
  render(<ChatContainer />)
  await waitFor(() => {
    expect(useChatStore.getState().conversation).not.toBeNull()
    expect(useChatStore.getState().conversationLoading).toBe(false)
  })
  const send = mockOnSendMessage!
  act(() => useChatStore.getState().setTyping(true))
  const messagesBefore = useChatStore.getState().messages
  await act(async () => { await send('Import', nativeFile) })
  expect(mockNativeImport).not.toHaveBeenCalled()
  expect(mockChatFetch).not.toHaveBeenCalled()
  expect(mockSetSelectedRecipe).not.toHaveBeenCalled()
  expect(useChatStore.getState().messages).toEqual(messagesBefore)
  expect(useChatStore.getState().isTyping).toBe(true)
})

it('uses the currently previewed recipe independently of saved recipe activities', async () => {
  mockChatFetch.mockResolvedValue(response([{ type: 'done' }]))
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversationLoading).toBe(false))
  act(() => useChatStore.setState({ currentRecipeContext: 'currently-previewed', conversation: { ...useChatStore.getState().conversation!, recipes: [{ recipeId: 'old-recipe', recipeTitle: 'Old IPA', deleted: true, activities: ['historical'] }] } }))
  await act(async () => { await mockOnSendMessage!('Continue this discussion') })
  const payload = JSON.parse(mockChatFetch.mock.calls[0][1].body)
  expect(payload.currentRecipeId).toBe('currently-previewed')
  expect(payload.conversationId).toBe('test-user-general')
})

it('recipe preview changes keep an active turn running and affect only the next request context', async () => {
  let stream!: import('node:stream/web').ReadableStreamDefaultController<Uint8Array>
  const streaming = response([])
  streaming.body = new ReadableStream({ start(controller) { stream = controller } })
  mockChatFetch.mockResolvedValueOnce(streaming)
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  act(() => useChatStore.getState().setCurrentRecipeContext('first-preview'))
  let pending!: Promise<void>
  act(() => { pending = mockOnSendMessage!('Explain this recipe') })
  await waitFor(() => expect(mockChatFetch).toHaveBeenCalledTimes(1))
  const signal = mockChatFetch.mock.calls[0][1].signal as AbortSignal
  act(() => useChatStore.getState().setCurrentRecipeContext('second-preview'))
  expect(signal.aborted).toBe(false)
  expect(useChatStore.getState().isTyping).toBe(true)
  expect(useChatStore.getState().conversation?.id).toBe('test-user-general')
  await act(async () => {
    stream.enqueue(new TextEncoder().encode('data: {"type":"text","content":"First recipe answer"}\n\ndata: {"type":"done"}\n\n'))
    stream.close()
    await pending
  })
  expect(screen.getByTestId('assistant')).toHaveTextContent('First recipe answer')
  mockChatFetch.mockResolvedValue(response([{ type: 'done' }]))
  await act(async () => { await mockOnSendMessage!('Now discuss this one') })
  expect(JSON.parse(mockChatFetch.mock.calls[0][1].body).currentRecipeId).toBe('first-preview')
  expect(JSON.parse(mockChatFetch.mock.calls[1][1].body).currentRecipeId).toBe('second-preview')
})

it('preserves a reader’s position during remote message updates and resumes following at the bottom', async () => {
  render(<ChatContainer />)
  await waitFor(() => expect(useChatStore.getState().conversation).not.toBeNull())
  const pane = screen.getByLabelText('Chat history')
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 200 })
  const answer: Message = { id: 'remote-answer', type: 'assistant', content: 'First remote text', timestamp: new Date() }
  act(() => useChatStore.setState({ messages: [answer], conversation: { ...useChatStore.getState().conversation!, running: true } }))
  const scroll = jest.spyOn(Element.prototype, 'scrollIntoView')
  scroll.mockClear()
  pane.scrollTop = 400
  fireEvent.scroll(pane)
  act(() => useChatStore.setState({ messages: [{ ...answer, content: 'Updated remote text' }] }))
  expect(scroll).not.toHaveBeenCalled()
  pane.scrollTop = 800
  fireEvent.scroll(pane)
  act(() => useChatStore.setState({ messages: [{ ...answer, content: 'Latest remote text' }] }))
  expect(scroll).toHaveBeenCalledTimes(1)
})
