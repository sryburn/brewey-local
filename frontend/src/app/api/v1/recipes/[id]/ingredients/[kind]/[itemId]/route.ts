import { serve, body, ingredientKind, type Context } from '../../../../../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request, context: Context) { return serve(request, false, 'recipes:read', async app => { const { id, kind, itemId } = await context.params; return { data: app.getRelation(ingredientKind(kind), id, itemId) } }) }
export async function PATCH(request: Request, context: Context) { return serve(request, true, 'recipes:write', async app => { const { id, kind, itemId } = await context.params; return { data: app.updateRelation(ingredientKind(kind), id, itemId, await body(request)) } }) }
export async function DELETE(request: Request, context: Context) { return serve(request, true, 'recipes:write', async app => { const { id, kind, itemId } = await context.params; app.removeRelation(ingredientKind(kind), id, itemId); return { data: null } }) }

