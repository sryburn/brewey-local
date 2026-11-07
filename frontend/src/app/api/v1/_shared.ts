import { jsonBody } from '@/lib/request-body'
import { BrewingApplication, type CatalogKind, type RelationKind } from '@/lib/server/application-service'
import { requestUser } from '@/lib/server/request-user'
import { accessHeaders } from '@/lib/server/access'
import { errorResponse, HttpError } from '@/lib/server-session'
import type { AccessPrincipal, Capability } from '@/types/access'

export type Context = { params: Promise<Record<string, string>> }
type Reply = { data: unknown; status?: number; meta?: object; download?: string }
export async function serve(request: Request, mutation: boolean, capability: Capability, action: (app: BrewingApplication) => Reply | Promise<Reply>) {
  let principal: AccessPrincipal | undefined
  try {
    const user = await requestUser(request, mutation, capability)
    principal = { userId: user.id, permissions: user.permissions, rateLimit: 'rateLimit' in user ? user.rateLimit : undefined }
    const result = await action(new BrewingApplication(principal))
    const headers = { ...accessHeaders(principal), 'Cache-Control': 'no-store', ...(result.download ? { 'Content-Disposition': `attachment; filename="${result.download}"` } : {}) }
    return Response.json(result.download ? result.data : { data: result.data, ...(result.meta ? { meta: result.meta } : {}) }, { status: result.status || 200, headers })
  } catch (error) {
    const response = errorResponse(error)
    if (principal) for (const [name, value] of Object.entries(accessHeaders(principal))) response.headers.set(name, value)
    return response
  }
}
export function query(request: Request): Record<string, string> {
  const params = new URL(request.url).searchParams
  const result: Record<string, string> = {}
  for (const [key, value] of params) {
    if (key in result) throw new HttpError(400, 'Duplicate query parameters are not allowed.')
    result[key] = value
  }
  return result
}
export const body = (request: Request) => jsonBody(request, 2 * 1024 * 1024)
export async function cloneName(request: Request): Promise<string> {
  const input = await body(request)
  if (Object.keys(input).some(key => key !== 'name')) throw new HttpError(400, 'Clone accepts only name.')
  if (typeof input.name !== 'string') throw new HttpError(400, 'Clone name must be a string.')
  return input.name
}
export function catalogKind(value: string): CatalogKind {
  if (!['grain', 'hop', 'yeast', 'misc', 'style'].includes(value)) throw new HttpError(404, 'Catalogue kind not found.')
  return value as CatalogKind
}
export function ingredientKind(value: string): RelationKind {
  if (!['grain', 'hop', 'yeast', 'misc', 'water'].includes(value)) throw new HttpError(404, 'Ingredient kind not found.')
  return value as RelationKind
}
export function stepKind(value: string): RelationKind {
  if (!['mash', 'fermentation'].includes(value)) throw new HttpError(404, 'Process kind not found.')
  return value as RelationKind
}
export function page<T>(result: { items: T[]; total: number; limit: number; offset: number }): Reply {
  const { items, ...meta } = result
  return { data: items, meta }
}
