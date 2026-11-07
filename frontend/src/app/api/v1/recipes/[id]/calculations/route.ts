import { serve, type Context } from '../../../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request, context: Context) { return serve(request, false, 'recipes:read', async app => ({ data: app.calculations((await context.params).id) })) }

