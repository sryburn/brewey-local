'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useChatActions, useChatState } from '@/lib/stores/chat-store'
import useChatStore from '@/lib/stores/chat-store'
import type { StreamingEvent, Message, ToolCall } from '@/types/chat'
import type { ConversationMetadata } from '@/lib/types/conversation'
import type { FileAttachment } from '@/types/attachments'
import { debug } from '@/lib/debug'
import { useMobile } from '@/lib/hooks/useMobile'
import { debugLogger } from '@/lib/debug-logger'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { shouldTriggerUpdate, getUpdateAction, getRecipeDataFromToolResult, type MCPAllResults } from '@/lib/recipe-updates/trigger-update'
import { isNativeBreweyFormat } from '@/lib/utils/file-processing'
import { importNativeRecipe } from '@/lib/utils/native-import'

import UserMessage from './user-message'
import AssistantMessage from './assistant-message'
import SystemMessage from './system-message'
import ActionMessage from './action-message'
import ChatInput from './chat-input'
import ConversationHeader from './conversation-header'
import { useChatHistoryScroll } from './use-chat-history-scroll'

interface ChatContainerProps {
  onRecipeUpdate?: (recipeId: string) => void
  onMobileRecipeCollapse?: () => void
  isMobileRecipeExpanded?: boolean
}

export default function ChatContainer({ onRecipeUpdate, onMobileRecipeCollapse, isMobileRecipeExpanded }: ChatContainerProps) {
  const { user } = useAuth()
  const { messages, currentRecipeContext, isTyping } = useChatState()
  const conversation = useChatStore(state => state.conversation)
  const conversationLoading = useChatStore(state => state.conversationLoading)
  const operationPending = useChatStore(state => state.operationPending)
  const hasOlderMessages = useChatStore(state => state.hasOlderMessages)
  const { addMessage, startStreamingMessage, appendToStreamingMessage, completeStreamingMessage, updateMessage, setCurrentRecipeContext } = useChatActions()
  const { paneRef, onHistoryScroll, followLatestRef } = useChatHistoryScroll(user?.id, conversation?.id, messages)
  
  // Wrapper for clearHistory that also resets conversation metadata
  const handleClearHistory = useCallback(async () => {
    await useChatStore.getState().newConversation()
    setConversationMetadata({ mode: 'normal' })
  }, [])
  
  // Recipe store actions for triggering updates after tool calls
  const { 
    userRecipes,
    loading,
    setUserId,
    triggerRefreshList, 
    triggerRefreshDetails,
    updateRecipeMetadata,
    addRecipeToList,
    removeRecipeFromList,
    updateSingleGrain,
    updateSingleHop,
    updateSingleYeast,
    updateSingleMisc,
    updateSingleWater,
    removeSingleGrain,
    removeSingleHop,
    removeSingleYeast,
    removeSingleMisc,
    removeSingleWater,
    switchToRecipe
  } = useRecipeStore()


  const [isInitialized, setIsInitialized] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const isMobile = useMobile()
  
  // Ref to set input text from external components
  const setInputTextRef = useRef<((text: string, autoSubmit?: boolean) => void) | null>(null)
  const composerFocusHandoffRef = useRef(false)

  // Conversation metadata for import mode management
  const [conversationMetadata, setConversationMetadata] = useState<ConversationMetadata>({ mode: 'normal' })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const identityGenerationRef = useRef(0)
  const activeAssistantIdRef = useRef<string | null>(null)

  // Invalidate work on account changes and unmount, including responses that ignore abort.
  useEffect(() => {
    identityGenerationRef.current += 1
    setConversationMetadata({ mode: 'normal' })
    setIsInitialized(Boolean(user?.id))
    return () => {
      identityGenerationRef.current += 1
      abortControllerRef.current?.abort()
      if (activeAssistantIdRef.current) completeStreamingMessage(activeAssistantIdRef.current)
      activeAssistantIdRef.current = null
      abortControllerRef.current = null
      useChatStore.getState().setTyping(false)
    }
  }, [user?.id, conversation?.id, completeStreamingMessage])

  // Saved history is fetched for the verified account; browser transcripts are never imported.
  useEffect(() => {
    if (!user?.id) return
    void useChatStore.getState().initializeConversations(user.id)
    const refresh = () => { if (document.visibilityState !== 'hidden') void useChatStore.getState().refreshConversation() }
    const interval = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [user?.id])

  const lastMessage = messages.at(-1)
  // Keep older-page loading from jumping the reader to the bottom.
  useEffect(() => {
    if (followLatestRef.current) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.id, lastMessage?.id, lastMessage?.content, followLatestRef])

  // Initialize chat when user is available
  useEffect(() => {
    if (user?.id && !isInitialized) {
      setIsInitialized(true)
      setInitError(null)
    }
  }, [user?.id, isInitialized])

  // Track recipe context changes in debug logger
  useEffect(() => {
    if (currentRecipeContext) {
      debugLogger.setCurrentRecipe(currentRecipeContext)
    }
  }, [currentRecipeContext])

  // Set user ID in recipe store when user is available
  useEffect(() => {
    if (user?.id) {
      setUserId(user.id)
    }
  }, [user?.id, setUserId])

  // Derive streaming state from messages
  const isStreaming = isTyping

  // Handle stopping the AI response
  const handleStopMessage = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  const sendMessage = useCallback(async (
    content: string, 
    fileAttachment?: FileAttachment, 
    onMessagesCreated?: (userMessageId: string, assistantMessageId: string) => void,
    options?: { hideUserMessage?: boolean }
  ) => {
    if (!user?.id) {
      addMessage({
        type: 'system',
        content: 'Please sign in to use the chat feature.'
      })
      return
    }

    const currentChat = useChatStore.getState()
    const savedConversation = currentChat.conversation
    // A file read may complete after its composer/account/conversation has changed.
    // Validate the originating closure before accepting any message or native import.
    if (currentChat.sessionUserId !== user.id || savedConversation?.id !== conversation?.id ||
      !savedConversation ||
      currentChat.isTyping || currentChat.conversationLoading || currentChat.operationPending ||
      savedConversation.running) return
    followLatestRef.current = true
    useChatStore.getState().setTyping(true)
    const requestGeneration = identityGenerationRef.current
    const requestController = new AbortController()
    abortControllerRef.current?.abort()
    if (activeAssistantIdRef.current) completeStreamingMessage(activeAssistantIdRef.current)
    activeAssistantIdRef.current = null
    abortControllerRef.current = requestController
    const ownsIdentity = () => identityGenerationRef.current === requestGeneration && useChatStore.getState().conversation?.id === savedConversation.id
    const canProcess = () => ownsIdentity() && !requestController.signal.aborted && abortControllerRef.current === requestController

    // Prepare conversation metadata BEFORE API call
    let currentMetadata = conversationMetadata
    
    // Handle import mode transition - enter import mode if file is attached
    if (fileAttachment) {
      // Check if this is a native Brewey format file
      if (isNativeBreweyFormat(fileAttachment.content)) {
        debug.log('🏠 Detected native Brewey format file, processing directly')
        
        
        // Process native import directly
        try {
          const result = await importNativeRecipe(fileAttachment.content, user.id)
          if (!canProcess()) return
          
          if (result.success) {
            // Record this explicit current-user activity without importing file contents
            // or pretending the local client produced an assistant/tool message.
            try {
              await useChatStore.getState().appendNote(`Imported recipe: ${result.recipeName || 'Untitled recipe'}`)
            } catch {
              if (canProcess()) useChatStore.getState().setConversationError('The recipe was imported, but its chat activity note could not be saved. Do not repeat the import; reload your recipe library.')
            }
            if (!canProcess()) return

            // Refresh the recipe store and select the new recipe
            const recipeStore = useRecipeStore.getState()
            await recipeStore.loadUserRecipes(user.id, false)
            if (!canProcess()) return
            if (result.recipeId) {
              recipeStore.setSelectedRecipe(result.recipeId)
              setCurrentRecipeContext(result.recipeId)
              onRecipeUpdate?.(result.recipeId)
            }
            
          } else {
            // Import failed
            let errorMessage = `❌ **Native import failed**: ${result.error}`
            
            if (result.missingIngredients && result.missingIngredients.length > 0) {
              errorMessage += `\n\n**Missing ingredients:**\n${result.missingIngredients.map(ing => 
                `- ${ing.type}: ${ing.id}`
              ).join('\n')}`
            }
            
            addMessage({
              type: 'system',
              content: errorMessage
            })
          }
          
        } catch (error) {
          if (!canProcess()) return
          debug.error('❌ Native import error:', error)
          addMessage({
            type: 'system',
            content: `❌ **Import failed**: ${error instanceof Error ? error.message : 'Unknown error'}`
          })
        } finally {
          if (abortControllerRef.current === requestController) abortControllerRef.current = null
          if (ownsIdentity()) useChatStore.getState().setTyping(false)
        }
        
        return // Exit early, don't proceed with AI processing
      }
      
      // Not native format, proceed with normal import mode
      currentMetadata = {
        mode: 'import',
        importFile: {
          id: fileAttachment.id,
          name: fileAttachment.name,
          content: fileAttachment.content,
          mimeType: fileAttachment.mimeType,
          size: fileAttachment.size,
          uploadedAt: new Date().toISOString()
        },
        lastActivity: new Date().toISOString()
      }
      
      // Update state for future calls
      setConversationMetadata(currentMetadata)
    }

    // Add user message (unless hidden) and capture ID
    let userMessageId = ''
    if (!options?.hideUserMessage) {
      userMessageId = addMessage({
        type: 'user',
        content
      })
      // Log user message to debug logger
      debugLogger.logUserMessage(content)
    }

    // Create assistant message with streaming metadata
    const assistantMessage = {
      type: 'assistant' as const,
      content: '',
      metadata: {
        isStreaming: true,
        isComplete: false
      }
    }

    // Add the message and get its ID
    let assistantMessageId = addMessage(assistantMessage)
    activeAssistantIdRef.current = assistantMessageId
    
    // Call callback immediately with message IDs for stop functionality
    if (onMessagesCreated && userMessageId) {
      onMessagesCreated(userMessageId, assistantMessageId)
    }

    let streamError: string | null = null
    let responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      // Call our streaming API route
      const selectedAdapter = user?.user_metadata?.agentAdapter || 'codex'
      const adapterPreferences = user?.user_metadata?.agentPreferences?.[selectedAdapter]
      const legacyPreferences = selectedAdapter === 'codex' ? {
        model: user?.user_metadata?.codexModel,
        reasoningEffort: user?.user_metadata?.codexReasoningEffort,
        verbosity: user?.user_metadata?.codexVerbosity,
      } : undefined
      const chatPreferences = adapterPreferences || legacyPreferences
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          model: chatPreferences?.model || undefined,
          reasoningEffort: chatPreferences?.reasoningEffort || undefined,
          verbosity: chatPreferences?.verbosity || undefined,
          conversationId: savedConversation.id,
          requestId: crypto.randomUUID(),
          currentRecipeId: currentRecipeContext, // Current preview is independent of saved chat history.
          conversationMetadata: currentMetadata.mode === 'import'
            ? { mode: 'import', importFile: currentMetadata.importFile }
            : { mode: 'chat' } // Only the route's supported wire fields.
        }),
        signal: requestController.signal
      })
      if (!canProcess()) {
        void response.body?.cancel?.().catch(() => {})
        return
      }

      if (!response.ok) {
        const errorData = await response.json()
        if (!canProcess()) return
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body received')
      }

      // Start streaming message
      startStreamingMessage(assistantMessageId)

      // Process the stream
      const reader = response.body.getReader()
      responseReader = reader
      const decoder = new TextDecoder()
      let buffer = ''
      let textBuffer = '' // Accumulate text chunks between tool calls
      let streamCompleted = false

      while (true) {
        const { done, value } = await reader.read()
        if (!canProcess()) return
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        let sawDone = false
        for (const line of lines) {
          if (!canProcess()) return
          if (line.trim() === '') continue

          if (line.startsWith('data: ')) {
            let data: StreamingEvent
            try {
              data = JSON.parse(line.slice(6)) as StreamingEvent
            } catch (parseError) {
              debug.error('Failed to parse streaming data:', parseError)
              continue
            }

            if (data.type === 'conversation') {
              if (data.conversation_id !== savedConversation.id) throw new Error('Chat response belongs to another conversation.')
              if (data.user_message_id && userMessageId) {
                updateMessage(userMessageId, { id: data.user_message_id })
                userMessageId = data.user_message_id
              }
              if (data.assistant_message_id) {
                updateMessage(assistantMessageId, { id: data.assistant_message_id, turnId: data.turn_id })
                assistantMessageId = data.assistant_message_id
                activeAssistantIdRef.current = assistantMessageId
              }
              onMessagesCreated?.(userMessageId, assistantMessageId)
            } else if (data.type === 'context_compacted' || data.type === 'context_restored') {
              // The authoritative transcript will contain the saved context notice.
              useChatStore.getState().setConversationError(data.content || 'Chat context updated; full saved history is retained.')
            } else if (data.type === 'text' && data.content) {
              // Append text to the streaming message
              appendToStreamingMessage(assistantMessageId, data.content)
              // Accumulate text for sequential logging
              textBuffer += data.content
              // Keep the summary available; clear only transient tool status.
              updateMessage(assistantMessageId, (currentMessage: Message) => ({
                metadata: {
                  ...currentMessage.metadata,
                  statusMessages: undefined,
                  isExecutingTool: false
                }
              }))
            } else if (data.type === 'reasoning' && data.content) {
              // Retain a bounded summary across answer text and tool rounds.
              updateMessage(assistantMessageId, (currentMessage: Message) => ({
                metadata: {
                  ...currentMessage.metadata,
                  reasoningPreview: ((currentMessage.metadata?.reasoningPreview || '') + data.content).slice(-4000)
                }
              }))
            } else if (data.type === 'tool_call') {
              // Log any accumulated text before tool call
              if (textBuffer.trim()) {
                debugLogger.logChatbotResponse(textBuffer.trim())
                textBuffer = '' // Reset buffer
              }
              
              // Debug tool call data
              debug.log('📞 Tool call received:', {
                toolName: data.tool_name,
                toolId: data.tool_id,
                hasArgs: !!data.tool_args
              })

              // Store minimal tool call metadata for inline display (dedupe by id)
              updateMessage(assistantMessageId, (currentMessage: Message) => {
                const existing = currentMessage.metadata?.toolCalls || []
                const incoming = {
                  id: data.tool_id || 'unknown',
                  name: data.tool_name || 'unknown',
                  status: 'pending' as const,
                  timestamp: new Date().toISOString()
                }
                const hasId = existing.some(t => t.id === incoming.id)
                return {
                  metadata: {
                    ...currentMessage.metadata,
                    toolCalls: hasId
                      ? existing
                      : [...existing, incoming]
                  }
                }
              })
              
              // Log tool call to debug logger with arguments if available
              debugLogger.logToolCall(data.tool_name || 'unknown', data.tool_id || 'unknown', data.tool_args || {})
            } else if (data.type === 'tool_status') {
              // Add status message to the running log
              updateMessage(assistantMessageId, (currentMessage: Message) => ({
                metadata: {
                  ...currentMessage.metadata,
                  statusMessages: [
                    ...(currentMessage.metadata?.statusMessages || []),
                    data.status_message || 'Working...'
                  ],
                  isExecutingTool: true
                }
              }))
            } else if (data.type === 'tool_result') {
              // Update tool call status to success (keep status messages until text arrives)
              updateMessage(assistantMessageId, (currentMessage: Message) => ({
                metadata: {
                  ...currentMessage.metadata,
                  toolCalls: (currentMessage.metadata?.toolCalls || []).map((tool: ToolCall) => 
                    tool.id === data.tool_id 
                      ? { ...tool, status: 'success' as const }
                      : tool
                  )
                }
              }))
              
              // Log tool result to debug logger
              const toolNameForLog = (typeof (data as { tool_name?: string }).tool_name === 'string')
                ? (data as { tool_name?: string }).tool_name!
                : 'unknown'
              debugLogger.logToolResult(toolNameForLog, data.tool_id || 'unknown', data.tool_result || data.content)
              
              // Trigger recipe store updates for recipe modification tools
              if (data.tool_result) {
                // Get tool name from the stored tool call metadata
                // Use current store state instead of potentially stale destructured messages
                const currentMessages = useChatStore.getState().messages
                const currentMessage = currentMessages.find(msg => msg.id === assistantMessageId)
                const toolCall = currentMessage?.metadata?.toolCalls?.find(tc => tc.id === data.tool_id)
                const actualToolName = toolCall?.name || data.tool_name || 'unknown'
                
                // Debug tool name resolution
                debug.log('🔍 Tool name resolution:', {
                  assistantMessageId,
                  foundMessage: !!currentMessage,
                  toolCallsCount: currentMessage?.metadata?.toolCalls?.length || 0,
                  searchingForId: data.tool_id,
                  foundToolCall: !!toolCall,
                  toolCallName: toolCall?.name,
                  actualToolName
                })
                
                debug.log('🔧 Client received tool result:', { 
                  toolName: actualToolName, 
                  toolId: data.tool_id,
                  hasResult: !!data.tool_result 
                })
                
                // Check if this was a successful create_recipe call and exit import mode
                if (actualToolName === 'create_recipe' && data.tool_result) {
                  try {
                    // Parse the tool result to check for success
                    const toolResult = data.tool_result as { content?: Array<{ text?: string }> }
                    const resultText = toolResult?.content?.[0]?.text
                    let parsedResult
                    if (typeof resultText === 'string') {
                      parsedResult = JSON.parse(resultText)
                    } else {
                      parsedResult = data.tool_result
                    }
                    
                    // If recipe creation was successful, exit import mode
                    if (parsedResult?.success && conversationMetadata.mode === 'import') {
                      debug.log('✅ Recipe created successfully, exiting import mode')
                      setConversationMetadata({ mode: 'normal' })
                    }
                  } catch (error) {
                    debug.log('Could not parse create_recipe result for import mode handling:', error)
                  }
                }
                
                if (shouldTriggerUpdate(actualToolName)) {
                  debug.log('🎯 Tool requires recipe update, processing...', actualToolName)
                  
                  try {
                    // Parse the MCP tool result from nested structure
                    let parsedToolResult: MCPAllResults
                    try {
                      // The actual result is in data.tool_result.content[0].text as a JSON string
                      const toolResult = data.tool_result as { content?: Array<{ text?: string }> }
                      const resultText = toolResult?.content?.[0]?.text
                      if (typeof resultText === 'string') {
                        parsedToolResult = JSON.parse(resultText) as MCPAllResults
                      } else {
                        // Fallback to direct object if structure is different
                        parsedToolResult = data.tool_result as unknown as MCPAllResults
                      }
                    } catch (parseError) {
                      debug.error('Failed to parse tool result JSON:', parseError)
                      parsedToolResult = data.tool_result as unknown as MCPAllResults
                    }
                    
                    debug.log('🔍 Parsed tool result:', parsedToolResult)
                    
                    // Get recipe data from parsed tool result
                    const { recipeId, ingredientData, ingredientType, recipeMetadata, calculations } = await getRecipeDataFromToolResult(
                      actualToolName,
                      parsedToolResult
                    )
                    if (!canProcess()) return
                    
                    debug.log('📊 Extracted recipe data:', { 
                      recipeId, 
                      hasIngredientData: !!ingredientData, 
                      ingredientType,
                      hasRecipeMetadata: !!recipeMetadata,
                      hasCalculations: !!calculations
                    })
                    
                    // All MCP operations now return recipe_id directly (including delete_recipe)
                    const finalRecipeId = recipeId
                    
                    if (finalRecipeId) {
                      const updateAction = getUpdateAction(actualToolName)
                      debug.log('⚡ Triggering recipe store update:', { 
                        recipeId: finalRecipeId, 
                        updateAction, 
                        toolName: actualToolName 
                      })
                      
                      // Handle recipe metadata updates (e.g., from update_recipe)
                      if (recipeMetadata) {
                        debug.log('📝 Updating recipe metadata from MCP response:', recipeMetadata.id)
                        updateRecipeMetadata(recipeMetadata)
                        
                        // Update calculations if provided
                        if (calculations) {
                          debug.log('🧮 Updating calculations from MCP response')
                          // Update calculations in the store directly - we'll use the store's internal update
                          // The calculations are already extracted in the correct format from the MCP response
                          const calculationsUpdate = calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number }
                          
                          // Update calculations directly in the store
                          // We'll use a simple approach by getting the store instance
                          const storeApi = useRecipeStore
                          storeApi.setState(() => ({
                            calculations: {
                              calculated_og: calculationsUpdate.og,
                              calculated_fg: calculationsUpdate.fg,
                              calculated_abv: calculationsUpdate.abv,
                              calculated_ibu: calculationsUpdate.ibu,
                              calculated_ebc: calculationsUpdate.ebc,
                              batch_size_liters: recipeMetadata.batch_size_liters,
                              boil_time_minutes: recipeMetadata.boil_time_minutes,
                              efficiency_percent: recipeMetadata.efficiency_percent,
                              mash_thickness: recipeMetadata.mash_thickness
                            }
                          }))
                        }
                      }
                      
                      // Handle different update types
                      if (updateAction === 'refresh_list') {
                        // Recipe list changes: create, delete, clone (legacy fallback)
                        debug.log('📋 Refreshing recipe list...')
                        await triggerRefreshList()
                        if (!canProcess()) return
                      } else if (updateAction === 'add_recipe') {
                        // Efficient recipe creation/cloning
                        if (recipeMetadata) {
                          debug.log('➕ Adding new recipe to list efficiently:', recipeMetadata.id)
                          addRecipeToList(recipeMetadata, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                          
                          // For create_recipe: populate panel directly from MCP data (no DB call needed)
                          // For clone_recipe: load full details from DB (ingredients exist)
                          if (actualToolName === 'create_recipe') {
                            debug.log('📝 Populating new recipe panel from MCP data (no DB call)')
                            updateRecipeMetadata(recipeMetadata)
                            // Set empty ingredients and calculations from MCP response
                            const storeApi = useRecipeStore
                            const mcpCalcs = calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined
                            storeApi.setState(() => ({
                              grains: [],
                              hops: [],
                              yeasts: [],
                              misc: [],
                              water: [],
                              mashSteps: [],
                              fermentationSteps: [],
                              calculations: mcpCalcs ? {
                                calculated_og: mcpCalcs.og,
                                calculated_fg: mcpCalcs.fg,
                                calculated_abv: mcpCalcs.abv,
                                calculated_ibu: mcpCalcs.ibu,
                                calculated_ebc: mcpCalcs.ebc,
                                batch_size_liters: recipeMetadata.batch_size_liters,
                                boil_time_minutes: recipeMetadata.boil_time_minutes,
                                efficiency_percent: recipeMetadata.efficiency_percent,
                                mash_thickness: recipeMetadata.mash_thickness
                              } : null
                            }))
                          } else {
                            // For clone_recipe: load the cloned ingredients from DB
                            debug.log('🔄 Loading cloned recipe details from DB')
                            await triggerRefreshDetails(recipeMetadata.id)
                            if (!canProcess()) return
                          }
                        } else {
                          debug.warn('⚠️ No recipe metadata for add_recipe, falling back to refresh_list')
                          await triggerRefreshList()
                          if (!canProcess()) return
                        }
                      } else if (updateAction === 'delete_recipe_efficient') {
                        // Efficient recipe deletion
                        debug.log('➖ Removing recipe from list efficiently:', finalRecipeId)
                        removeRecipeFromList(finalRecipeId)
                      } else if (updateAction === 'update_recipe_efficient') {
                        // Efficient recipe update - no DB call needed
                        debug.log('📝 Efficient recipe update - using MCP data only')
                        // Recipe metadata and calculations already updated above
                        // No additional actions needed
                      } else if (updateAction === 'select_recipe') {
                        // Handle recipe selection from AI agent
                        debug.log('🎯 AI agent selecting recipe:', finalRecipeId)
                        
                        // Use switchToRecipe which handles both selection and loading
                        await switchToRecipe(finalRecipeId)
                        if (!canProcess()) return
                        
                        // Update the chat context to reflect the new selection
                        setCurrentRecipeContext(finalRecipeId)
                        
                        debug.log('✅ Recipe selection complete:', finalRecipeId)
                      } else if (updateAction === 'refresh_details') {
                        // Ingredient or recipe metadata changes
                        if (ingredientData && ingredientType) {
                          debug.log(`🔄 Incremental ${ingredientType} update:`, ingredientData.id)
                          // Incremental ingredient update with explicit casting
                          switch (ingredientType) {
                            case 'grain':
                              if (actualToolName.startsWith('remove_')) {
                                debug.log('🗑️ Incremental grain removal:', ingredientData.id)
                                removeSingleGrain(ingredientData.id, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              } else {
                                updateSingleGrain(ingredientData as import('@/types/database').RecipeGrain, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              }
                              break
                            case 'hop':
                              if (actualToolName.startsWith('remove_')) {
                                debug.log('🗑️ Incremental hop removal:', ingredientData.id)
                                removeSingleHop(ingredientData.id, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              } else {
                                updateSingleHop(ingredientData as import('@/types/database').RecipeHop, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              }
                              break
                            case 'yeast':
                              if (actualToolName.startsWith('remove_')) {
                                debug.log('🗑️ Incremental yeast removal:', ingredientData.id)
                                removeSingleYeast(ingredientData.id, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              } else {
                                updateSingleYeast(ingredientData as import('@/types/database').RecipeYeast, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              }
                              break
                            case 'misc':
                              if (actualToolName.startsWith('remove_')) {
                                removeSingleMisc(ingredientData.id, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              } else {
                                updateSingleMisc(ingredientData as import('@/types/database').RecipeMisc, calculations as { og: number, fg: number, abv: number, ibu: number, ebc: number } | undefined)
                              }
                              break
                            case 'water':
                              if (actualToolName.startsWith('remove_')) {
                                debug.log('🗑️ Incremental water removal:', ingredientData.id)
                                removeSingleWater(ingredientData.id)
                              } else {
                                updateSingleWater(ingredientData as import('@/types/database').RecipeWater)
                              }
                              break
                            case 'mash_step':
                            case 'fermentation_step':
                              // Inserting, moving or removing one step also changes other
                              // step_order values. Reload the complete canonical process.
                              await triggerRefreshDetails(finalRecipeId)
                              if (!canProcess()) return
                              break
                          }
                        } else {
                          debug.log('📝 Full recipe details refresh for:', finalRecipeId)
                          // Full recipe details refresh
                          await triggerRefreshDetails(finalRecipeId)
                          if (!canProcess()) return
                        }
                      } else {
                        debug.warn('⚠️ Unknown update action, skipping expensive refresh. Tool name:', actualToolName)
                        // Since enhanced MCP schema provides calculations in all responses,
                        // we should never need to trigger expensive calculation refreshes
                      }
                      
                      // Handle recipe context changes based on operation type
                      if (actualToolName === 'delete_recipe') {
                        // For delete operations, let removeRecipeFromList() handle auto-selection
                        // Don't interfere with the auto-selection logic
                        debug.log(`🗑️ Recipe ${finalRecipeId} was deleted, auto-selection handled by removeRecipeFromList()`)
                      } else {
                        // Switch recipe panel if chatbot modified different recipe
                        if (finalRecipeId !== currentRecipeContext) {
                          debug.log(`🔄 Switching recipe panel from ${currentRecipeContext} to ${finalRecipeId}`)
                          
                          // Validate finalRecipeId before switching
                          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
                          if (!uuidRegex.test(finalRecipeId)) {
                            debug.error(`❌ Invalid recipe ID format: ${finalRecipeId}`)
                          } else {
                            try {
                              await switchToRecipe(finalRecipeId)
                              if (!canProcess()) return
                              
                              setCurrentRecipeContext(finalRecipeId)
                              // Update parent component
                              if (onRecipeUpdate) {
                                onRecipeUpdate(finalRecipeId)
                              }
                            } catch (switchError) {
                              debug.error(`❌ Failed to switch to recipe ${finalRecipeId}:`, switchError)
                              // Don't update the parent if switching failed
                            }
                          }
                        }
                      }
                      
                      debug.log('✅ Recipe store update completed successfully')
                      
                    } else {
                      debug.error(`Recipe modification tool ${actualToolName} succeeded but no recipe ID found`)
                    }
                  } catch (error) {
                    debug.error('Failed to trigger recipe store update:', error)
                    // Don't throw - this shouldn't break the chat
                  }
                }
              }
            } else if (data.type === 'tool_error') {
              // Handle tool execution error
              // Update tool call status to error (keep status messages until text arrives)
              updateMessage(assistantMessageId, (currentMessage: Message) => ({
                metadata: {
                  ...currentMessage.metadata,
                  toolCalls: (currentMessage.metadata?.toolCalls || []).map((tool: ToolCall) => 
                    tool.id === data.tool_id 
                      ? { ...tool, status: 'error' as const, error: data.error }
                      : tool
                  )
                }
              }))
              
              // Get tool name from stored metadata for proper logging
              const currentMessages = useChatStore.getState().messages
              const currentMessage = currentMessages.find(msg => msg.id === assistantMessageId)
              const toolCall = currentMessage?.metadata?.toolCalls?.find(tc => tc.id === data.tool_id)
              const toolName = toolCall?.name || 'unknown'
              
              // Log tool error to debug logger with proper metadata
              debugLogger.logToolError(toolName, data.tool_id || 'unknown', data.error || 'Unknown tool error')
              
              debug.log('❌ Tool call failed:', {
                toolName,
                toolId: data.tool_id,
                error: data.error
              })
            } else if (data.type === 'system_message') {
              // Handle system message - add as a separate system message
              const systemMessage = {
                id: globalThis.crypto?.randomUUID?.() ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                type: 'system' as const,
                content: (data as { content?: string }).content || 'System message',
                timestamp: new Date(),
                metadata: {}
              }
              addMessage(systemMessage)
            } else if (data.type === 'done') {
              // Log any remaining accumulated text
              if (textBuffer.trim()) {
                debugLogger.logChatbotResponse(textBuffer.trim())
              }
              
              // Complete the streaming message
              completeStreamingMessage(assistantMessageId)
              sawDone = true
              streamCompleted = true
            } else if (data.type === 'error') {
              const errMsg = (data as { error?: string }).error || 'Unknown streaming error'
              // Server sent system_message + recoverable error: skip throw to avoid duplicate UI and console noise
              if ((data as { recoverable?: boolean }).recoverable === true) {
                debug.log('Recoverable stream error (user already notified):', errMsg)
                continue
              }
              debugLogger.logError('Streaming error', errMsg)
              throw new Error(errMsg)
            }
          }
        }
        if (sawDone) {
          break
        }
      }
      if (!streamCompleted && !requestController.signal.aborted) {
        throw new Error('The chat connection closed before the response completed. Reload the saved chat before sending another message.')
      }

    } catch (error) {
      if (!canProcess()) return
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was cancelled - complete the streaming message
        completeStreamingMessage(assistantMessageId)
        return
      }

      streamError = error instanceof Error ? error.message : 'Failed to get response'
      debug.error('Failed to send message:', error)

      // Update the streaming message with error
      appendToStreamingMessage(assistantMessageId, `\n\nError: ${error instanceof Error ? error.message : 'Failed to get response'}`)
      completeStreamingMessage(assistantMessageId)
    } finally {
      // Old requests may finish after a new account or request has taken over.
      if (ownsIdentity()) completeStreamingMessage(assistantMessageId)
      if (activeAssistantIdRef.current === assistantMessageId) activeAssistantIdRef.current = null
      requestController.abort()
      void responseReader?.cancel?.().catch(() => {})
      if (abortControllerRef.current === requestController) abortControllerRef.current = null
      if (ownsIdentity()) {
        useChatStore.getState().setTyping(false)
        await useChatStore.getState().refreshConversation(true)
        if (ownsIdentity() && streamError) useChatStore.getState().setConversationError(streamError)
      }
    }
  }, [
    user?.id, user?.user_metadata?.agentAdapter, user?.user_metadata?.agentPreferences, user?.user_metadata?.codexModel, user?.user_metadata?.codexReasoningEffort, user?.user_metadata?.codexVerbosity, addMessage, currentRecipeContext, conversation?.id, startStreamingMessage,
    appendToStreamingMessage, completeStreamingMessage, updateMessage, onRecipeUpdate,
    triggerRefreshList, triggerRefreshDetails, updateRecipeMetadata, addRecipeToList, removeRecipeFromList,
    updateSingleGrain, updateSingleHop, updateSingleYeast, updateSingleMisc, updateSingleWater,
    removeSingleGrain, removeSingleHop, removeSingleYeast, removeSingleMisc, removeSingleWater,
    switchToRecipe, setCurrentRecipeContext,
    conversationMetadata, setConversationMetadata, followLatestRef
  ])

  // Welcome message is now handled by user clicking the "Say hi" button
  // Removed automatic welcome message trigger

  const handleAction = async (action: string, data?: unknown) => {
    switch (action) {
      case 'confirm':
        // Handle recipe operation confirmations
        if (data && typeof data === 'object' && 'recipeId' in data && typeof (data as { recipeId: unknown }).recipeId === 'string') {
          onRecipeUpdate?.((data as { recipeId: string }).recipeId)
        }
        addMessage({
          type: 'system',
          content: 'Action confirmed and executed.'
        })
        break

      case 'cancel':
        addMessage({
          type: 'system',
          content: 'Action cancelled.'
        })
        break

      case 'view_recipe':
      case 'edit_recipe':
        if (data && typeof data === 'object' && 'recipeId' in data && typeof (data as { recipeId: unknown }).recipeId === 'string') {
          onRecipeUpdate?.((data as { recipeId: string }).recipeId)
        }
        break

      default:
        debug.warn(`Unknown action: ${action}`)
    }
  }

  const renderMessage = (message: Message) => {
    const key = message.id

    switch (message.type) {
      case 'user':
        return <UserMessage key={key} message={message} />
      case 'assistant':
        return <AssistantMessage key={key} message={message} />
      case 'system':
        return <SystemMessage key={key} message={message} />
      case 'action':
        return <ActionMessage key={key} message={message} onAction={handleAction} />
      default:
        return null
    }
  }

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-stone-800">
        <div className="text-center">
          <div className="text-gray-600 dark:text-stone-300">Please sign in to use the chat.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col chat-panel-bg">
            {/* Spacer for collapsed recipe panel on mobile */}
      {isMobile && !isMobileRecipeExpanded && userRecipes.length > 0 && (
        <div
          className="flex-shrink-0 bg-stone-100 dark:bg-gray-900"
          style={{ height: 'var(--collapsed-recipe-height, 130px)' }}
        >
          {/* This spacer will be overlaid by the absolutely positioned recipe panel */}
          {/* Height uses CSS custom property to stay in sync with recipe panel */}
        </div>
      )}

      <ConversationHeader />

      {/* Messages */}
      <div
        ref={paneRef}
        aria-label="Chat history"
        tabIndex={0}
        onScroll={onHistoryScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 chat-pane-scrollbar"
        style={{
          // Default padding for all states
          paddingTop: '16px'
        }}
      >
        {hasOlderMessages && <p className="text-sm text-stone-500">{operationPending ? 'Loading earlier messages…' : 'Scroll up to load earlier messages.'}</p>}
        {messages.length === 0 && isInitialized && !loading && (
          <div className="text-center mt-8">
            <div className="text-gray-500 dark:text-stone-400">
              <p className="mb-4 text-lg font-medium">Welcome!</p>
              <p className="text-base mb-2">I&apos;m Brewey, here to help you take your brewing to the next level 🍺</p>
              <p className="text-base mb-6">What shall we brew today?</p>
            </div>
            {userRecipes.length === 0 && messages.length === 0 && (
              <button
                onClick={() => {
                  if (setInputTextRef.current) {
                    setInputTextRef.current('Hi! 👋', true)
                  }
                }}
                className="inline-flex items-center px-6 py-3 border-2 border-amber-600 text-base font-medium rounded-full shadow-sm text-amber-600 bg-white hover:bg-amber-50 dark:bg-gray-800 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-all duration-200 transform hover:scale-105"
              >
                Say hi to get started 👋
              </button>
            )}
          </div>
        )}

        {initError && (
          <div className="border rounded-lg p-4 bg-yellow-50 dark:bg-yellow-900 border-yellow-200 dark:border-yellow-700">
            <div className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>Notice:</strong> {initError}
            </div>
            <div className="mt-2 space-x-2">
              <button
                onClick={() => {
                  setInitError(null)
                  setIsInitialized(false)
                }}
                className="text-sm underline transition-colors text-yellow-600 dark:text-yellow-300 hover:text-yellow-800 dark:hover:text-yellow-100"
              >
                Retry Connection
              </button>
              <span className="text-yellow-600 dark:text-yellow-300">•</span>
              <button
                onClick={() => window.location.reload()}
                className="text-sm underline transition-colors text-yellow-600 dark:text-yellow-300 hover:text-yellow-800 dark:hover:text-yellow-100"
              >
                Refresh Page
              </button>
            </div>
          </div>
        )}

        {messages.map(message => <div key={message.id} data-chat-message-id={message.id}>{renderMessage(message)}</div>)}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0">
        <ChatInput
          key={conversation?.id || "chat"}
          focusHandoffRef={composerFocusHandoffRef}
          onSendMessage={sendMessage}
          onStopMessage={handleStopMessage}
          onClearHistory={handleClearHistory}
          onCompact={() => useChatStore.getState().compactConversation()}
          onMobileRecipeCollapse={onMobileRecipeCollapse}
          disabled={!isInitialized}
          sendBlocked={conversationLoading || operationPending || !conversation || conversation.running}
          isStreaming={isStreaming}
          placeholder={isInitialized ? "Message Brewey, or / for commands" : "Loading chat..."}
          hasMessages={messages.length > 0}
          conversationMetadata={conversationMetadata}
          onExitImportMode={() => setConversationMetadata({ mode: 'normal' })}
          onSetInputText={setInputTextRef}
        />
      </div>
    </div>
  )
}
