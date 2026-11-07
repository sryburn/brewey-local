import useChatStore from './chat-store'
import { useRecipeStore } from './recipe-store'
import type { Conversation, ConversationPage } from '@/types/conversation'

const chat = (id = 'general-chat', recipeId: string | null = null): Conversation => ({ id, recipes: recipeId ? [{ recipeId, recipeTitle: 'Test IPA', deleted: false, activities: ['historical'] }] : [], title: 'Saved conversation', status: 'active', createdAt: '2026-10-03T01:00:00Z', updatedAt: '2026-10-03T01:00:00Z', compactedAt: null, running: false })
const page = (conversation: Conversation, text = 'Saved answer', sequence = 2): ConversationPage => ({ conversation, messages: [{ id: `${conversation.id}-${sequence}`, type: 'assistant', content: text, timestamp: conversation.createdAt, sequence, turnId: null }], hasMore: false, nextBefore: null })
const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const state = () => useChatStore.getState()

beforeEach(() => { state().clearAll(); useRecipeStore.setState({ userId: 'owner', selectedRecipeId: 'current-preview' }); localStorage.clear() })
afterEach(() => jest.restoreAllMocks())

it('loads only authoritative history and never reads or writes legacy browser transcripts', async () => {
  localStorage.setItem('brewey-chat-storage', JSON.stringify({ state: { messages: [{ content: 'Unverified old history' }] } }))
  const writes = jest.spyOn(Storage.prototype, 'setItem')
  const current = chat()
  global.fetch = jest.fn(async (url: string) => reply(url.endsWith('/current') ? current : url === '/api/conversations' ? [current] : page(current))) as unknown as typeof fetch
  await state().initializeConversations('owner')
  expect(state().messages.map(m => m.content)).toEqual(['Saved answer'])
  expect(localStorage.getItem('brewey-chat-storage')).toBeFalsy()
  expect(state().messages[0].timestamp).toBeInstanceOf(Date)
  state().addMessage({ type: 'system', content: 'Temporary local notice' })
  expect(writes).not.toHaveBeenCalled()
})

it('drops old-account reads and automatically loads the new account after a pending request', async () => {
  const pending = deferred<ReturnType<typeof reply>>()
  const old = chat('old-account')
  const current = chat('new-account')
  global.fetch = jest.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async (url: string) => reply(url.endsWith('/current') ? current : url === '/api/conversations' ? [current] : page(current, 'New account history')))
  const first = state().initializeConversations('old')
  state().clearAll()
  await state().initializeConversations('new')
  pending.resolve(reply(old))
  await first
  // The invalidated request schedules a fresh read for the latest verified identity.
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(state().sessionUserId).toBe('new')
  expect(state().conversation?.id).toBe('new-account')
  expect(state().messages.map(m => m.content)).toEqual(['New account history'])
})

it('a recipe preview change leaves the global conversation and pending history read intact', async () => {
  const pending = deferred<ReturnType<typeof reply>>()
  const current = chat()
  global.fetch = jest.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async (url: string) => reply(url === '/api/conversations' ? [current] : page(current)))
  const initial = state().initializeConversations('owner')
  state().setCurrentRecipeContext('recipe-preview')
  pending.resolve(reply(current)); await initial
  expect(state().conversation?.id).toBe(current.id)
  expect(state().currentRecipeContext).toBe('recipe-preview')
  expect(state().messages.map(message => message.content)).toEqual(['Saved answer'])
  expect(fetch).toHaveBeenCalledWith('/api/conversations/current', expect.any(Object))
})


it('new chat sends no recipe association and preserves the current recipe preview', async () => {
  const next = chat('new-chat')
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat(), currentRecipeContext: 'preview-recipe' })
  global.fetch = jest.fn(async (url: string, options: RequestInit) => reply(options.method === 'POST' || url.endsWith('/current') ? next : url === '/api/conversations' ? [next] : page(next))) as unknown as typeof fetch
  await state().newConversation()
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({})
  expect(state().conversation?.id).toBe(next.id)
  expect(state().currentRecipeContext).toBe('preview-recipe')
})


it('pages older messages without duplicates and does not compact or delete the transcript locally', async () => {
  const current = chat()
  useChatStore.setState({ sessionUserId: 'owner', conversation: current, messages: page(current).messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })), hasOlderMessages: true, nextBefore: 2 })
  global.fetch = jest.fn().mockResolvedValue(reply({ ...page(current, 'Older answer', 1), messages: [...page(current, 'Older answer', 1).messages, ...page(current).messages] }))
  await state().loadOlderMessages()
  expect(state().messages.map(m => m.sequence)).toEqual([1, 2])
  expect((fetch as jest.Mock).mock.calls[0][0]).toBe('/api/conversations/general-chat?before=2&limit=100')
})

it('refreshes shared current and busy state after another device changes it', async () => {
  const current = { ...chat('other-device-chat'), running: true }
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat() })
  global.fetch = jest.fn(async (url: string) => reply(url.endsWith('/current') ? current : url === '/api/conversations' ? [current] : page(current))) as unknown as typeof fetch
  await state().refreshConversation()
  expect(state().conversation?.id).toBe('other-device-chat')
  expect(state().conversation?.running).toBe(true)
  ;(fetch as jest.Mock).mockClear()
  await state().newConversation(); await state().compactConversation(); await state().deleteConversation()
  expect(fetch).not.toHaveBeenCalled()
})

it('idle polling cannot replace a local stream after its fetch began', async () => {
  const pending = deferred<ReturnType<typeof reply>>()
  const current = chat()
  useChatStore.setState({ sessionUserId: 'owner', conversation: current })
  global.fetch = jest.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async (url: string) => reply(url === '/api/conversations' ? [current] : page(current, 'Old snapshot')))
  const refresh = state().refreshConversation()
  state().setTyping(true)
  state().addMessage({ type: 'assistant', content: 'Live partial output', metadata: { isStreaming: true } })
  pending.resolve(reply(current)); await refresh
  expect(state().messages.map(m => m.content)).toEqual(['Live partial output'])
})

it('idle refresh retains older pages already loaded for this conversation', async () => {
  const current = chat()
  useChatStore.setState({ sessionUserId: 'owner', conversation: current, messages: [1, 2].map(sequence => ({ ...page(current, `Answer ${sequence}`, sequence).messages[0], timestamp: new Date(current.createdAt) })), hasOlderMessages: false, nextBefore: null })
  global.fetch = jest.fn(async (url: string) => reply(url.endsWith('/current') ? current : url === '/api/conversations' ? [current] : { ...page(current, 'Refreshed answer', 2), hasMore: true, nextBefore: 2 })) as unknown as typeof fetch
  await state().refreshConversation()
  expect(state().messages.map(m => m.sequence)).toEqual([1, 2])
  expect(state().messages[1].content).toBe('Refreshed answer')
  expect(state().hasOlderMessages).toBe(false)
})

it('compaction invokes the server and reloads the retained transcript', async () => {
  const current = { ...chat(), compactedAt: '2026-10-03T02:00:00Z' }
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat() })
  global.fetch = jest.fn(async (url: string) => reply(url.endsWith('/compact') ? { conversation: current } : url.endsWith('/current') ? current : url === '/api/conversations' ? [current] : page(current, 'Full transcript still saved'))) as unknown as typeof fetch
  await state().compactConversation()
  expect((fetch as jest.Mock).mock.calls[0]).toEqual(['/api/conversations/general-chat/compact', expect.objectContaining({ method: 'POST' })])
  expect(state().conversation?.compactedAt).toBe(current.compactedAt)
  expect(state().messages[0].content).toBe('Full transcript still saved')
})

it('historical deleted-recipe chats activate normally without changing the current recipe preview', async () => {
  const historical = { ...chat('deleted-chat'), recipes: [{ recipeId: 'deleted-recipe', recipeTitle: 'Archived IPA', deleted: true, activities: ['historical' as const] }] }
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat(), currentRecipeContext: 'current-preview' })
  global.fetch = jest.fn(async (url: string) => reply(url.endsWith('/activate') || url.endsWith('/current') ? historical : url === '/api/conversations' ? [historical] : page(historical, 'Historical recipe chat'))) as unknown as typeof fetch
  await state().selectConversation(historical.id)
  expect(state().conversation?.recipes[0].deleted).toBe(true)
  expect(state().messages[0].content).toBe('Historical recipe chat')
  expect(state().currentRecipeContext).toBe('current-preview')
  expect(fetch).toHaveBeenCalledWith('/api/conversations/deleted-chat/activate', expect.objectContaining({ method: 'POST' }))
})

it('explicit resume restores the server-selected recipe once; later refreshes preserve manual selection', async () => {
  const resumed = { ...chat('resumed'), resumeRecipeId: 'last-selected-recipe' }
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat(), currentRecipeContext: 'current-preview' })
  global.fetch = jest.fn(async (url: string) => reply(url.endsWith('/activate') || url.endsWith('/current') ? resumed : url === '/api/conversations' ? [resumed] : page(resumed))) as unknown as typeof fetch
  await state().selectConversation(resumed.id)
  expect(useRecipeStore.getState().selectedRecipeId).toBe('last-selected-recipe')
  expect(state().currentRecipeContext).toBe('last-selected-recipe')
  useRecipeStore.getState().setSelectedRecipe('manual-next-selection')
  state().setCurrentRecipeContext('manual-next-selection')
  await state().refreshConversation()
  expect(state().conversation?.id).toBe('resumed')
  expect(state().currentRecipeContext).toBe('manual-next-selection')
  expect(useRecipeStore.getState().selectedRecipeId).toBe('manual-next-selection')
})

it.each(['missing', 'failed', 'account-change', 'newer-selection'])('resume preserves the current preview for %s', async reason => {
  const pending = deferred<ReturnType<typeof reply>>()
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat(), currentRecipeContext: 'current-preview' })
  global.fetch = jest.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async (url: string) => reply(url.endsWith('/current') ? chat('resumed') : url === '/api/conversations' ? [] : page(chat('resumed'))))
  const selecting = state().selectConversation('resumed')
  if (reason === 'account-change') { state().clearAll(); useRecipeStore.setState({ userId: 'other' }) }
  if (reason === 'newer-selection') state().setCurrentRecipeContext('newer-preview')
  pending.resolve(reason === 'failed' ? { ok: false, json: async () => ({ error: 'Unable to activate' }) } as unknown as ReturnType<typeof reply> : reply({ ...chat('resumed'), resumeRecipeId: reason === 'missing' ? null : 'last-selected-recipe' }))
  await selecting
  expect(useRecipeStore.getState().selectedRecipeId).toBe('current-preview')
  expect(state().currentRecipeContext).toBe(reason === 'account-change' ? null : reason === 'newer-selection' ? 'newer-preview' : 'current-preview')
})


it('a deleted recipe activity stays historical and does not make the global conversation read-only', async () => {
  const current = { ...chat(), recipes: [{ recipeId: 'deleted-recipe', recipeTitle: 'Deleted porter', deleted: true, activities: ['historical' as const] }] }
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat(), currentRecipeContext: 'preview-recipe' })
  global.fetch = jest.fn(async (url: string) => reply(url.endsWith('/compact') ? { conversation: current } : url.endsWith('/current') ? current : url === '/api/conversations' ? [current] : page(current))) as unknown as typeof fetch
  await state().refreshConversation()
  await state().compactConversation()
  expect(fetch).toHaveBeenCalledWith('/api/conversations/general-chat/compact', expect.objectContaining({ method: 'POST' }))
  expect(state().currentRecipeContext).toBe('preview-recipe')
  expect(state().conversation?.recipes[0].deleted).toBe(true)
})


it('searches saved content across all chats and keeps matches separate from idle history refreshes', async () => {
  const current = chat(), match = { ...chat('body-match'), title: 'Different title' }
  useChatStore.setState({ sessionUserId: 'owner', conversation: current })
  global.fetch = jest.fn(async (url: string) => reply(url.includes('q=') ? [match] : url.endsWith('/current') ? current : url === '/api/conversations' ? [current] : page(current))) as unknown as typeof fetch
  await state().searchConversations('  dry hop & aroma  ')
  expect(fetch).toHaveBeenCalledWith('/api/conversations?q=dry+hop+%26+aroma', expect.objectContaining({ credentials: 'same-origin' }))
  expect(state().historySearchResults).toEqual([match])
  await state().refreshConversation()
  expect(state().conversations).toEqual([current])
  expect(state().historySearchResults).toEqual([match])
  await state().searchConversations('aroma')
  expect(fetch).toHaveBeenCalledWith('/api/conversations?q=aroma', expect.any(Object))
})

it('search ignores an older query after the latest query finishes', async () => {
  const old = deferred<ReturnType<typeof reply>>()
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat() })
  global.fetch = jest.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(reply([chat('latest-match')]))
  const first = state().searchConversations('old query')
  await state().searchConversations('latest query')
  old.resolve(reply([chat('stale-match')]))
  await first
  expect(state().historySearchQuery).toBe('latest query')
  expect(state().historySearchResults?.map(item => item.id)).toEqual(['latest-match'])
  expect(state().historySearchLoading).toBe(false)
})

it.each(['panel closed', 'account changed'])('search discards responses after %s', async reason => {
  const pending = deferred<ReturnType<typeof reply>>()
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat() })
  global.fetch = jest.fn().mockReturnValue(pending.promise)
  const search = state().searchConversations('private phrase')
  if (reason === 'panel closed') state().cancelConversationSearch()
  else { state().clearAll(); useChatStore.setState({ sessionUserId: 'other-owner' }) }
  pending.resolve(reply([chat('stale-private-result')]))
  await search
  expect(state().historySearchResults).toBeNull()
  expect(state().historySearchLoading).toBe(false)
  expect(state().historySearchError).toBeNull()
})

it('deleted recipe search matches activate like every other saved chat', async () => {
  const historical = { ...chat('deleted-search-result'), recipes: [{ recipeId: 'deleted-recipe', recipeTitle: 'Deleted porter', deleted: true, activities: ['historical' as const] }] }
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat(), conversations: [chat()], currentRecipeContext: 'current-preview' })
  global.fetch = jest.fn(async (url: string) => reply(url.includes('q=') || url === '/api/conversations' ? [historical] : url.endsWith('/activate') || url.endsWith('/current') ? historical : page(historical))) as unknown as typeof fetch
  await state().searchConversations('old note')
  await state().selectConversation(historical.id)
  expect(state().conversation?.id).toBe(historical.id)
  expect(state().currentRecipeContext).toBe('current-preview')
  expect(fetch).toHaveBeenCalledWith('/api/conversations/deleted-search-result/activate', expect.objectContaining({ method: 'POST' }))
})


it('persists a normalized rename without changing conversation identity or transcript', async () => {
  const current = chat(), renamed = { ...current, title: 'Porter planning' }
  const messages = page(current).messages.map(message => ({ ...message, timestamp: new Date(message.timestamp) }))
  useChatStore.setState({ sessionUserId: 'owner', conversation: current, conversations: [current], messages })
  global.fetch = jest.fn().mockResolvedValue(reply(renamed))
  await state().renameConversation('  Porter\n planning  ')
  expect(fetch).toHaveBeenCalledWith('/api/conversations/general-chat', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Porter planning' }) }))
  expect(state().conversation).toEqual(renamed)
  expect(state().conversations[0].title).toBe('Porter planning')
  expect(state().messages).toEqual(messages)
  expect(state().operationPending).toBe(false)
})

it.each(['account changed', 'conversation changed'])('a pending rename cannot update cache after %s', async reason => {
  const pending = deferred<ReturnType<typeof reply>>()
  useChatStore.setState({ sessionUserId: 'owner', conversation: chat() })
  global.fetch = jest.fn().mockReturnValue(pending.promise)
  const rename = state().renameConversation('Old account title')
  if (reason === 'account changed') state().clearAll()
  useChatStore.setState({ conversation: chat('new-selection'), sessionUserId: reason === 'account changed' ? 'new-owner' : 'owner' })
  pending.resolve(reply({ ...chat(), title: 'Old account title' }))
  await rename
  expect(state().conversation?.id).toBe('new-selection')
  expect(state().conversation?.title).toBe('Saved conversation')
  expect(state().operationPending).toBe(false)
})

it('allows idle deleted history to be renamed, while invalid titles and busy chats make no request', async () => {
  const deleted = { ...chat(), recipes: [{ recipeId: 'deleted-recipe', recipeTitle: 'Deleted porter', deleted: true, activities: ['historical' as const] }], status: 'archived' as const }
  useChatStore.setState({ sessionUserId: 'owner', conversation: deleted })
  global.fetch = jest.fn().mockResolvedValue(reply({ ...deleted, title: 'Historical porter' }))
  await state().renameConversation('Historical porter')
  expect(state().conversation?.title).toBe('Historical porter')
  ;(fetch as jest.Mock).mockClear()
  await state().renameConversation('   ')
  expect(state().conversationError).toBe('Enter a chat title.')
  await state().renameConversation('🍺'.repeat(51))
  expect(state().conversationError).toMatch(/shorter title/)
  useChatStore.setState({ conversation: { ...deleted, running: true } })
  await state().renameConversation('Busy chat')
  expect(fetch).not.toHaveBeenCalled()
})
