import { jsonBody } from '@/lib/request-body'
import { requireSession, requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session'
import { conversationsForUser } from '@/lib/server/conversations'

export type ConversationRouteContext = { params: Promise<{ id: string }> }
export async function serveConversation(request: Request, mutation: boolean, operation: (store: ReturnType<typeof conversationsForUser>, userId: string) => unknown | Promise<unknown>) {
  try {
    if (mutation) requireSameOrigin(request)
    const { user } = await requireSession()
    const result = await operation(conversationsForUser(user.id), user.id)
    return Response.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
export async function conversationBody(request: Request, allowed: readonly string[]): Promise<Record<string, unknown>> {
  const value = await jsonBody(request, 2 * 1024 * 1024)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new HttpError(400, 'Invalid conversation request fields.')
  return value as Record<string, unknown>
}
export function conversationQuery(request: Request, allowed: readonly string[]): URLSearchParams {
  const query = new URL(request.url).searchParams
  for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw new HttpError(400, 'Invalid conversation query.')
  return query
}
export function pageInteger(value: string | null): number | undefined {
  if (value === null) return undefined
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HttpError(400, 'Invalid conversation pagination.')
  return Number(value)
}
