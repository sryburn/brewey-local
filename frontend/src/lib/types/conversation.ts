/**
 * Conversation metadata types for managing conversation state and modes
 */

export interface ImportFile {
  id: string
  name: string
  content: string
  mimeType: string
  size: number
  uploadedAt: string
}

export interface ConversationMetadata {
  mode: 'normal' | 'import'
  importFile?: ImportFile
  lastActivity?: string
}

export interface ConversationHistory {
  messages: Array<{
    type: 'user' | 'assistant' | 'system'
    content: string
    metadata?: Record<string, unknown>
  }>
  metadata?: ConversationMetadata
}
