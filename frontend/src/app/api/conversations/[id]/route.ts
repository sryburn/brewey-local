import { randomUUID } from 'node:crypto'
import { serveConversation, conversationBody, conversationQuery, pageInteger, type ConversationRouteContext } from '../_shared'
import { requireSession, HttpError } from '@/lib/server-session'
import { getUserHarness } from '@/lib/user-harness'
export const runtime = 'nodejs'
export async function GET(request: Request, context: ConversationRouteContext) {
  return serveConversation(request, false, async store => {
    const query = conversationQuery(request, ['before', 'limit'])
    return store.get((await context.params).id, { before: pageInteger(query.get('before')), limit: pageInteger(query.get('limit')) })
  })
}
export async function PATCH(request: Request, context: ConversationRouteContext) {
  return serveConversation(request, true, async store => {
    const body = await conversationBody(request, ['title'])
    if (typeof body.title !== 'string') throw new HttpError(400, 'Title must be text.')
    return store.rename((await context.params).id, body.title)
  })
}
export async function DELETE(request: Request, context: ConversationRouteContext) {
  return serveConversation(request, true, async (store, userId) => {
    const id = (await context.params).id
    const claim = store.claimDeletion(id, randomUUID())
    let expired = false
    const heartbeat = setInterval(() => { try { store.heartbeat(claim.turnId) } catch { expired = true } }, 25_000)
    try {
      // Retain transcript and thread ledger until every native delete succeeds.
      // The maintenance claim blocks new inference throughout asynchronous cleanup.
      for (const thread of store.listThreads(id)) {
        const session = await requireSession()
        if (expired || request.signal.aborted || session.user.id !== userId) throw new HttpError(409, 'Conversation deletion interrupted. Please try again.')
        store.heartbeat(claim.turnId)
        const harness = getUserHarness(userId, thread.adapterId)
        if (!harness.deleteThread) throw new HttpError(409, 'This agent cannot delete saved native threads. The conversation was retained.')
        await harness.deleteThread(thread.threadId)
      }
      if (expired || request.signal.aborted) throw new HttpError(409, 'Conversation deletion interrupted. Please try again.')
      store.remove(id, claim.turnId)
      return null
    } catch (error) {
      try { store.finishTurn(claim.turnId, request.signal.aborted || expired ? 'interrupted' : 'failed', 'Native thread cleanup did not complete; conversation retained.') } catch { /* Lease recovery retained history. */ }
      throw error
    } finally { clearInterval(heartbeat) }
  })
}
