import { act, fireEvent, render, screen } from '@testing-library/react'
import Home from './page'
import useChatStore from '@/lib/stores/chat-store'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { useMobile } from '@/lib/hooks/useMobile'
import type { Conversation } from '@/types/conversation'
import type { RecipeWithCalculations } from '@/types/database'

jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'owner' }, loading: false, signOut: jest.fn() }) }))
jest.mock('@/lib/hooks/useMobile', () => ({ useMobile: jest.fn(() => false) }))
jest.mock('next/image', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/hamburger-menu', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/recipe/recipe-panel', () => ({
  __esModule: true,
  default: function MockRecipePanel({ onRecipeSelected }: { onRecipeSelected: (id: string) => void }) {
    return <button onClick={() => onRecipeSelected('recipe-two')}>Select recipe in panel</button>
  },
}))
jest.mock('@/components/ui/mobile-header', () => ({
  __esModule: true,
  default: function MockMobileHeader({ onRecipeChange }: { onRecipeChange: (id: string) => void }) {
    return <button onClick={() => onRecipeChange('recipe-two')}>Select recipe in mobile header</button>
  },
}))
jest.mock('@/components/chat/chat-panel', () => ({
  __esModule: true,
  default: function MockChatPanel({ onRecipeUpdate }: { onRecipeUpdate: (id: string) => void }) {
    return <button onClick={() => onRecipeUpdate('recipe-two')}>Show agent recipe update</button>
  },
}))

const general: Conversation = { id: 'general-chat', recipes: [], title: 'General', status: 'active', createdAt: '2026-10-03T01:00:00Z', updatedAt: '2026-10-03T01:00:00Z', compactedAt: null, running: false }
const recipeChat: Conversation = { ...general, id: 'recipe-chat', recipes: [{ recipeId: 'recipe-one', recipeTitle: 'First recipe', deleted: false, activities: ['historical'] }] }
const userRecipes = [
  { id: 'recipe-one', user_id: 'owner', name: 'First recipe' },
  { id: 'recipe-two', user_id: 'owner', name: 'Second recipe' },
] as RecipeWithCalculations[]

beforeEach(() => {
  useChatStore.getState().clearAll()
  useChatStore.setState({ sessionUserId: 'owner', conversation: general, currentRecipeContext: 'recipe-one' })
  useRecipeStore.setState({ ...useRecipeStore.getInitialState(), userId: 'owner', userRecipes, selectedRecipeId: 'recipe-one',
    loadUserRecipes: jest.fn().mockResolvedValue(undefined), loadUserPreferences: jest.fn().mockResolvedValue(undefined) }, true)
  jest.mocked(useMobile).mockReturnValue(false)
})
afterEach(() => {
  useChatStore.getState().clearAll()
  useRecipeStore.setState(useRecipeStore.getInitialState(), true)
})

it.each([
  [false, 'Select recipe in panel'],
  [true, 'Select recipe in mobile header'],
] as const)('explicit recipe selection preserves the current chat (mobile=%s)', (mobile, button) => {
  jest.mocked(useMobile).mockReturnValue(mobile)
  render(<Home />)
  fireEvent.click(screen.getByText(button))
  expect(useRecipeStore.getState().selectedRecipeId).toBe('recipe-two')
  expect(useChatStore.getState().currentRecipeContext).toBe('recipe-two')
  expect(useChatStore.getState().conversation?.id).toBe(general.id)
  expect(useChatStore.getState().conversationLoading).toBe(false)
})

it.each([
  [false, 'Select recipe in panel'],
  [true, 'Select recipe in mobile header'],
] as const)('explicit selection preserves chats with historical recipe activity (mobile=%s)', (mobile, button) => {
  jest.mocked(useMobile).mockReturnValue(mobile)
  useChatStore.setState({ conversation: recipeChat })
  render(<Home />)
  fireEvent.click(screen.getByText(button))
  expect(useRecipeStore.getState().selectedRecipeId).toBe('recipe-two')
  expect(useChatStore.getState().currentRecipeContext).toBe('recipe-two')
  expect(useChatStore.getState().conversation?.id).toBe(recipeChat.id)
  expect(useChatStore.getState().conversationLoading).toBe(false)
})

it.each([null, 'recipe-one'])('agent preview updates preserve the existing conversation (%s)', scope => {
  useChatStore.setState({ conversation: scope ? recipeChat : general })
  const initialConversationId = useChatStore.getState().conversation?.id
  render(<Home />)
  fireEvent.click(screen.getByText('Show agent recipe update'))
  expect(useRecipeStore.getState().selectedRecipeId).toBe('recipe-two')
  expect(useChatStore.getState().currentRecipeContext).toBe('recipe-two')
  expect(useChatStore.getState().conversation?.id).toBe(initialConversationId)
  expect(useChatStore.getState().conversationLoading).toBe(false)
})

it('resuming a chat with another recipe’s history leaves the selected recipe untouched', () => {
  render(<Home />)
  act(() => useChatStore.setState({ conversation: { ...recipeChat, recipes: [{ recipeId: 'recipe-two', recipeTitle: 'Second recipe', deleted: false, activities: ['historical'] }] } }))
  expect(useRecipeStore.getState().selectedRecipeId).toBe('recipe-one')
  expect(useChatStore.getState().currentRecipeContext).toBe('recipe-one')
  expect(useChatStore.getState().conversation?.id).toBe(recipeChat.id)
})

it('clears the chat preview context when the selected recipe is removed without changing the chat', () => {
  render(<Home />)
  act(() => useRecipeStore.setState({ selectedRecipeId: null, userRecipes: [] }))
  expect(useChatStore.getState().currentRecipeContext).toBeNull()
  expect(useChatStore.getState().conversation?.id).toBe(general.id)
})
