import type { AccessPrincipal, Capability } from '../../types/access.ts'
import { AuthError } from './auth-error.ts'
export function hasCapability(principal: AccessPrincipal, capability: Capability): boolean {
  return principal.permissions.includes(capability) || capability === 'recipes:read' && principal.permissions.includes('recipes:write') || capability === 'profile:read' && principal.permissions.includes('profile:write')
}
export function requireCapability(principal: AccessPrincipal, capability: Capability) {
  if (!hasCapability(principal, capability)) throw new AuthError(403, `Access token does not permit ${capability}.`, accessHeaders(principal))
}
export function accessHeaders(principal: Pick<AccessPrincipal, 'rateLimit'>): Record<string, string> {
  return principal.rateLimit ? { 'X-RateLimit-Limit': String(principal.rateLimit.limit), 'X-RateLimit-Remaining': String(principal.rateLimit.remaining), 'X-RateLimit-Reset': String(principal.rateLimit.reset) } : {}
}
