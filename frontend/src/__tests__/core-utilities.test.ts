import { renderHook, act } from '@testing-library/react'
import useChatStore from '@/lib/stores/chat-store'
import { config } from '@/lib/config'

// Mock debug module
jest.mock('@/lib/debug', () => ({
  debug: {
    log: jest.fn()
  }
}))

describe('Core Utilities', () => {
  describe('Chat Store', () => {
    beforeEach(() => {
      // Reset store state before each test
      useChatStore.getState().clearAll()
    })

    it('should manage messages correctly', () => {
      const { result } = renderHook(() => useChatStore())
      
      // Test adding a message
      act(() => {
        const messageId = result.current.addMessage({
          type: 'user',
          content: 'Test message'
        })
        
        expect(messageId).toBeDefined()
        expect(typeof messageId).toBe('string')
      })
      
      // Verify message was added
      const messages = result.current.messages
      expect(messages).toHaveLength(1)
      expect(messages[0].type).toBe('user')
      expect(messages[0].content).toBe('Test message')
      expect(messages[0].id).toBeDefined()
      expect(messages[0].timestamp).toBeInstanceOf(Date)
    })
  })

  describe('Configuration', () => {
    it('should load configuration correctly', () => {
      expect(config.app.environment).toBe('production') // NODE_ENV defaults to production in tests
    })

    // Note: Environment variable validation is now handled where values are used
    // rather than in shared config, so no validation test needed here
  })
})