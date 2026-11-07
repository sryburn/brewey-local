import { serve, cloneName, type Context } from '../../../_shared'
export const runtime = 'nodejs'
export async function POST(request: Request, context: Context) { return serve(request, true, 'recipes:write', async app => ({ data: app.cloneRecipe((await context.params).id, await cloneName(request)), status: 201 })) }
