import type { Conversation } from './conversation'

export interface Message {
  id: string
  type: 'user' | 'assistant' | 'system' | 'action'
  content: string
  sequence?: number
  turnId?: string | null
  timestamp: Date
  metadata?: {
    turnStatus?: 'completed' | 'interrupted' | 'failed'
    recipeId?: string
    toolCalls?: ToolCall[]
    needsConfirmation?: boolean
    isStreaming?: boolean
    isComplete?: boolean
    reasoningPreview?: string
    isSlashCommand?: boolean
    statusMessages?: string[]
    isExecutingTool?: boolean
  }
}

export interface ToolCall {
  id?: string
  name: string
  parameters?: Record<string, unknown>
  result?: unknown
  error?: string
  timestamp?: string
  status?: 'pending' | 'success' | 'error'
}

export interface ChatState {
  messages: Message[]
  isTyping: boolean
  currentRecipeContext: string | null
  conversation: Conversation | null
  conversations: Conversation[]
  conversationLoading: boolean
  conversationError: string | null
  hasOlderMessages: boolean
  nextBefore: number | null
  sessionUserId: string | null
  operationPending: boolean
  historySearchQuery: string | null
  historySearchResults: Conversation[] | null
  historySearchLoading: boolean
  historySearchError: string | null
}


export interface ChatActions {
  initializeConversations: (userId: string) => Promise<void>
  refreshConversation: (force?: boolean) => Promise<void>
  selectConversation: (id: string) => Promise<void>
  newConversation: () => Promise<void>
  deleteConversation: () => Promise<void>
  compactConversation: () => Promise<void>
  loadOlderMessages: () => Promise<void>
  setConversationError: (error: string | null) => void
  searchConversations: (query: string) => Promise<void>
  cancelConversationSearch: () => void
  renameConversation: (title: string) => Promise<void>
  appendNote: (content: string) => Promise<void>
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => string
  updateMessage: (id: string, updates: Partial<Message> | ((message: Message) => Partial<Message>)) => void
  removeMessage: (id: string) => void
  setTyping: (typing: boolean) => void
  setCurrentRecipeContext: (recipeId: string | null) => void
  clearHistory: () => void
  clearAll: () => void
  startStreamingMessage: (messageId: string) => void
  appendToStreamingMessage: (messageId: string, content: string) => void
  completeStreamingMessage: (messageId: string) => void
}

export interface StreamingEvent {
  type: 'conversation' | 'context_compacted' | 'context_restored' | 'text' | 'reasoning' | 'done' | 'error' | 'tool_call' | 'tool_result' | 'tool_error' | 'system_message' | 'tool_status'
  conversation_id?: string
  user_message_id?: string
  assistant_message_id?: string
  turn_id?: string
  content?: string
  error?: string
  /** When type is 'error': set by server if user was already notified (e.g. system_message); client should not throw */
  recoverable?: boolean
  technical_details?: string
  tool_name?: string
  tool_id?: string
  tool_args?: unknown
  tool_result?: unknown
  status_message?: string
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

export type ChatStore = ChatState & ChatActions

export interface MCPRequest {
  jsonrpc: string
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface MCPResponse {
  jsonrpc?: string
  id?: number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}
