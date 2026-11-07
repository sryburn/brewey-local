import { serveConversation, conversationBody, type ConversationRouteContext } from '../../_shared'
export const runtime = 'nodejs'
export async function POST(request: Request, context: ConversationRouteContext) {
  return serveConversation(request, true, async store => {
    await conversationBody(request, [])
    return store.activate((await context.params).id)
  })
}
