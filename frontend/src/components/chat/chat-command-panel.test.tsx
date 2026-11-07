import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatCommandPanel from './chat-command-panel'
import useChatStore from '@/lib/stores/chat-store'
import type { Conversation } from '@/types/conversation'

const current: Conversation = { id: 'general-chat', recipes: [], title: 'General discussion', status: 'active', createdAt: '2026-10-03T01:00:00Z', updatedAt: '2026-10-03T01:00:00Z', compactedAt: null, running: false }
const earlier: Conversation = { ...current, id: 'earlier-chat', title: 'Earlier porter', status: 'archived', recipes: [{ recipeId: 'recipe-one', recipeTitle: 'Porter', deleted: false, activities: ['historical'] }] }
const deleted: Conversation = { ...earlier, id: 'deleted-chat', title: 'Deleted recipe discussion', recipes: [{ recipeId: 'recipe-one', recipeTitle: 'Porter', deleted: true, activities: ['historical'] }] }
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const page = (conversation: Conversation) => response({ conversation, messages: [], hasMore: false, nextBefore: null })

beforeEach(() => {
  useChatStore.getState().clearAll()
  useChatStore.setState({ sessionUserId: 'owner', conversation: current, conversations: [current, earlier, deleted] })
  global.fetch = jest.fn().mockResolvedValue(response([]))
})
afterEach(() => jest.restoreAllMocks())

it('searches owned history across all chats without scope controls', async () => {
  global.fetch = jest.fn().mockImplementation((path: string) => Promise.resolve(response(path.includes('q=porter') ? [earlier] : [])))
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  fireEvent.change(screen.getByLabelText('Search saved chats'), { target: { value: 'porter' } })
  expect(await screen.findByText('Earlier porter')).toBeInTheDocument()
  expect(screen.queryByText('General discussion')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search saved chats'), { target: { value: 'absent' } })
  expect(await screen.findByText('No chats match your search.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Current scope' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'All chats' })).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/conversations?q=porter', expect.any(Object))
})


it('awaits successful activation and transcript loading before closing', async () => {
  let resolveActivation!: (value: ReturnType<typeof response>) => void
  const activated = { ...earlier, status: 'active' as const }
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path.endsWith('/activate')) return new Promise(resolve => { resolveActivation = resolve })
    if (path === '/api/conversations/current') return Promise.resolve(response(activated))
    if (path.startsWith('/api/conversations/earlier-chat?')) return Promise.resolve(page(activated))
    return Promise.resolve(response([activated]))
  })
  const onClose = jest.fn()
  render(<ChatCommandPanel action="resume" onClose={onClose} />)
  fireEvent.click(screen.getByText('Earlier porter'))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Loading saved chat')
  await act(async () => { resolveActivation(response(activated)) })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(useChatStore.getState().conversation?.id).toBe(earlier.id)
  expect(fetch).toHaveBeenCalledWith('/api/conversations/earlier-chat/activate', expect.objectContaining({ method: 'POST', body: '{}' }))
})

it('keeps a failed resume open and shows the server error', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Chat is busy.' }) })
  const onClose = jest.fn()
  render(<ChatCommandPanel action="resume" onClose={onClose} />)
  fireEvent.click(screen.getByText('Earlier porter'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Chat is busy.')
  expect(onClose).not.toHaveBeenCalled()
  expect(useChatStore.getState().conversation?.id).toBe(current.id)
})

it('keeps search focused and its query intact while a resume fails', async () => {
  let rejectActivation!: (value: { ok: boolean; status: number; json: () => Promise<{ error: string }> }) => void
  global.fetch = jest.fn().mockImplementation((path: string) => path.includes('q=') ? Promise.resolve(response([earlier])) : new Promise(resolve => { rejectActivation = resolve }))
  const onClose = jest.fn()
  render(<ChatCommandPanel action="resume" onClose={onClose} />)
  const search = screen.getByRole('searchbox', { name: 'Search saved chats' })
  fireEvent.change(search, { target: { value: 'porter' } })
  const choice = (await screen.findByText('Earlier porter')).closest('button')!
  choice.focus()
  fireEvent.click(choice)
  expect(choice).toBeDisabled()
  expect(search).toBeEnabled()
  expect(search).toHaveFocus()
  await act(async () => { rejectActivation({ ok: false, status: 409, json: async () => ({ error: 'Chat is busy.' }) }) })
  expect(await screen.findByRole('alert')).toHaveTextContent('Chat is busy.')
  expect(search).toHaveFocus()
  expect(search).toHaveValue('porter')
  expect(choice).toBeEnabled()
  expect(onClose).not.toHaveBeenCalled()
})

it('retains search focus through an asynchronous content search', async () => {
  let resolveSearch!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation(() => new Promise(resolve => { resolveSearch = resolve }))
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox', { name: 'Search saved chats' })
  fireEvent.change(search, { target: { value: 'porter' } })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(search).toHaveFocus()
  expect(search).toBeEnabled()
  await act(async () => { resolveSearch(response([earlier])) })
  expect(await screen.findByText('Earlier porter')).toBeInTheDocument()
  expect(search).toHaveFocus()
  expect(search).toHaveValue('porter')
})

it('moves the active descendant with arrows, skips running chats, wraps, and resumes Enter without moving search focus', async () => {
  const running = { ...earlier, running: true }
  useChatStore.setState({ conversations: [current, running, deleted] })
  const activated = { ...deleted, status: 'active' as const }
  let resolveActivation!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path.endsWith('/activate')) return new Promise(resolve => { resolveActivation = resolve })
    if (path === '/api/conversations/current') return Promise.resolve(response(activated))
    if (path.startsWith('/api/conversations/deleted-chat?')) return Promise.resolve(page(activated))
    return Promise.resolve(response([activated]))
  })
  const scroll = jest.spyOn(Element.prototype, 'scrollIntoView')
  scroll.mockClear()
  const onClose = jest.fn()
  render(<ChatCommandPanel action="resume" onClose={onClose} />)
  const search = screen.getByRole('searchbox')
  const choices = screen.getAllByRole('option')
  expect(search).not.toHaveAttribute('aria-activedescendant')
  expect(search).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(choices[0]).toHaveAttribute('aria-selected', 'true')
  expect(search).toHaveAttribute('aria-activedescendant', choices[0].id)
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(choices[1]).toBeDisabled()
  expect(choices[1]).toHaveAttribute('aria-selected', 'false')
  expect(choices[2]).toHaveAttribute('aria-selected', 'true')
  expect(choices[2]).toHaveClass('ring-1')
  expect(search).toHaveFocus()
  expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
  expect(scroll.mock.contexts.at(-1)).toBe(choices[2])
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(choices[0]).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(search, { key: 'ArrowUp' })
  expect(choices[2]).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(search, { key: 'Enter' })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/api/conversations/deleted-chat/activate', expect.objectContaining({ method: 'POST' }))
  expect(search).toHaveFocus()
  expect(search).not.toHaveAttribute('aria-activedescendant')
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { resolveActivation(response(activated)) })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

it('requires an explicit choice and ignores IME arrows and Enter while keeping Escape available', () => {
  const onClose = jest.fn()
  render(<ChatCommandPanel action="resume" onClose={onClose} />)
  const search = screen.getByRole('searchbox')
  fireEvent.keyDown(search, { key: 'Enter' })
  fireEvent.keyDown(search, { key: 'ArrowDown', isComposing: true })
  expect(search).not.toHaveAttribute('aria-activedescendant')
  fireEvent.keyDown(search, { key: 'ArrowUp' })
  expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(search, { key: 'Enter', keyCode: 229 })
  expect(fetch).not.toHaveBeenCalled()
  expect(search).toHaveFocus()
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('invalidates keyboard selection during a new query and delayed search instead of resuming an old match', async () => {
  let resolveOld!: (value: ReturnType<typeof response>) => void
  let resolveFresh!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation((path: string) => new Promise(resolve => {
    if (path.includes('q=old')) resolveOld = resolve
    else resolveFresh = resolve
  }))
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox')
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(search).toHaveAttribute('aria-activedescendant')
  fireEvent.change(search, { target: { value: 'old' } })
  expect(search).not.toHaveAttribute('aria-activedescendant')
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  fireEvent.change(search, { target: { value: 'fresh' } })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  await act(async () => { resolveOld(response([earlier])) })
  expect(screen.queryByText('Earlier porter')).not.toBeInTheDocument()
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).toHaveBeenCalledTimes(2)
  await act(async () => { resolveFresh(response([deleted])) })
  expect(screen.getByText('Deleted recipe discussion')).toBeInTheDocument()
  expect(search).not.toHaveAttribute('aria-activedescendant')
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).toHaveBeenCalledTimes(2)
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
  expect(search).toHaveFocus()
})

it('clears selected IDs on changed results and account changes rather than activating the same row index', () => {
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox')
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(search).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id)
  act(() => { useChatStore.setState({ conversations: [deleted, current] }) })
  expect(search).not.toHaveAttribute('aria-activedescendant')
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  act(() => { useChatStore.setState({ sessionUserId: 'another-owner' }) })
  expect(search).not.toHaveAttribute('aria-activedescendant')
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
  act(() => { useChatStore.getState().clearAll() })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
})

it('preserves the highlighted ID through equivalent idle poll arrays and clears it when that chat starts running', () => {
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox')
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  const selectedId = screen.getAllByRole('option')[1].id
  act(() => { useChatStore.setState({ conversations: [current, earlier, deleted].map(chat => ({ ...chat })) }) })
  expect(search).toHaveAttribute('aria-activedescendant', selectedId)
  expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  act(() => { useChatStore.setState({ conversations: [current, { ...earlier, running: true }, deleted] }) })
  expect(search).not.toHaveAttribute('aria-activedescendant')
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
  expect(search).toHaveFocus()
})

it.each(['isTyping', 'conversationLoading', 'operationPending', 'remote'] as const)('invalidates keyboard selection when %s becomes busy', condition => {
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox')
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  act(() => { useChatStore.setState(condition === 'remote' ? { conversation: { ...current, running: true } } : { [condition]: true }) })
  expect(search).not.toHaveAttribute('aria-activedescendant')
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
  act(() => { useChatStore.setState(condition === 'remote' ? { conversation: current } : { [condition]: false }) })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(search).toHaveAttribute('aria-activedescendant')
})

it('preserves native Tab focus and Enter activation on clickable history choices', async () => {
  const user = userEvent.setup()
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Chat is busy.' }) })
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox')
  await user.tab()
  expect(screen.getAllByRole('option')[0]).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('Chat is busy.')
  expect(fetch).toHaveBeenCalledWith('/api/conversations/general-chat/activate', expect.objectContaining({ method: 'POST' }))
  expect(search).toHaveFocus()
})


it('resumes deleted-recipe history normally without selecting its recipe', async () => {
  const activated = { ...deleted, status: 'active' as const }
  useChatStore.setState({ currentRecipeContext: 'selected-preview' })
  global.fetch = jest.fn().mockImplementation((path: string) => Promise.resolve(path.endsWith('/activate') || path === '/api/conversations/current' ? response(activated) : path.startsWith('/api/conversations/deleted-chat?') ? page(activated) : response([activated])))
  const onClose = jest.fn()
  render(<ChatCommandPanel action="resume" onClose={onClose} />)
  expect(screen.getByText('Porter · Deleted · historical')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Deleted recipe discussion'))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(fetch).toHaveBeenCalledWith('/api/conversations/deleted-chat/activate', expect.objectContaining({ method: 'POST' }))
  expect(useChatStore.getState().currentRecipeContext).toBe('selected-preview')
  expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument()
})


it('does not delete on opening and invalidates its original confirmation whenever the exact chat changes', () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Native cleanup failed.' }) })
  const onClose = jest.fn()
  render(<ChatCommandPanel action="delete" onClose={onClose} />)
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByText('Confirm delete')).toBeEnabled()
  act(() => useChatStore.setState({ conversation: earlier }))
  expect(screen.getByText('Confirm delete')).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('selected chat changed')
  expect(screen.getByText('Chat ID: general-chat')).toBeInTheDocument()
  act(() => useChatStore.setState({ conversation: current }))
  expect(screen.getByText('Confirm delete')).toBeDisabled()
  fireEvent.click(screen.getByText('Confirm delete'))
  expect(fetch).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('keeps failed native deletion open with its error', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Native cleanup failed.' }) })
  const onClose = jest.fn()
  render(<ChatCommandPanel action="delete" onClose={onClose} />)
  fireEvent.click(screen.getByText('Confirm delete'))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/conversations/general-chat', expect.objectContaining({ method: 'DELETE' })))
  expect(await screen.findByRole('alert')).toHaveTextContent('Native cleanup failed.')
  expect(onClose).not.toHaveBeenCalled()
})

it('closes only after confirmed deletion succeeds and the replacement chat loads', async () => {
  const replacement = { ...current, id: 'replacement-chat', title: 'Fresh General chat' }
  global.fetch = jest.fn().mockImplementation((path: string, options: RequestInit) => {
    if (options.method === 'DELETE') return Promise.resolve(response(null))
    if (path === '/api/conversations/current') return Promise.resolve(response(replacement))
    if (path.startsWith('/api/conversations/replacement-chat?')) return Promise.resolve(page(replacement))
    return Promise.resolve(response([replacement]))
  })
  const onClose = jest.fn()
  render(<ChatCommandPanel action="delete" onClose={onClose} />)
  fireEvent.click(screen.getByText('Confirm delete'))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(useChatStore.getState().conversation?.id).toBe(replacement.id)
  expect(fetch).toHaveBeenCalledWith('/api/conversations/general-chat', expect.objectContaining({ method: 'DELETE' }))
})

it.each(['isTyping', 'conversationLoading', 'operationPending', 'remote'] as const)('blocks navigation and deletion while %s is busy', condition => {
  useChatStore.setState(condition === 'remote' ? { conversation: { ...current, running: true } } : { [condition]: true })
  const { rerender } = render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  expect(screen.getByText('Earlier porter').closest('button')).toBeDisabled()
  rerender(<ChatCommandPanel action="delete" onClose={jest.fn()} />)
  expect(screen.getByText('Confirm delete')).toBeDisabled()
  expect(fetch).not.toHaveBeenCalled()
})

it('shows recipe activities, running and compaction status in a labeled region and closes with Escape', () => {
  useChatStore.setState({ conversation: { ...deleted, running: true, compactedAt: current.createdAt } })
  const onClose = jest.fn()
  render(<ChatCommandPanel action="status" onClose={onClose} />)
  expect(screen.getByRole('region', { name: 'Chat status' })).toBeInTheDocument()
  expect(screen.getByText('Porter · Deleted · historical')).toBeInTheDocument()
  expect(screen.getByText('deleted-chat')).toBeInTheDocument()
  expect(screen.getByText('Running on another device')).toBeInTheDocument()
  expect(screen.getByText(/Full transcript retained/)).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('debounces content search and displays authoritative matches without locally filtering titles or activating a chat', async () => {
  const contentMatch = { ...earlier, title: 'Different discussion', recipes: [{ recipeId: 'stout', recipeTitle: 'Stout', deleted: false, activities: ['read' as const] }] }
  global.fetch = jest.fn().mockResolvedValue(response([contentMatch]))
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox', { name: 'Search saved chats' })
  fireEvent.change(search, { target: { value: 'partial' } })
  fireEvent.change(search, { target: { value: 'hidden brewing note' } })
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByText('General discussion')).not.toBeInTheDocument()
  expect(await screen.findByText('Different discussion')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/api/conversations?q=hidden+brewing+note', expect.any(Object))
  expect(search).toHaveFocus()
  expect(useChatStore.getState().conversation?.id).toBe(current.id)
})

it('ignores an earlier server search after the query changes and never exposes the mismatched result', async () => {
  let resolveEarlier!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation((path: string) => path.includes('q=old')
    ? new Promise(resolve => { resolveEarlier = resolve }) : Promise.resolve(response([earlier])))
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  const search = screen.getByRole('searchbox')
  fireEvent.change(search, { target: { value: 'old' } })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  fireEvent.change(search, { target: { value: 'fresh' } })
  expect(screen.queryByText('Earlier porter')).not.toBeInTheDocument()
  expect(await screen.findByText('Earlier porter')).toBeInTheDocument()
  await act(async () => { resolveEarlier(response([deleted])) })
  expect(screen.queryByText('Deleted recipe discussion')).not.toBeInTheDocument()
  expect(screen.getByText('Earlier porter')).toBeInTheDocument()
  expect(search).toHaveValue('fresh')
  expect(search).toHaveFocus()
})

it('shows multiple recipe activity tags and a content/recipe-name search hint without selecting any recipe', () => {
  const multiRecipe = { ...earlier, recipes: [earlier.recipes[0], { recipeId: 'ipa', recipeTitle: 'Weekend IPA', deleted: false, activities: ['selected' as const, 'read' as const, 'modified' as const] }] }
  useChatStore.setState({ conversations: [multiRecipe], currentRecipeContext: 'selected-preview' })
  render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  expect(screen.getByText('Porter · historical')).toBeInTheDocument()
  expect(screen.getByText('Weekend IPA · selected, read, modified')).toBeInTheDocument()
  expect(screen.getByRole('searchbox')).toHaveAccessibleDescription('Search titles, recipe names, chat IDs and saved message content. ↑/↓ choose a chat · Enter resume · Esc close')
  expect(useChatStore.getState().currentRecipeContext).toBe('selected-preview')
})


it('cancels pending server search results when the resume panel closes', async () => {
  let resolveSearch!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation(() => new Promise(resolve => { resolveSearch = resolve }))
  const view = render(<ChatCommandPanel action="resume" onClose={jest.fn()} />)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'private old note' } })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  view.unmount()
  await act(async () => { resolveSearch(response([earlier])) })
  expect(useChatStore.getState().historySearchResults).toBeNull()
  expect(useChatStore.getState().historySearchLoading).toBe(false)
  expect(useChatStore.getState().conversation?.id).toBe(current.id)
})

it('opens rename with the current title selected and saves Enter through the persisted store operation', async () => {
  const renamed = { ...current, title: 'Porter planning' }
  global.fetch = jest.fn().mockResolvedValue(response(renamed))
  const onClose = jest.fn()
  render(<ChatCommandPanel action="rename" onClose={onClose} />)
  const title = screen.getByRole('textbox', { name: 'New chat title' }) as HTMLInputElement
  expect(title).toHaveFocus()
  expect(title).toHaveValue(current.title)
  expect(title.selectionStart).toBe(0)
  expect(title.selectionEnd).toBe(current.title.length)
  fireEvent.change(title, { target: { value: '  Porter\t planning  ' } })
  fireEvent.keyDown(title, { key: 'Enter' })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(fetch).toHaveBeenCalledWith('/api/conversations/general-chat', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Porter planning' }) }))
  expect(useChatStore.getState().conversation?.id).toBe(current.id)
  expect(useChatStore.getState().conversation?.title).toBe('Porter planning')
})

it('keeps a failed rename open with its draft focused and allows retry', async () => {
  let rejectRename!: (value: { ok: boolean; status: number; json: () => Promise<{ error: string }> }) => void
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { rejectRename = resolve }))
    .mockResolvedValue(response({ ...current, title: 'My new title' }))
  const onClose = jest.fn()
  render(<ChatCommandPanel action="rename" onClose={onClose} />)
  const title = screen.getByRole('textbox', { name: 'New chat title' })
  fireEvent.change(title, { target: { value: 'My new title' } })
  const save = screen.getByRole('button', { name: 'Save title' })
  save.focus(); fireEvent.click(save)
  expect(title).toHaveFocus()
  expect(save).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Saving chat title')
  await act(async () => { rejectRename({ ok: false, status: 409, json: async () => ({ error: 'Chat is busy.' }) }) })
  expect(await screen.findByRole('alert')).toHaveTextContent('Chat is busy.')
  expect(title).toHaveValue('My new title')
  expect(title).toHaveFocus()
  expect(save).toBeEnabled()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.keyDown(title, { key: 'Enter' })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

it('invalidates a pending rename after an account change instead of applying its result or closing the new account panel', async () => {
  let resolveRename!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation(() => new Promise(resolve => { resolveRename = resolve }))
  const onClose = jest.fn()
  render(<ChatCommandPanel action="rename" onClose={onClose} />)
  const title = screen.getByRole('textbox', { name: 'New chat title' })
  fireEvent.change(title, { target: { value: 'Previous owner title' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
  act(() => { useChatStore.getState().clearAll(); useChatStore.setState({ sessionUserId: 'another-owner', conversation: earlier }) })
  expect(screen.getByRole('alert')).toHaveTextContent('chat or account changed')
  await act(async () => { resolveRename(response({ ...current, title: 'Previous owner title' })) })
  expect(useChatStore.getState().conversation?.id).toBe(earlier.id)
  expect(useChatStore.getState().conversation?.title).toBe(earlier.title)
  expect(screen.getByRole('button', { name: 'Save title' })).toBeDisabled()
  expect(onClose).not.toHaveBeenCalled()
})

it('rename handles Escape locally and ignores IME Enter without saving', () => {
  const onClose = jest.fn()
  render(<ChatCommandPanel action="rename" onClose={onClose} />)
  const title = screen.getByRole('textbox', { name: 'New chat title' })
  fireEvent.keyDown(title, { key: 'Enter', isComposing: true })
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.keyDown(title, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('closes after saving a canonically normalized Unicode title', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ...current, title: 'Café planning' }))
  const onClose = jest.fn()
  render(<ChatCommandPanel action="rename" onClose={onClose} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'New chat title' }), { target: { value: 'Cafe\u0301 planning' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save title' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(fetch).toHaveBeenCalledWith('/api/conversations/general-chat', expect.objectContaining({ body: JSON.stringify({ title: 'Café planning' }) }))
})
