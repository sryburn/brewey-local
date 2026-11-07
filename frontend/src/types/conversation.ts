/** Durable conversation wire types. Dates cross HTTP boundaries as ISO strings. */
export type RecipeActivity = 'selected' | 'read' | 'modified' | 'historical'
export interface ConversationRecipe {
  /** Retains the original stable recipe ID after deletion. */
  recipeId: string | null
  recipeTitle: string
  deleted: boolean
  activities: RecipeActivity[]
}
export interface Conversation {
  id: string
  recipes: ConversationRecipe[]
  title: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
  compactedAt: string | null
  running: boolean
}

/** Only explicit activation restores a selection; ordinary reads never do. */
export interface ConversationActivation extends Conversation {
  /** Owned, still-existing selection of the last ordinary user message, or null. */
  resumeRecipeId: string | null
}

export interface ConversationMessage {
  id: string
  type: 'user' | 'assistant' | 'system' | 'action'
  content: string
  timestamp: string
  sequence: number
  turnId: string | null
  metadata?: Record<string, unknown>
}

export interface ConversationPage {
  conversation: Conversation
  messages: ConversationMessage[]
  hasMore: boolean
  nextBefore: number | null
}

export interface ConversationContext {
  messages: ConversationMessage[]
  summary: string | null
  summaryThroughSequence: number
  contextRevision: number
  lastSequence: number
}

export type ConversationTurnStatus = 'running' | 'completed' | 'interrupted' | 'failed'

export interface ConversationTurn {
  turnId: string
  userMessageId: string
  assistantMessageId: string
  replayed: boolean
  status: ConversationTurnStatus
}

export interface ConversationBinding {
  threadId: string
  throughSequence: number
  contextRevision: number
  model?: string
}

export interface ConversationEvent {
  id: string
  turnId: string
  sequence: number
  timestamp: string
  event: Record<string, unknown>
}
