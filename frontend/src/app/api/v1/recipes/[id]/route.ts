import { serve, body, type Context } from '../../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request, context: Context) { return serve(request, false, 'recipes:read', async app => ({ data: app.getRecipe((await context.params).id) })) }
export async function PATCH(request: Request, context: Context) { return serve(request, true, 'recipes:write', async app => ({ data: app.updateRecipe((await context.params).id, await body(request)) })) }
export async function DELETE(request: Request, context: Context) { return serve(request, true, 'recipes:write', async app => { app.deleteRecipe((await context.params).id); return { data: null } }) }

