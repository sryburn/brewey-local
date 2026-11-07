import { isAbsolute, join } from 'node:path'
import { CodexAppServerHarness, CODEX_CAPABILITIES } from './codex-app-server.ts'
import { AgentHarnessError, type AgentAdapterRegistration, type AgentAdapterDescriptor, type AgentHarness } from './types.ts'

/** Register adapters explicitly. An unknown selection never substitutes a different runtime. */
export class AgentHarnessRegistry {
  private readonly adapters = new Map<string, AgentAdapterRegistration>()

  register(registration: AgentAdapterRegistration): this {
    const { descriptor, storageNamespace } = registration
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.id) || !/^[a-z][a-z0-9-]{0,63}$/.test(storageNamespace)) {
      throw new AgentHarnessError('CONFIGURATION', 'Invalid adapter or storage namespace.')
    }
    if (this.adapters.has(descriptor.id)) throw new AgentHarnessError('CONFIGURATION', 'This adapter is already registered.')
    this.adapters.set(descriptor.id, { ...registration, descriptor: structuredClone(descriptor) })
    return this
  }

  list(): AgentAdapterDescriptor[] { return [...this.adapters.values()].map(adapter => structuredClone(adapter.descriptor)) }

  descriptor(id: string): AgentAdapterDescriptor {
    const registration = this.adapters.get(id)
    if (!registration) throw new AgentHarnessError('UNSUPPORTED_ADAPTER', 'The selected agent adapter is not installed. Choose an available agent in Chat settings.')
    return structuredClone(registration.descriptor)
  }

  create(id: string, userId: string, dataRoot: string): AgentHarness {
    const registration = this.adapters.get(id)
    if (!registration) throw new AgentHarnessError('UNSUPPORTED_ADAPTER', 'The selected agent adapter is not installed. Choose an available agent in Chat settings.')
    if (!isAbsolute(dataRoot) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      throw new AgentHarnessError('CONFIGURATION', 'Adapters require an absolute application data directory and authenticated user ID.')
    }
    const harness = registration.create({ userId, home: join(dataRoot, registration.storageNamespace, userId) })
    if (harness.adapterId !== id) { harness.close(); throw new AgentHarnessError('CONFIGURATION', 'Adapter factory returned the wrong adapter.') }
    const capabilities = structuredClone(registration.descriptor.capabilities)
    // Enforce advertised capabilities at the shared boundary, even for future adapters.
    return {
      adapterId: id, capabilities: structuredClone(capabilities),
      account: () => harness.account(),
      models: () => {
        if (!capabilities.modelCatalog) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent does not offer model selection.')
        return harness.models()
      },
      login: method => {
        const selected = method ?? capabilities.loginMethods[0]?.id
        if (!selected || !capabilities.loginMethods.some(option => option.id === selected)) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent does not support that sign-in method.')
        return harness.login(selected)
      },
      cancelLogin: loginId => harness.cancelLogin(loginId),
      logout: () => harness.logout(),
      streamChat: params => {
        if (!capabilities.streaming || params.availableTools.length && !capabilities.brewingTools) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent cannot run this brewing conversation.')
        if ((params.persistent || params.threadId) && !capabilities.persistentThreads) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent does not support persistent conversations.')
        if (params.model && !capabilities.modelCatalog) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent does not offer model selection.')
        if (params.reasoningEffort && !capabilities.reasoningEffort) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent does not support reasoning effort.')
        if (params.showReasoning && !capabilities.reasoningSummaries) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent does not expose reasoning summaries.')
        if (params.verbosity && !capabilities.verbosity.includes(params.verbosity)) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent does not support that verbosity.')
        return harness.streamChat(params)
      },
      ...(capabilities.contextCompaction && harness.compactThread ? { compactThread: (params: import('./types.ts').HarnessCompactionParams) => harness.compactThread!(params) } : {}),
      ...(capabilities.persistentThreads && harness.deleteThread ? { deleteThread: (threadId: string) => harness.deleteThread!(threadId) } : {}),
      cancelTurn: () => {
        if (!capabilities.cancellation) throw new AgentHarnessError('UNSUPPORTED_CAPABILITY', 'This agent cannot cancel turns.')
        return harness.cancelTurn()
      },
      close: () => harness.close(),
    }
  }

  storageNamespaces(): string[] { return [...new Set([...this.adapters.values()].map(adapter => adapter.storageNamespace))] }
}

const production = new AgentHarnessRegistry().register({
  descriptor: {
    id: 'codex', displayName: 'Codex', accountLabel: 'ChatGPT',
    description: 'Use your separately connected ChatGPT account through this installation’s Codex App Server.',
    capabilities: CODEX_CAPABILITIES,
  },
  storageNamespace: 'codex',
  create: ({ home }) => new CodexAppServerHarness({ codexHome: home, binary: process.env.CODEX_BINARY || 'codex' }),
})
export function listAgentAdapters(): AgentAdapterDescriptor[] { return production.list() }
export function getAgentAdapter(id: string): AgentAdapterDescriptor { return production.descriptor(id) }
export function createAgentHarness(id: string, userId: string, dataRoot: string): AgentHarness { return production.create(id, userId, dataRoot) }
export function agentStorageNamespaces(): string[] { return production.storageNamespaces() }
