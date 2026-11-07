/** Transport-independent application contract. This module has no runtime/provider imports. */
export interface BrewingTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}
export interface ToolExecutionResult {
  success: boolean
  content: string
  parsedResult?: unknown
  errorMessage?: string
}
export type Verbosity = 'low' | 'medium' | 'high'
export interface AgentModel {
  id: string
  model?: string
  displayName?: string
  description?: string
  isDefault?: boolean
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description: string }>
  defaultReasoningEffort?: string
  [key: string]: unknown
}
export interface AgentAccountStatus {
  account: { type: string; email?: string | null; planType?: string; [key: string]: unknown } | null
  requiresAuthentication: boolean
}
export interface AgentLogin {
  method: string
  loginId: string
  verificationUrl?: string
  userCode?: string
  authUrl?: string
}
export interface AgentCapabilities {
  loginMethods: Array<{ id: string; label: string }>
  modelCatalog: boolean
  streaming: boolean
  brewingTools: boolean
  cancellation: boolean
  reasoningEffort: boolean
  reasoningSummaries: boolean
  verbosity: Verbosity[]
  persistentThreads?: boolean
  contextCompaction?: boolean
  automaticCompaction?: boolean
}
export interface AgentAdapterDescriptor {
  id: string
  displayName: string
  accountLabel: string
  description: string
  capabilities: AgentCapabilities
}
export type HarnessEvent = Record<string, unknown> & { type: string }
export interface HarnessChatParams {
  model?: string
  /** Native ID loaded only from the authenticated conversation record. */
  threadId?: string
  persistent?: boolean
  /** Awaited before starting inference so the application can save the native ID. */
  onThreadReady?: (threadId: string) => void | Promise<void>
  systemPrompt: string
  message: string
  conversationHistory?: Array<{ role: string; content: string }>
  availableTools: BrewingTool[]
  executeTool: (call: { toolName: string; toolCallId: string; toolInput: Record<string, unknown>; abortSignal: AbortSignal }) => Promise<ToolExecutionResult>
  onEvent: (event: HarnessEvent) => void
  abortSignal?: AbortSignal
  showReasoning?: boolean
  reasoningEffort?: string
  verbosity?: Verbosity
  maxToolRounds?: number
  onUsage?: (usage: { provider: string; model: string; input_tokens: number; output_tokens: number; cached_input_tokens: number }) => void | Promise<void>
}
export interface HarnessTurnResult {
  threadId: string
  turnId: string
  status: 'completed' | 'interrupted' | 'failed'
}
export interface HarnessCompactionParams {
  threadId: string
  abortSignal?: AbortSignal
  onEvent?: (event: HarnessEvent) => void
}
export interface AgentHarness {
  readonly adapterId: string
  readonly capabilities: AgentCapabilities
  account(): Promise<AgentAccountStatus>
  models(): Promise<AgentModel[]>
  login(method?: string): Promise<AgentLogin>
  cancelLogin(loginId: string): Promise<unknown>
  logout(): Promise<void>
  streamChat(params: HarnessChatParams): Promise<HarnessTurnResult>
  compactThread?(params: HarnessCompactionParams): Promise<void>
  deleteThread?(threadId: string): Promise<void>
  cancelTurn(): Promise<void>
  close(): void
}
export interface AgentFactoryContext {
  userId: string
  /** Absolute application-owned, adapter-scoped home. Never the owner's desktop/CLI home. */
  home: string
}
export interface AgentAdapterRegistration {
  descriptor: AgentAdapterDescriptor
  /** Relative application-owned storage namespace. Existing Codex account homes retain their path. */
  storageNamespace: string
  create(context: AgentFactoryContext): AgentHarness
}
export class AgentHarnessError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'AgentHarnessError'
    this.code = code
    this.status = status
  }
}
