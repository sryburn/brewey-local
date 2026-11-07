import { requireSession, requireSameOrigin, errorResponse } from '@/lib/server-session'
import { getUserHarness } from '@/lib/user-harness'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const { user } = await requireSession()
    await getUserHarness(user.id).cancelTurn()
    return Response.json({ success: true })
  } catch (error) { return errorResponse(error) }
}
