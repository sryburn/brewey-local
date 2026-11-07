import { serve, catalogKind, query, page, type Context } from '../../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request, context: Context) { return serve(request, false, 'catalog:read', async app => page(app.searchCatalog(catalogKind((await context.params).kind), query(request)))) }

