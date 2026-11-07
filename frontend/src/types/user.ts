export interface AppUser {
  id: string
  username: string
  email: string
  is_admin: boolean
  identity_provider: 'local' | 'os'
  user_metadata: Record<string, unknown> & {
    agentAdapter?: string
    agentPreferences?: Record<string, { model?: string | null; reasoningEffort?: string | null; verbosity?: 'low' | 'medium' | 'high' | null }>
    full_name?: string
    avatar_url?: string
    codexModel?: string | null
    codexReasoningEffort?: string | null
    codexVerbosity?: 'low' | 'medium' | 'high' | null
    chatSettings?: { showReasoning?: boolean }
  }
  app_metadata: { provider: 'local' | 'os' }
  created_at: string
  updated_at: string
}
