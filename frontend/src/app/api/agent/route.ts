import { jsonBody } from '@/lib/request-body'
import { requireSession, requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session'
import { getUserHarness, getUserAgentSelection } from '@/lib/user-harness'
import { listAgentAdapters, getAgentAdapter } from '@/lib/harness/registry'
import { AgentHarnessError } from '@/lib/harness/types'
import { validateAgentPreferences } from '@/lib/harness/preferences'
import { updateUser } from '@/lib/server/auth'
import { getDatabase } from '@/lib/server/database'
export const runtime = 'nodejs'
export async function GET() {
  try {
    const { user } = await requireSession()
    const adapters = listAgentAdapters()
    try {
      const selection = getUserAgentSelection(user.id)
      return Response.json({ adapters, selectedAdapterId: selection.adapterId, preferences: selection.preferences }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (!(error instanceof AgentHarnessError) || error.code !== 'UNSUPPORTED_ADAPTER') throw error
      return Response.json({ adapters, selectedAdapterId: user.user_metadata.agentAdapter, preferences: null, selectionError: error.message }, { headers: { 'Cache-Control': 'no-store' } })
    }
  } catch (error) { return errorResponse(error) }
}
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request)
    const { user } = await requireSession()
    const body = await jsonBody(request)
    if (!body || typeof body.adapterId !== 'string') throw new HttpError(400, 'Choose an available agent.')
    const adapter = getAgentAdapter(body.adapterId)
    // Changing the selected adapter alone does not start inference or require connection.
    let preferences
    if (body.preferences !== undefined) {
      const harness = getUserHarness(user.id, adapter.id)
      preferences = validateAgentPreferences(body.preferences, adapter, adapter.capabilities.modelCatalog ? await harness.models() : [])
    }
    const row = getDatabase().prepare('SELECT user_metadata FROM users WHERE id=?').get(user.id)
    if (!row) throw new HttpError(401, 'This Brewey account no longer exists.')
    const current = JSON.parse(String(row.user_metadata))
    const data = { agentAdapter: adapter.id, ...(preferences ? {
      agentPreferences: { ...current.agentPreferences, [adapter.id]: preferences },
      // Preserve the existing application's saved preferences during the boundary migration.
      ...(adapter.id === 'codex' ? { codexModel: preferences.model, codexReasoningEffort: preferences.reasoningEffort, codexVerbosity: preferences.verbosity } : {}),
    } : {}) }
    const updated = await updateUser(user.id, { data })
    return Response.json({ user: updated }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
