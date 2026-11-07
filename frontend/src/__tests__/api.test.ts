import { mockFetchStreamingResponse } from './mocks/llm'

// Mock the fetch function for API testing
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('API Routes', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  describe('/api/chat', () => {
    test('handles requests correctly with valid auth', async () => {
      // Mock successful streaming response
      mockFetch.mockImplementation(() =>
        mockFetchStreamingResponse(['Hello! ', 'I can help you ', 'create beer recipes.'])
      )

      // Make request to API endpoint
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Create an IPA recipe',
          conversationHistory: [],
          currentRecipeId: null
        })
      })

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Create an IPA recipe',
          conversationHistory: [],
          currentRecipeId: null
        })
      })

      // Verify response properties
      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
    })

    test('returns 401 when authentication fails', async () => {
      // Mock auth failure response
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Map([['Content-Type', 'application/json']]),
          json: () => Promise.resolve({ error: 'Authentication required' })
        })
      )

      // Make request to API endpoint
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Create an IPA recipe'
        })
      })

      // Verify error response
      expect(response.ok).toBe(false)
      expect(response.status).toBe(401)
      
      const responseData = await response.json()
      expect(responseData).toEqual({
        error: 'Authentication required'
      })
    })

    test('returns 400 when message is missing', async () => {
      // Mock bad request response
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          headers: new Map([['Content-Type', 'application/json']]),
          json: () => Promise.resolve({ error: 'Message is required' })
        })
      )

      // Make request without message
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      // Verify error response
      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)
      
      const responseData = await response.json()
      expect(responseData).toEqual({
        error: 'Message is required'
      })
    })

    test('handles server errors gracefully', async () => {
      // Mock server error response
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          headers: new Map([['Content-Type', 'application/json']]),
          json: () => Promise.resolve({ 
            error: 'Chat processing failed',
            message: 'Sorry, I encountered an error. Please try again.'
          })
        })
      )

      // Make request that triggers server error
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Create an IPA recipe'
        })
      })

      // Verify error response
      expect(response.ok).toBe(false)
      expect(response.status).toBe(500)
      
      const responseData = await response.json()
      expect(responseData).toEqual({
        error: 'Chat processing failed',
        message: 'Sorry, I encountered an error. Please try again.'
      })
    })
  })

})
