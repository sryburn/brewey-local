'use client'

import useChatStore from '@/lib/stores/chat-store'

export default function ConversationHeader() {
  const conversation = useChatStore(state => state.conversation)
  const loading = useChatStore(state => state.conversationLoading)
  const pending = useChatStore(state => state.operationPending)
  const typing = useChatStore(state => state.isTyping)
  const error = useChatStore(state => state.conversationError)
  if (!loading && !pending && !typing && !conversation?.running && !error) return null

  return (
    <div aria-label="Chat status" className="flex-shrink-0 space-y-1 px-4 py-2 text-xs text-stone-600 dark:text-stone-400">
      <div aria-live="polite" className="space-y-1">
        {loading && <p role="status">Loading saved chat…</p>}
        {!loading && pending && <p role="status">Updating saved chat…</p>}
        {conversation?.running && !typing && <p role="status">Running on another device · Waiting for it to finish…</p>}
        {typing && <p role="status">Reply in progress…</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )
}
