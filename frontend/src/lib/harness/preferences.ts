import { AgentHarnessError, type AgentAdapterDescriptor, type AgentModel, type Verbosity } from './types.ts'
export interface AgentPreferences { model: string | null; reasoningEffort: string | null; verbosity: Verbosity | null }

/** Validate only capabilities the selected adapter and live model actually advertise. */
export function validateAgentPreferences(input: unknown, adapter: AgentAdapterDescriptor, models: AgentModel[]): AgentPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AgentHarnessError('PREFERENCES', 'Invalid agent preferences.')
  const data = input as Record<string, unknown>
  const model = data.model ?? null, reasoningEffort = data.reasoningEffort ?? null, verbosity = data.verbosity ?? null
  if (model !== null && (typeof model !== 'string' || model.length > 128)) throw new AgentHarnessError('PREFERENCES', 'Invalid model.')
  if (reasoningEffort !== null && (typeof reasoningEffort !== 'string' || !/^[a-z]{1,32}$/.test(reasoningEffort))) throw new AgentHarnessError('PREFERENCES', 'Invalid reasoning effort.')
  if (verbosity !== null && !['low', 'medium', 'high'].includes(String(verbosity))) throw new AgentHarnessError('PREFERENCES', 'Invalid verbosity.')
  if (model && !adapter.capabilities.modelCatalog) throw new AgentHarnessError('PREFERENCES', 'This agent does not offer model selection.')
  const selected = model ? models.find(candidate => candidate.id === model || candidate.model === model) : models.find(candidate => candidate.isDefault) || models[0]
  if (model && !selected) throw new AgentHarnessError('MODEL', 'The selected model is not available from this connection.')
  if (reasoningEffort && (!adapter.capabilities.reasoningEffort || !selected?.supportedReasoningEfforts?.some(option => option.reasoningEffort === reasoningEffort))) throw new AgentHarnessError('PREFERENCES', 'This agent/model does not support the selected reasoning effort.')
  if (verbosity && !adapter.capabilities.verbosity.includes(verbosity as Verbosity)) throw new AgentHarnessError('PREFERENCES', 'This agent does not support the selected verbosity.')
  return { model: model as string | null, reasoningEffort: reasoningEffort as string | null, verbosity: verbosity as Verbosity | null }
}
