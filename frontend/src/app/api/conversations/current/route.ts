import { serveConversation, conversationQuery } from '../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  return serveConversation(request, false, store => {
    conversationQuery(request, [])
    return store.current()
  })
}
