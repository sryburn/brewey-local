import { serve, catalogKind, type Context } from '../../../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request, context: Context) { return serve(request, false, 'catalog:read', async app => { const { kind, id } = await context.params; return { data: app.getCatalog(catalogKind(kind), id) } }) }

