import { serve, body, ingredientKind, type Context } from '../../../../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request, context: Context) { return serve(request, false, 'recipes:read', async app => { const { id, kind } = await context.params; return { data: app.listRelations(ingredientKind(kind), id) } }) }
export async function POST(request: Request, context: Context) { return serve(request, true, 'recipes:write', async app => { const { id, kind } = await context.params; return { data: app.addRelation(ingredientKind(kind), id, await body(request)), status: 201 } }) }

