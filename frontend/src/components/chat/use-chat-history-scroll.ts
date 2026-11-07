import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Message } from '@/types/chat'
import useChatStore from '@/lib/stores/chat-store'

/** Prepend saved history without moving the message the reader is looking at. */
export function useChatHistoryScroll(userId: string | undefined, conversationId: string | undefined, messages: Message[]) {
  const paneRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<symbol | null>(null)
  const lastScrollTopRef = useRef(0)
  const followLatestRef = useRef(true)
  const anchorRef = useRef<{ userId: string; conversationId: string; messageId: string; contentTop: number } | null>(null)

  useLayoutEffect(() => {
    lastScrollTopRef.current = paneRef.current?.scrollTop || 0
    followLatestRef.current = true
  }, [userId, conversationId])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const pane = paneRef.current
    if (!anchor || !pane) return
    if (anchor.userId !== userId || anchor.conversationId !== conversationId) {
      anchorRef.current = null
      requestRef.current = null
      return
    }
    if (messages[0]?.id === anchor.messageId) return
    const element = Array.from(pane.querySelectorAll<HTMLElement>('[data-chat-message-id]')).find(node => node.dataset.chatMessageId === anchor.messageId)
    if (element) pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - anchor.contentTop
    anchorRef.current = null
  }, [messages, userId, conversationId])

  const loadAtTop = useCallback(async () => {
    const pane = paneRef.current
    const state = useChatStore.getState()
    if (!pane || pane.scrollTop > 48 || requestRef.current || !userId || !conversationId || state.sessionUserId !== userId || state.conversation?.id !== conversationId || !state.hasOlderMessages || state.conversationLoading || state.operationPending || state.isTyping) return
    const token = Symbol('older messages')
    requestRef.current = token
    const first = pane.querySelector<HTMLElement>('[data-chat-message-id]')
    anchorRef.current = first?.dataset.chatMessageId ? {
      userId, conversationId, messageId: first.dataset.chatMessageId,
      contentTop: first.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop,
    } : null
    try { await state.loadOlderMessages() }
    finally {
      if (requestRef.current === token) {
        requestRef.current = null
        // Failed/empty reads cannot leave an anchor affecting a future refresh.
        if (useChatStore.getState().messages[0]?.id === first?.dataset.chatMessageId) anchorRef.current = null
      }
    }
  }, [userId, conversationId])

  const onHistoryScroll = useCallback(() => {
    const pane = paneRef.current
    const top = pane?.scrollTop || 0
    const previous = lastScrollTopRef.current
    lastScrollTopRef.current = top
    if (pane) followLatestRef.current = pane.scrollHeight - pane.clientHeight - top <= 80
    // Initial smooth scrolling to the newest message must not fetch old history.
    if (top < previous) void loadAtTop()
  }, [loadAtTop])

  // If one batch does not fill the viewport, keep filling until scrolling works.
  useEffect(() => {
    const pane = paneRef.current
    if (pane && pane.clientHeight > 0 && pane.scrollHeight <= pane.clientHeight) void loadAtTop()
  }, [messages, loadAtTop])

  return { paneRef, onHistoryScroll, followLatestRef }
}
