import { randomUUID } from 'node:crypto'
import { serveConversation, conversationBody, type ConversationRouteContext } from '../../_shared'
import { compactConversation } from '@/lib/server/conversation-chat'
import { getUserHarness, getUserAgentSelection } from '@/lib/user-harness'
import { getAgentAdapter } from '@/lib/harness/registry'
import { validateAgentPreferences } from '@/lib/harness/preferences'
import { HttpError } from '@/lib/server-session'
export const runtime = 'nodejs'
export async function POST(request: Request, context: ConversationRouteContext) {
  return serveConversation(request, true, async (store, userId) => {
    const id = (await context.params).id
    store.get(id)
    const body = await conversationBody(request, ['requestId'])
    if (body.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId))) throw new HttpError(400, 'Invalid request ID.')
    const selection = getUserAgentSelection(userId), adapter = getAgentAdapter(selection.adapterId), harness = getUserHarness(userId)
    const account = await harness.account()
    if (account.requiresAuthentication && !account.account) throw new HttpError(409, `Connect your ${adapter.accountLabel} account in Chat settings before compacting.`)
    const preferences = validateAgentPreferences(selection.preferences, adapter, adapter.capabilities.modelCatalog ? await harness.models() : [])
    return compactConversation({ userId, conversationId: id, requestId: typeof body.requestId === 'string' ? body.requestId : randomUUID(), harness, model: preferences.model || undefined, abortSignal: request.signal })
  })
}
