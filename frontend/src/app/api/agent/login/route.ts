import { jsonBody } from '@/lib/request-body'
import { requireSession, requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session'
import { getUserHarness } from '@/lib/user-harness'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const { user } = await requireSession()
    const body = await jsonBody(request)
    const harness = getUserHarness(user.id)
    const method = body?.method || harness.capabilities.loginMethods[0]?.id
    if (typeof method !== 'string' || !harness.capabilities.loginMethods.some(option => option.id === method)) throw new HttpError(400, 'Choose a supported sign-in method.')
    const result = await harness.login(method)
    return Response.json({ method: result.method, loginId: result.loginId, verificationUrl: result.verificationUrl, userCode: result.userCode, authUrl: result.authUrl }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request)
    const { user } = await requireSession()
    const body = await jsonBody(request)
    if (typeof body?.loginId !== 'string' || !body.loginId || body.loginId.length > 100) throw new HttpError(400, 'Invalid login ID.')
    await getUserHarness(user.id).cancelLogin(body.loginId)
    return Response.json({ success: true })
  } catch (error) { return errorResponse(error) }
}
