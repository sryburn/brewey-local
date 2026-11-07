import { serveConversation, conversationBody, type ConversationRouteContext } from '../../_shared'
import { HttpError } from '@/lib/server-session'
export const runtime = 'nodejs'
export async function POST(request: Request, context: ConversationRouteContext) {
  return serveConversation(request, true, async store => {
    const body = await conversationBody(request, ['content'])
    if (typeof body.content !== 'string') throw new HttpError(400, 'An activity note is required.')
    const id = (await context.params).id
    store.appendNote(id, body.content)
    return store.get(id)
  })
}
