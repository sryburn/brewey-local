import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { chmod, mkdir, realpath, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { DEFAULT_CHAT_VERBOSITY } from '../codex-chat-defaults.mjs'

import type { AgentHarness, AgentCapabilities, AgentAccountStatus, AgentLogin, AgentModel, ToolExecutionResult, HarnessChatParams, HarnessEvent, HarnessTurnResult, HarnessCompactionParams } from './types.ts'
export type { AgentHarness, BrewingTool, ToolExecutionResult, HarnessChatParams, HarnessEvent, HarnessTurnResult } from './types.ts'
export interface CodexModel extends AgentModel { model: string; displayName: string }
export interface CodexAccountStatus extends AgentAccountStatus { requiresOpenaiAuth: boolean; [key: string]: unknown }
export type CodexLogin = AgentLogin & (
  | { type: 'chatgpt'; authUrl: string }
  | { type: 'chatgptDeviceCode'; verificationUrl: string; userCode: string }
)
export const CODEX_CAPABILITIES: AgentCapabilities = {
  loginMethods: [{ id: 'deviceCode', label: 'Connect with a device code' }],
  modelCatalog: true, streaming: true, brewingTools: true, cancellation: true,
  reasoningEffort: true, reasoningSummaries: true, verbosity: ['low', 'medium', 'high'],
  persistentThreads: true, contextCompaction: true, automaticCompaction: true,
}

export interface CodexHarnessOptions {
  /** Dedicated persistent per-user directory. Never point this at your personal .codex. */
  codexHome: string
  /** Empty application-owned work directory, not the source checkout. */
  cwd?: string
  binary?: string
  requestTimeoutMs?: number
  turnTimeoutMs?: number
  toolTimeoutMs?: number
}
type WireMessage = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message: string } }
type PendingRequest = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type WireTurn = { id: string; status: HarnessTurnResult['status'] | 'inProgress'; error?: { message: string } | null }
type ActiveCompaction = {
  threadId: string
  turnId: string
  compactionItemId?: string
  sawCompaction: boolean
  completedCompaction: boolean
  aborted: boolean
  interruptSent: boolean
  onEvent?: (event: HarnessEvent) => void
  complete: (turn: WireTurn) => void
  fail: (error: Error) => void
}
type ActiveTurn = {
  params: HarnessChatParams
  threadId: string
  turnId: string
  model: string
  abort: AbortController
  aborted: boolean
  interruptSent: boolean
  compacted: boolean
  toolCalls: number
  calls: Set<string>
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number }
  complete: (turn: WireTurn) => void
  fail: (error: Error) => void
}

export class CodexHarnessError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'CodexHarnessError'; this.code = code }
}

/** Server-only stdio adapter. It deliberately supports ChatGPT login only, with no paid fallback. */
export class CodexAppServerHarness implements AgentHarness {
  readonly adapterId = 'codex'
  readonly capabilities = CODEX_CAPABILITIES
  private turnCancellation?: AbortController
  private readonly options: CodexHarnessOptions
  private process?: ChildProcessWithoutNullStreams
  private lines?: Interface
  private starting?: Promise<void>
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private active?: ActiveTurn
  private compaction?: ActiveCompaction
  private busy = false
  private listeners = new Set<(method: string, params: Record<string, unknown>) => void>()

  constructor(options: CodexHarnessOptions) {
    if (!isAbsolute(options.codexHome)) throw new CodexHarnessError('CONFIGURATION', 'CODEX_HOME must be an absolute dedicated application directory.')
    this.options = options
  }

  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private async ensureStarted(): Promise<void> {
    if (!this.starting) {
      this.starting = this.start().catch(error => { this.close(); throw error })
    }
    return this.starting
  }

  private async start(): Promise<void> {
    const home = resolve(this.options.codexHome)
    const ownerHome = homedir()
    const forbidden = [join(ownerHome, '.codex'), process.env.CODEX_HOME].filter((value): value is string => Boolean(value))
    if (forbidden.some(value => resolve(value) === home) || home === ownerHome) {
      throw new CodexHarnessError('CONFIGURATION', 'The harness must use its own CODEX_HOME, separate from desktop/CLI credentials.')
    }
    await mkdir(home, { recursive: true, mode: 0o700 })
    const canonicalHome = await realpath(home)
    if (canonicalHome === await realpath(ownerHome)) throw new CodexHarnessError('CONFIGURATION', 'CODEX_HOME must not resolve to the operating-system user home.')
    for (const path of forbidden) {
      const canonicalForbidden = await realpath(path).catch(() => resolve(path))
      if (canonicalHome === canonicalForbidden || canonicalHome.startsWith(canonicalForbidden + '/')) {
        throw new CodexHarnessError('CONFIGURATION', 'CODEX_HOME must not resolve into desktop/CLI credential storage.')
      }
    }
    await chmod(home, 0o700)
    const isolatedUserHome = join(home, 'user')
    const cwd = this.options.cwd ?? join(home, 'work')
    if (!isAbsolute(cwd)) throw new CodexHarnessError('CONFIGURATION', 'Harness working directory must be absolute.')
    await mkdir(isolatedUserHome, { recursive: true, mode: 0o700 })
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    // Inherit only executable lookup and TLS configuration; never ambient tokens, keys or owner HOME.
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: isolatedUserHome,
      CODEX_HOME: home, XDG_CONFIG_HOME: join(isolatedUserHome, '.config'), XDG_CACHE_HOME: join(isolatedUserHome, '.cache') }
    for (const key of ['SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']) if (process.env[key]) env[key] = process.env[key]
    const settings = [
      'forced_login_method="chatgpt"', 'cli_auth_credentials_store="file"', 'model_provider="openai"',
      'features.shell_tool=false', 'features.unified_exec=false', 'features.shell_snapshot=false',
      'features.code_mode.enabled=false', 'features.multi_agent=false', 'features.apps=false',
      'features.hooks=false', 'features.memories=false', 'features.goals=false', 'web_search="disabled"',
      'project_doc_max_bytes=0', 'feedback.enabled=false', 'mcp_servers={}',
    ]
    const child = spawn(/* turbopackIgnore: true */ this.options.binary ?? 'codex', ['app-server', '--listen', 'stdio://', ...settings.flatMap(value => ['-c', value])], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.process = child
    child.on('error', () => { if (this.process === child) this.transportFailed(new CodexHarnessError('UNAVAILABLE', 'Codex app-server could not start. Install the configured Codex CLI binary.')) })
    child.on('exit', () => { if (this.process === child) this.transportFailed(new CodexHarnessError('UNAVAILABLE', 'Codex app-server exited. Please reconnect and try again.')) })
    child.stdin.on('error', () => { if (this.process === child) this.transportFailed(new CodexHarnessError('UNAVAILABLE', 'Codex app-server input closed.')) })
    // Drain stderr without logging auth URLs, tokens, or model prompts.
    child.stderr.resume()
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', line => {
      try { this.receive(JSON.parse(line) as WireMessage) }
      catch { this.transportFailed(new CodexHarnessError('PROTOCOL', 'Invalid app-server protocol message.')) }
    })
    await this.rpc('initialize', { clientInfo: { name: 'brewey_selfhosted', title: 'Brewey', version: '0.1.0' }, capabilities: { experimentalApi: true } })
    this.send({ method: 'initialized', params: {} })
  }

  private send(message: WireMessage): void {
    if (!this.process || this.process.stdin.destroyed) throw new CodexHarnessError('UNAVAILABLE', 'Codex app-server is disconnected.')
    this.process.stdin.write(JSON.stringify(message) + '\n')
  }

  private rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CodexHarnessError('TIMEOUT', `Codex request timed out: ${method}`))
      }, this.options.requestTimeoutMs ?? 30_000)
      this.pending.set(id, { resolve: value => resolveRequest(value as T), reject, timer })
      try { this.send({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  private receive(message: WireMessage): void {
    if (message.id !== undefined && !message.method) {
      const request = this.pending.get(Number(message.id))
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(Number(message.id))
      if (message.error) request.reject(new CodexHarnessError('RPC', message.error.message))
      else request.resolve(message.result)
      return
    }
    if (!message.method) return
    const params = message.params ?? {}
    if (message.id !== undefined) {
      void this.serverRequest(message.id, message.method, params).catch(() => {
        this.transportFailed(new CodexHarnessError('PROTOCOL', 'Failed to respond to app-server tool request.'))
      })
      return
    }
    for (const listener of this.listeners) { try { listener(message.method, params) } catch { /* observer cannot break transport */ } }
    const compaction = this.compaction
    if (compaction && params.threadId === compaction.threadId) this.receiveCompaction(message.method, params, compaction)
    const active = this.active
    if (!active || params.threadId !== active.threadId) return
    const turn = params.turn as WireTurn | undefined
    if (message.method === 'turn/started' && turn) {
      active.turnId = turn.id
      if (active.aborted) this.interrupt(active)
    }
    if (params.turnId && active.turnId && params.turnId !== active.turnId) return
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') this.emit(active, { type: 'text', content: params.delta })
    if (message.method === 'item/reasoning/summaryTextDelta' && active.params.showReasoning && typeof params.delta === 'string') this.emit(active, { type: 'reasoning', content: params.delta })
    const item = params.item as { type?: string; id?: string } | undefined
    if (message.method === 'item/completed' && item?.type === 'contextCompaction') active.compacted = true
    if (message.method === 'thread/tokenUsage/updated') {
      const usage = (params.tokenUsage as { last?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } })?.last
      if (usage) active.usage = { input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0, cached_input_tokens: usage.cachedInputTokens ?? 0 }
    }
    if (message.method === 'error' && params.willRetry) this.emit(active, { type: 'system_message', content: 'Codex is reconnecting. Your turn will retry automatically.' })
    if (message.method === 'turn/completed' && turn && (!active.turnId || turn.id === active.turnId)) active.complete(turn)
  }

  private emit(active: ActiveTurn, event: HarnessEvent): void {
    if (active.aborted) return
    try { active.params.onEvent(event) }
    catch { active.aborted = true; active.abort.abort(); this.interrupt(active) }
  }

  private async serverRequest(id: string | number, method: string, params: Record<string, unknown>): Promise<void> {
    const active = this.active
    if (method !== 'item/tool/call') {
      // Brewing tools are the only granted capability. No unattended shell/file/permission approvals.
      this.send({ id, error: { code: -32601, message: 'This client supports brewing tool calls only.' } })
      return
    }
    const callId = String(params.callId ?? '')
    const name = String(params.tool ?? '')
    let result: ToolExecutionResult
    try {
      if (!active || active.aborted || params.threadId !== active.threadId || params.turnId !== active.turnId) throw new Error('This turn is no longer active.')
      if (params.namespace && params.namespace !== 'brewing') throw new Error('Unsupported tool namespace.')
      if (!active.params.availableTools.some(tool => tool.name === name)) throw new Error('Unknown brewing tool.')
      if (!callId || active.calls.has(callId)) throw new Error('Duplicate or missing tool call ID.')
      if (++active.toolCalls > (active.params.maxToolRounds ?? 50)) throw new Error('Brewing tool call limit reached.')
      active.calls.add(callId)
      const toolInput = params.arguments
      if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) throw new Error('Tool arguments must be an object.')
      this.emit(active, { type: 'tool_call', tool_id: callId, tool_name: name, tool_args: toolInput })
      this.emit(active, { type: 'tool_status', tool_id: callId, tool_name: name, status_message: `Running ${name.replaceAll('_', ' ')}…` })
      result = await this.runTool(active, { toolName: name, toolCallId: callId, toolInput: toolInput as Record<string, unknown>, abortSignal: active.abort.signal })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Brewing tool failed.'
      result = { success: false, content: message, errorMessage: message }
    }
    if (active) {
      if (result.success) this.emit(active, { type: 'tool_result', tool_id: callId, tool_name: name, content: result.content, tool_result: result.parsedResult ?? result.content })
      else this.emit(active, { type: 'tool_error', tool_id: callId, tool_name: name, error: result.errorMessage ?? result.content })
    }
    this.send({ id, result: { success: result.success, contentItems: [{ type: 'inputText', text: result.content || JSON.stringify(result.parsedResult ?? {}) }] } })
  }

  private async runTool(active: ActiveTurn, call: Parameters<HarnessChatParams['executeTool']>[0]): Promise<ToolExecutionResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    if (active.abort.signal.aborted) throw new Error('Brewing tool interrupted.')
    try {
      return await Promise.race([
        active.params.executeTool(call),
        new Promise<ToolExecutionResult>((_, reject) => {
          onAbort = () => reject(new Error('Brewing tool interrupted.'))
          active.abort.signal.addEventListener('abort', onAbort, { once: true })
          if (active.abort.signal.aborted) onAbort()
          timer = setTimeout(() => reject(new Error('Brewing tool timed out; its outcome may need checking before retrying.')), this.options.toolTimeoutMs ?? 60_000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) active.abort.signal.removeEventListener('abort', onAbort)
    }
  }

  private interrupt(active: ActiveTurn): void {
    if (!active.turnId || active.interruptSent) return
    active.interruptSent = true
    void this.rpc('turn/interrupt', { threadId: active.threadId, turnId: active.turnId }).catch(() => {
      active.fail(new CodexHarnessError('INTERRUPT', 'Could not interrupt the Codex turn. The app-server connection was closed.'))
      this.close()
    })
  }

  private transportFailed(error: Error): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
    this.pending.clear()
    this.compaction?.fail(error)
    this.active?.fail(error)
    this.active?.abort.abort()
    this.lines?.close()
    this.lines = undefined
    const child = this.process
    this.process = undefined
    this.starting = undefined
    child?.kill()
  }

  async account(): Promise<CodexAccountStatus> {
    await this.ensureStarted()
    const status = await this.rpc<Omit<CodexAccountStatus, 'requiresAuthentication'>>('account/read', { refreshToken: false })
    return { ...status, account: status.account as CodexAccountStatus['account'], requiresOpenaiAuth: Boolean(status.requiresOpenaiAuth), requiresAuthentication: Boolean(status.requiresOpenaiAuth) }
  }
  async models(): Promise<CodexModel[]> {
    await this.ensureStarted()
    const data: CodexModel[] = []
    let cursor: string | null = null
    do {
      const page: { data: CodexModel[]; nextCursor?: string | null } = await this.rpc('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) })
      data.push(...page.data)
      cursor = page.nextCursor ?? null
    } while (cursor)
    return data
  }
  async login(method = 'deviceCode'): Promise<CodexLogin> {
    const type = method === 'deviceCode' ? 'chatgptDeviceCode' : method === 'browser' ? 'chatgpt' : method
    if (this.busy) throw new CodexHarnessError('BUSY', 'Stop the active conversation before signing in to another account.')
    if (type !== 'chatgptDeviceCode' && type !== 'chatgpt') throw new CodexHarnessError('AUTH', 'Only ChatGPT sign-in is supported.')
    await this.ensureStarted()
    const result = await this.rpc<Omit<CodexLogin, 'method'>>('account/login/start', { type, ...(type === 'chatgpt' ? { useHostedLoginSuccessPage: true } : {}) })
    return { ...result, method: type === 'chatgptDeviceCode' ? 'deviceCode' : 'browser' } as CodexLogin
  }
  async cancelLogin(loginId: string): Promise<unknown> { await this.ensureStarted(); return this.rpc('account/login/cancel', { loginId }) }
  async logout(): Promise<void> {
    if (this.busy) throw new CodexHarnessError('BUSY', 'Stop the active conversation before signing out.')
    await this.ensureStarted(); await this.rpc('account/logout')
  }

  async streamChat(params: HarnessChatParams): Promise<HarnessTurnResult> {
    if (this.busy) throw new CodexHarnessError('BUSY', 'A Codex turn is already running for this account.')
    if (params.abortSignal?.aborted) throw new CodexHarnessError('ABORTED', 'Conversation cancelled.')
    this.busy = true
    const cancellation = new AbortController()
    this.turnCancellation = cancellation
    params = { ...params, abortSignal: params.abortSignal ? AbortSignal.any([params.abortSignal, cancellation.signal]) : cancellation.signal }
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    let active: ActiveTurn | undefined
    let currentThreadId: string | undefined
    try {
      const account = await this.account()
      if (account.account?.type !== 'chatgpt') throw new CodexHarnessError('AUTH', 'Connect your ChatGPT account before starting a conversation. API-key inference is disabled.')
      const models = await this.models()
      const selected = params.model ? models.find(model => model.model === params.model || model.id === params.model) : models.find(model => model.isDefault) ?? models[0]
      if (!selected) throw new CodexHarnessError('MODEL', 'The selected model is not in the connected account’s model catalog.')
      if (params.reasoningEffort && !selected.supportedReasoningEfforts?.some(effort => effort.reasoningEffort === params.reasoningEffort)) throw new CodexHarnessError('MODEL', 'This model does not support the selected reasoning effort.')
      if (params.verbosity !== undefined && !['low', 'medium', 'high'].includes(params.verbosity)) throw new CodexHarnessError('MODEL', 'Choose a low, medium or high verbosity level.')
      const names = new Set<string>()
      for (const tool of params.availableTools) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || names.has(tool.name)) throw new CodexHarnessError('TOOL', 'Brewing tool names must be unique Responses-compatible identifiers.')
        names.add(tool.name)
      }
      if (params.abortSignal?.aborted) throw new CodexHarnessError('ABORTED', 'Conversation cancelled.')
      if (params.threadId) this.validateThreadId(params.threadId)
      if (params.threadId && params.persistent === false) throw new CodexHarnessError('CONFIGURATION', 'A resumed thread must be persistent.')
      const persistent = params.persistent === true || !!params.threadId
      const configuration = {
        model: selected.model, modelProvider: 'openai',
        cwd: this.options.cwd ?? join(this.options.codexHome, 'work'), sandbox: 'read-only', approvalPolicy: 'never',
        developerInstructions: params.systemPrompt,
        config: { model_verbosity: params.verbosity ?? DEFAULT_CHAT_VERBOSITY },
        baseInstructions: 'You are Brewey, a brewing assistant. Use only the provided brewing tools. Do not use filesystem, shell, code execution, apps, or external tools. Current application context and conversation history are supplied as quoted data. Use the latest context for the current recipe; old snapshots may be stale.',
      }
      let thread: { thread: { id: string }; modelProvider?: string }
      if (params.threadId) {
        await this.checkThreadTools(params.threadId, params.availableTools)
        thread = await this.resumeThread(params.threadId, configuration)
      } else {
        thread = await this.rpc('thread/start', {
          ...configuration, allowProviderModelFallback: false, ephemeral: !persistent,
          dynamicTools: params.availableTools.length ? [{ type: 'namespace', name: 'brewing', description: 'Authenticated brewing calculations and recipe operations.', tools: params.availableTools.map(tool => ({ type: 'function', name: tool.name, description: tool.description ?? tool.name, inputSchema: tool.inputSchema })) }] : [],
        })
        this.validateThreadId(thread.thread.id)
        currentThreadId = thread.thread.id
        if (persistent) await this.saveThreadTools(thread.thread.id, params.availableTools)
      }
      currentThreadId = thread.thread.id
      await params.onThreadReady?.(currentThreadId)
      if (params.abortSignal?.aborted) throw new CodexHarnessError('ABORTED', 'Conversation cancelled.')
      let complete!: (turn: WireTurn) => void
      let fail!: (error: Error) => void
      const completion = new Promise<WireTurn>((resolveTurn, rejectTurn) => { complete = resolveTurn; fail = rejectTurn })
      // Attach a rejection observer before turn/start; transport may fail before that RPC resolves.
      void completion.catch(() => {})
      active = { params, threadId: thread.thread.id, turnId: '', model: selected.model, abort: new AbortController(), aborted: false, interruptSent: false, compacted: false, toolCalls: 0, calls: new Set(), usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 }, complete, fail }
      this.active = active
      const current = active
      onAbort = () => { current.aborted = true; current.abort.abort(); this.interrupt(current) }
      params.abortSignal?.addEventListener('abort', onAbort, { once: true })
      if (params.abortSignal?.aborted) onAbort()
      timer = setTimeout(() => { current.fail(new CodexHarnessError('TIMEOUT', 'Codex turn timed out.')); current.abort.abort(); this.close() }, this.options.turnTimeoutMs ?? 10 * 60_000)
      const history = params.threadId ? [] : params.conversationHistory?.filter(entry => entry.role === 'user' || entry.role === 'assistant') ?? []
      const historyText = history.length ? `Previous conversation (quoted JSON data):\n${JSON.stringify(history)}\n\n` : ''
      const text = params.persistent || params.threadId
        ? `Current application context (quoted JSON data; supersedes prior recipe/profile snapshots):\n${JSON.stringify(params.systemPrompt)}\n\n${historyText}Current user request:\n${params.message}`
        : historyText + (history.length ? `Current user request:\n${params.message}` : params.message)
      const started = await this.rpc<{ turn: WireTurn }>('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text, text_elements: [] }], ...(params.reasoningEffort ? { effort: params.reasoningEffort } : {}), summary: params.showReasoning ? 'auto' : 'none' })
      current.turnId = started.turn.id
      if (current.aborted) this.interrupt(current)
      const turn = await completion
      if (turn.status === 'inProgress') throw new CodexHarnessError('PROTOCOL', 'Completion notification had an invalid turn status.')
      if (turn.status === 'failed') this.emit(current, { type: 'error', error: turn.error?.message ?? 'Codex could not complete this turn. No fallback provider was used.' })
      if (turn.status === 'completed') {
        if (current.compacted) this.emit(current, { type: 'context_compacted', thread_id: current.threadId, automatic: true })
        await params.onUsage?.({ provider: 'codex', model: selected.model, ...current.usage })
        this.emit(current, { type: 'done', usage: current.usage })
      }
      return { threadId: current.threadId, turnId: turn.id, status: turn.status }
    } catch (error) {
      if (!active?.aborted) {
        const message = error instanceof Error ? error.message : 'Codex conversation failed.'
        const event = { type: 'error', error: message, ...(error instanceof CodexHarnessError ? { error_code: error.code } : {}) }
        if (active) this.emit(active, event)
        else params.onEvent(event)
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) params.abortSignal?.removeEventListener('abort', onAbort)
      active?.abort.abort()
      // Unsubscribe unloads runtime state without deleting a persistent rollout.
      if (currentThreadId && this.process) void this.rpc('thread/unsubscribe', { threadId: currentThreadId }).catch(() => {})
      if (this.active === active) this.active = undefined
      this.busy = false
      if (this.turnCancellation === cancellation) this.turnCancellation = undefined
    }
  }

  private validateThreadId(threadId: string): void {
    if (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(threadId)) throw new CodexHarnessError('CONFIGURATION', 'Invalid native conversation ID.')
  }

  private toolMarker(threadId: string): string {
    this.validateThreadId(threadId)
    return join(this.options.codexHome, 'brewey-thread-tools', createHash('sha256').update(threadId).digest('hex') + '.json')
  }

  private toolFingerprint(tools: HarnessChatParams['availableTools']): string {
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
    return createHash('sha256').update(JSON.stringify(canonical([...tools].sort((a, b) => a.name.localeCompare(b.name))))).digest('hex')
  }

  private async saveThreadTools(threadId: string, tools: HarnessChatParams['availableTools']): Promise<void> {
    await mkdir(join(this.options.codexHome, 'brewey-thread-tools'), { recursive: true, mode: 0o700 })
    const path = this.toolMarker(threadId), staging = path + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(staging, JSON.stringify({ version: 1, fingerprint: this.toolFingerprint(tools) }), { flag: 'wx', mode: 0o600 })
      await rename(staging, path)
    } finally { await rm(staging, { force: true }) }
  }

  private async checkThreadTools(threadId: string, tools: HarnessChatParams['availableTools']): Promise<void> {
    let marker: { version?: number; fingerprint?: string }
    try { marker = JSON.parse(await readFile(this.toolMarker(threadId), 'utf8')) }
    catch { throw new CodexHarnessError('THREAD_TOOLS_CHANGED', 'The saved conversation tool schema is unavailable. Restore a new conversation from its saved transcript.') }
    if (marker.version !== 1 || marker.fingerprint !== this.toolFingerprint(tools)) throw new CodexHarnessError('THREAD_TOOLS_CHANGED', 'The brewing tool schema or unit system changed. Restore a new conversation from its saved transcript.')
  }

  private async resumeThread(threadId: string, configuration: Record<string, unknown> = {}): Promise<{ thread: { id: string }; modelProvider?: string }> {
    this.validateThreadId(threadId)
    try {
      const result = await this.rpc<{ thread: { id: string }; modelProvider?: string }>('thread/resume', { threadId, excludeTurns: true, ...configuration })
      if (result.thread.id !== threadId || result.modelProvider && result.modelProvider !== 'openai') throw new CodexHarnessError('PROTOCOL', 'Codex resumed an unexpected conversation or provider.')
      return result
    } catch (error) {
      if (!(error instanceof CodexHarnessError) || error.code !== 'RPC') throw error
      // Only native missing-rollout errors permit the application to rebuild from saved history.
      const missing = error.message.trim() === `no rollout found for thread id ${threadId}`
      throw new CodexHarnessError(missing ? 'THREAD_MISSING' : 'THREAD_RESUME_FAILED', error.message)
    }
  }

  private receiveCompaction(method: string, params: Record<string, unknown>, compaction: ActiveCompaction): void {
    const turn = params.turn as WireTurn | undefined
    if (method === 'turn/started' && turn && !compaction.turnId) {
      compaction.turnId = turn.id
      if (compaction.aborted) this.interruptCompaction(compaction)
    }
    if (!compaction.turnId || params.turnId && params.turnId !== compaction.turnId) return
    const item = params.item as { type?: string; id?: string } | undefined
    if (item?.type === 'contextCompaction') {
      if (method === 'item/started' && item.id) { compaction.sawCompaction = true; compaction.compactionItemId = item.id }
      if (method === 'item/completed' && item.id === compaction.compactionItemId) compaction.completedCompaction = true
    }
    if (method === 'error' && !params.willRetry) compaction.fail(new CodexHarnessError('COMPACTION_FAILED', (params.error as { message?: string })?.message || 'Conversation compaction failed.'))
    if (method === 'turn/completed' && turn?.id === compaction.turnId) compaction.complete(turn)
  }

  private interruptCompaction(compaction: ActiveCompaction): void {
    if (!compaction.turnId || compaction.interruptSent) return
    compaction.interruptSent = true
    void this.rpc('turn/interrupt', { threadId: compaction.threadId, turnId: compaction.turnId }).catch(() => {
      compaction.fail(new CodexHarnessError('INTERRUPT', 'Could not interrupt conversation compaction.'))
      this.close()
    })
  }

  async compactThread(params: HarnessCompactionParams): Promise<void> {
    this.validateThreadId(params.threadId)
    if (this.busy) throw new CodexHarnessError('BUSY', 'A Codex operation is already running for this account.')
    if (params.abortSignal?.aborted) throw new CodexHarnessError('ABORTED', 'Compaction cancelled.')
    this.busy = true
    const cancellation = new AbortController()
    this.turnCancellation = cancellation
    const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, cancellation.signal]) : cancellation.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    let compaction: ActiveCompaction | undefined
    let onAbort: (() => void) | undefined
    try {
      const account = await this.account()
      if (account.account?.type !== 'chatgpt') throw new CodexHarnessError('AUTH', 'Connect your ChatGPT account before compacting a conversation. API-key inference is disabled.')
      await this.resumeThread(params.threadId, {
        cwd: this.options.cwd ?? join(this.options.codexHome, 'work'), sandbox: 'read-only', approvalPolicy: 'never', modelProvider: 'openai',
      })
      if (signal.aborted) throw new CodexHarnessError('ABORTED', 'Compaction cancelled.')
      let complete!: (turn: WireTurn) => void
      let fail!: (error: Error) => void
      const completion = new Promise<WireTurn>((resolveTurn, rejectTurn) => { complete = resolveTurn; fail = rejectTurn })
      void completion.catch(() => {})
      compaction = { threadId: params.threadId, turnId: '', sawCompaction: false, completedCompaction: false, aborted: false, interruptSent: false, onEvent: params.onEvent, complete, fail }
      this.compaction = compaction
      const current = compaction
      onAbort = () => { current.aborted = true; this.interruptCompaction(current) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      timer = setTimeout(() => { current.fail(new CodexHarnessError('TIMEOUT', 'Conversation compaction timed out.')); this.close() }, this.options.turnTimeoutMs ?? 10 * 60_000)
      await this.rpc('thread/compact/start', { threadId: params.threadId })
      const turn = await completion
      if (current.aborted || turn.status === 'interrupted') throw new CodexHarnessError('ABORTED', 'Compaction cancelled.')
      if (turn.status !== 'completed') throw new CodexHarnessError('COMPACTION_FAILED', turn.error?.message || 'Conversation compaction failed.')
      if (!current.sawCompaction || !current.completedCompaction) throw new CodexHarnessError('PROTOCOL', 'Compaction completed without a matching context compaction item.')
      params.onEvent?.({ type: 'context_compacted', thread_id: params.threadId, automatic: false })
    } catch (error) {
      // A failed/unknown compaction cannot leave an in-flight native operation behind.
      if (compaction?.turnId) this.close()
      if (signal.aborted) throw new CodexHarnessError('ABORTED', 'Compaction cancelled.')
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
      if (this.compaction === compaction) this.compaction = undefined
      if (this.process) void this.rpc('thread/unsubscribe', { threadId: params.threadId }).catch(() => {})
      if (this.turnCancellation === cancellation) this.turnCancellation = undefined
      this.busy = false
    }
  }

  /** Permanent native deletion, not archive. The application must verify its own conversation ownership. */
  async deleteThread(threadId: string): Promise<void> {
    this.validateThreadId(threadId)
    if (this.busy) throw new CodexHarnessError('BUSY', 'Stop the active Codex operation before deleting its conversation.')
    this.busy = true
    try {
      await this.ensureStarted()
      try { await this.rpc('thread/delete', { threadId }) }
      catch (error) {
        // A missing rollout is already removed; permission/configuration failures remain explicit.
        if (!(error instanceof CodexHarnessError) || error.code !== 'RPC' || error.message.trim() !== `no rollout found for thread id ${threadId}`) throw error
      }
      await rm(this.toolMarker(threadId), { force: true })
    } finally { this.busy = false }
  }

  async cancelTurn(): Promise<void> { this.turnCancellation?.abort() }

  close(): void { this.transportFailed(new CodexHarnessError('UNAVAILABLE', 'Codex app-server connection closed.')) }
}
