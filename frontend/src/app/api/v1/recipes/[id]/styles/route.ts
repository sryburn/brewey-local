import { serve, query, type Context } from '../../../_shared'
import { HttpError } from '@/lib/server-session'
export const runtime = 'nodejs'
export async function GET(request: Request, context: Context) {
  return serve(request, false, 'recipes:read', async app => {
    const params = query(request)
    if (Object.keys(params).some(key => !['keywords', 'limit'].includes(key))) throw new HttpError(400, 'Unsupported style matching query parameter.')
    if ((params.keywords || '').length > 500) throw new HttpError(400, 'Style keywords must be at most 500 characters.')
    const limit = params.limit === undefined ? 10 : Number(params.limit)
    if (params.limit !== undefined && !/^\d+$/.test(params.limit) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new HttpError(400, 'Style limit must be an integer from 1 to 500.')
    const keywords = (params.keywords || '').split(',').map(word => word.trim()).filter(Boolean)
    return { data: app.findStyles((await context.params).id, keywords, limit) }
  })
}
