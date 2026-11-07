import { requireSession, requireSameOrigin, errorResponse } from '@/lib/server-session'
import { ingredientSetupStatus, startIngredientSetup } from '@/lib/server/ingredient-setup'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { const { user } = await requireSession(); return Response.json(ingredientSetupStatus(user.id), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return errorResponse(error) }
}
export async function POST(request: Request) {
  try { requireSameOrigin(request); const { user } = await requireSession(); return Response.json(startIngredientSetup(user.id), { status: 202, headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return errorResponse(error) }
}
