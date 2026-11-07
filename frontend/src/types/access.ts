export const CAPABILITIES = ['recipes:read', 'recipes:write', 'catalog:read', 'profile:read', 'profile:write'] as const
export type Capability = typeof CAPABILITIES[number]
export interface AccessPrincipal {
  userId: string
  permissions: Capability[]
  rateLimit?: { limit: number; remaining: number; reset: number }
}
