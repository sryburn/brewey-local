import { act, render, screen } from '@testing-library/react'
import ConversationHeader from './conversation-header'
import useChatStore from '@/lib/stores/chat-store'
import type { Conversation } from '@/types/conversation'

const conversation: Conversation = { id: 'general-chat', recipes: [], title: 'First chat', status: 'active', createdAt: '2026-10-03T01:00:00Z', updatedAt: '2026-10-03T01:00:00Z', compactedAt: null, running: false }
beforeEach(() => { useChatStore.getState().clearAll(); useChatStore.setState({ conversation, conversations: [conversation], sessionUserId: 'owner' }) })

it('renders no idle chat header even with a recipe preview', () => {
  useChatStore.setState({ currentRecipeContext: 'preview-only' })
  const { container } = render(<ConversationHeader />)
  expect(container).toBeEmptyDOMElement()
})

it('renders no idle recipe header or compaction cue', () => {
  useChatStore.setState({ conversation: { ...conversation, recipes: [{ recipeId: 'recipe-1', recipeTitle: 'Weekend IPA', deleted: false, activities: ['historical'] }], compactedAt: '2026-10-03T02:00:00Z' } })
  const { container } = render(<ConversationHeader />)
  expect(container).toBeEmptyDOMElement()
})

it('does not label chats with deleted recipe activity as read-only', () => {
  useChatStore.setState({ conversation: { ...conversation, recipes: [{ recipeId: 'old-recipe', recipeTitle: 'Archived stout', deleted: true, activities: ['historical'] }] } })
  const { container } = render(<ConversationHeader />)
  expect(container).toBeEmptyDOMElement()
})

it('distinguishes another-device activity from a local reply', () => {
  useChatStore.setState({ conversation: { ...conversation, running: true } })
  const view = render(<ConversationHeader />)
  expect(screen.getByRole('status')).toHaveTextContent('Running on another device')
  act(() => useChatStore.setState({ isTyping: true }))
  view.rerender(<ConversationHeader />)
  expect(screen.getByRole('status')).toHaveTextContent('Reply in progress')
  expect(screen.queryByText(/another device/)).not.toBeInTheDocument()
})

it('announces loading and errors without idle labels or management controls', () => {
  useChatStore.setState({ conversationLoading: true, conversationError: 'Saved chat could not be loaded.', conversation: { ...conversation, compactedAt: '2026-10-03T02:00:00Z' } })
  render(<ConversationHeader />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading saved chat')
  expect(screen.getByRole('alert')).toHaveTextContent('Saved chat could not be loaded.')
  expect(screen.queryByText(/Full transcript retained/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

it('announces a pending update and gives loading status precedence', () => {
  useChatStore.setState({ operationPending: true })
  render(<ConversationHeader />)
  expect(screen.getByRole('status')).toHaveTextContent('Updating saved chat')
  act(() => useChatStore.setState({ conversationLoading: true }))
  expect(screen.getByRole('status')).toHaveTextContent('Loading saved chat')
  expect(screen.queryByText(/Updating saved chat/)).not.toBeInTheDocument()
  act(() => useChatStore.setState({ operationPending: false, conversationLoading: false }))
  expect(screen.queryByLabelText('Chat status')).not.toBeInTheDocument()
})
