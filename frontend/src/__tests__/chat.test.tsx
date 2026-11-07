import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatContainer from '@/components/chat/chat-container'
import useChatStore from '@/lib/stores/chat-store'
import { mockFetchStreamingResponse } from './mocks/llm'

// Mock the fetch function
const mockFetch = jest.fn()
global.fetch = mockFetch
const mockRouterPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

// Mock the auth context to provide a user
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      user_metadata: { name: 'Test User' }
    }
  })
}))

// Mock the theme provider
jest.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: jest.fn()
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children
}))

// Mock ReactMarkdown to avoid ES module issues
jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }: { children: string }) {
    return <div data-testid="mock-markdown">{children}</div>
  }
})

// Mock remark-gfm plugin to avoid ES module issues
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => {}
}))

// Mock window.matchMedia for pointer detection
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated  
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

describe('Chat Functionality', () => {
  beforeEach(() => {
    // Clear the chat store before each test
    useChatStore.getState().clearAll()
    mockFetch.mockReset()
    const conversation = { id: 'saved-chat', recipes: [], title: 'Saved chat', status: 'active', createdAt: '2026-10-03T01:00:00Z', updatedAt: '2026-10-03T01:00:00Z', compactedAt: null, running: false }
    global.fetch = jest.fn((url, options) => {
      if (url === '/api/chat') return mockFetch(url, options)
      const data = String(url).includes('/current?') ? conversation : String(url).includes('?recipeId=') ? [conversation] : {
        conversation, messages: useChatStore.getState().messages.map(message => ({ ...message, timestamp: message.timestamp.toISOString() })), hasMore: false, nextBefore: null,
      }
      return Promise.resolve({ ok: true, json: async () => ({ data }) })
    }) as unknown as typeof fetch
  })

  test('/profile navigates through the router without sending an AI request', async () => {
    const user = userEvent.setup()
    render(<ChatContainer />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat message' })).toBeEnabled())
    await user.type(screen.getByRole('textbox', { name: 'Chat message' }), '/profile')
    await user.click(screen.getByTestId('send-message-button'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/settings?tab=profile'))
    expect(mockFetch.mock.calls.some(([url]) => url === '/api/chat')).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Chat message' })).toHaveValue('')
  })

  test('user can send message and get AI response', async () => {
    const user = userEvent.setup()

    // Mock successful streaming response
    mockFetch.mockImplementation(() =>
      mockFetchStreamingResponse(['Hello! ', 'I can help you ', 'create beer recipes.'])
    )

    render(<ChatContainer />)

    // Find the textarea input
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat message' })).toBeEnabled())
    const textarea = screen.getByRole('textbox', { name: 'Chat message' })
    expect(textarea).toBeInTheDocument()

    // Type a message
    await user.type(textarea, 'Create an IPA recipe')

    // Find and click the send button
    const sendButton = screen.getByTestId('send-message-button')
    await user.click(sendButton)

    // Wait for user message to appear
    await waitFor(() => {
      expect(screen.getByText('Create an IPA recipe')).toBeInTheDocument()
    })

    // Wait for AI response to appear
    await waitFor(() => {
      expect(screen.getByText(/Hello! I can help you create beer recipes/)).toBeInTheDocument()
    }, { timeout: 3000 })

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(payload).toEqual(expect.objectContaining({ conversationId: 'saved-chat', requestId: expect.any(String), message: 'Create an IPA recipe' }))
    expect(payload.conversationHistory).toBeUndefined()
  })

  test('chat history is maintained correctly', async () => {
    const user = userEvent.setup()

    // Mock responses for multiple messages
    mockFetch
      .mockImplementationOnce(() =>
        mockFetchStreamingResponse(['First response'])
      )
      .mockImplementationOnce(() =>
        mockFetchStreamingResponse(['Second response'])
      )

    render(<ChatContainer />)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat message' })).toBeEnabled())
    const textarea = screen.getByRole('textbox', { name: 'Chat message' })
    const sendButton = screen.getByTestId('send-message-button')

    // Send first message
    await user.type(textarea, 'First message')
    await user.click(sendButton)

    // Wait for first exchange to complete
    await waitFor(() => {
      expect(screen.getByText('First message')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('First response')).toBeInTheDocument()
    })

    // Send second message
    await user.type(textarea, 'Second message')
    await user.click(sendButton)

    // Wait for second exchange to complete
    await waitFor(() => {
      expect(screen.getByText('Second message')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('Second response')).toBeInTheDocument()
    })

    // Verify both messages are still visible (history maintained)
    expect(screen.getByText('First message')).toBeInTheDocument()
    expect(screen.getByText('First response')).toBeInTheDocument()
    expect(screen.getByText('Second message')).toBeInTheDocument()
    expect(screen.getByText('Second response')).toBeInTheDocument()

    const payload = JSON.parse(mockFetch.mock.calls.at(-1)[1].body)
    expect(payload).toEqual(expect.objectContaining({ conversationId: 'saved-chat', message: 'Second message' }))
    expect(payload.conversationHistory).toBeUndefined()
    expect(payload.requestId).not.toBe(JSON.parse(mockFetch.mock.calls[0][1].body).requestId)
  })

  test('basic error handling works correctly', async () => {
    const user = userEvent.setup()

    // Mock API error response
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Server error' })
      })
    )

    render(<ChatContainer />)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat message' })).toBeEnabled())
    const textarea = screen.getByRole('textbox', { name: 'Chat message' })
    const sendButton = screen.getByTestId('send-message-button')

    // Send a message
    await user.type(textarea, 'Test error handling')
    await user.click(sendButton)

    // Wait for user message to appear
    await waitFor(() => {
      expect(screen.getByText('Test error handling')).toBeInTheDocument()
    })

    // Wait for error message to appear in the assistant response
    await waitFor(() => {
      expect(screen.getByText(/Error: Server error/)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Verify the error was handled gracefully
    expect(screen.getByText('Test error handling')).toBeInTheDocument()
  })

  test('chat input handles empty messages correctly', async () => {
    const user = userEvent.setup()

    render(<ChatContainer />)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat message' })).toBeEnabled())
    const textarea = screen.getByRole('textbox', { name: 'Chat message' })
    const sendButton = screen.getByTestId('send-message-button')

    // Try to send empty message
    await user.click(sendButton)

    // Verify no API call was made
    expect(mockFetch).not.toHaveBeenCalled()

    // Try to send whitespace-only message
    await user.type(textarea, '   ')
    await user.click(sendButton)

    // Verify still no API call was made
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
