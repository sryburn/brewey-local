import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useRef } from 'react'
import ChatInput from './chat-input'
import useChatStore from '@/lib/stores/chat-store'
import type { Conversation } from '@/types/conversation'
import type { Message } from '@/types/chat'

const mockPush = jest.fn()
const originalFetch = Object.getOwnPropertyDescriptor(global, 'fetch')
let mockMobile = false
let mockFinePointer = true
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/lib/hooks/useMobile', () => ({ useMobile: () => mockMobile, usePointerType: () => mockFinePointer }))
jest.mock('@/lib/hooks/useFileUpload', () => ({ useFileUpload: () => ({ uploadedFile: null, fileError: null, handleFileUpload: jest.fn(), removeUploadedFile: jest.fn(), clearFileError: jest.fn() }) }))
jest.mock('@/lib/debug', () => ({ debug: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } }))
jest.mock('@/lib/debug-logger', () => ({ debugLogger: new Proxy({}, { get: () => jest.fn() }) }))
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <div>{children}</div> }))

const conversation: Conversation = { id: 'saved-chat', recipes: [], title: 'Saved discussion', status: 'active', createdAt: '2026-10-03T01:00:00Z', updatedAt: '2026-10-03T01:00:00Z', compactedAt: null, running: false }
const savedMessage: Message = { id: 'saved-message', type: 'assistant', content: 'Saved brewing answer.', timestamp: new Date(conversation.createdAt), sequence: 1, turnId: null }
const input = () => screen.getByRole('textbox', { name: 'Chat message' })
const typeCommand = (command: string) => fireEvent.change(input(), { target: { value: command } })
const press = (key: string, extra: Record<string, unknown> = {}) => fireEvent.keyDown(input(), { key, ...extra })

beforeEach(() => {
  mockMobile = false
  mockFinePointer = true
  mockPush.mockClear()
  Object.defineProperty(global, 'fetch', { value: jest.fn(), configurable: true, writable: true })
  useChatStore.getState().clearAll()
  useChatStore.setState({ conversation, conversations: [conversation], sessionUserId: 'owner', messages: [savedMessage] })
})
afterEach(() => {
  jest.restoreAllMocks()
  if (originalFetch) Object.defineProperty(global, 'fetch', originalFetch)
  else Reflect.deleteProperty(global, 'fetch')
})

it('filters command names by prefix and resets the accessible selected option after editing', () => {
  render(<ChatInput onSendMessage={jest.fn()} />)
  typeCommand('/re')
  const list = screen.getByRole('listbox', { name: 'Slash commands' })
  expect(within(list).getAllByRole('option')).toHaveLength(3)
  expect(within(list).getByText('/resume')).toBeInTheDocument()
  expect(within(list).getByText('/rename')).toBeInTheDocument()
  expect(within(list).getByText('/reload')).toBeInTheDocument()
  expect(within(list).queryByText('/new')).not.toBeInTheDocument()
  press('ArrowDown')
  expect(input()).toHaveAttribute('aria-activedescendant', within(list).getByRole('option', { selected: true }).id)
  typeCommand('/relo')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('/reload')
})

it('Arrow navigation wraps, Tab completes without executing, and Enter runs the selected command', async () => {
  const send = jest.fn()
  render(<ChatInput onSendMessage={send} />)
  typeCommand('/re')
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('/resume')
  press('ArrowUp')
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('/reload')
  press('ArrowDown')
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('/resume')
  press('Tab')
  expect(input()).toHaveValue('/resume')
  expect(screen.queryByRole('heading', { name: 'Resume saved chat' })).not.toBeInTheDocument()
  press('Enter')
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Resume saved chat' })).toBeInTheDocument())
  expect(input()).toHaveValue('')
  expect(send).not.toHaveBeenCalled()
})

it('Escape dismisses suggestions without erasing the draft and edits reopen them', () => {
  render(<ChatInput onSendMessage={jest.fn()} />)
  typeCommand('/re')
  press('Escape')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(input()).toHaveValue('/re')
  expect(input()).not.toHaveAttribute('aria-activedescendant')
  typeCommand('/res')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
})

it('unknown slash commands stay local, report the error, and never become an inference request', async () => {
  const send = jest.fn()
  render(<ChatInput onSendMessage={send} />)
  typeCommand('/definitely-unknown')
  expect(screen.getByText(/No matching command/)).toBeInTheDocument()
  press('Enter')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unknown command'))
  expect(send).not.toHaveBeenCalled()
  expect(useChatStore.getState().messages).toEqual([savedMessage])
  expect(input()).toHaveValue('/definitely-unknown')
})

it('ignores composition Enter for both suggestions and ordinary messages', async () => {
  const send = jest.fn()
  render(<ChatInput onSendMessage={send} />)
  typeCommand('/resume')
  press('Enter', { isComposing: true })
  expect(screen.queryByRole('heading', { name: 'Resume saved chat' })).not.toBeInTheDocument()
  expect(input()).toHaveValue('/resume')
  typeCommand('日本語でレシピ')
  press('Enter', { isComposing: true })
  await act(async () => { await Promise.resolve() })
  expect(send).not.toHaveBeenCalled()
  expect(input()).toHaveValue('日本語でレシピ')
})

it('/help is removed from discovery and shortcuts; manual execution stays local', async () => {
  const send = jest.fn()
  render(<ChatInput onSendMessage={send} />)
  expect(screen.queryByRole('button', { name: '/help' })).not.toBeInTheDocument()
  typeCommand('/')
  expect(screen.queryByText('/help')).not.toBeInTheDocument()
  typeCommand('/help'); press('Enter')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unknown command'))
  expect(useChatStore.getState().messages).toEqual([savedMessage])
  expect(send).not.toHaveBeenCalled()
  expect(input()).toHaveFocus()
})

it('deleted recipe activity does not block ordinary messages or starting a new chat', async () => {
  useChatStore.setState({ conversation: { ...conversation, recipes: [{ recipeId: 'deleted-recipe', recipeTitle: 'Deleted IPA', deleted: true, activities: ['historical'] }] } })
  const send = jest.fn().mockResolvedValue(undefined), newChat = jest.fn().mockResolvedValue(undefined)
  render(<ChatInput onSendMessage={send} onClearHistory={newChat} />)
  typeCommand('Continue our discussion'); press('Enter')
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  typeCommand('/new'); press('Enter')
  await waitFor(() => expect(newChat).toHaveBeenCalledTimes(1))
})


it('mobile suggestion taps execute the same command without sending it to the agent', async () => {
  mockMobile = true
  mockFinePointer = false
  const send = jest.fn()
  const newChat = jest.fn().mockResolvedValue(undefined)
  render(<ChatInput onSendMessage={send} onClearHistory={newChat} />)
  typeCommand('/ne')
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('button', { name: /^\/new/ }))
  await waitFor(() => expect(newChat).toHaveBeenCalledTimes(1))
  expect(send).not.toHaveBeenCalled()
  expect(input()).toHaveValue('')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('desktop shortcuts and typed /new and /compact share the same dispatch callbacks', async () => {
  const send = jest.fn()
  const newChat = jest.fn().mockResolvedValue(undefined)
  const compact = jest.fn().mockResolvedValue(undefined)
  render(<ChatInput onSendMessage={send} onClearHistory={newChat} onCompact={compact} />)
  fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
  await waitFor(() => expect(newChat).toHaveBeenCalledTimes(1))
  typeCommand('/new'); press('Enter')
  await waitFor(() => expect(newChat).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
  await waitFor(() => expect(compact).toHaveBeenCalledTimes(1))
  typeCommand('/compact'); press('Enter')
  await waitFor(() => expect(compact).toHaveBeenCalledTimes(2))
  expect(send).not.toHaveBeenCalled()
})

function RemountingComposer() {
  const chat = useChatStore()
  const focusHandoffRef = useRef(false)
  return <ChatInput key={chat.conversation?.id || 'chat'} focusHandoffRef={focusHandoffRef} onSendMessage={jest.fn()} />
}

it.each([false, true])('focuses /resume search and returns to the composer on Escape (mobile=%s)', async mobile => {
  mockMobile = mobile
  mockFinePointer = !mobile
  render(<ChatInput onSendMessage={jest.fn()} />)
  typeCommand('/resume'); press('Enter')
  const search = await screen.findByRole('searchbox', { name: 'Search saved chats' })
  expect(search).toHaveFocus()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
  expect(search).toHaveFocus()
  fireEvent.change(search, { target: { value: 'discussion' } })
  expect(search).toHaveFocus()
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(input()).toHaveFocus()
})

it.each(['status', 'delete'])('focuses a safe control for /%s and restores the composer on close', async command => {
  render(<ChatInput onSendMessage={jest.fn()} />)
  typeCommand(`/${command}`); press('Enter')
  const close = await screen.findByRole('button', { name: 'Close command panel' })
  expect(close).toHaveFocus()
  fireEvent.click(close)
  expect(input()).toHaveFocus()
})

it.each([false, true])('retains focus across asynchronous history loading and the keyed composer replacement (mobile=%s)', async mobile => {
  mockMobile = mobile
  mockFinePointer = !mobile
  const earlier = { ...conversation, id: 'earlier-chat', title: 'Earlier porter', status: 'archived' as const }
  const activated = { ...earlier, status: 'active' as const }
  const response = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
  let resolveActivation!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path.endsWith('/activate')) return new Promise(resolve => { resolveActivation = resolve })
    if (path === '/api/conversations/current') return Promise.resolve(response(activated))
    if (path.startsWith('/api/conversations/earlier-chat?')) return Promise.resolve(response({ conversation: activated, messages: [], hasMore: false, nextBefore: null }))
    return Promise.resolve(response([activated]))
  })
  useChatStore.setState({ conversations: [conversation, earlier] })
  render(<RemountingComposer />)
  const oldInput = input()
  typeCommand('/resume'); press('Enter')
  const search = await screen.findByRole('searchbox')
  const choice = screen.getByText('Earlier porter').closest('button')!
  choice.focus()
  fireEvent.click(choice)
  expect(search).toHaveFocus()
  await act(async () => { resolveActivation(response(activated)) })
  await waitFor(() => expect(useChatStore.getState().conversation?.id).toBe(earlier.id))
  expect(oldInput).not.toBeInTheDocument()
  expect(input()).toHaveFocus()
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
})

it('does not open the mobile keyboard on an initial mount or steal focus from elsewhere on chat refresh', () => {
  mockMobile = true
  mockFinePointer = false
  render(<><button type="button">Recipe control</button><RemountingComposer /></>)
  expect(input()).not.toHaveFocus()
  const outside = screen.getByRole('button', { name: 'Recipe control' })
  outside.focus()
  act(() => useChatStore.setState({ conversation: { ...conversation, id: 'another-chat' } }))
  expect(outside).toHaveFocus()
})

it.each(['new', 'delete'])('retains mobile composer focus through an actual /%s request and replacement', async command => {
  mockMobile = true
  mockFinePointer = false
  const replacement = { ...conversation, id: `${command}-replacement`, title: 'Replacement chat' }
  const response = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
  let resolveMutation!: (value: ReturnType<typeof response>) => void
  let resolveCurrent!: (value: ReturnType<typeof response>) => void
  global.fetch = jest.fn().mockImplementation((path: string, options: RequestInit) => {
    if (options.method === 'POST' || options.method === 'DELETE') return new Promise(resolve => { resolveMutation = resolve })
    if (path === '/api/conversations/current') return new Promise(resolve => { resolveCurrent = resolve })
    if (path.startsWith(`/api/conversations/${replacement.id}?`)) return Promise.resolve(response({ conversation: replacement, messages: [], hasMore: false, nextBefore: null }))
    return Promise.resolve(response([replacement]))
  })
  render(<RemountingComposer />)
  const oldInput = input()
  typeCommand(`/${command}`); press('Enter')
  if (command === 'delete') {
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' })
    confirm.focus()
    fireEvent.click(confirm)
    expect(screen.getByRole('button', { name: 'Close command panel' })).toHaveFocus()
  }
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(command === 'new' ? '/api/conversations' : `/api/conversations/${conversation.id}`, expect.objectContaining({ method: command === 'new' ? 'POST' : 'DELETE' })))
  if (command === 'new') expect(oldInput).toHaveFocus()
  await act(async () => { resolveMutation(response(command === 'new' ? replacement : null)) })
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/conversations/current', expect.any(Object)))
  expect(oldInput).not.toBeInTheDocument()
  expect(input()).toHaveFocus()
  await act(async () => { resolveCurrent(response(replacement)) })
  await waitFor(() => expect(useChatStore.getState().operationPending).toBe(false))
  expect(useChatStore.getState().conversation?.id).toBe(replacement.id)
  expect(input()).toHaveFocus()
  expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
})

it.each(['status panel', 'recipe control'])('delayed post-send autofocus preserves focus in the %s', async target => {
  jest.useFakeTimers()
  try {
    let completeSend!: () => void
    const sending = new Promise<void>(resolve => { completeSend = resolve })
    const send = jest.fn().mockReturnValue(sending)
    render(<><button type="button">Recipe control</button><ChatInput onSendMessage={send} /></>)
    act(() => jest.advanceTimersByTime(100))
    expect(input()).toHaveFocus()
    typeCommand('A brewing question'); press('Enter')
    expect(send).toHaveBeenCalledTimes(1)
    let focused: HTMLElement
    if (target === 'status panel') {
      await act(async () => { typeCommand('/status'); press('Enter') })
      focused = screen.getByRole('button', { name: 'Close command panel' })
    } else {
      focused = screen.getByRole('button', { name: 'Recipe control' })
      focused.focus()
    }
    expect(focused).toHaveFocus()
    await act(async () => { completeSend(); await sending })
    act(() => jest.advanceTimersByTime(100))
    expect(focused).toHaveFocus()
    expect(input()).not.toHaveFocus()
  } finally {
    jest.useRealTimers()
  }
})

it('keeps the composer uncluttered and its draft intact when the recipe preview changes', () => {
  render(<ChatInput onSendMessage={jest.fn()} placeholder="Message Brewey, or / for commands" />)
  typeCommand('My brewing question')
  act(() => useChatStore.getState().setCurrentRecipeContext('different-preview'))
  expect(input()).toHaveValue('My brewing question')
  expect(useChatStore.getState().conversation?.id).toBe(conversation.id)
  expect(screen.queryByLabelText('General chat')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Recipe chat' })).not.toBeInTheDocument()
  expect(screen.queryByText(conversation.title)).not.toBeInTheDocument()
  expect(input()).toHaveAttribute('placeholder', 'Message Brewey, or / for commands')
})

it.each(['general', 'recipe', 'older', 'mode'])('retired /%s is absent from discovery and stays local on manual execution', async command => {
  const send = jest.fn()
  render(<ChatInput onSendMessage={send} />)
  typeCommand('/')
  expect(within(screen.getByRole('listbox')).queryByText(`/${command}`)).not.toBeInTheDocument()
  typeCommand(`/${command}`); press('Enter')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unknown command'))
  expect(send).not.toHaveBeenCalled()
})

it('dispatches /rename title through the store without sending an agent message', async () => {
  const send = jest.fn()
  const rename = jest.spyOn(useChatStore.getState(), 'renameConversation').mockResolvedValue(undefined)
  render(<ChatInput onSendMessage={send} />)
  typeCommand('/rename My porter discussion'); press('Enter')
  await waitFor(() => expect(rename).toHaveBeenCalledWith('My porter discussion'))
  expect(send).not.toHaveBeenCalled()
  expect(input()).toHaveValue('')
  expect(input()).toHaveFocus()
})
