import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { AuthEvent as AuthChangeEvent, LocalSession as Session } from './auth-client'
import { authClient } from './auth-client'
import type { AppUser as User } from '@/types/user'
jest.mock('./auth-client', () => ({ authClient: { getSession: jest.fn(), onAuthStateChange: jest.fn() } }))
import { AuthProvider, useAuth } from './auth-context'
import useChatStore from './stores/chat-store'
import { useRecipeStore } from './stores/recipe-store'
import type { RecipeWithCalculations } from '@/types/database'

const firstUser = { id: 'user-one', email: 'first@example.com', user_metadata: {}, app_metadata: {} } as User
const secondUser = { id: 'user-two', email: 'second@example.com', user_metadata: {}, app_metadata: {} } as User
const session = (user: User) => ({ user } as Session)
let emit: (event: AuthChangeEvent, session: Session | null) => void
let storage: Map<string, string>

function AccountView() {
  const { user, loading } = useAuth()
  const messages = useChatStore(state => state.messages)
  return <div><span>{loading ? 'loading' : user?.email || 'signed out'}</span><span>{messages.map(message => message.content).join(',')}</span></div>
}

function seedPrivateData(owner?: string) {
  useChatStore.getState().addMessage({ type: 'user', content: 'first account private conversation' })
  useRecipeStore.setState({ userId: firstUser.id, selectedRecipeId: 'first-recipe', userRecipes: [{ id: 'first-recipe', user_id: firstUser.id, name: 'Private recipe' }] as RecipeWithCalculations[] })
  if (owner) storage.set('brewey-chat-owner', owner)
}

beforeEach(() => {
  storage = new Map()
  jest.mocked(localStorage.getItem).mockImplementation(key => storage.get(key) ?? null)
  jest.mocked(localStorage.setItem).mockImplementation((key, value) => { storage.set(key, value) })
  jest.mocked(localStorage.removeItem).mockImplementation(key => { storage.delete(key) })
  useChatStore.getState().clearAll()
  useRecipeStore.getState().clearRecipeState()
  jest.mocked(authClient.getSession).mockResolvedValue({ data: { session: session(firstUser) }, error: null })
  jest.mocked(authClient.onAuthStateChange).mockImplementation(callback => {
    emit = callback
    return { data: { subscription: { unsubscribe: jest.fn() } } }
  })
})

test('cross-tab account change clears previous chat and recipe identity before exposing the new user', async () => {
  seedPrivateData(firstUser.id)
  render(<AuthProvider><AccountView /></AuthProvider>)
  await screen.findByText(firstUser.email!)
  expect(screen.getByText('first account private conversation')).toBeInTheDocument()
  act(() => emit('SIGNED_IN', session(secondUser)))
  expect(screen.getByText(secondUser.email!)).toBeInTheDocument()
  expect(useChatStore.getState().messages).toEqual([])
  expect(useRecipeStore.getState().userRecipes).toEqual([])
  expect(useRecipeStore.getState().selectedRecipeId).toBeNull()
  expect(useRecipeStore.getState().userId).toBe(secondUser.id)
  expect(storage.get('brewey-chat-owner')).toBe(secondUser.id)
})

test('cross-tab signout clears shared persisted chat and recipe state', async () => {
  seedPrivateData(firstUser.id)
  render(<AuthProvider><AccountView /></AuthProvider>)
  await screen.findByText(firstUser.email!)
  act(() => emit('SIGNED_OUT', null))
  expect(screen.getByText('signed out')).toBeInTheDocument()
  expect(useChatStore.getState().messages).toEqual([])
  expect(useRecipeStore.getState().userId).toBeNull()
  expect(useRecipeStore.getState().userRecipes).toEqual([])
  expect(storage.has('brewey-chat-storage')).toBe(false)
  expect(storage.has('brewey-chat-owner')).toBe(false)
})

test.each([undefined, firstUser.id])('initial recovery clears unknown or different-owner history (%s)', async owner => {
  seedPrivateData(owner)
  jest.mocked(authClient.getSession).mockResolvedValue({ data: { session: session(secondUser) }, error: null })
  render(<AuthProvider><AccountView /></AuthProvider>)
  await screen.findByText(secondUser.email!)
  expect(useChatStore.getState().messages).toEqual([])
  expect(useRecipeStore.getState().userRecipes).toEqual([])
})

test('same-owner reload and token refresh preserve the current conversation', async () => {
  seedPrivateData(firstUser.id)
  render(<AuthProvider><AccountView /></AuthProvider>)
  await screen.findByText(firstUser.email!)
  act(() => emit('SESSION_CHANGED', session(firstUser)))
  expect(screen.getByText('first account private conversation')).toBeInTheDocument()
})

test('an initial session read cannot overwrite a later cross-tab auth event', async () => {
  let resolveInitial: (value: Awaited<ReturnType<typeof authClient.getSession>>) => void = () => {}
  jest.mocked(authClient.getSession).mockImplementation(() => new Promise(resolve => { resolveInitial = resolve }))
  seedPrivateData(firstUser.id)
  render(<AuthProvider><AccountView /></AuthProvider>)
  act(() => emit('SIGNED_IN', session(secondUser)))
  await act(async () => { resolveInitial({ data: { session: session(firstUser) }, error: null }) })
  await waitFor(() => expect(screen.getByText(secondUser.email!)).toBeInTheDocument())
  expect(useChatStore.getState().messages).toEqual([])
  expect(useRecipeStore.getState().userId).toBe(secondUser.id)
})
