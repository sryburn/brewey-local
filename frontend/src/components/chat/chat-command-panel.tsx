'use client'

import { useEffect, useLayoutEffect, useRef, useId, useState } from 'react'
import useChatStore from '@/lib/stores/chat-store'
import type { Conversation } from '@/types/conversation'

export interface ChatCommandPanelProps {
  action: 'resume' | 'delete' | 'status' | 'rename'
  onClose: () => void
}

const buttonClass = 'rounded border border-stone-300 px-3 py-2 text-left disabled:opacity-50 dark:border-stone-600'
const isBusy = () => {
  const state = useChatStore.getState()
  return state.isTyping || state.conversationLoading || state.operationPending || Boolean(state.conversation?.running)
}

function RecipeActivityTags({ conversation }: { conversation: Conversation }) {
  return <span className="mt-1 flex flex-wrap gap-1">
    {conversation.recipes.map((recipe, index) => <span key={recipe.recipeId || index}
      className="rounded bg-stone-100 px-1.5 py-0.5 text-xs dark:bg-stone-700">
      {recipe.recipeTitle}{recipe.deleted ? ' · Deleted' : ''} · {recipe.activities.join(', ')}
    </span>)}
  </span>
}

function DeleteConfirmation({ id, title, onClose, onDeleteStart }: { id: string; title: string; onClose: () => void; onDeleteStart: () => void }) {
  const state = useChatStore()
  const [invalidated, setInvalidated] = useState(false)
  const [pending, setPending] = useState(false)
  const targetChanged = state.conversation?.id !== id
  if (targetChanged && !invalidated) setInvalidated(true)
  const busy = invalidated || targetChanged || pending || state.isTyping || state.conversationLoading || state.operationPending || Boolean(state.conversation?.running)
  const remove = async () => {
    const before = useChatStore.getState()
    if (invalidated || pending || isBusy() || before.conversation?.id !== id) return
    onDeleteStart()
    setPending(true)
    try {
      await before.deleteConversation()
      const after = useChatStore.getState()
      if (after.sessionUserId === before.sessionUserId && !after.conversationError && after.conversation?.id !== id) onClose()
    } finally { setPending(false) }
  }
  return <div className="space-y-3">
    <p>Delete “{title}” and its saved agent conversations permanently? This cannot be undone. Recipe data is preserved.</p>
    <p className="break-all text-xs text-stone-500">Chat ID: {id}</p>
    {invalidated && <p role="alert">The selected chat changed. Close this panel and use /delete again to confirm the current chat.</p>}
    <button type="button" disabled={busy} className={`${buttonClass} text-red-700 dark:text-red-400`} onClick={() => { void remove() }}>Confirm delete</button>
  </div>
}

function RenameConversation({ id, initialTitle, userId, onClose }: { id: string; initialTitle: string; userId: string | null; onClose: () => void }) {
  const state = useChatStore()
  const [title, setTitle] = useState(initialTitle)
  const [pending, setPending] = useState(false)
  const [invalidated, setInvalidated] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const targetChanged = state.conversation?.id !== id || state.sessionUserId !== userId
  if (targetChanged && !invalidated) setInvalidated(true)
  const busy = pending || invalidated || targetChanged || state.isTyping || state.conversationLoading || state.operationPending || Boolean(state.conversation?.running)

  useLayoutEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const save = async () => {
    const before = useChatStore.getState()
    if (busy || isBusy() || before.conversation?.id !== id || before.sessionUserId !== userId) return
    inputRef.current?.focus()
    setPending(true)
    try {
      await before.renameConversation(title)
      const after = useChatStore.getState()
      if (after.sessionUserId !== userId || after.conversation?.id !== id) return
      if (!after.conversationError && after.conversation.title === title.replace(/\s+/g, ' ').trim().normalize('NFC')) onClose()
      else inputRef.current?.focus()
    } finally { setPending(false) }
  }

  return <div className="space-y-3">
    <label className="block space-y-1">
      <span>New chat title</span>
      <input ref={inputRef} type="text" value={title} maxLength={200} readOnly={busy} onChange={event => setTitle(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save() } }}
        className="w-full rounded border border-stone-300 bg-transparent p-2 dark:border-stone-600" />
    </label>
    {invalidated && <p role="alert">The selected chat or account changed. Close this panel and use /rename again.</p>}
    <button type="button" disabled={busy || !title.trim()} className={buttonClass} onClick={() => { void save() }}>Save title</button>
  </div>
}

export default function ChatCommandPanel({ action, onClose }: ChatCommandPanelProps) {
  const state = useChatStore()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [selection, setSelection] = useState<{ id: string; userId: string | null; query: string; results: string } | null>(null)
  const [deleteTarget] = useState(() => state.conversation ? { id: state.conversation.id, title: state.conversation.title || 'Untitled chat' } : null)
  const [renameTarget] = useState(() => state.conversation ? { id: state.conversation.id, title: state.conversation.title, userId: state.sessionUserId } : null)
  const titleId = useId()
  const searchHintId = useId()
  const keyboardHintId = useId()
  const historyListId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const conversation = state.conversation
  const busy = pending || state.isTyping || state.conversationLoading || state.operationPending || Boolean(conversation?.running)
  const titles = { resume: 'Resume saved chat', delete: 'Delete saved chat', status: 'Chat status', rename: 'Rename saved chat' }

  useLayoutEffect(() => {
    if (action === 'resume') searchRef.current?.focus()
    else if (action !== 'rename' || !renameTarget) closeRef.current?.focus()
  }, [action, renameTarget])

  useEffect(() => {
    if (action !== 'resume') return
    useChatStore.getState().cancelConversationSearch()
    const normalized = query.trim()
    const timer = normalized && state.sessionUserId ? window.setTimeout(() => { void useChatStore.getState().searchConversations(normalized) }, 300) : null
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      useChatStore.getState().cancelConversationSearch()
    }
  }, [action, query, state.sessionUserId])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  const resume = async (id: string) => {
    if (pending || searchPending || isBusy()) return
    const before = useChatStore.getState()
    if (!before.sessionUserId || before.sessionUserId !== state.sessionUserId) return
    const latestHistory = normalizedQuery
      ? before.historySearchQuery === normalizedQuery && !before.historySearchLoading ? before.historySearchResults || [] : []
      : before.conversations
    if (!latestHistory.some(chat => chat.id === id && !chat.running)) return
    // Keep focus on an enabled control while navigation disables the choices.
    searchRef.current?.focus()
    setPending(true)
    try {
      await before.selectConversation(id)
      const after = useChatStore.getState()
      if (after.sessionUserId === before.sessionUserId && after.conversation?.id === id && !after.conversationError) onClose()
    } finally { setPending(false) }
  }
  const normalizedQuery = query.trim()
  const matchingQuery = state.historySearchQuery === normalizedQuery
  const searchPending = Boolean(normalizedQuery && (!matchingQuery || state.historySearchLoading))
  const searchError = matchingQuery ? state.historySearchError : null
  const history = normalizedQuery ? matchingQuery ? state.historySearchResults || [] : [] : state.conversations
  // Idle refreshes replace the array even when the visible choices are unchanged.
  const resultIdentity = JSON.stringify(history.map(chat => [chat.id, chat.running]))
  const selectable = busy || searchPending || !state.sessionUserId ? [] : history.filter(chat => !chat.running)
  const activeId = selection && selection.userId === state.sessionUserId && selection.query === normalizedQuery && selection.results === resultIdentity
    && selectable.some(chat => chat.id === selection.id) ? selection.id : null
  // Invalidate before committing a changed result set; Enter cannot target an old row.
  if (selection && !activeId) setSelection(null)
  const optionId = (id: string) => `${historyListId}-${encodeURIComponent(id)}`

  useEffect(() => {
    if (activeId) document.getElementById(`${historyListId}-${encodeURIComponent(activeId)}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeId, historyListId])

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeId) void resume(activeId)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (!selectable.length) return
    const index = selectable.findIndex(chat => chat.id === activeId)
    const next = index === -1 ? event.key === 'ArrowDown' ? 0 : selectable.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length
    setSelection({ id: selectable[next].id, userId: state.sessionUserId, query: normalizedQuery, results: resultIdentity })
  }

  return <section aria-labelledby={titleId} className="mb-3 max-h-[35dvh] overflow-y-auto rounded-lg border border-stone-300 bg-white p-3 text-sm shadow-sm dark:border-stone-600 dark:bg-stone-800 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h2 id={titleId} className="font-semibold">{titles[action]}</h2>
      <button ref={closeRef} type="button" className={buttonClass} aria-label="Close command panel" onClick={onClose}>Close</button>
    </div>
    {conversation?.running && !state.isTyping && <p role="status">This chat is running on another device. Wait for it to finish.</p>}
    {(pending || state.operationPending || state.conversationLoading) && <p role="status">{action === 'rename' && !state.conversationLoading ? 'Saving chat title…' : 'Loading saved chat…'}</p>}
    {state.conversationError && <p role="alert">{state.conversationError}</p>}
    {action === 'resume' && searchPending && <p role="status">Searching saved chats…</p>}
    {action === 'resume' && searchError && <p role="alert">{searchError}</p>}
    {action === 'resume' && <label className="block space-y-1">
      <span>Search saved chats</span>
      <input ref={searchRef} type="search" value={query} aria-describedby={`${searchHintId} ${keyboardHintId}`}
        aria-autocomplete="list" aria-controls={historyListId} aria-activedescendant={activeId ? optionId(activeId) : undefined}
        onKeyDown={onSearchKeyDown} onChange={event => { setSelection(null); setQuery(event.target.value) }}
        className="w-full rounded border border-stone-300 bg-transparent p-2 dark:border-stone-600" />
    </label>}
    {action === 'resume' && <p id={searchHintId} className="text-xs text-stone-500 dark:text-stone-400">Search titles, recipe names, chat IDs and saved message content.</p>}
    {action === 'resume' && <p id={keyboardHintId} className="text-xs text-stone-500 dark:text-stone-400">↑/↓ choose a chat · Enter resume · Esc close</p>}
    {action === 'resume' && <>
      <ul id={historyListId} role="listbox" aria-label="Saved chats" className="space-y-2">{history.map(chat => <li key={chat.id} role="presentation">
        <button type="button" role="option" id={optionId(chat.id)} aria-selected={chat.id === activeId} aria-disabled={busy || searchPending || chat.running}
          disabled={busy || searchPending || chat.running} className={`${buttonClass} w-full ${chat.id === activeId ? 'border-amber-600 bg-amber-50 ring-1 ring-amber-600 dark:border-amber-400 dark:bg-amber-950/40 dark:ring-amber-400' : ''}`}
          onClick={() => { void resume(chat.id) }}>
          <span className="block font-medium">{chat.title || 'Untitled chat'}</span>
          <span className="block text-xs">{new Date(chat.updatedAt).toLocaleString()}{chat.status === 'archived' ? ' · Archived' : ''}{chat.running ? ' · Running' : ''}</span>
          <RecipeActivityTags conversation={chat} />
        </button>
      </li>)}</ul>
      {!history.length && !searchPending && !searchError && !state.conversationLoading && <p>{normalizedQuery ? 'No chats match your search.' : 'No saved chats yet.'}</p>}
    </>}
    {action === 'delete' && (deleteTarget ? <DeleteConfirmation id={deleteTarget.id} title={deleteTarget.title} onClose={onClose} onDeleteStart={() => closeRef.current?.focus()} /> : !state.conversationLoading && <p>No saved chat is selected.</p>)}
    {action === 'rename' && (renameTarget ? <RenameConversation id={renameTarget.id} initialTitle={renameTarget.title} userId={renameTarget.userId} onClose={onClose} /> : !state.conversationLoading && <p>No saved chat is selected.</p>)}
    {action === 'status' && (conversation ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
      <dt>Title</dt><dd>{conversation.title || 'New chat'}</dd>
      <dt>Recipes</dt><dd>{conversation.recipes.length ? <RecipeActivityTags conversation={conversation} /> : 'No recipe activity yet'}</dd>
      <dt>Chat ID</dt><dd className="break-all">{conversation.id}</dd>
      <dt>History</dt><dd>{conversation.status === 'active' ? 'Current chat' : 'Archived chat'}</dd>
      <dt>Running</dt><dd>{state.isTyping ? 'Running here' : conversation.running ? 'Running on another device' : 'Idle'}</dd>
      <dt>Compacted</dt><dd>{conversation.compactedAt ? new Date(conversation.compactedAt).toLocaleString() : 'Not compacted'}{conversation.compactedAt && ' · Full transcript retained'}</dd>
    </dl> : !state.conversationLoading && <p>No saved chat is selected.</p>)}
  </section>
}
