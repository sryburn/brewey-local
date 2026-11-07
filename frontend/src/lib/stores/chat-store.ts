import { create } from 'zustand'
import type { ChatStore, Message } from '@/types/chat'
import { debug } from '@/lib/debug'
import { debugLogger } from '@/lib/debug-logger'
import type { Conversation, ConversationActivation, ConversationPage } from '@/types/conversation'
import { useRecipeStore } from './recipe-store'

let revision = 0
let refreshInFlight = false
let searchGeneration = 0
class ConversationRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  const payload = await response.json()
  if (!response.ok) throw new ConversationRequestError(payload.error || payload.message || `Request failed (${response.status})`, response.status)
  return payload.data as T
}
const pageMessages = (page: ConversationPage): Message[] => page.messages.map(message => ({ ...message, timestamp: new Date(message.timestamp) }))

const useChatStore = create<ChatStore>((set, get) => ({
      messages: [], isTyping: false, currentRecipeContext: null,
      conversation: null, conversations: [], conversationLoading: false,
      conversationError: null, hasOlderMessages: false, nextBefore: null, sessionUserId: null,
      operationPending: false,
      historySearchQuery: null, historySearchResults: null, historySearchLoading: false, historySearchError: null,
      initializeConversations: async (userId) => {
        // Retire browser transcript caches without reading/importing their contents.
        try { localStorage.removeItem('brewey-chat-storage'); localStorage.removeItem('brewey-debug-logs') } catch { /* private memory cache remains usable */ }
        if (get().sessionUserId !== userId) {
          revision += 1
          get().cancelConversationSearch()
          set({ sessionUserId: userId, conversation: null, conversations: [], messages: [], currentRecipeContext: null, operationPending: false })
        }
        await get().refreshConversation(true)
      },
      refreshConversation: async (force = false) => {
        if (!get().sessionUserId || refreshInFlight || (!force && (get().isTyping || get().operationPending))) return
        const generation = revision
        refreshInFlight = true
        if (!get().conversation) set({ conversationLoading: true })
        try {
          const current = await api<Conversation>('/api/conversations/current')
          const page = await api<ConversationPage>(`/api/conversations/${current.id}?limit=100`)
          const history = await api<Conversation[]>('/api/conversations')
          if (generation !== revision || (!force && get().isTyping)) return
          const newest = pageMessages(page)
          const prior = get().messages
          const firstSequence = newest[0]?.sequence
          const older = get().conversation?.id === page.conversation.id && firstSequence != null
            ? prior.filter(message => message.sequence != null && message.sequence < firstSequence) : []
          set({ conversation: page.conversation, conversations: history, messages: [...older, ...newest],
            hasOlderMessages: older.length ? get().hasOlderMessages : page.hasMore,
            nextBefore: older.length ? get().nextBefore : page.nextBefore, conversationError: null })
        } catch (error) {
          if (generation === revision) set({ conversationError: error instanceof Error ? error.message : 'Unable to load chat.' })
        } finally {
          refreshInFlight = false
          if (generation === revision) set({ conversationLoading: false })
          // An account or conversation switch must start its own authoritative read.
          else if (get().sessionUserId && !get().isTyping) void get().refreshConversation(true)
        }
      },
      selectConversation: async (id) => {
        if (get().isTyping || get().operationPending || get().conversation?.running) return
        const previousSelection = get().currentRecipeContext
        let generation = ++revision
        set({ conversationLoading: true, operationPending: true, conversationError: null })
        try {
          const activated = await api<ConversationActivation>(`/api/conversations/${id}/activate`, 'POST', {})
          if (generation !== revision) return
          generation = ++revision
          set({ conversation: activated, messages: [], hasOlderMessages: false, nextBefore: null })
          const recipes = useRecipeStore.getState()
          if (activated.resumeRecipeId && recipes.userId === get().sessionUserId && get().currentRecipeContext === previousSelection) {
            recipes.setSelectedRecipe(activated.resumeRecipeId)
            set({ currentRecipeContext: activated.resumeRecipeId })
          }
          if (generation !== revision) return
          await get().refreshConversation(true)
        } catch (error) {
          if (generation === revision) set({ conversationError: error instanceof Error ? error.message : 'Unable to open chat.' })
        } finally { if (generation === revision) set({ operationPending: false, conversationLoading: false }) }
      },
      newConversation: async () => {
        if (get().isTyping || get().operationPending || get().conversation?.running) return
        let generation = ++revision
        set({ operationPending: true, conversationError: null })
        try {
          const conversation = await api<Conversation>('/api/conversations', 'POST', {})
          if (generation !== revision) return
          generation = ++revision
          set({ conversation, messages: [], hasOlderMessages: false, nextBefore: null })
          await get().refreshConversation(true)
        } catch (error) {
          if (generation === revision) set({ conversationError: error instanceof Error ? error.message : 'Unable to start chat.' })
        } finally { if (generation === revision) set({ operationPending: false }) }
      },
      deleteConversation: async () => {
        const conversation = get().conversation
        if (!conversation || get().isTyping || get().operationPending || conversation.running) return
        let generation = ++revision
        set({ operationPending: true, conversationError: null })
        try {
          await api<null>(`/api/conversations/${conversation.id}`, 'DELETE')
          if (generation !== revision) return
          generation = ++revision
          set({ conversation: null, messages: [], hasOlderMessages: false, nextBefore: null })
          await get().refreshConversation(true)
        } catch (error) {
          if (generation === revision) set({ conversationError: error instanceof Error ? error.message : 'Unable to delete chat.' })
        } finally { if (generation === revision) set({ operationPending: false }) }
      },
      compactConversation: async () => {
        const conversation = get().conversation
        if (!conversation || get().isTyping || get().operationPending || conversation.running) return
        let generation = revision
        set({ operationPending: true, conversationError: null })
        try {
          await api(`/api/conversations/${conversation.id}/compact`, 'POST', {})
          if (generation === revision) { generation = ++revision; await get().refreshConversation(true) }
        } catch (error) {
          if (generation === revision) set({ conversationError: error instanceof Error ? error.message : 'Unable to compact context.' })
        } finally { if (generation === revision) set({ operationPending: false }) }
      },
      loadOlderMessages: async () => {
        const { conversation, nextBefore, operationPending } = get()
        if (!conversation || nextBefore == null || operationPending) return
        const generation = revision
        set({ operationPending: true })
        try {
          const page = await api<ConversationPage>(`/api/conversations/${conversation.id}?before=${nextBefore}&limit=100`)
          if (generation !== revision || get().conversation?.id !== conversation.id) return
          const existing = new Set(get().messages.map(m => m.id))
          set({ messages: [...pageMessages(page).filter(m => !existing.has(m.id)), ...get().messages], hasOlderMessages: page.hasMore, nextBefore: page.nextBefore })
        } catch (error) {
          if (generation === revision) set({ conversationError: error instanceof Error ? error.message : 'Unable to load older messages.' })
        } finally { if (generation === revision) set({ operationPending: false }) }
      },
      cancelConversationSearch: () => {
        searchGeneration += 1
        set({ historySearchQuery: null, historySearchResults: null, historySearchLoading: false, historySearchError: null })
      },
      searchConversations: async (query) => {
        const userId = get().sessionUserId
        if (!userId) return
        const normalized = query.trim()
        const request = ++searchGeneration
        const isCurrent = () => request === searchGeneration && get().sessionUserId === userId
        set({ historySearchQuery: normalized, historySearchResults: [], historySearchLoading: true, historySearchError: null })
        try {
          if (new TextEncoder().encode(normalized.normalize('NFC')).length > 200) throw new Error('Search must be at most 200 UTF-8 bytes. Try a shorter phrase.')
          const parameters = new URLSearchParams()
          parameters.set('q', normalized)
          const history = await api<Conversation[]>(`/api/conversations?${parameters}`)
          if (isCurrent()) set({ historySearchResults: history })
        } catch (error) {
          if (isCurrent()) set({ historySearchError: error instanceof Error ? error.message : 'Unable to search saved chats.' })
        } finally { if (isCurrent()) set({ historySearchLoading: false }) }
      },
      renameConversation: async (title) => {
        const { conversation, sessionUserId } = get()
        if (!conversation || !sessionUserId || get().isTyping || get().operationPending || get().conversationLoading || conversation.running) return
        const normalized = title.replace(/\s+/g, ' ').trim().normalize('NFC')
        if (!normalized || new TextEncoder().encode(normalized).length > 200) {
          set({ conversationError: normalized ? 'Chat title must be at most 200 UTF-8 bytes. Try a shorter title.' : 'Enter a chat title.' })
          return
        }
        let generation = ++revision
        get().cancelConversationSearch()
        set({ operationPending: true, conversationError: null })
        try {
          const renamed = await api<Conversation>(`/api/conversations/${conversation.id}`, 'PATCH', { title: normalized })
          if (generation !== revision || get().sessionUserId !== sessionUserId || get().conversation?.id !== conversation.id) return
          generation = ++revision
          set({ conversation: renamed, conversations: get().conversations.map(item => item.id === renamed.id ? renamed : item) })
        } catch (error) {
          if (generation === revision) set({ conversationError: error instanceof Error ? error.message : 'Unable to rename chat.' })
        } finally { if (generation === revision) set({ operationPending: false }) }
      },
      appendNote: async (content) => {
        const conversation = get().conversation
        if (!conversation) return
        const generation = revision
        await api<ConversationPage>(`/api/conversations/${conversation.id}/note`, 'POST', { content })
        if (generation === revision) await get().refreshConversation(true)
      },
      setConversationError: (error) => set({ conversationError: error }),
      // Actions
      addMessage: (messageData) => {
        const message: Message = {
          ...messageData,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        }
        
        set((state) => {
          const newState = {
            messages: [...state.messages, message],
          }
          debug.log('💬 Message added:', { 
            type: message.type, 
            contentLength: message.content.length,
            totalMessages: newState.messages.length 
          })
          return newState
        })
        
        return message.id
      },

      updateMessage: (id, updates) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === id 
              ? { 
                  ...msg, 
                  ...(typeof updates === 'function' ? updates(msg) : updates)
                }
              : msg
          ),
        }))
      },

      removeMessage: (id) => {
        set((state) => ({
          messages: state.messages.filter((msg) => msg.id !== id),
        }))
      },

      setTyping: (typing) => {
        if (typing && !get().isTyping) revision += 1
        set({ isTyping: typing })
      },

      setCurrentRecipeContext: (recipeId) => {
        set({ currentRecipeContext: recipeId })
      },

      clearHistory: () => {
        set({
          messages: [],
          isTyping: false,
        })
        // Also clear debug logs when chat history is cleared
        debugLogger.clear()
      },

      clearAll: () => {
        revision += 1
        searchGeneration += 1
        debug.log('🗑️ clearAll() called - clearing all chat state')
        set({
          messages: [],
          isTyping: false,
          currentRecipeContext: null, conversation: null, conversations: [],
          conversationLoading: false, conversationError: null, sessionUserId: null, operationPending: false,
          hasOlderMessages: false, nextBefore: null,
          historySearchQuery: null, historySearchResults: null, historySearchLoading: false, historySearchError: null,
        })
        // Also clear debug logs when all chat data is cleared
        debugLogger.clear()
      },

      startStreamingMessage: (messageId) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId
              ? { ...msg, metadata: { ...msg.metadata, isStreaming: true, isComplete: false } }
              : msg
          ),
        }))
      },

      appendToStreamingMessage: (messageId, content) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId
              ? { ...msg, content: msg.content + content }
              : msg
          ),
        }))
      },

      completeStreamingMessage: (messageId) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId
              ? { ...msg, metadata: { ...msg.metadata, isStreaming: false, isComplete: true } }
              : msg
          ),
        }))
      },
}))

export default useChatStore

// Helper hooks for common operations
export const useChatActions = () => {
  const addMessage = useChatStore((state) => state.addMessage)
  const updateMessage = useChatStore((state) => state.updateMessage)
  const removeMessage = useChatStore((state) => state.removeMessage)
  const setTyping = useChatStore((state) => state.setTyping)
  const setCurrentRecipeContext = useChatStore((state) => state.setCurrentRecipeContext)
  const clearHistory = useChatStore((state) => state.clearHistory)
  const clearAll = useChatStore((state) => state.clearAll)
  const startStreamingMessage = useChatStore((state) => state.startStreamingMessage)
  const appendToStreamingMessage = useChatStore((state) => state.appendToStreamingMessage)
  const completeStreamingMessage = useChatStore((state) => state.completeStreamingMessage)
  
  return {
    addMessage,
    updateMessage,
    removeMessage,
    setTyping,
    setCurrentRecipeContext,
    clearHistory,
    clearAll,
    startStreamingMessage,
    appendToStreamingMessage,
    completeStreamingMessage,
  }
}

export const useChatState = () => {
  const messages = useChatStore((state) => state.messages)
  const isTyping = useChatStore((state) => state.isTyping)
  const currentRecipeContext = useChatStore((state) => state.currentRecipeContext)
  
  return {
    messages,
    isTyping,
    currentRecipeContext,
  }
}
