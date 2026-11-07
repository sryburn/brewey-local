import { useState, useRef, useEffect, useLayoutEffect, useId } from 'react'
import { useRouter } from 'next/navigation'
import { debug } from '@/lib/debug'
import { responsiveUtils } from '@/lib/design-system'
import { useMobile, usePointerType } from '@/lib/hooks/useMobile'
import useChatStore from '@/lib/stores/chat-store'
import { commandRegistry } from '@/lib/slash-commands/commands'
import { matchSlashCommands, parseSlashCommand } from '@/lib/slash-commands/utils'
import ChatCommandPanel from './chat-command-panel'
import ReactMarkdown from 'react-markdown'
import { isSlashCommand, executeSlashCommand } from '@/lib/slash-commands'
import type { FileAttachment } from '@/types/attachments'
import { useFileUpload } from '@/lib/hooks/useFileUpload'
import type { ConversationMetadata } from '@/lib/types/conversation'

interface ChatInputProps {
  onSendMessage: (
    message: string, 
    fileAttachment?: FileAttachment,
    onMessagesCreated?: (userMessageId: string, assistantMessageId: string) => void
  ) => Promise<void>
  onStopMessage?: () => void
  onClearHistory?: () => void | Promise<void>
  onCompact?: () => void | Promise<void>
  onMobileRecipeCollapse?: () => void
  sendBlocked?: boolean
  disabled?: boolean
  isStreaming?: boolean
  placeholder?: string
  hasMessages?: boolean
  conversationMetadata?: ConversationMetadata
  onExitImportMode?: () => void
  onSetInputText?: React.MutableRefObject<((text: string, autoSubmit?: boolean) => void) | null>
  focusHandoffRef?: React.MutableRefObject<boolean>
}

export default function ChatInput({
  onSendMessage,
  onStopMessage,
  onClearHistory,
  onCompact,
  onMobileRecipeCollapse,
  disabled = false,
  sendBlocked = false,
  isStreaming = false,
  placeholder = "Let's talk beer!",
  conversationMetadata,
  onExitImportMode,
  onSetInputText,
  focusHandoffRef
}: ChatInputProps) {
  const router = useRouter()
  const chat = useChatStore()
  const availableCommands = commandRegistry
  const [panel, setPanel] = useState<'resume' | 'delete' | 'status' | 'rename' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [commandPending, setCommandPending] = useState(false)
  const commandLock = useRef(false)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const [selectedCommand, setSelectedCommand] = useState(0)
  const commandListId = useId()
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [shouldRefocus, setShouldRefocus] = useState(false)
  
  // Simple stop functionality tracking
  const [lastSubmission, setLastSubmission] = useState<{
    text: string
    userMessageId: string
    assistantMessageId: string
  } | null>(null)
  
  // Flag to prevent auto-submission after stop
  const isStoppingRef = useRef(false)
  const hasFinePointer = usePointerType()
  const isMobile = useMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatInputContainerRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Conversation changes remount the composer to discard drafts and attachments.
  // Carry deliberate focus across that boundary, including on touch devices.
  useLayoutEffect(() => {
    const form = chatInputContainerRef.current
    if (focusHandoffRef?.current && !disabled) {
      textareaRef.current?.focus()
      focusHandoffRef.current = false
    }
    return () => {
      if (focusHandoffRef && form?.contains(document.activeElement)) focusHandoffRef.current = true
    }
  }, [focusHandoffRef, disabled])

  // File upload hook with native file callback
  const {
    uploadedFile,
    fileError,
    handleFileUpload,
    removeUploadedFile,
    clearFileError
  } = useFileUpload({
    onNativeFileDetected: (file) => {
      debug.log('🏠 Auto-importing native .brewey file:', file.name)
      onSendMessage(`Import native recipe: ${file.name}`, file)
    }
  })

  // Dynamic placeholder text based on import mode state
  const hasInitialUpload = uploadedFile && conversationMetadata?.mode !== 'import'
  const isOngoingImportMode = conversationMetadata?.mode === 'import' && conversationMetadata?.importFile
  const isImportMode = hasInitialUpload || isOngoingImportMode // Either initial upload or ongoing import session
  
  const dynamicPlaceholder = hasInitialUpload
    ? "Add instructions for import, eg scale to my usual batch size"
    : isOngoingImportMode 
      ? "Discuss your file import"
      : placeholder

  const suggestions = suggestionsDismissed ? [] : matchSlashCommands(message, availableCommands)
  const selectedSuggestion = suggestions[Math.min(selectedCommand, suggestions.length - 1)]
  const showSuggestions = !suggestionsDismissed && /^\/[^\s]*$/.test(message.trimStart())

  useEffect(() => {
    if (selectedSuggestion) document.getElementById(`${commandListId}-${selectedSuggestion.name}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedSuggestion, commandListId])

  const runCommand = async (input: string) => {
    if (disabled || commandLock.current) return
    textareaRef.current?.focus()
    const { command, args } = parseSlashCommand(input)
    const state = useChatStore.getState()
    const busy = state.isTyping || state.operationPending || state.conversationLoading || state.conversation?.running || isSending || isStreaming
    if (busy && !['status', 'stop'].includes(command)) {
      setNotice('Wait for the current operation to finish, or use /stop to stop a response on this device.')
      return
    }
    // Management commands do not accept silently ignored arguments.
    if (args.length && commandRegistry[command]?.execute && !['export', 'print', 'debug', 'rename'].includes(command)) {
      setNotice(`Use /${command} without arguments.`)
      return
    }
    commandLock.current = true
    setCommandPending(true)
    setPanel(null)
    setNotice(null)
    setSuggestionsDismissed(true)
    try {
      const result = await executeSlashCommand(input, availableCommands)
      if (result.success) setMessage('')
      switch (result.specialAction) {
        case 'resume': case 'delete': case 'status':
          setPanel(result.specialAction); break
        case 'clear':
          if (onClearHistory) await onClearHistory()
          else await state.newConversation()
          break
        case 'compact':
          if (onCompact) await onCompact()
          else await state.compactConversation()
          break
        case 'rename':
          if (args.length) {
            const userId = state.sessionUserId
            const id = state.conversation?.id
            await state.renameConversation(args.join(' '))
            const after = useChatStore.getState()
            if (after.sessionUserId === userId && after.conversation?.id === id && after.conversationError) {
              setNotice(after.conversationError)
              setMessage(input)
            }
          } else setPanel('rename')
          break
        case 'reload': await state.refreshConversation(true); break
        case 'settings': router.push('/settings?tab=chat'); break
        case 'profile': router.push('/settings?tab=profile'); break
        case 'import': fileInputRef.current?.click(); break
        case 'cancel-import': removeUploadedFile(); onExitImportMode?.(); break
        case 'stop':
          if (isStreaming) onStopMessage?.()
          else setNotice('There is no response running on this device.')
          break
        default: if (result.message) setNotice(result.message)
      }
    } catch (error) {
      setNotice(`Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      commandLock.current = false
      setCommandPending(false)
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const scrollHeight = textarea.scrollHeight
      const maxHeight = 200
      if (scrollHeight <= maxHeight) {
        textarea.style.height = scrollHeight + 'px'
        textarea.style.overflowY = 'hidden'
      } else {
        textarea.style.height = maxHeight + 'px'
        textarea.style.overflowY = 'auto'
      }
    }
  }, [message])

  // Dynamic height tracking for mobile recipe panel positioning
  useEffect(() => {
    const container = chatInputContainerRef.current
    if (!container) return

    const updateHeight = () => {
      const height = container.offsetHeight
      document.documentElement.style.setProperty('--chat-input-height', `${height}px`)
    }

    updateHeight()

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(updateHeight)
      resizeObserver.observe(container)
      return () => { resizeObserver.disconnect() }
    }
  }, [])


  // Focus textarea on initial page load
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea && !disabled) {
      // Small delay to ensure the DOM has fully rendered
      const timeoutId = setTimeout(() => {
        // Only auto-focus on devices with fine pointers (mouse/trackpad)
        // This prevents mobile keyboards from auto-launching on page load
        if (hasFinePointer && document.activeElement === document.body) {
          textarea.focus()
        }
      }, 100)

      return () => clearTimeout(timeoutId)
    }
  }, [disabled, hasFinePointer]) // Only run on mount and when disabled/hasFinePointer changes

  // Refocus textarea when it becomes available again after sending
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea && shouldRefocus && !disabled && !isSending) {
      // Small delay to ensure the DOM has updated
      const timeoutId = setTimeout(() => {
        // Only auto-focus on devices with fine pointers (mouse/trackpad)
        // This prevents mobile keyboards from auto-launching after messages
        if (hasFinePointer && document.activeElement === document.body) {
          textarea.focus()
        }
        setShouldRefocus(false)
      }, 50)

      return () => clearTimeout(timeoutId)
    }
  }, [disabled, isSending, shouldRefocus, hasFinePointer])






  // Handle touch events to prevent page scrolling when textarea is scrollable
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const handleTouchStart = (e: TouchEvent) => {
      // Check if textarea content is scrollable
      const isScrollable = textarea.scrollHeight > textarea.clientHeight
      
      if (isScrollable) {
        // Allow textarea to handle its own scrolling
        e.stopPropagation()
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      // Check if textarea content is scrollable
      const isScrollable = textarea.scrollHeight > textarea.clientHeight
      
      if (isScrollable) {
        // Prevent page scrolling when textarea needs to scroll
        const isAtTop = textarea.scrollTop === 0
        const isAtBottom = textarea.scrollTop + textarea.clientHeight >= textarea.scrollHeight
        
        // Get touch direction
        const touch = e.touches[0]
        const startY = touch.clientY
        
        // Only prevent if we're not at boundaries or trying to scroll in available direction
        if ((!isAtTop && !isAtBottom) || 
            (isAtTop && startY < textarea.getBoundingClientRect().bottom) ||
            (isAtBottom && startY > textarea.getBoundingClientRect().top)) {
          e.stopPropagation()
        }
      }
    }

    textarea.addEventListener('touchstart', handleTouchStart, { passive: false })
    textarea.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      textarea.removeEventListener('touchstart', handleTouchStart)
      textarea.removeEventListener('touchmove', handleTouchMove)
    }
  }, [message]) // Re-run when message changes as scrollability might change

  // Clear lastSubmission when streaming completes normally
  useEffect(() => {
    if (!isStreaming && lastSubmission) {
      setLastSubmission(null)
    }
  }, [isStreaming, lastSubmission])

  // Expose setMessage function to parent component via ref
  useEffect(() => {
    if (onSetInputText) {
      onSetInputText.current = (text: string, autoSubmit = false) => {
        setMessage(text)
        textareaRef.current?.focus()
        
        if (autoSubmit) {
          // Use setTimeout to ensure the state update happens first
          setTimeout(() => {
            const form = textareaRef.current?.closest('form')
            if (form) {
              form.requestSubmit()
            }
          }, 0)
        }
      }
    }
  }, [onSetInputText])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Block submission if we're in the middle of stopping
    if (isStoppingRef.current) {
      return
    }

    const trimmedMessage = message.trim()
    if (!trimmedMessage || disabled) return
    if (isSlashCommand(trimmedMessage)) {
      await runCommand(trimmedMessage)
      return
    }
    if (isSending || isStreaming || sendBlocked || commandPending) return
    setPanel(null)
    setNotice(null)

    // Continue with regular message processing
    // Store text for stop functionality before clearing
    setLastSubmission({ 
      text: trimmedMessage, 
      userMessageId: '', 
      assistantMessageId: '' 
    })
    
    // Clear the input immediately and mark for refocus
    setMessage('')
    setIsSending(true)
    setShouldRefocus(true)

    try {
      // In import mode, use the file from appropriate source
      const fileToSend = hasInitialUpload
        ? uploadedFile // Use uploaded file for initial import message
        : isOngoingImportMode && conversationMetadata?.importFile 
          ? {
              id: conversationMetadata.importFile.id,
              name: conversationMetadata.importFile.name,
              type: 'text' as const,
              size: conversationMetadata.importFile.size,
              content: conversationMetadata.importFile.content,
              mimeType: conversationMetadata.importFile.mimeType
            }
          : undefined

      await onSendMessage(
        trimmedMessage, 
        fileToSend,
        // Callback to get message IDs immediately when created
        (userMessageId, assistantMessageId) => {
          setLastSubmission({
            text: trimmedMessage,
            userMessageId,
            assistantMessageId
          })
        }
      )
      
      // Clear uploaded file after initial import message (it moves to conversation metadata)
      // Don't clear during ongoing import mode (file persists in metadata)
      if (hasInitialUpload) {
        removeUploadedFile()
      }
    } catch (error) {
      debug.error('Failed to send message:', error)
      // Clear lastSubmission on error
      setLastSubmission(null)
    } finally {
      setIsSending(false)
    }
  }

  const handleStop = () => {
    // Set flag to prevent auto-submission
    isStoppingRef.current = true
    
    if (onStopMessage) {
      onStopMessage()
    }
    
    // Keep accepted input and partial output in the authoritative saved transcript.
    // A stopped turn may already have mutated a recipe; never prepare an automatic resend.
    setLastSubmission(null)
    isStoppingRef.current = false
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setSuggestionsDismissed(true)
      setPanel(null)
      setNotice(null)
      return
    }
    if (showSuggestions && suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommand(index => (index + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
        return
      }
      if (selectedSuggestion && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
        e.preventDefault()
        if (e.key === 'Tab') {
          setMessage(`/${selectedSuggestion.name}`)
          setSelectedCommand(0)
        } else void runCommand(`/${selectedSuggestion.name}`)
        return
      }
    }
    if (isStreaming && !isSlashCommand(message)) return

    // On touch devices, Enter creates new line, only Shift+Enter submits
    // On pointer devices, Enter submits, Shift+Enter creates new line
    const isPointerDevice = hasFinePointer
    
    if (e.key === 'Enter') {
      if (isPointerDevice) {
        // Pointer device behavior: Enter = submit, Shift+Enter = new line
        if (!e.shiftKey) {
          e.preventDefault()
          handleSubmit(e)
        }
        // Let Shift+Enter create new line naturally (don't prevent default)
      } else {
        // Touch device behavior: Enter = new line, Shift+Enter = submit
        if (e.shiftKey) {
          e.preventDefault()
          handleSubmit(e)
        }
        // Let Enter key create new line naturally (don't prevent default)
      }
    }
  }

  // Update disabled logic - input stays enabled during streaming
  const isInputDisabled = disabled
  const isSubmitDisabled = disabled || commandPending || !message.trim() || (!isSlashCommand(message) && (sendBlocked || isSending || isStreaming))

  return (
    <form
      ref={chatInputContainerRef}
      onSubmit={handleSubmit}
      className=""
      onClick={(e) => {
        // On mobile, tap on chat input area should collapse recipe panel
        if (onMobileRecipeCollapse && isMobile) {
          // Only trigger if not clicking on buttons (allow textarea clicks)
          const target = e.target as HTMLElement
          if (!target.closest('button, input[type="button"]')) {
            onMobileRecipeCollapse()
          }
        }
      }}
    >
      {/* Hidden file input */}
      <input
        id="file-upload"
        name="file-upload"
        type="file"
        ref={fileInputRef}
        accept=".json,.xml,.txt,.bsmx,.yaml,.yml,.brewey,application/json,text/xml,text/plain,application/xml,text/yaml,application/x-yaml"
        onChange={handleFileUpload}
        className="hidden"
      />

      <div className="relative p-4">
        {showSuggestions && (
          <div className="absolute bottom-full left-4 right-4 z-30 overflow-hidden rounded-xl border border-stone-300 bg-white shadow-lg dark:border-stone-600 dark:bg-stone-900">
            <div className="border-b border-stone-200 px-3 py-2 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">Commands · tap to run<span className="hidden md:inline"> · ↑↓ select · Tab complete · Enter run · Esc close</span></div>
            <ul id={commandListId} role="listbox" aria-label="Slash commands" className="max-h-[min(40dvh,20rem)] overflow-y-auto p-1">
              {suggestions.map(command => (
                <li key={command.name} role="option" id={`${commandListId}-${command.name}`} aria-selected={command.name === selectedSuggestion?.name}
                  className={`rounded-lg ${command.name === selectedSuggestion?.name ? 'bg-stone-100 dark:bg-stone-800' : ''}`}>
                  <button type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => { void runCommand(`/${command.name}`) }}
                    className="w-full px-3 py-2.5 text-left text-sm text-stone-900 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800">
                    <span className="font-semibold">/{command.name}</span>{' '}<span className="ml-2 text-xs text-stone-600 dark:text-stone-400">{command.description}</span>
                  </button>
                </li>
              ))}
              {!suggestions.length && <li className="px-3 py-3 text-sm text-stone-500">No matching command. Type / to see available commands.</li>}
            </ul>
          </div>
        )}
        {panel && <ChatCommandPanel key={panel} action={panel} onClose={() => { setPanel(null); textareaRef.current?.focus() }} />}
        {notice && <div role="status" className="mb-3 max-h-[30dvh] overflow-y-auto rounded-lg border border-stone-300 p-3 text-sm dark:border-stone-600">
          <button type="button" className="float-right ml-2 text-xs underline" onClick={() => { setNotice(null); textareaRef.current?.focus() }}>Dismiss</button><ReactMarkdown>{notice}</ReactMarkdown>
        </div>}
        {commandPending && <p role="status" className="mb-2 text-xs text-stone-500">Running command…</p>}
        {/* File error message */}
        {fileError && (
          <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start space-x-2">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-red-800 dark:text-red-200">{fileError}</p>
              </div>
              <button
                type="button"
                onClick={clearFileError}
                className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 p-1"
                aria-label="Dismiss error"
                title="Dismiss error"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* File preview - show either uploaded file or import mode file */}
        {(uploadedFile || (isImportMode && conversationMetadata?.importFile)) && (
          <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {isOngoingImportMode && conversationMetadata?.importFile 
                    ? conversationMetadata.importFile.name 
                    : uploadedFile?.name
                  }
                </span>
                <span className="text-xs text-blue-600 dark:text-blue-400">
                  ({Math.round((isOngoingImportMode && conversationMetadata?.importFile 
                    ? conversationMetadata.importFile.size 
                    : uploadedFile?.size || 0) / 1024)}KB)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isOngoingImportMode && onExitImportMode) {
                    // Exit ongoing import mode (clears conversation metadata)
                    onExitImportMode()
                  } else if (uploadedFile) {
                    // Remove uploaded file (initial upload or normal mode)
                    removeUploadedFile()
                  }
                }}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 p-1"
                aria-label={isOngoingImportMode ? "Remove file and exit import mode" : "Remove file"}
                title={isOngoingImportMode ? "Remove file and exit import mode" : "Remove file"}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className="flex items-end space-x-3">
          <div className="min-w-0 flex-1 relative rounded-lg border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-amber-500 dark:border-stone-600 dark:bg-stone-700">
            <textarea
              id="chat-message-input"
              name="chat-message-input"
              ref={textareaRef}
              value={message}
              onChange={(e) => { setMessage(e.target.value); setSelectedCommand(0); setSuggestionsDismissed(false) }}
              onKeyDown={handleKeyDown}
              placeholder={dynamicPlaceholder}
              disabled={isInputDisabled}
              rows={1}
              className="block w-full resize-none rounded-lg bg-transparent px-4 py-3 focus:outline-none text-gray-900 dark:!text-stone-100 placeholder-gray-500 dark:placeholder-stone-400 disabled:cursor-not-allowed chat-input-scrollbar"
              style={{
                minHeight: '48px',
                maxHeight: '200px',
                touchAction: 'pan-y' // Allow vertical scrolling, prevent horizontal
              }}
              aria-label="Chat message"
              aria-autocomplete="list"
              aria-controls={showSuggestions ? commandListId : undefined}
              aria-activedescendant={showSuggestions && selectedSuggestion ? `${commandListId}-${selectedSuggestion.name}` : undefined}
              autoComplete="off"
            />


          </div>




          {/* Submit/Stop Button Toggle */}
          {isStreaming ? (
            // Stop button when streaming
            <button
              type="button"
              onClick={handleStop}
              data-testid="stop-message-button"
              aria-label="Stop generating response"
              title="Stop generating response"
              className="flex-shrink-0 rounded-lg focus:outline-none focus:ring-2 transition-colors flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 focus:ring-gray-400"
              style={{ height: '48px', width: '48px', padding: '12px' }}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            </button>
          ) : (
            // Regular submit button
            <button
              type="submit"
              disabled={isSubmitDisabled}
              data-testid="send-message-button"
              aria-label={isSending ? "Sending message" : "Send message"}
              title={isSending ? "Sending message" : "Send message"}
              className="flex-shrink-0 rounded-lg focus:outline-none focus:ring-2 transition-colors flex items-center justify-center bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-500 disabled:bg-gray-300 dark:disabled:bg-stone-600 disabled:cursor-not-allowed"
              style={{ height: '48px', width: '48px', padding: '12px' }}
            >
              {isSending ? (
                <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Help text - Desktop only */}
        <div className="mt-2 text-xs text-gray-500 dark:text-stone-400 max-md:hidden">
          {isStreaming 
            ? "Click stop to halt response" 
            : "Press Enter to send, Shift+Enter for new line"
          }
        </div>

        {/* Desktop shortcuts use exactly the same dispatcher as typed commands. */}
        <div className={`${responsiveUtils.mobile.visibility.hideOnMobileBlock} mt-3`}>
          <div className="flex flex-wrap gap-2">
            {[['new', 'New chat'], ['resume', 'Resume'], ['compact', 'Compact']].map(([command, label]) => (
              <button key={command} type="button" title={`/${command}`} onClick={() => { void runCommand(`/${command}`) }} disabled={disabled || commandPending || chat.operationPending || chat.conversationLoading || chat.conversation?.running || isSending || isStreaming}
                className="rounded-md border border-stone-200 px-2.5 py-1.5 text-xs text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-40 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800">{label}</button>
            ))}
          </div>
        </div>
      </div>
    </form>
  )
}
