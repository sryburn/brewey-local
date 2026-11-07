import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useChatHistoryScroll } from './use-chat-history-scroll'
import useChatStore from '@/lib/stores/chat-store'
import type { Message } from '@/types/chat'
import type { Conversation } from '@/types/conversation'

const conversation: Conversation = { id: 'chat', recipes: [], title: 'Saved discussion', status: 'active', createdAt: '', updatedAt: '', compactedAt: null, running: false }
const message = (id: string): Message => ({ id, type: 'user', content: id, timestamp: new Date() })
function History() {
  const state = useChatStore()
  const { paneRef, onHistoryScroll } = useChatHistoryScroll(state.sessionUserId || undefined, state.conversation?.id, state.messages)
  return <div ref={paneRef} data-testid="history" onScroll={onHistoryScroll}>
    {state.messages.map(item => <div key={item.id} data-chat-message-id={item.id}>{item.content}</div>)}
  </div>
}
function geometry() {
  const pane = screen.getByTestId('history')
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => useChatStore.getState().messages.length * 100 })
  Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 50 })
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = this.dataset.chatMessageId ? useChatStore.getState().messages.findIndex(item => item.id === this.dataset.chatMessageId) : -1
    return { top: index < 0 ? 40 : 40 + index * 100 - pane.scrollTop } as DOMRect
  })
  return pane
}
beforeEach(() => {
  useChatStore.getState().clearAll()
  useChatStore.setState({ sessionUserId: 'owner', conversation, messages: [message('current')], hasOlderMessages: true, nextBefore: 101 })
})
afterEach(() => jest.restoreAllMocks())

it('loads at the top once and preserves the visible message position when earlier messages are prepended', async () => {
  let complete!: () => void
  const load = jest.spyOn(useChatStore.getState(), 'loadOlderMessages').mockImplementation(() => new Promise(resolve => {
    complete = () => { useChatStore.setState({ messages: [message('older-one'), message('older-two'), ...useChatStore.getState().messages], hasOlderMessages: false }); resolve() }
  }))
  render(<History />)
  const pane = geometry()
  pane.scrollTop = 100; fireEvent.scroll(pane)
  pane.scrollTop = 30
  fireEvent.scroll(pane); fireEvent.scroll(pane)
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => complete())
  expect(pane.scrollTop).toBe(230)
  expect(screen.getByText('current').getBoundingClientRect().top).toBe(10)
  fireEvent.scroll(pane)
  expect(load).toHaveBeenCalledTimes(1)
})

it('preserves additional scrolling during the pending fetch rather than snapping to its starting position', async () => {
  let complete!: () => void
  jest.spyOn(useChatStore.getState(), 'loadOlderMessages').mockImplementation(() => new Promise(resolve => {
    complete = () => { useChatStore.setState({ messages: [message('older'), ...useChatStore.getState().messages] }); resolve() }
  }))
  render(<History />)
  const pane = geometry()
  pane.scrollTop = 100; fireEvent.scroll(pane)
  pane.scrollTop = 0; fireEvent.scroll(pane)
  pane.scrollTop = 80
  await act(async () => complete())
  expect(pane.scrollTop).toBe(180)
})

it('does not load away from the top or during an operation and can retry after a failed read', async () => {
  const load = jest.spyOn(useChatStore.getState(), 'loadOlderMessages').mockResolvedValue(undefined)
  render(<History />)
  const pane = geometry()
  pane.scrollTop = 100
  fireEvent.scroll(pane)
  expect(load).not.toHaveBeenCalled()
  pane.scrollTop = 0
  act(() => useChatStore.setState({ operationPending: true }))
  fireEvent.scroll(pane)
  expect(load).not.toHaveBeenCalled()
  act(() => useChatStore.setState({ operationPending: false }))
  pane.scrollTop = 100; fireEvent.scroll(pane)
  pane.scrollTop = 0; await act(async () => fireEvent.scroll(pane))
  pane.scrollTop = 100; fireEvent.scroll(pane)
  pane.scrollTop = 0; await act(async () => fireEvent.scroll(pane))
  expect(load).toHaveBeenCalledTimes(2)
  expect(pane.scrollTop).toBe(0)
})

it('drops the old scroll anchor when a different account/conversation opens during the fetch', async () => {
  let complete!: () => void
  jest.spyOn(useChatStore.getState(), 'loadOlderMessages').mockImplementation(() => new Promise(resolve => { complete = resolve }))
  render(<History />)
  const pane = geometry()
  pane.scrollTop = 100; fireEvent.scroll(pane)
  pane.scrollTop = 0; fireEvent.scroll(pane)
  act(() => useChatStore.setState({ sessionUserId: 'another-owner', conversation: { ...conversation, id: 'different-chat' }, messages: [message('different')] }))
  await act(async () => complete())
  expect(pane.scrollTop).toBe(0)
  expect(screen.queryByText('current')).not.toBeInTheDocument()
})

it('fills a short viewport automatically until scrolling becomes possible', async () => {
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(150)
  jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => useChatStore.getState().messages.length * 100)
  const load = jest.spyOn(useChatStore.getState(), 'loadOlderMessages').mockImplementation(async () => {
    useChatStore.setState({ messages: [message('older'), ...useChatStore.getState().messages] })
  })
  render(<History />)
  await waitFor(() => expect(screen.getByText('older')).toBeInTheDocument())
  expect(load).toHaveBeenCalledTimes(1)
})

it('does not fetch during initial downward smooth scrolling through the top threshold', () => {
  const load = jest.spyOn(useChatStore.getState(), 'loadOlderMessages').mockResolvedValue(undefined)
  render(<History />)
  const pane = geometry()
  for (const top of [1, 10, 20, 47, 80, 150]) { pane.scrollTop = top; fireEvent.scroll(pane) }
  expect(load).not.toHaveBeenCalled()
})
