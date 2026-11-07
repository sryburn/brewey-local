import { serve, body, query, page } from '../_shared'
import type { RecipeInput } from '@/lib/server/application-service'
export const runtime = 'nodejs'
export async function GET(request: Request) { return serve(request, false, 'recipes:read', app => page(app.listRecipes(query(request)))) }
export async function POST(request: Request) { return serve(request, true, 'recipes:write', async app => ({ data: app.createRecipe(await body(request) as RecipeInput), status: 201 })) }
