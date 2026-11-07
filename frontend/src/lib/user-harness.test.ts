/** @jest-environment node */
import { getUserAgentSelection, getUserHarness } from './user-harness'
import { AgentHarnessError } from './harness/types'
let mockMetadata: Record<string, unknown> = {}
let mockExists = true
const mockCreate = jest.fn()
jest.mock('./server/database.ts', () => ({ getDatabase: () => ({ prepare: () => ({ get: () => mockExists ? { id: '00000000-0000-4000-8000-000000000001', user_metadata: JSON.stringify(mockMetadata) } : undefined }) }) }))
jest.mock('./harness/registry.ts', () => ({ getAgentAdapter: (id: string) => { if (!['codex', 'example'].includes(id)) throw new AgentHarnessError('UNSUPPORTED_ADAPTER', 'not installed'); return { id } }, createAgentHarness: (...args: unknown[]) => mockCreate(...args), agentStorageNamespaces: () => ['codex'] }))
const id = '00000000-0000-4000-8000-000000000001'
beforeEach(() => { mockMetadata = {}; mockExists = true; mockCreate.mockClear() })
test('existing Codex preferences migrate without changing the isolated user identity', () => {
  mockMetadata = { codexModel: 'old-model', codexReasoningEffort: 'high', codexVerbosity: 'medium' }
  expect(getUserAgentSelection(id)).toEqual({ adapterId: 'codex', preferences: { model: 'old-model', reasoningEffort: 'high', verbosity: 'medium' } })
  mockMetadata.agentPreferences = { codex: { model: 'new-model', reasoningEffort: 'low', verbosity: 'high' } }
  expect(getUserAgentSelection(id).preferences.model).toBe('new-model')
})
test('a selected independent adapter cannot inherit Codex settings', () => {
  mockMetadata = { agentAdapter: 'example', codexModel: 'old-model', codexReasoningEffort: 'high', codexVerbosity: 'medium', agentPreferences: { example: { model: 'example-model' } } }
  expect(getUserAgentSelection(id)).toEqual({ adapterId: 'example', preferences: { model: 'example-model', reasoningEffort: null, verbosity: null } })
})
test('unsupported selection, invalid identity and deleted account fail before a runtime is constructed', () => {
  mockMetadata.agentAdapter = 'missing'
  expect(() => getUserHarness(id)).toThrow('not installed')
  expect(() => getUserAgentSelection('../owner')).toThrow('Invalid authenticated user ID')
  mockExists = false
  expect(() => getUserHarness(id)).toThrow('no longer exists')
  expect(mockCreate).not.toHaveBeenCalled()
})
