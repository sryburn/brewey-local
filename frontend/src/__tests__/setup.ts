import '@testing-library/jest-dom'

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  length: 0,
  key: jest.fn()
}
if (typeof window !== 'undefined') Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock scrollIntoView
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = jest.fn()

// Mock TextEncoder and TextDecoder for streaming tests
import { TextEncoder, TextDecoder } from 'util'
global.TextEncoder = TextEncoder as typeof global.TextEncoder
global.TextDecoder = TextDecoder as typeof global.TextDecoder

// Suppress jsdom navigation warnings
const originalConsoleError = console.error
console.error = (...args) => {
  if (args[0]?.message?.includes?.('Not implemented: navigation')) {
    return // Suppress jsdom navigation warnings
  }
  originalConsoleError(...args)
}
