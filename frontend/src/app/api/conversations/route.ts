import { HttpError } from '@/lib/server-session'
import { serveConversation, conversationBody, conversationQuery } from './_shared'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  return serveConversation(request, false, store => {
    const query = conversationQuery(request, ['q'])
    return store.list(query.get('q') || '')
  })
}
export async function POST(request: Request) {
  return serveConversation(request, true, async store => {
    const body = await conversationBody(request, ['title', 'carryFromId'])
    if (body.title !== undefined && typeof body.title !== 'string' || body.carryFromId !== undefined && (typeof body.carryFromId !== 'string' || !body.carryFromId.trim())) throw new HttpError(400, 'Invalid conversation fields.')
    return store.create({ title: body.title as string | undefined, carryFromId: body.carryFromId as string | undefined })
  })
}
