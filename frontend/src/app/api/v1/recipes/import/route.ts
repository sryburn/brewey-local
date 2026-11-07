import { serve, body } from '../../_shared'
export const runtime = 'nodejs'
export async function POST(request: Request) { return serve(request, true, 'recipes:write', async app => ({ data: app.importRecipe(await body(request)), status: 201 })) }

