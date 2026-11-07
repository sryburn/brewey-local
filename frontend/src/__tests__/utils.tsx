import React from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider } from 'next-themes'

// Test wrapper with all necessary providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <AuthProvider>
        {children}
      </AuthProvider>
    </ThemeProvider>
  )
}

// Custom render function with providers
const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  return render(ui, {
    wrapper: AllTheProviders,
    ...options,
  })
}

// Helper to render with auth context only (for simpler tests)
export const renderWithAuth = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  const AuthWrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  )
  
  return render(ui, {
    wrapper: AuthWrapper,
    ...options,
  })
}

export * from '@testing-library/react'
export { customRender as render }