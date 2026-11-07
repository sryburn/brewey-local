import { listBrewingTools, callBrewingTool } from '@/lib/server/brewing-service'
import { applicationForUser } from '@/lib/server/application-service'
import { canonicalRecipeToolResult } from '@/lib/server/chat-recipe-updates'
import { requireSession, requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session'
import { getUserHarness, getUserAgentSelection } from '@/lib/user-harness'
import { getAgentAdapter } from '@/lib/harness/registry'
import { validateAgentPreferences } from '@/lib/harness/preferences'
import { installationAgentContext } from '@/lib/harness/installation-context'
import { BrewingTools } from '@/lib/brewing-tools'
import { safeEnqueue, sseEvents } from '@/lib/sse-utils'
import { baseSystemPrompt, recipeImportSystemPrompt } from '@/lib/prompts'
import { conversationsForUser } from '@/lib/server/conversations'
import { runConversationChat } from '@/lib/server/conversation-chat'
import { trackRecipeToolActivity } from '@/lib/server/chat-recipe-activity'
import { conversationBody } from '../conversations/_shared'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const { user } = await requireSession()
    const body = await conversationBody(request, ['conversationId', 'requestId', 'message', 'model', 'reasoningEffort', 'verbosity', 'currentRecipeId', 'conversationMetadata'])
    if (typeof body.conversationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.conversationId)) throw new HttpError(400, 'Invalid conversation ID.')
    if (typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)) throw new HttpError(400, 'Invalid request ID.')
    const conversations = conversationsForUser(user.id)
    const conversation = conversations.get(body.conversationId).conversation
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 100_000) throw new HttpError(400, 'A message of at most 100,000 characters is required.')
    if (body.currentRecipeId != null && (typeof body.currentRecipeId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.currentRecipeId))) throw new HttpError(400, 'Invalid recipe ID.')
    if (body.model != null && (typeof body.model !== 'string' || body.model.length > 128)) throw new HttpError(400, 'Invalid model.')
    if (body.reasoningEffort != null && (typeof body.reasoningEffort !== 'string' || !/^[a-z]{1,32}$/.test(body.reasoningEffort))) throw new HttpError(400, 'Invalid reasoning effort.')
    if (body.verbosity != null && (typeof body.verbosity !== 'string' || !['low', 'medium', 'high'].includes(body.verbosity))) throw new HttpError(400, 'Invalid verbosity.')
    const recipeId = typeof body.currentRecipeId === 'string' ? body.currentRecipeId : undefined
    const metadata = body.conversationMetadata
    if (metadata != null && (typeof metadata !== 'object' || Array.isArray(metadata))) throw new HttpError(400, 'Invalid conversation metadata.')
    const importMetadata = metadata as Record<string, unknown> | undefined
    if (importMetadata && Object.keys(importMetadata).some(key => !['mode', 'importFile'].includes(key))) throw new HttpError(400, 'Invalid conversation metadata.')
    if (importMetadata?.mode != null && importMetadata.mode !== 'import' && importMetadata.mode !== 'chat') throw new HttpError(400, 'Invalid conversation mode.')
    const selection = getUserAgentSelection(user.id)
    const adapter = getAgentAdapter(selection.adapterId)
    const harness = getUserHarness(user.id)
    if (!harness.capabilities.streaming || !harness.capabilities.brewingTools) throw new HttpError(400, 'The selected agent cannot run brewing conversations.')
    const account = await harness.account()
    if (account.requiresAuthentication && !account.account) throw new HttpError(409, `Connect your ${adapter.accountLabel} account in Chat settings before chatting.`)
    const preferences = validateAgentPreferences({
      model: body.model ?? selection.preferences.model,
      reasoningEffort: body.reasoningEffort ?? selection.preferences.reasoningEffort,
      verbosity: body.verbosity ?? selection.preferences.verbosity,
    }, adapter, adapter.capabilities.modelCatalog ? await harness.models() : [])
    let activeTurnId: string | undefined = undefined
    const brewing = { callTool: (name: string, args: Record<string, unknown>) => activeTurnId
      ? trackRecipeToolActivity(conversations, activeTurnId, name, args, () => callBrewingTool(user.id, name, args))
      : callBrewingTool(user.id, name, args) }
    const tools = new BrewingTools(brewing, listBrewingTools(user.id), recipeId)
    let context = baseSystemPrompt + '\n' + installationAgentContext(adapter)
    context += '\nThis saved conversation is independent of recipe selection and may discuss multiple recipes. The current recipe below is the selection for this turn; it can differ from earlier turns. Selecting a recipe does not switch conversations. Historical recipe references are not the current selection.'
    const profile = applicationForUser(user.id).getProfile()
    if (profile?.profile) context += '\nBrewer profile: ' + profile.profile
    if (recipeId) {
      const recipe = await tools.execute('get_recipe_by_id', { recipe_id: recipeId })
      if (!recipe.success) throw new HttpError(404, 'Recipe not found.')
      context += '\nCurrent recipe: ' + recipe.content
    } else context += '\nNo recipe is currently selected. Ask which recipe the user means or use the brewing tools to find it; do not assume an earlier selection is still current.'
    if (importMetadata?.mode === 'import') {
      const file = importMetadata.importFile as Record<string, unknown> | undefined
      if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.content !== 'string' || file.content.length > 500_000) throw new HttpError(400, 'Invalid recipe import file.')
      context += '\n' + recipeImportSystemPrompt + '\nImported recipe file:\n' + file.content
    }
    const turn = conversations.beginTurn(body.conversationId, { requestId: body.requestId, message: body.message, adapterId: selection.adapterId, model: preferences.model || undefined, selectedRecipeId: recipeId })
    if (turn.replayed) throw new HttpError(409, 'This message was already accepted. Reload the conversation to see its saved result.')
    activeTurnId = turn.turnId
    const contextBeforeTurn = conversations.getContext(conversation.id)
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let errorSent = false
        try {
          safeEnqueue(controller, encoder, { type: 'conversation', conversation_id: conversation.id, user_message_id: turn.userMessageId, assistant_message_id: turn.assistantMessageId, turn_id: turn.turnId })
          await runConversationChat({
            userId: user.id, conversationId: conversation.id, turn, context: contextBeforeTurn, harness,
            model: preferences.model || undefined,
            reasoningEffort: preferences.reasoningEffort || undefined,
            verbosity: preferences.verbosity || undefined,
            systemPrompt: context, message: body.message as string,
            availableTools: tools.tools,
            executeTool: async ({ toolName, toolInput, abortSignal }) => {
              const currentSession = await requireSession()
              if (currentSession.user.id !== user.id || abortSignal.aborted) throw new Error('Brewing tool interrupted.')
              conversations.heartbeat(turn.turnId)
              return tools.execute(toolName, toolInput)
            },
            onEvent: event => {
              if (abort.signal.aborted) return
              if (event.type === 'error') errorSent = true
              // Keep the agent's preferred-unit text, while the UI's incremental state remains metric.
              const uiEvent = event.type === 'tool_result' && typeof event.tool_name === 'string'
                ? { ...event, tool_result: canonicalRecipeToolResult(user.id, event.tool_name, event.tool_result) }
                : event
              if (!safeEnqueue(controller, encoder, uiEvent)) abort.abort()
            },
            abortSignal: abort.signal,
            showReasoning: adapter.capabilities.reasoningSummaries && (user.user_metadata?.chatSettings?.showReasoning ?? false),
          })
        } catch (error) {
          try { conversations.finishTurn(turn.turnId, abort.signal.aborted ? 'interrupted' : 'failed', error instanceof Error ? error.message : 'Chat failed.') } catch { /* Lease recovery already recorded interruption. */ }
          if (!abort.signal.aborted && !errorSent) safeEnqueue(controller, encoder, sseEvents.error(error instanceof Error ? error.message : 'Chat failed.'))
        } finally {
          request.signal.removeEventListener('abort', onAbort)
          try { controller.close() } catch { /* Browser already disconnected. */ }
        }
      },
      cancel() { abort.abort() },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } })
  } catch (error) { return errorResponse(error) }
}
