import { resolve, join } from 'node:path'
import { rm } from 'node:fs/promises'
import { createAgentHarness, getAgentAdapter, agentStorageNamespaces } from './harness/registry.ts'
import { AgentHarnessError, type AgentHarness, type Verbosity } from './harness/types.ts'
import { getDatabase } from './server/database.ts'

export interface AgentPreferences {
  model: string | null
  reasoningEffort: string | null
  verbosity: Verbosity | null
}
const globalHarnesses = globalThis as typeof globalThis & { breweyAgentHarnesses?: Map<string, { userId: string; harness: AgentHarness; touched: number }> }
const harnesses = globalHarnesses.breweyAgentHarnesses ??= new Map()
const validUser = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

/** Selection belongs to the authenticated account, never an untrusted chat/tool argument. */
export function getUserAgentSelection(userId: string): { adapterId: string; preferences: AgentPreferences } {
  if (!validUser(userId)) throw new AgentHarnessError('AUTH', 'Invalid authenticated user ID.', 401)
  const row = getDatabase().prepare('SELECT user_metadata FROM users WHERE id=?').get(userId)
  if (!row) throw new AgentHarnessError('AUTH', 'This Brewey account no longer exists.', 401)
  const metadata = JSON.parse(String(row.user_metadata))
  const adapterId = metadata.agentAdapter ?? 'codex'
  if (typeof adapterId !== 'string') throw new AgentHarnessError('UNSUPPORTED_ADAPTER', 'Choose an available agent in Chat settings.')
  getAgentAdapter(adapterId)
  const saved = metadata.agentPreferences?.[adapterId]
  const preferences = saved || (adapterId === 'codex' ? {
    model: metadata.codexModel, reasoningEffort: metadata.codexReasoningEffort, verbosity: metadata.codexVerbosity,
  } : {})
  return { adapterId, preferences: {
    model: typeof preferences.model === 'string' ? preferences.model : null,
    reasoningEffort: typeof preferences.reasoningEffort === 'string' ? preferences.reasoningEffort : null,
    verbosity: ['low', 'medium', 'high'].includes(preferences.verbosity) ? preferences.verbosity : null,
  } }
}

/** Called only after password-confirmed local account deletion. */
export async function deleteUserHarness(userId: string): Promise<void> {
  if (!validUser(userId)) throw new Error('Invalid authenticated user ID.')
  for (const [key, entry] of harnesses) {
    if (entry.userId === userId) { entry.harness.close(); harnesses.delete(key) }
  }
  const root = resolve(/* turbopackIgnore: true */ process.env.BREWEY_DATA_DIR || '.runtime')
  for (const namespace of agentStorageNamespaces()) await rm(join(root, namespace, userId), { recursive: true, force: true })
}

/** Retain one isolated connection per adapter/account; selection never swaps runtimes implicitly. */
export function getUserHarness(userId: string, explicitAdapterId?: string): AgentHarness {
  if (!validUser(userId)) throw new AgentHarnessError('AUTH', 'Invalid authenticated user ID.', 401)
  if (!getDatabase().prepare('SELECT id FROM users WHERE id=?').get(userId)) throw new AgentHarnessError('AUTH', 'This Brewey account no longer exists.', 401)
  const adapterId = explicitAdapterId ?? getUserAgentSelection(userId).adapterId
  getAgentAdapter(adapterId)
  for (const [key, entry] of harnesses) {
    if (Date.now() - entry.touched > 30 * 60_000) { entry.harness.close(); harnesses.delete(key) }
  }
  const key = `${adapterId}:${userId}`
  const existing = harnesses.get(key)
  if (existing) { existing.touched = Date.now(); return existing.harness }
  if (harnesses.size >= 8) throw new AgentHarnessError('BUSY', 'Too many active agent connections. Try again later.', 503)
  const root = resolve(/* turbopackIgnore: true */ process.env.BREWEY_DATA_DIR || '.runtime')
  const harness = createAgentHarness(adapterId, userId, root)
  harnesses.set(key, { userId, harness, touched: Date.now() })
  return harness
}
