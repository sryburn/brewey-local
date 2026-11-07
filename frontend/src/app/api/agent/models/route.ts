import { requireSession, errorResponse } from '@/lib/server-session'
import { getUserHarness } from '@/lib/user-harness'
export const runtime = 'nodejs'
export async function GET() {
  try {
    const { user } = await requireSession()
    const harness = getUserHarness(user.id)
    return Response.json({ models: await harness.models(), adapterId: harness.adapterId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
