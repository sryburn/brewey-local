import { authenticateAccessToken } from './tokens'
import { requireCapability } from './access'
import { CAPABILITIES, type Capability } from '@/types/access'
import { requireSession, requireSameOrigin } from '../server-session'

export async function requestUser(request: Request, mutation = false, capability: Capability = mutation ? 'recipes:write' : 'recipes:read') {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-api-key')
  if (bearer) {
    const principal = await authenticateAccessToken(bearer)
    requireCapability(principal, capability)
    return { id: principal.userId, permissions: principal.permissions, rateLimit: principal.rateLimit }
  }
  if (mutation) requireSameOrigin(request)
  const { user } = await requireSession()
  return { ...user, permissions: [...CAPABILITIES] }
}
