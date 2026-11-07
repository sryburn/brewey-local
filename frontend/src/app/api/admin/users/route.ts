import { jsonBody } from '@/lib/request-body'
import { createManagedUser, listUsers } from '@/lib/server/auth'
import { requireSession, requireSameOrigin, errorResponse } from '@/lib/server-session'
export const runtime = 'nodejs'
export async function GET() {
  try { const { user } = await requireSession(); return Response.json({ users: listUsers(user.id) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return errorResponse(error) }
}
export async function POST(request: Request) {
  try { requireSameOrigin(request); const { user } = await requireSession(); const created = await createManagedUser(user.id, await jsonBody(request)); return Response.json({ user: created }, { status: 201, headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return errorResponse(error) }
}
