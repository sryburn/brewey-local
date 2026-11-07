import { requireSession, requireSameOrigin, errorResponse } from '@/lib/server-session'
import { getUserHarness } from '@/lib/user-harness'
export const runtime = 'nodejs'
export async function GET() {
  try {
    const { user } = await requireSession()
    const harness = getUserHarness(user.id)
    const status = await harness.account()
    const account = status.account ? { type: status.account.type, email: status.account.email, planType: status.account.planType } : null
    return Response.json({ account, requiresAuthentication: status.requiresAuthentication, adapterId: harness.adapterId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request)
    const { user } = await requireSession()
    await getUserHarness(user.id).logout()
    return Response.json({ success: true })
  } catch (error) { return errorResponse(error) }
}
